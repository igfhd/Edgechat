import assert from 'node:assert/strict';
import test from 'node:test';
import {
  decryptDmPayload,
  encryptDmPayload
} from '../frontend/src/crypto/message-cipher.js';
import {
  exportPublicKey,
  generateIdentityKeyPair
} from '../frontend/src/crypto/x25519.js';
import { isE2eeEnvelope, unwrapEnvelope } from '../frontend/src/crypto/utils.js';

test('E2EE Dual Key-Wrapped DM encryption: both sender and recipient can decrypt', async () => {
  // Alice (id: 1) & Bob (id: 2)
  const aliceKeyPair = await generateIdentityKeyPair();
  const bobKeyPair = await generateIdentityKeyPair();

  const alicePubBase64 = await exportPublicKey(aliceKeyPair.publicKey);
  const bobPubBase64 = await exportPublicKey(bobKeyPair.publicKey);

  const roomId = 42;
  const originalText = 'Hello Bob! This is an E2EE encrypted message! 🔒';
  const originalAttachment = {
    key: '1/test-uuid.pdf',
    name: 'secret.pdf',
    type: 'application/pdf',
    size: 1024
  };

  // Alice encrypts for Bob
  const envelope = await encryptDmPayload({
    senderId: 1,
    senderKeyPair: aliceKeyPair,
    recipientId: 2,
    recipientPublicKeyBase64: bobPubBase64,
    senderPublicKeyBase64: alicePubBase64,
    roomId,
    text: originalText,
    attachment: originalAttachment
  });

  assert.equal(isE2eeEnvelope(envelope), true);
  const unwrapped = unwrapEnvelope(envelope);
  assert.equal(unwrapped.v, 1);
  assert.equal(unwrapped.senderId, 1);
  assert.ok(unwrapped.keys['1']); // Alice's wrapped message key
  assert.ok(unwrapped.keys['2']); // Bob's wrapped message key

  // Bob (recipient) decrypts
  const bobDecrypted = await decryptDmPayload({
    currentUserId: 2,
    currentUserPrivateKey: bobKeyPair.privateKey,
    roomId,
    envelopeContent: envelope
  });
  assert.equal(bobDecrypted.decrypted, true);
  assert.equal(bobDecrypted.text, originalText);
  assert.deepEqual(bobDecrypted.attachment, originalAttachment);

  // Alice (sender) can also decrypt her own sent message from history!
  const aliceDecrypted = await decryptDmPayload({
    currentUserId: 1,
    currentUserPrivateKey: aliceKeyPair.privateKey,
    roomId,
    envelopeContent: envelope
  });
  assert.equal(aliceDecrypted.decrypted, true);
  assert.equal(aliceDecrypted.text, originalText);
  assert.deepEqual(aliceDecrypted.attachment, originalAttachment);

  // Eve (id: 3) attempts to decrypt
  const eveKeyPair = await generateIdentityKeyPair();
  await assert.rejects(async () => {
    await decryptDmPayload({
      currentUserId: 3,
      currentUserPrivateKey: eveKeyPair.privateKey,
      roomId,
      envelopeContent: envelope
    });
  });
});

test('E2EE plaintext fallback handles non-envelope messages gracefully', async () => {
  const bobKeyPair = await generateIdentityKeyPair();
  const plainMessage = 'This is a legacy plain text message';
  const result = await decryptDmPayload({
    currentUserId: 2,
    currentUserPrivateKey: bobKeyPair.privateKey,
    roomId: 1,
    envelopeContent: plainMessage
  });

  assert.equal(result.decrypted, false);
  assert.equal(result.isE2ee, false);
  assert.equal(result.text, plainMessage);
});
