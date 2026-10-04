import assert from 'node:assert/strict';
import test from 'node:test';

// Polyfill localStorage for Node test runner
if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear()
  };
}

import {
  DEFAULT_QUICK_REPLIES,
  getQuickReplies,
  addQuickReply,
  deleteQuickReply,
  updateQuickReply,
  resetQuickRepliesToDefault
} from '../frontend/src/quick-replies.js';

test('quick-replies - returns default list when storage empty', () => {
  globalThis.localStorage.clear();
  const list = getQuickReplies();
  assert.equal(list.length, DEFAULT_QUICK_REPLIES.length);
  assert.equal(list[0].text, DEFAULT_QUICK_REPLIES[0].text);
});

test('quick-replies - can add, update, and delete quick replies', () => {
  globalThis.localStorage.clear();
  
  // Add
  const updatedList = addQuickReply('测试快捷回复 123');
  assert.equal(updatedList[0].text, '测试快捷回复 123');
  const targetId = updatedList[0].id;

  // Update
  const editedList = updateQuickReply(targetId, '修改后的快捷回复');
  const item = editedList.find((i) => i.id === targetId);
  assert.equal(item.text, '修改后的快捷回复');

  // Delete
  const deletedList = deleteQuickReply(targetId);
  assert.equal(deletedList.some((i) => i.id === targetId), false);
});

test('quick-replies - reset to default restores original presets', () => {
  addQuickReply('临时自定义回复');
  const resetList = resetQuickRepliesToDefault();
  assert.equal(resetList.length, DEFAULT_QUICK_REPLIES.length);
  assert.equal(resetList[0].text, DEFAULT_QUICK_REPLIES[0].text);
});
