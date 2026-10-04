import { deleteSession, getSession, isAdminUser, putSession } from './auth.js';
import { isUserDisabled } from './user-status.js';

// In-memory cache for validated sessions to reduce D1 reads (15 seconds TTL)
const SESSION_CACHE_TTL_MS = 15 * 1000;
const sessionValidationCache = new Map();

export function invalidateSessionValidationCache(token = null) {
  if (token) {
    sessionValidationCache.delete(token);
  } else {
    sessionValidationCache.clear();
  }
}

function toNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

export async function validateSession(env, token) {
  const session = await getSession(env, token);
  if (!session) {
    if (token) sessionValidationCache.delete(token);
    return { ok: false, status: 401, message: '请先登录' };
  }

  const now = Date.now();
  const cacheKey = `${token}:${session.sessionVersion}`;
  if (sessionValidationCache.has(cacheKey)) {
    const entry = sessionValidationCache.get(cacheKey);
    if (now < entry.exp) {
      return { ok: true, session: { ...entry.session } };
    }
    sessionValidationCache.delete(cacheKey);
  }

  const { results } = await env.DB.prepare(
    `SELECT username, is_disabled, disabled_until, deleted_at, session_version, is_admin
     FROM users
     WHERE id = ?
     LIMIT 1`
  )
    .bind(session.userId)
    .all();

  const user = results[0];
  if (!user || user.deleted_at || isUserDisabled(user)) {
    sessionValidationCache.delete(cacheKey);
    await deleteSession(env, token);
    return { ok: false, status: 401, message: '账号已不可用' };
  }

  const dbVersion = toNumber(user.session_version);
  const sessionVersion = toNumber(session.sessionVersion);
  if (sessionVersion !== dbVersion) {
    sessionValidationCache.delete(cacheKey);
    await deleteSession(env, token);
    return { ok: false, status: 401, message: '登录已过期，请重新登录' };
  }

  const refreshed = {
    ...session,
    isAdmin: isAdminUser(env, user),
    sessionVersion: dbVersion
  };

  if (refreshed.isAdmin !== session.isAdmin || refreshed.sessionVersion !== session.sessionVersion) {
    await putSession(env, refreshed);
  }

  sessionValidationCache.set(cacheKey, {
    session: refreshed,
    exp: now + SESSION_CACHE_TTL_MS
  });

  return { ok: true, session: refreshed };
}
