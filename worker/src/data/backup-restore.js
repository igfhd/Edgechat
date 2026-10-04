// @ts-check
import { ApiError } from '../errors.js';

/**
 * 导出数据库核心配置与用户数据（不包含历史聊天消息，不包含用户私钥与安全口令备份）
 * @param {any} db
 * @param {{ userId?: number, username?: string }} [exporter]
 */
export async function exportDatabaseBackup(db, exporter = {}) {
  // 1. 用户表（仅导出账号基础身份、哈希密码及状态，不导出任何 E2EE 私钥与口令）
  const { results: users } = await db.prepare(
    `SELECT id, username, display_name, password_hash, password_salt, avatar_key,
            is_disabled, is_admin, session_version, created_at, updated_at, deleted_at
     FROM users
     ORDER BY id ASC`
  ).all();

  // 2. 用户分组
  const { results: userGroups } = await db.prepare(
    `SELECT id, name, description, created_at, updated_at, deleted_at
     FROM user_groups
     ORDER BY id ASC`
  ).all();

  // 3. 用户分组关联
  const { results: userGroupMembers } = await db.prepare(
    `SELECT ug.name AS group_name, u.username AS username, ugm.created_at
     FROM user_group_members ugm
     JOIN user_groups ug ON ugm.group_id = ug.id
     JOIN users u ON ugm.user_id = u.id
     WHERE ug.deleted_at IS NULL AND u.deleted_at IS NULL
     ORDER BY ugm.created_at ASC`
  ).all();

  // 4. 频道与群聊（不含消息，仅元数据）
  const { results: channels } = await db.prepare(
    `SELECT c.id, c.name, c.description, c.avatar_key, c.kind, c.dm_key,
            u.username AS creator_username, c.created_at, c.deleted_at
     FROM channels c
     LEFT JOIN users u ON c.created_by = u.id
     WHERE c.deleted_at IS NULL
     ORDER BY c.id ASC`
  ).all();

  // 5. 频道与群聊成员关系
  const { results: channelMembers } = await db.prepare(
    `SELECT c.name AS channel_name, c.kind AS channel_kind, c.dm_key AS channel_dm_key,
            u.username AS username, cm.role, cm.joined_at, inviter.username AS invited_by_username
     FROM channel_members cm
     JOIN channels c ON cm.channel_id = c.id
     JOIN users u ON cm.user_id = u.id
     LEFT JOIN users inviter ON cm.invited_by = inviter.id
     WHERE c.deleted_at IS NULL AND u.deleted_at IS NULL
     ORDER BY cm.joined_at ASC`
  ).all();

  // 6. 系统公告
  const { results: announcements } = await db.prepare(
    `SELECT a.id, a.title, a.content, u.username AS creator_username,
            a.is_pinned, a.is_active, a.priority, a.starts_at, a.expires_at, a.created_at, a.updated_at
     FROM announcements a
     LEFT JOIN users u ON a.creator_id = u.id
     ORDER BY a.priority DESC, a.created_at DESC`
  ).all();

  // 7. 注册邀请链接
  const { results: registrationInvites } = await db.prepare(
    `SELECT ri.token, ri.note, ri.max_uses, ri.used_count,
            ug.name AS group_name, creator.username AS creator_username,
            ri.created_at, ri.consumed_at, ri.deleted_at
     FROM registration_invites ri
     LEFT JOIN user_groups ug ON ri.group_id = ug.id
     LEFT JOIN users creator ON ri.created_by = creator.id
     WHERE ri.deleted_at IS NULL AND ri.used_count < ri.max_uses
     ORDER BY ri.created_at DESC`
  ).all();

  // 8. 站点常规系统设置
  const { results: rawSettings } = await db.prepare(
    `SELECT setting_key, setting_value FROM site_settings
     WHERE setting_key IN (
       'site_name', 'site_icon_url', 'message_retention_days', 'auto_cleanup_enabled',
       'upload_restriction_mode', 'upload_allowed_types', 'upload_blocked_types', 'upload_max_file_size_mb'
     )`
  ).all();
  const siteSettings = Object.fromEntries((rawSettings || []).map(r => [r.setting_key, r.setting_value]));

  return {
    format: 'edgechat-backup',
    version: 1,
    exportedAt: new Date().toISOString(),
    exporter: {
      userId: exporter.userId || null,
      username: exporter.username || ''
    },
    summary: {
      usersCount: (users || []).length,
      userGroupsCount: (userGroups || []).length,
      channelsCount: (channels || []).length,
      announcementsCount: (announcements || []).length,
      registrationInvitesCount: (registrationInvites || []).length
    },
    data: {
      users: (users || []).map(u => ({
        id: Number(u.id),
        username: u.username,
        displayName: u.display_name,
        passwordHash: u.password_hash,
        passwordSalt: u.password_salt,
        avatarKey: u.avatar_key || null,
        isDisabled: Number(u.is_disabled || 0),
        isAdmin: Number(u.is_admin || 0),
        sessionVersion: Number(u.session_version || 0),
        createdAt: u.created_at,
        updatedAt: u.updated_at,
        deletedAt: u.deleted_at || null
      })),
      userGroups: (userGroups || []).map(g => ({
        id: Number(g.id),
        name: g.name,
        description: g.description || '',
        createdAt: g.created_at,
        updatedAt: g.updated_at,
        deletedAt: g.deleted_at || null
      })),
      userGroupMembers: (userGroupMembers || []).map(m => ({
        groupName: m.group_name,
        username: m.username,
        createdAt: m.created_at
      })),
      channels: (channels || []).map(c => ({
        id: Number(c.id),
        name: c.name,
        description: c.description || '',
        avatarKey: c.avatar_key || null,
        kind: c.kind,
        dmKey: c.dm_key || null,
        creatorUsername: c.creator_username || null,
        createdAt: c.created_at,
        deletedAt: c.deleted_at || null
      })),
      channelMembers: (channelMembers || []).map(m => ({
        channelName: m.channel_name,
        channelKind: m.channel_kind,
        channelDmKey: m.channel_dm_key || null,
        username: m.username,
        role: m.role,
        joinedAt: m.joined_at,
        invitedByUsername: m.invited_by_username || null
      })),
      announcements: (announcements || []).map(a => ({
        id: Number(a.id),
        title: a.title,
        content: a.content,
        creatorUsername: a.creator_username || null,
        isPinned: Number(a.is_pinned || 0),
        isActive: Number(a.is_active || 0),
        priority: Number(a.priority || 0),
        startsAt: a.starts_at || null,
        expiresAt: a.expires_at || null,
        createdAt: a.created_at,
        updatedAt: a.updated_at
      })),
      registrationInvites: (registrationInvites || []).map(i => ({
        token: i.token,
        note: i.note || '',
        maxUses: Number(i.max_uses),
        usedCount: Number(i.used_count),
        groupName: i.group_name || null,
        creatorUsername: i.creator_username || null,
        createdAt: i.created_at,
        consumedAt: i.consumed_at || null,
        deletedAt: i.deleted_at || null
      })),
      siteSettings
    }
  };
}

/**
 * 预检解析备份文件并分析冲突
 * @param {any} db
 * @param {any} backupPayload
 * @param {number} currentAdminUserId
 */
export async function previewBackupData(db, backupPayload, currentAdminUserId) {
  if (!backupPayload || typeof backupPayload !== 'object') {
    throw new ApiError('无效的备份文件格式');
  }
  const data = backupPayload.data || backupPayload;
  const backupUsers = Array.isArray(data.users) ? data.users : [];
  if (backupUsers.length === 0) {
    throw new ApiError('备份文件中没有找到任何用户数据');
  }

  const { results: existingUsers } = await db.prepare(
    'SELECT id, username, display_name, is_admin FROM users'
  ).all();
  const existingUserMap = new Map((existingUsers || []).map(u => [String(u.username).toLowerCase(), u]));

  const currentAdmin = (existingUsers || []).find(u => Number(u.id) === Number(currentAdminUserId));

  const conflicts = [];
  let newUsersCount = 0;
  let hasAdminConflict = false;

  for (const u of backupUsers) {
    if (!u.username) continue;
    const existing = existingUserMap.get(String(u.username).toLowerCase());
    if (existing) {
      const isCurrentAdmin = Number(existing.id) === Number(currentAdminUserId);
      const isExistingAdmin = Boolean(Number(existing.is_admin));
      const isSourceAdmin = Boolean(Number(u.isAdmin ?? u.is_admin ?? 0));
      if (isCurrentAdmin || isExistingAdmin || isSourceAdmin) {
        hasAdminConflict = true;
      }
      conflicts.push({
        username: u.username,
        displayName: u.displayName || u.display_name || u.username,
        isExistingAdmin,
        isSourceAdmin,
        isCurrentAdmin
      });
    } else {
      newUsersCount++;
    }
  }

  const backupGroups = Array.isArray(data.userGroups) ? data.userGroups : [];
  const backupChannels = Array.isArray(data.channels) ? data.channels : [];
  const backupAnnouncements = Array.isArray(data.announcements) ? data.announcements : [];
  const backupInvites = Array.isArray(data.registrationInvites) ? data.registrationInvites : [];

  return {
    valid: true,
    version: backupPayload.version || 1,
    exportedAt: backupPayload.exportedAt || null,
    totalUsersInBackup: backupUsers.length,
    newUsersCount,
    conflictsCount: conflicts.length,
    hasAdminConflict,
    currentAdminUsername: currentAdmin?.username || 'admin',
    conflicts,
    groupsCount: backupGroups.length,
    channelsCount: backupChannels.length,
    announcementsCount: backupAnnouncements.length,
    invitesCount: backupInvites.length,
    hasSettings: Boolean(data.siteSettings && Object.keys(data.siteSettings).length > 0)
  };
}

/**
 * 实际执行导入备份数据
 * @param {any} db
 * @param {any} backupPayload
 * @param {{ adminConflictStrategy?: 'keep_current' | 'overwrite', userConflictStrategy?: 'skip' | 'update', importSettings?: boolean }} options
 * @param {number} currentAdminUserId
 */
export async function importBackupData(db, backupPayload, options = {}, currentAdminUserId) {
  const {
    adminConflictStrategy = 'keep_current',
    userConflictStrategy = 'skip',
    importSettings = false
  } = options;

  if (!backupPayload || typeof backupPayload !== 'object') {
    throw new ApiError('无效的备份数据');
  }
  const data = backupPayload.data || backupPayload;
  const backupUsers = Array.isArray(data.users) ? data.users : [];
  if (backupUsers.length === 0) {
    throw new ApiError('备份文件中未包含任何用户数据');
  }

  // 1. 用户写入与更新
  const { results: existingUsers } = await db.prepare(
    'SELECT id, username, display_name, password_hash, password_salt, is_admin FROM users'
  ).all();
  const existingUserMap = new Map((existingUsers || []).map(u => [String(u.username).toLowerCase(), u]));

  let usersCreated = 0;
  let usersUpdated = 0;
  let usersSkipped = 0;

  for (const u of backupUsers) {
    if (!u.username) continue;
    const usernameKey = String(u.username).toLowerCase();
    const existing = existingUserMap.get(usernameKey);
    const isAdmin = Boolean(Number(u.isAdmin ?? u.is_admin ?? 0));
    const isDisabled = Number(u.isDisabled ?? u.is_disabled ?? 0);
    const displayName = String(u.displayName || u.display_name || u.username);
    const passwordHash = u.passwordHash || u.password_hash || '';
    const passwordSalt = u.passwordSalt || u.password_salt || '';
    const avatarKey = u.avatarKey || u.avatar_key || null;

    if (existing) {
      const isCurrentAdmin = Number(existing.id) === Number(currentAdminUserId);
      const isExistingAdmin = Boolean(Number(existing.is_admin));

      if (isCurrentAdmin || isExistingAdmin) {
        if (adminConflictStrategy === 'overwrite' && !isCurrentAdmin) {
          await db.prepare(
            `UPDATE users
             SET display_name = ?, password_hash = ?, password_salt = ?, avatar_key = ?, is_disabled = ?, is_admin = 1, updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`
          ).bind(displayName, passwordHash, passwordSalt, avatarKey, isDisabled, existing.id).run();
          usersUpdated++;
        } else {
          // keep_current 或当前正在操作的管理员：保护密码与权限不被覆盖
          usersSkipped++;
        }
      } else {
        if (userConflictStrategy === 'update') {
          await db.prepare(
            `UPDATE users
             SET display_name = ?, password_hash = ?, password_salt = ?, avatar_key = ?, is_disabled = ?, updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`
          ).bind(displayName, passwordHash, passwordSalt, avatarKey, isDisabled, existing.id).run();
          usersUpdated++;
        } else {
          usersSkipped++;
        }
      }
    } else {
      await db.prepare(
        `INSERT INTO users (username, display_name, password_hash, password_salt, avatar_key, is_disabled, is_admin, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        u.username,
        displayName,
        passwordHash,
        passwordSalt,
        avatarKey,
        isDisabled,
        isAdmin ? 1 : 0,
        u.createdAt || u.created_at || new Date().toISOString(),
        u.updatedAt || u.updated_at || new Date().toISOString()
      ).run();
      usersCreated++;
    }
  }

  // 刷新用户映射 username -> user_id
  const { results: allUsers } = await db.prepare('SELECT id, username FROM users').all();
  const userMap = new Map((allUsers || []).map(u => [String(u.username).toLowerCase(), Number(u.id)]));

  // 保证系统群通用成员关系
  await db.prepare(
    `INSERT OR IGNORE INTO channel_members (channel_id, user_id, role, invited_by)
     SELECT c.id, u.id, 'member', NULL
     FROM channels c
     CROSS JOIN users u
     WHERE c.name = 'general'
       AND c.kind = 'public'
       AND c.deleted_at IS NULL
       AND u.deleted_at IS NULL`
  ).run();

  // 2. 用户分组
  let groupsCreated = 0;
  const backupGroups = Array.isArray(data.userGroups) ? data.userGroups : [];
  for (const g of backupGroups) {
    if (!g.name) continue;
    const exists = await db.prepare('SELECT id FROM user_groups WHERE name = ? AND deleted_at IS NULL').bind(g.name).first();
    if (!exists) {
      await db.prepare(
        `INSERT INTO user_groups (name, description, created_at)
         VALUES (?, ?, ?)`
      ).bind(g.name, g.description || '', g.createdAt || g.created_at || new Date().toISOString()).run();
      groupsCreated++;
    }
  }

  // 刷新分组映射 group_name -> group_id
  const { results: allGroups } = await db.prepare('SELECT id, name FROM user_groups WHERE deleted_at IS NULL').all();
  const groupMap = new Map((allGroups || []).map(g => [String(g.name).toLowerCase(), Number(g.id)]));

  // 3. 用户分组关联
  const backupGroupMembers = Array.isArray(data.userGroupMembers) ? data.userGroupMembers : [];
  for (const m of backupGroupMembers) {
    const groupId = groupMap.get(String(m.groupName || m.group_name || '').toLowerCase());
    const userId = userMap.get(String(m.username || '').toLowerCase());
    if (groupId && userId) {
      await db.prepare(
        `INSERT OR IGNORE INTO user_group_members (group_id, user_id, created_at)
         VALUES (?, ?, ?)`
      ).bind(groupId, userId, m.createdAt || m.created_at || new Date().toISOString()).run();
    }
  }

  // 4. 频道与群聊（不含消息，只创建群聊外壳）
  let channelsCreated = 0;
  const backupChannels = Array.isArray(data.channels) ? data.channels : [];
  for (const c of backupChannels) {
    if (!c.name && !c.dmKey && !c.dm_key) continue;
    const dmKey = c.dmKey || c.dm_key || null;
    let existingChannel = null;
    if (dmKey) {
      existingChannel = await db.prepare('SELECT id FROM channels WHERE dm_key = ? AND deleted_at IS NULL').bind(dmKey).first();
    } else if (c.name) {
      existingChannel = await db.prepare('SELECT id FROM channels WHERE name = ? AND deleted_at IS NULL').bind(c.name).first();
    }
    if (!existingChannel) {
      const creatorUsername = c.creatorUsername || c.creator_username;
      const creatorId = creatorUsername ? (userMap.get(String(creatorUsername).toLowerCase()) || null) : null;
      await db.prepare(
        `INSERT INTO channels (name, description, avatar_key, kind, dm_key, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        c.name || '',
        c.description || '',
        c.avatarKey || c.avatar_key || null,
        c.kind || 'public',
        dmKey,
        creatorId,
        c.createdAt || c.created_at || new Date().toISOString()
      ).run();
      channelsCreated++;
    }
  }

  // 刷新频道映射
  const { results: allChannels } = await db.prepare('SELECT id, name, kind, dm_key FROM channels WHERE deleted_at IS NULL').all();
  const channelNameMap = new Map((allChannels || []).filter(c => c.name).map(c => [String(c.name).toLowerCase(), Number(c.id)]));
  const channelDmMap = new Map((allChannels || []).filter(c => c.dm_key).map(c => [String(c.dm_key), Number(c.id)]));

  // 5. 频道成员关系
  const backupChannelMembers = Array.isArray(data.channelMembers) ? data.channelMembers : [];
  for (const cm of backupChannelMembers) {
    const channelId = cm.channelDmKey ? channelDmMap.get(cm.channelDmKey) : channelNameMap.get(String(cm.channelName || cm.channel_name || '').toLowerCase());
    const userId = userMap.get(String(cm.username || '').toLowerCase());
    if (channelId && userId) {
      const inviterUsername = cm.invitedByUsername || cm.invited_by_username;
      const inviterId = inviterUsername ? (userMap.get(String(inviterUsername).toLowerCase()) || null) : null;
      await db.prepare(
        `INSERT OR IGNORE INTO channel_members (channel_id, user_id, role, invited_by, joined_at)
         VALUES (?, ?, ?, ?, ?)`
      ).bind(
        channelId,
        userId,
        cm.role || 'member',
        inviterId,
        cm.joinedAt || cm.joined_at || new Date().toISOString()
      ).run();
    }
  }

  // 6. 公告
  let announcementsCreated = 0;
  const backupAnnouncements = Array.isArray(data.announcements) ? data.announcements : [];
  for (const a of backupAnnouncements) {
    if (!a.title || !a.content) continue;
    const exists = await db.prepare(
      'SELECT id FROM announcements WHERE title = ? AND content = ? LIMIT 1'
    ).bind(a.title, a.content).first();
    if (!exists) {
      const creatorUsername = a.creatorUsername || a.creator_username;
      const creatorId = creatorUsername ? (userMap.get(String(creatorUsername).toLowerCase()) || currentAdminUserId) : currentAdminUserId;
      await db.prepare(
        `INSERT INTO announcements (title, content, creator_id, is_pinned, is_active, priority, starts_at, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        a.title,
        a.content,
        creatorId,
        Number(a.isPinned ?? a.is_pinned ?? 0),
        Number(a.isActive ?? a.is_active ?? 1),
        Number(a.priority ?? 0),
        a.startsAt || a.starts_at || null,
        a.expiresAt || a.expires_at || null,
        a.createdAt || a.created_at || new Date().toISOString()
      ).run();
      announcementsCreated++;
    }
  }

  // 7. 注册邀请链接
  let invitesCreated = 0;
  const backupInvites = Array.isArray(data.registrationInvites) ? data.registrationInvites : [];
  for (const ri of backupInvites) {
    if (!ri.token) continue;
    const exists = await db.prepare('SELECT id FROM registration_invites WHERE token = ?').bind(ri.token).first();
    if (!exists) {
      const creatorUsername = ri.creatorUsername || ri.creator_username;
      const creatorId = creatorUsername ? (userMap.get(String(creatorUsername).toLowerCase()) || currentAdminUserId) : currentAdminUserId;
      const groupName = ri.groupName || ri.group_name;
      const groupId = groupName ? (groupMap.get(String(groupName).toLowerCase()) || null) : null;
      await db.prepare(
        `INSERT OR IGNORE INTO registration_invites (token, note, max_uses, used_count, group_id, created_by, created_at, consumed_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        ri.token,
        ri.note || '',
        Number(ri.maxUses || ri.max_uses || 1),
        Number(ri.usedCount || ri.used_count || 0),
        groupId,
        creatorId,
        ri.createdAt || ri.created_at || new Date().toISOString(),
        ri.consumedAt || ri.consumed_at || null,
        ri.deletedAt || ri.deleted_at || null
      ).run();
      invitesCreated++;
    }
  }

  // 8. 站点设置（可选）
  if (importSettings && data.siteSettings && typeof data.siteSettings === 'object') {
    const allowedKeys = [
      'site_name', 'site_icon_url', 'message_retention_days', 'auto_cleanup_enabled',
      'upload_restriction_mode', 'upload_allowed_types', 'upload_blocked_types', 'upload_max_file_size_mb'
    ];
    for (const [k, v] of Object.entries(data.siteSettings)) {
      if (allowedKeys.includes(k) && typeof v === 'string') {
        await db.prepare(
          `INSERT INTO site_settings (setting_key, setting_value, updated_at)
           VALUES (?, ?, CURRENT_TIMESTAMP)
           ON CONFLICT(setting_key) DO UPDATE
           SET setting_value = excluded.setting_value, updated_at = CURRENT_TIMESTAMP`
        ).bind(k, v).run();
      }
    }
  }

  return {
    ok: true,
    imported: {
      usersCreated,
      usersUpdated,
      usersSkipped,
      groupsCreated,
      channelsCreated,
      announcementsCreated,
      invitesCreated
    }
  };
}

