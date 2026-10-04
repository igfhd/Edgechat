import { getUserByUsername } from '../data/users.js';
import { verifyPassword } from '../auth.js';
import { getSiteSettings, getStorageServerSecret } from '../data/site-settings.js';
import { getUserStorageQuota, getUserStorageUsage } from './drive.js';
import { isFileTypeAllowed } from './upload.js';
import { clientIp, createFailureTracker, createRateLimiter, rateLimitError } from '../rate-limit.js';
import { getRoutePrefixes } from '../disguise.js';
import { AwsClient } from 'aws4fetch';
import {
  fetchGoogleDriveFile,
  uploadGoogleDriveBinaryFile,
  deleteGoogleDriveFile
} from '../storage/gdrive.js';

const webdavLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 600 });
const webdavAuthTracker = createFailureTracker({ windowMs: 10 * 60 * 1000, max: 30 });
const lastUsedAppPasswordMap = new Map();
const APP_PASSWORD_TOUCH_THROTTLE_MS = 10 * 60 * 1000;

function escapeXml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function formatDateRFC1123(dateStr) {
  const d = dateStr ? new Date(dateStr) : new Date();
  return Number.isNaN(d.getTime()) ? new Date().toUTCString() : d.toUTCString();
}

function safeDecodeURIComponent(str) {
  try {
    return decodeURIComponent(str);
  } catch {
    return str;
  }
}

function parseDestinationPath(destHeader, env) {
  if (!destHeader) return null;
  let pathname = '';
  try {
    if (destHeader.startsWith('http://') || destHeader.startsWith('https://')) {
      pathname = new URL(destHeader).pathname;
    } else {
      pathname = destHeader;
    }
  } catch {
    pathname = destHeader;
  }

  // 剥离可能存在的伪装前缀 (ROUTE_PREFIX)
  const prefixes = getRoutePrefixes(env);
  for (const p of prefixes) {
    const encodedP = encodeURIComponent(p);
    if (pathname.startsWith(`/${p}/`) || pathname.startsWith(`/${encodedP}/`)) {
      pathname = pathname.startsWith(`/${p}/`) ? pathname.slice(p.length + 1) : pathname.slice(encodedP.length + 1);
      break;
    } else if (pathname === `/${p}` || pathname === `/${encodedP}`) {
      pathname = '';
      break;
    }
  }

  // 剥离 /dav 前缀
  if (pathname.startsWith('/dav/')) {
    return pathname.slice(4);
  }
  if (pathname === '/dav') {
    return '/';
  }
  return pathname.startsWith('/') ? pathname : `/${pathname}`;
}

async function authenticateWebDavUser(env, req) {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Basic ')) {
    return null;
  }

  try {
    const base64 = authHeader.slice(6).trim();
    const decoded = atob(base64);
    const colonIdx = decoded.indexOf(':');
    if (colonIdx === -1) return null;

    const username = decoded.slice(0, colonIdx);
    const password = decoded.slice(colonIdx + 1);

    // 1. First try matching user by username
    const user = await getUserByUsername(env.DB, username);
    if (!user || Number(user.is_disabled)) return null;

    // 2. Check if password is an app password
    const appPw = await env.DB.prepare(
      `SELECT id, password_hash, password_salt FROM drive_app_passwords WHERE user_id = ? LIMIT 10`
    ).bind(user.id).all();

    // App passwords only — the main account password is intentionally not
    // accepted here so that a compromised WebDAV credential does not expose
    // the account password or allow session-initiated actions.
    for (const ap of appPw.results || []) {
      const ok = await verifyPassword(password, ap.password_hash, ap.password_salt);
      if (ok) {
        // Update last used time (throttled to at most once every 10 minutes)
        const now = Date.now();
        const lastTouch = lastUsedAppPasswordMap.get(ap.id) || 0;
        if (now - lastTouch > APP_PASSWORD_TOUCH_THROTTLE_MS) {
          lastUsedAppPasswordMap.set(ap.id, now);
          env.DB.prepare(`UPDATE drive_app_passwords SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(ap.id).run().catch(() => {});
        }
        return user;
      }
    }
    return null;
  } catch {
    return null;
  }
}

async function resolvePath(db, userId, pathStr) {
  const segments = pathStr.split('/').filter(Boolean);
  let currentParentId = null;
  let currentItem = null;

  if (segments.length === 0) {
    return { item: null, isRoot: true, parentId: null };
  }

  for (let i = 0; i < segments.length; i++) {
    const segName = safeDecodeURIComponent(segments[i]);
    const isLast = i === segments.length - 1;

    const item = await db.prepare(
      `SELECT id, parent_id, name, is_folder, size, mime_type, storage_key, updated_at, created_at
       FROM drive_files
       WHERE user_id = ? AND ${currentParentId ? 'parent_id = ?' : 'parent_id IS NULL'} AND name = ? AND deleted_at IS NULL AND status = 'active'
       LIMIT 1`
    ).bind(...(currentParentId ? [userId, currentParentId, segName] : [userId, segName])).first();

    if (!item) {
      if (isLast) {
        return { item: null, isRoot: false, parentId: currentParentId, targetName: segName, notFound: true };
      }
      return null; // Parent folder not found
    }

    currentItem = item;
    currentParentId = item.id;
  }

  return { item: currentItem, isRoot: false, parentId: currentItem.parent_id, targetName: currentItem.name };
}

export function registerWebDavRoutes(app) {
  const handleWebDav = async (c) => {
    const ip = clientIp(c);
    const limited = webdavLimiter.check(ip);
    if (!limited.allowed) {
      return rateLimitError(limited.retryAfterMs);
    }

    const user = await authenticateWebDavUser(c.env, c.req.raw);
    if (!user) {
      const tracked = webdavAuthTracker.record(ip);
      if (!tracked.allowed) {
        return rateLimitError(tracked.retryAfterMs);
      }
      return new Response('Unauthorized', {
        status: 401,
        headers: {
          'WWW-Authenticate': 'Basic realm="Edgechat Cloud Drive WebDAV"',
          'Content-Type': 'text/plain; charset=utf-8'
        }
      });
    }

    const method = c.req.method.toUpperCase();
    const url = new URL(c.req.url);
    const rawPath = url.pathname.replace(/^\/dav/, '') || '/';
    const db = c.env.DB;
    const storage = db ? await getStorageServerSecret(db, c.env).catch(() => ({})) : {};
    const hasGdrive = storage.storageType === 'gdrive' && storage.gdriveClientId && storage.gdriveClientSecret && storage.gdriveRefreshToken;
    const hasS3 = storage.accessKeyId && storage.secretAccessKey && (storage.endpoint || storage.accountId);
    const hasNativeR2 = Boolean(c.env.FILES);

    // OPTIONS
    if (method === 'OPTIONS') {
      return new Response(null, {
        status: 200,
        headers: {
          'DAV': '1, 2',
          'Allow': 'OPTIONS, GET, HEAD, POST, PUT, DELETE, PROPFIND, PROPPATCH, MKCOL, MOVE, COPY, LOCK, UNLOCK',
          'MS-Author-Via': 'DAV'
        }
      });
    }

    // LOCK (兼容 Windows Explorer / macOS Finder / Office)
    if (method === 'LOCK') {
      const lockToken = `urn:uuid:${crypto.randomUUID()}`;
      const xml = `<?xml version="1.0" encoding="utf-8" ?>
<D:prop xmlns:D="DAV:">
  <D:lockdiscovery>
    <D:activelock>
      <D:locktype><D:write/></D:locktype>
      <D:lockscope><D:exclusive/></D:lockscope>
      <D:depth>Infinity</D:depth>
      <D:owner><D:href>${escapeXml(user.username)}</D:href></D:owner>
      <D:timeout>Second-3600</D:timeout>
      <D:locktoken><D:href>${lockToken}</D:href></D:locktoken>
      <D:lockroot><D:href>${escapeXml(url.pathname)}</D:href></D:lockroot>
    </D:activelock>
  </D:lockdiscovery>
</D:prop>`;
      return new Response(xml, {
        status: 200,
        headers: {
          'Content-Type': 'application/xml; charset=utf-8',
          'Lock-Token': `<${lockToken}>`
        }
      });
    }

    // UNLOCK
    if (method === 'UNLOCK') {
      return new Response(null, { status: 204 });
    }

    // PROPPATCH
    if (method === 'PROPPATCH') {
      const xml = `<?xml version="1.0" encoding="utf-8" ?>
<D:multistatus xmlns:D="DAV:">
  <D:response>
    <D:href>${escapeXml(url.pathname)}</D:href>
    <D:propstat>
      <D:prop/>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
</D:multistatus>`;
      return new Response(xml, {
        status: 207,
        headers: { 'Content-Type': 'application/xml; charset=utf-8' }
      });
    }

    // PROPFIND
    if (method === 'PROPFIND') {
      const depth = (c.req.header('Depth') || '1').trim().toLowerCase();

      // RFC 4918 §9.1: servers MAY reject Depth:infinity to prevent unbounded traversal
      if (depth === 'infinity') {
        return new Response(
          '<?xml version="1.0" encoding="utf-8" ?><D:error xmlns:D="DAV:"><D:propfind-finite-depth/></D:error>',
          { status: 403, headers: { 'Content-Type': 'application/xml; charset=utf-8' } }
        );
      }

      const resolved = await resolvePath(db, user.id, rawPath);
      if (!resolved) {
        return new Response('Not Found', { status: 404 });
      }

      const matchedPrefix = c.req.header('X-Matched-Prefix') || (getRoutePrefixes(c.env)[0] || '');
      const cleanPrefix = matchedPrefix ? `/${matchedPrefix}` : '';
      const baseDav = `${cleanPrefix}/dav`;

      const items = [];
      const prefixPath = `${baseDav}${rawPath.endsWith('/') ? rawPath.slice(0, -1) : rawPath}`;
      const usage = await getUserStorageUsage(db, user.id);
      const quota = await getUserStorageQuota(db, user.id);
      const availableBytes = Math.max(0, quota - usage.usedBytes);

      if (resolved.isRoot) {
        // Root collection
        items.push({
          href: `${baseDav}/`,
          isFolder: true,
          name: 'root',
          size: 0,
          updatedAt: new Date().toISOString(),
          mimeType: 'httpd/unix-directory',
          isRoot: true
        });

        if (depth !== '0') {
          const children = await db.prepare(
            `SELECT id, name, is_folder, size, mime_type, hash, updated_at FROM drive_files WHERE user_id = ? AND parent_id IS NULL AND deleted_at IS NULL AND status = 'active'`
          ).bind(user.id).all();

          for (const ch of children.results || []) {
            items.push({
              href: `${baseDav}/${encodeURIComponent(ch.name)}${ch.is_folder ? '/' : ''}`,
              isFolder: Boolean(ch.is_folder),
              name: ch.name,
              size: Number(ch.size || 0),
              updatedAt: ch.updated_at,
              mimeType: ch.mime_type,
              etag: ch.hash || `${ch.id}-${new Date(ch.updated_at || Date.now()).getTime()}`
            });
          }
        }
      } else if (resolved.item) {
        const it = resolved.item;
        items.push({
          href: `${prefixPath}${it.is_folder ? '/' : ''}`,
          isFolder: Boolean(it.is_folder),
          name: it.name,
          size: Number(it.size || 0),
          updatedAt: it.updated_at,
          mimeType: it.mime_type,
          etag: it.hash || `${it.id}-${new Date(it.updated_at || Date.now()).getTime()}`
        });

        if (it.is_folder && depth !== '0') {
          const children = await db.prepare(
            `SELECT id, name, is_folder, size, mime_type, hash, updated_at FROM drive_files WHERE user_id = ? AND parent_id = ? AND deleted_at IS NULL AND status = 'active'`
          ).bind(user.id, it.id).all();

          for (const ch of children.results || []) {
            items.push({
              href: `${prefixPath}/${encodeURIComponent(ch.name)}${ch.is_folder ? '/' : ''}`,
              isFolder: Boolean(ch.is_folder),
              name: ch.name,
              size: Number(ch.size || 0),
              updatedAt: ch.updated_at,
              mimeType: ch.mime_type,
              etag: ch.hash || `${ch.id}-${new Date(ch.updated_at || Date.now()).getTime()}`
            });
          }
        }
      } else {
        return new Response('Not Found', { status: 404 });
      }

      let xml = `<?xml version="1.0" encoding="utf-8" ?>\n<D:multistatus xmlns:D="DAV:">\n`;
      for (const item of items) {
        xml += `  <D:response>\n`;
        xml += `    <D:href>${escapeXml(item.href)}</D:href>\n`;
        xml += `    <D:propstat>\n`;
        xml += `      <D:prop>\n`;
        xml += `        <D:displayname>${escapeXml(item.name)}</D:displayname>\n`;
        if (item.isFolder) {
          xml += `        <D:resourcetype><D:collection/></D:resourcetype>\n`;
        } else {
          xml += `        <D:resourcetype/>\n`;
          xml += `        <D:getcontentlength>${item.size}</D:getcontentlength>\n`;
          xml += `        <D:getcontenttype>${escapeXml(item.mimeType || 'application/octet-stream')}</D:getcontenttype>\n`;
          if (item.etag) {
            xml += `        <D:getetag>"${escapeXml(item.etag)}"</D:getetag>\n`;
          }
        }
        xml += `        <D:getlastmodified>${formatDateRFC1123(item.updatedAt)}</D:getlastmodified>\n`;
        if (item.isRoot) {
          xml += `        <D:quota-available-bytes>${availableBytes}</D:quota-available-bytes>\n`;
          xml += `        <D:quota-used-bytes>${usage.usedBytes}</D:quota-used-bytes>\n`;
        }
        xml += `      </D:prop>\n`;
        xml += `      <D:status>HTTP/1.1 200 OK</D:status>\n`;
        xml += `    </D:propstat>\n`;
        xml += `  </D:response>\n`;
      }
      xml += `</D:multistatus>`;

      return new Response(xml, {
        status: 207,
        headers: {
          'Content-Type': 'application/xml; charset=utf-8'
        }
      });
    }

    // GET / HEAD
    if (method === 'GET' || method === 'HEAD') {
      const resolved = await resolvePath(db, user.id, rawPath);
      if (!resolved?.item || resolved.item.is_folder || !resolved.item.storage_key) {
        return new Response('Not Found', { status: 404 });
      }

      const storageKey = resolved.item.storage_key;
      let bodyStream = null;
      let contentLength = String(resolved.item.size || 0);

      if (resolved.item.backend === 'gdrive' || storage.storageType === 'gdrive') {
        if (!storage.gdriveClientId || !storage.gdriveClientSecret || !storage.gdriveRefreshToken) {
          return new Response('Google Drive 凭据未配置', { status: 503 });
        }
        const gdriveRes = await fetchGoogleDriveFile({
          clientId: storage.gdriveClientId,
          clientSecret: storage.gdriveClientSecret,
          refreshToken: storage.gdriveRefreshToken,
          fileId: storageKey
        });
        if (!gdriveRes.ok) {
          return new Response('Storage file not found on Google Drive', { status: 404 });
        }
        bodyStream = gdriveRes.body;
      } else if (hasNativeR2) {
        const obj = await c.env.FILES.get(storageKey);
        if (!obj) {
          return new Response('Storage file not found', { status: 404 });
        }
        contentLength = String(obj.size);
        bodyStream = obj.body;
      } else if (hasS3) {
        const aws = new AwsClient({
          accessKeyId: storage.accessKeyId,
          secretAccessKey: storage.secretAccessKey,
          region: storage.region || 'auto',
          service: 's3'
        });
        const s3Url = storage.endpoint
          ? new URL(`${storage.endpoint.replace(/\/+$/, '')}/${storage.bucketName || 'edgechat-files'}/${storageKey}`)
          : new URL(`https://${storage.accountId}.r2.cloudflarestorage.com/${storage.bucketName || 'edgechat-files'}/${storageKey}`);
        const s3Res = await aws.fetch(s3Url, { method: 'GET' });
        if (!s3Res.ok) {
          return new Response('Storage file not found on S3', { status: 404 });
        }
        bodyStream = s3Res.body;
      } else {
        return new Response('Storage unavailable', { status: 503 });
      }

      const headers = new Headers({
        'Content-Type': resolved.item.mime_type || 'application/octet-stream',
        'Content-Length': contentLength,
        'Last-Modified': formatDateRFC1123(resolved.item.updated_at),
        'Accept-Ranges': 'bytes'
      });

      if (method === 'HEAD') {
        return new Response(null, { status: 200, headers });
      }
      return new Response(bodyStream, { status: 200, headers });
    }

    // MKCOL (Create folder)
    if (method === 'MKCOL') {
      const resolved = await resolvePath(db, user.id, rawPath);
      if (!resolved) {
        // Parent path doesn't exist — RFC 4918 §9.3.1 requires 409 Conflict
        return new Response('Conflict: parent collection not found', { status: 409 });
      }
      if (!resolved.notFound || !resolved.targetName) {
        // Target already exists — 405 Method Not Allowed
        return new Response('Method Not Allowed: resource already exists', { status: 405 });
      }

      const folderId = crypto.randomUUID();
      await db.prepare(
        `INSERT INTO drive_files (id, user_id, parent_id, name, is_folder, size, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, 0, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
      ).bind(folderId, user.id, resolved.parentId, resolved.targetName).run();

      return new Response(null, { status: 201 });
    }

    // MOVE (Rename / Move file or folder)
    if (method === 'MOVE') {
      const resolvedSource = await resolvePath(db, user.id, rawPath);
      if (!resolvedSource?.item) {
        return new Response('Source Not Found', { status: 404 });
      }

      const destRawPath = parseDestinationPath(c.req.header('Destination'), c.env);
      if (!destRawPath) {
        return new Response('Bad Destination Header', { status: 400 });
      }

      const resolvedDest = await resolvePath(db, user.id, destRawPath);
      if (!resolvedDest) {
        return new Response('Destination Parent Folder Conflict', { status: 409 });
      }

      const overwriteHeader = (c.req.header('Overwrite') || 'T').trim().toUpperCase();
      let isOverwrite = false;

      if (resolvedDest.item) {
        if (overwriteHeader === 'F') {
          return new Response('Destination Already Exists', { status: 412 });
        }
        // Delete existing destination before move
        await db.prepare(`DELETE FROM drive_files WHERE id = ? AND user_id = ?`).bind(resolvedDest.item.id, user.id).run();
        isOverwrite = true;
      }

      const targetName = resolvedDest.targetName || resolvedDest.item?.name || resolvedSource.item.name;
      const targetParentId = resolvedDest.parentId || null;

      await db.prepare(
        `UPDATE drive_files
         SET parent_id = ?, name = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND user_id = ?`
      ).bind(targetParentId, targetName, resolvedSource.item.id, user.id).run();

      return new Response(null, { status: isOverwrite ? 204 : 201 });
    }

    // COPY (Duplicate file)
    if (method === 'COPY') {
      const resolvedSource = await resolvePath(db, user.id, rawPath);
      if (!resolvedSource?.item) {
        return new Response('Source Not Found', { status: 404 });
      }

      const destRawPath = parseDestinationPath(c.req.header('Destination'), c.env);
      if (!destRawPath) {
        return new Response('Bad Destination Header', { status: 400 });
      }

      const resolvedDest = await resolvePath(db, user.id, destRawPath);
      if (!resolvedDest) {
        return new Response('Destination Parent Folder Conflict', { status: 409 });
      }

      const overwriteHeader = (c.req.header('Overwrite') || 'T').trim().toUpperCase();
      let isOverwrite = false;

      if (resolvedDest.item) {
        if (overwriteHeader === 'F') {
          return new Response('Destination Already Exists', { status: 412 });
        }
        await db.prepare(`DELETE FROM drive_files WHERE id = ? AND user_id = ?`).bind(resolvedDest.item.id, user.id).run();
        isOverwrite = true;
      }

      const targetName = resolvedDest.targetName || resolvedDest.item?.name || resolvedSource.item.name;
      const targetParentId = resolvedDest.parentId || null;
      const newFileId = crypto.randomUUID();
      const source = resolvedSource.item;

      await db.prepare(
        `INSERT INTO drive_files (id, user_id, parent_id, name, is_folder, size, mime_type, hash, storage_key, backend, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
      ).bind(newFileId, user.id, targetParentId, targetName, source.is_folder || 0, source.size || 0, source.mime_type || null, source.hash || null, source.storage_key || null, source.backend || 'r2').run();

      return new Response(null, { status: isOverwrite ? 204 : 201 });
    }

    // PUT (Upload file)
    if (method === 'PUT') {
      const resolved = await resolvePath(db, user.id, rawPath);
      if (!resolved || (!resolved.notFound && resolved.item?.is_folder)) {
        return new Response('Cannot overwrite a folder', { status: 409 });
      }

      if (!hasNativeR2 && !hasGdrive && !hasS3) {
        return new Response('Storage unavailable', { status: 503 });
      }

      const siteSettings = await getSiteSettings(db, c.env);
      const maxMb = Number(siteSettings.uploadMaxFileSizeMb) || (c.env.MAX_FILE_SIZE ? Math.round(Number(c.env.MAX_FILE_SIZE) / 1024 / 1024) : 20);
      const maxFileSize = maxMb * 1024 * 1024;

      const contentLength = Number(c.req.header('content-length') || 0);
      if (contentLength > maxFileSize) {
        return new Response(`File too large (max ${maxMb}MB)`, { status: 413 });
      }

      const usage = await getUserStorageUsage(db, user.id);
      const quota = await getUserStorageQuota(db, user.id);
      const previousSize = resolved.item ? Number(resolved.item.size || 0) : 0;
      if (usage.usedBytes - previousSize + contentLength > quota) {
        return new Response('Storage quota exceeded', { status: 507 });
      }

      const targetName = resolved.targetName || resolved.item?.name;
      const fileId = resolved.item?.id || crypto.randomUUID();
      const storageKey = resolved.item?.storage_key || `drive/${user.id}/${fileId}-${encodeURIComponent(targetName)}`;
      const contentType = c.req.header('Content-Type') || 'application/octet-stream';

      const allowed = siteSettings.uploadAllowedTypes !== undefined ? siteSettings.uploadAllowedTypes : (c.env.ALLOWED_FILE_TYPES || '');
      const blocked = siteSettings.uploadBlockedTypes !== undefined ? siteSettings.uploadBlockedTypes : '';
      const mode = siteSettings.uploadRestrictionMode || (c.env.ALLOWED_FILE_TYPES ? 'allowlist' : 'none');

      const typeCheck = isFileTypeAllowed({
        filename: targetName,
        mimeType: contentType,
        restrictionMode: mode,
        allowedTypes: allowed,
        blockedTypes: blocked
      });

      if (!typeCheck.allowed) {
        return new Response(typeCheck.reason || 'Forbidden file type', { status: 403 });
      }

      let actualSize = contentLength;
      let backend = 'r2';
      let finalStorageKey = storageKey;

      if (hasGdrive) {
        const payloadBuffer = await c.req.arrayBuffer();
        actualSize = payloadBuffer.byteLength;
        const gdriveFile = await uploadGoogleDriveBinaryFile({
          clientId: storage.gdriveClientId,
          clientSecret: storage.gdriveClientSecret,
          refreshToken: storage.gdriveRefreshToken,
          folderId: storage.gdriveFolderId,
          fileName: targetName,
          bytes: payloadBuffer,
          mimeType: contentType
        });
        backend = 'gdrive';
        finalStorageKey = gdriveFile.id;
      } else if (hasNativeR2) {
        const body = c.req.raw.body;
        await c.env.FILES.put(storageKey, body, {
          httpMetadata: { contentType }
        });
        const head = await c.env.FILES.head(storageKey);
        actualSize = head?.size || 0;
        backend = 'r2';
        finalStorageKey = storageKey;
      } else if (hasS3) {
        const payloadBuffer = await c.req.arrayBuffer();
        actualSize = payloadBuffer.byteLength;
        const aws = new AwsClient({
          accessKeyId: storage.accessKeyId,
          secretAccessKey: storage.secretAccessKey,
          region: storage.region || 'auto',
          service: 's3'
        });
        const s3Url = storage.endpoint
          ? new URL(`${storage.endpoint.replace(/\/+$/, '')}/${storage.bucketName || 'edgechat-files'}/${storageKey}`)
          : new URL(`https://${storage.accountId}.r2.cloudflarestorage.com/${storage.bucketName || 'edgechat-files'}/${storageKey}`);
        const s3Res = await aws.fetch(s3Url, {
          method: 'PUT',
          headers: { 'Content-Type': contentType },
          body: payloadBuffer
        });
        if (!s3Res.ok) {
          return new Response('S3 upload error', { status: 500 });
        }
        backend = 's3';
        finalStorageKey = storageKey;
      }

      if (actualSize > maxFileSize) {
        return new Response(`File too large (max ${maxMb}MB)`, { status: 413 });
      }
      if (usage.usedBytes - previousSize + actualSize > quota) {
        return new Response('Storage quota exceeded', { status: 507 });
      }

      if (resolved.item) {
        // Update existing
        await db.prepare(
          `UPDATE drive_files SET size = ?, mime_type = ?, storage_key = ?, backend = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?`
        ).bind(actualSize, contentType, finalStorageKey, backend, resolved.item.id, user.id).run();
        return new Response(null, { status: 204 });
      } else {
        // Insert new
        await db.prepare(
          `INSERT INTO drive_files (id, user_id, parent_id, name, is_folder, size, mime_type, storage_key, backend, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
        ).bind(fileId, user.id, resolved.parentId || null, targetName, actualSize, contentType, finalStorageKey, backend).run();
        return new Response(null, { status: 201 });
      }
    }

    // DELETE
    if (method === 'DELETE') {
      const resolved = await resolvePath(db, user.id, rawPath);
      if (!resolved?.item) {
        return new Response('Not Found', { status: 404 });
      }

      if (resolved.item.is_folder) {
        // Recursively soft-delete the folder and ALL descendants using WITH RECURSIVE CTE
        // (D1/SQLite supports recursive CTEs since SQLite 3.35)
        await db.prepare(
          `WITH RECURSIVE descendants(id) AS (
             SELECT id FROM drive_files WHERE id = ? AND user_id = ?
             UNION ALL
             SELECT f.id FROM drive_files f
             INNER JOIN descendants d ON f.parent_id = d.id
             WHERE f.user_id = ? AND f.deleted_at IS NULL
           )
           UPDATE drive_files SET deleted_at = CURRENT_TIMESTAMP
           WHERE id IN (SELECT id FROM descendants) AND user_id = ?`
        ).bind(resolved.item.id, user.id, user.id, user.id).run();
      } else {
        const storageKey = resolved.item.storage_key;
        await db.prepare(`DELETE FROM drive_files WHERE id = ? AND user_id = ?`).bind(resolved.item.id, user.id).run();
        if (storageKey) {
          const count = await db.prepare(`SELECT COUNT(*) AS c FROM drive_files WHERE storage_key = ? AND deleted_at IS NULL`).bind(storageKey).first();
          if (Number(count?.c || 0) === 0) {
            if (resolved.item.backend === 'gdrive' && storage.gdriveClientId && storage.gdriveClientSecret && storage.gdriveRefreshToken) {
              deleteGoogleDriveFile({
                clientId: storage.gdriveClientId,
                clientSecret: storage.gdriveClientSecret,
                refreshToken: storage.gdriveRefreshToken,
                fileId: storageKey
              }).catch(() => {});
            } else if (hasNativeR2) {
              c.executionCtx?.waitUntil?.(c.env.FILES.delete(storageKey)) || await c.env.FILES.delete(storageKey).catch(() => {});
            }
          }
        }
      }
      return new Response(null, { status: 204 });
    }

    return new Response('Method Not Allowed', { status: 405 });
  };

  app.all('/dav', handleWebDav);
  app.all('/dav/*', handleWebDav);
}
