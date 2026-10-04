import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatBubbleTime,
  formatDateDivider,
  isSameDay,
  formatUserPresenceStatus,
  isPresenceOnline,
  parseUtcDate
} from '../frontend/src/date.js';
import { normalizeUtcIsoString } from '../worker/src/utils.js';

test('parseUtcDate correctly handles SQLite timestamp strings as UTC', () => {
  // SQLite timestamp: '2026-08-17 03:32:00' (UTC 03:32)
  const sqliteStr = '2026-08-17 03:32:00';
  const date = parseUtcDate(sqliteStr);
  assert.ok(date instanceof Date);
  assert.equal(date.getUTCFullYear(), 2026);
  assert.equal(date.getUTCMonth(), 7); // 0-indexed: 7 is August
  assert.equal(date.getUTCDate(), 17);
  assert.equal(date.getUTCHours(), 3);
  assert.equal(date.getUTCMinutes(), 32);

  // Standard ISO string with Z
  const isoStr = '2026-08-17T03:32:00.000Z';
  const isoDate = parseUtcDate(isoStr);
  assert.equal(isoDate.getTime(), date.getTime());

  // Null / empty fallback
  assert.equal(parseUtcDate(null), null);
  assert.equal(parseUtcDate(''), null);
  assert.equal(parseUtcDate('invalid-date'), null);
});

test('formatBubbleTime formats local time properly', () => {
  // UTC 03:32:00
  const date = parseUtcDate('2026-08-17 03:32:00');
  const formatted = formatBubbleTime(date);

  const expectedHours = String(date.getHours()).padStart(2, '0');
  const expectedMinutes = String(date.getMinutes()).padStart(2, '0');
  assert.equal(formatted, `${expectedHours}:${expectedMinutes}`);
});

test('normalizeUtcIsoString formats SQLite string to ISO 8601 UTC', () => {
  assert.equal(normalizeUtcIsoString('2026-08-17 03:32:00'), '2026-08-17T03:32:00Z');
  assert.equal(normalizeUtcIsoString('2026-08-17T03:32:00'), '2026-08-17T03:32:00Z');
  assert.equal(normalizeUtcIsoString('2026-08-17T03:32:00Z'), '2026-08-17T03:32:00Z');
  assert.equal(normalizeUtcIsoString(null), null);
  assert.equal(normalizeUtcIsoString(''), null);
});

test('isPresenceOnline and formatUserPresenceStatus format presence properly', () => {
  // Explicit online
  assert.equal(isPresenceOnline(null, true), true);
  assert.equal(formatUserPresenceStatus(null, true), '在线');

  // Recent timestamp (1 minute ago)
  const oneMinuteAgo = new Date(Date.now() - 60 * 1000).toISOString();
  assert.equal(isPresenceOnline(oneMinuteAgo), true);
  assert.equal(formatUserPresenceStatus(oneMinuteAgo), '刚刚');

  // 15 minutes ago
  const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  assert.equal(isPresenceOnline(fifteenMinutesAgo), false);
  assert.equal(formatUserPresenceStatus(fifteenMinutesAgo), '15分钟前');

  // 2 hours ago
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  assert.equal(formatUserPresenceStatus(twoHoursAgo), '2小时前');

  // Null fallback
  assert.equal(isPresenceOnline(null), false);
  assert.equal(formatUserPresenceStatus(null), '离线');
});

test('isSameDay correctly identifies same or different calendar days', () => {
  assert.equal(isSameDay('2026-08-17 03:32:00', '2026-08-17 08:20:00'), true);
  assert.equal(isSameDay('2026-08-17 03:32:00', '2026-08-18 03:32:00'), false);
  assert.equal(isSameDay('2025-08-17 10:00:00', '2026-08-17 10:00:00'), false);
  assert.equal(isSameDay(null, '2026-08-17 10:00:00'), false);
  assert.equal(isSameDay('2026-08-17 10:00:00', null), false);
});

test('formatDateDivider correctly formats relative and absolute dates', () => {
  const now = new Date();
  assert.equal(formatDateDivider(now), '今天');

  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  assert.equal(formatDateDivider(yesterday), '昨天');

  // Past year
  const pastYearDate = new Date('2020-05-12T10:00:00.000Z');
  assert.equal(formatDateDivider(pastYearDate), '2020年5月12日');

  // Same year date (more than 2 days ago in same year)
  const sameYearDate = new Date(now.getFullYear(), 0, 15, 12, 0, 0);
  assert.match(formatDateDivider(sameYearDate), /1月15日/);

  assert.equal(formatDateDivider(null), '');
  assert.equal(formatDateDivider(''), '');
});
