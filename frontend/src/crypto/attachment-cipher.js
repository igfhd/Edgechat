import {
  base64ToBytes,
  bytesToBase64,
  randomBytes
} from './utils.js';
import { decryptAesGcm, encryptAesGcm } from './x25519.js';

const FILE_KEY_BYTES = 32;
const NONCE_BYTES = 12;

export async function encryptAttachmentFile(file) {
  const fileBytes = new Uint8Array(await file.arrayBuffer());
  const fileKeyBytes = randomBytes(FILE_KEY_BYTES);
  const nonceBytes = randomBytes(NONCE_BYTES);

  const aesKey = await crypto.subtle.importKey(
    'raw',
    fileKeyBytes,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt']
  );

  const { ciphertext } = await encryptAesGcm(aesKey, fileBytes, null, nonceBytes);

  return {
    encryptedBlob: new Blob([ciphertext], { type: 'application/octet-stream' }),
    fileKeyBase64: bytesToBase64(fileKeyBytes),
    nonceBase64: bytesToBase64(nonceBytes),
    originalName: file.name,
    originalType: file.type || 'application/octet-stream',
    originalSize: file.size
  };
}

export async function decryptAttachmentBytes(encryptedBuffer, fileKeyBase64, nonceBase64) {
  const fileKeyBytes = base64ToBytes(fileKeyBase64, 'Attachment file key');
  const nonceBytes = base64ToBytes(nonceBase64, 'Attachment nonce');
  const ciphertextBytes = encryptedBuffer instanceof Uint8Array
    ? encryptedBuffer
    : new Uint8Array(encryptedBuffer);

  const aesKey = await crypto.subtle.importKey(
    'raw',
    fileKeyBytes,
    { name: 'AES-GCM' },
    false,
    ['decrypt']
  );

  const decryptedBytes = await decryptAesGcm(aesKey, ciphertextBytes, nonceBytes);
  return decryptedBytes;
}

export async function createDecryptedBlobUrl(encryptedBuffer, fileKeyBase64, nonceBase64, mimeType = 'application/octet-stream') {
  const decryptedBytes = await decryptAttachmentBytes(encryptedBuffer, fileKeyBase64, nonceBase64);
  const blob = new Blob([decryptedBytes], { type: mimeType });
  return URL.createObjectURL(blob);
}
