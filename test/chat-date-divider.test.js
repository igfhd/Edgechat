import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { formatDateDivider, isSameDay } from '../frontend/src/date.js';

const chatPage = readFileSync(
  new URL('../frontend/src/pages/ChatPage.vue', import.meta.url),
  'utf8'
).replaceAll('\r\n', '\n');

test('date utils support chat date dividers', () => {
  assert.equal(typeof isSameDay, 'function');
  assert.equal(typeof formatDateDivider, 'function');

  assert.equal(isSameDay('2026-08-17 03:32:00', '2026-08-17 08:20:00'), true);
  assert.equal(isSameDay('2026-08-17 03:32:00', '2026-08-18 03:32:00'), false);
  assert.equal(formatDateDivider(new Date()), '今天');
});

test('ChatPage template includes date divider and floating sticky date capsule', () => {
  assert.match(chatPage, /class="chat-floating-date"/);
  assert.match(chatPage, /class="chat-date-divider"/);
  assert.match(chatPage, /shouldShowDateDivider/);
  assert.match(chatPage, /updateFloatingDate/);
});

test('ChatPage styles define appearance for date divider and floating date', () => {
  assert.match(chatPage, /\.chat-floating-date\s*\{/);
  assert.match(chatPage, /\.chat-date-divider\s*\{/);
  assert.match(chatPage, /\.chat-date-divider__badge\s*\{/);
});

