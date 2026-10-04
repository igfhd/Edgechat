import { Hono } from 'hono';
import { cors } from 'hono/cors';
import {
  createSession,
  deleteSession,
  getSession,
  hashPassword,
  isConfiguredAdminUsername,
  putSession,
  verifyPassword
} from './auth.js';
import { listVisibleChannels } from './data/channels.js';
import { listUserDms } from './data/dm-queries.js';
import { ensureGeneralChannelMembership } from './data/general-channel.js';
import { getUserGroupsForUsers, listManagedGroupsForUser, updateUserGroup } from './data/user-groups.js';
import {
  createUserWithRegistrationInvite,
  getAvailableRegistrationInvite
} from './data/registration-invites.js';
import { getCallsServerSecret, getSiteSettings } from './data/site-settings.js';
import { getUserByUsername, listActiveUsers } from './data/users.js';
import { ApiError } from './errors.js';
import { resolveAvatarKeyUpdate } from './avatar-policy.js';
import { adminMiddleware, authMiddleware } from './middleware.js';
import { registerAdminRoutes } from './api/admin.js';
import { registerChannelRoutes } from './api/channels.js';
import { registerDmRoutes } from './api/dm.js';
import { registerMessageRoutes } from './api/messages.js';
import { registerUploadRoutes } from './api/upload.js';
import { registerKeyRoutes } from './api/keys.js';
import {
  registerTelegramAdminRoutes,
  registerTelegramPublicRoutes
} from './api/telegram.js';
import {
  registerAnnouncementRoutes,
  registerAnnouncementAdminRoutes
} from './api/announcements.js';
import { registerDriveRoutes } from './api/drive.js';
import { registerDrivePublicRoutes } from './api/drive-public.js';
import { registerWebDavRoutes } from './api/webdav.js';
import {
  createWsInboxScope,
  createWsRoomScope,
  createFileScope,
  issueUrlTicket,
  WS_TICKET_TTL_SECONDS,
  FILE_TICKET_TTL_SECONDS,
} from './tickets.js';
import { ChannelRoom } from './do/ChannelRoom.js';
import { Scheduler } from './do/Scheduler.js';
import { UserInbox } from './do/UserInbox.js';
import { forwardInboxConnection, forwardRoomConnection } from './do-bridge.js';
import { runScheduledGc } from './gc.js';
import {
  errorResponse,
  parseJsonRequest,
  requestBodyTooLarge
} from './utils.js';
import { handleDisguiseRouting, getRoutePrefixes } from './disguise.js';
import { clientIp, createFailureTracker, createRateLimiter, rateLimitError } from './rate-limit.js';

const loginLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 10 });
const registerLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 5 });
const registerIpTracker = createFailureTracker({ windowMs: 10 * 60 * 1000, max: 20 });

const app = new Hono();

app.use('/api/*', async (c, next) => {
  // 大体积二进制请求体由上传路由自身负责校验（各自执行站点配置的上限），
  // 全局守卫只保护 JSON API。
  const { pathname } = new URL(c.req.url);
  const isRawBodyRoute =
    pathname === '/api/upload' ||
    pathname === '/api/upload/' ||
    pathname === '/api/drive/files/direct-upload';
  if (!isRawBodyRoute && requestBodyTooLarge(c.req.raw)) {
    // 提前拒绝超大请求体，避免 Worker 在 JSON 解析前消耗过多内存。
    return errorResponse('请求体过大', 413);
  }

  await next();
});

app.use('/api/*', cors({
  origin: '*',
  allowHeaders: ['Content-Type', 'Authorization'],
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']
}));

app.use('/files/*', cors({
  origin: '*',
  allowHeaders: ['Content-Type', 'Authorization', 'Range'],
  exposeHeaders: ['Content-Range', 'Accept-Ranges', 'Content-Length', 'Content-Type'],
  allowMethods: ['GET', 'HEAD', 'OPTIONS']
}));

app.get('/api/health', (c) => c.json({ ok: true }));

app.get('/api/site', async (c) => {
  const site = await getSiteSettings(c.env.DB, c.env);
  return c.json({ site });
});

registerTelegramPublicRoutes(app);
registerDrivePublicRoutes(app);
registerWebDavRoutes(app);

app.get('/api/register-links/:token', async (c) => {
  const token = String(c.req.param('token') || '').trim();
  if (!token) {
    return errorResponse('注册链接不存在', 404);
  }

  const site = await getSiteSettings(c.env.DB);
  const invite = await getAvailableRegistrationInvite(c.env.DB, token);
  if (!invite) {
    return errorResponse('注册链接已失效', 404);
  }

  return c.json({
    site,
    invite: {
      note: invite.note,
      createdAt: invite.createdAt,
      remainingUses: invite.remainingUses,
      groupId: invite.groupId,
      groupName: invite.groupName
    }
  });
});

app.post('/api/register-links/:token/register', async (c) => {
  const token = String(c.req.param('token') || '').trim();

  const limited = registerLimiter.check(`${clientIp(c)}:${token}`);
  if (!limited.allowed) {
    return rateLimitError(limited.retryAfterMs);
  }

  const payload = await parseJsonRequest(c.req.raw);
  const username = String(payload.username || '').trim();
  const password = String(payload.password || '');
  const displayName = String(payload.displayName || username).trim();

  if (!token) {
    return errorResponse('注册链接不存在', 404);
  }
  if (!username || !password) {
    return errorResponse('用户名和密码不能为空');
  }
  if (isConfiguredAdminUsername(c.env, username)) {
    return errorResponse('该用户名不可用于邀请注册');
  }

  const invite = await getAvailableRegistrationInvite(c.env.DB, token);
  if (!invite) {
    const tracked = registerIpTracker.record(clientIp(c));
    if (!tracked.allowed) {
      return rateLimitError(tracked.retryAfterMs);
    }
    return errorResponse('注册链接已失效', 400);
  }

  const hashed = await hashPassword(password);
  const userId = await createUserWithRegistrationInvite(c.env.DB, {
    inviteId: invite.id,
    groupId: invite.groupId,
    username,
    displayName,
    passwordHash: hashed.hash,
    passwordSalt: hashed.salt
  });

  await ensureGeneralChannelMembership(c.env.DB, userId);

  return c.json({ ok: true });
});

app.post('/api/auth/login', async (c) => {
  const limited = loginLimiter.check(clientIp(c));
  if (!limited.allowed) {
    return rateLimitError(limited.retryAfterMs);
  }

  const payload = await parseJsonRequest(c.req.raw);
  const username = String(payload.username || '').trim();
  const password = String(payload.password || '');
  if (!username || !password) {
    return errorResponse('请输入用户名和密码');
  }

  const user = await getUserByUsername(c.env.DB, username);
  if (!user || Number(user.is_disabled)) {
    return errorResponse('账号或密码错误', 401);
  }

  const valid = await verifyPassword(password, user.password_hash, user.password_salt);
  if (!valid) {
    return errorResponse('账号或密码错误', 401);
  }

  const session = await createSession(c.env, user);
  return c.json({
    token: session.token,
    session
  });
});

app.use('/api/*', authMiddleware);

app.get('/api/auth/session', async (c) => {
  const session = c.get('session');
  const user = await c.env.DB.prepare(
    `SELECT display_name, avatar_key, is_disabled
     FROM users
     WHERE id = ?
       AND deleted_at IS NULL
     LIMIT 1`
  )
    .bind(session.userId)
    .all();

  if (!user.results[0] || Number(user.results[0].is_disabled)) {
    await deleteSession(c.env, session.token);
    return errorResponse('账号已不可用', 401);
  }

  const freshSession = {
    ...session,
    displayName: user.results[0].display_name,
    avatarUrl: user.results[0].avatar_key ? `/files/${encodeURIComponent(user.results[0].avatar_key)}` : ''
  };
  await putSession(c.env, freshSession);

  return c.json({ session: freshSession });
});

app.post('/api/auth/logout', async (c) => {
  const session = c.get('session');
  await deleteSession(c.env, session.token);
  return c.json({ ok: true });
});

app.post('/api/auth/ws-ticket', async (c) => {
  const session = c.get('session');
  const payload = await parseJsonRequest(c.req.raw);
  const kind = String(payload.kind || '').trim();
  const roomId = String(payload.roomId ?? '').trim();
  if (kind !== 'inbox' && (!kind || !roomId)) {
    return errorResponse('缺少会话类型或房间 ID');
  }

  const scope = kind === 'inbox'
    ? createWsInboxScope()
    : createWsRoomScope(kind, roomId);
  return c.json(await issueUrlTicket(c.env, {
    purpose: 'ws',
    scope,
    session,
    ttlSeconds: WS_TICKET_TTL_SECONDS
  }));
});

app.post('/api/auth/file-ticket', async (c) => {
  const session = c.get('session');
  return c.json(await issueUrlTicket(c.env, {
    purpose: 'file',
    scope: createFileScope(),
    session,
    ttlSeconds: FILE_TICKET_TTL_SECONDS
  }));
});

app.post('/api/auth/change-password', async (c) => {
  const session = c.get('session');
  const payload = await parseJsonRequest(c.req.raw);
  const currentPassword = String(payload.currentPassword || '');
  const newPassword = String(payload.newPassword || '');
  if (!currentPassword || !newPassword) {
    return errorResponse('请填写完整密码');
  }

  const user = await c.env.DB.prepare(
    `SELECT password_hash, password_salt
     FROM users
     WHERE id = ?
       AND deleted_at IS NULL
     LIMIT 1`
  )
    .bind(session.userId)
    .all();

  if (!user.results[0]) {
    return errorResponse('用户不存在', 404);
  }

  const valid = await verifyPassword(
    currentPassword,
    user.results[0].password_hash,
    user.results[0].password_salt
  );
  if (!valid) {
    return errorResponse('当前密码不正确', 400);
  }

  const hashed = await hashPassword(newPassword);
  await c.env.DB.prepare(
    `UPDATE users
     SET password_hash = ?,
          password_salt = ?,
          session_version = session_version + 1,
          updated_at = CURRENT_TIMESTAMP
     WHERE id = ?
       AND deleted_at IS NULL`
  )
    .bind(hashed.hash, hashed.salt, session.userId)
    .run();

  const nextSession = {
    ...session,
    sessionVersion: Number(session.sessionVersion || 0) + 1
  };
  await putSession(c.env, nextSession);

  return c.json({ ok: true });
});

app.post('/api/calls/session', async (c) => {
  const session = c.get('session');
  if (!session) {
    return errorResponse('未登录', 401);
  }

  const callsConfig = await getCallsServerSecret(c.env.DB, c.env);
  if (!callsConfig.enabled || !callsConfig.appId || !callsConfig.appSecret) {
    return errorResponse('语音通话服务未开启或未配置 SFU 服务器', 400);
  }

  try {
    const resp = await fetch(`https://rtc.live.cloudflare.com/v1/apps/${encodeURIComponent(callsConfig.appId)}/sessions/new`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${callsConfig.appSecret}`,
        'Content-Type': 'application/json'
      }
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      return errorResponse(`Cloudflare Calls 接入失败: ${errText || resp.status}`, 502);
    }

    const data = await resp.json();
    return c.json({
      ok: true,
      appId: callsConfig.appId,
      sessionId: data.sessionId
    });
  } catch (err) {
    return errorResponse(`创建通话会话失败: ${err.message}`, 500);
  }
});

app.post('/api/calls/sessions/:sessionId/tracks/new', async (c) => {
  const session = c.get('session');
  if (!session) {
    return errorResponse('未登录', 401);
  }

  const callsConfig = await getCallsServerSecret(c.env.DB, c.env);
  if (!callsConfig.enabled || !callsConfig.appId || !callsConfig.appSecret) {
    return errorResponse('语音通话服务未开启或未配置 SFU 服务器', 400);
  }

  const sessionId = c.req.param('sessionId');
  const payload = await parseJsonRequest(c.req.raw);

  try {
    const resp = await fetch(`https://rtc.live.cloudflare.com/v1/apps/${encodeURIComponent(callsConfig.appId)}/sessions/${encodeURIComponent(sessionId)}/tracks/new`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${callsConfig.appSecret}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      return c.json({ ok: false, error: data.error || `SFU 音频推流协商失败 (${resp.status})` }, resp.status);
    }

    return c.json(data);
  } catch (err) {
    return errorResponse(`推流轨道请求失败: ${err.message}`, 500);
  }
});

app.put('/api/calls/sessions/:sessionId/renegotiate', async (c) => {
  const session = c.get('session');
  if (!session) {
    return errorResponse('未登录', 401);
  }

  const callsConfig = await getCallsServerSecret(c.env.DB, c.env);
  if (!callsConfig.enabled || !callsConfig.appId || !callsConfig.appSecret) {
    return errorResponse('语音通话服务未开启或未配置 SFU 服务器', 400);
  }

  const sessionId = c.req.param('sessionId');
  const payload = await parseJsonRequest(c.req.raw);

  try {
    const resp = await fetch(`https://rtc.live.cloudflare.com/v1/apps/${encodeURIComponent(callsConfig.appId)}/sessions/${encodeURIComponent(sessionId)}/renegotiate`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${callsConfig.appSecret}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      return c.json({ ok: false, error: data.error || `SFU 重新协商失败 (${resp.status})` }, resp.status);
    }

    return c.json(data);
  } catch (err) {
    return errorResponse(`重新协商请求失败: ${err.message}`, 500);
  }
});

app.patch('/api/me/profile', async (c) => {
  const session = c.get('session');
  const payload = await parseJsonRequest(c.req.raw);
  const displayName = String(payload.displayName || session.displayName).trim();
  const avatarUpdate = await resolveAvatarKeyUpdate(c.env.DB, session.userId, payload);
  if (!displayName) {
    return errorResponse('显示名称不能为空');
  }

  const updates = ['display_name = ?', 'updated_at = CURRENT_TIMESTAMP'];
  const binds = [displayName];
  if (avatarUpdate.provided) {
    updates.splice(1, 0, 'avatar_key = ?');
    binds.push(avatarUpdate.key);
  }
  await c.env.DB.prepare(
    `UPDATE users
     SET ${updates.join(', ')}
     WHERE id = ?`
  )
    .bind(...binds, session.userId)
    .run();

  const nextSession = await getSession(c.env, session.token);
  const merged = {
    ...nextSession,
    displayName,
    avatarUrl: avatarUpdate.provided
      ? avatarUpdate.key
        ? `/files/${encodeURIComponent(avatarUpdate.key)}`
        : ''
      : nextSession.avatarUrl
  };
  await putSession(c.env, merged);

  return c.json({ session: merged });
});

app.get('/api/users', async (c) => {
  const session = c.get('session');
  const users = await listActiveUsers(c.env.DB, session.userId, Boolean(session.isAdmin));
  const userIds = users.map((u) => u.id);
  const groupsMap = await getUserGroupsForUsers(c.env.DB, userIds);
  const enrichedUsers = users.map((u) => ({
    ...u,
    groups: groupsMap[u.id] || []
  }));
  return c.json({ users: enrichedUsers });
});

app.get('/api/me/managed-groups', async (c) => {
  const session = c.get('session');
  const groups = await listManagedGroupsForUser(c.env.DB, session.userId);
  return c.json({ groups });
});

app.patch('/api/me/managed-groups/:groupId/policy', async (c) => {
  const session = c.get('session');
  const groupId = Number(c.req.param('groupId'));
  if (!Number.isFinite(groupId) || groupId <= 0) {
    return errorResponse('分组不存在', 404);
  }
  const payload = await parseJsonRequest(c.req.raw);
  const allowMemberDm = Boolean(payload.allowMemberDm);

  if (!session.isAdmin) {
    const member = await c.env.DB.prepare(
      'SELECT role FROM user_group_members WHERE group_id = ? AND user_id = ? LIMIT 1'
    ).bind(groupId, session.userId).first();
    if (!member || member.role !== 'leader') {
      return errorResponse('只有组长或管理员可以修改私聊管制策略', 403);
    }
  }

  const updated = await updateUserGroup(c.env.DB, groupId, { allowMemberDm });
  return c.json({ ok: true, group: updated });
});

app.get('/api/bootstrap', async (c) => {
  const session = c.get('session');
  const settings = await getSiteSettings(c.env.DB, c.env);
  if (!settings.generalChannelHidden || session.isAdmin) {
    await ensureGeneralChannelMembership(c.env.DB, session.userId);
  }
  const [users, channels, dms] = await Promise.all([
    listActiveUsers(c.env.DB, session.userId, Boolean(session.isAdmin)),
    listVisibleChannels(c.env.DB, session.userId, {
      isAdmin: Boolean(session.isAdmin),
      generalHidden: settings.generalChannelHidden,
      generalMuted: settings.generalChannelMuted
    }),
    listUserDms(c.env.DB, session.userId)
  ]);
  const allUserIds = Array.from(new Set([
    ...users.map((u) => u.id),
    ...dms.map((d) => d.otherUser?.id).filter(Boolean)
  ]));
  const groupsMap = await getUserGroupsForUsers(c.env.DB, allUserIds);
  const enrichedUsers = users.map((u) => ({
    ...u,
    groups: groupsMap[u.id] || []
  }));
  const enrichedDms = dms.map((d) => ({
    ...d,
    otherUser: d.otherUser ? {
      ...d.otherUser,
      groups: groupsMap[d.otherUser.id] || []
    } : d.otherUser
  }));

  return c.json({ users: enrichedUsers, channels, dms: enrichedDms });
});

app.use('/api/admin/*', adminMiddleware);

registerMessageRoutes(app);
registerDmRoutes(app);
registerUploadRoutes(app);
registerKeyRoutes(app);
registerChannelRoutes(app);
registerAdminRoutes(app);
registerTelegramAdminRoutes(app);
registerDriveRoutes(app);
registerAnnouncementRoutes(app);
registerAnnouncementAdminRoutes(app);

app.get('/api/ws/:kind/:id', async (c) => {
  const session = c.get('session');
  const kind = c.req.param('kind');
  const id = c.req.param('id');
  if (!['public', 'private', 'dm'].includes(kind)) {
    return errorResponse('无效的会话类型');
  }

  return forwardRoomConnection({
    env: c.env,
    request: c.req.raw,
    kind,
    roomId: id,
    principal: session
  });
});

app.get('/api/inbox/ws', async (c) => {
  const session = c.get('session');
  return forwardInboxConnection({
    env: c.env,
    request: c.req.raw,
    principal: session
  });
});

app.notFound(async (c) => {
  if (new URL(c.req.url).pathname.startsWith('/api/')) {
    return errorResponse('接口不存在', 404);
  }
  return new Response('Not Found', { status: 404 });
});

app.onError((error) => {
  console.error(error);
  if (error instanceof ApiError) {
    return errorResponse(error.message, error.status);
  }
  return errorResponse('服务器开小差了', 500);
});

export default {
  async fetch(request, env, ctx) {
    return handleDisguiseRouting(request, env, async (strippedRequest) => {
      const url = new URL(strippedRequest.url);
      if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/files/') || url.pathname === '/dav' || url.pathname.startsWith('/dav/')) {
        return app.fetch(strippedRequest, env, ctx);
      }

      if (env?.ASSETS) {
        // 1. 处理深层子路由可能解析出的 /assets/ 相对请求 (例如 /register/assets/... -> /assets/...)
        const assetMatch = url.pathname.match(/\/assets\/([^?#]+)/);
        if (assetMatch && !url.pathname.startsWith('/assets/')) {
          const assetReq = new Request(new URL(`/assets/${assetMatch[1]}`, strippedRequest.url).toString(), strippedRequest);
          const assetRes = await env.ASSETS.fetch(assetReq);
          if (assetRes.status === 200) {
            return assetRes;
          }
        }

        let res = await env.ASSETS.fetch(strippedRequest);

        // PWA Service Worker: 必须免缓存并允许全域范围控制
        if (res.status === 200 && url.pathname.endsWith('/sw.js')) {
          const newHeaders = new Headers(res.headers);
          newHeaders.set('Cache-Control', 'no-cache, no-store, must-revalidate');
          newHeaders.set('Service-Worker-Allowed', '/');
          return new Response(res.body, {
            status: res.status,
            statusText: res.statusText,
            headers: newHeaders
          });
        }

        // PWA Web App Manifest: 规范 Content-Type
        if (res.status === 200 && (url.pathname.endsWith('/manifest.webmanifest') || url.pathname.endsWith('/manifest.json'))) {
          const newHeaders = new Headers(res.headers);
          newHeaders.set('Content-Type', 'application/manifest+json; charset=utf-8');
          return new Response(res.body, {
            status: res.status,
            statusText: res.statusText,
            headers: newHeaders
          });
        }

        // 单页应用 (SPA) 路由回退：对于 GET 导航请求（如 /、/admin、/register/:token、/login 等），若未命中物理文件则回退到 index.html
        if (res.status === 404 && strippedRequest.method === 'GET') {
          const indexUrl = new URL('/index.html', strippedRequest.url);
          const indexReq = new Request(indexUrl.toString(), strippedRequest);
          res = await env.ASSETS.fetch(indexReq);
        }

        // 统一处理 HTML 响应：注入 <base href="/${matchedPrefix}/"> 确保深层路由中的相对资产准确解析
        const contentType = res.headers?.get?.('content-type') || '';
        if (res.status === 200 && contentType.includes('text/html')) {
          const matchedPrefix = strippedRequest.headers?.get?.('X-Matched-Prefix') || (getRoutePrefixes(env)[0] || '');
          const baseHref = matchedPrefix ? `/${matchedPrefix}/` : '/';
          const html = await res.text();
          if (html.includes('<head>') && !html.includes('<base ')) {
            const injectedHtml = html.replace('<head>', `<head><base href="${baseHref}">`);
            return new Response(injectedHtml, {
              status: res.status,
              statusText: res.statusText,
              headers: res.headers
            });
          }
          return new Response(html, {
            status: res.status,
            statusText: res.statusText,
            headers: res.headers
          });
        }

        return res;
      }

      return app.fetch(strippedRequest, env, ctx);
    });
  },
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(runScheduledGc(env));
  }
};
export { ChannelRoom, Scheduler, UserInbox };
