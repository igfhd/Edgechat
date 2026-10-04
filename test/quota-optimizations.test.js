import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import initSqlJs from 'sql.js';

import {
  issueUrlTicket,
  resolveUrlTicket,
  createWsRoomScope,
  WS_TICKET_TTL_SECONDS
} from '../worker/src/tickets.js';
import { touchUserLastActive } from '../worker/src/data/users.js';
import { listRoomMembersUnreadCounts } from '../worker/src/data/unread.js';
import { ChannelRoom } from '../worker/src/do/ChannelRoom.js';

const SQL = await initSqlJs({
  locateFile(file) {
    return fileURLToPath(new URL(`../node_modules/sql.js/dist/${file}`, import.meta.url));
  }
});

function createMockDb() {
  const db = new SQL.Database();
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      avatar_key TEXT,
      is_disabled INTEGER NOT NULL DEFAULT 0,
      disabled_until TEXT,
      is_admin INTEGER NOT NULL DEFAULT 0,
      session_version INTEGER NOT NULL DEFAULT 0,
      last_active_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      deleted_at TEXT
    );

    CREATE TABLE channels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      avatar_key TEXT,
      kind TEXT NOT NULL,
      dm_key TEXT,
      created_by INTEGER,
      pinned_message_id INTEGER DEFAULT NULL,
      deleted_at TEXT
    );

    CREATE TABLE channel_members (
      channel_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      invited_by INTEGER,
      joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (channel_id, user_id)
    );

    CREATE TABLE messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      channel_id INTEGER NOT NULL,
      sender_id INTEGER,
      content TEXT NOT NULL DEFAULT '',
      attachment_key TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      deleted_at TEXT
    );

    CREATE TABLE message_reads (
      channel_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      last_read_message_id INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (channel_id, user_id)
    );

    INSERT INTO users (id, username, display_name, is_admin) VALUES
      (1, 'alice', 'Alice', 0),
      (2, 'bob', 'Bob', 0),
      (3, 'carol', 'Carol', 0);

    INSERT INTO channels (id, name, kind) VALUES
      (1, 'general', 'public');

    INSERT INTO channel_members (channel_id, user_id, role) VALUES
      (1, 1, 'member'),
      (1, 2, 'member'),
      (1, 3, 'member');

    INSERT INTO messages (id, channel_id, sender_id, content) VALUES
      (10, 1, 1, 'hello 1'),
      (11, 1, 1, 'hello 2'),
      (12, 1, 1, 'hello 3');

    INSERT INTO message_reads (channel_id, user_id, last_read_message_id) VALUES
      (1, 2, 10);
  `);

  return {
    rawDb: db,
    prepare(query) {
      return {
        _bound: [],
        bind(...args) {
          this._bound = args;
          return this;
        },
        async first() {
          const stmt = db.prepare(query);
          stmt.bind(this._bound);
          let row = null;
          if (stmt.step()) {
            row = stmt.getAsObject();
          }
          stmt.free();
          return row;
        },
        async all() {
          const stmt = db.prepare(query);
          stmt.bind(this._bound);
          const results = [];
          while (stmt.step()) {
            results.push(stmt.getAsObject());
          }
          stmt.free();
          return { results };
        },
        async run() {
          const stmt = db.prepare(query);
          stmt.bind(this._bound);
          stmt.step();
          stmt.free();
          return { success: true, meta: { changes: 1 } };
        }
      };
    }
  };
}

test('Stateless HMAC ticket generation does not call KV put or delete', async () => {
  let putCount = 0;
  let deleteCount = 0;
  const mockEnv = {
    SESSIONS: {
      async put() { putCount += 1; },
      async delete() { deleteCount += 1; },
      async get(key) {
        if (key === 'sess_valid') {
          return JSON.stringify({
            token: 'sess_valid',
            userId: 1,
            username: 'alice',
            displayName: 'Alice',
            isAdmin: false,
            sessionVersion: 0
          });
        }
        return null;
      }
    },
    DB: {
      prepare() {
        return {
          bind() { return this; },
          async all() {
            return {
              results: [{
                username: 'alice',
                is_disabled: 0,
                deleted_at: null,
                session_version: 0,
                is_admin: 0
              }]
            };
          }
        };
      }
    }
  };

  const session = { token: 'sess_valid', userId: 1 };
  const issued = await issueUrlTicket(mockEnv, {
    purpose: 'ws',
    scope: createWsRoomScope('public', 1),
    session,
    ttlSeconds: WS_TICKET_TTL_SECONDS
  });

  assert.equal(putCount, 0, 'Must not perform KV write for ticket issuance');

  const resolved = await resolveUrlTicket(mockEnv, issued.ticket, {
    purpose: 'ws',
    scope: createWsRoomScope('public', 1)
  });

  assert.ok(resolved?.ok);
  assert.equal(resolved.session.userId, 1);
  assert.equal(deleteCount, 0, 'Must not perform KV delete for ticket resolution');
});

test('touchUserLastActive throttles rapid repeated calls', async () => {
  let writeCount = 0;
  const mockDb = {
    prepare(sql) {
      return {
        bind() {
          return {
            async run() {
              if (sql.includes('last_active_at')) {
                writeCount += 1;
              }
              return { success: true };
            }
          };
        }
      };
    }
  };

  const userId = 99999;
  await touchUserLastActive(mockDb, userId, true);
  assert.equal(writeCount, 1);

  // Subsequent immediate calls should be throttled in memory
  await touchUserLastActive(mockDb, userId);
  await touchUserLastActive(mockDb, userId);
  await touchUserLastActive(mockDb, userId);
  assert.equal(writeCount, 1, 'Repeated touches within throttle window must be skipped');
});

test('listRoomMembersUnreadCounts returns accurate unread counts in one query', async () => {
  const db = createMockDb();
  const unreadList = await listRoomMembersUnreadCounts(db, 1, 1);
  
  // Alice is excluded (sender)
  // Bob read up to message 10, total messages 10,11,12 -> unreadCount should be 2 (11 and 12)
  // Carol has no read record -> unreadCount should be 3 (10, 11, 12)
  const bob = unreadList.find(u => u.userId === 2);
  const carol = unreadList.find(u => u.userId === 3);

  assert.ok(bob);
  assert.equal(bob.unreadCount, 2);
  assert.ok(carol);
  assert.equal(carol.unreadCount, 3);
});

test('ChannelRoom DO broadcast uses cached validation', async () => {
  let validateSessionCount = 0;
  const state = {
    getWebSockets() { return []; },
    acceptWebSocket() {},
    waitUntil() {}
  };
  const env = {
    SESSIONS: {
      async get() {
        validateSessionCount += 1;
        return JSON.stringify({
          token: 'token_1',
            userId: 1,
            username: 'alice',
            isAdmin: false,
            sessionVersion: 0
        });
      }
    },
    DB: {
      prepare() {
        return {
          bind() { return this; },
          async all() {
            return {
              results: [{
                id: 1,
                name: 'general',
                kind: 'public',
                username: 'alice',
                is_disabled: 0,
                deleted_at: null,
                session_version: 0,
                is_admin: 0
              }]
            };
          }
        };
      }
    }
  };

  const room = new ChannelRoom(state, env);
  const mockSocket = {
    sends: [],
    send(msg) { this.sends.push(msg); },
    close() {},
    serializeAttachment() {}
  };

  const meta = {
    token: 'token_1',
    principal: { userId: 1, isAdmin: false },
    room: { id: 1, kind: 'public', name: 'general' },
    validatedUntil: Date.now() + 30000
  };
  room.connections.set(mockSocket, meta);

  // First broadcast
  await room.broadcast(JSON.stringify({ type: 'presence', userId: 1, online: true }));
  // Second broadcast immediately
  await room.broadcast(JSON.stringify({ type: 'presence', userId: 2, online: true }));
  // Third broadcast immediately
  await room.broadcast(JSON.stringify({ type: 'presence', userId: 3, online: true }));

  assert.equal(validateSessionCount, 0, 'Should not revalidate against KV/DB when validatedUntil is fresh');
  assert.equal(mockSocket.sends.length, 3);
});
