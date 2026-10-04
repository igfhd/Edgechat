/**
 * Google Drive 云端硬盘存储适配器
 * 基于 Google Drive REST API v3
 */

export async function getGoogleAccessToken({
  clientId,
  clientSecret,
  refreshToken,
  fetchImpl = fetch,
}) {
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('缺少 Google Drive OAuth 凭据 (Client ID / Client Secret / Refresh Token)');
  }
  const res = await fetchImpl('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Google OAuth 令牌刷新失败 (${res.status}): ${err}`);
  }
  const data = await res.json();
  if (!data.access_token) {
    throw new Error('Google OAuth 响应中缺少 access_token');
  }
  return data.access_token;
}

export async function testGoogleDriveConnection({
  clientId,
  clientSecret,
  refreshToken,
  _folderId,
  fetchImpl = fetch,
}) {
  const token = await getGoogleAccessToken({
    clientId,
    clientSecret,
    refreshToken,
    fetchImpl,
  });
  const res = await fetchImpl(
    'https://www.googleapis.com/drive/v3/about?fields=user,storageQuota',
    {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Google Drive API 探测失败 (${res.status}): ${err}`);
  }
  const data = await res.json();
  const email = data?.user?.emailAddress || '未知 Google 账号';
  const usedGb = data?.storageQuota?.usage
    ? (Number(data.storageQuota.usage) / 1024 / 1024 / 1024).toFixed(2)
    : '0';
  const totalGb = data?.storageQuota?.limit
    ? (Number(data.storageQuota.limit) / 1024 / 1024 / 1024).toFixed(2)
    : '无限/未限制';
  return {
    ok: true,
    message: `Google Drive 连通正常！已连接账号: ${email} (已用: ${usedGb} GB / 配额: ${totalGb} GB)`,
  };
}

export async function createGoogleDriveUploadSession({
  clientId,
  clientSecret,
  refreshToken,
  folderId,
  fileName,
  mimeType,
  size,
  fetchImpl = fetch,
}) {
  const token = await getGoogleAccessToken({
    clientId,
    clientSecret,
    refreshToken,
    fetchImpl,
  });
  const bodyPayload = { name: fileName || 'file' };
  if (folderId && String(folderId).trim()) {
    bodyPayload.parents = [String(folderId).trim()];
  }
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json; charset=UTF-8',
    'X-Upload-Content-Type': mimeType || 'application/octet-stream',
  };
  if (size && Number(size) > 0) {
    headers['X-Upload-Content-Length'] = String(size);
  }
  const res = await fetchImpl(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable',
    {
      method: 'POST',
      headers,
      body: JSON.stringify(bodyPayload),
    },
  );
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`创建 Google Drive 上传通道失败 (${res.status}): ${err}`);
  }
  const uploadUrl = res.headers.get('Location');
  if (!uploadUrl) {
    throw new Error('Google Drive API 未返回 Location 直传地址');
  }
  return { uploadUrl };
}

export async function fetchGoogleDriveFile({
  clientId,
  clientSecret,
  refreshToken,
  fileId,
  fetchImpl = fetch,
}) {
  const token = await getGoogleAccessToken({
    clientId,
    clientSecret,
    refreshToken,
    fetchImpl,
  });
  const res = await fetchImpl(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`,
    {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`从 Google Drive 读取文件失败 (${res.status}): ${err}`);
  }
  return res;
}

export async function uploadGoogleDriveBinaryFile({
  clientId,
  clientSecret,
  refreshToken,
  folderId,
  fileName,
  bytes,
  mimeType = 'application/octet-stream',
  fetchImpl = fetch,
}) {
  const token = await getGoogleAccessToken({
    clientId,
    clientSecret,
    refreshToken,
    fetchImpl,
  });
  const metadata = { name: fileName || 'file' };
  if (folderId && String(folderId).trim()) {
    metadata.parents = [String(folderId).trim()];
  }
  const boundary = '-------314159265358979323846';
  const delimiter = `\r\n--${boundary}\r\n`;
  const closeDelimiter = `\r\n--${boundary}--`;
  const metaHeader =
    delimiter +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify(metadata) +
    delimiter +
    `Content-Type: ${mimeType || 'application/octet-stream'}\r\n\r\n`;

  const encoder = new TextEncoder();
  const metaBytes = encoder.encode(metaHeader);
  const closeBytes = encoder.encode(closeDelimiter);
  const bodyBytes = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : (bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));

  const combined = new Uint8Array(metaBytes.length + bodyBytes.byteLength + closeBytes.length);
  combined.set(metaBytes, 0);
  combined.set(bodyBytes, metaBytes.length);
  combined.set(closeBytes, metaBytes.length + bodyBytes.byteLength);

  const res = await fetchImpl(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
        'Content-Length': String(combined.byteLength),
      },
      body: combined,
    },
  );
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`向 Google Drive 上传文件失败 (${res.status}): ${err}`);
  }
  const data = await res.json();
  return { id: data.id, name: data.name };
}

export async function uploadGoogleDriveTextFile({
  clientId,
  clientSecret,
  refreshToken,
  folderId,
  fileName,
  content,
  mimeType,
  fetchImpl = fetch,
}) {
  const token = await getGoogleAccessToken({
    clientId,
    clientSecret,
    refreshToken,
    fetchImpl,
  });
  const metadata = { name: fileName || 'document.md' };
  if (folderId && String(folderId).trim()) {
    metadata.parents = [String(folderId).trim()];
  }
  const boundary = '-------314159265358979323846';
  const delimiter = `\r\n--${boundary}\r\n`;
  const closeDelimiter = `\r\n--${boundary}--`;
  const body =
    delimiter +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify(metadata) +
    delimiter +
    `Content-Type: ${mimeType || 'text/plain; charset=utf-8'}\r\n\r\n` +
    content +
    closeDelimiter;

  const encoder = new TextEncoder();
  const bodyBytes = encoder.encode(body);
  const res = await fetchImpl(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
        'Content-Length': String(bodyBytes.byteLength),
      },
      body: bodyBytes,
    },
  );
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`向 Google Drive 写入文本文件失败 (${res.status}): ${err}`);
  }
  const data = await res.json();
  return { id: data.id, name: data.name };
}

export async function updateGoogleDriveFileContent({
  clientId,
  clientSecret,
  refreshToken,
  fileId,
  content,
  mimeType,
  fetchImpl = fetch,
}) {
  const token = await getGoogleAccessToken({
    clientId,
    clientSecret,
    refreshToken,
    fetchImpl,
  });
  const encoder = new TextEncoder();
  const bodyBytes = typeof content === 'string' ? encoder.encode(content) : content;
  const res = await fetchImpl(
    `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(fileId)}?uploadType=media`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': mimeType || 'text/plain; charset=utf-8',
        'Content-Length': String(bodyBytes.byteLength),
      },
      body: bodyBytes,
    },
  );
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`更新 Google Drive 文件失败 (${res.status}): ${err}`);
  }
  return await res.json();
}

export async function deleteGoogleDriveFile({
  clientId,
  clientSecret,
  refreshToken,
  fileId,
  fetchImpl = fetch,
}) {
  const token = await getGoogleAccessToken({
    clientId,
    clientSecret,
    refreshToken,
    fetchImpl,
  });
  const res = await fetchImpl(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  if (!res.ok && res.status !== 404) {
    const err = await res.text();
    throw new Error(`删除 Google Drive 文件失败 (${res.status}): ${err}`);
  }
  return { ok: true };
}

export async function copyGoogleDriveFile({
  clientId,
  clientSecret,
  refreshToken,
  fileId,
  newName,
  fetchImpl = fetch,
}) {
  const token = await getGoogleAccessToken({
    clientId,
    clientSecret,
    refreshToken,
    fetchImpl,
  });
  const res = await fetchImpl(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/copy`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: newName || 'Copy' }),
    },
  );
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`复制 Google Drive 文件失败 (${res.status}): ${err}`);
  }
  const data = await res.json();
  return { id: data.id };
}

export async function getGoogleDriveFileName({
  clientId,
  clientSecret,
  refreshToken,
  fileId,
  fetchImpl = fetch,
}) {
  const token = await getGoogleAccessToken({
    clientId,
    clientSecret,
    refreshToken,
    fetchImpl,
  });
  const res = await fetchImpl(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=name`,
    {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  if (res.ok) {
    const data = await res.json();
    return data.name || null;
  }
  return null;
}
