import assert from 'node:assert/strict';
import test from 'node:test';
import { Hono } from 'hono';
import { fileURLToPath } from 'node:url';
import initSqlJs from 'sql.js';
import { registerDmRoutes } from '../worker/src/api/dm.js';
import { ensureDmChannel } from '../worker/src/data/dm-provisioning.js';
import { listUserDms } from '../worker/src/data/dm-queries.js';
import { useChatSidebar } from '../frontend/src/composables/useChatSidebar.js';

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
      last_active_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      deleted_at TEXT
    );
    CREATE TABLE channels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL DEFAULT '',
      avatar_key TEXT,
      kind TEXT NOT NULL,
      dm_key TEXT UNIQUE,
      created_by INTEGER,
      pinned_message_id INTEGER DEFAULT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
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
    CREATE TABLE user_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      deleted_at TEXT
    );
    INSERT INTO users (id, username, display_name) VALUES
      (1, 'alice', 'Alice'),
      (2, 'bob', 'Bob'),
      (3, 'carol', 'Carol');
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
          const lastId = Number(db.exec('SELECT last_insert_rowid() AS id')[0]?.values[0]?.[0] || 1);
          return { success: true, meta: { changes: 1, last_row_id: lastId } };
        }
      };
    },
    async batch(stmts) {
      const results = [];
      for (const s of stmts) {
        results.push(await s.run());
      }
      return results;
    }
  };
}

test('DELETE /api/dm/:id 允许私聊双方删除私聊会话，拒绝非成员越权删除', async () => {
  const db = createTestDb();
  const created = await ensureDmChannel(db, 1, 2);
  const dmId = created.id;

  // 插入两条测试消息
  db.rawDb.exec(`
    INSERT INTO messages (id, channel_id, sender_id, content) VALUES
      (101, ${dmId}, 1, '第一条私聊'),
      (102, ${dmId}, 2, '第二条私聊');
  `);

  const app = new Hono();
  app.use('*', async (c, next) => {
    const uid = Number(c.req.header('x-user-id') || 1);
    c.set('session', { userId: uid, username: `user_${uid}`, isAdmin: false });
    await next();
  });
  registerDmRoutes(app);

  // 1. 第三方非成员用户 (Carol, id=3) 尝试删除，应被 403 拒绝
  const resForbidden = await app.request(`/api/dm/${dmId}`, {
    method: 'DELETE',
    headers: { 'x-user-id': '3' }
  }, { DB: db });
  assert.equal(resForbidden.status, 403);

  // 2. 私聊成员 Bob (id=2) 删除该会话，应成功 200 并清空消息
  const resDelete = await app.request(`/api/dm/${dmId}`, {
    method: 'DELETE',
    headers: { 'x-user-id': '2' }
  }, { DB: db });
  assert.equal(resDelete.status, 200);
  assert.deepEqual(await resDelete.json(), { ok: true });

  // 检查 messages 表中该频道的历史消息是否已被软删除
  const remainingMsgs = db.rawDb.exec(`SELECT id FROM messages WHERE channel_id = ${dmId} AND deleted_at IS NULL`)[0]?.values || [];
  assert.equal(remainingMsgs.length, 0, '旧消息必须被软删除清空');

  // 3. 双方的列表查询中不再显示该已删除的私聊
  const aliceDms = await listUserDms(db, 1);
  const bobDms = await listUserDms(db, 2);
  assert.equal(aliceDms.length, 0);
  assert.equal(bobDms.length, 0);

  // 4. 重复删除已删除会话返回 404
  const resNotFound = await app.request(`/api/dm/${dmId}`, {
    method: 'DELETE',
    headers: { 'x-user-id': '1' }
  }, { DB: db });
  assert.equal(resNotFound.status, 404);

  // 5. 若后续重新发起私聊，ensureDmChannel 恢复新会话且历史消息已清空
  const restored = await ensureDmChannel(db, 1, 2);
  assert.equal(restored.id, dmId);
  const restoredList = await listUserDms(db, 1);
  assert.equal(restoredList.length, 1);
  assert.equal(restoredList[0].id, dmId);
  const activeMsgs = db.rawDb.exec(`SELECT id FROM messages WHERE channel_id = ${dmId} AND deleted_at IS NULL`)[0]?.values || [];
  assert.equal(activeMsgs.length, 0, '新打开的会话不呈现历史被清空的消息');
});

test('useChatSidebar deleteDm 从本地响应式列表与置顶集合中移除会话', async () => {
  const calls = [];
  const mockApi = {
    async deleteDm(id) {
      calls.push(['deleteDm', id]);
    }
  };
  const sidebar = useChatSidebar({
    applyActiveChannel() {},
    selectDm() {},
    sidebarApi: mockApi
  });

  sidebar.dms.value = [
    { id: 10, otherUser: { displayName: 'Alice' } },
    { id: 20, otherUser: { displayName: 'Bob' } }
  ];
  sidebar.pinnedKeys.value.add('dm:10');

  await sidebar.deleteDm(10);
  assert.deepEqual(calls, [['deleteDm', 10]]);
  assert.equal(sidebar.dms.value.length, 1);
  assert.equal(sidebar.dms.value[0].id, 20);
  assert.equal(sidebar.pinnedKeys.value.has('dm:10'), false);
});
