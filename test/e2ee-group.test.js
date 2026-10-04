import assert from 'node:assert/strict';
import test from 'node:test';
import {
  decryptMessagePayload,
  encryptMultiRecipientPayload
} from '../frontend/src/crypto/message-cipher.js';
import {
  exportPublicKey,
  generateIdentityKeyPair
} from '../frontend/src/crypto/x25519.js';

test('Multi-recipient Private Group Channel E2EE message flow', async () => {
  // 1. Create keypairs for 4 members: Alice(1), Bob(2), Charlie(3), Dave(4) + 1 outsider Eve(5)
  const aliceKeyPair = await generateIdentityKeyPair();
  const bobKeyPair = await generateIdentityKeyPair();
  const charlieKeyPair = await generateIdentityKeyPair();
  const daveKeyPair = await generateIdentityKeyPair();
  const eveKeyPair = await generateIdentityKeyPair();

  const alicePub = await exportPublicKey(aliceKeyPair.publicKey);
  const bobPub = await exportPublicKey(bobKeyPair.publicKey);
  const charliePub = await exportPublicKey(charlieKeyPair.publicKey);
  const davePub = await exportPublicKey(daveKeyPair.publicKey);

  const recipientKeysMap = {
    1: alicePub,
    2: bobPub,
    3: charliePub,
    4: davePub
  };

  const channelRoomId = 101;
  const originalText = 'Welcome to confidential engineering group channel! 🛡️';

  // 2. Alice encrypts group message
  const groupEnvelope = await encryptMultiRecipientPayload({
    senderId: 1,
    senderKeyPair: aliceKeyPair,
    senderPublicKeyBase64: alicePub,
    recipientKeysMap,
    roomId: channelRoomId,
    roomKind: 'channel',
    text: originalText,
    attachment: {
      key: '1/secret-spec.pdf',
      name: 'spec.pdf',
      type: 'application/pdf',
      size: 4096,
      url: '/files/1%2Fsecret-spec.pdf'
    }
  });

  assert.ok(groupEnvelope.startsWith('edgechat:e2ee:v1:'));

  // 3. Verify Alice (sender) can decrypt her own sent group message
  const aliceDecrypted = await decryptMessagePayload({
    currentUserId: 1,
    currentUserPrivateKey: aliceKeyPair.privateKey,
    roomId: channelRoomId,
    roomKind: 'channel',
    envelopeContent: groupEnvelope
  });
  assert.equal(aliceDecrypted.text, originalText);
  assert.equal(aliceDecrypted.attachment.name, 'spec.pdf');

  // 4. Verify Bob can decrypt
  const bobDecrypted = await decryptMessagePayload({
    currentUserId: 2,
    currentUserPrivateKey: bobKeyPair.privateKey,
    roomId: channelRoomId,
    roomKind: 'channel',
    envelopeContent: groupEnvelope
  });
  assert.equal(bobDecrypted.text, originalText);
  assert.equal(bobDecrypted.attachment.name, 'spec.pdf');

  // 5. Verify Charlie can decrypt
  const charlieDecrypted = await decryptMessagePayload({
    currentUserId: 3,
    currentUserPrivateKey: charlieKeyPair.privateKey,
    roomId: channelRoomId,
    roomKind: 'channel',
    envelopeContent: groupEnvelope
  });
  assert.equal(charlieDecrypted.text, originalText);

  // 6. Verify Dave can decrypt
  const daveDecrypted = await decryptMessagePayload({
    currentUserId: 4,
    currentUserPrivateKey: daveKeyPair.privateKey,
    roomId: channelRoomId,
    roomKind: 'channel',
    envelopeContent: groupEnvelope
  });
  assert.equal(daveDecrypted.text, originalText);

  // 7. Verify Eve (outsider) CANNOT decrypt
  await assert.rejects(async () => {
    await decryptMessagePayload({
      currentUserId: 5,
      currentUserPrivateKey: eveKeyPair.privateKey,
      roomId: channelRoomId,
      roomKind: 'channel',
      envelopeContent: groupEnvelope
    });
  }, /not a designated recipient/);
});
