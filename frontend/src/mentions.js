/**
 * Mentions helper module for EdgeChat.
 */

// Regex matching @all / @所有人 or @username (letters, digits, underscores, dashes, Chinese characters)
export const MENTION_REGEX = /(?:^|\s)@([a-zA-Z0-9_\-\u4e00-\u9fa5]+)/g;

/**
 * Extracts all mentioned targets from text.
 * @param {string} text
 * @returns {string[]} Array of mentioned usernames / 'all'
 */
export function extractMentions(text) {
  if (!text || typeof text !== 'string') return [];
  const mentions = new Set();
  const regex = /(?:^|[\s(（[【])@([a-zA-Z0-9_\-\u4e00-\u9fa5]+)/g;
  for (const match of text.matchAll(regex)) {
    const target = match[1].trim();
    if (target) {
      mentions.add(target);
    }
  }
  return Array.from(mentions);
}

/**
 * Checks if the message content explicitly mentions the current user or @all / @所有人.
 * @param {string} text
 * @param {object} currentUser
 * @returns {boolean}
 */
export function isUserMentioned(text, currentUser) {
  if (!text || !currentUser) return false;
  const mentions = extractMentions(text);
  if (mentions.length === 0) return false;

  const currentUsername = String(currentUser.username || '').toLowerCase();
  const currentDisplayName = String(currentUser.displayName || '').toLowerCase();

  return mentions.some((item) => {
    const lower = item.toLowerCase();
    if (lower === 'all' || lower === '所有人' || lower === 'everyone') {
      return true;
    }
    if (currentUsername && lower === currentUsername) {
      return true;
    }
    if (currentDisplayName && lower === currentDisplayName) {
      return true;
    }
    return false;
  });
}
