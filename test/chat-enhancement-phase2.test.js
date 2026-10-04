import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import initSqlJs from 'sql.js';
import {
  toggleMessageReaction,
  getReactionsForMessages,
  setChannelPinnedMessage,
} from '../worker/src/data/reactions.js';

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
      password_hash TEXT NOT NULL DEFAULT '',
      password_salt TEXT NOT NULL DEFAULT '',
      deleted_at TEXT
    );

    CREATE TABLE channels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      pinned_message_id INTEGER,
      deleted_at TEXT
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

    INSERT INTO users (id, username, display_name)
    VALUES (1, 'alice', '爱丽丝'),
           (2, 'bob', '鲍勃');

    INSERT INTO channels (id, name, kind)
    VALUES (1, 'general', 'public');

    INSERT INTO messages (id, channel_id, sender_id, content)
    VALUES (101, 1, 1, '欢迎来到 EdgeChat 开发者群！'),
           (102, 1, 2, '大家讨论一下第二阶段计划。');
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
          return { success: true };
        }
      };
    }
  };
}

test('toggleMessageReaction toggles emoji reaction on and off for a message', async () => {
  const db = createMockDb();

  // 1. User 1 reacts with 👍
  const r1 = await toggleMessageReaction(db, { messageId: 101, userId: 1, reaction: '👍' });
  assert.equal(r1.action, 'added');
  assert.equal(r1.reaction, '👍');

  // 2. User 2 also reacts with 👍 and ❤️
  await toggleMessageReaction(db, { messageId: 101, userId: 2, reaction: '👍' });
  await toggleMessageReaction(db, { messageId: 101, userId: 2, reaction: '❤️' });

  // 3. Query aggregated reactions for message 101 from perspective of User 1
  const map1 = await getReactionsForMessages(db, [101, 102], 1);
  assert.ok(map1[101]);
  const thumbsUp = map1[101].find(r => r.reaction === '👍');
  const heart = map1[101].find(r => r.reaction === '❤️');

  assert.equal(thumbsUp.count, 2);
  assert.equal(thumbsUp.reactedByMe, true);
  assert.deepEqual(thumbsUp.userNames, ['爱丽丝', '鲍勃']);

  assert.equal(heart.count, 1);
  assert.equal(heart.reactedByMe, false);
  assert.deepEqual(heart.userNames, ['鲍勃']);

  // 4. User 1 toggles 👍 again -> removed
  const r2 = await toggleMessageReaction(db, { messageId: 101, userId: 1, reaction: '👍' });
  assert.equal(r2.action, 'removed');

  const map2 = await getReactionsForMessages(db, [101], 1);
  const thumbsUpAfter = map2[101].find(r => r.reaction === '👍');
  assert.equal(thumbsUpAfter.count, 1);
  assert.equal(thumbsUpAfter.reactedByMe, false);
});

test('setChannelPinnedMessage updates pinned message and retrieves it', async () => {
  const db = createMockDb();

  // Pin message 101
  await setChannelPinnedMessage(db, 1, 101);

  const row = await db.prepare('SELECT pinned_message_id FROM channels WHERE id = 1').first();
  assert.equal(Number(row.pinned_message_id), 101);

  // Unpin message
  await setChannelPinnedMessage(db, 1, null);
  const rowUnpinned = await db.prepare('SELECT pinned_message_id FROM channels WHERE id = 1').first();
  assert.equal(rowUnpinned.pinned_message_id, null);
});

test('public channel message search filters messages with LIKE condition', async () => {
  const db = createMockDb();

  const { results } = await db.prepare(`
    SELECT m.id, m.content, u.display_name AS sender_name
    FROM messages m
    LEFT JOIN users u ON u.id = m.sender_id
    WHERE m.channel_id = 1 AND m.deleted_at IS NULL AND m.content LIKE ?
    ORDER BY m.id DESC
  `).bind('%第二阶段%').all();

  assert.equal(results.length, 1);
  assert.equal(results[0].id, 102);
  assert.equal(results[0].sender_name, '鲍勃');
});
