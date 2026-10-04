import { AwsClient } from 'aws4fetch';
import { verifyPassword } from '../auth.js';
import { createRateLimiter, clientIp, rateLimitError } from '../rate-limit.js';
import { getStorageServerSecret } from '../data/site-settings.js';
import { fetchGoogleDriveFile } from '../storage/gdrive.js';

const SHARE_UNLOCK_PREFIX = 'share_unlock:';
const SHARE_UNLOCK_TTL_SECONDS = 12 * 60 * 60;

const encoder = new TextEncoder();

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

async function createShareUnlockToken(token, secretKey) {
  const exp = Math.floor(Date.now() / 1000) + SHARE_UNLOCK_TTL_SECONDS;
  const payloadText = JSON.stringify({ token, exp });
  const payloadBytes = encoder.encode(payloadText);
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(`share_unlock:${secretKey}`),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, payloadBytes);
  return `${toBase64Url(payloadBytes)}.${toBase64Url(new Uint8Array(sig))}`;
}

async function verifyShareUnlockToken(unlockToken, expectedToken, secretKey) {
  if (!unlockToken || typeof unlockToken !== 'string') return false;
  const parts = unlockToken.split('.');
  if (parts.length !== 2) return false;
  try {
    const payloadBytes = fromBase64Url(parts[0]);
    const sigBytes = fromBase64Url(parts[1]);
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(`share_unlock:${secretKey}`),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );
    const valid = await crypto.subtle.verify('HMAC', key, sigBytes, payloadBytes);
    if (!valid) return false;
    const payload = JSON.parse(new TextDecoder().decode(payloadBytes));
    if (payload.token !== expectedToken) return false;
    if (payload.exp < Math.floor(Date.now() / 1000)) return false;
    return true;
  } catch {
    return false;
  }
}

const verifyLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 20 });

function errorJson(message, status = 400) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

export async function isWithinSharedSubtree(db, rootId, nodeId) {
  if (!rootId || !nodeId) return false;
  if (rootId === nodeId) return true;

  let currentId = nodeId;
  const visited = new Set();
  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    const row = await db.prepare(
      `SELECT parent_id FROM drive_files WHERE id = ? AND deleted_at IS NULL LIMIT 1`
    ).bind(currentId).first();
    if (!row) return false;
    if (row.parent_id === rootId) return true;
    currentId = row.parent_id;
  }
  return false;
}

export async function requireShareUnlocked(c, share, token) {
  if (!share.has_password) return true;

  // 1. 优先使用无状态 HMAC 签名 Token / Cookie 校验 (0 KV 操作)
  const secretKey = c.env?.ENCRYPTION_SECRET || token;
  const authHeader = c.req.header('x-share-unlock-token') || c.req.header('authorization')?.replace(/^Bearer\s+/i, '');
  const cookieHeader = c.req.header('cookie') || '';
  const cookieMatch = cookieHeader.match(new RegExp(`(?:^|; )edgechat_share_unlock_${token}=([^;]+)`));
  const unlockToken = authHeader || (cookieMatch ? cookieMatch[1] : null);

  if (unlockToken && (await verifyShareUnlockToken(unlockToken, token, secretKey))) {
    return true;
  }

  // 2. 兼容历史 KV 模式
  const kv = c.env?.SESSIONS;
  if (!kv) return false;
  try {
    const value = await kv.get(`${SHARE_UNLOCK_PREFIX}${token}`);
    return value === '1';
  } catch {
    return false;
  }
}

export function registerDrivePublicRoutes(app) {
  // 1. Get public share info
  app.get('/api/drive/public/shares/:token', async (c) => {
    const db = c.env.DB;
    const token = c.req.param('token');

    const share = await db.prepare(
      `SELECT s.id, s.file_id, s.user_id, s.permission, s.expires_at, s.created_at AS shared_at,
              s.max_file_size, s.max_total_bytes, s.uploaded_bytes,
              CASE WHEN s.password_hash IS NOT NULL THEN 1 ELSE 0 END AS has_password,
              f.name, f.is_folder, f.size, f.mime_type, f.updated_at,
              u.display_name AS owner_name, u.username AS owner_username, u.avatar_key AS owner_avatar_key
       FROM drive_shares s
       JOIN drive_files f ON s.file_id = f.id
       LEFT JOIN users u ON s.user_id = u.id
       WHERE s.id = ? AND f.deleted_at IS NULL LIMIT 1`
    ).bind(token).first();

    if (!share) {
      return errorJson('分享链接不存在或已取消', 404);
    }

    if (share.expires_at && new Date(share.expires_at).getTime() < Date.now()) {
      return errorJson('分享链接已过期', 410);
    }

    return c.json({
      token: share.id,
      name: share.name,
      isFolder: Boolean(share.is_folder),
      size: Number(share.size || 0),
      mimeType: share.mime_type,
      updatedAt: share.updated_at,
      sharedAt: share.shared_at,
      ownerName: share.owner_name || '站内用户',
      ownerUsername: share.owner_username || '',
      ownerAvatarUrl: share.owner_avatar_key ? `/files/${encodeURIComponent(share.owner_avatar_key)}` : '',
      permission: share.permission,
      hasPassword: Boolean(share.has_password),
      expiresAt: share.expires_at
    });
  });

  // 2. Verify share password
  app.post('/api/drive/public/shares/:token/verify', async (c) => {
    const db = c.env.DB;
    const token = c.req.param('token');

    const limited = verifyLimiter.check(`${clientIp(c)}:${token}`);
    if (!limited.allowed) {
      return rateLimitError(limited.retryAfterMs);
    }

    const body = await c.req.json().catch(() => ({}));
    const password = String(body.password || '');

    const share = await db.prepare(
      `SELECT id, password_hash, password_salt, expires_at FROM drive_shares WHERE id = ? LIMIT 1`
    ).bind(token).first();

    if (!share) return errorJson('分享不存在', 404);

    if (share.expires_at && new Date(share.expires_at).getTime() < Date.now()) {
      return errorJson('分享链接已过期', 410);
    }

    if (!share.password_hash) {
      return c.json({ ok: true, verified: true });
    }

    const valid = await verifyPassword(password, share.password_hash, share.password_salt);
    if (!valid) {
      return errorJson('提取码或密码错误', 401);
    }

    // 签发短有效期的无状态 HMAC 签名解锁 Token 与 Cookie (消除 KV 写入与读取)
    const secretKey = c.env?.ENCRYPTION_SECRET || token;
    const unlockToken = await createShareUnlockToken(token, secretKey);
    c.header('Set-Cookie', `edgechat_share_unlock_${token}=${unlockToken}; Path=/; Max-Age=${SHARE_UNLOCK_TTL_SECONDS}; SameSite=Lax; HttpOnly`);

    // 兼容历史 KV 模式
    const kv = c.env?.SESSIONS;
    if (kv) {
      await kv.put(`${SHARE_UNLOCK_PREFIX}${token}`, '1', { expirationTtl: SHARE_UNLOCK_TTL_SECONDS }).catch(() => {});
    }

    return c.json({ ok: true, verified: true, unlockToken });
  });

  // 3. Browse shared folder files
  app.get('/api/drive/public/shares/:token/files', async (c) => {
    const db = c.env.DB;
    const token = c.req.param('token');
    const parentId = c.req.query('parentId') || null;

    const share = await db.prepare(
      `SELECT file_id, user_id, permission, expires_at,
              CASE WHEN password_hash IS NOT NULL THEN 1 ELSE 0 END AS has_password
       FROM drive_shares WHERE id = ? LIMIT 1`
    ).bind(token).first();

    if (!share || share.permission === 'upload') {
      return errorJson('无权查看分享目录', 403);
    }

    if (share.expires_at && new Date(share.expires_at).getTime() < Date.now()) {
      return errorJson('分享链接已过期', 410);
    }

    if (!(await requireShareUnlocked(c, share, token))) {
      return errorJson('请先输入提取码或密码', 403);
    }

    // The requested parent must be inside the shared subtree; otherwise a
    // share token for one folder could be used to enumerate unrelated
    // folders owned by the same user (IDOR).
    if (!(await isWithinSharedSubtree(db, share.file_id, parentId || share.file_id))) {
      return errorJson('无权查看该目录', 403);
    }

    const targetFolderId = parentId || share.file_id;

    const res = await db.prepare(
      `SELECT id, parent_id, name, is_folder, size, mime_type, updated_at
       FROM drive_files
       WHERE user_id = ? AND parent_id = ? AND deleted_at IS NULL AND status = 'active'
       ORDER BY is_folder DESC, name ASC`
    ).bind(share.user_id, targetFolderId).all();

    return c.json({ files: res.results || [] });
  });

  // 4. Download a single shared file (the shared root itself)
  app.get('/api/drive/public/shares/:token/download/single', async (c) => {
    const db = c.env.DB;
    const token = c.req.param('token');

    const share = await db.prepare(
      `SELECT file_id, user_id, permission, expires_at,
              CASE WHEN password_hash IS NOT NULL THEN 1 ELSE 0 END AS has_password
       FROM drive_shares WHERE id = ? LIMIT 1`
    ).bind(token).first();

    if (!share || share.permission === 'upload') {
      return errorJson('无权下载该文件', 403);
    }

    if (share.expires_at && new Date(share.expires_at).getTime() < Date.now()) {
      return errorJson('分享链接已过期', 410);
    }

    if (!(await requireShareUnlocked(c, share, token))) {
      return errorJson('请先输入提取码或密码', 403);
    }

    const file = await db.prepare(
      `SELECT id, name, size, mime_type, storage_key, backend, is_folder
       FROM drive_files
       WHERE id = ? AND user_id = ? AND deleted_at IS NULL AND status = 'active' LIMIT 1`
    ).bind(share.file_id, share.user_id).first();

    if (!file || file.is_folder || !file.storage_key) {
      return errorJson('文件未找到', 404);
    }

    const encodedName = encodeURIComponent(file.name);

    if (file.backend === 'gdrive') {
      const storage = await getStorageServerSecret(db, c.env).catch(() => ({}));
      const gRes = await fetchGoogleDriveFile({
        clientId: storage.gdriveClientId,
        clientSecret: storage.gdriveClientSecret,
        refreshToken: storage.gdriveRefreshToken,
        fileId: file.storage_key,
        fetchImpl: fetch
      });
      const gHeaders = new Headers(gRes.headers);
      gHeaders.set('Content-Type', file.mime_type || 'application/octet-stream');
      gHeaders.set('Content-Disposition', `attachment; filename="${encodedName}"; filename*=UTF-8''${encodedName}`);
      return new Response(gRes.body, { status: 200, headers: gHeaders });
    }

    const storage = await getStorageServerSecret(db, c.env).catch(() => ({}));
    const hasS3 = Boolean(storage.accessKeyId && storage.secretAccessKey && (storage.endpoint || storage.accountId));

    if (file.backend === 's3' || (!c.env.FILES && hasS3) || (hasS3 && storage.storageType === 's3')) {
      const aws = new AwsClient({
        accessKeyId: storage.accessKeyId,
        secretAccessKey: storage.secretAccessKey,
        region: storage.region || 'auto',
        service: 's3'
      });
      const bucketName = storage.bucketName || 'edgechat-files';
      const s3Url = storage.endpoint
        ? new URL(`${storage.endpoint.replace(/\/+$/, '')}/${bucketName}/${file.storage_key}`)
        : new URL(`https://${storage.accountId}.r2.cloudflarestorage.com/${bucketName}/${file.storage_key}`);
      const s3Res = await aws.fetch(s3Url, { method: 'GET' });
      if (s3Res.ok) {
        return new Response(s3Res.body, {
          headers: {
            'Content-Type': file.mime_type || 'application/octet-stream',
            'Content-Length': s3Res.headers.get('content-length') || '',
            'Content-Disposition': `attachment; filename="${encodedName}"; filename*=UTF-8''${encodedName}`
          }
        });
      } else if (!c.env.FILES) {
        return errorJson('存储文件未找到', 404);
      }
    }

    if (!c.env.FILES) {
      return errorJson('存储不可用', 503);
    }

    const object = await c.env.FILES.get(file.storage_key);
    if (!object) {
      return errorJson('存储文件未找到', 404);
    }

    return new Response(object.body, {
      headers: {
        'Content-Type': file.mime_type || 'application/octet-stream',
        'Content-Length': String(object.size),
        'Content-Disposition': `attachment; filename="${encodedName}"; filename*=UTF-8''${encodedName}`
      }
    });
  });

  // 4b. Download shared file by id (folder shares)
  app.get('/api/drive/public/shares/:token/download/:fileId', async (c) => {
    const db = c.env.DB;
    const token = c.req.param('token');
    const fileId = c.req.param('fileId');

    const share = await db.prepare(
      `SELECT file_id, user_id, permission, expires_at,
              CASE WHEN password_hash IS NOT NULL THEN 1 ELSE 0 END AS has_password
       FROM drive_shares WHERE id = ? LIMIT 1`
    ).bind(token).first();

    if (!share || share.permission === 'upload') {
      return errorJson('无权下载该文件', 403);
    }

    if (share.expires_at && new Date(share.expires_at).getTime() < Date.now()) {
      return errorJson('分享链接已过期', 410);
    }

    if (!(await requireShareUnlocked(c, share, token))) {
      return errorJson('请先输入提取码或密码', 403);
    }

    // Only files inside the shared subtree may be downloaded; a valid token
    // must not egress any other file owned by the sharer.
    if (!(await isWithinSharedSubtree(db, share.file_id, fileId))) {
      return errorJson('无权下载该文件', 403);
    }

    const file = await db.prepare(
      `SELECT id, name, size, mime_type, storage_key, backend, is_folder
       FROM drive_files
       WHERE id = ? AND user_id = ? AND deleted_at IS NULL AND status = 'active' LIMIT 1`
    ).bind(fileId, share.user_id).first();

    if (!file || file.is_folder || !file.storage_key) {
      return errorJson('文件未找到', 404);
    }

    const encodedName = encodeURIComponent(file.name);

    if (file.backend === 'gdrive') {
      const storage = await getStorageServerSecret(db, c.env).catch(() => ({}));
      const gRes = await fetchGoogleDriveFile({
        clientId: storage.gdriveClientId,
        clientSecret: storage.gdriveClientSecret,
        refreshToken: storage.gdriveRefreshToken,
        fileId: file.storage_key,
        fetchImpl: fetch
      });
      const gHeaders = new Headers(gRes.headers);
      gHeaders.set('Content-Type', file.mime_type || 'application/octet-stream');
      gHeaders.set('Content-Disposition', `attachment; filename="${encodedName}"; filename*=UTF-8''${encodedName}`);
      return new Response(gRes.body, { status: 200, headers: gHeaders });
    }

    const storage = await getStorageServerSecret(db, c.env).catch(() => ({}));
    const hasS3 = Boolean(storage.accessKeyId && storage.secretAccessKey && (storage.endpoint || storage.accountId));

    if (file.backend === 's3' || (!c.env.FILES && hasS3) || (hasS3 && storage.storageType === 's3')) {
      const aws = new AwsClient({
        accessKeyId: storage.accessKeyId,
        secretAccessKey: storage.secretAccessKey,
        region: storage.region || 'auto',
        service: 's3'
      });
      const bucketName = storage.bucketName || 'edgechat-files';
      const s3Url = storage.endpoint
        ? new URL(`${storage.endpoint.replace(/\/+$/, '')}/${bucketName}/${file.storage_key}`)
        : new URL(`https://${storage.accountId}.r2.cloudflarestorage.com/${bucketName}/${file.storage_key}`);
      const s3Res = await aws.fetch(s3Url, { method: 'GET' });
      if (s3Res.ok) {
        return new Response(s3Res.body, {
          headers: {
            'Content-Type': file.mime_type || 'application/octet-stream',
            'Content-Length': s3Res.headers.get('content-length') || '',
            'Content-Disposition': `attachment; filename="${encodedName}"; filename*=UTF-8''${encodedName}`
          }
        });
      } else if (!c.env.FILES) {
        return errorJson('存储文件未找到', 404);
      }
    }

    if (!c.env.FILES) {
      return errorJson('存储不可用', 503);
    }

    const object = await c.env.FILES.get(file.storage_key);
    if (!object) {
      return errorJson('存储文件未找到', 404);
    }

    return new Response(object.body, {
      headers: {
        'Content-Type': file.mime_type || 'application/octet-stream',
        'Content-Length': String(object.size),
        'Content-Disposition': `attachment; filename="${encodedName}"; filename*=UTF-8''${encodedName}`
      }
    });
  });
}
