import assert from 'node:assert/strict';
import test from 'node:test';
import { Hono } from 'hono';
import { fileURLToPath } from 'node:url';
import initSqlJs from 'sql.js';
import {
  createUserGroup,
  updateUserGroup,
  getGroupMembers,
  addGroupMembers,
  setGroupMemberRole,
  listManagedGroupsForUser,
  canUsersDirectMessage,
  hasAnyActiveGroups
} from '../worker/src/data/user-groups.js';
import { listActiveUsers } from '../worker/src/data/users.js';
import { registerAdminRoutes } from '../worker/src/api/admin.js';

const SQL = await initSqlJs({
  locateFile(file) {
    return fileURLToPath(new URL(`../node_modules/sql.js/dist/${file}`, import.meta.url));
  }
});

function createTestDb() {
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
      last_active_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      deleted_at TEXT
    );

    CREATE TABLE user_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL DEFAULT '',
      allow_member_dm INTEGER NOT NULL DEFAULT 1 CHECK (allow_member_dm IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      deleted_at TEXT
    );

    CREATE TABLE user_group_members (
      group_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('leader', 'member')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (group_id, user_id),
      FOREIGN KEY (group_id) REFERENCES user_groups(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE channels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL DEFAULT '',
      avatar_key TEXT,
      kind TEXT NOT NULL DEFAULT 'public',
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

    CREATE TABLE site_settings (
      setting_key TEXT PRIMARY KEY,
      setting_value TEXT NOT NULL DEFAULT ''
    );

    INSERT INTO users (id, username, display_name, password_hash, password_salt, is_admin) VALUES
      (1, 'admin_super', '超级管理', 'h', 's', 1),
      (2, 'boss_alice', '总负责人爱丽丝', 'h', 's', 0),
      (3, 'lead_bob', '研发主管鲍勃', 'h', 's', 0),
      (4, 'dev_charlie', '研发组员查理', 'h', 's', 0),
      (5, 'mkt_dave', '市场组员戴夫', 'h', 's', 0);
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

test('组长委任与组内私聊管制策略端到端鉴权 (方案一：多负责人多层级管理)', async () => {
  const db = createTestDb();

  // 1. 创建「研发部」（默认开启组员互聊）和「市场部」（创建时设为管制模式 allow_member_dm = false）
  const groupDev = await createUserGroup(db, { name: '研发部', description: '技术研发', allowMemberDm: true });
  const groupMkt = await createUserGroup(db, { name: '市场部', description: '市场运营', allowMemberDm: false });

  assert.equal(groupDev.allowMemberDm, true);
  assert.equal(groupMkt.allowMemberDm, false);

  // 2. 将 Alice(总负责人) 同时加入 研发部、市场部
  // 将 Bob(研发主管) 和 Charlie(研发组员) 加入 研发部
  // 将 Dave(市场组员) 加入 市场部
  await addGroupMembers(db, groupDev.id, [2, 3, 4]); // Alice(2), Bob(3), Charlie(4)
  await addGroupMembers(db, groupMkt.id, [2, 5]);    // Alice(2), Dave(5)

  // 3. 委任组长角色：
  // 研发部中：Alice(总负责人) 和 Bob(研发主管) 均为 leader
  // 市场部中：Alice(总负责人) 为 leader
  await setGroupMemberRole(db, groupDev.id, 2, 'leader');
  await setGroupMemberRole(db, groupDev.id, 3, 'leader');
  await setGroupMemberRole(db, groupMkt.id, 2, 'leader');

  const devMembers = await getGroupMembers(db, groupDev.id);
  assert.equal(devMembers.find(m => m.id === 2).isLeader, true);
  assert.equal(devMembers.find(m => m.id === 3).isLeader, true);
  assert.equal(devMembers.find(m => m.id === 4).isLeader, false);

  // 4. listManagedGroupsForUser 验证：
  // Alice(总负责人) 管辖两个组：研发部 和 市场部
  const aliceManaged = await listManagedGroupsForUser(db, 2);
  assert.equal(aliceManaged.length, 2);
  assert.deepEqual(aliceManaged.map(g => g.name).sort(), ['市场部', '研发部']);

  // Bob(研发主管) 只管辖 研发部
  const bobManaged = await listManagedGroupsForUser(db, 3);
  assert.equal(bobManaged.length, 1);
  assert.equal(bobManaged[0].name, '研发部');

  // Charlie(普通员工) 无管辖分组
  const charlieManaged = await listManagedGroupsForUser(db, 4);
  assert.equal(charlieManaged.length, 0);

  // 5. 市场部处于管制模式 (allow_member_dm = false)：
  // a) Dave(普通组员) 可以私聊 Alice(总负责人/组长)，也可以私聊 超级管理员
  assert.equal(await canUsersDirectMessage(db, 5, 2), true);
  assert.equal(await canUsersDirectMessage(db, 2, 5), true);
  assert.equal(await canUsersDirectMessage(db, 5, 1), true);

  // b) Dave(市场部组员) 无法私聊 研发部的 Charlie 或 Bob (跨部门物理隔离)
  assert.equal(await canUsersDirectMessage(db, 5, 4), false);
  assert.equal(await canUsersDirectMessage(db, 5, 3), false);

  // 6. 研发部开启私聊管制 (allow_member_dm = false)：
  await updateUserGroup(db, groupDev.id, { allowMemberDm: false });
  assert.equal(await hasAnyActiveGroups(db), true);

  // a) 组长 Alice 和 组长 Bob 拥有全组自由私聊权限：
  assert.equal(await canUsersDirectMessage(db, 2, 4), true); // Alice -> Charlie
  assert.equal(await canUsersDirectMessage(db, 3, 4), true); // Bob -> Charlie
  assert.equal(await canUsersDirectMessage(db, 4, 3), true); // Charlie -> Bob (汇报)
  assert.equal(await canUsersDirectMessage(db, 4, 2), true); // Charlie -> Alice (向上汇报)

  // b) 研发部普通组员 Charlie 的通讯录可见性过滤：
  // Charlie 只能看到 本组的两位组长 (Alice, Bob) 以及 超级管理员 (Admin)，看不到其他普通组员或外围成员
  const charlieView = await listActiveUsers(db, 4, false);
  assert.deepEqual(charlieView.map(u => u.username).sort(), ['admin_super', 'boss_alice', 'lead_bob']);

  // c) 总负责人 Alice 跨组负责，可见性覆盖研发部全部人员 + 市场部全部人员 + 超级管理员
  const aliceView = await listActiveUsers(db, 2, false);
  assert.deepEqual(aliceView.map(u => u.username).sort(), ['admin_super', 'dev_charlie', 'lead_bob', 'mkt_dave']);

  // 7. 重新开启研发部组员私聊 (allow_member_dm = true)：
  await updateUserGroup(db, groupDev.id, { allowMemberDm: true });
  // 重新恢复同组互聊
  const charlieViewOpen = await listActiveUsers(db, 4, false);
  assert.deepEqual(charlieViewOpen.map(u => u.username).sort(), ['admin_super', 'boss_alice', 'lead_bob']);
});

test('管理端 API PUT /api/admin/groups/:id/members/:userId/role 设置成员组长角色', async () => {
  const db = createTestDb();
  const group = await createUserGroup(db, { name: '测试组' });
  await addGroupMembers(db, group.id, [3]);

  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('session', { userId: 1, isAdmin: true });
    await next();
  });
  registerAdminRoutes(app);

  const res = await app.request(`/api/admin/groups/${group.id}/members/3/role`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ role: 'leader' })
  }, { DB: db });

  assert.equal(res.status, 200);
  const members = await getGroupMembers(db, group.id);
  assert.equal(members[0].isLeader, true);
  assert.equal(members[0].role, 'leader');
});
