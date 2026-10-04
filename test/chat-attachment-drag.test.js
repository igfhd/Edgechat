import assert from 'node:assert/strict';
import test from 'node:test';
import {
  decryptAttachmentBytes,
  encryptAttachmentFile
} from '../frontend/src/crypto/attachment-cipher.js';

test('File attachment encryption helper handles standard and e2ee files correctly', async () => {
  const content = 'Hello world file test for drag and drop';
  const originalBytes = new TextEncoder().encode(content);
  const file = new File([originalBytes], 'test-doc.pdf', { type: 'application/pdf' });

  // Encrypt file
  const encrypted = await encryptAttachmentFile(file);
  assert.equal(encrypted.originalName, 'test-doc.pdf');
  assert.equal(encrypted.originalType, 'application/pdf');
  assert.equal(encrypted.originalSize, originalBytes.length);
  assert.ok(encrypted.fileKeyBase64);
  assert.ok(encrypted.nonceBase64);
  assert.ok(encrypted.encryptedBlob);

  // Decrypt file bytes
  const decryptedBytes = await decryptAttachmentBytes(
    await encrypted.encryptedBlob.arrayBuffer(),
    encrypted.fileKeyBase64,
    encrypted.nonceBase64
  );
  assert.deepEqual(decryptedBytes, originalBytes);
});

test('Simulated Drag and Drop file extraction structure', () => {
  let isDragging = false;
  let dragCounter = 0;

  function onDragEnter(types) {
    if (types.includes('Files')) {
      dragCounter++;
      isDragging = true;
    }
  }

  function onDragLeave() {
    dragCounter = Math.max(0, dragCounter - 1);
    if (dragCounter === 0) {
      isDragging = false;
    }
  }

  function onDrop(files) {
    dragCounter = 0;
    isDragging = false;
    return files[0] || null;
  }

  // Simulate dragging file into window
  onDragEnter(['Files']);
  assert.equal(isDragging, true);

  // Simulate hovering over child elements
  onDragEnter(['Files']);
  assert.equal(isDragging, true);
  onDragLeave();
  assert.equal(isDragging, true);

  // Simulate dropping
  const fakeFile = new File(['123'], 'drop.png', { type: 'image/png' });
  const dropped = onDrop([fakeFile]);
  assert.equal(isDragging, false);
  assert.equal(dropped.name, 'drop.png');
});
