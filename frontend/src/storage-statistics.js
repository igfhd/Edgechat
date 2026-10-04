import { formatLocalDateTime, parseUtcDate } from './date.js';

export function storageTimestampValue(value) {
  if (value === null || value === undefined || value === '') return 0;
  const date = parseUtcDate(value);
  return date ? date.getTime() : 0;
}

export function formatStorageDateTime(value) {
  return formatLocalDateTime(value);
}

export function formatByteSize(value) {
  const bytes = Math.max(0, Number(value) || 0);
  if (bytes < 1024) return `${bytes} B`;

  const units = ['KiB', 'MiB', 'GiB', 'TiB'];
  let size = bytes / 1024;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  const fractionDigits = size >= 100 ? 0 : size >= 10 ? 1 : 2;
  return `${size.toFixed(fractionDigits)} ${units[unitIndex]}`;
}

export function mergeStorageSummary(target, items = []) {
  for (const item of items) {
    const current = target.get(item.ownerKey) || {
      ownerKey: item.ownerKey,
      ownerType: item.ownerType,
      ownerId: item.ownerId,
      objectCount: 0,
      bytes: 0,
      latestUploadedAt: null
    };
    current.objectCount += Number(item.objectCount) || 0;
    current.bytes += Number(item.bytes) || 0;
    if (
      storageTimestampValue(item.latestUploadedAt) >
      storageTimestampValue(current.latestUploadedAt)
    ) {
      current.latestUploadedAt = item.latestUploadedAt;
    }
    target.set(item.ownerKey, current);
  }
  return target;
}

export function buildStorageRows(users = [], summaries = new Map()) {
  const usersById = new Map(users.map((user) => [Number(user.id), user]));
  const rows = users
    .filter((user) => !user.isDeleted)
    .map((user) => storageUserRow(user, summaries.get(`user:${Number(user.id)}`)));

  for (const summary of summaries.values()) {
    if (summary.ownerType === 'user') {
      const user = usersById.get(Number(summary.ownerId));
      if (user?.isDeleted) {
        rows.push(storageUserRow(user, summary));
      } else if (!user) {
        rows.push({
          ...storageValues(summary),
          ownerKey: summary.ownerKey,
          displayName: `未知用户 #${summary.ownerId}`,
          username: '',
          isDeleted: true
        });
      }
      continue;
    }

    rows.push({
      ...storageValues(summary),
      ownerKey: summary.ownerKey,
      displayName: summary.ownerType === 'telegram' ? '系统 / Telegram' : '未知 / 历史文件',
      username: '',
      isDeleted: false
    });
  }

  const totalBytes = rows.reduce((total, row) => total + row.bytes, 0);
  return rows.map((row) => ({
    ...row,
    share: totalBytes > 0 ? row.bytes / totalBytes : 0
  }));
}

function storageValues(summary) {
  return {
    objectCount: Number(summary?.objectCount) || 0,
    bytes: Number(summary?.bytes) || 0,
    latestUploadedAt: summary?.latestUploadedAt || null
  };
}

function storageUserRow(user, summary) {
  return {
    ...storageValues(summary),
    ownerKey: `user:${Number(user.id)}`,
    displayName: user.displayName,
    username: user.username,
    isDeleted: Boolean(user.isDeleted)
  };
}

export function sortStorageRows(rows, sort) {
  const direction = sort.direction === 'asc' ? 1 : -1;
  return [...rows].sort((left, right) => {
    if (sort.key === 'latestUploadedAt') {
      const leftTime = storageTimestampValue(left.latestUploadedAt);
      const rightTime = storageTimestampValue(right.latestUploadedAt);
      if (!leftTime && !rightTime) return compareNames(left, right);
      if (!leftTime) return 1;
      if (!rightTime) return -1;
      return (leftTime - rightTime) * direction || compareNames(left, right);
    }

    const difference = (Number(left[sort.key]) || 0) - (Number(right[sort.key]) || 0);
    return difference * direction || compareNames(left, right);
  });
}

function compareNames(left, right) {
  return String(left.displayName).localeCompare(String(right.displayName), 'zh-CN');
}
