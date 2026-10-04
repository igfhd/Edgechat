import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { ref } from 'vue';
import { useChatRoom } from '../frontend/src/composables/useChatRoom.js';

const chatPage = readFileSync(
  new URL('../frontend/src/pages/ChatPage.vue', import.meta.url),
  'utf8'
).replaceAll('\r\n', '\n');

test('useChatRoom 支持立即乐观上屏并在此后调和正式消息', async () => {
  const activeRoom = ref({ id: 1, kind: 'public' });
  const sentFrames = [];
  let activeSocket = null;

  const room = useChatRoom({
    activeRoom,
    session: ref({ userId: 7, displayName: 'Alice' }),
    error: ref(''),
    roomApi: {
      async getMessages() {
        return { messages: [] };
      },
      async markRoomRead() {},
    },
    openRoomConnection(params) {
      const socket = {
        params,
        readyState: 1,
        close() { this.readyState = 3; },
        send(frame) { sentFrames.push(frame); },
        emitMessage(payload) {
          params.onMessage(JSON.stringify(payload), this);
        },
      };
      activeSocket = socket;
      params.onStatus({ status: 'open', socket });
      return socket;
    },
  });

  await room.activateRoom();

  // 1. 发送消息 -> 0ms 立即在 messages.value 中出现乐观待确认项 (status: 'sending')
  room.composerText.value = '你好，世界！';
  await room.sendMessage();

  // 验证输入栏已被即时清空
  assert.equal(room.composerText.value, '');
  assert.equal(room.messages.value.length, 1);
  assert.equal(room.messages.value[0].status, 'sending');
  assert.equal(room.messages.value[0].content, '你好，世界！');
  assert.ok(room.messages.value[0].clientMsgId.startsWith('client-'));

  // 2. 验证 WebSocket 已立即发出定长填充帧并携带 clientMsgId
  assert.equal(sentFrames.length, 1);
  const sentPayload = JSON.parse(sentFrames[0]);
  assert.equal(sentPayload.type, 'send');
  assert.equal(sentPayload.content, '你好，世界！');
  assert.equal(sentPayload.clientMsgId, room.messages.value[0].clientMsgId);

  // 3. 模拟服务端确认并广播消息包回客户端
  const serverMessage = {
    id: 101,
    content: '你好，世界！',
    createdAt: new Date().toISOString(),
    sender: { id: 7, displayName: 'Alice', kind: 'local' },
  };
  activeSocket.emitMessage({
    type: 'message',
    message: serverMessage,
    clientMsgId: sentPayload.clientMsgId,
  });
  await Promise.resolve();
  await Promise.resolve();

  // 4. 验证乐观项已被正式项原地替换调和，列表依然只有 1 条且 id 变为 101，状态变为 sent
  assert.equal(room.messages.value.length, 1);
  assert.equal(room.messages.value[0].id, 101);
  assert.equal(room.messages.value[0].status, 'sent');
});

test('handleSendMessageOrEdit 发送后即时清空输入框并避免重复发送', async () => {
  const activeRoom = ref({ id: 2, kind: 'public' });
  const room = useChatRoom({
    activeRoom,
    session: ref({ userId: 7, displayName: 'Alice' }),
    error: ref(''),
    roomApi: {
      async getMessages() { return { messages: [] }; },
      async markRoomRead() {},
    },
    openRoomConnection(params) {
      const socket = {
        params,
        readyState: 1,
        close() { this.readyState = 3; },
        send() {},
      };
      params.onStatus({ status: 'open', socket });
      return socket;
    },
  });

  await room.activateRoom();
  room.composerText.value = '测试消息';
  await room.sendMessage(room.composerText.value);

  assert.equal(room.composerText.value, '');
  assert.equal(room.messages.value.length, 1);

  // 再次发送空内容不会新增消息
  await room.sendMessage();
  assert.equal(room.messages.value.length, 1);
});

test('useChatRoom 支持发送带附件的消息以及纯附件消息，且发送后即时清空 pendingAttachment', async () => {
  const activeRoom = ref({ id: 3, kind: 'public' });
  const sentFrames = [];
  const room = useChatRoom({
    activeRoom,
    session: ref({ userId: 7, displayName: 'Alice' }),
    error: ref(''),
    roomApi: {
      async getMessages() { return { messages: [] }; },
      async markRoomRead() {},
    },
    openRoomConnection(params) {
      const socket = {
        params,
        readyState: 1,
        close() { this.readyState = 3; },
        send(frame) { sentFrames.push(frame); },
      };
      params.onStatus({ status: 'open', socket });
      return socket;
    },
  });

  await room.activateRoom();

  // 1. 发送带文本和附件的消息
  room.composerText.value = '查看附件';
  room.pendingAttachment.value = { key: '7/file-1.png', name: 'file-1.png', type: 'image/png', size: 1024 };
  const att1 = room.pendingAttachment.value;
  await room.sendMessage(room.composerText.value, att1);

  assert.equal(room.composerText.value, '');
  assert.equal(room.pendingAttachment.value, null);
  assert.equal(room.messages.value.length, 1);
  assert.equal(room.messages.value[0].content, '查看附件');
  assert.deepEqual(room.messages.value[0].attachment, { key: '7/file-1.png', name: 'file-1.png', type: 'image/png', size: 1024 });

  // 2. 发送纯附件消息（文本为空）
  room.pendingAttachment.value = { key: '7/doc.pdf', name: 'doc.pdf', type: 'application/pdf', size: 2048 };
  const att2 = room.pendingAttachment.value;
  await room.sendMessage('', att2);

  assert.equal(room.composerText.value, '');
  assert.equal(room.pendingAttachment.value, null);
  assert.equal(room.messages.value.length, 2);
  assert.equal(room.messages.value[1].content, '');
  assert.deepEqual(room.messages.value[1].attachment, { key: '7/doc.pdf', name: 'doc.pdf', type: 'application/pdf', size: 2048 });
});

test('ChatPage 模板与样式包含发送中与失败重试状态展示', () => {
  assert.match(chatPage, /class="receipt-icon receipt-icon--pending"/);
  assert.match(chatPage, /class="receipt-icon-btn--failed"/);
  assert.match(chatPage, /retrySendMessage/);
  assert.match(chatPage, /\.receipt-icon--pending\s*\{/);
  assert.match(chatPage, /\.receipt-icon-btn--failed\s*\{/);
});
