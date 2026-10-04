import { publicFileUrl } from '../utils.js';

const ANNOUNCEMENT_CACHE_TTL_MS = 60 * 1000;
let activeAnnouncementsCache = null;

export function invalidateAnnouncementsCache() {
  activeAnnouncementsCache = null;
}

export async function listActiveAnnouncements(db) {
  const now = Date.now();
  if (activeAnnouncementsCache && now < activeAnnouncementsCache.exp) {
    return activeAnnouncementsCache.list.map((item) => ({ ...item }));
  }

  const { results } = await db
    .prepare(
      `SELECT a.id, a.title, a.content, a.creator_id, a.is_pinned, a.is_active,
              a.priority, a.starts_at, a.expires_at, a.created_at, a.updated_at,
              COALESCE(u.display_name, u.username, '管理员') AS creator_name,
              u.avatar_key AS creator_avatar_key
       FROM announcements a
       LEFT JOIN users u ON u.id = a.creator_id
       WHERE a.is_active = 1
         AND (a.starts_at IS NULL OR datetime(a.starts_at) <= datetime('now'))
         AND (a.expires_at IS NULL OR datetime(a.expires_at) >= datetime('now'))
       ORDER BY a.is_pinned DESC, a.priority DESC, a.created_at DESC`
    )
    .all();

  const list = (results || []).map((row) => ({
    id: Number(row.id),
    title: String(row.title || ''),
    content: String(row.content || ''),
    creatorId: Number(row.creator_id),
    creatorName: String(row.creator_name || '管理员'),
    creatorAvatarUrl: row.creator_avatar_key ? publicFileUrl(row.creator_avatar_key) : null,
    isPinned: Boolean(row.is_pinned),
    isActive: Boolean(row.is_active),
    priority: Number(row.priority || 0),
    startsAt: row.starts_at || null,
    expiresAt: row.expires_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));
  activeAnnouncementsCache = { list, exp: now + ANNOUNCEMENT_CACHE_TTL_MS };
  return list.map((item) => ({ ...item }));
}

export async function listAllAnnouncements(db) {
  const { results } = await db
    .prepare(
      `SELECT a.id, a.title, a.content, a.creator_id, a.is_pinned, a.is_active,
              a.priority, a.starts_at, a.expires_at, a.created_at, a.updated_at,
              COALESCE(u.display_name, u.username, '管理员') AS creator_name,
              u.avatar_key AS creator_avatar_key
       FROM announcements a
       LEFT JOIN users u ON u.id = a.creator_id
       ORDER BY a.is_pinned DESC, a.priority DESC, a.created_at DESC`
    )
    .all();

  return (results || []).map((row) => ({
    id: Number(row.id),
    title: String(row.title || ''),
    content: String(row.content || ''),
    creatorId: Number(row.creator_id),
    creatorName: String(row.creator_name || '管理员'),
    creatorAvatarUrl: row.creator_avatar_key ? publicFileUrl(row.creator_avatar_key) : null,
    isPinned: Boolean(row.is_pinned),
    isActive: Boolean(row.is_active),
    priority: Number(row.priority || 0),
    startsAt: row.starts_at || null,
    expiresAt: row.expires_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));
}

export async function getAnnouncementById(db, id) {
  const row = await db
    .prepare(
      `SELECT a.id, a.title, a.content, a.creator_id, a.is_pinned, a.is_active,
              a.priority, a.starts_at, a.expires_at, a.created_at, a.updated_at,
              COALESCE(u.display_name, u.username, '管理员') AS creator_name,
              u.avatar_key AS creator_avatar_key
       FROM announcements a
       LEFT JOIN users u ON u.id = a.creator_id
       WHERE a.id = ?`
    )
    .bind(Number(id))
    .first();

  if (!row) return null;

  return {
    id: Number(row.id),
    title: String(row.title || ''),
    content: String(row.content || ''),
    creatorId: Number(row.creator_id),
    creatorName: String(row.creator_name || '管理员'),
    creatorAvatarUrl: row.creator_avatar_key ? publicFileUrl(row.creator_avatar_key) : null,
    isPinned: Boolean(row.is_pinned),
    isActive: Boolean(row.is_active),
    priority: Number(row.priority || 0),
    startsAt: row.starts_at || null,
    expiresAt: row.expires_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export async function createAnnouncement(db, {
  title,
  content,
  creatorId,
  isPinned = true,
  isActive = true,
  priority = 0,
  startsAt = null,
  expiresAt = null
}) {
  const cleanTitle = String(title || '').trim();
  const cleanContent = String(content || '').trim();
  if (!cleanTitle) {
    throw new Error('公告标题不能为空');
  }
  if (!cleanContent) {
    throw new Error('公告内容不能为空');
  }

  const result = await db
    .prepare(
      `INSERT INTO announcements (
         title, content, creator_id, is_pinned, is_active,
         priority, starts_at, expires_at, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
    )
    .bind(
      cleanTitle,
      cleanContent,
      Number(creatorId),
      isPinned ? 1 : 0,
      isActive ? 1 : 0,
      Number(priority || 0),
      startsAt ? String(startsAt) : null,
      expiresAt ? String(expiresAt) : null
    )
    .run();

  invalidateAnnouncementsCache();
  return getAnnouncementById(db, result.meta.last_row_id);
}

export async function updateAnnouncement(db, id, {
  title,
  content,
  isPinned,
  isActive,
  priority,
  startsAt,
  expiresAt
}) {
  const existing = await getAnnouncementById(db, id);
  if (!existing) {
    throw new Error('公告不存在');
  }

  const cleanTitle = title !== undefined ? String(title).trim() : existing.title;
  const cleanContent = content !== undefined ? String(content).trim() : existing.content;
  if (!cleanTitle) throw new Error('公告标题不能为空');
  if (!cleanContent) throw new Error('公告内容不能为空');

  const finalPinned = isPinned !== undefined ? (isPinned ? 1 : 0) : (existing.isPinned ? 1 : 0);
  const finalActive = isActive !== undefined ? (isActive ? 1 : 0) : (existing.isActive ? 1 : 0);
  const finalPriority = priority !== undefined ? Number(priority || 0) : existing.priority;
  const finalStartsAt = startsAt !== undefined ? (startsAt ? String(startsAt) : null) : existing.startsAt;
  const finalExpiresAt = expiresAt !== undefined ? (expiresAt ? String(expiresAt) : null) : existing.expiresAt;

  await db
    .prepare(
      `UPDATE announcements
       SET title = ?, content = ?, is_pinned = ?, is_active = ?,
           priority = ?, starts_at = ?, expires_at = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    )
    .bind(
      cleanTitle,
      cleanContent,
      finalPinned,
      finalActive,
      finalPriority,
      finalStartsAt,
      finalExpiresAt,
      Number(id)
    )
    .run();

  invalidateAnnouncementsCache();
  return getAnnouncementById(db, id);
}

export async function deleteAnnouncement(db, id) {
  const existing = await getAnnouncementById(db, id);
  if (!existing) {
    throw new Error('公告不存在');
  }

  await db.prepare('DELETE FROM announcements WHERE id = ?').bind(Number(id)).run();
  invalidateAnnouncementsCache();
  return true;
}
