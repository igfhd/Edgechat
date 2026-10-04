import { AwsClient } from 'aws4fetch';
import { hashPassword } from '../auth.js';
import { listAdminChannels } from '../data/channels.js';
import { listAdminDms } from '../data/dm-queries.js';
import { ensureGeneralChannelMembership } from '../data/general-channel.js';
import {
  createRegistrationInvite,
  listActiveRegistrationInvites,
  MAX_INVITE_USES,
  revokeRegistrationInvite
} from '../data/registration-invites.js';
import { getCallsServerSecret, getSiteSettings, getStorageServerSecret, updateSiteSettings } from '../data/site-settings.js';
import {
  addGroupMembers,
  createUserGroup,
  deleteUserGroup,
  getGroupMembers,
  getUserGroupsForUsers,
  listUserGroups,
  removeGroupMember,
  setGroupMemberRole,
  updateUserGroup
} from '../data/user-groups.js';
import { listAdminUsers, listStorageOwners } from '../data/users.js';
import {
  exportDatabaseBackup,
  previewBackupData,
  importBackupData
} from '../data/backup-restore.js';
import { ApiError } from '../errors.js';
import { runScheduledGc } from '../gc.js';
import { summarizeR2Objects } from '../storage-statistics.js';
import { testGoogleDriveConnection } from '../storage/gdrive.js';
import { banExpiryFromMinutes } from '../user-status.js';
import { errorResponse, parseJsonRequest, randomToken } from '../utils.js';

const STORAGE_SCAN_PAGE_SIZE = 1000;

let adminOverviewCache = null;
const ADMIN_OVERVIEW_CACHE_TTL_MS = 30 * 1000;

export function invalidateAdminOverviewCache() {
  adminOverviewCache = null;
}

export function registerAdminRoutes(app) {
  app.get('/api/admin/storage/scan', async (c) => {
    if (!c.env.FILES) {
      return errorResponse('当前部署没有绑定 R2，无法统计存储空间', 503);
    }

    const cursor = new URL(c.req.url).searchParams.get('cursor') || undefined;
    const listed = await c.env.FILES.list({
      limit: STORAGE_SCAN_PAGE_SIZE,
      ...(cursor ? { cursor } : {}),
      include: []
    });
    const response = {
      items: summarizeR2Objects(listed.objects),
      scannedObjects: listed.objects.length,
      truncated: listed.truncated,
      cursor: listed.truncated ? listed.cursor : null
    };

    if (!cursor) {
      response.users = await listStorageOwners(c.env.DB);
    }

    c.header('Cache-Control', 'private, no-store');
    return c.json(response);
  });

  app.get('/api/admin/overview', async (c) => {
    const now = Date.now();
    if (adminOverviewCache && now < adminOverviewCache.exp) {
      return c.json(adminOverviewCache.data);
    }

    const [users, channels, dms, site] = await Promise.all([
      listAdminUsers(c.env.DB),
      listAdminChannels(c.env.DB, { includeAvatar: false }),
      listAdminDms(c.env.DB),
      getSiteSettings(c.env.DB, c.env)
    ]);

    let driveSummary = { totalFiles: 0, totalBytes: 0 };
    try {
      const driveRes = await c.env.DB.prepare(
        `SELECT COUNT(*) AS total_files, COALESCE(SUM(size), 0) AS total_bytes FROM drive_files WHERE is_folder = 0 AND deleted_at IS NULL AND status = 'active'`
      ).first();
      if (driveRes) {
        driveSummary = { totalFiles: Number(driveRes.total_files || 0), totalBytes: Number(driveRes.total_bytes || 0) };
      }
    } catch {}

    const overviewData = {
      site,
      users,
      channels,
      dms,
      driveSummary
    };
    adminOverviewCache = { data: overviewData, exp: now + ADMIN_OVERVIEW_CACHE_TTL_MS };

    return c.json(overviewData);
  });

  app.get('/api/admin/site-settings', async (c) => {
    const site = await getSiteSettings(c.env.DB, c.env);
    return c.json({ site });
  });

  app.patch('/api/admin/site-settings', async (c) => {
    const payload = await parseJsonRequest(c.req.raw);
    const siteName = payload.siteName !== undefined ? String(payload.siteName || '').trim() : undefined;
    const siteIconUrl = payload.siteIconUrl !== undefined ? String(payload.siteIconUrl || '').trim() : undefined;
    let messageRetentionDays;
    if (payload.messageRetentionDays !== undefined) {
      const days = Number(payload.messageRetentionDays);
      if (!Number.isInteger(days) || days < 1 || days > 3650) {
        return errorResponse('消息保留天数必须是 1 到 3650 之间的整数');
      }
      messageRetentionDays = days;
    }
    const autoCleanupEnabled = payload.autoCleanupEnabled !== undefined ? Boolean(payload.autoCleanupEnabled) : undefined;
    let deletionPolicy;
    if (payload.deletionPolicy !== undefined) {
      const p = String(payload.deletionPolicy).trim();
      if (p !== 'daily_reset_purge' && p !== 'immediate_purge') {
        return errorResponse('删除策略无效，可选值：daily_reset_purge 或 immediate_purge');
      }
      deletionPolicy = p;
    }
    const uploadRestrictionMode = payload.uploadRestrictionMode !== undefined ? String(payload.uploadRestrictionMode) : undefined;
    const uploadAllowedTypes = payload.uploadAllowedTypes !== undefined ? String(payload.uploadAllowedTypes) : undefined;
    const uploadBlockedTypes = payload.uploadBlockedTypes !== undefined ? String(payload.uploadBlockedTypes) : undefined;
    let uploadMaxFileSizeMb;
    if (payload.uploadMaxFileSizeMb !== undefined) {
      const mb = Number(payload.uploadMaxFileSizeMb);
      if (!Number.isInteger(mb) || mb < 1 || mb > 100) {
        return errorResponse('单文件上传大小限制必须是 1 到 100 之间的整数（MB）');
      }
      uploadMaxFileSizeMb = mb;
    }
    const callsEnabled = payload.callsEnabled !== undefined ? Boolean(payload.callsEnabled) : undefined;
    const callsAppId = payload.callsAppId !== undefined ? String(payload.callsAppId).trim() : undefined;
    const callsAppSecret = payload.callsAppSecret !== undefined ? String(payload.callsAppSecret).trim() : undefined;
    const storageType = payload.storageType !== undefined ? String(payload.storageType).trim() : undefined;
    const storageAccountId = payload.storageAccountId !== undefined ? String(payload.storageAccountId).trim() : undefined;
    const storageBucketName = payload.storageBucketName !== undefined ? String(payload.storageBucketName).trim() : undefined;
    const storageAccessKeyId = payload.storageAccessKeyId !== undefined ? String(payload.storageAccessKeyId).trim() : undefined;
    const storageSecretAccessKey = payload.storageSecretAccessKey !== undefined ? String(payload.storageSecretAccessKey).trim() : undefined;
    const storageEndpoint = payload.storageEndpoint !== undefined ? String(payload.storageEndpoint).trim() : undefined;
    const storageRegion = payload.storageRegion !== undefined ? String(payload.storageRegion).trim() : undefined;
    const storagePublicDomain = payload.storagePublicDomain !== undefined ? String(payload.storagePublicDomain).trim() : undefined;
    const gdriveClientId = payload.gdriveClientId !== undefined ? String(payload.gdriveClientId).trim() : undefined;
    const gdriveClientSecret = payload.gdriveClientSecret !== undefined ? String(payload.gdriveClientSecret).trim() : undefined;
    const gdriveRefreshToken = payload.gdriveRefreshToken !== undefined ? String(payload.gdriveRefreshToken).trim() : undefined;
    const gdriveFolderId = payload.gdriveFolderId !== undefined ? String(payload.gdriveFolderId).trim() : undefined;

    if (siteName !== undefined && !siteName) {
      return errorResponse('站点名称不能为空');
    }

    const site = await updateSiteSettings(c.env.DB, {
      siteName,
      siteIconUrl,
      messageRetentionDays,
      autoCleanupEnabled,
      deletionPolicy,
      uploadRestrictionMode,
      uploadAllowedTypes,
      uploadBlockedTypes,
      uploadMaxFileSizeMb,
      callsEnabled,
      callsAppId,
      callsAppSecret,
      storageType,
      storageAccountId,
      storageBucketName,
      storageAccessKeyId,
      storageSecretAccessKey,
      storageEndpoint,
      storageRegion,
      storagePublicDomain,
      gdriveClientId,
      gdriveClientSecret,
      gdriveRefreshToken,
      gdriveFolderId
    }, c.env);
    invalidateAdminOverviewCache();
    return c.json({ site });
  });

  app.post('/api/admin/storage/test', async (c) => {
    const payload = await parseJsonRequest(c.req.raw).catch(() => ({}));
    const current = await getStorageServerSecret(c.env.DB, c.env);
    const storageType = (payload.storageType !== undefined ? String(payload.storageType) : current.storageType).trim();
    const accountId = (payload.storageAccountId !== undefined ? String(payload.storageAccountId) : current.accountId).trim();
    const bucketName = (payload.storageBucketName !== undefined ? String(payload.storageBucketName) : current.bucketName).trim() || 'edgechat-files';
    const accessKeyId = (payload.storageAccessKeyId !== undefined ? String(payload.storageAccessKeyId) : current.accessKeyId).trim();
    const secretAccessKey = (payload.storageSecretAccessKey !== undefined && String(payload.storageSecretAccessKey).trim() && payload.storageSecretAccessKey !== '********' ? String(payload.storageSecretAccessKey) : current.secretAccessKey).trim();
    const endpoint = (payload.storageEndpoint !== undefined ? String(payload.storageEndpoint) : current.endpoint).trim();
    const region = (payload.storageRegion !== undefined ? String(payload.storageRegion) : current.region).trim() || 'auto';

    if (storageType === 'gdrive') {
      const gdriveClientId = (payload.gdriveClientId !== undefined ? String(payload.gdriveClientId) : current.gdriveClientId).trim();
      const gdriveClientSecret = (payload.gdriveClientSecret !== undefined && String(payload.gdriveClientSecret).trim() && payload.gdriveClientSecret !== '********' ? String(payload.gdriveClientSecret) : current.gdriveClientSecret).trim();
      const gdriveRefreshToken = (payload.gdriveRefreshToken !== undefined && String(payload.gdriveRefreshToken).trim() && payload.gdriveRefreshToken !== '********' ? String(payload.gdriveRefreshToken) : current.gdriveRefreshToken).trim();
      const gdriveFolderId = (payload.gdriveFolderId !== undefined ? String(payload.gdriveFolderId) : current.gdriveFolderId).trim();

      if (!gdriveClientId || !gdriveClientSecret || !gdriveRefreshToken) {
        return c.json({ ok: false, error: '缺少 Google Drive Client ID / Client Secret 或 Refresh Token，无法测试连接' }, 400);
      }

      try {
        const res = await testGoogleDriveConnection({
          clientId: gdriveClientId,
          clientSecret: gdriveClientSecret,
          refreshToken: gdriveRefreshToken,
          folderId: gdriveFolderId
        });
        return c.json(res);
      } catch (err) {
        return c.json({ ok: false, error: err.message || 'Google Drive 连接探测失败' }, 400);
      }
    }

    if (storageType === 'r2' && !accessKeyId && !secretAccessKey && c.env.FILES) {
      // Test native Worker R2 binding
      try {
        const testKey = `.probe-${Date.now()}.tmp`;
        await c.env.FILES.put(testKey, 'probe-ok');
        await c.env.FILES.delete(testKey);
        return c.json({ ok: true, message: 'Cloudflare 原生 R2 绑定存储连接与写入正常！' });
      } catch (err) {
        return c.json({ ok: false, error: `R2 绑定测试失败: ${err.message || err}` }, 400);
      }
    }

    if (!accessKeyId || !secretAccessKey) {
      return c.json({ ok: false, error: '缺少 Access Key ID 或 Secret Access Key，无法测试 S3 协议连接' }, 400);
    }

    try {
      const aws = new AwsClient({
        accessKeyId,
        secretAccessKey,
        service: 's3',
        region
      });
      const s3Url = endpoint
        ? new URL(`${endpoint.replace(/\/+$/, '')}/${bucketName}/.probe-${Date.now()}.tmp`)
        : new URL(`https://${accountId}.r2.cloudflarestorage.com/${bucketName}/.probe-${Date.now()}.tmp`);

      // Put probe object
      const putReq = new Request(s3Url, {
        method: 'PUT',
        body: 'probe-ok',
        headers: { 'Content-Type': 'text/plain' }
      });
      const putRes = await aws.fetch(putReq);
      if (!putRes.ok) {
        const txt = await putRes.text().catch(() => '');
        throw new Error(`S3 上传探测失败 (${putRes.status}): ${txt}`);
      }

      // Delete probe object
      const delReq = new Request(s3Url, { method: 'DELETE' });
      await aws.fetch(delReq);

      return c.json({ ok: true, message: 'S3 / R2 对象存储服务器连接与读写探测成功！' });
    } catch (err) {
      return c.json({ ok: false, error: `连接测试失败: ${err.message || err}` }, 400);
    }
  });

  app.post('/api/admin/calls/test', async (c) => {
    const payload = await parseJsonRequest(c.req.raw).catch(() => ({}));
    const current = await getCallsServerSecret(c.env.DB, c.env);
    const appId = (payload.callsAppId !== undefined ? String(payload.callsAppId) : current.appId).trim();
    const appSecret = (payload.callsAppSecret !== undefined && String(payload.callsAppSecret).trim() ? String(payload.callsAppSecret) : current.appSecret).trim();

    if (!appId || !appSecret) {
      return c.json({ ok: false, error: '缺少 Calls App ID 或 Calls App Secret，无法进行测试' }, 400);
    }

    try {
      const resp = await fetch(`https://rtc.live.cloudflare.com/v1/apps/${encodeURIComponent(appId)}/sessions/new`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${appSecret}`,
          'Content-Type': 'application/json'
        }
      });

      if (!resp.ok) {
        const errText = await resp.text().catch(() => '');
        return c.json({
          ok: false,
          status: resp.status,
          error: `Cloudflare 认证失败 (${resp.status}): ${errText || '请检查 App ID 或 Secret 是否匹配'}`
        }, 400);
      }

      const data = await resp.json().catch(() => ({}));
      return c.json({
        ok: true,
        sessionId: data.sessionId,
        message: '连通性正常，成功与 Cloudflare Calls SFU Anycast 边缘节点握手'
      });
    } catch (err) {
      return c.json({ ok: false, error: `网络连接异常: ${err.message}` }, 500);
    }
  });

  app.post('/api/admin/run-gc', async (c) => {
    try {
      const summary = await runScheduledGc(c.env);
      return c.json({ ok: true, summary });
    } catch (error) {
      console.error('[run-gc error]', error);
      return errorResponse(`清理执行失败: ${error?.message || '未知错误'}`, 500);
    }
  });

  app.get('/api/admin/register-links', async (c) => {
    const invites = await listActiveRegistrationInvites(c.env.DB);
    return c.json({ invites });
  });

  app.post('/api/admin/register-links', async (c) => {
    const session = c.get('session');
    const payload = await parseJsonRequest(c.req.raw);
    const note = String(payload.note || '').trim();
    const maxUses = Number(payload.maxUses ?? 1);
    const groupId = payload.groupId ? Number(payload.groupId) : null;

    if (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > MAX_INVITE_USES) {
      return errorResponse(`可使用次数必须是 1 到 ${MAX_INVITE_USES} 之间的整数`);
    }

    if (groupId) {
      const group = await c.env.DB.prepare(
        'SELECT 1 FROM user_groups WHERE id = ? AND deleted_at IS NULL'
      ).bind(groupId).first();
      if (!group) {
        return errorResponse('指定的用户分组不存在或已删除', 400);
      }
    }

    const token = randomToken(24);
    const invite = await createRegistrationInvite(c.env.DB, {
      token,
      note,
      maxUses,
      groupId,
      createdBy: session.userId,
      creatorDisplayName: session.displayName
    });

    return c.json({
      invite
    });
  });

  app.delete('/api/admin/register-links/:inviteId', async (c) => {
    const inviteId = Number(c.req.param('inviteId'));
    if (!Number.isFinite(inviteId)) {
      return errorResponse('注册链接不存在', 404);
    }

    await revokeRegistrationInvite(c.env.DB, inviteId);

    return c.json({ ok: true });
  });

  app.get('/api/admin/users', async (c) => {
    const users = await listAdminUsers(c.env.DB);
    const userIds = users.map((u) => u.id);
    const groupsMap = await getUserGroupsForUsers(c.env.DB, userIds);
    const enrichedUsers = users.map((u) => ({
      ...u,
      groups: groupsMap[u.id] || []
    }));
    return c.json({ users: enrichedUsers });
  });

  app.post('/api/admin/users', async (c) => {
    const payload = await parseJsonRequest(c.req.raw);
    const username = String(payload.username || '').trim();
    const password = String(payload.password || '');
    const displayName = String(payload.displayName || username).trim();

    if (!username || !password) {
      return errorResponse('用户名和密码不能为空');
    }

    // 检查是否存在活跃同名用户
    const activeUser = await c.env.DB.prepare(
      `SELECT id FROM users WHERE username = ? AND deleted_at IS NULL LIMIT 1`
    ).bind(username).first();

    if (activeUser) {
      return errorResponse('用户名已存在', 400);
    }

    // 若存在历史已软删除的同名记录，重命名释放原用户名
    await c.env.DB.prepare(
      `UPDATE users
       SET username = 'deleted_' || id || '_' || CAST(strftime('%s', 'now') AS TEXT) || '_' || username
       WHERE username = ? AND deleted_at IS NOT NULL`
    ).bind(username).run();

    const hashed = await hashPassword(password);
    const result = await c.env.DB.prepare(
      `INSERT INTO users (
         username,
         display_name,
         password_hash,
         password_salt
       ) VALUES (?, ?, ?, ?)`
    )
      .bind(username, displayName, hashed.hash, hashed.salt)
      .run()
      .catch((error) => {
        if (String(error.message).includes('UNIQUE')) {
          throw new ApiError('用户名已存在');
        }
        throw error;
      });

    await ensureGeneralChannelMembership(c.env.DB, result.meta.last_row_id);
    invalidateAdminOverviewCache();

    return c.json({
      user: {
        id: result.meta.last_row_id,
        username,
        displayName,
        isDisabled: false,
        isPermanentlyDisabled: false,
        disabledUntil: null
      }
    });
  });

  app.patch('/api/admin/users/:userId', async (c) => {
    const userId = Number(c.req.param('userId'));
    if (!Number.isFinite(userId)) {
      return errorResponse('无效的用户 ID', 400);
    }
    const payload = await parseJsonRequest(c.req.raw);
    const displayName = payload.displayName !== undefined ? String(payload.displayName || '').trim() : undefined;
    const isDisabled = payload.isDisabled !== undefined ? Boolean(payload.isDisabled) : undefined;
    const isAdmin = payload.isAdmin !== undefined ? (payload.isAdmin ? 1 : 0) : undefined;

    if (isAdmin === 0) {
      const countRes = await c.env.DB.prepare(
        `SELECT COUNT(*) AS count
         FROM users
         WHERE is_admin = 1
           AND deleted_at IS NULL
           AND is_disabled = 0
           AND id != ?`
      ).bind(userId).first();

      if (!countRes || Number(countRes.count) === 0) {
        return errorResponse('系统中至少需要保留一个正常状态的管理员，无法取消该权限', 400);
      }
    }

    let isPermanentlyDisabled = null;
    let disabledUntil = null;

    if (isDisabled === true) {
      const targetUser = await c.env.DB.prepare(
        `SELECT is_admin FROM users WHERE id = ? AND deleted_at IS NULL`
      ).bind(userId).first();
      if (targetUser && Boolean(Number(targetUser.is_admin))) {
        const countRes = await c.env.DB.prepare(
          `SELECT COUNT(*) AS count
           FROM users
           WHERE is_admin = 1
             AND deleted_at IS NULL
             AND is_disabled = 0
             AND id != ?`
        ).bind(userId).first();
        if (!countRes || Number(countRes.count) === 0) {
          return errorResponse('不能禁用系统中唯一的管理员账号', 400);
        }
      }

      const durationMinutes = payload.banDurationMinutes == null
        ? null
        : Number(payload.banDurationMinutes);
      if (durationMinutes !== null && (!Number.isInteger(durationMinutes) || durationMinutes < 1)) {
        return errorResponse('封禁时长必须是正整数分钟', 400);
      }

      isPermanentlyDisabled = durationMinutes === null;
      disabledUntil = durationMinutes !== null
        ? banExpiryFromMinutes(durationMinutes)
        : null;
    }

    const bumpVersion = (isDisabled !== undefined || isAdmin !== undefined) ? 1 : 0;
    const binds = [
      displayName !== undefined ? displayName : null,
      isAdmin !== undefined ? isAdmin : null,
    ];

    let updateSql = `UPDATE users
       SET display_name = COALESCE(?, display_name),
           is_admin = COALESCE(?, is_admin),
           updated_at = CURRENT_TIMESTAMP`;

    if (isDisabled !== undefined) {
      if (isDisabled) {
        updateSql += `, is_disabled = ?, disabled_until = ?, session_version = session_version + ?`;
        binds.push(isPermanentlyDisabled ? 1 : 0, disabledUntil, bumpVersion);
      } else {
        updateSql += `, is_disabled = 0, disabled_until = NULL, session_version = session_version + ?`;
        binds.push(bumpVersion);
      }
    } else {
      updateSql += `, session_version = session_version + ?`;
      binds.push(bumpVersion);
    }

    updateSql += ` WHERE id = ? AND deleted_at IS NULL`;
    binds.push(userId);

    await c.env.DB.prepare(updateSql).bind(...binds).run();
    invalidateAdminOverviewCache();

    return c.json({ ok: true });
  });

  app.post('/api/admin/users/:userId/reset-password', async (c) => {
    const userId = Number(c.req.param('userId'));
    const payload = await parseJsonRequest(c.req.raw);
    const password = String(payload.password || '');
    if (!password) {
      return errorResponse('新密码不能为空');
    }

    const hashed = await hashPassword(password);
    await c.env.DB.prepare(
      `UPDATE users
       SET password_hash = ?,
            password_salt = ?,
            session_version = session_version + 1,
            updated_at = CURRENT_TIMESTAMP
       WHERE id = ?
         AND deleted_at IS NULL`
    )
      .bind(hashed.hash, hashed.salt, userId)
      .run();

    return c.json({ ok: true });
  });

  app.delete('/api/admin/users/:userId', async (c) => {
    const userId = Number(c.req.param('userId'));
    if (!Number.isFinite(userId)) {
      return errorResponse('无效的用户 ID', 400);
    }
    const targetUser = await c.env.DB.prepare(
      `SELECT id, username, is_admin FROM users WHERE id = ? AND deleted_at IS NULL`
    ).bind(userId).first();
    if (!targetUser) {
      return errorResponse('用户不存在或已删除', 404);
    }
    if (targetUser && Boolean(Number(targetUser.is_admin))) {
      const countRes = await c.env.DB.prepare(
        `SELECT COUNT(*) AS count
         FROM users
         WHERE is_admin = 1
           AND deleted_at IS NULL
           AND is_disabled = 0
           AND id != ?`
      ).bind(userId).first();
      if (!countRes || Number(countRes.count) === 0) {
        return errorResponse('不能删除系统中唯一的管理员账号', 400);
      }
    }
    const freeUsername = `deleted_${userId}_${Date.now()}_${targetUser.username}`;

    await c.env.DB.prepare(
      `UPDATE users
       SET username = ?,
           deleted_at = CURRENT_TIMESTAMP,
           is_disabled = 1,
           disabled_until = NULL,
           session_version = session_version + 1,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).bind(freeUsername, userId).run();

    // 级联清理群组成员、房间成员与密码密钥关联
    const optionalCleanups = [
      'DELETE FROM user_group_members WHERE user_id = ?',
      'DELETE FROM channel_members WHERE user_id = ?',
      'DELETE FROM drive_app_passwords WHERE user_id = ?',
      'DELETE FROM e2ee_identity_keys WHERE user_id = ?',
      'DELETE FROM e2ee_prekeys WHERE user_id = ?',
      'DELETE FROM e2ee_key_backups WHERE user_id = ?'
    ];
    for (const sql of optionalCleanups) {
      try {
        await c.env.DB.prepare(sql).bind(userId).run();
      } catch {
        // Ignore if table does not exist in lightweight test schemas
      }
    }

    invalidateAdminOverviewCache();

    return c.json({ ok: true });
  });

  // 用户分组管理端点
  app.get('/api/admin/groups', async (c) => {
    const groups = await listUserGroups(c.env.DB);
    return c.json({ groups });
  });

  app.post('/api/admin/groups', async (c) => {
    const payload = await parseJsonRequest(c.req.raw);
    try {
      const group = await createUserGroup(c.env.DB, {
        name: payload.name,
        description: payload.description,
        allowMemberDm: payload.allowMemberDm
      });
      return c.json({ group });
    } catch (err) {
      return errorResponse(err.message || '创建分组失败', 400);
    }
  });

  app.put('/api/admin/groups/:groupId', async (c) => {
    const groupId = Number(c.req.param('groupId'));
    const payload = await parseJsonRequest(c.req.raw);
    try {
      const group = await updateUserGroup(c.env.DB, groupId, {
        name: payload.name,
        description: payload.description,
        allowMemberDm: payload.allowMemberDm
      });
      return c.json({ group });
    } catch (err) {
      return errorResponse(err.message || '更新分组失败', 400);
    }
  });

  app.delete('/api/admin/groups/:groupId', async (c) => {
    const groupId = Number(c.req.param('groupId'));
    try {
      await deleteUserGroup(c.env.DB, groupId);
      return c.json({ ok: true });
    } catch (err) {
      return errorResponse(err.message || '删除分组失败', 400);
    }
  });

  app.get('/api/admin/groups/:groupId/members', async (c) => {
    const groupId = Number(c.req.param('groupId'));
    const members = await getGroupMembers(c.env.DB, groupId);
    return c.json({ members });
  });

  app.post('/api/admin/groups/:groupId/members', async (c) => {
    const groupId = Number(c.req.param('groupId'));
    const payload = await parseJsonRequest(c.req.raw);
    const userIds = Array.isArray(payload.userIds) ? payload.userIds : [payload.userId];
    try {
      const count = await addGroupMembers(c.env.DB, groupId, userIds);
      return c.json({ ok: true, addedCount: count });
    } catch (err) {
      return errorResponse(err.message || '添加群组成员失败', 400);
    }
  });

  app.delete('/api/admin/groups/:groupId/members/:userId', async (c) => {
    const groupId = Number(c.req.param('groupId'));
    const userId = Number(c.req.param('userId'));
    try {
      await removeGroupMember(c.env.DB, groupId, userId);
      return c.json({ ok: true });
    } catch (err) {
      return errorResponse(err.message || '移除群组成员失败', 400);
    }
  });

  app.put('/api/admin/groups/:groupId/members/:userId/role', async (c) => {
    const groupId = Number(c.req.param('groupId'));
    const userId = Number(c.req.param('userId'));
    const payload = await parseJsonRequest(c.req.raw);
    const role = payload.role === 'leader' ? 'leader' : 'member';
    try {
      await setGroupMemberRole(c.env.DB, groupId, userId, role);
      return c.json({ ok: true, groupId, userId, role });
    } catch (err) {
      return errorResponse(err.message || '设置成员角色失败', 400);
    }
  });

  app.get('/api/admin/backup/export', async (c) => {
    const session = c.get('session');
    const backup = await exportDatabaseBackup(c.env.DB, {
      userId: session?.userId,
      username: session?.username
    });
    return c.json(backup);
  });

  app.post('/api/admin/backup/preview', async (c) => {
    const session = c.get('session');
    const payload = await parseJsonRequest(c.req.raw);
    const result = await previewBackupData(c.env.DB, payload, session?.userId);
    return c.json(result);
  });

  app.post('/api/admin/backup/import', async (c) => {
    const session = c.get('session');
    const payload = await parseJsonRequest(c.req.raw);
    const backupData = payload.backup || payload.data ? payload.backup || payload : payload;
    const adminConflictStrategy = payload.adminConflictStrategy || 'keep_current';
    const userConflictStrategy = payload.userConflictStrategy || 'skip';
    const importSettings = Boolean(payload.importSettings);
    const result = await importBackupData(
      c.env.DB,
      backupData,
      { adminConflictStrategy, userConflictStrategy, importSettings },
      session?.userId
    );
    invalidateAdminOverviewCache();
    return c.json(result);
  });

}
