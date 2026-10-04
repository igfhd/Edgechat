import api from '../api.js';
import { isRoomE2ee } from './useChatRoom.js';
import { decryptAttachmentBytes, encryptAttachmentFile } from '../crypto/attachment-cipher.js';
import { getOrCreateIdentityKeyPair } from '../crypto/keystore.js';
import { encryptDmPayload, encryptMultiRecipientPayload } from '../crypto/message-cipher.js';

/**
 * 下载并解密（若是端到端加密）源消息附件，返回纯净的 File 对象
 */
export async function downloadAndDecryptAttachment(attachment, roomApi = api) {
  if (!attachment) return null;

  const rawUrl = roomApi.getFileUrl(attachment.key || attachment.url);
  if (!rawUrl) {
    throw new Error(`无法获取附件下载链接: ${attachment.name || '未知文件'}`);
  }

  const res = await fetch(rawUrl);
  if (!res.ok) {
    throw new Error(`下载附件失败 (${res.status}): ${attachment.name || '未知文件'}`);
  }

  const isEncrypted = Boolean(attachment.isE2ee || attachment.fileKey);
  let fileDataBlob;

  if (isEncrypted && attachment.fileKey && attachment.nonce) {
    const encBuffer = await res.arrayBuffer();
    const decryptedBytes = await decryptAttachmentBytes(
      encBuffer,
      attachment.fileKey,
      attachment.nonce
    );
    fileDataBlob = new Blob([decryptedBytes], {
      type: attachment.type || 'application/octet-stream'
    });
  } else {
    fileDataBlob = await res.blob();
  }

  const parsedDuration = attachment.duration ? Math.max(1, Math.round(attachment.duration)) : (Number(attachment.name?.match(/^voice_(\d+)_/)?.[1]) || 1);
  const fileName = attachment.name || (attachment.isVoice ? `voice_${parsedDuration}_${Date.now()}.webm` : 'attachment');
  const fileObj = new File([fileDataBlob], fileName, {
    type: attachment.type || fileDataBlob.type || 'application/octet-stream'
  });

  return {
    fileObj,
    isVoice: Boolean(attachment.isVoice),
    duration: parsedDuration || undefined
  };
}

/**
 * 针对目标会话上传/加密附件，返回目标会话合法的 attachment 对象
 */
export async function uploadAttachmentForTargetRoom(fileInfo, targetRoom, roomApi = api) {
  if (!fileInfo?.fileObj) return null;

  const { fileObj, isVoice, duration } = fileInfo;
  const targetIsE2ee = isRoomE2ee(targetRoom);

  if (targetIsE2ee) {
    const encResult = await encryptAttachmentFile(fileObj);
    const payload = await roomApi.uploadFile(encResult.encryptedBlob, true, encResult.originalName);
    return {
      key: payload.file.key,
      name: encResult.originalName,
      type: encResult.originalType,
      size: encResult.originalSize,
      url: payload.file.url,
      isE2ee: true,
      fileKey: encResult.fileKeyBase64,
      nonce: encResult.nonceBase64,
      ...(isVoice ? { isVoice: true, duration: duration || 1 } : {})
    };
  }

  const payload = await roomApi.uploadFile(fileObj);
  return {
    ...payload.file,
    ...(isVoice ? { isVoice: true, duration: duration || 1 } : {})
  };
}

/**
 * 通过临时或活跃 WebSocket 发送消息包到指定房间
 */
export async function sendPayloadToRoom({ targetRoom, content, attachment, session, roomApi = api }) {
  if (!targetRoom?.id || !targetRoom.kind) {
    throw new Error('目标会话无效');
  }

  const targetIsE2ee = isRoomE2ee(targetRoom);
  let contentToSend = content || '';

  if (targetIsE2ee && session?.userId) {
    const senderKeyInfo = await getOrCreateIdentityKeyPair(session.userId);

    if (targetRoom.kind === 'dm') {
      const targetUserId = targetRoom.otherUser?.id || (Number(targetRoom.id) !== Number(session.userId) ? Number(targetRoom.id) : null);
      if (!targetUserId) {
        throw new Error('无法识别私聊目标用户');
      }

      const keyRes = await roomApi.getUserIdentityKey(targetUserId);
      const recipientPubKey = keyRes?.key?.publicKey;
      if (!recipientPubKey) {
        throw new Error('目标用户尚未生成端到端加密公钥，无法向其发送加密消息');
      }

      contentToSend = await encryptDmPayload({
        senderId: session.userId,
        senderKeyPair: senderKeyInfo.keyPair,
        recipientId: targetUserId,
        recipientPublicKeyBase64: recipientPubKey,
        senderPublicKeyBase64: senderKeyInfo.publicKeyBase64,
        roomId: targetRoom.id,
        text: content || '',
        attachment: attachment || null
      });
    } else if (targetRoom.kind === 'channel') {
      const membersRes = await roomApi.getChannelMembers(targetRoom.id);
      const memberIds = (membersRes?.members || [])
        .map((m) => Number(m.userId || m.id))
        .filter(Boolean);

      if (memberIds.length > 0) {
        const batchRes = await roomApi.getBatchUserIdentityKeys(memberIds);
        const recipientKeysMap = {};
        for (const [uid, keyData] of Object.entries(batchRes?.keys || {})) {
          if (keyData?.publicKey) {
            recipientKeysMap[Number(uid)] = keyData.publicKey;
          }
        }
        if (senderKeyInfo.publicKeyBase64) {
          recipientKeysMap[Number(session.userId)] = senderKeyInfo.publicKeyBase64;
        }

        contentToSend = await encryptMultiRecipientPayload({
          senderId: session.userId,
          senderKeyPair: senderKeyInfo.keyPair,
          senderPublicKeyBase64: senderKeyInfo.publicKeyBase64,
          recipientKeysMap,
          roomId: targetRoom.id,
          roomKind: 'channel',
          text: content || '',
          attachment: attachment || null
        });
      }
    }
  }

  // 建立一次性 WebSocket 连接派发消息
  const wsUrl = await roomApi.getRoomWebSocketUrl(targetRoom.kind, targetRoom.id);
  const socket = new WebSocket(wsUrl);

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      try { socket.close(); } catch {}
      reject(new Error('连接目标会话超时，请重试'));
    }, 10000);

    socket.addEventListener('open', () => {
      clearTimeout(timeout);
      resolve();
    });

    socket.addEventListener('error', () => {
      clearTimeout(timeout);
      reject(new Error('无法连接至目标会话服务器'));
    });
  });

  socket.send(JSON.stringify({
    type: 'send',
    content: contentToSend,
    attachment: attachment || null
  }));

  // 预留足够时间确保 WebSocket 帧冲刷完成
  await new Promise((resolve) => setTimeout(resolve, 200));
  try {
    socket.close(1000, 'forward_complete');
  } catch {}
}

/**
 * 完整转发一组消息到指定会话
 */
export async function executeForwardMessages({
  messages = [],
  targetRoom,
  commentText = '',
  session,
  onProgress = () => {},
  roomApi = api
}) {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error('没有可转发的消息');
  }
  if (!targetRoom) {
    throw new Error('请选择转发目标会话');
  }

  // 如果有附言，先发送附言
  if (commentText?.trim()) {
    onProgress({ current: 0, total: messages.length, status: '正在发送附言...' });
    await sendPayloadToRoom({
      targetRoom,
      content: commentText.trim(),
      attachment: null,
      session,
      roomApi
    });
  }

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const stepNumber = i + 1;
    const progressLabel = `正在转发 (${stepNumber}/${messages.length})`;

    let newAttachment = null;
    if (msg.attachment) {
      onProgress({
        current: stepNumber,
        total: messages.length,
        status: `${progressLabel}: 正在下载并解密附件...`
      });
      const fileInfo = await downloadAndDecryptAttachment(msg.attachment, roomApi);

      onProgress({
        current: stepNumber,
        total: messages.length,
        status: `${progressLabel}: 正在为目标会话加密并上传...`
      });
      newAttachment = await uploadAttachmentForTargetRoom(fileInfo, targetRoom, roomApi);
    }

    onProgress({
      current: stepNumber,
      total: messages.length,
      status: `${progressLabel}: 正在投递消息...`
    });

    await sendPayloadToRoom({
      targetRoom,
      content: msg.content || '',
      attachment: newAttachment,
      session,
      roomApi
    });
  }

  onProgress({ current: messages.length, total: messages.length, status: '转发完成' });
}
