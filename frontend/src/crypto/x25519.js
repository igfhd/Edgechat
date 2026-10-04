import {
  base64ToBytes,
  bytesToBase64,
  randomBytes,
  utf8Encode
} from './utils.js';

const AES_KEY_LENGTH = 256;
const NONCE_LENGTH = 12;

export function isWebCryptoAvailable() {
  return typeof crypto !== 'undefined' && Boolean(crypto?.subtle);
}

let _isX25519Supported = null;
export async function isX25519Supported() {
  if (_isX25519Supported !== null) return _isX25519Supported;
  if (!isWebCryptoAvailable()) {
    _isX25519Supported = false;
    return false;
  }
  try {
    const kp = await crypto.subtle.generateKey(
      { name: 'X25519' },
      true,
      ['deriveBits', 'deriveKey']
    );
    _isX25519Supported = Boolean(kp?.publicKey);
  } catch {
    _isX25519Supported = false;
  }
  return _isX25519Supported;
}

export async function generateIdentityKeyPair() {
  if (!isWebCryptoAvailable()) {
    throw new Error('当前环境缺少 Web Crypto API 支持（请在 HTTPS 安全上下文下访问）');
  }
  try {
    const keyPair = await crypto.subtle.generateKey(
      { name: 'X25519' },
      true,
      ['deriveBits', 'deriveKey']
    );
    return keyPair;
  } catch (err) {
    if (err.name === 'NotSupportedError' || err.name === 'OperationError' || String(err.message).includes('operation-specific')) {
      throw new Error('当前浏览器内核暂不支持 X25519 端到端加密算法，请升级浏览器 (Chrome 130+、Safari 17+、Firefox 130+)');
    }
    throw err;
  }
}

export async function exportPublicKey(publicKey) {
  const raw = await crypto.subtle.exportKey('raw', publicKey);
  return bytesToBase64(new Uint8Array(raw));
}

export async function exportPrivateKey(privateKey) {
  const pkcs8 = await crypto.subtle.exportKey('pkcs8', privateKey);
  return bytesToBase64(new Uint8Array(pkcs8));
}

export async function derivePublicKeyFromPrivateKey(privateKey) {
  // Standard scalar multiplication on Curve25519 base point (u = 9, RFC 7748).
  // Using deriveBits against base point u=9 directly derives the 32-byte public key
  // without relying on exportKey('jwk'), which fails with OperationError in Firefox
  // on PKCS#8-imported private keys where the public coordinate was not stored.
  const basePoint = new Uint8Array(32);
  basePoint[0] = 9;

  const basePointKey = await crypto.subtle.importKey(
    'raw',
    basePoint,
    { name: 'X25519' },
    false,
    []
  );

  const publicBits = await crypto.subtle.deriveBits(
    { name: 'X25519', public: basePointKey },
    privateKey,
    256
  );

  return crypto.subtle.importKey(
    'raw',
    publicBits,
    { name: 'X25519' },
    true,
    []
  );
}

export async function importPublicKey(base64PublicKey) {
  const rawBytes = base64ToBytes(base64PublicKey, 'Public key');
  return crypto.subtle.importKey(
    'raw',
    rawBytes,
    { name: 'X25519' },
    true,
    []
  );
}

export async function importPrivateKey(base64PrivateKey) {
  const pkcs8Bytes = base64ToBytes(base64PrivateKey, 'Private key');
  return crypto.subtle.importKey(
    'pkcs8',
    pkcs8Bytes,
    { name: 'X25519' },
    true,
    ['deriveBits', 'deriveKey']
  );
}

export async function deriveSharedSecret(privateKey, publicKey) {
  const sharedBits = await crypto.subtle.deriveBits(
    { name: 'X25519', public: publicKey },
    privateKey,
    256
  );
  return new Uint8Array(sharedBits);
}

export async function deriveAesGcmKey(sharedSecretBytes, { salt, info }) {
  const hkdfKey = await crypto.subtle.importKey(
    'raw',
    sharedSecretBytes,
    'HKDF',
    false,
    ['deriveKey']
  );

  const saltBytes = typeof salt === 'string' ? utf8Encode(salt) : (salt || new Uint8Array(16));
  const infoBytes = typeof info === 'string' ? utf8Encode(info) : (info || new Uint8Array(0));

  const aesKey = await crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: saltBytes,
      info: infoBytes
    },
    hkdfKey,
    { name: 'AES-GCM', length: AES_KEY_LENGTH },
    false,
    ['encrypt', 'decrypt']
  );

  return aesKey;
}

export async function encryptAesGcm(aesKey, plaintextBytes, additionalDataBytes = null, customNonce = null) {
  const nonce = customNonce || randomBytes(NONCE_LENGTH);
  const params = {
    name: 'AES-GCM',
    iv: nonce
  };
  if (additionalDataBytes) {
    params.additionalData = additionalDataBytes;
  }

  const ciphertextBuffer = await crypto.subtle.encrypt(params, aesKey, plaintextBytes);
  return {
    ciphertext: new Uint8Array(ciphertextBuffer),
    nonce
  };
}

export async function decryptAesGcm(aesKey, ciphertextBytes, nonceBytes, additionalDataBytes = null) {
  const params = {
    name: 'AES-GCM',
    iv: nonceBytes
  };
  if (additionalDataBytes) {
    params.additionalData = additionalDataBytes;
  }

  const plaintextBuffer = await crypto.subtle.decrypt(params, aesKey, ciphertextBytes);
  return new Uint8Array(plaintextBuffer);
}
