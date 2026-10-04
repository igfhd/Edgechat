const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

export const E2EE_PREFIX = 'edgechat:e2ee:v1:';

export function bytesToBase64(bytes) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

export function base64ToBytes(value, label = 'Base64') {
  const input = String(value || '').trim();
  if (!input) {
    return new Uint8Array(0);
  }
  try {
    const binary = atob(input);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch {
    throw new Error(`${label} is not valid base64`);
  }
}

export function utf8Encode(text) {
  return encoder.encode(String(text ?? ''));
}

export function utf8Decode(bytes) {
  return decoder.decode(bytes);
}

export function randomBytes(length) {
  return crypto.getRandomValues(new Uint8Array(length));
}

export function isE2eeEnvelope(value) {
  return typeof value === 'string' && value.startsWith(E2EE_PREFIX);
}

export function wrapEnvelope(payloadObject) {
  const json = JSON.stringify(payloadObject);
  return `${E2EE_PREFIX}${bytesToBase64(utf8Encode(json))}`;
}

export function unwrapEnvelope(envelopeString) {
  if (!isE2eeEnvelope(envelopeString)) {
    return null;
  }
  const rawBase64 = envelopeString.slice(E2EE_PREFIX.length);
  const jsonBytes = base64ToBytes(rawBase64, 'E2EE envelope');
  const jsonStr = utf8Decode(jsonBytes);
  return JSON.parse(jsonStr);
}
