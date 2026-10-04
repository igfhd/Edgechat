import { AwsClient } from 'aws4fetch';
import { hashPassword, } from '../auth.js';
import { getSiteSettings, getStorageServerSecret } from '../data/site-settings.js';
import { getUserGroupsForUsers } from '../data/user-groups.js';
import { isFileTypeAllowed } from './upload.js';
import {
  createGoogleDriveUploadSession,
  fetchGoogleDriveFile,
  uploadGoogleDriveBinaryFile,
  uploadGoogleDriveTextFile,
  updateGoogleDriveFileContent,
  deleteGoogleDriveFile,
} from '../storage/gdrive.js';

const DEFAULT_QUOTA_BYTES = 10 * 1024 * 1024 * 1024; // 10 GB

function sanitizeFilename(name) {
  return String(name || 'file')
    .replace(/[^\w.\-\u4e00-\u9fa5]/g, '_')
    .slice(0, 100);
}

function errorJson(message, status = 400) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function getS3ClientAndUrl(storage, key) {
  if (!storage || !storage.accessKeyId || !storage.secretAccessKey || (!storage.endpoint && !storage.accountId)) {
    return null;
  }
  const aws = new AwsClient({
    accessKeyId: storage.accessKeyId,
    secretAccessKey: storage.secretAccessKey,
    region: storage.region || 'auto',
    service: 's3'
  });
  const bucketName = storage.bucketName || 'edgechat-files';
  const cleanKey = String(key || '').replace(/^\/+/, '');
  const url = storage.endpoint
    ? new URL(`${storage.endpoint.replace(/\/+$/, '')}/${bucketName}/${cleanKey}`)
    : new URL(`https://${storage.accountId}.r2.cloudflarestorage.com/${bucketName}/${cleanKey}`);
  return { aws, url, bucketName };
}

function _jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

export function resolveMimeType(filename = '', mimeType = '') {
  if (mimeType && mimeType !== 'application/octet-stream' && mimeType !== 'binary/octet-stream') {
    if (mimeType.startsWith('text/') && !mimeType.includes('charset')) {
      return `${mimeType}; charset=utf-8`;
    }
    return mimeType;
  }
  const ext = (filename.split('.').pop() || '').toLowerCase();
  const map = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    bmp: 'image/bmp',
    ico: 'image/x-icon',
    avif: 'image/avif',
    mp4: 'video/mp4',
    webm: 'video/webm',
    mov: 'video/quicktime',
    mkv: 'video/x-matroska',
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    ogg: 'audio/ogg',
    m4a: 'audio/mp4',
    flac: 'audio/flac',
    aac: 'audio/aac',
    pdf: 'application/pdf',
    txt: 'text/plain; charset=utf-8',
    md: 'text/markdown; charset=utf-8',
    markdown: 'text/markdown; charset=utf-8',
    log: 'text/plain; charset=utf-8',
    csv: 'text/csv; charset=utf-8',
    tsv: 'text/tab-separated-values; charset=utf-8',
    json: 'application/json; charset=utf-8',
    js: 'text/javascript; charset=utf-8',
    ts: 'text/typescript; charset=utf-8',
    jsx: 'text/javascript; charset=utf-8',
    tsx: 'text/typescript; charset=utf-8',
    vue: 'text/plain; charset=utf-8',
    html: 'text/html; charset=utf-8',
    htm: 'text/html; charset=utf-8',
    css: 'text/css; charset=utf-8',
    scss: 'text/x-scss; charset=utf-8',
    sql: 'text/plain; charset=utf-8',
    py: 'text/x-python; charset=utf-8',
    sh: 'text/x-sh; charset=utf-8',
    bash: 'text/x-sh; charset=utf-8',
    xml: 'text/xml; charset=utf-8',
    yaml: 'text/yaml; charset=utf-8',
    yml: 'text/yaml; charset=utf-8',
    toml: 'text/plain; charset=utf-8',
    ini: 'text/plain; charset=utf-8',
    env: 'text/plain; charset=utf-8',
    gitignore: 'text/plain; charset=utf-8'
  };
  return map[ext] || mimeType || 'application/octet-stream';
}

let driveMemberSharesTableReady = false;

export async function ensureDriveMemberSharesTable(db) {
  if (driveMemberSharesTableReady) return;
  try {
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS drive_member_shares (
        id TEXT PRIMARY KEY,
        file_id TEXT NOT NULL,
        owner_id INTEGER NOT NULL,
        target_type TEXT NOT NULL DEFAULT 'user',
        target_id INTEGER NOT NULL,
        permission TEXT NOT NULL DEFAULT 'read',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (file_id) REFERENCES drive_files(id) ON DELETE CASCADE,
        FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `).run();
    await db.prepare(`CREATE INDEX IF NOT EXISTS idx_drive_member_shares_target ON drive_member_shares(target_type, target_id)`).run();
    await db.prepare(`CREATE INDEX IF NOT EXISTS idx_drive_member_shares_file ON drive_member_shares(file_id)`).run();
    await db.prepare(`CREATE INDEX IF NOT EXISTS idx_drive_member_shares_owner ON drive_member_shares(owner_id)`).run();
    driveMemberSharesTableReady = true;
  } catch (e) {
    console.warn('[drive_member_shares] table check notice:', e.message);
  }
}

export async function getUserStorageQuota(db, userId) {
  try {
    const res = await db.prepare(
      `SELECT storage_quota_bytes FROM drive_user_credentials WHERE user_id = ? LIMIT 1`
    ).bind(userId).first();
    return res?.storage_quota_bytes ? Number(res.storage_quota_bytes) : DEFAULT_QUOTA_BYTES;
  } catch {
    return DEFAULT_QUOTA_BYTES;
  }
}

export async function getUserStorageUsage(db, userId) {
  try {
    const res = await db.prepare(
      `SELECT COALESCE(SUM(size), 0) AS total_size,
              COUNT(CASE WHEN is_folder = 0 THEN 1 END) AS file_count,
              COUNT(CASE WHEN is_folder = 1 THEN 1 END) AS folder_count
       FROM drive_files
       WHERE user_id = ? AND deleted_at IS NULL AND status = 'active'`
    ).bind(userId).first();
    return {
      usedBytes: Number(res?.total_size || 0),
      fileCount: Number(res?.file_count || 0),
      folderCount: Number(res?.folder_count || 0)
    };
  } catch {
    return { usedBytes: 0, fileCount: 0, folderCount: 0 };
  }
}

export async function resolveFileAccess(db, fileId, userId) {
  if (!fileId || !userId) return { hasAccess: false };

  const file = await db.prepare(
    `SELECT id, user_id, parent_id, name, is_folder, size, mime_type, hash, storage_key, backend, status, created_at, updated_at
     FROM drive_files
     WHERE id = ? AND deleted_at IS NULL
     LIMIT 1`
  ).bind(fileId).first();

  if (!file) return { hasAccess: false };

  if (file.user_id === userId) {
    return { hasAccess: true, permission: 'owner', ownerId: userId, file };
  }

  // Get rooms of this user
  const userRooms = await db.prepare(
    `SELECT channel_id FROM channel_members WHERE user_id = ?`
  ).bind(userId).all();
  const roomIds = (userRooms.results || []).map(r => r.channel_id);

  let currentId = fileId;
  const visited = new Set();

  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);

    let query = `SELECT id, permission, owner_id FROM drive_member_shares WHERE file_id = ? AND ((target_type = 'user' AND target_id = ?)`;
    const params = [currentId, userId];
    if (roomIds.length > 0) {
      query += ` OR (target_type = 'room' AND target_id IN (${roomIds.map(() => '?').join(',')}))`;
      params.push(...roomIds);
    }
    query += `) LIMIT 1`;

    const share = await db.prepare(query).bind(...params).first();
    if (share) {
      return {
        hasAccess: true,
        permission: share.permission,
        ownerId: file.user_id,
        sharedRootId: currentId,
        file
      };
    }

    const parentRow = await db.prepare(
      `SELECT parent_id FROM drive_files WHERE id = ? AND deleted_at IS NULL LIMIT 1`
    ).bind(currentId).first();
    currentId = parentRow?.parent_id || null;
  }

  return { hasAccess: false };
}

export async function buildFolderBreadcrumbs(db, userId, folderId) {
  if (!folderId) return [];
  const breadcrumbs = [];
  let currentId = folderId;
  const visited = new Set();

  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    const folder = await db.prepare(
      `SELECT id, parent_id, name FROM drive_files WHERE id = ? AND user_id = ? AND is_folder = 1 AND deleted_at IS NULL LIMIT 1`
    ).bind(currentId, userId).first();

    if (!folder) break;
    breadcrumbs.unshift({ id: folder.id, name: folder.name });
    currentId = folder.parent_id;
  }
  return breadcrumbs;
}

// Helper to collect all descendant file/folder IDs
export async function collectDescendantIds(db, userId, rootId) {
  const allFiles = await db.prepare(
    `SELECT id, parent_id FROM drive_files WHERE user_id = ?`
  ).bind(userId).all();
  const items = allFiles.results || [];
  const result = [rootId];
  function traverse(pId) {
    for (const item of items) {
      if (item.parent_id === pId && !result.includes(item.id)) {
        result.push(item.id);
        traverse(item.id);
      }
    }
  }
  traverse(rootId);
  return result;
}

export function registerDriveRoutes(app) {
  // 1. Storage stats & quota
  app.get('/api/drive/stats', async (c) => {
    const session = c.get('session');
    const db = c.env.DB;
    await ensureDriveMemberSharesTable(db);
    const usage = await getUserStorageUsage(db, session.userId);
    const quotaBytes = await getUserStorageQuota(db, session.userId);
    return c.json({
      usedBytes: usage.usedBytes,
      quotaBytes,
      fileCount: usage.fileCount,
      folderCount: usage.folderCount
    });
  });

  // 2. List files & folders (supports personal and shared folders)
  app.get('/api/drive/files/recent', async (c) => {
    const session = c.get('session');
    const db = c.env.DB;
    const limit = Math.min(100, Math.max(1, Number(c.req.query('limit') || 50)));

    const res = await db.prepare(
      `SELECT f.id, f.parent_id, f.name, f.is_folder, f.size, f.mime_type, f.hash,
              f.storage_key, f.backend, f.status, f.created_at, f.updated_at,
              p.name AS parent_name
       FROM drive_files f
       LEFT JOIN drive_files p ON f.parent_id = p.id AND p.deleted_at IS NULL
       WHERE f.user_id = ?
         AND f.deleted_at IS NULL
         AND f.status = 'active'
         AND f.is_folder = 0
       ORDER BY f.created_at DESC, f.id DESC
       LIMIT ?`
    ).bind(session.userId, limit).all();

    return c.json({ files: res.results || [] });
  });

  app.get('/api/drive/files', async (c) => {
    const session = c.get('session');
    const db = c.env.DB;
    await ensureDriveMemberSharesTable(db);
    const parentId = c.req.query('parentId') || null;
    const search = (c.req.query('search') || '').trim().toLowerCase();

    let targetUserId = session.userId;
    let sharedPermission = null;

    if (parentId) {
      // Check if parentId is owned by user or shared
      const ownParent = await db.prepare(
        `SELECT id FROM drive_files WHERE id = ? AND user_id = ? AND deleted_at IS NULL LIMIT 1`
      ).bind(parentId, session.userId).first();

      if (!ownParent) {
        const access = await resolveFileAccess(db, parentId, session.userId);
        if (!access.hasAccess) {
          return errorJson('无权访问该文件夹或已被取消共享', 403);
        }
        targetUserId = access.ownerId;
        sharedPermission = access.permission;
      }
    }

    let files;
    if (search) {
      const query = `%${search}%`;
      const res = await db.prepare(
        `SELECT id, parent_id, name, is_folder, size, mime_type, hash, storage_key, backend, status, created_at, updated_at
         FROM drive_files
         WHERE user_id = ? AND deleted_at IS NULL AND status = 'active' AND LOWER(name) LIKE ?
         ORDER BY is_folder DESC, name ASC`
      ).bind(targetUserId, query).all();
      files = res.results || [];
    } else if (parentId) {
      const res = await db.prepare(
        `SELECT id, parent_id, name, is_folder, size, mime_type, hash, storage_key, backend, status, created_at, updated_at
         FROM drive_files
         WHERE user_id = ? AND parent_id = ? AND deleted_at IS NULL AND status = 'active'
         ORDER BY is_folder DESC, name ASC`
      ).bind(targetUserId, parentId).all();
      files = res.results || [];
    } else {
      const res = await db.prepare(
        `SELECT id, parent_id, name, is_folder, size, mime_type, hash, storage_key, backend, status, created_at, updated_at
         FROM drive_files
         WHERE user_id = ? AND parent_id IS NULL AND deleted_at IS NULL AND status = 'active'
         ORDER BY is_folder DESC, name ASC`
      ).bind(targetUserId).all();
      files = res.results || [];
    }

    const breadcrumbs = parentId ? await buildFolderBreadcrumbs(db, targetUserId, parentId) : [];
    return c.json({ files, breadcrumbs, sharedPermission });
  });

  // 3. Create folder (supports shared folders)
  app.post('/api/drive/files/folder', async (c) => {
    const session = c.get('session');
    const db = c.env.DB;
    await ensureDriveMemberSharesTable(db);
    const body = await c.req.json().catch(() => ({}));
    const name = String(body.name || '').trim();
    const parentId = body.parentId || null;
    const getOrCreate = Boolean(body.getOrCreate);

    if (!name) {
      return errorJson('文件夹名称不能为空');
    }

    let targetUserId = session.userId;
    if (parentId) {
      const ownParent = await db.prepare(
        `SELECT id FROM drive_files WHERE id = ? AND user_id = ? AND deleted_at IS NULL LIMIT 1`
      ).bind(parentId, session.userId).first();

      if (!ownParent) {
        const access = await resolveFileAccess(db, parentId, session.userId);
        if (!access.hasAccess || !['write', 'admin', 'owner'].includes(access.permission)) {
          return errorJson('无权在此共享文件夹中新建子文件夹', 403);
        }
        targetUserId = access.ownerId;
      }
    }

    // Check duplicate name in parent
    const existing = await db.prepare(
      `SELECT id, name, parent_id, is_folder FROM drive_files WHERE user_id = ? AND ${parentId ? 'parent_id = ?' : 'parent_id IS NULL'} AND name = ? AND deleted_at IS NULL AND is_folder = 1 LIMIT 1`
    ).bind(...(parentId ? [targetUserId, parentId, name] : [targetUserId, name])).first();

    if (existing) {
      if (getOrCreate) {
        return c.json({ ok: true, folder: { id: existing.id, name: existing.name, parent_id: existing.parent_id, is_folder: 1 }, isExisting: true });
      }
      return errorJson('同级目录下已存在同名文件夹');
    }

    const id = crypto.randomUUID();
    await db.prepare(
      `INSERT INTO drive_files (id, user_id, parent_id, name, is_folder, size, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, 0, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
    ).bind(id, targetUserId, parentId, name).run();

    return c.json({ ok: true, folder: { id, name, parent_id: parentId, is_folder: 1 } });
  });

  // 4. Request upload ticket (Presigned PUT or direct upload fallback, supports shared folders)
  app.post('/api/drive/files/upload-ticket', async (c) => {
    const session = c.get('session');
    const db = c.env.DB;
    await ensureDriveMemberSharesTable(db);
    const body = await c.req.json().catch(() => ({}));
    const name = String(body.name || '').trim();
    const size = Number(body.size || 0);
    const mimeType = String(body.mimeType || 'application/octet-stream');
    const parentId = body.parentId || null;
    const hash = body.hash || null;

    if (!name) {
      return errorJson('文件名不能为空');
    }

    const siteSettings = await getSiteSettings(db, c.env).catch(() => ({}));
    const maxMb = Number(siteSettings.uploadMaxFileSizeMb) || (c.env.MAX_FILE_SIZE ? Math.round(Number(c.env.MAX_FILE_SIZE) / 1024 / 1024) : 20);
    const maxFileSize = maxMb * 1024 * 1024;
    if (size > maxFileSize) {
      return errorJson(`文件大小不能超过 ${maxMb}MB`, 413);
    }

    const allowed = siteSettings.uploadAllowedTypes !== undefined ? siteSettings.uploadAllowedTypes : (c.env.ALLOWED_FILE_TYPES || '');
    const blocked = siteSettings.uploadBlockedTypes !== undefined ? siteSettings.uploadBlockedTypes : '';
    const mode = siteSettings.uploadRestrictionMode || (c.env.ALLOWED_FILE_TYPES ? 'allowlist' : 'none');

    const typeCheck = isFileTypeAllowed({
      filename: name,
      mimeType,
      restrictionMode: mode,
      allowedTypes: allowed,
      blockedTypes: blocked
    });

    if (!typeCheck.allowed) {
      return errorJson(typeCheck.reason || '该文件类型不允许上传', 403);
    }

    let targetUserId = session.userId;
    if (parentId) {
      const ownParent = await db.prepare(
        `SELECT id FROM drive_files WHERE id = ? AND user_id = ? AND deleted_at IS NULL LIMIT 1`
      ).bind(parentId, session.userId).first();

      if (!ownParent) {
        const access = await resolveFileAccess(db, parentId, session.userId);
        if (!access.hasAccess || !['write', 'admin', 'owner'].includes(access.permission)) {
          return errorJson('无权在此共享文件夹中上传文件', 403);
        }
        targetUserId = access.ownerId;
      }
    }

    // Check quota against target user
    const usage = await getUserStorageUsage(db, targetUserId);
    const quota = await getUserStorageQuota(db, targetUserId);
    if (usage.usedBytes + size > quota) {
      return errorJson(`存储空间已达上限 (${(quota / 1024 / 1024 / 1024).toFixed(1)} GB)，请清理后再试`, 403);
    }

    const fileId = crypto.randomUUID();
    const safeName = sanitizeFilename(name);
    const storageKey = `drive/${targetUserId}/${fileId}-${safeName}`;

    // Create pending record
    await db.prepare(
      `INSERT INTO drive_files (id, user_id, parent_id, name, is_folder, size, mime_type, hash, storage_key, backend, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, 'r2', 'pending', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
    ).bind(fileId, targetUserId, parentId, name, size, mimeType, hash, storageKey).run();

    // Check if R2 / S3 credentials exist for presigned URL
    const storage = await getStorageServerSecret(db, c.env);

    if (storage.storageType === 'gdrive' && storage.gdriveClientId && storage.gdriveClientSecret && storage.gdriveRefreshToken) {
      await db.prepare(
        "UPDATE drive_files SET backend = 'gdrive', storage_key = 'PENDING_GDRIVE' WHERE id = ?"
      ).bind(fileId).run();

      // Google Drive 同样统一走同源 Worker direct-upload 传输，
      // 彻底解决国内环境直连 googleapis.com 网络不通、CORS 拦截及卡死超时问题
      return c.json({
        fileId,
        storageKey: 'PENDING_GDRIVE',
        uploadUrl: `/api/drive/files/direct-upload?fileId=${encodeURIComponent(fileId)}`,
        method: 'PUT',
        headers: { 'Content-Type': mimeType },
        directWorkerUpload: true,
        backend: 'gdrive'
      });
    }

    const accessKeyId = storage.accessKeyId;
    const secretAccessKey = storage.secretAccessKey;
    const accountId = storage.accountId;
    const bucketName = storage.bucketName || 'edgechat-files';
    const endpoint = storage.endpoint || (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : '');
    const region = storage.region || 'auto';

    // 统一通过 Worker direct-upload 传输（同源上传，彻底避免第三方 R2/S3 无 CORS 导致的上传卡死无进度问题）
    return c.json({
      fileId,
      storageKey,
      uploadUrl: `/api/drive/files/direct-upload?fileId=${encodeURIComponent(fileId)}`,
      method: 'PUT',
      headers: { 'Content-Type': mimeType },
      directWorkerUpload: true
    });
  });

  // 5. Confirm upload
  app.post('/api/drive/files/confirm', async (c) => {
    const session = c.get('session');
    const db = c.env.DB;
    await ensureDriveMemberSharesTable(db);
    const body = await c.req.json().catch(() => ({}));
    const fileId = String(body.fileId || '');
    const gdriveFileId = body.gdriveFileId ? String(body.gdriveFileId).trim() : null;
    const actualHash = body.hash || null;

    if (!fileId) {
      return errorJson('缺少 fileId');
    }

    const file = await db.prepare(
      `SELECT id, storage_key, size, user_id, status, backend, name, mime_type FROM drive_files WHERE id = ? LIMIT 1`
    ).bind(fileId).first();

    if (!file) {
      return errorJson('文件未找到', 404);
    }

    if (file.user_id !== session.userId) {
      const access = await resolveFileAccess(db, fileId, session.userId);
      if (!access.hasAccess || !['write', 'admin', 'owner'].includes(access.permission)) {
        return errorJson('无权确认该文件的上传', 403);
      }
    }

    // Authoritative size comes from the storage layer, never from the
    // client: the upload-ticket path lets clients PUT directly to R2, so a
    // client could otherwise claim a tiny size and bypass the quota check.
    let verifiedSize = Number(file.size) || 0;
    if (body.actualSize && Number(body.actualSize) > 0) {
      verifiedSize = Number(body.actualSize);
    }
    if (file.storage_key && c.env.FILES) {
      try {
        const object = await c.env.FILES.head(file.storage_key);
        if (object?.size) verifiedSize = Number(object.size);
      } catch {
        // Fall back to the recorded size; the per-route max-size check still applies.
      }
    } else if (file.storage_key) {
      const storage = await getStorageServerSecret(db, c.env).catch(() => ({}));
      const s3 = getS3ClientAndUrl(storage, file.storage_key);
      if (s3) {
        try {
          const s3Head = await s3.aws.fetch(s3.url, { method: 'HEAD' });
          const cl = Number(s3Head.headers.get('content-length') || 0);
          if (cl > 0) verifiedSize = cl;
        } catch {
          // Fall back to the recorded size
        }
      }
    }

    const siteSettings = await getSiteSettings(db, c.env).catch(() => ({}));
    const maxMb = Number(siteSettings.uploadMaxFileSizeMb) || (c.env.MAX_FILE_SIZE ? Math.round(Number(c.env.MAX_FILE_SIZE) / 1024 / 1024) : 20);
    const maxFileSize = maxMb * 1024 * 1024;
    if (verifiedSize > maxFileSize) {
      return errorJson(`文件大小不能超过 ${maxMb}MB`, 413);
    }

    const allowed = siteSettings.uploadAllowedTypes !== undefined ? siteSettings.uploadAllowedTypes : (c.env.ALLOWED_FILE_TYPES || '');
    const blocked = siteSettings.uploadBlockedTypes !== undefined ? siteSettings.uploadBlockedTypes : '';
    const mode = siteSettings.uploadRestrictionMode || (c.env.ALLOWED_FILE_TYPES ? 'allowlist' : 'none');

    const typeCheck = isFileTypeAllowed({
      filename: file.name,
      mimeType: file.mime_type,
      restrictionMode: mode,
      allowedTypes: allowed,
      blockedTypes: blocked
    });

    if (!typeCheck.allowed) {
      return errorJson(typeCheck.reason || '该文件类型不允许上传', 403);
    }

    const usage = await getUserStorageUsage(db, file.user_id);
    const quota = await getUserStorageQuota(db, file.user_id);
    if (usage.usedBytes + verifiedSize > quota) {
      return errorJson(`存储空间已达上限 (${(quota / 1024 / 1024 / 1024).toFixed(1)} GB)，请清理后再试`, 403);
    }

    const targetStorageKey = gdriveFileId || file.storage_key;
    const targetBackend = gdriveFileId ? 'gdrive' : (file.backend || 'r2');

    await db.prepare(
      `UPDATE drive_files
       SET status = 'active',
           size = ?,
           storage_key = ?,
           backend = ?,
           hash = COALESCE(?, hash),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).bind(verifiedSize, targetStorageKey, targetBackend, actualHash, fileId).run();

    return c.json({ ok: true, fileId, size: verifiedSize });
  });

  // 6. Direct Worker Upload
  app.put('/api/drive/files/direct-upload', async (c) => {
    const session = c.get('session');
    const db = c.env.DB;
    await ensureDriveMemberSharesTable(db);
    const fileId = c.req.query('fileId');

    if (!fileId) return errorJson('缺少 fileId');

    const file = await db.prepare(
      `SELECT id, user_id, storage_key, mime_type, name, status FROM drive_files WHERE id = ? LIMIT 1`
    ).bind(fileId).first();

    if (!file?.storage_key) {
      return errorJson('文件未找到', 404);
    }

    if (file.user_id !== session.userId) {
      const access = await resolveFileAccess(db, fileId, session.userId);
      if (!access.hasAccess || !['write', 'admin', 'owner'].includes(access.permission)) {
        return errorJson('无权上传至该文件', 403);
      }
    }

    const storage = await getStorageServerSecret(db, c.env).catch(() => ({}));
    const s3 = getS3ClientAndUrl(storage, file.storage_key);
    const hasGdrive = storage.storageType === 'gdrive' && storage.gdriveClientId && storage.gdriveClientSecret && storage.gdriveRefreshToken;
    const hasNativeR2 = Boolean(c.env.FILES);

    if (!hasNativeR2 && !s3 && !hasGdrive) {
      return errorJson('存储后端未配置或存储未绑定', 503);
    }

    // Reject oversized bodies up front (the global /api/* body guard skips
    // this route so the configured site limit must be enforced here).
    const siteSettings = await getSiteSettings(db, c.env).catch(() => ({}));
    const allowed = siteSettings.uploadAllowedTypes !== undefined ? siteSettings.uploadAllowedTypes : (c.env.ALLOWED_FILE_TYPES || '');
    const blocked = siteSettings.uploadBlockedTypes !== undefined ? siteSettings.uploadBlockedTypes : '';
    const mode = siteSettings.uploadRestrictionMode || (c.env.ALLOWED_FILE_TYPES ? 'allowlist' : 'none');

    const typeCheck = isFileTypeAllowed({
      filename: file.name,
      mimeType: file.mime_type,
      restrictionMode: mode,
      allowedTypes: allowed,
      blockedTypes: blocked
    });

    if (!typeCheck.allowed) {
      return errorJson(typeCheck.reason || '该文件类型不允许上传', 403);
    }

    const maxMb = Number(siteSettings.uploadMaxFileSizeMb) || (c.env.MAX_FILE_SIZE ? Math.round(Number(c.env.MAX_FILE_SIZE) / 1024 / 1024) : 20);
    const maxFileSize = maxMb * 1024 * 1024;
    const contentLength = Number(c.req.header('content-length') || 0);
    if (contentLength > maxFileSize) {
      return errorJson(`文件大小不能超过 ${maxMb}MB`, 413);
    }

    let size = 0;
    let targetBackend = 'r2';

    if (hasGdrive) {
      targetBackend = 'gdrive';
      const bodyBytes = await c.req.arrayBuffer();
      size = bodyBytes.byteLength;
      if (size > maxFileSize) {
        return errorJson(`文件大小不能超过 ${maxMb}MB`, 413);
      }
      const usage = await getUserStorageUsage(db, file.user_id);
      const quota = await getUserStorageQuota(db, file.user_id);
      if (usage.usedBytes + size > quota) {
        return errorJson(`存储空间已达上限 (${(quota / 1024 / 1024 / 1024).toFixed(1)} GB)，请清理后再试`, 403);
      }

      const gdriveFile = await uploadGoogleDriveBinaryFile({
        clientId: storage.gdriveClientId,
        clientSecret: storage.gdriveClientSecret,
        refreshToken: storage.gdriveRefreshToken,
        folderId: storage.gdriveFolderId,
        fileName: file.name,
        bytes: bodyBytes,
        mimeType: file.mime_type || 'application/octet-stream',
        fetchImpl: fetch
      });

      await db.prepare(
        `UPDATE drive_files
         SET status = 'active', size = ?, storage_key = ?, backend = 'gdrive', updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      ).bind(size, gdriveFile.id, fileId).run();

      return c.json({ ok: true, fileId, size });
    } else if (s3 && (storage.storageType === 's3' || !hasNativeR2 || (storage.accessKeyId && storage.secretAccessKey))) {
      targetBackend = 's3';
      const bodyBytes = await c.req.arrayBuffer();
      size = bodyBytes.byteLength;
      if (size > maxFileSize) {
        return errorJson(`文件大小不能超过 ${maxMb}MB`, 413);
      }
      const usage = await getUserStorageUsage(db, file.user_id);
      const quota = await getUserStorageQuota(db, file.user_id);
      if (usage.usedBytes + size > quota) {
        return errorJson(`存储空间已达上限 (${(quota / 1024 / 1024 / 1024).toFixed(1)} GB)，请清理后再试`, 403);
      }
      const s3Res = await s3.aws.fetch(s3.url, {
        method: 'PUT',
        headers: {
          'Content-Type': file.mime_type || 'application/octet-stream'
        },
        body: bodyBytes
      });
      if (!s3Res.ok) {
        const errText = await s3Res.text().catch(() => '');
        return errorJson(`S3 存储上传失败 (${s3Res.status}): ${errText}`, 500);
      }
    } else if (hasNativeR2) {
      targetBackend = 'r2';
      const body = c.req.raw.body;
      await c.env.FILES.put(file.storage_key, body, {
        httpMetadata: {
          contentType: file.mime_type || 'application/octet-stream'
        }
      });
      const object = await c.env.FILES.head(file.storage_key);
      size = object?.size || 0;
      if (size > maxFileSize) {
        await c.env.FILES.delete(file.storage_key).catch(() => {});
        return errorJson(`文件大小不能超过 ${maxMb}MB`, 413);
      }
      const usage = await getUserStorageUsage(db, file.user_id);
      const quota = await getUserStorageQuota(db, file.user_id);
      if (usage.usedBytes + size > quota) {
        await c.env.FILES.delete(file.storage_key).catch(() => {});
        return errorJson(`存储空间已达上限 (${(quota / 1024 / 1024 / 1024).toFixed(1)} GB)，请清理后再试`, 403);
      }
    }

    await db.prepare(
      `UPDATE drive_files
       SET status = 'active', size = ?, backend = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).bind(size, targetBackend, fileId).run();

    return c.json({ ok: true, fileId, size });
  });

  // 7. Download or view file (supports owner and shared access)
  app.get('/api/drive/files/:id', async (c) => {
    const session = c.get('session');
    const db = c.env.DB;
    await ensureDriveMemberSharesTable(db);
    const fileId = c.req.param('id');
    const inline = c.req.query('view') === '1';

    const file = await db.prepare(
      `SELECT id, user_id, name, size, mime_type, storage_key, backend, is_folder
       FROM drive_files
       WHERE id = ? AND deleted_at IS NULL AND status = 'active' LIMIT 1`
    ).bind(fileId).first();

    if (!file || file.is_folder || !file.storage_key) {
      return errorJson('文件不存在或已删除', 404);
    }

    if (file.user_id !== session.userId) {
      const access = await resolveFileAccess(db, fileId, session.userId);
      if (!access.hasAccess) {
        return errorJson('无权访问该文件', 403);
      }
    }

    const dispositionType = inline ? 'inline' : 'attachment';
    const encodedName = encodeURIComponent(file.name);
    const contentType = resolveMimeType(file.name, file.mime_type);

    if (file.backend === 'gdrive') {
      const storage = await getStorageServerSecret(db, c.env);
      if (!storage.gdriveClientId || !storage.gdriveClientSecret || !storage.gdriveRefreshToken) {
        return errorJson('Google Drive 凭据未配置', 503);
      }
      try {
        const gRes = await fetchGoogleDriveFile({
          clientId: storage.gdriveClientId,
          clientSecret: storage.gdriveClientSecret,
          refreshToken: storage.gdriveRefreshToken,
          fileId: file.storage_key,
          fetchImpl: fetch
        });
        const gHeaders = new Headers(gRes.headers);
        gHeaders.set('Content-Type', contentType);
        gHeaders.set('Content-Disposition', `${dispositionType}; filename="${encodedName}"; filename*=UTF-8''${encodedName}`);
        gHeaders.set('Cache-Control', 'private, max-age=3600');
        return new Response(gRes.body, {
          status: 200,
          headers: gHeaders
        });
      } catch (err) {
        console.error('[drive/files] Google Drive fetch error:', err);
        return errorJson(`Google Drive 文件下载失败: ${err.message || err}`, 502);
      }
    }

    const storage = await getStorageServerSecret(db, c.env).catch(() => ({}));
    const s3 = getS3ClientAndUrl(storage, file.storage_key);

    if (file.backend === 's3' || (!c.env.FILES && s3) || (s3 && storage.storageType === 's3')) {
      const fetchHeaders = {};
      const rangeHeader = c.req.header('range');
      if (rangeHeader) fetchHeaders.range = rangeHeader;
      const s3Res = await s3.aws.fetch(s3.url, { method: 'GET', headers: fetchHeaders });
      if (s3Res.ok) {
        const headers = new Headers();
        headers.set('Content-Type', contentType);
        headers.set('Content-Disposition', `${dispositionType}; filename="${encodedName}"; filename*=UTF-8''${encodedName}`);
        headers.set('Cache-Control', 'private, max-age=3600');
        headers.set('Accept-Ranges', 'bytes');
        if (s3Res.headers.get('content-range')) headers.set('Content-Range', s3Res.headers.get('content-range'));
        if (s3Res.headers.get('content-length')) headers.set('Content-Length', s3Res.headers.get('content-length'));
        return new Response(s3Res.body, { status: s3Res.status, headers });
      } else if (!c.env.FILES) {
        return errorJson('物理存储文件未找到', 404);
      }
    }

    if (!c.env.FILES) {
      return errorJson('R2 存储不可用', 503);
    }

    const rangeHeader = c.req.header('range');
    const object = await c.env.FILES.get(file.storage_key, {
      range: rangeHeader ? c.req.raw.headers : undefined
    });
    if (!object) {
      return errorJson('物理存储文件未找到', 404);
    }

    const headers = new Headers();
    headers.set('Content-Type', contentType);
    headers.set('Content-Disposition', `${dispositionType}; filename="${encodedName}"; filename*=UTF-8''${encodedName}`);
    headers.set('Cache-Control', 'private, max-age=3600');
    headers.set('Accept-Ranges', 'bytes');

    if (object.range) {
      const start = object.range.offset;
      const end = object.range.offset + (object.range.length || 0) - 1;
      headers.set('Content-Range', `bytes ${start}-${end}/${object.size}`);
      headers.set('Content-Length', String(object.range.length));
      return new Response(object.body, { status: 206, headers });
    }

    headers.set('Content-Length', String(object.size));
    return new Response(object.body, { status: 200, headers });
  });

  // 7.5 Save chat attachment to personal drive
  app.post('/api/drive/files/save-from-attachment', async (c) => {
    const session = c.get('session');
    const db = c.env.DB;
    await ensureDriveMemberSharesTable(db);
    const body = await c.req.json().catch(() => ({}));
    const attachmentKey = String(body.attachmentKey || '').trim();
    const name = String(body.name || '转存文件').trim();
    const size = Number(body.size || 0);
    const mimeType = String(body.mimeType || 'application/octet-stream');
    const parentId = body.parentId || null;

    if (!attachmentKey) {
      return errorJson('缺少附件凭据');
    }

    const usage = await getUserStorageUsage(db, session.userId);
    const quota = await getUserStorageQuota(db, session.userId);
    if (usage.usedBytes + size > quota) {
      return errorJson('网盘存储空间不足，无法转存', 403);
    }

    const fileId = crypto.randomUUID();
    await db.prepare(
      `INSERT INTO drive_files (id, user_id, parent_id, name, is_folder, size, mime_type, storage_key, backend, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 0, ?, ?, ?, 'r2', 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
    ).bind(fileId, session.userId, parentId, name, size, mimeType, attachmentKey).run();

    return c.json({ ok: true, file: { id: fileId, name, size } });
  });

  // 7.6 Create a text/markdown file directly in drive (for chat archives or notes)
  app.post('/api/drive/files/create-text-file', async (c) => {
    const session = c.get('session');
    const db = c.env.DB;
    await ensureDriveMemberSharesTable(db);
    const body = await c.req.json().catch(() => ({}));
    const name = String(body.name || '未命名文档.md').trim();
    const content = String(body.content || '');
    const parentId = body.parentId || null;
    const mimeType = String(body.mimeType || 'text/markdown; charset=utf-8');

    const encoder = new TextEncoder();
    const bytes = encoder.encode(content);
    const size = bytes.byteLength;

    const usage = await getUserStorageUsage(db, session.userId);
    const quota = await getUserStorageQuota(db, session.userId);
    if (usage.usedBytes + size > quota) {
      return errorJson('网盘存储空间不足', 403);
    }

    const storage = await getStorageServerSecret(db, c.env);
    if (storage.storageType === 'gdrive' && storage.gdriveClientId && storage.gdriveClientSecret && storage.gdriveRefreshToken) {
      try {
        const gRes = await uploadGoogleDriveTextFile({
          clientId: storage.gdriveClientId,
          clientSecret: storage.gdriveClientSecret,
          refreshToken: storage.gdriveRefreshToken,
          folderId: storage.gdriveFolderId,
          fileName: name,
          content,
          mimeType,
          fetchImpl: fetch
        });
        const fileId = crypto.randomUUID();
        await db.prepare(
          `INSERT INTO drive_files (id, user_id, parent_id, name, is_folder, size, mime_type, storage_key, backend, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, 0, ?, ?, ?, 'gdrive', 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
        ).bind(fileId, session.userId, parentId, name, size, mimeType, gRes.id).run();

        return c.json({ ok: true, file: { id: fileId, name, size } });
      } catch (err) {
        console.error('[drive/create-text-file] Google Drive error:', err);
        return errorJson(`Google Drive 写入文件失败: ${err.message || err}`, 500);
      }
    }

    const s3 = getS3ClientAndUrl(storage, '');
    if (s3 && (storage.storageType === 's3' || !c.env.FILES || storage.accessKeyId)) {
      const storageKey = `drive/${session.userId}/${crypto.randomUUID()}-${name}`;
      const s3Target = getS3ClientAndUrl(storage, storageKey);
      const s3Res = await s3Target.aws.fetch(s3Target.url, {
        method: 'PUT',
        headers: { 'Content-Type': mimeType },
        body: bytes
      });
      if (!s3Res.ok) {
        return errorJson('S3 存储写入失败', 500);
      }
      const fileId = crypto.randomUUID();
      await db.prepare(
        `INSERT INTO drive_files (id, user_id, parent_id, name, is_folder, size, mime_type, storage_key, backend, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, 0, ?, ?, ?, 's3', 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
      ).bind(fileId, session.userId, parentId, name, size, mimeType, storageKey).run();

      return c.json({ ok: true, file: { id: fileId, name, size } });
    }

    if (c.env.FILES) {
      const storageKey = `drive/${session.userId}/${crypto.randomUUID()}-${name}`;
      await c.env.FILES.put(storageKey, bytes, {
        httpMetadata: {
          contentType: mimeType
        }
      });
      const fileId = crypto.randomUUID();
      await db.prepare(
        `INSERT INTO drive_files (id, user_id, parent_id, name, is_folder, size, mime_type, storage_key, backend, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, 0, ?, ?, ?, 'r2', 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
      ).bind(fileId, session.userId, parentId, name, size, mimeType, storageKey).run();

      return c.json({ ok: true, file: { id: fileId, name, size } });
    } else {
      return errorJson('R2 存储未配置', 503);
    }
  });

  // 7.7 Update text/markdown file content directly (for in-place editing)
  app.put('/api/drive/files/:id/content', async (c) => {
    const session = c.get('session');
    const db = c.env.DB;
    await ensureDriveMemberSharesTable(db);
    const fileId = c.req.param('id');
    const body = await c.req.json().catch(() => ({}));
    const content = String(body.content || '');

    const file = await db.prepare(
      `SELECT id, user_id, name, mime_type, storage_key, backend, is_folder FROM drive_files WHERE id = ? AND deleted_at IS NULL LIMIT 1`
    ).bind(fileId).first();

    if (!file || file.is_folder) return errorJson('未找到该文件', 404);

    if (file.user_id !== session.userId) {
      const access = await resolveFileAccess(db, fileId, session.userId);
      if (!access.hasAccess || (access.permission !== 'write' && access.permission !== 'admin')) {
        return errorJson('无权修改该文件', 403);
      }
    }

    if (file.backend === 'gdrive') {
      const storage = await getStorageServerSecret(db, c.env);
      try {
        await updateGoogleDriveFileContent({
          clientId: storage.gdriveClientId,
          clientSecret: storage.gdriveClientSecret,
          refreshToken: storage.gdriveRefreshToken,
          fileId: file.storage_key,
          content,
          mimeType: file.mime_type || 'text/plain; charset=utf-8',
          fetchImpl: fetch
        });
        const encoder = new TextEncoder();
        const size = encoder.encode(content).byteLength;
        await db.prepare(
          `UPDATE drive_files SET size = ?, status = 'active', updated_at = CURRENT_TIMESTAMP WHERE id = ?`
        ).bind(size, fileId).run();
        return c.json({ ok: true, fileId, size });
      } catch (err) {
        console.error('[drive/edit-content] Google Drive update error:', err);
        return errorJson(`Google Drive 保存内容失败: ${err.message || err}`, 500);
      }
    }

    const storage = await getStorageServerSecret(db, c.env).catch(() => ({}));
    const s3 = getS3ClientAndUrl(storage, file.storage_key || '');
    if (file.backend === 's3' || (!c.env.FILES && s3) || (s3 && storage.storageType === 's3')) {
      const encoder = new TextEncoder();
      const bytes = encoder.encode(content);
      const size = bytes.byteLength;
      const storageKey = file.storage_key || `drive/${file.user_id}/${crypto.randomUUID()}-${file.name}`;
      const s3Target = getS3ClientAndUrl(storage, storageKey);
      const s3Res = await s3Target.aws.fetch(s3Target.url, {
        method: 'PUT',
        headers: { 'Content-Type': file.mime_type || 'text/plain; charset=utf-8' },
        body: bytes
      });
      if (!s3Res.ok) {
        return errorJson('S3 存储保存失败', 500);
      }
      await db.prepare(
        `UPDATE drive_files SET size = ?, storage_key = ?, status = 'active', updated_at = CURRENT_TIMESTAMP WHERE id = ?`
      ).bind(size, storageKey, fileId).run();

      return c.json({ ok: true, fileId, size });
    }

    if (!c.env.FILES) return errorJson('R2 存储未配置', 503);

    const encoder = new TextEncoder();
    const bytes = encoder.encode(content);
    const size = bytes.byteLength;

    const storageKey = file.storage_key || `drive/${file.user_id}/${crypto.randomUUID()}-${file.name}`;
    await c.env.FILES.put(storageKey, bytes, {
      httpMetadata: {
        contentType: file.mime_type || 'text/plain; charset=utf-8'
      }
    });

    await db.prepare(
      `UPDATE drive_files SET size = ?, storage_key = ?, status = 'active', updated_at = CURRENT_TIMESTAMP WHERE id = ?`
    ).bind(size, storageKey, fileId).run();

    return c.json({ ok: true, fileId, size });
  });

  // 8. Rename or move file/folder
  app.patch('/api/drive/files/:id', async (c) => {
    const session = c.get('session');
    const db = c.env.DB;
    await ensureDriveMemberSharesTable(db);
    const fileId = c.req.param('id');
    const body = await c.req.json().catch(() => ({}));

    const file = await db.prepare(
      `SELECT id, user_id, parent_id, name, is_folder FROM drive_files WHERE id = ? AND deleted_at IS NULL LIMIT 1`
    ).bind(fileId).first();

    if (!file) return errorJson('未找到该文件或文件夹', 404);

    if (file.user_id !== session.userId) {
      const access = await resolveFileAccess(db, fileId, session.userId);
      if (!access.hasAccess || access.permission !== 'admin') {
        return errorJson('无权修改该文件或文件夹', 403);
      }
    }

    const newName = body.name !== undefined ? String(body.name).trim() : file.name;
    const newParentId = body.parentId !== undefined ? (body.parentId || null) : file.parent_id;

    if (!newName) return errorJson('名称不能为空');

    if (file.is_folder && newParentId === fileId) {
      return errorJson('不能将文件夹移动到自身内部');
    }

    await db.prepare(
      `UPDATE drive_files
       SET name = ?, parent_id = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).bind(newName, newParentId, fileId).run();

    return c.json({ ok: true, file: { id: fileId, name: newName, parent_id: newParentId } });
  });

  // 9. Instant virtual copy
  app.post('/api/drive/files/:id/copy', async (c) => {
    const session = c.get('session');
    const db = c.env.DB;
    await ensureDriveMemberSharesTable(db);
    const fileId = c.req.param('id');
    const body = await c.req.json().catch(() => ({}));

    const file = await db.prepare(
      `SELECT * FROM drive_files WHERE id = ? AND deleted_at IS NULL LIMIT 1`
    ).bind(fileId).first();

    if (!file || file.is_folder) {
      return errorJson('仅支持复制文件', 400);
    }

    if (file.user_id !== session.userId) {
      const access = await resolveFileAccess(db, fileId, session.userId);
      if (!access.hasAccess) return errorJson('无权复制该文件', 403);
    }

    // Check quota
    const usage = await getUserStorageUsage(db, session.userId);
    const quota = await getUserStorageQuota(db, session.userId);
    if (usage.usedBytes + Number(file.size) > quota) {
      return errorJson('存储空间不足以创建副本', 403);
    }

    const newId = crypto.randomUUID();
    const targetParentId = body.targetParentId !== undefined ? (body.targetParentId || null) : null;
    const newName = body.name || `副本 - ${file.name}`;

    await db.prepare(
      `INSERT INTO drive_files (id, user_id, parent_id, name, is_folder, size, mime_type, hash, storage_key, backend, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
    ).bind(newId, session.userId, targetParentId, newName, file.size, file.mime_type, file.hash, file.storage_key, file.backend).run();

    return c.json({ ok: true, file: { id: newId, name: newName, parent_id: targetParentId, size: file.size } });
  });

  // 10. Soft-delete file or folder (Move to Trash)
  app.delete('/api/drive/files/:id', async (c) => {
    const session = c.get('session');
    const db = c.env.DB;
    await ensureDriveMemberSharesTable(db);
    const fileId = c.req.param('id');

    const file = await db.prepare(
      `SELECT id, user_id, is_folder FROM drive_files WHERE id = ? AND deleted_at IS NULL LIMIT 1`
    ).bind(fileId).first();

    if (!file) return errorJson('文件或文件夹未找到', 404);

    if (file.user_id !== session.userId) {
      const access = await resolveFileAccess(db, fileId, session.userId);
      if (!access.hasAccess || access.permission !== 'admin') {
        return errorJson('无权删除该文件或文件夹', 403);
      }
    }

    const ids = await collectDescendantIds(db, file.user_id, fileId);
    for (const id of ids) {
      await db.prepare(
        `UPDATE drive_files SET deleted_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?`
      ).bind(id, file.user_id).run();
    }

    return c.json({ ok: true, deletedCount: ids.length });
  });

  // 10.1 List Trash Items
  app.get('/api/drive/trash', async (c) => {
    const session = c.get('session');
    const db = c.env.DB;
    await ensureDriveMemberSharesTable(db);

    const allUserFilesRes = await db.prepare(
      `SELECT id, parent_id, name, is_folder FROM drive_files WHERE user_id = ?`
    ).bind(session.userId).all();
    const allFilesMap = new Map((allUserFilesRes.results || []).map((f) => [f.id, f]));

    function resolveOriginalPath(parentId) {
      if (!parentId) return '根目录';
      const pathSegments = [];
      let curId = parentId;
      const visited = new Set();
      while (curId && !visited.has(curId)) {
        visited.add(curId);
        const folder = allFilesMap.get(curId);
        if (!folder) break;
        pathSegments.unshift(folder.name);
        curId = folder.parent_id;
      }
      return pathSegments.length > 0 ? pathSegments.join('/') : '根目录';
    }

    const allDeleted = await db.prepare(
      `SELECT f.id, f.parent_id, f.name, f.is_folder, f.size, f.mime_type, f.created_at, f.updated_at, f.deleted_at,
              p.name AS parent_name
       FROM drive_files f
       LEFT JOIN drive_files p ON f.parent_id = p.id
       WHERE f.user_id = ? AND f.deleted_at IS NOT NULL
       ORDER BY f.deleted_at DESC`
    ).bind(session.userId).all();

    const items = (allDeleted.results || []).map((item) => ({
      ...item,
      original_path: resolveOriginalPath(item.parent_id)
    }));
    const deletedIdSet = new Set(items.map(f => f.id));
    
    // Only return top-level deleted roots so the list is clean
    const topLevelTrash = items.filter(f => !f.parent_id || !deletedIdSet.has(f.parent_id));

    return c.json({ trash: topLevelTrash, totalCount: items.length });
  });

  // 10.2 Restore from Trash
  app.post('/api/drive/trash/:id/restore', async (c) => {
    const session = c.get('session');
    const db = c.env.DB;
    await ensureDriveMemberSharesTable(db);
    const fileId = c.req.param('id');

    const target = await db.prepare(
      `SELECT id, parent_id FROM drive_files WHERE id = ? AND user_id = ? AND deleted_at IS NOT NULL LIMIT 1`
    ).bind(fileId, session.userId).first();

    if (!target) return errorJson('未找到该回收站项目', 404);

    let newParentId = target.parent_id;
    if (newParentId) {
      const parent = await db.prepare(
        `SELECT id FROM drive_files WHERE id = ? AND user_id = ? AND deleted_at IS NULL LIMIT 1`
      ).bind(newParentId, session.userId).first();
      if (!parent) {
        newParentId = null;
      }
    }

    const ids = await collectDescendantIds(db, session.userId, fileId);
    await db.prepare(
      `UPDATE drive_files SET deleted_at = NULL, parent_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?`
    ).bind(newParentId, fileId, session.userId).run();

    for (const cid of ids) {
      if (cid !== fileId) {
        await db.prepare(
          `UPDATE drive_files SET deleted_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?`
        ).bind(cid, session.userId).run();
      }
    }

    return c.json({ ok: true, restoredCount: ids.length });
  });

  // 10.3 Permanently Delete single item from Trash
  app.delete('/api/drive/trash/:id', async (c) => {
    const session = c.get('session');
    const db = c.env.DB;
    await ensureDriveMemberSharesTable(db);
    const fileId = c.req.param('id');

    const target = await db.prepare(
      `SELECT id, is_folder FROM drive_files WHERE id = ? AND user_id = ? AND deleted_at IS NOT NULL LIMIT 1`
    ).bind(fileId, session.userId).first();

    if (!target) return errorJson('未找到回收站项目', 404);

    const ids = await collectDescendantIds(db, session.userId, fileId);
    const storage = await getStorageServerSecret(db, c.env).catch(() => ({}));
    for (const id of ids) {
      const row = await db.prepare(
        `SELECT storage_key, backend FROM drive_files WHERE id = ? AND user_id = ?`
      ).bind(id, session.userId).first();

      if (row?.storage_key) {
        const otherRef = await db.prepare(
          `SELECT COUNT(*) AS count FROM drive_files WHERE storage_key = ? AND id != ?`
        ).bind(row.storage_key, id).first();

        if (!otherRef || otherRef.count === 0) {
          if (row.backend === 'gdrive' && storage.gdriveClientId && storage.gdriveClientSecret && storage.gdriveRefreshToken) {
            try {
              await deleteGoogleDriveFile({
                clientId: storage.gdriveClientId,
                clientSecret: storage.gdriveClientSecret,
                refreshToken: storage.gdriveRefreshToken,
                fileId: row.storage_key,
                fetchImpl: fetch
              });
            } catch (e) {
              console.warn('[drive/trash] Google Drive delete warn:', e.message);
            }
          } else if (row.backend === 's3' || (!c.env.FILES && storage.accessKeyId)) {
            try {
              const s3Target = getS3ClientAndUrl(storage, row.storage_key);
              if (s3Target) await s3Target.aws.fetch(s3Target.url, { method: 'DELETE' });
            } catch (e) {
              console.warn('[drive/trash] S3 delete warn:', e.message);
            }
          } else if (c.env.FILES) {
            try {
              await c.env.FILES.delete(row.storage_key);
            } catch (e) {
              console.warn('[drive/trash] R2 delete warn:', e.message);
            }
          }
        }
      }
      await db.prepare(`DELETE FROM drive_files WHERE id = ? AND user_id = ?`).bind(id, session.userId).run();
    }

    return c.json({ ok: true, purgedCount: ids.length });
  });

  // 10.4 Empty All Trash
  app.delete('/api/drive/trash', async (c) => {
    const session = c.get('session');
    const db = c.env.DB;
    await ensureDriveMemberSharesTable(db);
    const storageGlobal = await getStorageServerSecret(db, c.env).catch(() => ({}));

    const res = await db.prepare(
      `SELECT id, storage_key, backend FROM drive_files WHERE user_id = ? AND deleted_at IS NOT NULL`
    ).bind(session.userId).all();
    const items = res.results || [];

    for (const item of items) {
      if (item.storage_key) {
        const otherRef = await db.prepare(
          `SELECT COUNT(*) AS count FROM drive_files WHERE storage_key = ? AND deleted_at IS NULL`
        ).bind(item.storage_key).first();
        if (!otherRef || otherRef.count === 0) {
          if (item.backend === 'gdrive' && storageGlobal.gdriveClientId && storageGlobal.gdriveClientSecret && storageGlobal.gdriveRefreshToken) {
            try {
              await deleteGoogleDriveFile({
                clientId: storageGlobal.gdriveClientId,
                clientSecret: storageGlobal.gdriveClientSecret,
                refreshToken: storageGlobal.gdriveRefreshToken,
                fileId: item.storage_key,
                fetchImpl: fetch
              });
            } catch (e) {
              console.warn('[drive/trash] Google Drive empty purge warn:', e.message);
            }
          } else if (item.backend === 's3' || (!c.env.FILES && storageGlobal.accessKeyId)) {
            try {
              const s3Target = getS3ClientAndUrl(storageGlobal, item.storage_key);
              if (s3Target) await s3Target.aws.fetch(s3Target.url, { method: 'DELETE' });
            } catch (e) {
              console.warn('[drive/trash] S3 empty purge warn:', e.message);
            }
          } else if (c.env.FILES) {
            try {
              await c.env.FILES.delete(item.storage_key);
            } catch (e) {
              console.warn('[drive/trash] R2 empty purge warn:', e.message);
            }
          }
        }
      }
    }

    await db.prepare(
      `DELETE FROM drive_files WHERE user_id = ? AND deleted_at IS NOT NULL`
    ).bind(session.userId).run();

    return c.json({ ok: true, purgedCount: items.length });
  });

  // ==========================================
  // 11. 站内成员/群组协同分享 (Member Shares)
  // ==========================================

  // 11.1 获取可授权的站内成员与群组候选列表
  app.get('/api/drive/member-shares/candidates', async (c) => {
    const session = c.get('session');
    const db = c.env.DB;
    await ensureDriveMemberSharesTable(db);

    const usersRes = await db.prepare(
      `SELECT id, username, display_name, avatar_key
       FROM users
       WHERE id != ? AND is_disabled = 0 AND deleted_at IS NULL
       ORDER BY display_name ASC`
    ).bind(session.userId).all();

    const rawUsers = usersRes.results || [];
    const userIds = rawUsers.map((u) => u.id);
    let groupsMap = {};
    try {
      groupsMap = await getUserGroupsForUsers(db, userIds);
    } catch {
      groupsMap = {};
    }

    const users = rawUsers.map((u) => ({
      id: u.id,
      username: u.username,
      display_name: u.display_name,
      displayName: u.display_name,
      avatar_url: u.avatar_key ? `/files/${encodeURIComponent(u.avatar_key)}` : '',
      avatarUrl: u.avatar_key ? `/files/${encodeURIComponent(u.avatar_key)}` : '',
      groups: groupsMap[u.id] || []
    }));

    const roomsRes = await db.prepare(
      `SELECT c.id, c.name, c.kind FROM channels c
       JOIN channel_members m ON c.id = m.channel_id
       WHERE m.user_id = ? AND c.kind IN ('public', 'private') AND c.deleted_at IS NULL
       ORDER BY c.name ASC`
    ).bind(session.userId).all();

    return c.json({
      users,
      rooms: roomsRes.results || []
    });
  });

  // 11.2 创建或更新站内成员授权 (支持单目标与批量 targets 多选)
  app.post('/api/drive/member-shares', async (c) => {
    const session = c.get('session');
    const db = c.env.DB;
    await ensureDriveMemberSharesTable(db);
    const body = await c.req.json().catch(() => ({}));
    const fileId = String(body.fileId || '');
    const permission = ['read', 'write', 'admin'].includes(body.permission) ? body.permission : 'read';

    // 支持 targets 数组或单对象 targetType + targetId
    let rawTargets = [];
    if (Array.isArray(body.targets) && body.targets.length > 0) {
      rawTargets = body.targets;
    } else if (body.targetId !== undefined && body.targetId !== null) {
      rawTargets = [{ targetType: body.targetType, targetId: body.targetId }];
    }

    // 格式化并去重目标
    const targetMap = new Map();
    for (const t of rawTargets) {
      const targetType = t?.targetType === 'room' ? 'room' : 'user';
      const targetId = Number(t?.targetId);
      if (targetId && !Number.isNaN(targetId) && targetId > 0) {
        targetMap.set(`${targetType}:${targetId}`, { targetType, targetId });
      }
    }

    if (!fileId || targetMap.size === 0) {
      return errorJson('缺少 fileId 或 targetId');
    }

    // Verify file ownership
    const file = await db.prepare(
      `SELECT id, name, is_folder FROM drive_files WHERE id = ? AND user_id = ? AND deleted_at IS NULL LIMIT 1`
    ).bind(fileId, session.userId).first();

    if (!file) {
      return errorJson('未找到该文件或文件夹', 404);
    }

    // 过滤掉分享给当前用户自己的记录
    const targets = [];
    let hasSelf = false;
    for (const target of targetMap.values()) {
      if (target.targetType === 'user' && target.targetId === session.userId) {
        hasSelf = true;
      } else {
        targets.push(target);
      }
    }

    if (targets.length === 0) {
      if (hasSelf) return errorJson('不能分享给自己');
      return errorJson('缺少有效的目标成员或群组');
    }

    // 获取当前文件已有的成员分享授权
    const existingShares = await db.prepare(
      `SELECT id, target_type, target_id FROM drive_member_shares WHERE file_id = ?`
    ).bind(fileId).all();
    const existingMap = new Map((existingShares.results || []).map(r => [`${r.target_type}:${r.target_id}`, r.id]));

    const stmts = [];
    let updatedCount = 0;
    let createdCount = 0;
    let lastShareId = null;

    for (const target of targets) {
      const key = `${target.targetType}:${target.targetId}`;
      const existingId = existingMap.get(key);
      if (existingId) {
        stmts.push(
          db.prepare(
            `UPDATE drive_member_shares SET permission = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
          ).bind(permission, existingId)
        );
        updatedCount++;
        lastShareId = existingId;
      } else {
        const shareId = `ms_${crypto.randomUUID().replace(/-/g, '')}`;
        stmts.push(
          db.prepare(
            `INSERT INTO drive_member_shares (id, file_id, owner_id, target_type, target_id, permission, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
          ).bind(shareId, fileId, session.userId, target.targetType, target.targetId, permission)
        );
        createdCount++;
        lastShareId = shareId;
      }
    }

    if (stmts.length > 0) {
      if (typeof db.batch === 'function') {
        await db.batch(stmts);
      } else {
        for (const s of stmts) {
          await s.run();
        }
      }
    }

    return c.json({
      ok: true,
      shareId: lastShareId,
      count: stmts.length,
      createdCount,
      updatedCount,
      permission,
      updated: updatedCount > 0,
      created: createdCount > 0
    });
  });

  // 11.3 获取某个文件/文件夹的所有站内授权记录
  app.get('/api/drive/member-shares/file/:fileId', async (c) => {
    const session = c.get('session');
    const db = c.env.DB;
    await ensureDriveMemberSharesTable(db);
    const fileId = c.req.param('fileId');

    const file = await db.prepare(
      `SELECT id FROM drive_files WHERE id = ? AND user_id = ? AND deleted_at IS NULL LIMIT 1`
    ).bind(fileId, session.userId).first();

    if (!file) return errorJson('未找到该文件或您不是所有者', 404);

    const res = await db.prepare(
      `SELECT s.id, s.file_id, s.target_type, s.target_id, s.permission, s.created_at,
              CASE WHEN s.target_type = 'user' THEN u.display_name ELSE c.name END AS target_name,
              CASE WHEN s.target_type = 'user' THEN u.username ELSE NULL END AS target_username,
              CASE WHEN s.target_type = 'user' THEN u.avatar_key ELSE NULL END AS target_avatar_key
       FROM drive_member_shares s
       LEFT JOIN users u ON s.target_type = 'user' AND s.target_id = u.id
       LEFT JOIN channels c ON s.target_type = 'room' AND s.target_id = c.id
       WHERE s.file_id = ? AND s.owner_id = ?
       ORDER BY s.created_at DESC`
    ).bind(fileId, session.userId).all();

    const shares = (res.results || []).map(s => ({
      ...s,
      target_avatar_url: s.target_avatar_key ? `/files/${encodeURIComponent(s.target_avatar_key)}` : ''
    }));

    return c.json({ shares });
  });

  // 11.4 查询「与我共享」列表（他人授权给当前用户的文件/文件夹）
  app.get('/api/drive/member-shares/shared-with-me', async (c) => {
    const session = c.get('session');
    const db = c.env.DB;
    await ensureDriveMemberSharesTable(db);

    const userRooms = await db.prepare(
      `SELECT channel_id FROM channel_members WHERE user_id = ?`
    ).bind(session.userId).all();
    const roomIds = (userRooms.results || []).map(r => r.channel_id);

    let query = `
      SELECT s.id AS share_id, s.permission, s.created_at AS shared_at, s.target_type,
             f.id AS file_id, f.name AS file_name, f.is_folder, f.size, f.mime_type, f.updated_at,
             u.id AS owner_id, u.display_name AS owner_name, u.username AS owner_username, u.avatar_key AS owner_avatar_key
      FROM drive_member_shares s
      JOIN drive_files f ON s.file_id = f.id
      JOIN users u ON s.owner_id = u.id
      WHERE f.deleted_at IS NULL AND f.status = 'active'
        AND s.owner_id != ?
        AND ((s.target_type = 'user' AND s.target_id = ?)
    `;
    const params = [session.userId, session.userId];

    if (roomIds.length > 0) {
      query += ` OR (s.target_type = 'room' AND s.target_id IN (${roomIds.map(() => '?').join(',')}))`;
      params.push(...roomIds);
    }
    query += `) ORDER BY s.created_at DESC`;

    const res = await db.prepare(query).bind(...params).all();
    const sharedFiles = (res.results || []).map(row => ({
      ...row,
      owner_avatar_url: row.owner_avatar_key ? `/files/${encodeURIComponent(row.owner_avatar_key)}` : ''
    }));
    return c.json({ sharedFiles });
  });

  // 11.5 撤销站内成员授权
  app.delete('/api/drive/member-shares/:id', async (c) => {
    const session = c.get('session');
    const db = c.env.DB;
    await ensureDriveMemberSharesTable(db);
    const id = c.req.param('id');

    await db.prepare(
      `DELETE FROM drive_member_shares WHERE id = ? AND owner_id = ?`
    ).bind(id, session.userId).run();

    return c.json({ ok: true });
  });

  // ==========================================
  // 12. 公开/加密外链分享 (External URL Shares)
  // ==========================================
  app.post('/api/drive/shares', async (c) => {
    const session = c.get('session');
    const db = c.env.DB;
    const body = await c.req.json().catch(() => ({}));
    const fileId = String(body.fileId || '');
    const permission = ['view', 'upload', 'view_upload'].includes(body.permission) ? body.permission : 'view';
    const expiresDays = Number(body.expiresDays || 0);
    const password = body.password ? String(body.password).trim() : null;

    const file = await db.prepare(
      `SELECT id, name FROM drive_files WHERE id = ? AND user_id = ? AND deleted_at IS NULL LIMIT 1`
    ).bind(fileId, session.userId).first();

    if (!file) return errorJson('未找到该文件', 404);

    const shareToken = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
    let expiresAt = null;
    if (expiresDays > 0) {
      const expDate = new Date(Date.now() + expiresDays * 86400 * 1000);
      expiresAt = expDate.toISOString();
    }

    let passwordHash = null;
    let passwordSalt = null;
    if (password) {
      const hashed = await hashPassword(password);
      passwordHash = hashed.hash;
      passwordSalt = hashed.salt;
    }

    await db.prepare(
      `INSERT INTO drive_shares (id, file_id, user_id, expires_at, password_hash, password_salt, permission, max_file_size, max_total_bytes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
    ).bind(
      shareToken,
      fileId,
      session.userId,
      expiresAt,
      passwordHash,
      passwordSalt,
      permission,
      body.maxFileSize || null,
      body.maxTotalBytes || null
    ).run();

    return c.json({ ok: true, shareToken, permission, expiresAt, hasPassword: Boolean(password) });
  });

  // 12.1 List User External Shares
  app.get('/api/drive/shares', async (c) => {
    const session = c.get('session');
    const db = c.env.DB;

    const res = await db.prepare(
      `SELECT s.id AS share_token, s.file_id, s.permission, s.expires_at, s.created_at,
              CASE WHEN s.password_hash IS NOT NULL THEN 1 ELSE 0 END AS has_password,
              f.name AS file_name, f.is_folder, f.size, f.updated_at
       FROM drive_shares s
       JOIN drive_files f ON s.file_id = f.id
       WHERE s.user_id = ?
       ORDER BY s.created_at DESC`
    ).bind(session.userId).all();

    return c.json({ shares: res.results || [] });
  });

  // 12.2 Revoke external share
  app.delete('/api/drive/shares/:token', async (c) => {
    const session = c.get('session');
    const db = c.env.DB;
    const token = c.req.param('token');

    await db.prepare(
      `DELETE FROM drive_shares WHERE id = ? AND user_id = ?`
    ).bind(token, session.userId).run();

    return c.json({ ok: true });
  });

  // 13. App passwords for WebDAV
  app.get('/api/drive/app-passwords', async (c) => {
    const session = c.get('session');
    const db = c.env.DB;

    const res = await db.prepare(
      `SELECT id, name, last_used_at, created_at FROM drive_app_passwords WHERE user_id = ? ORDER BY created_at DESC`
    ).bind(session.userId).all();

    return c.json({ appPasswords: res.results || [] });
  });

  app.post('/api/drive/app-passwords', async (c) => {
    const session = c.get('session');
    const db = c.env.DB;
    const body = await c.req.json().catch(() => ({}));
    const name = String(body.name || 'WebDAV 客户端').trim();

    const rawPassword = `ec_${crypto.randomUUID().replace(/-/g, '')}`;
    const hashed = await hashPassword(rawPassword);
    const id = crypto.randomUUID();

    await db.prepare(
      `INSERT INTO drive_app_passwords (id, user_id, name, password_hash, password_salt, created_at)
       VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
    ).bind(id, session.userId, name, hashed.hash, hashed.salt).run();

    return c.json({
      ok: true,
      appPassword: {
        id,
        name,
        password: rawPassword
      }
    });
  });

  app.delete('/api/drive/app-passwords/:id', async (c) => {
    const session = c.get('session');
    const db = c.env.DB;
    const id = c.req.param('id');

    await db.prepare(
      `DELETE FROM drive_app_passwords WHERE id = ? AND user_id = ?`
    ).bind(id, session.userId).run();

    return c.json({ ok: true });
  });
}
