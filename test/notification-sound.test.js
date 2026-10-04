import assert from 'node:assert/strict';
import test from 'node:test';
import { isMessageMention, useNotificationSound } from '../frontend/src/composables/useNotificationSound.js';

function createMockStorage() {
  const store = new Map();
  return {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, String(v))
  };
}

test('isMessageMention accurately detects mentions in text and structured metadata', () => {
  const session = { id: 5, userId: 5, username: 'alice', displayName: '爱丽丝' };

  // Mention by username
  assert.equal(isMessageMention({ content: '你好 @alice 请看一下' }, session), true);
  // Mention by display name
  assert.equal(isMessageMention({ content: '欢迎 @爱丽丝 入群' }, session), true);
  // Mention by structured metadata
  assert.equal(isMessageMention({ content: '大家好', mentions: [{ id: 5 }] }, session), true);
  // Other user mention
  assert.equal(isMessageMention({ content: '你好 @bob' }, session), false);
  assert.equal(isMessageMention({ content: '普通消息没有任何提及' }, session), false);
  assert.equal(isMessageMention(null, session), false);
  assert.equal(isMessageMention({ content: 'hi' }, null), false);
});

test('useNotificationSound manages sound state and persists to storage', () => {
  const storage = createMockStorage();
  const played = [];

  const sound = useNotificationSound({
    _loadEnabled: () => storage.getItem('edgechat:notification-sound') !== 'false',
    _saveEnabled: (val) => storage.setItem('edgechat:notification-sound', val),
    _playTones: (notes) => played.push(notes)
  });

  assert.equal(sound.soundEnabled.value, true);

  // Toggle sound off
  sound.toggleSound();
  assert.equal(sound.soundEnabled.value, false);
  assert.equal(storage.getItem('edgechat:notification-sound'), 'false');

  // When disabled, no tone plays
  sound.playMessageSound();
  assert.equal(played.length, 0);

  // Toggle sound on (plays preview chime)
  sound.toggleSound();
  assert.equal(sound.soundEnabled.value, true);
  assert.equal(storage.getItem('edgechat:notification-sound'), 'true');
  assert.equal(played.length, 1);
});

test('handleIncomingMessageSound handles message filtering, DM and mention prioritization, and room muting', () => {
  const played = [];
  const sound = useNotificationSound({
    _loadEnabled: () => true,
    _saveEnabled: () => {},
    _playTones: (notes) => played.push(notes)
  });

  const session = { id: 10, userId: 10, username: 'alice', displayName: '爱丽丝' };

  // 1. Own message: should NOT play sound
  const ownMsg = { id: 1, sender: { id: 10 }, content: '我自己发出的消息' };
  const resOwn = sound.handleIncomingMessageSound(ownMsg, { kind: 'channel', id: 1 }, { session });
  assert.equal(resOwn, false);
  assert.equal(played.length, 0);

  // 2. Incoming message from another user in channel: plays regular message sound
  const otherMsg = { id: 2, sender: { id: 20 }, content: '大家好' };
  const resOther = sound.handleIncomingMessageSound(otherMsg, { kind: 'channel', id: 1 }, { session });
  assert.equal(resOther, true);
  assert.equal(played.length, 1);
  assert.equal(played[0].length, 2); // Dual tones

  // 3. Incoming message mentioning user: plays mention sound (3 tones)
  const mentionMsg = { id: 3, sender: { id: 20 }, content: '请 @alice 确认' };
  const resMention = sound.handleIncomingMessageSound(mentionMsg, { kind: 'channel', id: 1 }, { session });
  assert.equal(resMention, true);
  assert.equal(played.length, 2);
  assert.equal(played[1].length, 3); // Three tones

  // 4. DM message: plays mention/DM sound (3 tones)
  const dmMsg = { id: 4, sender: { id: 20 }, content: '私信内容' };
  const resDm = sound.handleIncomingMessageSound(dmMsg, { kind: 'dm', id: 20 }, { session });
  assert.equal(resDm, true);
  assert.equal(played.length, 3);
  assert.equal(played[2].length, 3); // Three tones

  // 5. Muted room with regular message: should NOT play sound
  const mutedMsg = { id: 5, sender: { id: 20 }, content: '免打扰群里的闲聊' };
  const resMuted = sound.handleIncomingMessageSound(mutedMsg, { kind: 'channel', id: 2 }, { session, isMuted: true });
  assert.equal(resMuted, false);
  assert.equal(played.length, 3); // Count unchanged

  // 6. Muted room with @mention: DOES play sound
  const mutedMentionMsg = { id: 6, sender: { id: 20 }, content: '重要通知 @alice' };
  const resMutedMention = sound.handleIncomingMessageSound(mutedMentionMsg, { kind: 'channel', id: 2 }, { session, isMuted: true });
  assert.equal(resMutedMention, true);
  assert.equal(played.length, 4);
});
