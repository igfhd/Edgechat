import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import initSqlJs from 'sql.js';
import { Hono } from 'hono';
import { registerChannelRoutes } from '../worker/src/api/channels.js';
import { registerDriveRoutes } from '../worker/src/api/drive.js';

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

    CREATE TABLE site_settings (
      setting_key TEXT PRIMARY KEY,
      setting_value TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE drive_files (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      parent_id TEXT,
      name TEXT NOT NULL,
      is_folder INTEGER NOT NULL DEFAULT 0,
      size INTEGER NOT NULL DEFAULT 0,
      mime_type TEXT,
      hash TEXT,
      storage_key TEXT,
      backend TEXT NOT NULL DEFAULT 'r2',
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      deleted_at TEXT
    );

    CREATE TABLE drive_shares (
      id TEXT PRIMARY KEY,
      file_id TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      permission TEXT NOT NULL DEFAULT 'view',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE drive_member_shares (
      id TEXT PRIMARY KEY,
      file_id TEXT NOT NULL,
      owner_id INTEGER NOT NULL,
      target_type TEXT NOT NULL DEFAULT 'room',
      target_id INTEGER NOT NULL,
      permission TEXT NOT NULL DEFAULT 'read',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
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
          const lastId = db.exec('SELECT last_insert_rowid() AS id')[0]?.values[0]?.[0] || 0;
          return { success: true, meta: { last_row_id: lastId } };
        }
      };
    }
  };
}

test('删除群聊后可再次创建同名群聊，且历史同名软删除群组也能正常解绑', async () => {
  const d1 = createMockD1();
  const app = new Hono();

  app.use('*', async (c, next) => {
    c.env = { DB: d1 };
    c.set('session', { userId: 1, username: 'alice', isAdmin: true });
    await next();
  });

  registerChannelRoutes(app);

  // 1. 创建群聊 "测试技术群"
  const createRes1 = await app.request('/api/channels', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: '测试技术群', kind: 'public' })
  });
  assert.equal(createRes1.status, 200);
  const data1 = await createRes1.json();
  assert.equal(data1.channel.name, '测试技术群');
  const channelId = data1.channel.id;

  // 2. 在活跃状态下再次创建同名群聊应失败
  const createDupRes = await app.request('/api/channels', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: '测试技术群', kind: 'public' })
  });
  assert.equal(createDupRes.status, 400);
  const dupData = await createDupRes.json();
  assert.equal(dupData.error, '群组名称已存在');

  // 3. 在聊天管理中删除该群聊
  const deleteRes = await app.request(`/api/channels/${channelId}`, {
    method: 'DELETE'
  });
  assert.equal(deleteRes.status, 200);

  // 4. 删除后再次创建同名群聊 "测试技术群" 应该成功！
  const createRes2 = await app.request('/api/channels', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: '测试技术群', kind: 'public' })
  });
  assert.equal(createRes2.status, 200);
  const data2 = await createRes2.json();
  assert.equal(data2.channel.name, '测试技术群');
  assert.notEqual(data2.channel.id, channelId);

  // 5. 管理员后台删除
  const adminDeleteRes = await app.request(`/api/admin/channels/${data2.channel.id}`, {
    method: 'DELETE'
  });
  assert.equal(adminDeleteRes.status, 200);

  // 6. 管理员删除后第三次创建同名群聊也应该成功
  const createRes3 = await app.request('/api/channels', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: '测试技术群', kind: 'public' })
  });
  assert.equal(createRes3.status, 200);
  const data3 = await createRes3.json();
  assert.equal(data3.channel.name, '测试技术群');

  // 7. 测试历史遗留软删除（未改名）记录在创建新群时能自动释放
  d1.rawDb.exec(`
    INSERT INTO channels (name, kind, created_by, deleted_at)
    VALUES ('历史旧群', 'public', 1, '2026-08-01 10:00:00')
  `);
  const createLegacyRes = await app.request('/api/channels', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: '历史旧群', kind: 'public' })
  });
  assert.equal(createLegacyRes.status, 200);
  const dataLegacy = await createLegacyRes.json();
  assert.equal(dataLegacy.channel.name, '历史旧群');
});

test('云盘 upload-ticket 在第三方 R2/S3 配置下返回 directWorkerUpload: true 并支持直传', async () => {
  const d1 = createMockD1();
  const app = new Hono();

  // 配置 S3 存储凭据
  d1.rawDb.exec(`
    INSERT INTO site_settings (setting_key, setting_value)
    VALUES ('storage_type', 'r2'),
           ('storage_access_key_id', 'mockAccessKey'),
           ('storage_secret_access_key', 'mockSecretKey'),
           ('storage_account_id', 'mockAccount123'),
           ('storage_bucket_name', 'my-bucket');
  `);

  app.use('*', async (c, next) => {
    c.env = { DB: d1 };
    c.set('session', { userId: 1, username: 'alice', isAdmin: true });
    await next();
  });

  registerDriveRoutes(app);

  const ticketRes = await app.request('/api/drive/files/upload-ticket', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'test-document.pdf',
      size: 1024 * 100,
      mimeType: 'application/pdf'
    })
  });

  assert.equal(ticketRes.status, 200);
  const ticket = await ticketRes.json();
  assert.equal(ticket.directWorkerUpload, true);
  assert.match(ticket.uploadUrl, /\/api\/drive\/files\/direct-upload/);
});

test('云盘 upload-ticket 在 Google Drive 配置下也统一返回 directWorkerUpload: true 走同源中转', async () => {
  const d1 = createMockD1();
  const app = new Hono();

  d1.rawDb.exec(`
    INSERT INTO site_settings (setting_key, setting_value)
    VALUES ('storage_type', 'gdrive'),
           ('gdrive_client_id', 'mockClientId'),
           ('gdrive_client_secret', 'mockClientSecret'),
           ('gdrive_refresh_token', 'mockRefreshToken'),
           ('gdrive_folder_id', 'mockFolderId');
  `);

  app.use('*', async (c, next) => {
    c.env = { DB: d1 };
    c.set('session', { userId: 1, username: 'alice', isAdmin: true });
    await next();
  });

  registerDriveRoutes(app);

  const ticketRes = await app.request('/api/drive/files/upload-ticket', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'gdrive-test.png',
      size: 1024 * 50,
      mimeType: 'image/png'
    })
  });

  assert.equal(ticketRes.status, 200);
  const ticket = await ticketRes.json();
  assert.equal(ticket.directWorkerUpload, true);
  assert.equal(ticket.backend, 'gdrive');
  assert.match(ticket.uploadUrl, /\/api\/drive\/files\/direct-upload/);
});

test('pickAttachment 正确放行 gdrive: 前缀附件，避免发送消息时被校验拦截并一直转圈', async () => {
  const { pickAttachment } = await import('../worker/src/utils.js');
  const attachment = {
    key: 'gdrive:1AbCdEfGh12345',
    name: 'test.pdf',
    type: 'application/pdf',
    size: 10240
  };
  const picked = pickAttachment(attachment, { ownerUserId: 42 });
  assert.ok(picked);
  assert.equal(picked.key, 'gdrive:1AbCdEfGh12345');
  assert.equal(picked.name, 'test.pdf');
});
