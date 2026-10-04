import {
  base64ToBytes,
  bytesToBase64,
  randomBytes,
  utf8Decode,
  utf8Encode
} from './utils.js';
import { decryptAesGcm, encryptAesGcm } from './x25519.js';
import {
  generateRecoveryPhrase,
  normalizeSecretInput,
  validateRecoveryPhrase
} from './bip39.js';

export { generateRecoveryPhrase, normalizeSecretInput, validateRecoveryPhrase };

export const PBKDF2_ITERATIONS = 600000;
export const LEGACY_PBKDF2_ITERATIONS = 100000;
const SALT_BYTES = 16;
const IV_BYTES = 12;

export async function deriveKeyFromPassphrase(passphrase, saltBytes, iterations = PBKDF2_ITERATIONS) {
  const normalized = normalizeSecretInput(passphrase);
  const passphraseBytes = utf8Encode(normalized);
  const baseKey = await crypto.subtle.importKey(
    'raw',
    passphraseBytes,
    'PBKDF2',
    false,
    ['deriveKey']
  );

  const wrappingKey = await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: saltBytes,
      iterations: Number(iterations) || PBKDF2_ITERATIONS,
      hash: 'SHA-256'
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );

  return wrappingKey;
}

export async function backupPrivateKeyWithPassphrase({
  privateKeyBase64,
  passphrase,
  keyVersion = 1,
  iterations = PBKDF2_ITERATIONS
}) {
  if (!privateKeyBase64 || !passphrase) {
    throw new Error('备份私钥需要提供有效的私钥与安全口令/恢复短语');
  }

  const saltBytes = randomBytes(SALT_BYTES);
  const ivBytes = randomBytes(IV_BYTES);
  const cleanIterations = Number(iterations) || PBKDF2_ITERATIONS;
  const wrappingKey = await deriveKeyFromPassphrase(passphrase, saltBytes, cleanIterations);

  const rawBytes = utf8Encode(privateKeyBase64);
  const { ciphertext } = await encryptAesGcm(wrappingKey, rawBytes, null, ivBytes);

  return {
    encryptedPrivateKey: bytesToBase64(ciphertext),
    backupSalt: bytesToBase64(saltBytes),
    backupIv: bytesToBase64(ivBytes),
    keyVersion: Number(keyVersion) || 1
  };
}

export async function restorePrivateKeyWithPassphrase({
  encryptedPrivateKey,
  backupSalt,
  backupIv,
  passphrase,
  iterations
}) {
  if (!encryptedPrivateKey || !backupSalt || !backupIv || !passphrase) {
    throw new Error('解密私钥备份需要提供加密密文、盐值、IV 以及安全口令/恢复短语');
  }

  const saltBytes = base64ToBytes(backupSalt, 'Backup salt');
  const ivBytes = base64ToBytes(backupIv, 'Backup IV');
  const ciphertextBytes = base64ToBytes(encryptedPrivateKey, 'Backup ciphertext');

  const normalized = normalizeSecretInput(passphrase);
  const primaryIterations = Number(iterations) || PBKDF2_ITERATIONS;

  try {
    const wrappingKey = await deriveKeyFromPassphrase(normalized, saltBytes, primaryIterations);
    const decryptedBytes = await decryptAesGcm(wrappingKey, ciphertextBytes, ivBytes);
    return utf8Decode(decryptedBytes);
  } catch (_primaryErr) {
    // 若未显式指定迭代次数且主迭代解密失败，尝试向下兼容旧版 100,000 轮备份
    if (!iterations && primaryIterations !== LEGACY_PBKDF2_ITERATIONS) {
      try {
        const legacyKey = await deriveKeyFromPassphrase(normalized, saltBytes, LEGACY_PBKDF2_ITERATIONS);
        const decryptedBytes = await decryptAesGcm(legacyKey, ciphertextBytes, ivBytes);
        return utf8Decode(decryptedBytes);
      } catch {
        // Fallthrough to final error
      }
    }
    throw new Error('安全口令或 12 词恢复短语错误，无法解密私钥');
  }
}

export async function computeKeyFingerprint(publicKeyBase64) {
  if (!publicKeyBase64) return '';
  const keyBytes = base64ToBytes(publicKeyBase64, 'Public key');
  const digestBuffer = await crypto.subtle.digest('SHA-256', keyBytes);
  const digestBytes = new Uint8Array(digestBuffer);
  const hex = Array.from(digestBytes.subarray(0, 8))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join(':')
    .toUpperCase();
  return hex;
}
