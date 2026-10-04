import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import initSqlJs from 'sql.js';
import {
  getUserStorageQuota,
  getUserStorageUsage,
  buildFolderBreadcrumbs,
  resolveMimeType
} from '../worker/src/api/drive.js';
import { hashPassword, verifyPassword } from '../worker/src/auth.js';

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

    CREATE TABLE drive_shares (
      id TEXT PRIMARY KEY,
      file_id TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      expires_at TEXT,
      password_hash TEXT,
      password_salt TEXT,
      permission TEXT NOT NULL DEFAULT 'view',
      max_file_size INTEGER,
      max_total_bytes INTEGER,
      allow_subfolders INTEGER NOT NULL DEFAULT 0,
      uploaded_bytes INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (file_id) REFERENCES drive_files(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE drive_app_passwords (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      last_used_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE drive_user_credentials (
      user_id INTEGER PRIMARY KEY,
      storage_type TEXT NOT NULL DEFAULT 'r2',
      encrypted_config TEXT NOT NULL,
      iv TEXT NOT NULL,
      storage_quota_bytes INTEGER NOT NULL DEFAULT 10737418240,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
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

    CREATE TABLE channels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      deleted_at TEXT
    );

    CREATE TABLE channel_members (
      channel_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      PRIMARY KEY (channel_id, user_id)
    );

    INSERT INTO users (id, username, display_name, password_hash, password_salt)
    VALUES (1, 'alice', '爱丽丝', 'hash', 'salt'),
           (2, 'bob', '鲍勃', 'hash', 'salt');
  `);

  // Return a mock D1 interface
  return {
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

test('getUserStorageQuota & getUserStorageUsage accurate calculations', async () => {
  const d1 = createMockD1Database();

  // Initial stats for Alice (0 files)
  const initialUsage = await getUserStorageUsage(d1, 1);
  assert.equal(initialUsage.usedBytes, 0);
  assert.equal(initialUsage.fileCount, 0);
  assert.equal(initialUsage.folderCount, 0);

  const quota = await getUserStorageQuota(d1, 1);
  assert.equal(quota, 10737418240); // 10 GB default

  // Add a folder and 2 files
  await d1.prepare(`INSERT INTO drive_files (id, user_id, name, is_folder, size, status) VALUES (?, ?, ?, ?, ?, ?)`).bind('f1', 1, '文档', 1, 0, 'active').run();
  await d1.prepare(`INSERT INTO drive_files (id, user_id, parent_id, name, is_folder, size, status) VALUES (?, ?, ?, ?, ?, ?, ?)`).bind('doc1', 1, 'f1', 'test.pdf', 0, 1024 * 1024, 'active').run();
  await d1.prepare(`INSERT INTO drive_files (id, user_id, parent_id, name, is_folder, size, status) VALUES (?, ?, ?, ?, ?, ?, ?)`).bind('doc2', 1, 'f1', 'image.png', 0, 2 * 1024 * 1024, 'active').run();

  const nextUsage = await getUserStorageUsage(d1, 1);
  assert.equal(nextUsage.usedBytes, 3 * 1024 * 1024);
  assert.equal(nextUsage.fileCount, 2);
  assert.equal(nextUsage.folderCount, 1);

  // Bob's usage remains 0 (User isolation)
  const bobUsage = await getUserStorageUsage(d1, 2);
  assert.equal(bobUsage.usedBytes, 0);
  assert.equal(bobUsage.fileCount, 0);
});

test('buildFolderBreadcrumbs builds multi-level hierarchy path', async () => {
  const d1 = createMockD1Database();

  await d1.prepare(`INSERT INTO drive_files (id, user_id, name, is_folder, status) VALUES (?, ?, ?, ?, ?)`).bind('root-f1', 1, '工作', 1, 'active').run();
  await d1.prepare(`INSERT INTO drive_files (id, user_id, parent_id, name, is_folder, status) VALUES (?, ?, ?, ?, ?, ?)`).bind('sub-f2', 1, 'root-f1', '2026项目', 1, 'active').run();
  await d1.prepare(`INSERT INTO drive_files (id, user_id, parent_id, name, is_folder, status) VALUES (?, ?, ?, ?, ?, ?)`).bind('sub-f3', 1, 'sub-f2', '资料', 1, 'active').run();

  const crumbs = await buildFolderBreadcrumbs(d1, 1, 'sub-f3');
  assert.deepEqual(crumbs, [
    { id: 'root-f1', name: '工作' },
    { id: 'sub-f2', name: '2026项目' },
    { id: 'sub-f3', name: '资料' }
  ]);
});

test('drive_shares supports PBKDF2 password protection and verification', async () => {
  const password = 'SecretPassword123!';
  const hashed = await hashPassword(password);
  const ok = await verifyPassword(password, hashed.hash, hashed.salt);
  assert.equal(ok, true);

  const wrong = await verifyPassword('wrong-password', hashed.hash, hashed.salt);
  assert.equal(wrong, false);
});

test('instant virtual copy duplicates D1 metadata and shares storage_key', async () => {
  const d1 = createMockD1Database();

  const origKey = 'drive/1/file123-report.docx';
  await d1.prepare(
    `INSERT INTO drive_files (id, user_id, name, is_folder, size, storage_key, status)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind('orig-1', 1, 'report.docx', 0, 5000, origKey, 'active').run();

  // Make virtual copy
  await d1.prepare(
    `INSERT INTO drive_files (id, user_id, name, is_folder, size, storage_key, status)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind('copy-2', 1, '副本 - report.docx', 0, 5000, origKey, 'active').run();

  const countRes = await d1.prepare(`SELECT COUNT(*) AS count FROM drive_files WHERE storage_key = ?`).bind(origKey).first();
  assert.equal(countRes.count, 2);

  // Deleting copy-2 leaves count at 1 (physical file not deleted from storage)
  await d1.prepare(`DELETE FROM drive_files WHERE id = ?`).bind('copy-2').run();
  const nextCount = await d1.prepare(`SELECT COUNT(*) AS count FROM drive_files WHERE storage_key = ?`).bind(origKey).first();
  assert.equal(nextCount.count, 1);
});

test('save chat attachment to drive creates active drive_file with attachmentKey', async () => {
  const d1 = createMockD1Database();

  const attachmentKey = 'attachments/photo_12345.jpg';
  await d1.prepare(
    `INSERT INTO drive_files (id, user_id, parent_id, name, is_folder, size, mime_type, storage_key, status)
     VALUES (?, ?, NULL, ?, 0, ?, ?, ?, 'active')`
  ).bind('drive-att-1', 1, 'photo_12345.jpg', 1024 * 50, 'image/jpeg', attachmentKey).run();

  const file = await d1.prepare(`SELECT id, name, storage_key FROM drive_files WHERE id = ?`).bind('drive-att-1').first();
  assert.equal(file.name, 'photo_12345.jpg');
  assert.equal(file.storage_key, attachmentKey);
});

test('resolveMimeType resolves common file formats accurately', () => {
  assert.equal(resolveMimeType('photo.jpg'), 'image/jpeg');
  assert.equal(resolveMimeType('image.png'), 'image/png');
  assert.equal(resolveMimeType('movie.mp4'), 'video/mp4');
  assert.equal(resolveMimeType('song.mp3'), 'audio/mpeg');
  assert.equal(resolveMimeType('doc.pdf'), 'application/pdf');
  assert.equal(resolveMimeType('notes.md'), 'text/markdown; charset=utf-8');
  assert.equal(resolveMimeType('data.csv'), 'text/csv; charset=utf-8');
  assert.equal(resolveMimeType('script.js'), 'text/javascript; charset=utf-8');
  assert.equal(resolveMimeType('query.sql'), 'text/plain; charset=utf-8');
  assert.equal(resolveMimeType('generic.bin', 'application/custom'), 'application/custom');
});

test('public share query includes owner name, username, avatar_key, file size, and updated_at', async () => {
  const d1 = createMockD1Database();

  await d1.prepare(`
    UPDATE users
    SET display_name = 'Alice Wang', avatar_key = 'avatars/alice.png'
    WHERE id = 1
  `).run();

  await d1.prepare(`
    INSERT INTO drive_files (id, user_id, name, is_folder, size, mime_type, updated_at, status)
    VALUES ('f-101', 1, 'ProjectProposal.pdf', 0, 1024 * 350, 'application/pdf', '2026-08-18 10:00:00', 'active')
  `).run();

  await d1.prepare(`
    INSERT INTO drive_shares (id, file_id, user_id, permission, created_at)
    VALUES ('share-token-xyz', 'f-101', 1, 'view', '2026-08-18 10:30:00')
  `).run();

  const share = await d1.prepare(`
    SELECT s.id, s.file_id, s.user_id, s.permission, s.expires_at, s.created_at AS shared_at,
           f.name, f.is_folder, f.size, f.mime_type, f.updated_at,
           u.display_name AS owner_name, u.username AS owner_username, u.avatar_key AS owner_avatar_key
    FROM drive_shares s
    JOIN drive_files f ON s.file_id = f.id
    LEFT JOIN users u ON s.user_id = u.id
    WHERE s.id = ? AND f.deleted_at IS NULL LIMIT 1
  `).bind('share-token-xyz').first();

  assert.ok(share);
  assert.equal(share.owner_name, 'Alice Wang');
  assert.equal(share.owner_username, 'alice');
  assert.equal(share.owner_avatar_key, 'avatars/alice.png');
  assert.equal(share.size, 1024 * 350);
  assert.equal(share.name, 'ProjectProposal.pdf');
  assert.equal(share.updated_at, '2026-08-18 10:00:00');
  assert.equal(share.shared_at, '2026-08-18 10:30:00');
});

test('save attachment to designated folder and create text file in drive', async () => {
  const d1 = createMockD1Database();

  // Create folder
  await d1.prepare(`
    INSERT INTO drive_files (id, user_id, name, is_folder, status)
    VALUES ('folder-archives', 1, '聊天归档目录', 1, 'active')
  `).run();

  // Save attachment to folder-archives
  await d1.prepare(`
    INSERT INTO drive_files (id, user_id, parent_id, name, is_folder, size, mime_type, storage_key, status)
    VALUES ('file-saved-1', 1, 'folder-archives', '会议图片.png', 0, 1024 * 200, 'image/png', 'att-key-1', 'active')
  `).run();

  // Create text markdown file in folder-archives
  await d1.prepare(`
    INSERT INTO drive_files (id, user_id, parent_id, name, is_folder, size, mime_type, storage_key, status)
    VALUES ('archive-doc-1', 1, 'folder-archives', '[Edgechat]_聊天记录归档.md', 0, 1500, 'text/markdown; charset=utf-8', 'drive/1/archive.md', 'active')
  `).run();

  const savedFiles = await d1.prepare(`
    SELECT id, name, parent_id, is_folder FROM drive_files WHERE parent_id = 'folder-archives' ORDER BY name
  `).all();

  assert.equal(savedFiles.results.length, 2);
  assert.equal(savedFiles.results[0].id, 'archive-doc-1');
  assert.equal(savedFiles.results[0].parent_id, 'folder-archives');
  assert.equal(savedFiles.results[1].id, 'file-saved-1');
  assert.equal(savedFiles.results[1].parent_id, 'folder-archives');
});

test('member share permits room member to access shared folder and files within', async () => {
  const d1 = createMockD1Database();

  await d1.prepare(`INSERT INTO channels (id, name, kind) VALUES (10, '前端开发群', 'public')`).run();
  await d1.prepare(`INSERT INTO channel_members (channel_id, user_id) VALUES (10, 2)`).run();

  // Owner 1 shares folder-work to room 10
  await d1.prepare(`
    INSERT INTO drive_files (id, user_id, name, is_folder, status)
    VALUES ('folder-work', 1, '项目工作区', 1, 'active')
  `).run();

  await d1.prepare(`
    INSERT INTO drive_member_shares (id, file_id, owner_id, target_type, target_id, permission)
    VALUES ('ms-001', 'folder-work', 1, 'room', 10, 'write')
  `).run();

  // Check if User 2 (member of Room 10) matches permission
  const share = await d1.prepare(`
    SELECT s.permission, s.owner_id
    FROM drive_member_shares s
    JOIN channel_members cm ON s.target_type = 'room' AND s.target_id = cm.channel_id
    WHERE s.file_id = 'folder-work' AND cm.user_id = 2
  `).first();

  assert.ok(share);
  assert.equal(share.permission, 'write');
  assert.equal(share.owner_id, 1);
});

test('shared-with-me excludes shares owned by the querying user themselves', async () => {
  const d1 = createMockD1Database();

  await d1.prepare(`INSERT INTO channels (id, name, kind) VALUES (20, '技术交流群', 'public')`).run();
  // Both User 1 and User 2 are in channel 20
  await d1.prepare(`INSERT INTO channel_members (channel_id, user_id) VALUES (20, 1), (20, 2)`).run();

  await d1.prepare(`
    INSERT INTO drive_files (id, user_id, name, is_folder, status)
    VALUES ('folder-u1', 1, 'User 1 分享给群的文件夹', 1, 'active'),
           ('folder-u2', 2, 'User 2 分享给群的文件夹', 1, 'active')
  `).run();

  await d1.prepare(`
    INSERT INTO drive_member_shares (id, file_id, owner_id, target_type, target_id, permission)
    VALUES ('ms-u1', 'folder-u1', 1, 'room', 20, 'write'),
           ('ms-u2', 'folder-u2', 2, 'room', 20, 'read')
  `).run();

  // Query shared-with-me for User 1 (should only get User 2's share, not User 1's own share)
  const roomIds = [20];
  const query = `
    SELECT s.id AS share_id, f.name AS file_name, s.owner_id
    FROM drive_member_shares s
    JOIN drive_files f ON s.file_id = f.id
    WHERE f.deleted_at IS NULL AND f.status = 'active'
      AND s.owner_id != ?
      AND ((s.target_type = 'user' AND s.target_id = ?)
        OR (s.target_type = 'room' AND s.target_id IN (${roomIds.map(() => '?').join(',')})))
  `;
  const res = await d1.prepare(query).bind(1, 1, ...roomIds).all();

  assert.equal(res.results.length, 1);
  assert.equal(res.results[0].share_id, 'ms-u2');
  assert.equal(res.results[0].file_name, 'User 2 分享给群的文件夹');
  assert.equal(res.results[0].owner_id, 2);
});

test('云盘「最近新增」接口返回用户最近上传的文件并携带父目录信息', async () => {
  const d1 = createMockD1Database();

  // 创建文件夹与文件
  await d1.prepare(`
    INSERT INTO drive_files (id, user_id, parent_id, name, is_folder, size, mime_type, status, created_at)
    VALUES ('f-dir-1', 1, NULL, '项目文档', 1, 0, NULL, 'active', '2026-08-30 08:00:00'),
           ('f-file-1', 1, NULL, '根目录文件.txt', 0, 1024, 'text/plain', 'active', '2026-08-30 09:00:00'),
           ('f-file-2', 1, 'f-dir-1', '设计方案.pdf', 0, 2048, 'application/pdf', 'active', '2026-08-30 10:00:00'),
           ('f-file-other', 2, NULL, '他人文件.zip', 0, 4096, 'application/zip', 'active', '2026-08-30 11:00:00'),
           ('f-file-deleted', 1, NULL, '已删文件.doc', 0, 512, 'application/msword', 'active', '2026-08-30 12:00:00')
  `).run();

  await d1.prepare("UPDATE drive_files SET deleted_at = '2026-08-30 12:30:00' WHERE id = 'f-file-deleted'").run();

  // 查询用户 1 的最近新增文件 (排除文件夹、排除已删除、排除他人文件)
  const query = `
    SELECT f.id, f.parent_id, f.name, f.is_folder, f.size, f.mime_type, f.created_at,
           p.name AS parent_name
    FROM drive_files f
    LEFT JOIN drive_files p ON f.parent_id = p.id AND p.deleted_at IS NULL
    WHERE f.user_id = ?
      AND f.deleted_at IS NULL
      AND f.status = 'active'
      AND f.is_folder = 0
    ORDER BY f.created_at DESC, f.id DESC
    LIMIT 50
  `;
  const res = await d1.prepare(query).bind(1).all();

  assert.equal(res.results.length, 2);
  // 最新排在第一位: 设计方案.pdf, 其 parent_name 应该为 '项目文档'
  assert.equal(res.results[0].id, 'f-file-2');
  assert.equal(res.results[0].name, '设计方案.pdf');
  assert.equal(res.results[0].parent_name, '项目文档');

  // 根目录文件排在第二位: 根目录文件.txt, parent_name 为 null
  assert.equal(res.results[1].id, 'f-file-1');
  assert.equal(res.results[1].name, '根目录文件.txt');
  assert.equal(res.results[1].parent_name, null);
});

test('云盘创建文件夹时支持 getOrCreate 幂等返回已有文件夹，避免重复创建', async () => {
  const d1 = createMockD1Database();
  const userId = 1;
  const folderName = '我的相册';

  // 1. 首次创建文件夹
  const existing1 = await d1.prepare(
    `SELECT id, name, parent_id, is_folder FROM drive_files WHERE user_id = ? AND parent_id IS NULL AND name = ? AND deleted_at IS NULL AND is_folder = 1 LIMIT 1`
  ).bind(userId, folderName).first();
  assert.equal(existing1, null);

  const newId = 'folder-uuid-1';
  await d1.prepare(
    `INSERT INTO drive_files (id, user_id, parent_id, name, is_folder, size, status, created_at, updated_at)
     VALUES (?, ?, NULL, ?, 1, 0, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
  ).bind(newId, userId, folderName).run();

  // 2. 再次尝试创建同名文件夹（带 getOrCreate）
  const existing2 = await d1.prepare(
    `SELECT id, name, parent_id, is_folder FROM drive_files WHERE user_id = ? AND parent_id IS NULL AND name = ? AND deleted_at IS NULL AND is_folder = 1 LIMIT 1`
  ).bind(userId, folderName).first();

  assert.ok(existing2);
  assert.equal(existing2.id, newId);
  assert.equal(existing2.name, folderName);
});


