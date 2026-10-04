export function jsonResponse(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...(init.headers || {})
    }
  });
}

export function errorResponse(message, status = 400) {
  return jsonResponse({ error: message }, { status });
}

export const MAX_JSON_BODY_SIZE = 10 * 1024 * 1024;

export function requestBodyTooLarge(request, maxBytes = MAX_JSON_BODY_SIZE) {
  const contentLength = Number(request.headers.get('content-length') || 0);
  return Number.isFinite(contentLength) && contentLength > maxBytes;
}

export function parseJsonRequest(request) {
  return request.json().catch(() => ({}));
}

export function sanitizeLimit(value, fallback = 30, max = 100) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(parsed, max);
}

function keyBelongsToOwner(key, ownerUserId) {
  if (ownerUserId === undefined || ownerUserId === null) {
    return true;
  }

  if (!Number.isFinite(Number(ownerUserId))) {
    return false;
  }

  const strKey = String(key || '');
  // Google Drive 附件键名格式为 gdrive:${fileId}，其真实归属由数据库 uploaded_files 进行校验
  if (strKey.startsWith('gdrive:')) {
    return true;
  }

  const ownerPrefix = `${Number(ownerUserId)}/`;
  return strKey.startsWith(ownerPrefix);
}

export function pickAttachment(payload, options = {}) {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  if (!payload.key || !payload.name || !payload.type) {
    return null;
  }

  const key = String(payload.key);
  if (!keyBelongsToOwner(key, options.ownerUserId)) {
    return null;
  }

  return {
    key,
    name: String(payload.name),
    type: String(payload.type),
    size: Number(payload.size) || 0,
    url: `/files/${encodeURIComponent(key)}`
  };
}

export function publicFileUrl(key) {
  return `/files/${encodeURIComponent(key)}`;
}

export function nextDailyUtcTime(hour, minute = 0) {
  const target = new Date();
  target.setUTCSeconds(0, 0);
  target.setUTCMinutes(minute);
  target.setUTCHours(hour);
  if (target <= new Date()) {
    target.setUTCDate(target.getUTCDate() + 1);
  }
  return target;
}
export const nextDailyUtcHour = (hour) => nextDailyUtcTime(hour, 0);

export function randomToken(byteLength = 24) {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join('');
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

/**
 * Normalizes an SQLite timestamp (e.g. 'YYYY-MM-DD HH:MM:SS') into standard ISO 8601 UTC string.
 * @param {string|number|Date|null|undefined} value
 * @returns {string|null}
 */
export function normalizeUtcIsoString(value) {
  if (!value) return null;
  const str = String(value).trim();
  if (!str) return null;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(str)) {
    return str.replace(' ', 'T') + (str.endsWith('Z') ? '' : 'Z');
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(str)) {
    return `${str}Z`;
  }
  return str;
}
