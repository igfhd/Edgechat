import { validateSession } from './session.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// 短 TTL 用途绑定的 URL 凭据(ticket)管理。
//
// 背景:浏览器 WebSocket 握手与 <img>/<video>/<a> 标签无法携带 Authorization
// 头,过去这些场景在 URL 查询参数里直接携带 7 天有效期的完整会话 token,
// 一旦 URL 进入访问日志 / Referer / 代理日志,泄露的就是一把万能钥匙。
//
// 本模块把 URL 凭据替换为短 TTL 的用途绑定无状态签名 ticket (HMAC-SHA256):
//   - WS 握手 ticket:ticket:ws:* 60 秒有效,scope 绑定具体会话(kind+roomId 或 inbox)
//   - 文件下载 ticket:ticket:file:* 5 分钟有效,scope 仅限文件下载,不能调用任何 API
// ticket 内部携带 sessionToken 与失效时间戳并经过服务端密码学签名，校验时直接在 CPU 验证签名与范围，
// 并通过 validateSession 重新验证账号状态，不产生第二个身份源，且完全消除对 KV 的高频写入与删除（0 次 KV 写/删）。

export const WS_TICKET_TTL_SECONDS = 60;
export const FILE_TICKET_TTL_SECONDS = 300;

const WS_SCOPE_PREFIX = 'ws:';
const FILE_SCOPE_PREFIX = 'file';

function toBase64Url(bytes) {
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join('');
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4 || 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function signTicketPayload(sessionToken, payloadBytes) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(`ticket_sig:${sessionToken}`),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, payloadBytes);
  return new Uint8Array(sig);
}

async function verifyTicketPayload(sessionToken, payloadBytes, signatureBytes) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(`ticket_sig:${sessionToken}`),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify']
  );
  return crypto.subtle.verify('HMAC', key, signatureBytes, payloadBytes);
}

export function createWsRoomScope(kind, roomId) {
  return `${WS_SCOPE_PREFIX}room:${String(kind)}:${String(roomId)}`;
}

export function createWsInboxScope() {
  return `${WS_SCOPE_PREFIX}inbox`;
}

export function createFileScope() {
  return FILE_SCOPE_PREFIX;
}

function ticketKey(purpose, value) {
  return `ticket:${purpose}:${value}`;
}

/**
 * 签发一个短 TTL ticket。
 *
 * @param {object} env Workers 环境(SESSIONS KV)
 * @param {object} options
 * @param {'ws'|'file'} options.purpose ticket 用途
 * @param {string} options.scope 绑定范围(ws:room:{kind}:{id} / ws:inbox / file)
 * @param {object} options.session 已通过鉴权的会话(仅引用其 token)
 * @param {number} options.ttlSeconds 有效期(秒)
 * @returns {Promise<{ticket: string, expiresIn: number}>}
 */
export async function issueUrlTicket(_env, { purpose, scope, session, ttlSeconds }) {
  if (!session?.token) {
    throw new Error('无效的会话');
  }
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payloadObj = {
    p: purpose,
    s: scope,
    t: session.token,
    exp
  };
  const payloadBytes = encoder.encode(JSON.stringify(payloadObj));
  const sigBytes = await signTicketPayload(session.token, payloadBytes);

  const payloadLen = payloadBytes.length;
  const combined = new Uint8Array(2 + payloadLen + sigBytes.length);
  combined[0] = (payloadLen >> 8) & 0xff;
  combined[1] = payloadLen & 0xff;
  combined.set(payloadBytes, 2);
  combined.set(sigBytes, 2 + payloadLen);

  const ticket = toBase64Url(combined);
  return { ticket, expiresIn: ttlSeconds };
}

/**
 * 校验并解析 ticket,返回活会话;失败或用途/范围不匹配返回 null。
 * ticket 仅引用会话 token,解析时直接验证 HMAC 签名，并通过 validateSession 走统一账号校验。
 *
 * @param {object} env
 * @param {string} ticketValue 客户端带回的 ticket 原文
 * @param {{purpose: 'ws'|'file', scope: string}} expected 期望的用途与范围
 * @returns {Promise<object|null>} { ok: true, session } 形态的活会话,或 null
 */
export async function resolveUrlTicket(env, ticketValue, expected) {
  if (!ticketValue || !expected?.purpose || !expected?.scope) {
    return null;
  }

  // 1. 先尝试无状态签名 Ticket 解析 (0 KV 操作)
  try {
    const bytes = fromBase64Url(ticketValue);
    if (bytes.length >= 34) { // 2 bytes length + min payload + 32 bytes SHA256
      const payloadLen = (bytes[0] << 8) | bytes[1];
      if (bytes.length === 2 + payloadLen + 32) {
        const payloadBytes = bytes.subarray(2, 2 + payloadLen);
        const sigBytes = bytes.subarray(2 + payloadLen);
        const record = JSON.parse(decoder.decode(payloadBytes));

        if (record?.p && record.s && record.t && record.exp) {
          // 校验用途与范围
          if (record.p !== expected.purpose || record.s !== expected.scope) {
            return null;
          }
          // 校验是否超时
          if (record.exp < Math.floor(Date.now() / 1000)) {
            return null;
          }
          // 校验 HMAC 签名
          const valid = await verifyTicketPayload(record.t, payloadBytes, sigBytes);
          if (!valid) {
            return null;
          }
          // 校验底层会话活状态
          const auth = await validateSession(env, record.t);
          return auth.ok ? auth : null;
        }
      }
    }
  } catch {
    // Fallthrough to legacy KV lookup if parsing fails
  }

  // 2. 兼容历史/测试环境的 KV Ticket 回退
  if (env.SESSIONS && typeof env.SESSIONS.get === 'function') {
    try {
      const raw = await env.SESSIONS.get(ticketKey(expected.purpose, ticketValue));
      if (raw) {
        let record;
        try {
          record = JSON.parse(raw);
        } catch {
          await env.SESSIONS.delete(ticketKey(expected.purpose, ticketValue)).catch(() => {});
          return null;
        }
        if (record.purpose !== expected.purpose || record.scope !== expected.scope) {
          await env.SESSIONS.delete(ticketKey(expected.purpose, ticketValue)).catch(() => {});
          return null;
        }
        const auth = await validateSession(env, record.sessionToken);
        if (!auth.ok) {
          await env.SESSIONS.delete(ticketKey(expected.purpose, ticketValue)).catch(() => {});
          return null;
        }
        return auth;
      }
    } catch {
      return null;
    }
  }

  return null;
}
