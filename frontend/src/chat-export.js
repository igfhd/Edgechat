import { formatLocalDateTime, parseUtcDate } from './date.js';
import { getOrCreateIdentityKeyPair } from './crypto/keystore.js';
import { decryptMessagePayload } from './crypto/message-cipher.js';
import { isE2eeEnvelope } from './crypto/utils.js';

export function formatByteSize(bytes) {
  const value = Number(bytes || 0);
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function sanitizeFileName(name) {
  return String(name || 'chat')
    .trim()
    .replace(/[\\/:*?"<>|]/g, '_')
    .slice(0, 50);
}

export async function processMessageForExport(message, room, session) {
  if (!message) return null;
  let content = message.content || '';
  let attachment = message.attachment || null;

  if (isE2eeEnvelope(content) && session?.userId) {
    try {
      const keyInfo = await getOrCreateIdentityKeyPair(session.userId);
      const decrypted = await decryptMessagePayload({
        currentUserId: session.userId,
        currentUserPrivateKey: keyInfo.keyPair.privateKey,
        roomId: room?.id || message.roomId,
        roomKind: room?.kind || 'dm',
        envelopeContent: content,
      });
      content = decrypted.text || '';
      if (decrypted.attachment) {
        attachment = decrypted.attachment;
      }
    } catch {
      content = '🔒 [端到端加密消息，当前密钥无法解密]';
    }
  }

  return {
    id: message.id,
    sender: {
      id: message.sender?.id,
      username: message.sender?.username || '',
      displayName: message.sender?.displayName || message.sender?.username || '用户',
      source: message.sender?.source || 'local',
    },
    content,
    attachment,
    createdAt: message.createdAt,
    editedAt: message.editedAt || null,
    isRecalled: Boolean(message.isRecalled),
    isE2ee: Boolean(message.isE2ee || isE2eeEnvelope(message.content)),
  };
}

export async function fetchAllDecryptedMessages({ room, session, api, onProgress }) {
  if (!room || !api) return [];
  const rawList = [];
  const seenIds = new Set();
  let beforeId = null;

  while (true) {
    onProgress?.({ stage: 'fetching', count: rawList.length });
    const payload = await api.getMessages(room.kind, room.id, beforeId);
    const batch = payload?.messages || [];
    if (batch.length === 0) {
      break;
    }

    let hasNew = false;
    for (const msg of batch) {
      const numId = Number(msg.id);
      if (!seenIds.has(numId)) {
        seenIds.add(numId);
        rawList.push(msg);
        hasNew = true;
      }
    }

    if (!hasNew) {
      break;
    }

    beforeId = batch[0]?.id;
    if (beforeId === undefined || beforeId === null) {
      break;
    }
  }

  onProgress?.({ stage: 'decrypting', count: rawList.length });
  const processed = [];
  for (let i = 0; i < rawList.length; i++) {
    const item = await processMessageForExport(rawList[i], room, session);
    if (item) {
      processed.push(item);
    }
  }

  // 严格按消息发送时间（正序升序）排序，时间相同时按 ID 升序，确保聊天顺序不乱
  processed.sort((a, b) => {
    const timeA = parseUtcDate(a.createdAt)?.getTime() || 0;
    const timeB = parseUtcDate(b.createdAt)?.getTime() || 0;
    if (timeA !== timeB) {
      return timeA - timeB;
    }
    return Number(a.id || 0) - Number(b.id || 0);
  });

  return processed;
}

export function formatAsPlainText(room, messages) {
  const roomName = room.displayName || room.name || '会话';
  const kindText = room.kind === 'dm' ? '私聊会话' : (room.isPrivate ? '私有群组' : '公开群组');
  const nowStr = formatLocalDateTime(new Date());

  const lines = [
    '================================================================',
    `会话名称：${roomName}`,
    `会话类型：${kindText}`,
    `导出时间：${nowStr}`,
    `消息总数：${messages.length} 条`,
    '================================================================',
    '',
  ];

  for (const msg of messages) {
    const timeStr = formatLocalDateTime(msg.createdAt);
    const senderName = msg.sender.displayName;
    const handle = msg.sender.username ? ` (@${msg.sender.username})` : '';
    const editedStr = msg.editedAt ? ' [已编辑]' : '';

    lines.push(`[${timeStr}] ${senderName}${handle}${editedStr}:`);
    if (msg.isRecalled) {
      lines.push('  [该消息已被撤回]');
    } else {
      if (msg.content) {
        lines.push(`  ${msg.content}`);
      }
      if (msg.attachment) {
        const att = msg.attachment;
        const sizeStr = formatByteSize(att.size);
        lines.push(`  [附件: ${att.name || '文件'} (${sizeStr})${att.url ? ` - ${att.url}` : ''}]`);
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}

export function formatAsJson(room, messages) {
  return JSON.stringify(
    {
      exportTime: new Date().toISOString(),
      room: {
        id: room.id,
        kind: room.kind,
        name: room.displayName || room.name || '',
        isPrivate: Boolean(room.isPrivate),
      },
      totalMessages: messages.length,
      messages,
    },
    null,
    2
  );
}

export function formatAsMarkdown(room, messages) {
  const roomName = room.displayName || room.name || '会话';
  const kindText = room.kind === 'dm' ? '私聊会话' : (room.isPrivate ? '私有群组' : '公开群组');
  const nowStr = formatLocalDateTime(new Date());

  const lines = [
    `# 📝 ${roomName} - 聊天记录导出`,
    '',
    `- **会话类型**: ${kindText}`,
    `- **导出时间**: ${nowStr}`,
    `- **消息总数**: ${messages.length} 条`,
    '',
    '---',
    '',
  ];

  for (const msg of messages) {
    const timeStr = formatLocalDateTime(msg.createdAt);
    const senderName = msg.sender.displayName;
    const handle = msg.sender.username ? ` (@${msg.sender.username})` : '';
    const editedStr = msg.editedAt ? ' *(已编辑)*' : '';

    lines.push(`### **${senderName}**${handle} · <small>${timeStr}</small>${editedStr}`);
    if (msg.isRecalled) {
      lines.push('> ⚠️ *该消息已被撤回*');
    } else {
      if (msg.content) {
        lines.push(msg.content);
      }
      if (msg.attachment) {
        const att = msg.attachment;
        const sizeStr = formatByteSize(att.size);
        if (att.url) {
          lines.push(`> 📎 **附件**: [${att.name || '文件'}](${att.url}) (${sizeStr})`);
        } else {
          lines.push(`> 📎 **附件**: ${att.name || '文件'} (${sizeStr})`);
        }
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}

export function downloadFile(content, fileName, mimeType) {
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function generateExportFileName(room, format) {
  const name = sanitizeFileName(room.displayName || room.name || 'chat');
  const d = new Date();
  const yyyy = d.getFullYear();
  const MM = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ext = format === 'json' ? 'json' : (format === 'md' ? 'md' : 'txt');
  return `Edgechat_${name}_${yyyy}${MM}${dd}_${hh}${mm}.${ext}`;
}
