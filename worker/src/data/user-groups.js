import { mapUserSummary } from './users.js';

let schemaInitialized = false;
const GROUPS_CACHE_TTL_MS = 30 * 1000;
const DM_POLICY_CACHE_TTL_MS = 15 * 1000;
let hasActiveGroupsCache = null;
const dmPolicyCache = new Map();

export function invalidateGroupsCache() {
  hasActiveGroupsCache = null;
  dmPolicyCache.clear();
}

export async function ensureUserGroupsSchema(db) {
  if (schemaInitialized) return;
  try {
    await db.batch([
      db.prepare(`
        CREATE TABLE IF NOT EXISTS user_groups (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL UNIQUE,
          description TEXT NOT NULL DEFAULT '',
          allow_member_dm INTEGER NOT NULL DEFAULT 1 CHECK (allow_member_dm IN (0, 1)),
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          deleted_at TEXT
        )
      `),
      db.prepare(`
        CREATE TABLE IF NOT EXISTS user_group_members (
          group_id INTEGER NOT NULL,
          user_id INTEGER NOT NULL,
          role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('leader', 'member')),
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (group_id, user_id),
          FOREIGN KEY (group_id) REFERENCES user_groups(id) ON DELETE CASCADE,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
      `),
      db.prepare(`CREATE INDEX IF NOT EXISTS idx_user_group_members_user ON user_group_members(user_id)`),
      db.prepare(`CREATE INDEX IF NOT EXISTS idx_user_group_members_group ON user_group_members(group_id)`)
    ]);
    try {
      await db.prepare(`ALTER TABLE user_groups ADD COLUMN allow_member_dm INTEGER NOT NULL DEFAULT 1 CHECK (allow_member_dm IN (0, 1))`).run();
    } catch {}
    try {
      await db.prepare(`ALTER TABLE user_group_members ADD COLUMN role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('leader', 'member'))`).run();
    } catch {}
    schemaInitialized = true;
  } catch (err) {
    console.warn('[user-groups schema ensure]', err.message);
  }
}

export async function hasAnyActiveGroups(db) {
  const now = Date.now();
  if (hasActiveGroupsCache && now < hasActiveGroupsCache.exp) {
    return hasActiveGroupsCache.value;
  }
  await ensureUserGroupsSchema(db);
  try {
    const { results } = await db
      .prepare('SELECT 1 FROM user_groups WHERE deleted_at IS NULL LIMIT 1')
      .all();
    const val = Boolean(results[0]);
    hasActiveGroupsCache = { value: val, exp: now + GROUPS_CACHE_TTL_MS };
    return val;
  } catch {
    return false;
  }
}

export async function listUserGroups(db) {
  await ensureUserGroupsSchema(db);
  const { results } = await db
    .prepare(
      `SELECT g.id, g.name, g.description, g.allow_member_dm, g.created_at, g.updated_at,
              COUNT(ugm.user_id) AS member_count,
              SUM(CASE WHEN ugm.role = 'leader' THEN 1 ELSE 0 END) AS leader_count
       FROM user_groups g
       LEFT JOIN user_group_members ugm ON g.id = ugm.group_id
       LEFT JOIN users u ON ugm.user_id = u.id AND u.deleted_at IS NULL
       WHERE g.deleted_at IS NULL
       GROUP BY g.id
       ORDER BY g.name ASC`
    )
    .all();

  return results.map((row) => ({
    id: Number(row.id),
    name: row.name,
    description: row.description || '',
    allowMemberDm: Boolean(row.allow_member_dm !== 0 && row.allow_member_dm !== '0'),
    memberCount: Number(row.member_count || 0),
    leaderCount: Number(row.leader_count || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));
}

export async function getUserGroupById(db, id) {
  await ensureUserGroupsSchema(db);
  const { results } = await db
    .prepare(
      `SELECT id, name, description, allow_member_dm, created_at, updated_at
       FROM user_groups
       WHERE id = ? AND deleted_at IS NULL
       LIMIT 1`
    )
    .bind(Number(id))
    .all();

  if (!results[0]) return null;
  return {
    id: Number(results[0].id),
    name: results[0].name,
    description: results[0].description || '',
    allowMemberDm: Boolean(results[0].allow_member_dm !== 0 && results[0].allow_member_dm !== '0'),
    createdAt: results[0].created_at,
    updatedAt: results[0].updated_at
  };
}

export async function createUserGroup(db, { name, description = '', allowMemberDm = true }) {
  await ensureUserGroupsSchema(db);
  const cleanName = String(name || '').trim();
  if (!cleanName) {
    throw new Error('分组名称不能为空');
  }

  const allowDmVal = allowMemberDm !== false ? 1 : 0;
  const existing = await db
    .prepare(
      `SELECT id, deleted_at FROM user_groups WHERE name = ? LIMIT 1`
    )
    .bind(cleanName)
    .all();

  if (existing.results[0]) {
    if (existing.results[0].deleted_at) {
      // 重新激活历史软删除分组
      await db
        .prepare(
          `UPDATE user_groups
           SET description = ?, allow_member_dm = ?, deleted_at = NULL, updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`
        )
        .bind(String(description || '').trim(), allowDmVal, existing.results[0].id)
        .run();
      return getUserGroupById(db, existing.results[0].id);
    }
    throw new Error('已存在同名分组');
  }

  const res = await db
    .prepare(
      `INSERT INTO user_groups (name, description, allow_member_dm) VALUES (?, ?, ?)`
    )
    .bind(cleanName, String(description || '').trim(), allowDmVal)
    .run();

  const id = res.meta?.last_row_id;
  invalidateGroupsCache();
  return getUserGroupById(db, id);
}

export async function updateUserGroup(db, id, { name, description, allowMemberDm }) {
  const groupId = Number(id);
  const group = await getUserGroupById(db, groupId);
  if (!group) {
    throw new Error('分组不存在或已被删除');
  }

  const cleanName = name !== undefined ? String(name).trim() : group.name;
  const cleanDesc = description !== undefined ? String(description).trim() : group.description;
  const cleanAllowDm = allowMemberDm !== undefined ? (allowMemberDm ? 1 : 0) : (group.allowMemberDm ? 1 : 0);

  if (!cleanName) {
    throw new Error('分组名称不能为空');
  }

  // 检查名称冲突
  if (cleanName !== group.name) {
    const conflict = await db
      .prepare(
        `SELECT id FROM user_groups WHERE name = ? AND id != ? AND deleted_at IS NULL LIMIT 1`
      )
      .bind(cleanName, groupId)
      .all();
    if (conflict.results[0]) {
      throw new Error('已存在同名分组');
    }
  }

  await db
    .prepare(
      `UPDATE user_groups
       SET name = ?, description = ?, allow_member_dm = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    )
    .bind(cleanName, cleanDesc, cleanAllowDm, groupId)
    .run();

  invalidateGroupsCache();
  return getUserGroupById(db, groupId);
}

export async function deleteUserGroup(db, id) {
  await ensureUserGroupsSchema(db);
  const groupId = Number(id);
  // 删除成员关联并软删除分组
  await db.batch([
    db.prepare(`DELETE FROM user_group_members WHERE group_id = ?`).bind(groupId),
    db
      .prepare(
        `UPDATE user_groups
         SET deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      )
      .bind(groupId)
  ]);
  invalidateGroupsCache();
  return true;
}

export async function getGroupMembers(db, groupId) {
  await ensureUserGroupsSchema(db);
  const { results } = await db
    .prepare(
      `SELECT u.id, u.username, u.display_name, u.avatar_key, u.is_admin, u.last_active_at,
              ugm.role, ugm.created_at AS joined_at
       FROM user_group_members ugm
       JOIN users u ON ugm.user_id = u.id
       WHERE ugm.group_id = ? AND u.deleted_at IS NULL AND u.is_disabled = 0
       ORDER BY CASE ugm.role WHEN 'leader' THEN 0 ELSE 1 END, u.display_name ASC`
    )
    .bind(Number(groupId))
    .all();

  return results.map((row) => ({
    ...mapUserSummary(row),
    isAdmin: Boolean(row.is_admin),
    role: row.role || 'member',
    isLeader: row.role === 'leader',
    joinedAt: row.joined_at
  }));
}

export async function setGroupMemberRole(db, groupId, userId, role = 'member') {
  await ensureUserGroupsSchema(db);
  const gid = Number(groupId);
  const uid = Number(userId);
  const cleanRole = role === 'leader' ? 'leader' : 'member';

  const res = await db
    .prepare(
      `UPDATE user_group_members
       SET role = ?
       WHERE group_id = ? AND user_id = ?`
    )
    .bind(cleanRole, gid, uid)
    .run();

  invalidateGroupsCache();
  return Number(res.meta?.changes || 0) > 0;
}

export async function addGroupMembers(db, groupId, userIds) {
  await ensureUserGroupsSchema(db);
  const gid = Number(groupId);
  const ids = (Array.isArray(userIds) ? userIds : [userIds])
    .map(Number)
    .filter((id) => Number.isInteger(id) && id > 0);

  if (!ids.length) return 0;

  const stmts = ids.map((uid) =>
    db
      .prepare(
        `INSERT OR IGNORE INTO user_group_members (group_id, user_id) VALUES (?, ?)`
      )
      .bind(gid, uid)
  );

  await db.batch(stmts);
  invalidateGroupsCache();
  return ids.length;
}

export async function removeGroupMember(db, groupId, userId) {
  await ensureUserGroupsSchema(db);
  await db
    .prepare(
      `DELETE FROM user_group_members WHERE group_id = ? AND user_id = ?`
    )
    .bind(Number(groupId), Number(userId))
    .run();
  invalidateGroupsCache();
  return true;
}

export async function getUserGroupsForUsers(db, userIds) {
  await ensureUserGroupsSchema(db);
  const ids = (Array.isArray(userIds) ? userIds : [userIds])
    .map(Number)
    .filter((id) => Number.isInteger(id) && id > 0);

  if (!ids.length) return {};

  const placeholders = ids.map(() => '?').join(',');
  const { results } = await db
    .prepare(
      `SELECT ugm.user_id, ugm.role, g.id AS group_id, g.name AS group_name, g.allow_member_dm
       FROM user_group_members ugm
       JOIN user_groups g ON ugm.group_id = g.id
       WHERE ugm.user_id IN (${placeholders}) AND g.deleted_at IS NULL
       ORDER BY g.name ASC`
    )
    .bind(...ids)
    .all();

  const map = {};
  for (const uid of ids) {
    map[uid] = [];
  }

  for (const row of results) {
    const uid = Number(row.user_id);
    if (map[uid]) {
      map[uid].push({
        id: Number(row.group_id),
        name: row.group_name,
        role: row.role || 'member',
        isLeader: row.role === 'leader',
        allowMemberDm: Boolean(row.allow_member_dm !== 0 && row.allow_member_dm !== '0')
      });
    }
  }

  return map;
}

export async function canUsersDirectMessage(db, actorId, targetUserId) {
  const actor = Number(actorId);
  const target = Number(targetUserId);

  if (!Number.isFinite(actor) || !Number.isFinite(target) || actor === target) {
    return false;
  }

  const cacheKey = `${actor}:${target}`;
  const now = Date.now();
  const cached = dmPolicyCache.get(cacheKey);
  if (cached && now < cached.exp) {
    return cached.allowed;
  }

  // 1. 如果系统内没有任何已创建的分组，属于全开放模式
  const hasGroups = await hasAnyActiveGroups(db);
  if (!hasGroups) {
    dmPolicyCache.set(cacheKey, { allowed: true, exp: now + DM_POLICY_CACHE_TTL_MS });
    return true;
  }

  // 2. 检查发起者或目标是否为管理员（管理员全通）
  const adminCheck = await db
    .prepare(
      `SELECT id, is_admin FROM users WHERE id IN (?, ?) AND deleted_at IS NULL AND is_disabled = 0`
    )
    .bind(actor, target)
    .all();

  if (adminCheck.results.some((u) => Boolean(u.is_admin))) {
    dmPolicyCache.set(cacheKey, { allowed: true, exp: now + DM_POLICY_CACHE_TTL_MS });
    return true;
  }

  // 3. 检查是否有共同的有效企业分组及其角色/私聊策略
  const { results } = await db
    .prepare(
      `SELECT g.id, g.allow_member_dm,
              a.role AS actor_role,
              b.role AS target_role
       FROM user_group_members a
       JOIN user_group_members b ON a.group_id = b.group_id
       JOIN user_groups g ON a.group_id = g.id
       WHERE a.user_id = ?
         AND b.user_id = ?
         AND g.deleted_at IS NULL`
    )
    .bind(actor, target)
    .all();

  const commonGroups = results || [];
  if (commonGroups.length === 0) {
    dmPolicyCache.set(cacheKey, { allowed: false, exp: now + DM_POLICY_CACHE_TTL_MS });
    return false;
  }

  // 只要在任意一个共同分组中满足以下任一条件即可私聊：
  // a) 发起方在该组是组长 (actor_role === 'leader')
  // b) 接收方在该组是组长 (target_role === 'leader')
  // c) 该组开启了组员互发私聊策略 (allow_member_dm !== 0)
  for (const cg of commonGroups) {
    if (cg.actor_role === 'leader' || cg.target_role === 'leader') {
      dmPolicyCache.set(cacheKey, { allowed: true, exp: now + DM_POLICY_CACHE_TTL_MS });
      return true;
    }
    if (cg.allow_member_dm !== 0 && cg.allow_member_dm !== '0') {
      dmPolicyCache.set(cacheKey, { allowed: true, exp: now + DM_POLICY_CACHE_TTL_MS });
      return true;
    }
  }

  dmPolicyCache.set(cacheKey, { allowed: false, exp: now + DM_POLICY_CACHE_TTL_MS });
  return false;
}

export async function listManagedGroupsForUser(db, userId) {
  await ensureUserGroupsSchema(db);
  const uid = Number(userId);
  const user = await db.prepare('SELECT is_admin FROM users WHERE id = ? AND deleted_at IS NULL LIMIT 1').bind(uid).first();
  const isAdmin = Boolean(user?.is_admin);

  if (isAdmin) {
    return listUserGroups(db);
  }

  const { results } = await db.prepare(
    `SELECT g.id, g.name, g.description, g.allow_member_dm, g.created_at, g.updated_at,
            COUNT(ugm.user_id) AS member_count,
            SUM(CASE WHEN ugm.role = 'leader' THEN 1 ELSE 0 END) AS leader_count
     FROM user_groups g
     JOIN user_group_members leader_m ON g.id = leader_m.group_id AND leader_m.user_id = ? AND leader_m.role = 'leader'
     LEFT JOIN user_group_members ugm ON g.id = ugm.group_id
     LEFT JOIN users u ON ugm.user_id = u.id AND u.deleted_at IS NULL
     WHERE g.deleted_at IS NULL
     GROUP BY g.id
     ORDER BY g.name ASC`
  ).bind(uid).all();

  return (results || []).map((row) => ({
    id: Number(row.id),
    name: row.name,
    description: row.description || '',
    allowMemberDm: Boolean(row.allow_member_dm !== 0 && row.allow_member_dm !== '0'),
    memberCount: Number(row.member_count || 0),
    leaderCount: Number(row.leader_count || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));
}
