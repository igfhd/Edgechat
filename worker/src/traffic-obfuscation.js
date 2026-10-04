const BUCKET_SIZES = [256, 1024, 4096, 16384];

function randomAsciiString(length) {
  if (length <= 0) return '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  let res = '';
  for (let i = 0; i < length; i++) {
    res += chars[array[i] % chars.length];
  }
  return res;
}

export function padObjectToBucket(obj, targetBucket = null) {
  const clone = { ...obj, pad: '' };
  const baseJsonWithPad = JSON.stringify(clone);
  const baseLength = new TextEncoder().encode(baseJsonWithPad).length;

  let bucket = targetBucket;
  if (!bucket) {
    bucket = BUCKET_SIZES.find((size) => size >= baseLength);
    if (!bucket) {
      bucket = Math.ceil(baseLength / 4096) * 4096;
    }
  }

  const padLength = Math.max(0, bucket - baseLength);
  clone.pad = randomAsciiString(padLength);
  return JSON.stringify(clone);
}
