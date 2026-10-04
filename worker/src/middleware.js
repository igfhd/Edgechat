import { errorResponse } from './utils.js';
import { validateSession } from './session.js';
import { resolveUrlTicket, createWsRoomScope, createWsInboxScope, createFileScope } from './tickets.js';
import { touchUserLastActive } from './data/users.js';

// REST 只接受 Bearer 头;URL 查询参数里的 token 一律不再放行,
// 避免 7 天会话 token 随 URL 泄露到访问日志 / Referer。
function extractToken(request) {
  const authHeader = request.headers.get('authorization') || '';
  if (authHeader.startsWith('Bearer ')) {
    return authHeader.slice('Bearer '.length).trim();
  }
  return '';
}

function matchTicketPurpose(pathname) {
  const wsRoom = /^\/api\/ws\/([^/]+)\/([^/]+)$/.exec(pathname);
  if (wsRoom) {
    return { purpose: 'ws', scope: createWsRoomScope(wsRoom[1], wsRoom[2]) };
  }
  if (pathname === '/api/inbox/ws') {
    return { purpose: 'ws', scope: createWsInboxScope() };
  }
  if (/^\/api\/drive\/files\/[^/]+$/.test(pathname)) {
    return { purpose: 'file', scope: createFileScope() };
  }
  return null;
}

export async function authMiddleware(c, next) {
  const token = extractToken(c.req.raw);
  let result = token ? await validateSession(c.env, token) : { ok: false };

  if (!result.ok) {
    const pathname = new URL(c.req.url).pathname;
    const ticketMatch = matchTicketPurpose(pathname);
    if (ticketMatch) {
      const ticketValue = new URL(c.req.url).searchParams.get('ticket') || '';
      const ticketResult = await resolveUrlTicket(c.env, ticketValue, ticketMatch);
      if (ticketResult?.ok) {
        result = ticketResult;
      }
    }
  }

  if (!result.ok) {
    return errorResponse(result.message || '请先登录', result.status || 401);
  }

  c.set('session', result.session);
  if (c.env?.DB && result.session?.userId) {
    void touchUserLastActive(c.env.DB, result.session.userId).catch(() => {});
  }
  await next();
}

export async function adminMiddleware(c, next) {
  const session = c.get('session');
  if (!session?.isAdmin) {
    return errorResponse('需要管理员权限', 403);
  }

  await next();
}
