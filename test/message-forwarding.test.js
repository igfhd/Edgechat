import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  downloadAndDecryptAttachment,
  uploadAttachmentForTargetRoom,
} from '../frontend/src/composables/useMessageForwarding.js';
import {
  encryptAttachmentFile,
} from '../frontend/src/crypto/attachment-cipher.js';

test('downloadAndDecryptAttachment decrypts E2EE attachment bytes in memory', async () => {
  const originalData = 'Confidential Report for Forwarding 🚀🔒';
  const originalBytes = new TextEncoder().encode(originalData);
  const sampleFile = new File([originalBytes], 'report.txt', { type: 'text/plain' });

  // 1. Prepare an E2EE encrypted attachment
  const encResult = await encryptAttachmentFile(sampleFile);
  const encryptedBytes = new Uint8Array(await encResult.encryptedBlob.arrayBuffer());

  const mockApi = {
    getFileUrl(key) {
      return `https://mock.storage/${key}`;
    }
  };

  // Mock global fetch for the attachment
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (url === 'https://mock.storage/enc_key_123') {
      return {
        ok: true,
        status: 200,
        async arrayBuffer() {
          return encryptedBytes.buffer;
        },
        async blob() {
          return new Blob([encryptedBytes]);
        }
      };
    }
    return { ok: false, status: 404 };
  };

  try {
    const sourceAttachment = {
      key: 'enc_key_123',
      name: 'report.txt',
      type: 'text/plain',
      size: sampleFile.size,
      isE2ee: true,
      fileKey: encResult.fileKeyBase64,
      nonce: encResult.nonceBase64
    };

    const downloaded = await downloadAndDecryptAttachment(sourceAttachment, mockApi);
    assert.ok(downloaded.fileObj);
    assert.equal(downloaded.fileObj.name, 'report.txt');
    assert.equal(downloaded.fileObj.type, 'text/plain');

    const decryptedContent = await downloaded.fileObj.text();
    assert.equal(decryptedContent, originalData);
    assert.equal(downloaded.isVoice, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('uploadAttachmentForTargetRoom re-encrypts media for E2EE room and uploads plain for public room', async () => {
  const fileContent = 'Data to be forwarded';
  const file = new File([new TextEncoder().encode(fileContent)], 'data.txt', { type: 'text/plain' });
  const fileInfo = { fileObj: file, isVoice: false };

  let uploadedIsE2ee = null;
  const mockApi = {
    async uploadFile(blob, isE2ee = false) {
      uploadedIsE2ee = isE2ee;
      return {
        file: {
          key: 'new_obj_key_789',
          name: 'data.txt',
          type: 'text/plain',
          size: blob.size,
          url: '/api/files/new_obj_key_789'
        }
      };
    }
  };

  // 1. Forward to an E2EE room (DM or Private Group)
  const e2eeRoom = { id: 2, kind: 'dm', otherUser: { id: 5 } };
  const targetAttachment = await uploadAttachmentForTargetRoom(fileInfo, e2eeRoom, mockApi);

  assert.equal(uploadedIsE2ee, true);
  assert.ok(targetAttachment.isE2ee);
  assert.ok(targetAttachment.fileKey);
  assert.ok(targetAttachment.nonce);
  assert.equal(targetAttachment.name, 'data.txt');

  // 2. Forward to a Public channel
  const publicRoom = { id: 1, kind: 'public', isPrivate: false };
  const publicAttachment = await uploadAttachmentForTargetRoom(fileInfo, publicRoom, mockApi);

  assert.equal(uploadedIsE2ee, false);
  assert.equal(publicAttachment.isE2ee, undefined);
  assert.equal(publicAttachment.key, 'new_obj_key_789');
});

test('Voice message forwarding retains isVoice and duration attributes', async () => {
  const voiceBytes = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]);
  const voiceFile = new File([voiceBytes], 'voice_note.webm', { type: 'audio/webm' });
  const fileInfo = { fileObj: voiceFile, isVoice: true, duration: 15 };

  const mockApi = {
    async uploadFile() {
      return {
        file: {
          key: 'voice_obj_key',
          name: 'voice_note.webm',
          type: 'audio/webm',
          size: 4,
          url: '/api/files/voice_obj_key'
        }
      };
    }
  };

  const publicRoom = { id: 1, kind: 'public' };
  const forwardedVoice = await uploadAttachmentForTargetRoom(fileInfo, publicRoom, mockApi);

  assert.equal(forwardedVoice.isVoice, true);
  assert.equal(forwardedVoice.duration, 15);
});

test('ChatPage and MessageContextMenu integrate forward actions and forward dialog', () => {
  const chatPage = readFileSync(new URL('../frontend/src/pages/ChatPage.vue', import.meta.url), 'utf8');
  const contextMenu = readFileSync(new URL('../frontend/src/components/chat/MessageContextMenu.vue', import.meta.url), 'utf8');
  const forwardModal = readFileSync(new URL('../frontend/src/components/chat/ForwardMessageModal.vue', import.meta.url), 'utf8');

  // Verify context menu has forward button
  assert.match(contextMenu, /message-context-menu__item--forward/);
  assert.match(contextMenu, /转发消息/);
  assert.match(contextMenu, /emit\('forward'\)/);

  // Verify ChatPage has forward modal and batch button
  assert.match(chatPage, /ForwardMessageModal/);
  assert.match(chatPage, /openBatchForwardModal/);
  assert.match(chatPage, /批量转发/);
  assert.match(chatPage, /openForwardForSingleMessage/);

  // Verify ForwardMessageModal has search and confirm logic
  assert.match(forwardModal, /executeForwardMessages/);
  assert.match(forwardModal, /filteredTargets/);
  assert.match(forwardModal, /forward-modal-card/);
});
