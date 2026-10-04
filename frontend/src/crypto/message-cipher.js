import {
  base64ToBytes,
  bytesToBase64,
  isE2eeEnvelope,
  randomBytes,
  unwrapEnvelope,
  utf8Decode,
  utf8Encode,
  wrapEnvelope
} from './utils.js';
import {
  decryptAesGcm,
  deriveAesGcmKey,
  deriveSharedSecret,
  encryptAesGcm,
  exportPublicKey,
  generateIdentityKeyPair,
  importPublicKey
} from './x25519.js';

const AES_KEY_BYTES = 32;

export async function encryptMultiRecipientPayload({
  senderId,
  senderKeyPair,
  senderPublicKeyBase64,
  recipientKeysMap = {},
  roomId,
  roomKind = 'dm',
  text = '',
  attachment = null
}) {
  const normalizedSenderId = Number(senderId);
  const normalizedRoomId = Number(roomId);

  // 1. 生成单次消息对称密钥 (Message Key)
  const messageKeyBytes = randomBytes(AES_KEY_BYTES);
  const messageAesKey = await crypto.subtle.importKey(
    'raw',
    messageKeyBytes,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt']
  );

  // 2. 加密消息主体载荷
  const payloadData = {
    text: String(text || ''),
    attachment: attachment || null,
    timestamp: Date.now()
  };
  const plaintextBytes = utf8Encode(JSON.stringify(payloadData));
  const { ciphertext, nonce } = await encryptAesGcm(messageAesKey, plaintextBytes);

  // 3. 生成 Ephemeral 临时密钥对 (提供前向保密)
  const ephemeralKeyPair = await generateIdentityKeyPair();
  const ephemeralPublicKeyBase64 = await exportPublicKey(ephemeralKeyPair.publicKey);
  const salt = randomBytes(16);

  // 4. 汇总所有需要被包裹密钥的目标用户（发件人本人 + 所有收件人）
  const allRecipientKeys = { ...recipientKeysMap };
  if (!allRecipientKeys[normalizedSenderId]) {
    const myPubKeyBase64 = senderPublicKeyBase64 || (await exportPublicKey(senderKeyPair.publicKey));
    allRecipientKeys[normalizedSenderId] = myPubKeyBase64;
  }

  const keysDict = {};
  for (const [targetUserIdStr, pubKeyBase64] of Object.entries(allRecipientKeys)) {
    if (!pubKeyBase64) continue;
    const targetUserId = Number(targetUserIdStr);
    try {
      const targetPubKey = await importPublicKey(pubKeyBase64);
      const targetShared = await deriveSharedSecret(ephemeralKeyPair.privateKey, targetPubKey);
      const targetKeyAes = await deriveAesGcmKey(targetShared, {
        salt,
        info: `edgechat:e2ee:v1:${roomKind}:${normalizedRoomId}:user:${targetUserId}`
      });
      const { ciphertext: wrappedKey, nonce: keyNonce } = await encryptAesGcm(
        targetKeyAes,
        messageKeyBytes
      );
      keysDict[targetUserId] = {
        k: bytesToBase64(wrappedKey),
        n: bytesToBase64(keyNonce)
      };
    } catch (err) {
      console.warn(`Failed to wrap key for user ${targetUserId}:`, err);
    }
  }

  const envelope = wrapEnvelope({
    v: 1,
    senderId: normalizedSenderId,
    roomId: normalizedRoomId,
    roomKind,
    epk: ephemeralPublicKeyBase64,
    salt: bytesToBase64(salt),
    nonce: bytesToBase64(nonce),
    ct: bytesToBase64(ciphertext),
    keys: keysDict
  });

  return envelope;
}

export async function encryptDmPayload({
  senderId,
  senderKeyPair,
  recipientId,
  recipientPublicKeyBase64,
  senderPublicKeyBase64,
  roomId,
  text = '',
  attachment = null
}) {
  if (!recipientPublicKeyBase64) {
    throw new Error('Recipient identity public key is required for E2EE');
  }
  const recipientKeysMap = {
    [Number(recipientId)]: recipientPublicKeyBase64
  };
  if (senderId && (senderPublicKeyBase64 || senderKeyPair?.publicKeyBase64)) {
    recipientKeysMap[Number(senderId)] = senderPublicKeyBase64 || senderKeyPair?.publicKeyBase64;
  }
  return encryptMultiRecipientPayload({
    senderId,
    senderKeyPair,
    senderPublicKeyBase64,
    recipientKeysMap,
    roomId,
    roomKind: 'dm',
    text,
    attachment
  });
}

export async function decryptMessagePayload({
  currentUserId,
  currentUserPrivateKey,
  roomId,
  roomKind = 'dm',
  envelopeContent
}) {
  if (!isE2eeEnvelope(envelopeContent)) {
    return {
      text: String(envelopeContent || ''),
      attachment: null,
      decrypted: false,
      isE2ee: false
    };
  }

  const envelope = unwrapEnvelope(envelopeContent);
  if (!envelope || envelope.v !== 1 || !envelope.epk || !envelope.ct || !envelope.nonce || !envelope.salt || !envelope.keys) {
    throw new Error('Malformed E2EE message envelope');
  }

  const normalizedUserId = Number(currentUserId);
  const userKeyEntry = envelope.keys[normalizedUserId];
  if (!userKeyEntry?.k || !userKeyEntry?.n) {
    throw new Error('Current user is not a designated recipient for this E2EE message');
  }

  const effectiveKind = envelope.roomKind || roomKind || 'dm';
  const ephemeralPubKey = await importPublicKey(envelope.epk);
  const sharedSecret = await deriveSharedSecret(currentUserPrivateKey, ephemeralPubKey);
  const salt = base64ToBytes(envelope.salt, 'Envelope salt');
  try {
    const userKeyAes = await deriveAesGcmKey(sharedSecret, {
      salt,
      info: `edgechat:e2ee:v1:${effectiveKind}:${envelope.roomId || roomId}:user:${normalizedUserId}`
    });

    const wrappedKeyBytes = base64ToBytes(userKeyEntry.k, 'Wrapped key');
    const keyNonce = base64ToBytes(userKeyEntry.n, 'Key nonce');
    const messageKeyBytes = await decryptAesGcm(userKeyAes, wrappedKeyBytes, keyNonce);

    const messageAesKey = await crypto.subtle.importKey(
      'raw',
      messageKeyBytes,
      { name: 'AES-GCM' },
      false,
      ['decrypt']
    );

    const ciphertextBytes = base64ToBytes(envelope.ct, 'Ciphertext');
    const nonceBytes = base64ToBytes(envelope.nonce, 'Nonce');
    const plaintextBytes = await decryptAesGcm(messageAesKey, ciphertextBytes, nonceBytes);

    const parsedJson = JSON.parse(utf8Decode(plaintextBytes));
    return {
      text: parsedJson.text || '',
      attachment: parsedJson.attachment || null,
      timestamp: parsedJson.timestamp,
      decrypted: true,
      isE2ee: true
    };
  } catch (err) {
    if (err.name === 'OperationError' || String(err.message).includes('operation-specific')) {
      throw new Error('端到端加密消息解密失败（密钥不匹配或已被更新）');
    }
    throw err;
  }
}

export async function decryptDmPayload({
  currentUserId,
  currentUserPrivateKey,
  roomId,
  envelopeContent
}) {
  return decryptMessagePayload({
    currentUserId,
    currentUserPrivateKey,
    roomId,
    roomKind: 'dm',
    envelopeContent
  });
}
