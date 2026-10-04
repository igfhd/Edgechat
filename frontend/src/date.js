/**
 * Date and time parsing utilities for Edgechat frontend.
 * Ensures UTC timestamps from SQLite (which lack a trailing 'Z')
 * are correctly parsed as UTC so they display in the user's local timezone.
 */

/**
 * Parses any date string/number into a Date object, treating timezone-less
 * ISO/SQLite timestamps as UTC.
 * @param {string|number|Date|null|undefined} value
 * @returns {Date|null}
 */
export function parseUtcDate(value) {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === 'number') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const str = String(value).trim();
  if (!str) return null;

  // SQLite default format 'YYYY-MM-DD HH:MM:SS'
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(str)) {
    return new Date(str.replace(' ', 'T') + (str.endsWith('Z') ? '' : 'Z'));
  }
  // ISO without timezone 'YYYY-MM-DDTHH:MM:SS'
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(str)) {
    return new Date(`${str}Z`);
  }

  const parsed = new Date(str);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Formats message bubble timestamp as 'HH:mm' in user's local timezone.
 * @param {string|number|Date} value
 * @returns {string}
 */
export function formatBubbleTime(value) {
  const date = parseUtcDate(value);
  if (!date) return '';
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

/**
 * Formats message timestamp as localized date-time string.
 * @param {string|number|Date} value
 * @returns {string}
 */
export function formatLocalDateTime(value) {
  const date = parseUtcDate(value);
  return date ? date.toLocaleString() : '';
}

/**
 * Formats a date for sidebar / list preview.
 * @param {string|number|Date} value
 * @returns {string}
 */
export function formatLocalDate(value) {
  const date = parseUtcDate(value);
  return date ? date.toLocaleDateString() : '';
}

/**
 * Checks whether a user is currently considered online (WS connected or active in last 3 minutes).
 * @param {string|number|Date|null|undefined} lastActiveAt
 * @param {boolean} [explicitOnline]
 * @returns {boolean}
 */
export function isPresenceOnline(lastActiveAt, explicitOnline = undefined) {
  if (explicitOnline === true) return true;
  if (explicitOnline === false) return false;
  if (!lastActiveAt) return false;
  const date = parseUtcDate(lastActiveAt);
  if (!date) return false;
  const now = new Date();
  // Within 3 minutes
  return now.getTime() - date.getTime() <= 3 * 60 * 1000;
}

/**
 * Formats a user's presence / last active status into a human-readable string.
 * @param {string|number|Date|null|undefined} lastActiveAt
 * @param {boolean} [isOnline]
 * @returns {string} e.g. '在线', '刚刚在线', '5分钟前在线', '2小时前在线', '昨天 15:30', '8月12日', '离线'
 */
export function formatUserPresenceStatus(lastActiveAt, isOnline = undefined) {
  if (isOnline === true) return '在线';
  if (!lastActiveAt) return '离线';
  const date = parseUtcDate(lastActiveAt);
  if (!date) return '离线';

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  if (diffMs < 0) return '在线';

  const diffMinutes = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMinutes < 3) return isOnline ? '在线' : '刚刚';
  if (diffMinutes < 60) return `${diffMinutes}分钟前`;
  if (diffHours < 24) return `${diffHours}小时前`;
  if (diffDays === 1) {
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `昨天 ${hours}:${minutes}`;
  }
  if (diffDays < 7) return `${diffDays}天前`;
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

/**
 * Checks whether two date values fall on the same calendar day in local time.
 * @param {string|number|Date|null|undefined} valueA
 * @param {string|number|Date|null|undefined} valueB
 * @returns {boolean}
 */
export function isSameDay(valueA, valueB) {
  const dateA = parseUtcDate(valueA);
  const dateB = parseUtcDate(valueB);
  if (!dateA || !dateB) return false;
  return (
    dateA.getFullYear() === dateB.getFullYear() &&
    dateA.getMonth() === dateB.getMonth() &&
    dateA.getDate() === dateB.getDate()
  );
}

/**
 * Formats a date for chat timeline dividers and floating date capsules.
 * e.g., '今天', '昨天', '8月14日 星期五', '2025年12月31日'
 * @param {string|number|Date} value
 * @returns {string}
 */
export function formatDateDivider(value) {
  const date = parseUtcDate(value);
  if (!date) return '';

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const targetStart = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const diffDays = Math.round((todayStart - targetStart) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return '今天';
  if (diffDays === 1) return '昨天';

  const isCurrentYear = date.getFullYear() === now.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();

  if (isCurrentYear) {
    const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
    const weekday = weekdays[date.getDay()];
    return `${month}月${day}日 ${weekday}`;
  }

  return `${date.getFullYear()}年${month}月${day}日`;
}
