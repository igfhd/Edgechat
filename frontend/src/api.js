import { dispatchAuthInvalid, getStoredToken } from './auth-storage.js';
import {
  getEdgeChatServerOrigin,
  getStoredNativeServerPrefix,
  isCapacitorAndroid,
  resolveServerUrl
} from './capacitor-platform.js';
import { getRuntimeFileUrl, isDemoMode, requestRuntime } from './runtime.js';

const WS_TICKET_CACHE_MS = 50 * 1000;
const FILE_TICKET_CACHE_MS = 290 * 1000;
const wsTicketCache = new Map();
let fileTicketCache = { ticket: '', expiresAt: 0 };
let fileTicketRefreshTimer = null;

async function ensureWsTicket(kind, roomId = null) {
  if (isDemoMode) {
    return '';
  }
  const scope = kind === 'inbox' ? 'ws:inbox' : `ws:room:${kind}:${roomId}`;
  const cached = wsTicketCache.get(scope);
  if (cached?.ticket && Date.now() < cached.expiresAt) {
    return cached.ticket;
  }
  const payload = await request('/auth/ws-ticket', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: kind === 'inbox' ? { kind: 'inbox' } : { kind, roomId }
  });
  wsTicketCache.set(scope, {
    ticket: payload.ticket,
    expiresAt: Date.now() + WS_TICKET_CACHE_MS
  });
  return payload.ticket;
}

async function ensureFileTicket() {
  if (isDemoMode) {
    return '';
  }
  if (fileTicketCache.ticket && Date.now() < fileTicketCache.expiresAt) {
    return fileTicketCache.ticket;
  }
  const payload = await request('/auth/file-ticket', { method: 'POST' });
  fileTicketCache = {
    ticket: payload.ticket,
    expiresAt: Date.now() + FILE_TICKET_CACHE_MS
  };
  scheduleFileTicketRefresh();
  return payload.ticket;
}

function scheduleFileTicketRefresh() {
  if (fileTicketRefreshTimer !== null) {
    clearTimeout(fileTicketRefreshTimer);
  }
  const delay = Math.max(fileTicketCache.expiresAt - Date.now() - 5 * 1000, 1000);
  fileTicketRefreshTimer = setTimeout(() => {
    fileTicketRefreshTimer = null;
    if (getStoredToken()) {
      void ensureFileTicket().catch(() => {});
    }
  }, delay);
}

function clearTicketCaches() {
  wsTicketCache.clear();
  fileTicketCache = { ticket: '', expiresAt: 0 };
  if (fileTicketRefreshTimer !== null) {
    clearTimeout(fileTicketRefreshTimer);
    fileTicketRefreshTimer = null;
  }
}

function fileTicketParam() {
  if (!fileTicketCache.ticket || Date.now() >= fileTicketCache.expiresAt) {
    void ensureFileTicket().catch(() => {});
    return '';
  }
  return fileTicketCache.ticket;
}

export function getBasePrefix() {
  if (isCapacitorAndroid) {
    return getStoredNativeServerPrefix();
  }
  if (typeof window === 'undefined') return '';
  const pathname = window.location.pathname;
  const firstSeg = pathname.split('/').filter(Boolean)[0] || '';
  const standardRoutes = ['login', 'register', 'admin', 'settings', 'drive', 's', 'api', 'files', 'dav'];
  if (firstSeg && !standardRoutes.includes(firstSeg)) {
    return `/${firstSeg}`;
  }
  return '';
}

export function buildHeaders(extra = {}) {
  const headers = { ...extra };
  const token = getStoredToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

export async function request(path, options = {}) {
  if (isDemoMode) {
    return requestRuntime(path, options);
  }

  const prefix = getBasePrefix();
  const cleanPath = path.startsWith('/api/') ? path.slice(4) : (path.startsWith('/api') ? path.slice(4) : path);
  const normalizedPath = cleanPath.startsWith('/') ? cleanPath : `/${cleanPath}`;
  const response = await fetch(resolveServerUrl(`${prefix}/api${normalizedPath}`), {
    ...options,
    headers: buildHeaders(options.headers),
    body:
      options.body instanceof FormData || typeof options.body === 'string'
        ? options.body
        : options.body
          ? JSON.stringify(options.body)
          : undefined
  });

  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json')
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    const message = payload?.error || payload || 'Request failed';
    const error = new Error(message);
    error.status = response.status;
    error.payload = payload;

    if (response.status === 401 && typeof window !== 'undefined') {
      dispatchAuthInvalid(message);
    }

    throw error;
  }

  return payload;
}

export default {
  login(credentials) {
    return request('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: credentials
    });
  },
  logout() {
    return request('/auth/logout', { method: 'POST' });
  },
  session() {
    return request('/auth/session');
  },
  getSite() {
    return request('/site');
  },
  changePassword(payload) {
    return request('/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload
    });
  },
  updateProfile(payload) {
    return request('/me/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: payload
    });
  },
  getUsers() {
    return request('/users');
  },
  bootstrap() {
    return request('/bootstrap');
  },
  getChannels() {
    return request('/channels');
  },
  createGroup(payload) {
    return request('/channels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload
    });
  },
  joinChannel(channelId) {
    return request(`/channels/${channelId}/join`, { method: 'POST' });
  },
  getChannelMembers(channelId) {
    return request(`/channels/${channelId}/members`);
  },
  inviteChannelMembers(channelId, userIds) {
    return request(`/channels/${channelId}/invite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { userIds }
    });
  },
  transferChannelOwner(channelId, newOwnerId) {
    return request(`/channels/${channelId}/transfer-owner`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { newOwnerId }
    });
  },
  removeChannelMember(channelId, userId) {
    return request(`/channels/${channelId}/members/${userId}`, {
      method: 'DELETE'
    });
  },
  deleteOwnedChannel(channelId) {
    return request(`/channels/${channelId}`, {
      method: 'DELETE'
    });
  },
  updateChannel(channelId, payload) {
    return request(`/channels/${channelId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: payload
    });
  },
  getMessages(kind, roomId, before) {
    const query = new URLSearchParams({ kind, roomId: String(roomId) });
    if (before) {
      query.set('before', String(before));
    }
    return request(`/messages?${query.toString()}`);
  },
  markRoomRead(kind, roomId, messageId) {
    return request('/messages/read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: {
        kind,
        roomId,
        ...(messageId ? { messageId } : {})
      }
    });
  },
  openDm(userId) {
    return request('/dm/open', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { userId }
    });
  },
  deleteDm(channelId) {
    return request(`/dm/${encodeURIComponent(channelId)}`, {
      method: 'DELETE'
    });
  },
  listDms() {
    return request('/dm');
  },
  uploadIdentityKey(publicKey, keyVersion = 1, resetConfirmed = false) {
    return request('/keys/identity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { publicKey, keyVersion, resetConfirmed }
    });
  },
  getUserIdentityKey(userId) {
    return request(`/keys/identity/${userId}`);
  },
  getBatchUserIdentityKeys(userIds) {
    return request('/keys/identity/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { userIds }
    });
  },
  uploadKeyBackup(payload) {
    return request('/keys/backup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload
    });
  },
  getKeyBackup() {
    return request('/keys/backup');
  },
  uploadFile(file, isE2ee = false, filename = '') {
    const form = new FormData();
    if (filename) {
      form.append('file', file, filename);
    } else {
      form.append('file', file);
    }
    if (isE2ee) {
      form.append('isE2ee', '1');
    }
    return request('/upload', {
      method: 'POST',
      body: form
    });
  },
  async getRoomWebSocketUrl(kind, roomId) {
    const ticket = await ensureWsTicket(kind, roomId);
    const prefix = getBasePrefix();
    const url = new URL(`${prefix}/api/ws/${kind}/${roomId}`, getEdgeChatServerOrigin());
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.searchParams.set('ticket', ticket);
    return url.toString();
  },
  async getInboxWebSocketUrl() {
    const ticket = await ensureWsTicket('inbox');
    const prefix = getBasePrefix();
    const url = new URL(`${prefix}/api/inbox/ws`, getEdgeChatServerOrigin());
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.searchParams.set('ticket', ticket);
    return url.toString();
  },
  getFileUrl(keyOrUrl) {
    const raw = String(keyOrUrl || '');
    if (!raw) {
      return '';
    }
    if (isDemoMode) {
      return getRuntimeFileUrl(raw);
    }
    if (/^https?:\/\//i.test(raw)) {
      return raw;
    }

    const prefix = getBasePrefix();
    let fileRelativePath = '';
    if (raw.startsWith('/files/')) {
      fileRelativePath = raw;
    } else if (prefix && raw.startsWith(`${prefix}/files/`)) {
      fileRelativePath = raw.slice(prefix.length);
    } else {
      fileRelativePath = `/files/${encodeURIComponent(raw)}`;
    }

    const url = new URL(`${prefix}${fileRelativePath}`, getEdgeChatServerOrigin());
    const ticket = fileTicketParam();
    if (ticket) {
      url.searchParams.set('ticket', ticket);
    }
    return resolveServerUrl(url.pathname + url.search);
  },
  fileUrl(keyOrUrl) {
    return this.getFileUrl(keyOrUrl);
  },
  async fetchFileResponse(keyOrUrl, options = {}) {
    const raw = String(keyOrUrl || '');
    if (!raw) {
      throw new Error('Invalid file key or url');
    }
    if (!isDemoMode && (!fileTicketCache.ticket || Date.now() >= fileTicketCache.expiresAt)) {
      await ensureFileTicket().catch(() => '');
    }
    const targetUrl = this.getFileUrl(raw);
    const headers = buildHeaders(options.headers);
    const res = await fetch(targetUrl, {
      ...options,
      headers
    });
    if (!res.ok) {
      throw new Error(`Failed to fetch file: ${res.status}`);
    }
    return res;
  },
  async fetchFileBuffer(keyOrUrl, options = {}) {
    const res = await this.fetchFileResponse(keyOrUrl, options);
    return res.arrayBuffer();
  },
  async fetchFileBlob(keyOrUrl, options = {}) {
    const res = await this.fetchFileResponse(keyOrUrl, options);
    return res.blob();
  },
  adminUsers() {
    return request('/admin/users');
  },
  adminOverview() {
    return request('/admin/overview');
  },
  adminStorageScan(cursor = '') {
    const query = new URLSearchParams();
    if (cursor) {
      query.set('cursor', cursor);
    }
    const suffix = query.size ? `?${query.toString()}` : '';
    return request(`/admin/storage/scan${suffix}`);
  },
  adminSiteSettings() {
    return request('/admin/site-settings');
  },
  adminTelegram() {
    return request('/admin/telegram');
  },
  saveAdminTelegramConfig(payload) {
    return request('/admin/telegram/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: payload
    });
  },
  createAdminTelegramMapping(payload) {
    return request('/admin/telegram/mappings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload
    });
  },
  updateAdminTelegramMapping(mappingId, payload) {
    return request(`/admin/telegram/mappings/${mappingId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: payload
    });
  },
  deleteAdminTelegramMapping(mappingId) {
    return request(`/admin/telegram/mappings/${mappingId}`, { method: 'DELETE' });
  },
  listAdminRegisterLinks() {
    return request('/admin/register-links');
  },
  createAdminRegisterLink(payload) {
    return request('/admin/register-links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload
    });
  },
  revokeAdminRegisterLink(inviteId) {
    return request(`/admin/register-links/${inviteId}`, {
      method: 'DELETE'
    });
  },
  updateAdminSiteSettings(payload) {
    return request('/admin/site-settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: payload
    });
  },
  testAdminStorage(payload) {
    return request('/admin/storage/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload
    });
  },
  testCallsSettings(payload) {
    return request('/admin/calls/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload
    });
  },
  createCallsSession() {
    return request('/calls/session', {
      method: 'POST'
    });
  },
  createCallsNewTracks(sessionId, payload) {
    return request(`/calls/sessions/${encodeURIComponent(sessionId)}/tracks/new`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload
    });
  },
  renegotiateCallsSession(sessionId, payload) {
    return request(`/calls/sessions/${encodeURIComponent(sessionId)}/renegotiate`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: payload
    });
  },
  runAdminGc() {
    return request('/admin/run-gc', {
      method: 'POST'
    });
  },
  createUser(payload) {
    return request('/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload
    });
  },
  updateUser(userId, payload) {
    return request(`/admin/users/${userId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: payload
    });
  },
  resetPassword(userId, password) {
    return request(`/admin/users/${userId}/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { password }
    });
  },
  deleteUser(userId) {
    return request(`/admin/users/${userId}`, {
      method: 'DELETE'
    });
  },
  adminChannels() {
    return request('/admin/channels');
  },
  updateGeneralChannelSettings(payload) {
    return request('/admin/channels/general-settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload
    });
  },
  deleteChannel(channelId) {
    return request(`/admin/channels/${channelId}`, {
      method: 'DELETE'
    });
  },
  adminDms() {
    return request('/admin/dms');
  },
  getRegisterInvite(token) {
    return request(`/register-links/${encodeURIComponent(token)}`);
  },
  registerWithInvite(token, payload) {
    return request(`/register-links/${encodeURIComponent(token)}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload
    });
  },
  getDriveFileUrl(fileId, inline = false) {
    const prefix = getBasePrefix();
    const params = new URLSearchParams();
    if (inline) params.set('view', '1');
    const ticket = fileTicketParam();
    if (ticket) params.set('ticket', ticket);
    const qs = params.toString();
    return resolveServerUrl(`${prefix}/api/drive/files/${encodeURIComponent(fileId)}${qs ? `?${qs}` : ''}`);
  },
  async ensureDriveFileUrl(fileId, inline = false) {
    const prefix = getBasePrefix();
    const params = new URLSearchParams();
    if (inline) params.set('view', '1');
    let ticket = fileTicketParam();
    if (!ticket) {
      ticket = await ensureFileTicket().catch(() => '');
    }
    if (ticket) params.set('ticket', ticket);
    const qs = params.toString();
    return resolveServerUrl(`${prefix}/api/drive/files/${encodeURIComponent(fileId)}${qs ? `?${qs}` : ''}`);
  },
  getAnnouncements() {
    return request('/announcements');
  },
  adminAnnouncements() {
    return request('/admin/announcements');
  },
  createAnnouncement(payload) {
    return request('/admin/announcements', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload
    });
  },
  updateAnnouncement(id, payload) {
    return request(`/admin/announcements/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: payload
    });
  },
  deleteAnnouncement(id) {
    return request(`/admin/announcements/${id}`, {
      method: 'DELETE'
    });
  },
  adminGroups() {
    return request('/admin/groups');
  },
  createAdminGroup(payload) {
    return request('/admin/groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload
    });
  },
  updateAdminGroup(groupId, payload) {
    return request(`/admin/groups/${groupId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: payload
    });
  },
  deleteAdminGroup(groupId) {
    return request(`/admin/groups/${groupId}`, {
      method: 'DELETE'
    });
  },
  getAdminGroupMembers(groupId) {
    return request(`/admin/groups/${groupId}/members`);
  },
  addAdminGroupMembers(groupId, userIds) {
    return request(`/admin/groups/${groupId}/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { userIds }
    });
  },
  removeAdminGroupMember(groupId, userId) {
    return request(`/admin/groups/${groupId}/members/${userId}`, {
      method: 'DELETE'
    });
  },
  setGroupMemberRole(groupId, userId, role) {
    return request(`/admin/groups/${groupId}/members/${userId}/role`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: { role }
    });
  },
  getManagedGroups() {
    return request('/me/managed-groups');
  },
  updateManagedGroupPolicy(groupId, allowMemberDm) {
    return request(`/me/managed-groups/${groupId}/policy`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: { allowMemberDm }
    });
  },
  adminBackupExport() {
    return request('/admin/backup/export');
  },
  adminBackupPreview(payload) {
    return request('/admin/backup/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload
    });
  },
  adminBackupImport(payload) {
    return request('/admin/backup/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload
    });
  },
  getBasePrefix,
  ensureFileTicket,
  clearTicketCaches
};

export { request as apiFetch, getStoredToken as getAuthToken };
