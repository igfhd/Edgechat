import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { Hono } from "hono";
import initSqlJs from "sql.js";
import { registerWebDavRoutes } from "../worker/src/api/webdav.js";
import { hashPassword } from "../worker/src/auth.js";

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
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      is_disabled INTEGER NOT NULL DEFAULT 0,
      disabled_until TEXT,
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
      deleted_at TEXT
    );

    CREATE TABLE drive_app_passwords (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_used_at TEXT
    );

    CREATE TABLE drive_user_credentials (
      user_id INTEGER PRIMARY KEY,
      storage_quota_bytes INTEGER NOT NULL DEFAULT 10737418240
    );

    CREATE TABLE site_settings (
      setting_key TEXT PRIMARY KEY,
      setting_value TEXT NOT NULL
    );
  `);

  return {
    raw: db,
    prepare(sql) {
      const self = {
        _sql: sql,
        _params: [],
        bind(...params) {
          this._params = params.map(p => p === undefined ? null : p);
          return this;
        },
        async all() {
          const stmt = db.prepare(this._sql);
          stmt.bind(this._params);
          const results = [];
          while (stmt.step()) {
            results.push(stmt.getAsObject());
          }
          stmt.free();
          return { results };
        },
        async first() {
          const stmt = db.prepare(this._sql);
          stmt.bind(this._params);
          let row = null;
          if (stmt.step()) {
            row = stmt.getAsObject();
          }
          stmt.free();
          return row;
        },
        async run() {
          const stmt = db.prepare(this._sql);
          stmt.bind(this._params);
          stmt.step();
          stmt.free();
          return { meta: { changes: 1 } };
        }
      };
      return self;
    }
  };
}

function createMockR2() {
  const store = new Map();
  return {
    store,
    async get(key) {
      const item = store.get(key);
      if (!item) return null;
      return {
        size: item.bytes.byteLength,
        body: item.bytes,
        uploaded: new Date(),
        async arrayBuffer() {
          return item.bytes.buffer;
        }
      };
    },
    async put(key, body) {
      const bytes = body instanceof Uint8Array ? body : (typeof body === 'string' ? new TextEncoder().encode(body) : new Uint8Array(await new Response(body).arrayBuffer()));
      store.set(key, { bytes });
      return { size: bytes.byteLength };
    },
    async head(key) {
      const item = store.get(key);
      if (!item) return null;
      return { size: item.bytes.byteLength };
    },
    async delete(key) {
      store.delete(key);
    }
  };
}

test('WebDAV: 完整支持 rclone / WebDAV 标准方法与伪装路径路由', async () => {
  const db = createMockDb();
  const r2 = createMockR2();

  const userHashed = await hashPassword('userpassword123');
  await db.prepare("INSERT INTO users (id, username, display_name, password_hash, password_salt) VALUES (1, 'alice', '爱丽丝', ?, ?)")
    .bind(userHashed.hash, userHashed.salt).run();

  const appPwHashed = await hashPassword('dav-secret-app-pwd');
  await db.prepare("INSERT INTO drive_app_passwords (id, user_id, name, password_hash, password_salt) VALUES ('pw-1', 1, 'rclone-pc', ?, ?)")
    .bind(appPwHashed.hash, appPwHashed.salt).run();

  const app = new Hono();
  registerWebDavRoutes(app);

  const authHeader = `Basic ${Buffer.from('alice:dav-secret-app-pwd').toString('base64')}`;
  const env = {
    DB: db,
    FILES: r2,
    ROUTE_PREFIX: 'secret_prefix_999'
  };

  // 1. OPTIONS 方法
  const optRes = await app.request('https://edgechat.test/dav/', {
    method: 'OPTIONS',
    headers: { Authorization: authHeader }
  }, env);
  assert.equal(optRes.status, 200);
  const allowHeader = optRes.headers.get('Allow');
  assert.match(allowHeader, /OPTIONS/);
  assert.match(allowHeader, /PROPFIND/);
  assert.match(allowHeader, /MOVE/);
  assert.match(allowHeader, /COPY/);
  assert.match(allowHeader, /LOCK/);
  assert.match(allowHeader, /UNLOCK/);
  assert.match(allowHeader, /PROPPATCH/);

  // 2. PROPFIND 查询根目录
  const propRes = await app.request('https://edgechat.test/dav/', {
    method: 'PROPFIND',
    headers: {
      Authorization: authHeader,
      Depth: '1',
      'X-Matched-Prefix': 'secret_prefix_999'
    }
  }, env);
  assert.equal(propRes.status, 207);
  const propXml = await propRes.text();
  assert.match(propXml, /<D:href>\/secret_prefix_999\/dav\/<\/D:href>/);
  assert.match(propXml, /<D:quota-available-bytes>/);
  assert.match(propXml, /<D:quota-used-bytes>/);

  // 3. MKCOL 新建文件夹
  const mkcolRes = await app.request('https://edgechat.test/dav/Documents', {
    method: 'MKCOL',
    headers: { Authorization: authHeader }
  }, env);
  assert.equal(mkcolRes.status, 201);

  // 4. PUT 上传文件到子目录
  const putRes = await app.request('https://edgechat.test/dav/Documents/test.txt', {
    method: 'PUT',
    headers: {
      Authorization: authHeader,
      'Content-Type': 'text/plain',
      'Content-Length': '12'
    },
    body: new TextEncoder().encode('Hello WebDAV')
  }, env);
  assert.equal(putRes.status, 201);

  // 5. GET 读取文件内容
  const getRes = await app.request('https://edgechat.test/dav/Documents/test.txt', {
    method: 'GET',
    headers: { Authorization: authHeader }
  }, env);
  assert.equal(getRes.status, 200);
  assert.equal(await getRes.text(), 'Hello WebDAV');

  // 6. MOVE (重命名与移动到根目录，带伪装前缀 Destination 头)
  const moveRes = await app.request('https://edgechat.test/dav/Documents/test.txt', {
    method: 'MOVE',
    headers: {
      Authorization: authHeader,
      Destination: 'https://edgechat.test/secret_prefix_999/dav/renamed.txt',
      Overwrite: 'T'
    }
  }, env);
  assert.equal(moveRes.status, 201);

  // 7. COPY 副本复制
  const copyRes = await app.request('https://edgechat.test/dav/renamed.txt', {
    method: 'COPY',
    headers: {
      Authorization: authHeader,
      Destination: 'https://edgechat.test/secret_prefix_999/dav/copied.txt',
      Overwrite: 'T'
    }
  }, env);
  assert.equal(copyRes.status, 201);

  // 8. LOCK & UNLOCK
  const lockRes = await app.request('https://edgechat.test/dav/copied.txt', {
    method: 'LOCK',
    headers: { Authorization: authHeader }
  }, env);
  assert.equal(lockRes.status, 200);
  assert.ok(lockRes.headers.get('Lock-Token'));

  const unlockRes = await app.request('https://edgechat.test/dav/copied.txt', {
    method: 'UNLOCK',
    headers: { Authorization: authHeader }
  }, env);
  assert.equal(unlockRes.status, 204);

  // 9. DELETE 删除文件与文件夹
  const delFileRes = await app.request('https://edgechat.test/dav/copied.txt', {
    method: 'DELETE',
    headers: { Authorization: authHeader }
  }, env);
  assert.equal(delFileRes.status, 204);

  const delDirRes = await app.request('https://edgechat.test/dav/Documents', {
    method: 'DELETE',
    headers: { Authorization: authHeader }
  }, env);
  assert.equal(delDirRes.status, 204);
});

test('WebDAV: 边界条件与 RFC 规范严格测试（大小写 Header、MKCOL 409、递归多层删除、特殊字符）', async () => {
  const db = createMockDb();
  const r2 = createMockR2();

  const userHashed = await hashPassword('pw123');
  await db.prepare("INSERT INTO users (id, username, display_name, password_hash, password_salt) VALUES (2, 'bob', '鲍勃', ?, ?)")
    .bind(userHashed.hash, userHashed.salt).run();

  const appPwHashed = await hashPassword('bob-app-pass');
  await db.prepare("INSERT INTO drive_app_passwords (id, user_id, name, password_hash, password_salt) VALUES ('pw-2', 2, 'client-bob', ?, ?)")
    .bind(appPwHashed.hash, appPwHashed.salt).run();

  const app = new Hono();
  registerWebDavRoutes(app);

  const authHeader = `Basic ${Buffer.from('bob:bob-app-pass').toString('base64')}`;
  const env = {
    DB: db,
    FILES: r2,
    ROUTE_PREFIX: 'secure_prefix'
  };

  // 1. PROPFIND Depth: Infinity（大写首字母）必须正确拦截并返回 403
  const propInfRes = await app.request('https://edgechat.test/dav/', {
    method: 'PROPFIND',
    headers: {
      Authorization: authHeader,
      Depth: 'Infinity'
    }
  }, env);
  assert.equal(propInfRes.status, 403);
  const propInfXml = await propInfRes.text();
  assert.ok(propInfXml.includes('<D:propfind-finite-depth/>'));

  // 2. MKCOL 创建不存在父目录的多级文件夹必须返回 409 Conflict
  const mkcolConflictRes = await app.request('https://edgechat.test/dav/NonExistentParent/ChildFolder', {
    method: 'MKCOL',
    headers: { Authorization: authHeader }
  }, env);
  assert.equal(mkcolConflictRes.status, 409);

  // 3. 构建多层嵌套结构：/L1/L2/L3/file.txt 并验证 WITH RECURSIVE 深度软删除
  const mkcolL1 = await app.request('https://edgechat.test/dav/L1', {
    method: 'MKCOL',
    headers: { Authorization: authHeader }
  }, env);
  assert.equal(mkcolL1.status, 201);

  const mkcolL2 = await app.request('https://edgechat.test/dav/L1/L2', {
    method: 'MKCOL',
    headers: { Authorization: authHeader }
  }, env);
  assert.equal(mkcolL2.status, 201);

  const mkcolL3 = await app.request('https://edgechat.test/dav/L1/L2/L3', {
    method: 'MKCOL',
    headers: { Authorization: authHeader }
  }, env);
  assert.equal(mkcolL3.status, 201);

  const putNestedFile = await app.request('https://edgechat.test/dav/L1/L2/L3/deep.txt', {
    method: 'PUT',
    headers: {
      Authorization: authHeader,
      'Content-Type': 'text/plain',
      'Content-Length': '4'
    },
    body: new TextEncoder().encode('deep')
  }, env);
  assert.equal(putNestedFile.status, 201);

  // 删除顶级 /L1 文件夹
  const delL1Res = await app.request('https://edgechat.test/dav/L1', {
    method: 'DELETE',
    headers: { Authorization: authHeader }
  }, env);
  assert.equal(delL1Res.status, 204);

  // 验证 L1, L2, L3 以及 deep.txt 均已被标记 deleted_at
  const activeDescendants = await db.prepare(
    "SELECT COUNT(*) AS count FROM drive_files WHERE user_id = 2 AND deleted_at IS NULL"
  ).first();
  assert.equal(activeDescendants.count, 0);

  // 4. 特殊字符（如 % 和空格）在 Destination 移动时的正确解析
  const putPercentFile = await app.request('https://edgechat.test/dav/percent%25file.txt', {
    method: 'PUT',
    headers: {
      Authorization: authHeader,
      'Content-Type': 'text/plain',
      'Content-Length': '7'
    },
    body: new TextEncoder().encode('percent')
  }, env);
  assert.equal(putPercentFile.status, 201);

  const movePercentRes = await app.request('https://edgechat.test/dav/percent%25file.txt', {
    method: 'MOVE',
    headers: {
      Authorization: authHeader,
      Destination: 'https://edgechat.test/secure_prefix/dav/moved%25target.txt',
      Overwrite: 'T'
    }
  }, env);
  assert.equal(movePercentRes.status, 201);

  // 5. Overwrite: f（小写）覆盖已存在资源时返回 412
  const putTargetFile = await app.request('https://edgechat.test/dav/target_file.txt', {
    method: 'PUT',
    headers: {
      Authorization: authHeader,
      'Content-Type': 'text/plain',
      'Content-Length': '4'
    },
    body: new TextEncoder().encode('file')
  }, env);
  assert.equal(putTargetFile.status, 201);

  const moveNoOverwriteRes = await app.request('https://edgechat.test/dav/moved%25target.txt', {
    method: 'MOVE',
    headers: {
      Authorization: authHeader,
      Destination: 'https://edgechat.test/secure_prefix/dav/target_file.txt',
      Overwrite: 'f'
    }
  }, env);
  assert.equal(moveNoOverwriteRes.status, 412);
});
