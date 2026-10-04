import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import initSqlJs from 'sql.js';
import { Hono } from 'hono';
import { registerDrivePublicRoutes, isWithinSharedSubtree } from '../worker/src/api/drive-public.js';
import { hashPassword } from '../worker/src/auth.js';

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

    INSERT INTO users (id, username, display_name, password_hash, password_salt)
    VALUES (1, 'alice', 'Alice', 'hash', 'salt'),
           (2, 'bob', 'Bob', 'hash', 'salt');
  `);

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

function createMockKv() {
  const store = new Map();
  return {
    async get(key) {
      return store.get(key) ?? null;
    },
    async put(key, value, options) {
      store.set(key, value);
      if (options?.expirationTtl) {
        this._expires(key, options.expirationTtl);
      }
    },
    _expires(key, ttlSeconds) {
      setTimeout(() => store.delete(key), ttlSeconds * 1000).unref?.();
    }
  };
}

function buildApp(db, kv) {
  const app = new Hono();
  registerDrivePublicRoutes(app);
  const env = makeEnv(db, kv);
  return { app, env };
}

function makeEnv(db, kv) {
  const bodies = {
    'drive/1/single.pdf': { size: 123, body: new ReadableStream({ start(c) { c.enqueue(new Uint8Array([1, 2, 3])); c.close(); } }) },
    'drive/1/shared-file.pdf': { size: 100, body: new ReadableStream({ start(c) { c.enqueue(new Uint8Array([4, 5])); c.close(); } }) }
  };
  return {
    DB: db,
    SESSIONS: kv,
    FILES: {
      async get(key) {
        return bodies[key] || null;
      }
    }
  };
}

function request(app, env, path, init) {
  return app.request(path, init, env);
}

test('isWithinSharedSubtree walks the parent chain and rejects unrelated files', async () => {
  const db = createMockD1Database();

  await db.prepare(`INSERT INTO drive_files (id, user_id, name, is_folder, status) VALUES ('root', 1, 'root', 1, 'active')`).run();
  await db.prepare(`INSERT INTO drive_files (id, user_id, parent_id, name, is_folder, status) VALUES ('sub', 1, 'root', 'sub', 1, 'active')`).run();
  await db.prepare(`INSERT INTO drive_files (id, user_id, parent_id, name, is_folder, status) VALUES ('leaf', 1, 'sub', 'leaf.txt', 0, 'active')`).run();
  await db.prepare(`INSERT INTO drive_files (id, user_id, name, is_folder, status) VALUES ('other', 1, 'other', 1, 'active')`).run();
  await db.prepare(`INSERT INTO drive_files (id, user_id, parent_id, name, is_folder, status) VALUES ('other-leaf', 1, 'other', 'other.txt', 0, 'active')`).run();

  assert.equal(await isWithinSharedSubtree(db, 'root', 'root'), true);
  assert.equal(await isWithinSharedSubtree(db, 'root', 'sub'), true);
  assert.equal(await isWithinSharedSubtree(db, 'root', 'leaf'), true);
  assert.equal(await isWithinSharedSubtree(db, 'root', 'other'), false);
  assert.equal(await isWithinSharedSubtree(db, 'root', 'other-leaf'), false);
  assert.equal(await isWithinSharedSubtree(db, 'root', 'does-not-exist'), false);
});

// Build a share tree and exercise the public endpoints through Hono.
async function seedShareFixture(db) {
  // Alice's shared folder
  await db.prepare(`INSERT INTO drive_files (id, user_id, name, is_folder, status) VALUES ('shared-root', 1, 'shared', 1, 'active')`).run();
  await db.prepare(`INSERT INTO drive_files (id, user_id, parent_id, name, is_folder, status) VALUES ('shared-inner', 1, 'shared-root', 'inner', 1, 'active')`).run();
  await db.prepare(`INSERT INTO drive_files (id, user_id, parent_id, name, is_folder, size, storage_key, status) VALUES ('shared-file', 1, 'shared-inner', 'ok.pdf', 0, 100, 'drive/1/shared-file.pdf', 'active')`).run();

  // Alice's private folder OUTSIDE the shared subtree
  await db.prepare(`INSERT INTO drive_files (id, user_id, name, is_folder, status) VALUES ('private-root', 1, 'private', 1, 'active')`).run();
  await db.prepare(`INSERT INTO drive_files (id, user_id, parent_id, name, is_folder, size, storage_key, status) VALUES ('private-file', 1, 'private-root', 'secret.txt', 0, 50, 'drive/1/secret.txt', 'active')`).run();

  // Single-file share target
  await db.prepare(`INSERT INTO drive_files (id, user_id, name, is_folder, size, mime_type, storage_key, status) VALUES ('single-file', 1, 'single.pdf', 0, 123, 'application/pdf', 'drive/1/single.pdf', 'active')`).run();

  // No-password folder share
  await db.prepare(`INSERT INTO drive_shares (id, file_id, user_id, permission) VALUES ('share-folder', 'shared-root', 1, 'view')`).run();
  // Single-file share without password
  await db.prepare(`INSERT INTO drive_shares (id, file_id, user_id, permission) VALUES ('share-single', 'single-file', 1, 'view')`).run();
}

test('public folder share: files endpoint rejects parentId outside the shared subtree', async () => {
  const db = createMockD1Database();
  await seedShareFixture(db);
  const { app, env } = buildApp(db);

  // Listing inside the shared subtree works
  const okRes = await request(app, env, '/api/drive/public/shares/share-folder/files?parentId=shared-root');
  assert.equal(okRes.status, 200);
  const okBody = await okRes.json();
  assert.ok(okBody.files.some((f) => f.id === 'shared-inner'));

  // Listing a sibling folder OUTSIDE the subtree must be rejected (IDOR)
  const badRes = await request(app, env, '/api/drive/public/shares/share-folder/files?parentId=private-root');
  assert.equal(badRes.status, 403);

  // Listing a nonexistent folder also rejected
  const missingRes = await request(app, env, '/api/drive/public/shares/share-folder/files?parentId=nope');
  assert.equal(missingRes.status, 403);
});

test('public folder share: download endpoint rejects files outside the shared subtree', async () => {
  const db = createMockD1Database();
  await seedShareFixture(db);
  const { app, env } = buildApp(db);

  // File inside the subtree can be listed and downloaded
  const listRes = await request(app, env, '/api/drive/public/shares/share-folder/files?parentId=shared-inner');
  assert.equal(listRes.status, 200);
  const listBody = await listRes.json();
  assert.ok(listBody.files.some((f) => f.id === 'shared-file'));

  const okRes = await request(app, env, '/api/drive/public/shares/share-folder/download/shared-file');
  assert.equal(okRes.status, 200);

  // Alice's private file must NOT be downloadable through the folder share
  const badRes = await request(app, env, '/api/drive/public/shares/share-folder/download/private-file');
  assert.equal(badRes.status, 403);
});

test('public single-file share: /download/single serves the shared root', async () => {
  const db = createMockD1Database();
  await seedShareFixture(db);
  const { app, env } = buildApp(db, createMockKv());

  const res = await request(app, env, '/api/drive/public/shares/share-single/download/single');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Content-Type'), 'application/pdf');
  assert.match(res.headers.get('Content-Disposition'), /single\.pdf/);
});

test('password-protected share: files/download require verification first', async () => {
  const db = createMockD1Database();
  await seedShareFixture(db);

  const hashed = await hashPassword('s3cret-pw');
  await db.prepare(
    `UPDATE drive_shares SET password_hash = ?, password_salt = ? WHERE id = 'share-folder'`
  ).bind(hashed.hash, hashed.salt).run();

  const kv = createMockKv();
  const { app, env } = buildApp(db, kv);

  // Without verification the password-protected share is gated
  const gatedRes = await request(app, env, '/api/drive/public/shares/share-folder/files?parentId=shared-root');
  assert.equal(gatedRes.status, 403);

  // Wrong password is rejected
  const wrongRes = await request(app, env, '/api/drive/public/shares/share-folder/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'nope' })
  });
  assert.equal(wrongRes.status, 401);

  // Correct password unlocks the share
  const okVerify = await request(app, env, '/api/drive/public/shares/share-folder/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 's3cret-pw' })
  });
  assert.equal(okVerify.status, 200);
  const verifyBody = await okVerify.json();
  assert.equal(verifyBody.verified, true);

  const filesRes = await request(app, env, '/api/drive/public/shares/share-folder/files?parentId=shared-root');
  assert.equal(filesRes.status, 200);
});

test('share info endpoint does not leak the password hash or salt', async () => {
  const db = createMockD1Database();
  await seedShareFixture(db);

  const { app, env } = buildApp(db);
  const res = await request(app, env, '/api/drive/public/shares/share-folder');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(!('password_hash' in body));
  assert.ok(!('password_salt' in body));
  assert.equal(body.hasPassword, false);
});