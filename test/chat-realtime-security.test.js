import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import initSqlJs from 'sql.js';
import { ChannelRoom } from '../worker/src/do/ChannelRoom.js';

const SQL = await initSqlJs({
  locateFile(file) {
    return fileURLToPath(new URL(`../node_modules/sql.js/dist/${file}`, import.meta.url));
  }
});

function createTestDb() {
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
      pinned_message_id INTEGER,
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
      attachment_name TEXT,
      attachment_type TEXT,
      attachment_size INTEGER,
      sender_kind TEXT NOT NULL DEFAULT 'local',
      external_sender_id TEXT,
      external_sender_name TEXT,
      external_sender_avatar_url TEXT,
      source TEXT NOT NULL DEFAULT 'edgechat',
      source_message_id TEXT,
      source_attachment_id TEXT,
      source_attachment_unique_id TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      edited_at TEXT,
      deleted_at TEXT
    );

    CREATE TABLE message_reactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      reaction TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(message_id, user_id, reaction)
    );

    INSERT INTO users (id, username, display_name, is_admin) VALUES
      (1, 'alice', '爱丽丝', 0),
      (2, 'bob', '鲍勃', 0),
      (3, 'carol', '卡罗尔', 1);

    INSERT INTO channels (id, name, kind) VALUES
      (1, 'general', 'public'),
      (2, 'secret', 'private'),
      (3, 'other', 'private');

    INSERT INTO channel_members (channel_id, user_id, role) VALUES
      (1, 1, 'member'),
      (1, 2, 'owner'),
      (2, 2, 'owner'),
      (3, 1, 'member'),
      (3, 2, 'owner');

    INSERT INTO messages (id, channel_id, sender_id, content) VALUES
      (101, 1, 2, '公开频道消息'),
      (102, 2, 2, '私密频道消息'),
      (103, 3, 1, '隔壁房间消息');
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

function createSessionStore() {
  const sessions = new Map();
  return {
    async get(key) {
      return sessions.get(key) || null;
    },
    async put(key, value) {
      sessions.set(key, value);
    },
    async delete(key) {
      sessions.delete(key);
    }
  };
}

function createRoom({ db, token, principal, room }) {
  const state = {
    getWebSockets() {
      return [];
    },
    acceptWebSocket() {},
    waitUntil() {}
  };
  const env = {
    SESSIONS: createSessionStore(),
    DB: db,
    FILES: null,
    ADMIN_USERNAMES: 'admin'
  };
  const roomInstance = new ChannelRoom(state, env);

  const socket = {
    sends: [],
    closed: null,
    send(msg) {
      this.sends.push(msg);
    },
    close(code, reason) {
      this.closed = { code, reason };
    },
    serializeAttachment() {}
  };

  env.SESSIONS.put(token, JSON.stringify({
    token,
    userId: principal.userId,
    username: principal.username || `user${principal.userId}`,
    isAdmin: principal.isAdmin || false,
    sessionVersion: 0
  }));

  roomInstance.connections.set(socket, {
    token,
    principal,
    room
  });

  return { room: roomInstance, socket, env };
}

function parseSends(socket) {
  return socket.sends.map((s) => {
    try {
      return JSON.parse(s);
    } catch {
      return null;
    }
  }).filter(Boolean);
}

test('pin_message 拒绝非群主成员置顶', async () => {
  const db = createTestDb();
  const { room, socket } = createRoom({
    db,
    token: 'sess_1',
    principal: { userId: 1, isAdmin: false },
    room: { id: 1, kind: 'public', name: 'general' }
  });

  await room.webSocketMessage(socket, JSON.stringify({ type: 'pin_message', messageId: 101 }));

  const errors = parseSends(socket).filter((p) => p.type === 'error');
  assert.equal(errors.length, 1);
  assert.equal(errors[0].error, '无权管理该会话');

  const row = await db.prepare('SELECT pinned_message_id FROM channels WHERE id = 1').first();
  assert.equal(row.pinned_message_id, null);
});

test('pin_message 群主可将本房间消息置顶', async () => {
  const db = createTestDb();
  const { room, socket } = createRoom({
    db,
    token: 'sess_2',
    principal: { userId: 2, isAdmin: false },
    room: { id: 1, kind: 'public', name: 'general' }
  });

  await room.webSocketMessage(socket, JSON.stringify({ type: 'pin_message', messageId: 101 }));

  const row = await db.prepare('SELECT pinned_message_id FROM channels WHERE id = 1').first();
  assert.equal(Number(row.pinned_message_id), 101);

  const packets = parseSends(socket);
  const pinned = packets.find((p) => p.type === 'room_pinned_message');
  assert.ok(pinned);
  assert.equal(pinned.pinnedMessage.id, 101);
  assert.equal(pinned.pinnedMessage.content, '公开频道消息');
});

test('pin_message 拒绝把其他房间的消息置顶到当前房间', async () => {
  const db = createTestDb();
  const { room, socket } = createRoom({
    db,
    token: 'sess_2',
    principal: { userId: 2, isAdmin: false },
    room: { id: 1, kind: 'public', name: 'general' }
  });

  await room.webSocketMessage(socket, JSON.stringify({ type: 'pin_message', messageId: 103 }));

  const errors = parseSends(socket).filter((p) => p.type === 'error');
  assert.equal(errors.length, 1);
  assert.equal(errors[0].error, '消息不存在或已被删除');

  const row = await db.prepare('SELECT pinned_message_id FROM channels WHERE id = 1').first();
  assert.equal(row.pinned_message_id, null);
});

test('toggle_reaction 拒绝给其他房间的消息加反应', async () => {
  const db = createTestDb();
  const { room, socket } = createRoom({
    db,
    token: 'sess_1',
    principal: { userId: 1, isAdmin: false },
    room: { id: 1, kind: 'public', name: 'general' }
  });

  await room.webSocketMessage(socket, JSON.stringify({ type: 'toggle_reaction', messageId: 103, reaction: '👍' }));

  const errors = parseSends(socket).filter((p) => p.type === 'error');
  assert.equal(errors.length, 1);
  assert.equal(errors[0].error, '消息不存在或已被删除');

  const rows = await db.prepare('SELECT id FROM message_reactions WHERE message_id = 103').all();
  assert.equal(rows.results.length, 0);
});

test('toggle_reaction 允许给本房间消息加反应', async () => {
  const db = createTestDb();
  const { room, socket } = createRoom({
    db,
    token: 'sess_1',
    principal: { userId: 1, isAdmin: false },
    room: { id: 1, kind: 'public', name: 'general' }
  });

  await room.webSocketMessage(socket, JSON.stringify({ type: 'toggle_reaction', messageId: 101, reaction: '👍' }));

  const errors = parseSends(socket).filter((p) => p.type === 'error');
  assert.equal(errors.length, 0);

  const rows = await db.prepare('SELECT id FROM message_reactions WHERE message_id = 101 AND user_id = 1').all();
  assert.equal(rows.results.length, 1);

  const packets = parseSends(socket);
  const reacted = packets.find((p) => p.type === 'message_reaction');
  assert.ok(reacted);
  assert.equal(reacted.messageId, 101);
});

test('toggle_reaction 拒绝超长反应文本', async () => {
  const db = createTestDb();
  const { room, socket } = createRoom({
    db,
    token: 'sess_1',
    principal: { userId: 1, isAdmin: false },
    room: { id: 1, kind: 'public', name: 'general' }
  });

  const longReaction = 'x'.repeat(64);
  await room.webSocketMessage(socket, JSON.stringify({ type: 'toggle_reaction', messageId: 101, reaction: longReaction }));

  const errors = parseSends(socket).filter((p) => p.type === 'error');
  assert.equal(errors.length, 1);
  assert.equal(errors[0].error, '表情长度超出限制');
});

test('call_signal 忽略客户端伪造的 admin 角色', async () => {
  const db = createTestDb();
  const { room, socket } = createRoom({
    db,
    token: 'sess_1',
    principal: { userId: 1, isAdmin: false },
    room: { id: 1, kind: 'public', name: 'general' }
  });

  const peer = {
    sends: [],
    send(msg) {
      this.sends.push(msg);
    },
    close() {},
    serializeAttachment() {}
  };
  room.connections.set(peer, {
    token: 'sess_1',
    principal: { userId: 1, isAdmin: false },
    room: { id: 1, kind: 'public', name: 'general' }
  });

  await room.webSocketMessage(socket, JSON.stringify({
    type: 'call_signal',
    action: 'signal',
    role: 'admin'
  }));

  const peerPackets = peer.sends.map((s) => JSON.parse(s)).filter((p) => p.type === 'call_signal');
  assert.equal(peerPackets.length, 1);
  assert.equal(peerPackets[0].senderId, 1);
  assert.equal(peerPackets[0].role, 'member');
});

test('call_signal 管理员角色由服务端派生', async () => {
  const db = createTestDb();
  const { room, socket } = createRoom({
    db,
    token: 'sess_3',
    principal: { userId: 3, isAdmin: true },
    room: { id: 1, kind: 'public', name: 'general' }
  });

  const peer = {
    sends: [],
    send(msg) {
      this.sends.push(msg);
    },
    close() {},
    serializeAttachment() {}
  };
  room.connections.set(peer, {
    token: 'sess_3',
    principal: { userId: 3, isAdmin: true },
    room: { id: 1, kind: 'public', name: 'general' }
  });

  await room.webSocketMessage(socket, JSON.stringify({
    type: 'call_signal',
    action: 'signal',
    role: 'member'
  }));

  const peerPackets = peer.sends.map((s) => JSON.parse(s)).filter((p) => p.type === 'call_signal');
  assert.equal(peerPackets[0].role, 'admin');
});

test('delete_message 普通用户可删除自己发送的消息', async () => {
  const db = createTestDb();
  const { room, socket } = createRoom({
    db,
    token: 'sess_1',
    principal: { userId: 1, isAdmin: false },
    room: { id: 3, kind: 'private', name: 'other' }
  });

  await room.webSocketMessage(socket, JSON.stringify({
    type: 'delete_message',
    messageId: 103
  }));

  const errors = parseSends(socket).filter((p) => p.type === 'error');
  assert.equal(errors.length, 0);

  const row = await db.prepare('SELECT deleted_at FROM messages WHERE id = 103').first();
  assert.ok(row.deleted_at);
});

test('delete_message 普通用户无权删除他人发送的消息', async () => {
  const db = createTestDb();
  const { room, socket } = createRoom({
    db,
    token: 'sess_1',
    principal: { userId: 1, isAdmin: false },
    room: { id: 1, kind: 'public', name: 'general' }
  });

  await room.webSocketMessage(socket, JSON.stringify({
    type: 'delete_message',
    messageId: 101
  }));

  const errors = parseSends(socket).filter((p) => p.type === 'error');
  assert.equal(errors.length, 1);
  assert.equal(errors[0].error, '无权删除该消息');

  const row = await db.prepare('SELECT deleted_at FROM messages WHERE id = 101').first();
  assert.equal(row.deleted_at, null);
});

test('delete_message 管理员可删除他人发送的消息', async () => {
  const db = createTestDb();
  const { room, socket } = createRoom({
    db,
    token: 'sess_3',
    principal: { userId: 3, isAdmin: true },
    room: { id: 1, kind: 'public', name: 'general' }
  });

  await room.webSocketMessage(socket, JSON.stringify({
    type: 'delete_message',
    messageId: 101
  }));

  const errors = parseSends(socket).filter((p) => p.type === 'error');
  assert.equal(errors.length, 0);

  const row = await db.prepare('SELECT deleted_at FROM messages WHERE id = 101').first();
  assert.ok(row.deleted_at);
});
