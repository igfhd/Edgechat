import { ensureDmChannel } from '../data/dm-provisioning.js';
import { listAdminDms, listUserDms } from '../data/dm-queries.js';
import { canUsersDirectMessage, getUserGroupsForUsers } from '../data/user-groups.js';
import { getChannelMembership } from '../room-access.js';
import { errorResponse, parseJsonRequest } from '../utils.js';

export function registerDmRoutes(app) {
  app.get('/api/dm', async (c) => {
    const session = c.get('session');
    const dms = await listUserDms(c.env.DB, session.userId);
    const peerIds = dms.map((d) => d.otherUser?.id).filter(Boolean);
    let groupsMap = {};
    try {
      groupsMap = await getUserGroupsForUsers(c.env.DB, peerIds);
    } catch {
      groupsMap = {};
    }
    const enrichedDms = dms.map((d) => ({
      ...d,
      otherUser: d.otherUser ? {
        ...d.otherUser,
        groups: groupsMap[d.otherUser.id] || []
      } : d.otherUser
    }));
    return c.json({ dms: enrichedDms });
  });

  app.post('/api/dm/open', async (c) => {
    const session = c.get('session');
    const payload = await parseJsonRequest(c.req.raw);
    const targetUserId = Number(payload.userId);

    if (!Number.isFinite(targetUserId) || targetUserId === session.userId) {
      return errorResponse('请选择有效用户');
    }

    const targetUser = await c.env.DB.prepare(
      `SELECT id, username, display_name, avatar_key
       FROM users
       WHERE id = ?
         AND is_disabled = 0
         AND deleted_at IS NULL
       LIMIT 1`
    )
      .bind(targetUserId)
      .all();

    if (!targetUser.results[0]) {
      return errorResponse('目标用户不存在', 404);
    }

    const canDm = await canUsersDirectMessage(c.env.DB, session.userId, targetUserId);
    if (!canDm) {
      return errorResponse('仅支持与同组或管理员成员发起私聊', 403);
    }

    const channel = await ensureDmChannel(c.env.DB, session.userId, targetUserId);
    return c.json({
      dm: {
        id: Number(channel.id),
        kind: 'dm',
        name: channel.dm_key,
        otherUser: {
          id: Number(targetUser.results[0].id),
          username: targetUser.results[0].username,
          displayName: targetUser.results[0].display_name,
          avatarUrl: targetUser.results[0].avatar_key
            ? `/files/${encodeURIComponent(targetUser.results[0].avatar_key)}`
            : ''
        }
      }
    });
  });

  // 删除私聊会话（私聊双方均可删除，并一并清空历史聊天记录）
  app.delete('/api/dm/:id', async (c) => {
    const session = c.get('session');
    const channelId = Number(c.req.param('id'));
    if (!Number.isFinite(channelId) || channelId <= 0) {
      return errorResponse('私聊会话不存在', 404);
    }

    const channel = await c.env.DB.prepare(
      `SELECT id, kind, dm_key FROM channels WHERE id = ? AND kind = 'dm' AND deleted_at IS NULL LIMIT 1`
    ).bind(channelId).first();

    if (!channel) {
      return errorResponse('私聊会话不存在', 404);
    }

    if (!session.isAdmin) {
      const membership = await getChannelMembership(c.env.DB, channelId, session.userId);
      if (!membership) {
        return errorResponse('无权删除该私聊会话', 403);
      }
    }

    // 批量软删除私聊频道、清空该私聊的历史消息并重置已读状态
    await c.env.DB.batch([
      c.env.DB.prepare(
        `UPDATE messages
         SET deleted_at = CURRENT_TIMESTAMP
         WHERE channel_id = ? AND deleted_at IS NULL`
      ).bind(channelId),
      c.env.DB.prepare(
        `UPDATE message_reads
         SET last_read_message_id = 0, updated_at = CURRENT_TIMESTAMP
         WHERE channel_id = ?`
      ).bind(channelId),
      c.env.DB.prepare(
        `UPDATE channels
         SET deleted_at = CURRENT_TIMESTAMP, pinned_message_id = NULL
         WHERE id = ? AND kind = 'dm' AND deleted_at IS NULL`
      ).bind(channelId)
    ]);

    return c.json({ ok: true });
  });

  app.get('/api/admin/dms', async (c) => {
    const dms = await listAdminDms(c.env.DB);
    return c.json({ dms });
  });
}
