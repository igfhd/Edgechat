import { BIP39_ENGLISH_WORDLIST } from './bip39-wordlist.js';

const WORD_INDEX_MAP = new Map();
BIP39_ENGLISH_WORDLIST.forEach((word, index) => {
  WORD_INDEX_MAP.set(word, index);
});

function bytesToBinaryString(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) {
    bin += bytes[i].toString(2).padStart(8, '0');
  }
  return bin;
}

/**
 * 生成 12 词标准 BIP-39 恢复短语 (128-bit 熵 + 4-bit 校验和)
 * @returns {Promise<string>} 12 个助记单词构成的短语
 */
export async function generateRecoveryPhrase() {
  const entropy = crypto.getRandomValues(new Uint8Array(16));
  const hashBuffer = await crypto.subtle.digest('SHA-256', entropy);
  const hashBytes = new Uint8Array(hashBuffer);

  const entropyBits = bytesToBinaryString(entropy);
  const checksumBits = hashBytes[0].toString(2).padStart(8, '0').slice(0, 4);
  const totalBits = entropyBits + checksumBits;

  const words = [];
  for (let i = 0; i < 12; i++) {
    const chunk = totalBits.slice(i * 11, (i + 1) * 11);
    const index = parseInt(chunk, 2);
    words.push(BIP39_ENGLISH_WORDLIST[index]);
  }
  return words.join(' ');
}

/**
 * 校验 12 词 BIP-39 恢复短语的格式、词表及校验和
 * @param {string} phrase
 * @returns {Promise<boolean>}
 */
export async function validateRecoveryPhrase(phrase) {
  if (typeof phrase !== 'string') return false;
  const words = phrase.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length !== 12) return false;

  let totalBits = '';
  for (const word of words) {
    const index = WORD_INDEX_MAP.get(word);
    if (index === undefined) return false;
    totalBits += index.toString(2).padStart(11, '0');
  }

  const entropyBits = totalBits.slice(0, 128);
  const checksumBits = totalBits.slice(128, 132);

  const entropyBytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    entropyBytes[i] = parseInt(entropyBits.slice(i * 8, (i + 1) * 8), 2);
  }

  const hashBuffer = await crypto.subtle.digest('SHA-256', entropyBytes);
  const hashBytes = new Uint8Array(hashBuffer);
  const expectedChecksumBits = hashBytes[0].toString(2).padStart(8, '0').slice(0, 4);

  return checksumBits === expectedChecksumBits;
}

/**
 * 标准化恢复短语或口令（去除首尾空白、多余内部空格、统一小写助记词）
 * @param {string} input
 * @returns {string}
 */
export function normalizeSecretInput(input) {
  if (typeof input !== 'string') return '';
  const trimmed = input.trim();
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length >= 12 && parts.every((p) => /^[a-zA-Z]+$/.test(p))) {
    return parts.map((p) => p.toLowerCase()).join(' ');
  }
  return trimmed;
}
