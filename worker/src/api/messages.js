import { listMessages, getMessageById } from '../data/messages.js';
import { markRoomRead } from '../data/unread.js';
import {
  toggleMessageReaction,
  getReactionsForMessages,
  setChannelPinnedMessage,
  getChannelPinnedMessage,
  MAX_REACTION_LENGTH
} from '../data/reactions.js';
import { authorizeRoom, isRoomKind, authorizeChannelManagement } from '../room-access.js';
import { errorResponse, parseJsonRequest, sanitizeLimit } from '../utils.js';

export function registerMessageRoutes(app) {
  app.get('/api/messages', async (c) => {
    const session = c.get('session');
    const kind = c.req.query('kind');
    const roomId = Number(c.req.query('roomId'));
    const before = c.req.query('before');
    const limit = sanitizeLimit(c.req.query('limit'));

    if (!isRoomKind(kind) || !Number.isInteger(roomId) || roomId <= 0) {
      return errorResponse('参数无效');
    }

    const access = await authorizeRoom(c.env.DB, session, kind, roomId);

    if (!access.ok) {
      return errorResponse('无权访问该会话', 403);
    }

    const [rawMessages, peerReadRow, peerMessageRow, myReadRow, pinnedMessage] = await Promise.all([
      listMessages(c.env, roomId, before, limit),
      c.env.DB.prepare(
        `SELECT COALESCE(MAX(last_read_message_id), 0) AS max_peer_read_id
         FROM message_reads
         WHERE channel_id = ? AND user_id != ?`
      ).bind(roomId, session.userId).first(),
      c.env.DB.prepare(
        `SELECT id AS max_peer_sent_id
         FROM messages
         WHERE channel_id = ? AND sender_id != ? AND deleted_at IS NULL
         ORDER BY id DESC LIMIT 1`
      ).bind(roomId, session.userId).first(),
      c.env.DB.prepare(
        `SELECT last_read_message_id FROM message_reads WHERE channel_id = ? AND user_id = ?`
      ).bind(roomId, session.userId).first(),
      getChannelPinnedMessage(c.env, roomId)
    ]);

    const maxPeerReadMessageId = Math.max(
      Number(peerReadRow?.max_peer_read_id || 0),
      Number(peerMessageRow?.max_peer_sent_id || 0)
    );
    const myLastReadMessageId = Number(myReadRow?.last_read_message_id || 0);

    const messageIds = rawMessages.map(m => m.id);
    const reactionsMap = await getReactionsForMessages(c.env.DB, messageIds, session.userId);

    const messages = rawMessages.map(msg => ({
      ...msg,
      reactions: reactionsMap[msg.id] || []
    }));

    await markRoomRead(c.env.DB, {
      channelId: roomId,
      userId: session.userId
    });

    return c.json({
      room: {
        id: Number(access.room.id),
        kind: access.room.kind,
        name: access.room.name,
        description: access.room.description
      },
      messages,
      maxPeerReadMessageId,
      myLastReadMessageId,
      pinnedMessage
    });
  });

  // Toggle emoji reaction on message
  app.post('/api/messages/:id/reactions', async (c) => {
    const session = c.get('session');
    const messageId = Number(c.req.param('id'));
    const payload = await parseJsonRequest(c.req.raw);
    const reaction = String(payload.reaction || '').trim();

    if (!messageId || !reaction) {
      return errorResponse('参数无效');
    }
    if (reaction.length > MAX_REACTION_LENGTH) {
      return errorResponse('表情长度超出限制', 400);
    }

    const message = await getMessageById(c.env, messageId);
    if (!message) {
      return errorResponse('消息不存在', 404);
    }

    const access = await authorizeRoom(c.env.DB, session, 'public', message.channelId || 1);
    // Try generic authorization if room is private or dm
    if (!access.ok) {
      const channel = await c.env.DB.prepare(`SELECT kind FROM channels WHERE id = ? LIMIT 1`).bind(message.channelId).first();
      const directAccess = await authorizeRoom(c.env.DB, session, channel?.kind || 'private', message.channelId);
      if (!directAccess.ok) {
        return errorResponse('无权对此消息表态', 403);
      }
    }

    const result = await toggleMessageReaction(c.env.DB, {
      messageId,
      userId: session.userId,
      reaction
    });

    const reactionsMap = await getReactionsForMessages(c.env.DB, [messageId], session.userId);
    const reactions = reactionsMap[messageId] || [];

    return c.json({ ok: true, result, reactions });
  });

  // Pin or unpin a message in room
  app.post('/api/channels/:id/pin', async (c) => {
    const session = c.get('session');
    const channelId = Number(c.req.param('id'));
    const payload = await parseJsonRequest(c.req.raw);
    const messageId = payload.messageId ? Number(payload.messageId) : null;

    if (!channelId) {
      return errorResponse('参数无效');
    }

    const channel = await c.env.DB.prepare(`SELECT id, kind FROM channels WHERE id = ? AND deleted_at IS NULL LIMIT 1`).bind(channelId).first();
    if (!channel) return errorResponse('未找到群组或会话', 404);

    // DM 会话双方成员可置顶；群组/公开频道仅群主或全局管理员可管理。
    if (channel.kind === 'dm') {
      const access = await authorizeRoom(c.env.DB, session, channel.kind, channelId);
      if (!access.ok) return errorResponse('无权管理该会话', 403);
    } else {
      const management = await authorizeChannelManagement(c.env.DB, session, channelId);
      if (!management.ok) return errorResponse('无权管理该会话', 403);
    }

    // 校验目标消息属于当前房间且未被删除，防止把其他房间的消息置顶并泄露内容。
    if (messageId) {
      const target = await getMessageById(c.env, messageId);
      if (!target || Number(target.channelId || 0) !== channelId) {
        return errorResponse('消息不存在或已被删除', 404);
      }
    }

    await setChannelPinnedMessage(c.env.DB, channelId, messageId);
    const pinnedMessage = messageId ? await getMessageById(c.env, messageId) : null;

    return c.json({ ok: true, channelId, pinnedMessage });
  });

  // Search messages in public channel
  app.get('/api/messages/search', async (c) => {
    const session = c.get('session');
    const roomId = Number(c.req.query('roomId'));
    const query = String(c.req.query('q') || '').trim();

    if (!roomId || !query) {
      return c.json({ messages: [] });
    }

    const access = await authorizeRoom(c.env.DB, session, 'public', roomId);
    if (!access.ok) {
      return errorResponse('无权访问该会话', 403);
    }

    const { results } = await c.env.DB.prepare(`
      SELECT m.id, m.content, m.created_at, m.sender_id, u.display_name AS sender_name, u.username AS sender_username
      FROM messages m
      LEFT JOIN users u ON u.id = m.sender_id
      WHERE m.channel_id = ? AND m.deleted_at IS NULL AND m.content LIKE ?
      ORDER BY m.id DESC LIMIT 50
    `).bind(roomId, `%${query}%`).all();

    const messages = (results || []).map(row => ({
      id: Number(row.id),
      content: row.content,
      createdAt: row.created_at,
      sender: {
        id: Number(row.sender_id),
        displayName: row.sender_name || '成员',
        username: row.sender_username || ''
      }
    }));

    return c.json({ messages });
  });

  app.post('/api/messages/read', async (c) => {
    const session = c.get('session');
    const payload = await parseJsonRequest(c.req.raw);
    const kind = String(payload.kind || '');
    const roomId = Number(payload.roomId);
    const messageId = payload.messageId === undefined ? null : Number(payload.messageId);

    if (
      !isRoomKind(kind) ||
      !Number.isInteger(roomId) ||
      roomId <= 0 ||
      (messageId !== null && (!Number.isInteger(messageId) || messageId <= 0))
    ) {
      return errorResponse('参数无效');
    }

    const access = await authorizeRoom(c.env.DB, session, kind, roomId);

    if (!access.ok) {
      return errorResponse('无权访问该会话', 403);
    }

    const lastReadMessageId = await markRoomRead(c.env.DB, {
      channelId: roomId,
      userId: session.userId,
      messageId
    });

    return c.json({ ok: true, lastReadMessageId });
  });
}
