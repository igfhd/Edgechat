import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import initSqlJs from 'sql.js';
import { Hono } from 'hono';
import {
  resolveFileAccess,
  registerDriveRoutes
} from '../worker/src/api/drive.js';

const SQL = await initSqlJs({
  locateFile(file) {
    return fileURLToPath(new URL(`../node_modules/sql.js/dist/${file}`, import.meta.url));
  }
});

function createMockD1Database() {
  const db = new SQL.Database();
  db.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      avatar_key TEXT,
      is_disabled INTEGER NOT NULL DEFAULT 0,
      disabled_until TEXT,
      is_admin INTEGER NOT NULL DEFAULT 0,
      session_version INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      deleted_at TEXT
    );

    CREATE TABLE channels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'public',
      deleted_at TEXT
    );

    CREATE TABLE channel_members (
      channel_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      PRIMARY KEY (channel_id, user_id)
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
      deleted_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (parent_id) REFERENCES drive_files(id) ON DELETE CASCADE
    );

    CREATE TABLE drive_member_shares (
      id TEXT PRIMARY KEY,
      file_id TEXT NOT NULL,
      owner_id INTEGER NOT NULL,
      target_type TEXT NOT NULL DEFAULT 'user',
      target_id INTEGER NOT NULL,
      permission TEXT NOT NULL DEFAULT 'read',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (file_id) REFERENCES drive_files(id) ON DELETE CASCADE,
      FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  return {
    prepare(sql) {
      const createHandler = (params = []) => ({
        async first() {
          const stmt = db.prepare(sql);
          stmt.bind(params);
          if (stmt.step()) {
            const row = stmt.getAsObject();
            stmt.free();
            return row;
          }
          stmt.free();
          return null;
        },
        async all() {
          const stmt = db.prepare(sql);
          stmt.bind(params);
          const results = [];
          while (stmt.step()) {
            results.push(stmt.getAsObject());
          }
          stmt.free();
          return { results };
        },
        async run() {
          const stmt = db.prepare(sql);
          stmt.bind(params);
          stmt.step();
          stmt.free();
          return { success: true };
        }
      });

      return {
        bind(...params) {
          return createHandler(params);
        },
        async first() {
          return createHandler([]).first();
        },
        async all() {
          return createHandler([]).all();
        },
        async run() {
          return createHandler([]).run();
        }
      };
    },
    rawDb: db,
    async batch(stmts) {
      const results = [];
      for (const s of stmts) {
        results.push(await s.run());
      }
      return results;
    }
  };
}

test('drive-member-sharing: 所有者自动拥有 owner 权限', async () => {
  const db = createMockD1Database();
  db.rawDb.exec(`
    INSERT INTO users (id, username, display_name, password_hash, password_salt) VALUES (1, 'alice', 'Alice', 'h', 's');
    INSERT INTO drive_files (id, user_id, parent_id, name, is_folder, size, status) VALUES ('f1', 1, NULL, 'Secret.pdf', 0, 1024, 'active');
  `);

  const access = await resolveFileAccess(db, 'f1', 1);
  assert.equal(access.hasAccess, true);
  assert.equal(access.permission, 'owner');
  assert.equal(access.ownerId, 1);
});

test('drive-member-sharing: 针对单人用户的站内直接授权鉴权成功', async () => {
  const db = createMockD1Database();
  db.rawDb.exec(`
    INSERT INTO users (id, username, display_name, password_hash, password_salt) VALUES (1, 'alice', 'Alice', 'h', 's'), (2, 'bob', 'Bob', 'h', 's');
    INSERT INTO drive_files (id, user_id, parent_id, name, is_folder, size, status) VALUES ('f1', 1, NULL, 'ProjectDocs', 1, 0, 'active');
    INSERT INTO drive_member_shares (id, file_id, owner_id, target_type, target_id, permission) VALUES ('ms1', 'f1', 1, 'user', 2, 'write');
  `);

  const access = await resolveFileAccess(db, 'f1', 2);
  assert.equal(access.hasAccess, true);
  assert.equal(access.permission, 'write');
  assert.equal(access.ownerId, 1);
});

test('drive-member-sharing: 子文件与子目录层级递归继承父文件夹授权', async () => {
  const db = createMockD1Database();
  db.rawDb.exec(`
    INSERT INTO users (id, username, display_name, password_hash, password_salt) VALUES (1, 'alice', 'Alice', 'h', 's'), (2, 'bob', 'Bob', 'h', 's');
    INSERT INTO drive_files (id, user_id, parent_id, name, is_folder, status) VALUES ('folder_root', 1, NULL, 'RootDir', 1, 'active');
    INSERT INTO drive_files (id, user_id, parent_id, name, is_folder, status) VALUES ('folder_sub', 1, 'folder_root', 'SubDir', 1, 'active');
    INSERT INTO drive_files (id, user_id, parent_id, name, is_folder, size, status) VALUES ('file_leaf', 1, 'folder_sub', 'Doc.pdf', 0, 5000, 'active');

    INSERT INTO drive_member_shares (id, file_id, owner_id, target_type, target_id, permission) VALUES ('ms1', 'folder_root', 1, 'user', 2, 'write');
  `);

  const access = await resolveFileAccess(db, 'file_leaf', 2);
  assert.equal(access.hasAccess, true);
  assert.equal(access.permission, 'write');
  assert.equal(access.ownerId, 1);
  assert.equal(access.sharedRootId, 'folder_root');
});

test('drive-member-sharing: 刚创建的 pending 状态文件也能正确解析并继承父共享文件夹的权限', async () => {
  const db = createMockD1Database();
  db.rawDb.exec(`
    INSERT INTO users (id, username, display_name, password_hash, password_salt) VALUES (1, 'alice', 'Alice', 'h', 's'), (2, 'bob', 'Bob', 'h', 's');
    INSERT INTO drive_files (id, user_id, parent_id, name, is_folder, status) VALUES ('folder_shared', 1, NULL, 'SharedFolder', 1, 'active');
    INSERT INTO drive_member_shares (id, file_id, owner_id, target_type, target_id, permission) VALUES ('ms1', 'folder_shared', 1, 'user', 2, 'admin');

    -- Bob 上传新文件，初始化状态为 pending
    INSERT INTO drive_files (id, user_id, parent_id, name, is_folder, size, status) VALUES ('file_pending', 1, 'folder_shared', 'UploadedByBob.txt', 0, 1024, 'pending');
  `);

  const access = await resolveFileAccess(db, 'file_pending', 2);
  assert.equal(access.hasAccess, true);
  assert.equal(access.permission, 'admin');
  assert.equal(access.ownerId, 1);
  assert.equal(access.sharedRootId, 'folder_shared');
});

test('drive-member-sharing: 通过群组 room 共享自动覆盖群内成员', async () => {
  const db = createMockD1Database();
  db.rawDb.exec(`
    INSERT INTO users (id, username, display_name, password_hash, password_salt) VALUES (1, 'alice', 'Alice', 'h', 's'), (2, 'bob', 'Bob', 'h', 's'), (3, 'carol', 'Carol', 'h', 's');
    INSERT INTO channels (id, name, kind) VALUES (10, 'Dev Team', 'group');
    INSERT INTO channel_members (channel_id, user_id, role) VALUES (10, 2, 'member');

    INSERT INTO drive_files (id, user_id, parent_id, name, is_folder, status) VALUES ('team_folder', 1, NULL, 'TeamShare', 1, 'active');
    INSERT INTO drive_member_shares (id, file_id, owner_id, target_type, target_id, permission) VALUES ('ms_team', 'team_folder', 1, 'room', 10, 'read');
  `);

  // Bob is in channel 10 -> hasAccess = true
  const bobAccess = await resolveFileAccess(db, 'team_folder', 2);
  assert.equal(bobAccess.hasAccess, true);
  assert.equal(bobAccess.permission, 'read');

  // Carol is NOT in channel 10 -> hasAccess = false
  const carolAccess = await resolveFileAccess(db, 'team_folder', 3);
  assert.equal(carolAccess.hasAccess, false);
});

test('drive-member-sharing: 候选成员与群聊查询能正确过滤禁用与已删除用户并解析头像路径', async () => {
  const db = createMockD1Database();
  db.rawDb.exec(`
    INSERT INTO users (id, username, display_name, password_hash, password_salt, avatar_key, is_disabled, deleted_at)
    VALUES
      (1, 'alice', 'Alice', 'h', 's', 'avatars/alice.png', 0, NULL),
      (2, 'bob', 'Bob', 'h', 's', 'avatars/bob.png', 0, NULL),
      (3, 'disabled_user', 'Disabled', 'h', 's', NULL, 1, NULL),
      (4, 'deleted_user', 'Deleted', 'h', 's', NULL, 0, '2026-08-01 00:00:00');

    INSERT INTO channels (id, name, kind, deleted_at)
    VALUES
      (10, 'General', 'public', NULL),
      (11, 'Secret Project', 'private', NULL),
      (12, 'Deleted Room', 'public', '2026-08-01 00:00:00');

    INSERT INTO channel_members (channel_id, user_id, role)
    VALUES
      (10, 1, 'member'),
      (11, 1, 'member'),
      (12, 1, 'member');
  `);

  const usersRes = await db.prepare(
    `SELECT id, username, display_name, avatar_key
     FROM users
     WHERE id != ? AND is_disabled = 0 AND deleted_at IS NULL
     ORDER BY display_name ASC`
  ).bind(1).all();

  const users = (usersRes.results || []).map(u => ({
    id: u.id,
    username: u.username,
    display_name: u.display_name,
    avatar_url: u.avatar_key ? `/files/${encodeURIComponent(u.avatar_key)}` : ''
  }));

  const roomsRes = await db.prepare(
    `SELECT c.id, c.name, c.kind FROM channels c
     JOIN channel_members m ON c.id = m.channel_id
     WHERE m.user_id = ? AND c.kind IN ('public', 'private') AND c.deleted_at IS NULL
     ORDER BY c.name ASC`
  ).bind(1).all();

  assert.equal(users.length, 1);
  assert.equal(users[0].username, 'bob');
  assert.equal(users[0].avatar_url, '/files/avatars%2Fbob.png');

  assert.equal(roomsRes.results.length, 2);
  assert.equal(roomsRes.results[0].name, 'General');
  assert.equal(roomsRes.results[1].name, 'Secret Project');
});

test('drive-member-sharing: POST /api/drive/member-shares 支持单目标向下兼容', async () => {
  const db = createMockD1Database();
  db.rawDb.exec(`
    INSERT INTO users (id, username, display_name, password_hash, password_salt) VALUES (1, 'alice', 'Alice', 'h', 's'), (2, 'bob', 'Bob', 'h', 's');
    INSERT INTO drive_files (id, user_id, parent_id, name, is_folder, size, status) VALUES ('f1', 1, NULL, 'Doc.pdf', 0, 1024, 'active');
  `);

  const app = new Hono();
  app.use('*', async (c, next) => {
    c.env = { DB: db };
    c.set('session', { userId: 1, username: 'alice' });
    await next();
  });
  registerDriveRoutes(app);

  const res = await app.request('/api/drive/member-shares', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fileId: 'f1',
      targetType: 'user',
      targetId: 2,
      permission: 'read'
    })
  });

  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.count, 1);
  assert.equal(data.createdCount, 1);
  assert.equal(data.permission, 'read');

  // Verify in database
  const share = await db.prepare('SELECT * FROM drive_member_shares WHERE file_id = ? AND target_id = ?').bind('f1', 2).first();
  assert.ok(share);
  assert.equal(share.permission, 'read');
});

test('drive-member-sharing: POST /api/drive/member-shares 支持多选 targets 批量授权与原地覆盖更新', async () => {
  const db = createMockD1Database();
  db.rawDb.exec(`
    INSERT INTO users (id, username, display_name, password_hash, password_salt) VALUES
      (1, 'alice', 'Alice', 'h', 's'),
      (2, 'bob', 'Bob', 'h', 's'),
      (3, 'carol', 'Carol', 'h', 's');
    INSERT INTO channels (id, name, kind) VALUES (10, 'Design Team', 'public');
    INSERT INTO drive_files (id, user_id, parent_id, name, is_folder, size, status) VALUES ('folder_shared', 1, NULL, 'DesignAssets', 1, 0, 'active');

    -- Bob 原先已拥有 read 权限
    INSERT INTO drive_member_shares (id, file_id, owner_id, target_type, target_id, permission)
    VALUES ('ms_bob', 'folder_shared', 1, 'user', 2, 'read');
  `);

  const app = new Hono();
  app.use('*', async (c, next) => {
    c.env = { DB: db };
    c.set('session', { userId: 1, username: 'alice' });
    await next();
  });
  registerDriveRoutes(app);

  // 批量授权：Bob (升级为 write), Carol (新增 write), Design Team 群聊 (新增 write), 且附带 Alice (自身，应被过滤)
  const res = await app.request('/api/drive/member-shares', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fileId: 'folder_shared',
      targets: [
        { targetType: 'user', targetId: 2 },
        { targetType: 'user', targetId: 3 },
        { targetType: 'room', targetId: 10 },
        { targetType: 'user', targetId: 1 } // self -> should be filtered
      ],
      permission: 'write'
    })
  });

  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.count, 3);
  assert.equal(data.updatedCount, 1);
  assert.equal(data.createdCount, 2);
  assert.equal(data.permission, 'write');

  // Verify Bob was updated
  const bobShare = await db.prepare('SELECT permission FROM drive_member_shares WHERE file_id = ? AND target_type = ? AND target_id = ?').bind('folder_shared', 'user', 2).first();
  assert.equal(bobShare.permission, 'write');

  // Verify Carol was created
  const carolShare = await db.prepare('SELECT permission FROM drive_member_shares WHERE file_id = ? AND target_type = ? AND target_id = ?').bind('folder_shared', 'user', 3).first();
  assert.equal(carolShare.permission, 'write');

  // Verify Room 10 was created
  const roomShare = await db.prepare('SELECT permission FROM drive_member_shares WHERE file_id = ? AND target_type = ? AND target_id = ?').bind('folder_shared', 'room', 10).first();
  assert.equal(roomShare.permission, 'write');

  // Verify Alice (self) was not added
  const selfShare = await db.prepare('SELECT * FROM drive_member_shares WHERE file_id = ? AND target_type = ? AND target_id = ?').bind('folder_shared', 'user', 1).first();
  assert.equal(selfShare, null);
});

