import { AwsClient } from 'aws4fetch';
import { getSiteSettings, getStorageServerSecret } from '../data/site-settings.js';
import { canAccessFile, getUploadedFileMetadata, recordUploadedFile } from '../data/uploaded-files.js';
import { decryptAttachment, encryptAttachment } from '../encryption.js';
import { normalizeContentType, sanitizeFilename } from '../attachment-metadata.js';
import { validateSession } from '../session.js';
import { resolveUrlTicket, createFileScope } from '../tickets.js';
import { errorResponse, requestBodyTooLarge } from '../utils.js';
import {
  fetchGoogleDriveFile,
  uploadGoogleDriveBinaryFile,
  getGoogleDriveFileName,
  deleteGoogleDriveFile
} from '../storage/gdrive.js';

const FILE_RESPONSE_CACHE_CONTROL = 'private, no-store';
const UPLOAD_BODY_OVERHEAD_BYTES = 1024 * 1024;

function isInlineContentType(contentType) {
  if (!contentType) {
    return false;
  }
  if (contentType === 'application/pdf') {
    return true;
  }
  if (contentType.startsWith('image/')) {
    return contentType !== 'image/svg+xml';
  }
  if (contentType.startsWith('audio/')) {
    return true;
  }
  if (contentType.startsWith('video/')) {
    return true;
  }
  return false;
}

function contentDispositionValue(kind, filename) {
  const safeUtf8 = sanitizeFilename(filename);
  const safeAscii = safeUtf8
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/"/g, '')
    .trim()
    .slice(0, 150) || 'file';
  return `${kind}; filename="${safeAscii}"; filename*=UTF-8''${encodeURIComponent(safeUtf8)}`;
}

export function isFileTypeAllowed({
  filename = '',
  mimeType = '',
  restrictionMode = 'none',
  allowedTypes = '',
  blockedTypes = ''
}) {
  const normMime = normalizeContentType(mimeType);
  const cleanName = sanitizeFilename(filename);
  const dotIndex = cleanName.lastIndexOf('.');
  const ext = dotIndex >= 0 ? cleanName.slice(dotIndex + 1).toLowerCase() : '';

  const parseList = (str) =>
    String(str || '')
      .split(/[\s,;\n]+/)
      .map((item) => item.trim().toLowerCase().replace(/^[*.]+/, ''))
      .filter(Boolean);

  const matchRule = (rule) => {
    if (rule.endsWith('/*')) {
      const prefix = rule.slice(0, -2);
      return normMime.startsWith(`${prefix}/`);
    }
    if (rule.includes('/')) {
      return normMime === rule;
    }
    return ext === rule;
  };

  if (restrictionMode === 'allowlist') {
    const rules = parseList(allowedTypes);
    if (!rules.length) {
      return { allowed: true };
    }
    const matched = rules.some(matchRule);
    if (!matched) {
      const display = ext ? `.${ext}` : (normMime || '未知格式');
      return {
        allowed: false,
        reason: `该文件类型 (${display}) 不在管理员允许上传的白名单中`
      };
    }
    return { allowed: true };
  }

  if (restrictionMode === 'blocklist') {
    const rules = parseList(blockedTypes);
    if (rules.some(matchRule)) {
      const display = ext ? `.${ext}` : (normMime || '未知格式');
      return {
        allowed: false,
        reason: `该文件类型 (${display}) 已被管理员设置为禁止上传`
      };
    }
    return { allowed: true };
  }

  // mode === 'none'
  const rules = parseList(blockedTypes);
  if (rules.length && rules.some(matchRule)) {
    const display = ext ? `.${ext}` : (normMime || '未知格式');
    return {
      allowed: false,
      reason: `该文件类型 (${display}) 已被管理员设置为禁止上传`
    };
  }

  return { allowed: true };
}

export function validateUpload(file, siteSettings = {}, env = {}) {
  const maxMb = Number(siteSettings.uploadMaxFileSizeMb) || (env.MAX_FILE_SIZE ? Math.round(Number(env.MAX_FILE_SIZE) / 1024 / 1024) : 20);
  const maxFileSize = maxMb * 1024 * 1024;
  if (file.size > maxFileSize) {
    throw new Error(`文件大小不能超过 ${maxMb}MB`);
  }

  const allowed = siteSettings.uploadAllowedTypes !== undefined ? siteSettings.uploadAllowedTypes : (env.ALLOWED_FILE_TYPES || '');
  const blocked = siteSettings.uploadBlockedTypes !== undefined ? siteSettings.uploadBlockedTypes : '';
  const mode = siteSettings.uploadRestrictionMode || (env.ALLOWED_FILE_TYPES ? 'allowlist' : 'none');

  const check = isFileTypeAllowed({
    filename: file.name,
    mimeType: file.type,
    restrictionMode: mode,
    allowedTypes: allowed,
    blockedTypes: blocked
  });

  if (!check.allowed) {
    throw new Error(check.reason || '该文件类型不允许上传');
  }
}

export function registerUploadRoutes(app) {
  app.post('/api/upload', async (c) => {
    const db = c.env.DB;
    const storage = db ? await getStorageServerSecret(db, c.env).catch(() => ({})) : {};
    const hasGdrive = storage.storageType === 'gdrive' && storage.gdriveClientId && storage.gdriveClientSecret && storage.gdriveRefreshToken;
    const hasS3 = storage.accessKeyId && storage.secretAccessKey && (storage.endpoint || storage.accountId);
    const hasNativeR2 = Boolean(c.env.FILES);

    if (!hasNativeR2 && !hasGdrive && !hasS3) {
      return errorResponse('当前部署没有绑定 R2，无法上传附件', 503);
    }

    const session = c.get('session');
    let siteSettings = {};
    if (db) {
      try {
        siteSettings = await getSiteSettings(db);
      } catch {
        siteSettings = {};
      }
    }

    const maxMb = Number(siteSettings.uploadMaxFileSizeMb) || (c.env.MAX_FILE_SIZE ? Math.round(Number(c.env.MAX_FILE_SIZE) / 1024 / 1024) : 20);
    const maxFileSize = maxMb * 1024 * 1024;
    if (requestBodyTooLarge(c.req.raw, maxFileSize + UPLOAD_BODY_OVERHEAD_BYTES)) {
      return errorResponse(`文件大小不能超过 ${maxMb}MB`, 413);
    }
    const formData = await c.req.formData();
    const file = formData.get('file');
    if (!(file instanceof File)) {
      return errorResponse('请选择文件');
    }

    try {
      validateUpload(file, siteSettings, c.env);
    } catch (error) {
      return errorResponse(error.message);
    }

    const isClientE2ee = formData.get('isE2ee') === '1' || c.req.header('x-e2ee-upload') === '1';
    const extension = file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.')) : '';
    const rawKey = `${session.userId}/${Date.now()}-${crypto.randomUUID()}${extension}`;
    const payloadBytes = await file.arrayBuffer();
    const storedBytes = isClientE2ee
      ? payloadBytes
      : await encryptAttachment(c.env, payloadBytes, rawKey);

    let finalKey = rawKey;

    if (hasGdrive) {
      const gdriveFile = await uploadGoogleDriveBinaryFile({
        clientId: storage.gdriveClientId,
        clientSecret: storage.gdriveClientSecret,
        refreshToken: storage.gdriveRefreshToken,
        folderId: storage.gdriveFolderId,
        fileName: rawKey.replace(/\//g, '_'),
        bytes: storedBytes,
        mimeType: 'application/octet-stream'
      });
      finalKey = `gdrive:${gdriveFile.id}`;
    } else if (hasS3 && (storage.storageType === 's3' || !hasNativeR2 || (storage.accessKeyId && storage.secretAccessKey))) {
      const aws = new AwsClient({
        accessKeyId: storage.accessKeyId,
        secretAccessKey: storage.secretAccessKey,
        region: storage.region || 'auto',
        service: 's3'
      });
      const s3Url = storage.endpoint
        ? new URL(`${storage.endpoint.replace(/\/+$/, '')}/${storage.bucketName || 'edgechat-files'}/${rawKey}`)
        : new URL(`https://${storage.accountId}.r2.cloudflarestorage.com/${storage.bucketName || 'edgechat-files'}/${rawKey}`);
      const s3Res = await aws.fetch(s3Url, {
        method: 'PUT',
        headers: {
          'Content-Type': isClientE2ee ? 'application/octet-stream' : (normalizeContentType(file.type) || 'application/octet-stream'),
          'x-amz-meta-filename': encodeURIComponent(sanitizeFilename(file.name)),
          'x-amz-meta-edgechat-encryption': isClientE2ee ? 'e2ee' : 'v1'
        },
        body: storedBytes
      });
      if (!s3Res.ok) {
        const errText = await s3Res.text().catch(() => '');
        throw new Error(`S3 存储上传失败 (${s3Res.status}): ${errText}`);
      }
    } else if (hasNativeR2) {
      await c.env.FILES.put(rawKey, storedBytes, {
        httpMetadata: {
          contentType: isClientE2ee ? 'application/octet-stream' : (normalizeContentType(file.type) || 'application/octet-stream'),
          cacheControl: FILE_RESPONSE_CACHE_CONTROL
        },
        customMetadata: {
          filename: sanitizeFilename(file.name),
          edgechatEncryption: isClientE2ee ? 'e2ee' : 'v1'
        }
      });
    }

    try {
      await recordUploadedFile(c.env.DB, {
        key: finalKey,
        ownerUserId: session.userId,
        filename: sanitizeFilename(file.name),
        contentType: isClientE2ee ? 'application/octet-stream' : (normalizeContentType(file.type) || 'application/octet-stream'),
        size: file.size
      });
    } catch (error) {
      // 元数据写入失败时删除刚上传的密文，避免生成无法归属、也无法被消息引用的孤儿对象。
      try {
        if (hasGdrive && finalKey.startsWith('gdrive:')) {
          await deleteGoogleDriveFile({
            clientId: storage.gdriveClientId,
            clientSecret: storage.gdriveClientSecret,
            refreshToken: storage.gdriveRefreshToken,
            fileId: finalKey.slice(7)
          });
        } else if (hasNativeR2) {
          await c.env.FILES.delete(rawKey);
        }
      } catch (deleteError) {
        console.warn('Failed to delete orphaned upload after metadata error', deleteError);
      }
      throw error;
    }

    return c.json({
      file: {
        key: finalKey,
        name: file.name,
        type: file.type || 'application/octet-stream',
        size: file.size,
        url: `/files/${encodeURIComponent(finalKey)}`,
        isE2ee: isClientE2ee
      }
    });
  });

  app.get('/files/:key{.+}', async (c) => {
    const key = decodeURIComponent(c.req.param('key'));
    const authorization = c.req.header('authorization') || '';
    const bearerToken = authorization.startsWith('Bearer ')
      ? authorization.slice('Bearer '.length).trim()
      : '';
    let auth = bearerToken ? await validateSession(c.env, bearerToken) : null;
    if (!auth?.ok) {
      const url = new URL(c.req.url);
      const ticket = url.searchParams.get('ticket') || '';
      auth = await resolveUrlTicket(c.env, ticket, { purpose: 'file', scope: createFileScope() });
    }
    const canRead = await canAccessFile(c.env.DB, key, auth?.ok ? auth.session.userId : null);
    if (!canRead) {
      return new Response('Forbidden', { status: 403 });
    }

    const db = c.env.DB;
    const storage = db ? await getStorageServerSecret(db, c.env).catch(() => ({})) : {};
    const hasGdrive = storage.storageType === 'gdrive' && storage.gdriveClientId && storage.gdriveClientSecret && storage.gdriveRefreshToken;
    const hasS3 = storage.accessKeyId && storage.secretAccessKey && (storage.endpoint || storage.accountId);
    const hasNativeR2 = Boolean(c.env.FILES);

    if (!hasNativeR2 && !hasGdrive && !hasS3 && !key.startsWith('gdrive:')) {
      return errorResponse('当前部署没有绑定 R2，无法读取附件', 503);
    }

    let fileBuffer;
    let customMeta = {};
    let lastModifiedStr = null;

    let object = null;
    let gdriveRes = null;
    if (key.startsWith('gdrive:')) {
      const gdriveFileId = key.slice(7);
      if (!storage.gdriveClientId || !storage.gdriveClientSecret || !storage.gdriveRefreshToken) {
        return errorResponse('Google Drive 存储凭据未配置', 503);
      }
      gdriveRes = await fetchGoogleDriveFile({
        clientId: storage.gdriveClientId,
        clientSecret: storage.gdriveClientSecret,
        refreshToken: storage.gdriveRefreshToken,
        fileId: gdriveFileId
      });
      if (!gdriveRes.ok) {
        return new Response('Not Found', { status: 404 });
      }
      fileBuffer = await gdriveRes.arrayBuffer();
    } else if (hasNativeR2) {
      object = await c.env.FILES.get(key);
      if (object) {
        fileBuffer = await object.arrayBuffer();
        customMeta = object.customMetadata || {};
        if (object.uploaded) {
          lastModifiedStr = object.uploaded.toUTCString();
        }
      } else if (hasS3) {
        const aws = new AwsClient({
          accessKeyId: storage.accessKeyId,
          secretAccessKey: storage.secretAccessKey,
          region: storage.region || 'auto',
          service: 's3'
        });
        const s3Url = storage.endpoint
          ? new URL(`${storage.endpoint.replace(/\/+$/, '')}/${storage.bucketName || 'edgechat-files'}/${key}`)
          : new URL(`https://${storage.accountId}.r2.cloudflarestorage.com/${storage.bucketName || 'edgechat-files'}/${key}`);
        const s3Res = await aws.fetch(s3Url, { method: 'GET' });
        if (!s3Res.ok) {
          return new Response('Not Found', { status: 404 });
        }
        fileBuffer = await s3Res.arrayBuffer();
        const s3Enc = s3Res.headers.get('x-amz-meta-edgechat-encryption');
        if (s3Enc) customMeta.edgechatEncryption = s3Enc;
        const s3Name = s3Res.headers.get('x-amz-meta-filename');
        if (s3Name) customMeta.filename = decodeURIComponent(s3Name);
        const lm = s3Res.headers.get('last-modified');
        if (lm) lastModifiedStr = lm;
      } else {
        return new Response('Not Found', { status: 404 });
      }
    } else if (hasS3) {
      const aws = new AwsClient({
        accessKeyId: storage.accessKeyId,
        secretAccessKey: storage.secretAccessKey,
        region: storage.region || 'auto',
        service: 's3'
      });
      const s3Url = storage.endpoint
        ? new URL(`${storage.endpoint.replace(/\/+$/, '')}/${storage.bucketName || 'edgechat-files'}/${key}`)
        : new URL(`https://${storage.accountId}.r2.cloudflarestorage.com/${storage.bucketName || 'edgechat-files'}/${key}`);
      const s3Res = await aws.fetch(s3Url, { method: 'GET' });
      if (!s3Res.ok) {
        return new Response('Not Found', { status: 404 });
      }
      fileBuffer = await s3Res.arrayBuffer();
      const s3Enc = s3Res.headers.get('x-amz-meta-edgechat-encryption');
      if (s3Enc) customMeta.edgechatEncryption = s3Enc;
      const s3Name = s3Res.headers.get('x-amz-meta-filename');
      if (s3Name) customMeta.filename = decodeURIComponent(s3Name);
      const lm = s3Res.headers.get('last-modified');
      if (lm) lastModifiedStr = lm;
    } else {
      return errorResponse('当前部署没有绑定 R2，无法读取附件', 503);
    }

    const fileMetadata = await getUploadedFileMetadata(c.env.DB, key);
    const isE2ee = customMeta?.edgechatEncryption === 'e2ee';
    let decrypted;
    if (isE2ee) {
      decrypted = { bytes: new Uint8Array(fileBuffer), encrypted: true };
    } else {
      try {
        decrypted = await decryptAttachment(c.env, fileBuffer, key);
      } catch (error) {
        if (key.startsWith('gdrive:')) {
          const gdriveFileId = key.slice(7);
          let rawKeyCandidate = null;
          try {
            const gName = await getGoogleDriveFileName({
              clientId: storage.gdriveClientId,
              clientSecret: storage.gdriveClientSecret,
              refreshToken: storage.gdriveRefreshToken,
              fileId: gdriveFileId,
              fetchImpl: fetch
            });
            if (gName) {
              const slashIdx = gName.indexOf('_');
              if (slashIdx > 0) {
                rawKeyCandidate = gName.slice(0, slashIdx) + '/' + gName.slice(slashIdx + 1);
              }
            }
          } catch (e) {
            console.warn('Failed to query gdrive file name for decryption fallback', e);
          }
          if (rawKeyCandidate) {
            try {
              decrypted = await decryptAttachment(c.env, fileBuffer, rawKeyCandidate);
            } catch {
              console.error('Failed to decrypt attachment with rawKey', { key, rawKeyCandidate, error });
              throw error;
            }
          } else {
            throw error;
          }
        } else {
          console.error('Failed to decrypt attachment', { key, error });
          throw error;
        }
      }
    }

    const headers = new Headers();
    if (object && typeof object.writeHttpMetadata === 'function') {
      object.writeHttpMetadata(headers);
    }
    headers.set('cache-control', FILE_RESPONSE_CACHE_CONTROL);
    if (lastModifiedStr) {
      headers.set('last-modified', lastModifiedStr);
    }

    headers.set('x-content-type-options', 'nosniff');
    headers.set('referrer-policy', 'no-referrer');
    headers.set(
      'content-security-policy',
      "sandbox; default-src 'none'; base-uri 'none'; form-action 'none'"
    );

    const contentType =
      normalizeContentType(fileMetadata?.contentType) ||
      normalizeContentType(headers.get('content-type')) ||
      'application/octet-stream';
    headers.set('content-type', contentType);
    const inlineAllowed = isInlineContentType(contentType);
    const dispositionKind =
      inlineAllowed && !contentType.startsWith('text/') ? 'inline' : 'attachment';
    const filename =
      fileMetadata?.filename || customMeta?.filename || key.split('/').pop() || 'file';
    headers.set('content-disposition', contentDispositionValue(dispositionKind, filename));
    headers.set('accept-ranges', 'bytes');

    const totalBytes = decrypted.bytes.length;
    const rangeHeader = c.req.header('range');
    if (rangeHeader?.startsWith('bytes=')) {
      const match = rangeHeader.slice(6).trim().match(/^(\d*)-(\d*)$/);
      if (match) {
        let start = match[1] ? parseInt(match[1], 10) : 0;
        let end = match[2] ? parseInt(match[2], 10) : totalBytes - 1;
        if (!match[1] && match[2]) {
          start = Math.max(0, totalBytes - parseInt(match[2], 10));
          end = totalBytes - 1;
        }
        if (start <= end && start < totalBytes) {
          end = Math.min(end, totalBytes - 1);
          const chunk = decrypted.bytes.subarray(start, end + 1);
          headers.set('content-range', `bytes ${start}-${end}/${totalBytes}`);
          headers.set('content-length', String(chunk.length));
          return new Response(chunk, { status: 206, headers });
        }
      }
    }

    headers.set('content-length', String(totalBytes));
    return new Response(decrypted.bytes, { headers });
  });
}
