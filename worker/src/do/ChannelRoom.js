import { MessageSubmissionError, submitRoomMessage } from '../message-submission.js';
import { deleteRoomMessage, MessageDeletionError } from '../message-deletion.js';
import { editRoomMessage, MessageEditingError } from '../message-editing.js';
import { submitExternalMessage } from '../external-message-submission.js';
import { forwardEdgeChatMessageToTelegram } from '../integrations/telegram/bridge.js';
import { authorizeRoom, authorizeChannelManagement } from '../room-access.js';
import { getMessageById } from '../data/messages.js';
import { validateSession } from '../session.js';
import { markRoomRead, listRoomMemberIds } from '../data/unread.js';
import { notifyUserInbox } from '../do-bridge.js';
import {
  toggleMessageReaction,
  getReactionsForMessages,
  setChannelPinnedMessage,
  getChannelPinnedMessage,
  MAX_REACTION_LENGTH
} from '../data/reactions.js';
import { projectUnreadMessage } from '../unread-projection.js';
import { isVerifiedInternalRequest, parseVerifiedPrincipal } from '../verified-identity.js';
import { padObjectToBucket } from '../traffic-obfuscation.js';

const MESSAGE_SIZE_LIMIT = 10 * 1024;

function socketMeta(token, principal, room) {
  return {
    token,
    principal,
    room
  };
}

function sendSocketError(ws, message) {
  try {
    ws.send(JSON.stringify({ type: 'error', error: message }));
  } catch {
    // Ignore broken sockets.
  }
}

function getMessageByteLength(message) {
  if (typeof message === 'string') {
    return new TextEncoder().encode(message).length;
  }
  if (message instanceof ArrayBuffer) {
    return message.byteLength;
  }
  if (ArrayBuffer.isView(message)) {
    return message.byteLength;
  }

  // 未知 WebSocket 消息类型无法可靠解析，按超大处理，避免绕过大小限制。
  return Number.MAX_SAFE_INTEGER;
}

function normalizeWebSocketMessage(message) {
  if (typeof message === 'string') {
    return message;
  }
  if (message instanceof ArrayBuffer) {
    return new TextDecoder().decode(message);
  }
  if (ArrayBuffer.isView(message)) {
    return new TextDecoder().decode(message);
  }
  return '';
}

export class ChannelRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.connections = new Map();
    this.groupCallParticipants = new Map();
    this.groupCallRevision = 0;

    for (const socket of this.state.getWebSockets()) {
      const meta = socket.deserializeAttachment();
      if (meta) {
        this.connections.set(socket, meta);
      }
    }
  }

  parsePayload(ws, message) {
    try {
      return JSON.parse(message);
    } catch {
      sendSocketError(ws, 'Invalid message payload');
      return null;
    }
  }

  async revalidateConnection(ws, meta, force = false) {
    if (!meta?.token) {
      return null;
    }

    const now = Date.now();
    if (!force && meta.validatedUntil && now < meta.validatedUntil) {
      return meta;
    }

    const auth = await validateSession(this.env, meta.token);
    if (!auth.ok) {
      this.closeUnauthorizedSocket(ws);
      return null;
    }

    const access = await authorizeRoom(
      this.env.DB,
      auth.session,
      meta.room.kind,
      meta.room.id
    );
    if (!access.ok) {
      this.closeUnauthorizedSocket(ws);
      return null;
    }

    const { room } = access;

    const nextMeta = socketMeta(
      meta.token,
      {
        userId: auth.session.userId,
        isAdmin: auth.session.isAdmin
      },
      room
    );
    nextMeta.validatedUntil = now + 60000;
    this.connections.set(ws, nextMeta);
    ws.serializeAttachment(nextMeta);
    return nextMeta;
  }

  closeUnauthorizedSocket(ws) {
    this.connections.delete(ws);
    try {
      ws.close(1008, 'Unauthorized');
    } catch {
      // Ignore broken sockets.
    }
  }

  async broadcast(packet) {
    const connections = [...this.connections.entries()];
    const validated = await Promise.all(
      connections.map(async ([socket, meta]) => ({
        socket,
        meta: await this.revalidateConnection(socket, meta)
      }))
    );

    for (const { socket, meta } of validated) {
      if (!meta) continue;
      try {
        socket.send(packet);
      } catch {
        this.connections.delete(socket);
      }
    }
  }

  runMessageProjections(room, message) {
    this.state.waitUntil(
      Promise.all([
        projectUnreadMessage(this.env, {
          room,
          senderId: message.sender.kind === 'local' ? message.sender.id : null,
          message
        }),
        forwardEdgeChatMessageToTelegram(this.env, { room, message })
      ])
    );
  }

  async receiveExternalMessage(request) {
    if (!isVerifiedInternalRequest(request)) {
      return new Response('Unauthorized', { status: 401 });
    }

    const payload = await request.json();
    const room = payload.room;
    if (room?.kind !== 'public' || !Number.isInteger(Number(room.id))) {
      return new Response('Invalid room', { status: 400 });
    }

    const result = await submitExternalMessage(this.env, { room, payload });
    if (result.created) {
      await this.broadcast(result.packet);
      this.runMessageProjections(room, result.message);
    }
    return Response.json({ ok: true, created: result.created, message: result.message });
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === '/external-message' && request.method === 'POST') {
      return this.receiveExternalMessage(request);
    }

    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected websocket', { status: 426 });
    }

    const token = url.searchParams.get('token') || '';
    const kind = url.searchParams.get('kind') || '';
    const roomId = Number(url.searchParams.get('id') || '');

    let principal = parseVerifiedPrincipal(request);
    if (!principal) {
      const auth = await validateSession(this.env, token);
      if (!auth.ok) {
        return new Response('Unauthorized', { status: 401 });
      }

      principal = {
        userId: auth.session.userId,
        isAdmin: auth.session.isAdmin
      };
    }

    const access = await authorizeRoom(this.env.DB, principal, kind, roomId);

    if (!access.ok) {
      return new Response('Forbidden', { status: 403 });
    }
    const { room } = access;

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.state.acceptWebSocket(server);
    const meta = socketMeta(token, principal, room);
    meta.validatedUntil = Date.now() + 60000;
    server.serializeAttachment(meta);
    this.connections.set(server, meta);

    const onlineUserIds = [
      ...new Set(Array.from(this.connections.values()).map((m) => Number(m.principal.userId)))
    ];

    server.send(
      JSON.stringify({
        type: 'ready',
        room: {
          id: Number(room.id),
          kind: room.kind,
          name: room.name
        },
        onlineUserIds
      })
    );

    // 群聊连接握手时，向新连接下发当前房间权威的会议参会状态
    if (room.kind !== 'dm') {
      server.send(
        JSON.stringify({
          type: 'call_signal',
          action: 'room_audio_state',
          callType: 'group',
          roomId: Number(room.id),
          roomKind: room.kind,
          roomAudioRevision: this.groupCallRevision,
          participants: Array.from(this.groupCallParticipants.values())
        })
      );
    }

    // Broadcast presence join to other room sockets
    this.broadcast(
      JSON.stringify({
        type: 'presence',
        userId: Number(principal.userId),
        online: true
      })
    );

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, message) {
    const meta = this.connections.get(ws);
    if (!meta) {
      return;
    }

    if (getMessageByteLength(message) > MESSAGE_SIZE_LIMIT) {
      sendSocketError(ws, `消息过大，最大 ${Math.round(MESSAGE_SIZE_LIMIT / 1024)}KB`);
      return;
    }

    const payload = this.parsePayload(ws, normalizeWebSocketMessage(message));
    if (!payload) {
      return;
    }

    if (payload.type === 'ping') {
      try {
        ws.send(JSON.stringify({ type: 'pong' }));
      } catch {
        // ignore
      }
      return;
    }

    if (payload.type === 'cover_traffic') {
      try {
        const dummyResponse = { type: 'cover_traffic' };
        const padded = padObjectToBucket(dummyResponse, 256);
        ws.send(padded);
      } catch {
        // ignore
      }
      return;
    }

    const SUPPORTED_TYPES = [
      'send',
      'delete_message',
      'edit_message',
      'typing',
      'cover_traffic',
      'call_signal',
      'mark_read',
      'toggle_reaction',
      'pin_message'
    ];

    if (!SUPPORTED_TYPES.includes(payload.type)) {
      sendSocketError(ws, '不支持的消息类型');
      return;
    }

    if (payload.type === 'call_signal') {
      const senderId = meta.principal?.userId;
      const isAdmin = Boolean(meta.principal?.isAdmin);
      if (!senderId) return;
      const packetObj = {
        type: 'call_signal',
        action: payload.action,
        callType: payload.callType || (meta.room?.kind === 'dm' ? 'dm' : 'group'),
        roomId: meta.room?.id,
        roomKind: meta.room?.kind,
        senderId,
        displayName: String(payload.displayName || '').trim(),
        avatarUrl: payload.avatarUrl || null,
        sessionId: payload.sessionId || null,
        trackName: payload.trackName || null,
        isMuted: Boolean(payload.isMuted),
        isSpeaking: Boolean(payload.isSpeaking),
        isHandRaised: Boolean(payload.isHandRaised),
        role: isAdmin ? 'admin' : 'member',
        targetUserId: payload.targetUserId || null,
        moderatorId: payload.moderatorId || senderId,
        moderatorName: payload.moderatorName || String(payload.displayName || '').trim(),
        data: payload.data || {}
      };

      // 客户端主动查询房间会议状态
      if (packetObj.action === 'query_room_audio_state') {
        ws.send(JSON.stringify({
          type: 'call_signal',
          action: 'room_audio_state',
          callType: 'group',
          roomId: Number(meta.room?.id),
          roomKind: meta.room?.kind,
          roomAudioRevision: this.groupCallRevision,
          participants: Array.from(this.groupCallParticipants.values())
        }));
        return;
      }

      // 维护群聊语音会议活跃参会者列表
      let groupStateChanged = false;
      if (packetObj.callType === 'group' && meta.room?.kind !== 'dm') {
        const uid = Number(senderId);
        if (packetObj.action === 'join' || packetObj.action === 'track_published') {
          this.groupCallParticipants.set(uid, {
            userId: uid,
            displayName: packetObj.displayName,
            avatarUrl: packetObj.avatarUrl,
            sessionId: packetObj.sessionId,
            trackName: packetObj.trackName,
            isMuted: packetObj.isMuted,
            isSpeaking: packetObj.isSpeaking,
            isHandRaised: packetObj.isHandRaised,
            role: packetObj.role
          });
          groupStateChanged = true;
        } else if (packetObj.action === 'leave' || packetObj.action === 'hangup') {
          this.groupCallParticipants.delete(uid);
          groupStateChanged = true;
        } else if (packetObj.action === 'mute_state') {
          const p = this.groupCallParticipants.get(uid);
          if (p) {
            p.isMuted = packetObj.isMuted;
            groupStateChanged = true;
          }
        } else if (packetObj.action === 'speaking_state') {
          const p = this.groupCallParticipants.get(uid);
          if (p) {
            p.isSpeaking = packetObj.isSpeaking;
            groupStateChanged = true;
          }
        } else if (packetObj.action === 'raise_hand') {
          const p = this.groupCallParticipants.get(uid);
          if (p) {
            p.isHandRaised = true;
            groupStateChanged = true;
          }
        } else if (packetObj.action === 'lower_hand') {
          const p = this.groupCallParticipants.get(uid);
          if (p) {
            p.isHandRaised = false;
            groupStateChanged = true;
          }
        } else if (packetObj.action === 'mute_member') {
          const targetId = Number(packetObj.targetUserId);
          const p = this.groupCallParticipants.get(targetId);
          if (p) {
            p.isMuted = true;
            groupStateChanged = true;
          }
        } else if (packetObj.action === 'kick_member') {
          const targetId = Number(packetObj.targetUserId);
          this.groupCallParticipants.delete(targetId);
          groupStateChanged = true;
        }

        if (groupStateChanged) {
          this.groupCallRevision += 1;
          packetObj.roomAudioRevision = this.groupCallRevision;
        }
      }

      const packet = JSON.stringify(packetObj);
      for (const [socket] of this.connections.entries()) {
        if (socket === ws) continue;
        try {
          socket.send(packet);
        } catch {
          this.connections.delete(socket);
        }
      }

      // 如果群会议状态发生了变更 (join/track_published/leave/hangup/kick)，广播全量 room_audio_state 给房间内所有人，保证状态强一致
      if (packetObj.callType === 'group' && meta.room?.kind !== 'dm' && ['join', 'track_published', 'leave', 'hangup', 'kick_member'].includes(packetObj.action)) {
        const statePacket = JSON.stringify({
          type: 'call_signal',
          action: 'room_audio_state',
          callType: 'group',
          roomId: Number(meta.room?.id),
          roomKind: meta.room?.kind,
          roomAudioRevision: this.groupCallRevision,
          participants: Array.from(this.groupCallParticipants.values())
        });
        for (const [socket] of this.connections.entries()) {
          try {
            socket.send(statePacket);
          } catch {
            this.connections.delete(socket);
          }
        }
      }

      // 针对私聊呼叫信令，通过 UserInbox 跨会话推送给目标用户，确保接收方在任何页面均可收到来电通知
      if (this.env?.DB && (packetObj.callType === 'dm' || meta.room?.kind === 'dm')) {
        this.state.waitUntil((async () => {
          try {
            let targetUid = Number(payload.targetUserId);
            if (!targetUid && meta.room?.id) {
              const memberIds = await listRoomMemberIds(this.env.DB, meta.room.id);
              targetUid = memberIds.find((id) => Number(id) !== Number(senderId));
            }
            if (targetUid) {
              await notifyUserInbox(this.env, targetUid, packetObj);
            }
          } catch (_err) {
            // Ignore background delivery failure
          }
        })());
      }
      return;
    }

    if (payload.type === 'typing') {
      const senderId = meta.principal?.userId;
      if (!senderId) return;
      const packet = JSON.stringify({
        type: 'typing',
        userId: senderId,
        displayName: String(payload.displayName || '').trim()
      });
      for (const [socket] of this.connections.entries()) {
        if (socket === ws) continue;
        try {
          socket.send(packet);
        } catch {
          this.connections.delete(socket);
        }
      }
      return;
    }

    try {
      const currentMeta = await this.revalidateConnection(ws, meta);
      if (!currentMeta) {
        return;
      }

      if (payload.type === 'mark_read') {
        const messageId = Number(payload.messageId || 0);
        if (messageId > 0 && currentMeta.principal?.userId) {
          const userId = Number(currentMeta.principal.userId);
          if (this.env?.DB) {
            void markRoomRead(this.env.DB, {
              channelId: Number(currentMeta.room.id),
              userId,
              messageId
            }).catch(() => {});
          }
          await this.broadcast(JSON.stringify({
            type: 'room_read',
            roomId: Number(currentMeta.room.id),
            userId,
            lastReadMessageId: messageId
          }));
        }
        return;
      }

      if (payload.type === 'toggle_reaction') {
        const messageId = Number(payload.messageId || 0);
        const reaction = String(payload.reaction || '').trim();
        if (messageId > 0 && reaction && currentMeta.principal?.userId && this.env?.DB) {
          if (reaction.length > MAX_REACTION_LENGTH) {
            sendSocketError(ws, '表情长度超出限制');
            return;
          }
          const userId = Number(currentMeta.principal.userId);
          // 校验目标消息属于当前房间且未被删除，防止跨房间越权写入反应。
          const target = await getMessageById(this.env, messageId);
          if (!target || Number(target.channelId || 0) !== Number(currentMeta.room.id)) {
            sendSocketError(ws, '消息不存在或已被删除');
            return;
          }
          await toggleMessageReaction(this.env.DB, { messageId, userId, reaction });
          const reactionsMap = await getReactionsForMessages(this.env.DB, [messageId]);
          await this.broadcast(JSON.stringify({
            type: 'message_reaction',
            roomId: Number(currentMeta.room.id),
            messageId,
            reactions: reactionsMap[messageId] || []
          }));
        }
        return;
      }

      if (payload.type === 'pin_message') {
        const messageId = payload.messageId ? Number(payload.messageId) : null;
        if (currentMeta.principal?.userId && this.env?.DB) {
          const roomId = Number(currentMeta.room.id);
          // DM 会话双方成员可置顶；群组/公开频道仅群主或全局管理员可管理。
          const kind = currentMeta.room.kind;
          const management =
            kind === 'dm'
              ? authorizeRoom(this.env.DB, currentMeta.principal, 'dm', roomId)
              : authorizeChannelManagement(this.env.DB, currentMeta.principal, roomId);
          if (!(await management).ok) {
            sendSocketError(ws, '无权管理该会话');
            return;
          }
          // 校验目标消息属于当前房间且未被删除，防止把其他房间的消息置顶并泄露内容。
          if (messageId) {
            const target = await getMessageById(this.env, messageId);
            if (!target || Number(target.channelId || 0) !== roomId) {
              sendSocketError(ws, '消息不存在或已被删除');
              return;
            }
          }
          await setChannelPinnedMessage(this.env.DB, roomId, messageId);
          const pinnedMessage = messageId ? await getChannelPinnedMessage(this.env, roomId) : null;
          await this.broadcast(JSON.stringify({
            type: 'room_pinned_message',
            roomId,
            pinnedMessage
          }));
        }
        return;
      }

      if (payload.type === 'delete_message') {
        const { packet } = await deleteRoomMessage(this.env, currentMeta, payload);
        await this.broadcast(packet);
        return;
      }

      if (payload.type === 'edit_message') {
        const { packet } = await editRoomMessage(this.env, currentMeta, payload);
        await this.broadcast(packet);
        return;
      }

      const { message: saved, packet } = await submitRoomMessage(
        this.env,
        currentMeta,
        payload
      );
      await this.broadcast(packet);

      // 发送者成功发出消息后，更新该发送者在房间内的已读位置并向其他连接广播 room_read
      if (this.env?.DB && currentMeta.principal?.userId && saved?.id) {
        const senderUid = Number(currentMeta.principal.userId);
        const mid = Number(saved.id);
        void markRoomRead(this.env.DB, {
          channelId: Number(currentMeta.room.id),
          userId: senderUid,
          messageId: mid
        }).catch(() => {});
        await this.broadcast(JSON.stringify({
          type: 'room_read',
          roomId: Number(currentMeta.room.id),
          userId: senderUid,
          lastReadMessageId: mid
        }));
      }

      // 未读与外部桥接都属于提交后投影，异步执行以缩短 WebSocket 发送链路。
      this.runMessageProjections(currentMeta.room, saved);
    } catch (error) {
      if (
        error instanceof MessageSubmissionError ||
        error instanceof MessageDeletionError ||
        error instanceof MessageEditingError
      ) {
        sendSocketError(ws, error.message);
        return;
      }
      console.error(JSON.stringify({
        message: 'room message action failed',
        roomId: Number(meta.room?.id || 0),
        error: error instanceof Error ? error.message : String(error)
      }));
      sendSocketError(ws, '消息操作失败');
    }
  }

  webSocketClose(ws) {
    const meta = this.connections.get(ws) || (typeof ws.deserializeAttachment === 'function' ? ws.deserializeAttachment() : null);
    this.connections.delete(ws);
    if (meta?.principal?.userId) {
      const userId = Number(meta.principal.userId);
      const stillConnected = Array.from(this.connections.values()).some(
        (m) => Number(m.principal?.userId) === userId
      );

      // 如果用户断开所有连接且处于群会议中，移除参会状态并广播
      if (!stillConnected && this.groupCallParticipants.has(userId)) {
        this.groupCallParticipants.delete(userId);
        if (meta.room?.kind !== 'dm') {
          this.groupCallRevision += 1;
          const statePacket = JSON.stringify({
            type: 'call_signal',
            action: 'room_audio_state',
            callType: 'group',
            roomId: Number(meta.room?.id),
            roomKind: meta.room?.kind,
            roomAudioRevision: this.groupCallRevision,
            participants: Array.from(this.groupCallParticipants.values())
          });
          for (const [socket] of this.connections.entries()) {
            try {
              socket.send(statePacket);
            } catch {
              this.connections.delete(socket);
            }
          }
        }
      }

      if (!stillConnected) {
        this.broadcast(
          JSON.stringify({
            type: 'presence',
            userId,
            online: false,
            lastActiveAt: new Date().toISOString()
          })
        );
      }
    }
  }

  webSocketError(ws) {
    this.webSocketClose(ws);
  }
}
