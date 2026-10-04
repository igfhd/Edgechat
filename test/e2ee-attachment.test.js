import assert from 'node:assert/strict';
import test from 'node:test';
import {
  decryptAttachmentBytes,
  encryptAttachmentFile
} from '../frontend/src/crypto/attachment-cipher.js';
import {
  decryptDmPayload,
  encryptDmPayload
} from '../frontend/src/crypto/message-cipher.js';
import {
  exportPublicKey,
  generateIdentityKeyPair
} from '../frontend/src/crypto/x25519.js';

test('E2EE Attachment encryption, decryption and authentication', async () => {
  const originalContent = 'Top Secret Research PDF content: 1234567890 🔒 🚀';
  const originalBytes = new TextEncoder().encode(originalContent);
  const fakeFile = new File([originalBytes], 'confidential.txt', { type: 'text/plain' });

  // 1. Client encrypts the file before upload
  const encResult = await encryptAttachmentFile(fakeFile);
  assert.ok(encResult.encryptedBlob);
  assert.ok(encResult.fileKeyBase64);
  assert.ok(encResult.nonceBase64);
  assert.equal(encResult.originalName, 'confidential.txt');
  assert.equal(encResult.originalType, 'text/plain');

  const encryptedArrayBuffer = await encResult.encryptedBlob.arrayBuffer();
  assert.notDeepEqual(new Uint8Array(encryptedArrayBuffer), originalBytes);

  // 2. Client decrypts the file bytes
  const decryptedBytes = await decryptAttachmentBytes(
    encryptedArrayBuffer,
    encResult.fileKeyBase64,
    encResult.nonceBase64
  );
  assert.deepEqual(decryptedBytes, originalBytes);
  assert.equal(new TextDecoder().decode(decryptedBytes), originalContent);

  // 3. Tampering with ciphertext fails decryption
  const tamperedBytes = new Uint8Array(encryptedArrayBuffer);
  tamperedBytes[0] ^= 0xff;
  await assert.rejects(async () => {
    await decryptAttachmentBytes(tamperedBytes, encResult.fileKeyBase64, encResult.nonceBase64);
  });
});

test('Full E2EE Message with Encrypted Attachment roundtrip', async () => {
  const aliceKeyPair = await generateIdentityKeyPair();
  const bobKeyPair = await generateIdentityKeyPair();

  const alicePubBase64 = await exportPublicKey(aliceKeyPair.publicKey);
  const bobPubBase64 = await exportPublicKey(bobKeyPair.publicKey);

  // 1. Alice encrypts an image attachment
  const imagePayload = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
  const imageFile = new File([imagePayload], 'secret.png', { type: 'image/png' });
  const encryptedFileMeta = await encryptAttachmentFile(imageFile);

  const attachmentPayload = {
    key: '1/secret-image.png',
    name: encryptedFileMeta.originalName,
    type: encryptedFileMeta.originalType,
    size: encryptedFileMeta.originalSize,
    url: '/files/1%2Fsecret-image.png',
    isE2ee: true,
    fileKey: encryptedFileMeta.fileKeyBase64,
    nonce: encryptedFileMeta.nonceBase64
  };

  // 2. Alice sends E2EE message with attachment payload
  const envelope = await encryptDmPayload({
    senderId: 1,
    senderKeyPair: aliceKeyPair,
    recipientId: 2,
    recipientPublicKeyBase64: bobPubBase64,
    senderPublicKeyBase64: alicePubBase64,
    roomId: 10,
    text: 'Please check this confidential diagram',
    attachment: attachmentPayload
  });

  // 3. Bob receives and decrypts message
  const decryptedMessage = await decryptDmPayload({
    currentUserId: 2,
    currentUserPrivateKey: bobKeyPair.privateKey,
    roomId: 10,
    envelopeContent: envelope
  });

  assert.equal(decryptedMessage.text, 'Please check this confidential diagram');
  assert.ok(decryptedMessage.attachment);
  assert.equal(decryptedMessage.attachment.isE2ee, true);
  assert.equal(decryptedMessage.attachment.fileKey, encryptedFileMeta.fileKeyBase64);

  // 4. Bob downloads encrypted blob and decrypts using fileKey and nonce from message
  const encryptedFileBytes = await encryptedFileMeta.encryptedBlob.arrayBuffer();
  const decryptedFileBytes = await decryptAttachmentBytes(
    encryptedFileBytes,
    decryptedMessage.attachment.fileKey,
    decryptedMessage.attachment.nonce
  );

  assert.deepEqual(decryptedFileBytes, imagePayload);
});
