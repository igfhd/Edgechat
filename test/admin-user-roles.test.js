import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import initSqlJs from 'sql.js';
import { registerAdminRoutes } from '../worker/src/api/admin.js';
import { listAdminUsers } from '../worker/src/data/users.js';

const SQL = await initSqlJs({
  locateFile(file) {
    return fileURLToPath(new URL(`../node_modules/sql.js/dist/${file}`, import.meta.url));
  }
});

function read(relativePath) {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

const usersSource = read('../frontend/src/pages/AdminUsersPage.vue');
const _adminApiSource = read('../worker/src/api/admin.js');
const demoApiSource = read('../frontend/src/demo/api.js');

function createMockD1Database() {
  const db = new SQL.Database();
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL DEFAULT '',
      password_salt TEXT NOT NULL DEFAULT '',
      avatar_key TEXT,
      is_disabled INTEGER NOT NULL DEFAULT 0,
      disabled_until TEXT,
      is_admin INTEGER NOT NULL DEFAULT 0,
      session_version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      deleted_at TEXT,
      last_active_at TEXT
    );
    CREATE TABLE user_group_members (
      group_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL
    );
    CREATE TABLE channel_members (
      channel_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      invited_by INTEGER
    );
    CREATE TABLE channels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      created_by INTEGER,
      avatar_key TEXT,
      is_disabled INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      kind TEXT NOT NULL DEFAULT 'public',
      deleted_at TEXT
    );
    INSERT INTO channels (id, name, kind) VALUES (1, 'general', 'public');
  `);

  return {
    raw: db,
    async batch(statements) {
      const results = [];
      for (const stmt of statements) {
        results.push(await stmt.run());
      }
      return results;
    },
    prepare(sql) {
      return {
        _sql: sql,
        _params: [],
        bind(...params) {
          this._params = params;
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
          const lastId = db.exec('SELECT last_insert_rowid() as id')[0]?.values[0][0] || 0;
          return { meta: { last_row_id: Number(lastId) } };
        }
      };
    }
  };
}

function createMockApp() {
  const routes = { get: {}, post: {}, patch: {}, put: {}, delete: {} };
  const app = {
    get(path, handler) { routes.get[path] = handler; },
    post(path, handler) { routes.post[path] = handler; },
    patch(path, handler) { routes.patch[path] = handler; },
    put(path, handler) { routes.put[path] = handler; },
    delete(path, handler) { routes.delete[path] = handler; }
  };
  registerAdminRoutes(app);
  async function handle(method, path, { db, body = null, params = {} } = {}) {
    const fn = routes[method.toLowerCase()][path];
    if (!fn) throw new Error(`Route not found: ${method} ${path}`);
    const ctx = {
      env: { DB: db },
      req: {
        url: `http://localhost${path}`,
        param(key) { return params[key]; },
        raw: new Request(`http://localhost${path}`, {
          method: method.toUpperCase(),
          headers: { 'Content-Type': 'application/json' },
          body: body ? JSON.stringify(body) : null
        })
      },
      header() {},
      json(data, status = 200) {
        return { status, data };
      }
    };
    return await fn(ctx);
  }
  return { handle };
}

test('前端用户管理页面包含管理员角色的展示与切换按钮', () => {
  assert.match(usersSource, /role-badge--admin/);
  assert.match(usersSource, /role-badge--user/);
  assert.match(usersSource, /toggleAdminRole/);
  assert.match(usersSource, /取消管理/);
  assert.match(usersSource, /设为管理/);
  assert.match(demoApiSource, /body\.isAdmin !== undefined/);
});

test('listAdminUsers 查询结果包含 is_admin 字段', async () => {
  const db = createMockD1Database();
  db.raw.exec("INSERT INTO users (id, username, display_name, is_admin) VALUES (1, 'admin', 'Admin', 1)");
  db.raw.exec("INSERT INTO users (id, username, display_name, is_admin) VALUES (2, 'user1', 'User 1', 0)");
  const users = await listAdminUsers(db);
  const admin = users.find(u => u.username === 'admin');
  const normal = users.find(u => u.username === 'user1');
  assert.equal(admin.isAdmin, true);
  assert.equal(normal.isAdmin, false);
});

test('管理员接口可以给普通用户授予管理员权限', async () => {
  const db = createMockD1Database();
  db.raw.exec("INSERT INTO users (id, username, display_name, is_admin, session_version) VALUES (1, 'admin', 'Admin', 1, 1)");
  db.raw.exec("INSERT INTO users (id, username, display_name, is_admin, session_version) VALUES (2, 'alice', 'Alice', 0, 1)");
  const mockApp = createMockApp();
  const res = await mockApp.handle('patch', '/api/admin/users/:userId', {
    db,
    params: { userId: '2' },
    body: { isAdmin: true }
  });
  assert.equal(res.status, 200);
  const row = db.raw.exec('SELECT is_admin, session_version FROM users WHERE id = 2')[0].values[0];
  assert.equal(row[0], 1);
  assert.equal(row[1], 2);
});

test('管理员接口可以取消管理员权限，但阻止取消系统中最后一个管理员', async () => {
  const db = createMockD1Database();
  db.raw.exec("INSERT INTO users (id, username, display_name, is_admin, session_version) VALUES (1, 'admin', 'Admin', 1, 1)");
  db.raw.exec("INSERT INTO users (id, username, display_name, is_admin, session_version) VALUES (2, 'alice', 'Alice', 1, 1)");
  const mockApp = createMockApp();
  const res1 = await mockApp.handle('patch', '/api/admin/users/:userId', {
    db,
    params: { userId: '2' },
    body: { isAdmin: false }
  });
  assert.equal(res1.status, 200);
  const aliceRow = db.raw.exec('SELECT is_admin FROM users WHERE id = 2')[0].values[0];
  assert.equal(aliceRow[0], 0);

  const res2 = await mockApp.handle('patch', '/api/admin/users/:userId', {
    db,
    params: { userId: '1' },
    body: { isAdmin: false }
  });
  assert.equal(res2.status, 400);
  const adminRow = db.raw.exec('SELECT is_admin FROM users WHERE id = 1')[0].values[0];
  assert.equal(adminRow[0], 1);
});

test('管理员接口阻止禁用或删除系统中唯一的管理员账号', async () => {
  const db = createMockD1Database();
  db.raw.exec("INSERT INTO users (id, username, display_name, is_admin) VALUES (1, 'admin', 'Admin', 1)");
  const mockApp = createMockApp();
  const resDisable = await mockApp.handle('patch', '/api/admin/users/:userId', {
    db,
    params: { userId: '1' },
    body: { isDisabled: true }
  });
  assert.equal(resDisable.status, 400);

  const resDelete = await mockApp.handle('delete', '/api/admin/users/:userId', {
    db,
    params: { userId: '1' }
  });
  assert.equal(resDelete.status, 400);
});

test('管理员删除用户后，旧数据彻底清理并支持重新创建同名账号', async () => {
  const db = createMockD1Database();
  db.raw.exec(`
    INSERT INTO users (id, username, display_name, is_admin) VALUES (1, 'admin', 'Admin', 1);
    INSERT INTO users (id, username, display_name, is_admin) VALUES (2, 'alice', 'Alice', 0);
    INSERT INTO user_group_members (group_id, user_id) VALUES (1, 2);
    INSERT INTO channel_members (channel_id, user_id, role) VALUES (1, 2, 'member');
  `);

  const mockApp = createMockApp();

  // 1. 删除用户 alice
  const resDelete = await mockApp.handle('delete', '/api/admin/users/:userId', {
    db,
    params: { userId: '2' }
  });
  assert.equal(resDelete.status, 200);

  // 验证用户已被标记删除并释放原用户名，关联数据已清理
  const oldUser = await db.prepare('SELECT id, username, deleted_at FROM users WHERE id = 2').first();
  assert.ok(oldUser.deleted_at);
  assert.match(oldUser.username, /^deleted_2_/);

  const groupMembersCount = await db.prepare('SELECT COUNT(*) AS c FROM user_group_members WHERE user_id = 2').first();
  assert.equal(groupMembersCount.c, 0);

  // 2. 重新创建同名用户 alice
  const resCreate = await mockApp.handle('post', '/api/admin/users', {
    db,
    body: {
      username: 'alice',
      password: 'password123',
      displayName: 'Alice New'
    }
  });
  assert.equal(resCreate.status, 200);
  assert.equal(resCreate.data.user.username, 'alice');
  assert.notEqual(resCreate.data.user.id, 2);
});
