import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import initSqlJs from 'sql.js';
import {
  createUserGroup,
  updateUserGroup,
  deleteUserGroup,
  listUserGroups,
  getGroupMembers,
  addGroupMembers,
  removeGroupMember,
  getUserGroupsForUsers,
  canUsersDirectMessage,
  hasAnyActiveGroups
} from '../worker/src/data/user-groups.js';
import {
  createRegistrationInvite,
  createUserWithRegistrationInvite,
  getAvailableRegistrationInvite
} from '../worker/src/data/registration-invites.js';
import { listActiveUsers } from '../worker/src/data/users.js';
import { adminNavigation, adminRouteIcons } from '../frontend/src/admin/navigation.js';

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
      last_active_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      deleted_at TEXT
    );

    CREATE TABLE user_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL DEFAULT '',
      allow_member_dm INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      deleted_at TEXT
    );

    CREATE TABLE user_group_members (
      group_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (group_id, user_id),
      FOREIGN KEY (group_id) REFERENCES user_groups(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX idx_user_group_members_user ON user_group_members(user_id);
    CREATE INDEX idx_user_group_members_group ON user_group_members(group_id);

    CREATE TABLE registration_invites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token TEXT NOT NULL UNIQUE,
      note TEXT NOT NULL DEFAULT '',
      max_uses INTEGER NOT NULL DEFAULT 1,
      used_count INTEGER NOT NULL DEFAULT 0,
      group_id INTEGER,
      created_by INTEGER,
      consumed_by_user_id INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      consumed_at TEXT,
      deleted_at TEXT,
      FOREIGN KEY (group_id) REFERENCES user_groups(id) ON DELETE SET NULL,
      FOREIGN KEY (created_by) REFERENCES users(id),
      FOREIGN KEY (consumed_by_user_id) REFERENCES users(id)
    );

    CREATE TABLE registration_invite_uses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invite_id INTEGER NOT NULL,
      user_id INTEGER,
      used_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (invite_id, user_id),
      FOREIGN KEY (invite_id) REFERENCES registration_invites(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE channels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      kind TEXT NOT NULL DEFAULT 'public',
      dm_key TEXT UNIQUE,
      created_by INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      deleted_at TEXT
    );

    CREATE TABLE channel_members (
      channel_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      invited_by INTEGER,
      joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (channel_id, user_id),
      FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  return {
    raw: db,
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
    },
    async batch(stmts) {
      const results = [];
      for (const stmt of stmts) {
        results.push(await stmt.run());
      }
      return results;
    }
  };
}

test('用户分组 CRUD 及成员分配基础功能', async () => {
  const db = createMockD1Database();

  // 创建用户: admin (id:1), userA (id:2), userB (id:3), userC (id:4)
  await db.prepare("INSERT INTO users (id, username, display_name, password_hash, password_salt, is_admin) VALUES (1, 'admin', '管理员', 'h', 's', 1)").run();
  await db.prepare("INSERT INTO users (id, username, display_name, password_hash, password_salt, is_admin) VALUES (2, 'user_a', '张三', 'h', 's', 0)").run();
  await db.prepare("INSERT INTO users (id, username, display_name, password_hash, password_salt, is_admin) VALUES (3, 'user_b', '李四', 'h', 's', 0)").run();
  await db.prepare("INSERT INTO users (id, username, display_name, password_hash, password_salt, is_admin) VALUES (4, 'user_c', '王五', 'h', 's', 0)").run();

  // 1. 创建分组
  const group1 = await createUserGroup(db, { name: '研发组', description: '技术研发与架构' });
  assert.equal(group1.name, '研发组');
  assert.equal(group1.description, '技术研发与架构');

  const group2 = await createUserGroup(db, { name: '市场组', description: '市场运营与拓展' });
  assert.equal(group2.name, '市场组');

  // 重名创建检测
  await assert.rejects(async () => {
    await createUserGroup(db, { name: '研发组' });
  }, /已存在同名分组/);

  // 2. 添加成员
  await addGroupMembers(db, group1.id, [2, 3]); // 张三, 李四 加入研发组
  await addGroupMembers(db, group2.id, [3, 4]); // 李四, 王五 加入市场组 (李四身兼两组)

  // 3. 获取成员
  const members1 = await getGroupMembers(db, group1.id);
  assert.equal(members1.length, 2);
  assert.deepEqual(members1.map(m => m.username).sort(), ['user_a', 'user_b']);

  // 4. 批量查询用户所属分组
  const groupsMap = await getUserGroupsForUsers(db, [2, 3, 4]);
  assert.equal(groupsMap[2].length, 1);
  assert.equal(groupsMap[2][0].name, '研发组');
  assert.equal(groupsMap[3].length, 2); // 李四属于两个分组
  assert.equal(groupsMap[4].length, 1);
  assert.equal(groupsMap[4][0].name, '市场组');

  // 5. 更新分组信息
  const updated = await updateUserGroup(db, group1.id, { name: '研发一部', description: '核心研发' });
  assert.equal(updated.name, '研发一部');

  // 6. 移除成员
  await removeGroupMember(db, group1.id, 2);
  const members1After = await getGroupMembers(db, group1.id);
  assert.equal(members1After.length, 1);
  assert.equal(members1After[0].username, 'user_b');

  // 7. 删除分组
  await deleteUserGroup(db, group2.id);
  const listAfterDelete = await listUserGroups(db);
  assert.equal(listAfterDelete.length, 1);
  assert.equal(listAfterDelete[0].name, '研发一部');
});

test('基于分组交集的私聊鉴权与可见性隔离 (canUsersDirectMessage & listActiveUsers)', async () => {
  const db = createMockD1Database();

  // 创建用户: admin (id:1), userA (id:2), userB (id:3), userC (id:4), userIsolated (id:5)
  await db.prepare("INSERT INTO users (id, username, display_name, password_hash, password_salt, is_admin) VALUES (1, 'admin', '站长', 'h', 's', 1)").run();
  await db.prepare("INSERT INTO users (id, username, display_name, password_hash, password_salt, is_admin) VALUES (2, 'user_a', '张三', 'h', 's', 0)").run();
  await db.prepare("INSERT INTO users (id, username, display_name, password_hash, password_salt, is_admin) VALUES (3, 'user_b', '李四', 'h', 's', 0)").run();
  await db.prepare("INSERT INTO users (id, username, display_name, password_hash, password_salt, is_admin) VALUES (4, 'user_c', '王五', 'h', 's', 0)").run();
  await db.prepare("INSERT INTO users (id, username, display_name, password_hash, password_salt, is_admin) VALUES (5, 'user_iso', '赵六', 'h', 's', 0)").run();

  // 阶段 1: 无任何分组时处于全开放广场模式
  assert.equal(await hasAnyActiveGroups(db), false);
  assert.equal(await canUsersDirectMessage(db, 2, 4), true);
  const openUsers = await listActiveUsers(db, 2, false);
  assert.equal(openUsers.length, 4); // 能看到所有人

  // 阶段 2: 创建分组并分配成员
  const groupDev = await createUserGroup(db, { name: '开发组' });
  const groupOps = await createUserGroup(db, { name: '运维组' });

  await addGroupMembers(db, groupDev.id, [2, 3]); // 张三(2), 李四(3) in 开发组
  await addGroupMembers(db, groupOps.id, [3, 4]); // 李四(3), 王五(4) in 运维组
  // 赵六(5) 未分配到任何组

  // 阶段 3: 严格交集鉴权校验
  // 同组可以私聊: 张三与李四 (同在开发组)
  assert.equal(await canUsersDirectMessage(db, 2, 3), true);
  // 同组可以私聊: 李四与王五 (同在运维组)
  assert.equal(await canUsersDirectMessage(db, 3, 4), true);
  // 跨组禁止私聊: 张三与王五 (无交集)
  assert.equal(await canUsersDirectMessage(db, 2, 4), false);
  // 未分组用户禁止与普通用户私聊: 赵六与张三
  assert.equal(await canUsersDirectMessage(db, 5, 2), false);
  // 管理员全域穿透: 管理员可以与任意成员私聊，任意成员也可以联系管理员
  assert.equal(await canUsersDirectMessage(db, 1, 2), true);
  assert.equal(await canUsersDirectMessage(db, 2, 1), true);
  assert.equal(await canUsersDirectMessage(db, 5, 1), true);

  // 阶段 4: listActiveUsers 可见性过滤
  // 张三 (id:2) 只能看到同组的 李四 (id:3) 以及 管理员 (id:1)
  const zhangsanView = await listActiveUsers(db, 2, false);
  assert.deepEqual(zhangsanView.map(u => u.username).sort(), ['admin', 'user_b']);

  // 王五 (id:4) 只能看到同组的 李四 (id:3) 以及 管理员 (id:1)
  const wangwuView = await listActiveUsers(db, 4, false);
  assert.deepEqual(wangwuView.map(u => u.username).sort(), ['admin', 'user_b']);

  // 李四 (id:3) 属于两个组，能看到 张三(2)、王五(4) 以及 管理员(1)
  const lisiView = await listActiveUsers(db, 3, false);
  assert.deepEqual(lisiView.map(u => u.username).sort(), ['admin', 'user_a', 'user_c']);

  // 未分组的赵六 (id:5) 只能看到 管理员 (id:1)
  const zhaoliuView = await listActiveUsers(db, 5, false);
  assert.deepEqual(zhaoliuView.map(u => u.username), ['admin']);

  // 管理员 (id:1) 请求时可以看到全站所有活跃用户
  const adminView = await listActiveUsers(db, 1, true);
  assert.equal(adminView.length, 4);
});

test('管理后台导航与图标包含用户分组菜单', () => {
  const groupNav = adminNavigation.find(item => item.id === 'groups');
  assert.ok(groupNav, '应该存在 groups 菜单项');
  assert.equal(groupNav.label, '用户分组');
  assert.equal(groupNav.to, '/admin/groups');
  assert.ok(adminRouteIcons.groups, '应该包含 groups 路由图标');
});

test('针对分组的注册邀请链接自动入组与隔离生效', async () => {
  const db = createMockD1Database();

  // 创建初始管理员和分组
  await db.prepare("INSERT INTO users (id, username, display_name, password_hash, password_salt, is_admin) VALUES (1, 'admin', '站长', 'h', 's', 1)").run();
  const groupDesign = await createUserGroup(db, { name: '设计组', description: 'UI/UX 与视觉设计' });

  // 1. 生成绑定「设计组」的注册邀请链接
  const invite = await createRegistrationInvite(db, {
    token: 'design-invite-token-123',
    note: 'UI设计师入职邀请',
    maxUses: 2,
    groupId: groupDesign.id,
    createdBy: 1,
    creatorDisplayName: '站长'
  });
  assert.equal(invite.groupId, groupDesign.id);
  assert.equal(invite.groupName, '设计组');

  // 2. 验证公开查询注册邀请时能解析出绑定的目标分组名称
  const availableInvite = await getAvailableRegistrationInvite(db, 'design-invite-token-123');
  assert.ok(availableInvite);
  assert.equal(availableInvite.groupId, groupDesign.id);
  assert.equal(availableInvite.groupName, '设计组');

  // 3. 用户通过该邀请链接注册
  const newUserId = await createUserWithRegistrationInvite(db, {
    inviteId: availableInvite.id,
    groupId: availableInvite.groupId,
    username: 'designer_bob',
    displayName: '鲍勃',
    passwordHash: 'hash',
    passwordSalt: 'salt'
  });
  assert.ok(newUserId > 0);

  // 4. 验证用户已自动进入「设计组」成员列表
  const designMembers = await getGroupMembers(db, groupDesign.id);
  assert.equal(designMembers.length, 1);
  assert.equal(designMembers[0].username, 'designer_bob');

  // 5. 验证可见性：新注册用户自动隔离在「设计组」，能看到管理员
  const bobView = await listActiveUsers(db, newUserId, false);
  assert.deepEqual(bobView.map(u => u.username), ['admin']);
});
