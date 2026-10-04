import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import initSqlJs from 'sql.js';
import { Hono } from 'hono';
import { registerChannelRoutes } from '../worker/src/api/channels.js';
import { registerAdminRoutes } from '../worker/src/api/admin.js';
import { hardDeleteChannel, softDeleteChannelWithRename } from '../worker/src/data/channel-deletion.js';
import { hardDeleteMessage, softDeleteMessage } from '../worker/src/data/messages.js';
import { deleteRoomMessage } from '../worker/src/message-deletion.js';
import { runScheduledGc, getGcConfig } from '../worker/src/gc.js';
import { getSiteSettings, updateSiteSettings } from '../worker/src/data/site-settings.js';

const SQL = await initSqlJs({
  locateFile(file) {
    return fileURLToPath(new URL(`../node_modules/sql.js/dist/${file}`, import.meta.url));
  }
});

function createMockD1() {
  const db = new SQL.Database();
  db.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      is_disabled INTEGER NOT NULL DEFAULT 0,
      disabled_until TEXT,
      is_admin INTEGER NOT NULL DEFAULT 0,
      session_version INTEGER NOT NULL DEFAULT 0,
      avatar_key TEXT,
      deleted_at TEXT
    );

    CREATE TABLE channels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL DEFAULT '',
      avatar_key TEXT,
      kind TEXT NOT NULL CHECK (kind IN ('public', 'private', 'dm')),
      dm_key TEXT UNIQUE,
      created_by INTEGER,
      pinned_message_id INTEGER DEFAULT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      deleted_at TEXT,
      FOREIGN KEY (created_by) REFERENCES users(id)
    );

    CREATE TABLE channel_members (
      channel_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
      invited_by INTEGER,
      joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (channel_id, user_id),
      FOREIGN KEY (channel_id) REFERENCES channels(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
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
      sender_kind TEXT NOT NULL DEFAULT 'local' CHECK (sender_kind IN ('local', 'external')),
      external_sender_id TEXT,
      external_sender_name TEXT,
      external_sender_avatar_url TEXT,
      source TEXT NOT NULL DEFAULT 'edgechat',
      source_message_id TEXT,
      source_attachment_id TEXT,
      source_attachment_unique_id TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      edited_at TEXT,
      deleted_at TEXT,
      FOREIGN KEY (channel_id) REFERENCES channels(id),
      FOREIGN KEY (sender_id) REFERENCES users(id)
    );

    CREATE TABLE message_reads (
      channel_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      last_read_message_id INTEGER NOT NULL,
      read_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (channel_id, user_id)
    );

    CREATE TABLE message_reactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      reaction TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(message_id, user_id, reaction)
    );

    CREATE TABLE site_settings (
      setting_key TEXT PRIMARY KEY,
      setting_value TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE registration_invites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token TEXT NOT NULL UNIQUE,
      created_by INTEGER,
      consumed_by_user_id INTEGER,
      consumed_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      deleted_at TEXT
    );

    CREATE TABLE pending_r2_delete (
      object_key TEXT PRIMARY KEY,
      retry_count INTEGER NOT NULL DEFAULT 0,
      next_retry_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_error TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE drive_files (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      is_folder INTEGER NOT NULL DEFAULT 0,
      size INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      deleted_at TEXT
    );

    INSERT INTO users (id, username, display_name, is_admin)
    VALUES (1, 'alice', 'Alice', 1),
           (2, 'bob', 'Bob', 0);

    INSERT INTO channels (id, name, kind, created_by)
    VALUES (1, 'general', 'public', 1);

    INSERT INTO channel_members (channel_id, user_id, role)
    VALUES (1, 1, 'owner'), (1, 2, 'member');
  `);

  return {
    rawDb: db,
    batch(statements) {
      return Promise.all(statements.map(s => s.run()));
    },
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
          const changes = db.getRowsModified();
          const lastId = db.exec('SELECT last_insert_rowid() AS id')[0]?.values[0]?.[0] || 0;
          return { success: true, meta: { changes, last_row_id: lastId } };
        }
      };
    }
  };
}

function createMockFiles() {
  const files = new Set();
  return {
    files,
    async delete(key) {
      files.delete(key);
      return true;
    },
    async put(key) {
      files.add(key);
    },
    has(key) {
      return files.has(key);
    }
  };
}

test('site_settings 正确读取与保存 deletionPolicy 策略', async () => {
  const d1 = createMockD1();

  // 1. 默认值应为 daily_reset_purge
  let settings = await getSiteSettings(d1);
  assert.equal(settings.deletionPolicy, 'daily_reset_purge');

  // 2. 更新为 immediate_purge
  await updateSiteSettings(d1, { deletionPolicy: 'immediate_purge' });
  settings = await getSiteSettings(d1);
  assert.equal(settings.deletionPolicy, 'immediate_purge');

  // 3. 更新回 daily_reset_purge
  await updateSiteSettings(d1, { deletionPolicy: 'daily_reset_purge' });
  settings = await getSiteSettings(d1);
  assert.equal(settings.deletionPolicy, 'daily_reset_purge');
});

test('PATCH /api/admin/site-settings 校验 deletionPolicy 参数', async () => {
  const d1 = createMockD1();
  const app = new Hono();

  app.use('*', async (c, next) => {
    c.env = { DB: d1 };
    c.set('session', { userId: 1, username: 'alice', isAdmin: true });
    await next();
  });

  registerAdminRoutes(app);

  // 1. 无效策略报错
  const invalidRes = await app.request('/api/admin/site-settings', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deletionPolicy: 'invalid_policy' })
  });
  assert.equal(invalidRes.status, 400);
  const invalidData = await invalidRes.json();
  assert.match(invalidData.error, /删除策略无效/);

  // 2. 有效更新为 immediate_purge
  const validRes = await app.request('/api/admin/site-settings', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deletionPolicy: 'immediate_purge' })
  });
  assert.equal(validRes.status, 200);
  const validData = await validRes.json();
  assert.equal(validData.site.deletionPolicy, 'immediate_purge');
});

test('daily_reset_purge 策略下：群组软删除并立即释放重名，23:55 GC 统一物理粉碎', async () => {
  const d1 = createMockD1();
  const mockFiles = createMockFiles();
  const env = { DB: d1, FILES: mockFiles };
  const app = new Hono();

  app.use('*', async (c, next) => {
    c.env = env;
    c.set('session', { userId: 1, username: 'alice', isAdmin: true });
    await next();
  });

  registerChannelRoutes(app);

  // 确保策略为 daily_reset_purge
  await updateSiteSettings(d1, { deletionPolicy: 'daily_reset_purge' });

  // 1. 创建群组 "技术交流"
  const createRes = await app.request('/api/channels', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: '技术交流', kind: 'public' })
  });
  assert.equal(createRes.status, 200);
  const { channel } = await createRes.json();
  const channelId = channel.id;

  // 添加消息与附件
  mockFiles.files.add('att_msg_1.png');
  mockFiles.files.add('avatar_chan_1.png');
  d1.rawDb.exec(`
    UPDATE channels SET avatar_key = 'avatar_chan_1.png' WHERE id = ${channelId};
    INSERT INTO messages (channel_id, sender_id, content, attachment_key)
    VALUES (${channelId}, 1, 'hello', 'att_msg_1.png');
    INSERT INTO message_reads (channel_id, user_id, last_read_message_id)
    VALUES (${channelId}, 1, 1);
  `);

  // 2. 用户删除群组：应为软删除并改名
  const delRes = await app.request(`/api/channels/${channelId}`, { method: 'DELETE' });
  assert.equal(delRes.status, 200);

  // 验证 channels 表记录仍存在但已打上 deleted_at，且名称已被重命名为 deleted_*
  const chanRow = d1.rawDb.prepare('SELECT name, deleted_at FROM channels WHERE id = ?').getAsObject([channelId]);
  assert.ok(chanRow.deleted_at);
  assert.match(chanRow.name, /^deleted_/);

  // 3. 原名称 "技术交流" 可立即被重新创建
  const reCreateRes = await app.request('/api/channels', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: '技术交流', kind: 'public' })
  });
  assert.equal(reCreateRes.status, 200);
  const reCreated = await reCreateRes.json();
  assert.equal(reCreated.channel.name, '技术交流');
  assert.notEqual(reCreated.channel.id, channelId);

  // 4. 模拟 23:55 GC 执行：应彻底物理粉碎软删除的旧群及消息，并清理 R2
  const gcSummary = await runScheduledGc(env);
  assert.ok(gcSummary.channelsDeleted >= 1);
  assert.ok(gcSummary.channelMessagesDeleted >= 1);

  // 验证原 channelId 彻底从 channels/messages/members/reads 表消失
  assert.equal(d1.rawDb.exec(`SELECT id FROM channels WHERE id = ${channelId}`).length, 0);
  assert.equal(d1.rawDb.exec(`SELECT id FROM messages WHERE channel_id = ${channelId}`).length, 0);
  assert.equal(d1.rawDb.exec(`SELECT channel_id FROM message_reads WHERE channel_id = ${channelId}`).length, 0);

  // 验证 R2 附件已被清理
  assert.equal(mockFiles.has('att_msg_1.png'), false);
  assert.equal(mockFiles.has('avatar_chan_1.png'), false);
});

test('immediate_purge 策略下：群组删除时立即级联硬删除所有关联与附件', async () => {
  const d1 = createMockD1();
  const mockFiles = createMockFiles();
  const env = { DB: d1, FILES: mockFiles };
  const app = new Hono();

  app.use('*', async (c, next) => {
    c.env = env;
    c.set('session', { userId: 1, username: 'alice', isAdmin: true });
    await next();
  });

  registerChannelRoutes(app);

  // 开启 immediate_purge
  await updateSiteSettings(d1, { deletionPolicy: 'immediate_purge' });

  // 1. 创建群组 "隐私安全群"
  const createRes = await app.request('/api/channels', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: '隐私安全群', kind: 'public' })
  });
  assert.equal(createRes.status, 200);
  const { channel } = await createRes.json();
  const channelId = channel.id;

  mockFiles.files.add('secret_att.pdf');
  d1.rawDb.exec(`
    INSERT INTO messages (channel_id, sender_id, content, attachment_key)
    VALUES (${channelId}, 1, '机密文件', 'secret_att.pdf');
    INSERT INTO message_reads (channel_id, user_id, last_read_message_id)
    VALUES (${channelId}, 1, 1);
  `);

  // 2. 删除群组：应直接硬删除
  const delRes = await app.request(`/api/channels/${channelId}`, { method: 'DELETE' });
  assert.equal(delRes.status, 200);

  // channels 记录立即不复存在
  assert.equal(d1.rawDb.exec(`SELECT id FROM channels WHERE id = ${channelId}`).length, 0);
  assert.equal(d1.rawDb.exec(`SELECT id FROM messages WHERE channel_id = ${channelId}`).length, 0);

  // 待清理表已记录该附件
  const pendingRows = d1.rawDb.exec("SELECT object_key FROM pending_r2_delete WHERE object_key = 'secret_att.pdf'");
  assert.equal(pendingRows.length, 1);
  assert.equal(pendingRows[0].values[0][0], 'secret_att.pdf');
});

test('消息删除：daily_reset_purge 软删除 + GC 彻底粉碎；immediate_purge 立即硬删除', async () => {
  const d1 = createMockD1();
  const mockFiles = createMockFiles();
  const env = { DB: d1, FILES: mockFiles };

  // 1. 创建测试群与消息
  d1.rawDb.exec(`
    INSERT INTO channels (id, name, kind, created_by) VALUES (10, '聊天室', 'public', 1);
    INSERT INTO channel_members (channel_id, user_id, role) VALUES (10, 1, 'owner');
    INSERT INTO messages (id, channel_id, sender_id, content, attachment_key)
    VALUES (101, 10, 1, '测试消息1', 'file_101.jpg'),
           (102, 10, 1, '测试消息2', 'file_102.jpg');
    INSERT INTO message_reactions (message_id, user_id, reaction)
    VALUES (101, 1, '👍'), (102, 1, '❤️');
  `);
  mockFiles.files.add('file_101.jpg');
  mockFiles.files.add('file_102.jpg');

  // 2. 默认策略：daily_reset_purge
  const meta = {
    principal: { userId: 1, isAdmin: false },
    room: { kind: 'public', id: 10 }
  };

  const res1 = await deleteRoomMessage(env, meta, { messageId: 101 });
  assert.equal(res1.messageId, 101);

  // 检查消息仍然存在，但 deleted_at IS NOT NULL
  const deletedAt = d1.rawDb.exec('SELECT deleted_at FROM messages WHERE id = 101')[0]?.values[0]?.[0];
  assert.ok(deletedAt);

  // 3. 切换策略为 immediate_purge 并删除 102
  await updateSiteSettings(d1, { deletionPolicy: 'immediate_purge' });
  const res2 = await deleteRoomMessage(env, meta, { messageId: 102 });
  assert.equal(res2.messageId, 102);

  // 检查 102 已经被彻底物理删除
  assert.equal(d1.rawDb.exec('SELECT id FROM messages WHERE id = 102').length, 0);
  // 表情也被删除
  assert.equal(d1.rawDb.exec('SELECT id FROM message_reactions WHERE message_id = 102').length, 0);

  // 4. 执行 GC：软删除的消息 101 也应被彻底粉碎
  const gcSummary = await runScheduledGc(env);
  assert.ok(gcSummary.softDeletedMessagesDeleted >= 1);

  assert.equal(d1.rawDb.exec('SELECT id FROM messages WHERE id = 101').length, 0);
});

test('云盘回收站 (drive_files) 完全不受聊天删除策略与 GC 影响', async () => {
  const d1 = createMockD1();
  const mockFiles = createMockFiles();
  const env = { DB: d1, FILES: mockFiles };

  // 插入云盘回收站中的文件
  d1.rawDb.exec(`
    INSERT INTO drive_files (id, user_id, name, deleted_at)
    VALUES ('df_trash_1', 1, 'important_doc.pdf', '2026-09-01 12:00:00');
  `);

  // 执行 GC
  await runScheduledGc(env);

  // 检查云盘回收站文件依然完好无损，等待用户在云盘回收站中手动还原或彻底清除
  const driveFile = d1.rawDb.prepare('SELECT id, name, deleted_at FROM drive_files WHERE id = ?').getAsObject(['df_trash_1']);
  assert.equal(driveFile.id, 'df_trash_1');
  assert.equal(driveFile.name, 'important_doc.pdf');
  assert.ok(driveFile.deleted_at);
});
