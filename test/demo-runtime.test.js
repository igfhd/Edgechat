import assert from 'node:assert/strict';
import test from 'node:test';
import { requestDemo } from '../frontend/src/demo/api.js';
import {
  connectDemoInboxSocket,
  connectDemoRoomSocket
} from '../frontend/src/demo/realtime.js';
import { resetDemoState } from '../frontend/src/demo/state.js';

test.beforeEach(() => {
  resetDemoState();
});

test('demo backend exposes chat, admin, storage and Telegram fixture data', async () => {
  const [site, session, bootstrap, overview, storage, telegram] = await Promise.all([
    requestDemo('/site'),
    requestDemo('/auth/session'),
    requestDemo('/bootstrap'),
    requestDemo('/admin/overview'),
    requestDemo('/admin/storage/scan'),
    requestDemo('/admin/telegram')
  ]);

  assert.equal(site.site.siteName, 'EdgeChat Demo');
  assert.equal(session.session.isAdmin, true);
  assert.equal(bootstrap.channels.some((channel) => channel.isGeneral), true);
  assert.equal(bootstrap.dms.length, 1);
  assert.equal(overview.channels.length, 4);
  assert.equal(storage.scannedObjects, 4);
  assert.equal(storage.items.some((item) => item.ownerType === 'telegram'), true);
  assert.equal(telegram.config.configured, true);
  assert.equal(telegram.mappings[0].enabled, true);
});

test('demo backend keeps group and admin mutations in browser memory', async () => {
  const created = await requestDemo('/channels', {
    method: 'POST',
    body: { name: '演示项目组', kind: 'private', memberUserIds: [2] }
  });
  const invited = await requestDemo(`/channels/${created.channel.id}/invite`, {
    method: 'POST',
    body: { userIds: [3] }
  });
  const user = await requestDemo('/admin/users', {
    method: 'POST',
    body: { username: 'preview', displayName: 'Preview', password: 'demo' }
  });
  const invite = await requestDemo('/admin/register-links', {
    method: 'POST',
    body: { note: '自动化测试', maxUses: 2 }
  });

  assert.equal(created.channel.kind, 'private');
  assert.deepEqual(invited.members.map((member) => member.id), [1, 2, 3]);
  assert.equal(user.user.username, 'preview');
  assert.equal(invite.invite.remainingUses, 2);
});

test('demo groups use the signed-in user as their owner', async () => {
  await requestDemo('/auth/login', {
    method: 'POST',
    body: { username: 'alice', password: 'demo' }
  });
  const created = await requestDemo('/channels', {
    method: 'POST',
    body: { name: 'Alice 的项目组', kind: 'private', memberUserIds: [3] }
  });
  const members = await requestDemo(`/channels/${created.channel.id}/members`);

  assert.deepEqual(members.members.map((member) => member.id), [2, 3]);
  assert.equal(members.members[0].role, 'owner');
  assert.equal(created.channel.ownerDisplayName, 'Alice');
});

test('demo public groups can be created, discovered and joined', async () => {
  const created = await requestDemo('/channels', {
    method: 'POST',
    body: { name: '公开演示群', kind: 'public', memberUserIds: [] }
  });
  const beforeJoin = await requestDemo('/bootstrap');
  const discoverable = beforeJoin.channels.find((channel) => channel.id === 4);
  const joined = await requestDemo('/channels/4/join', { method: 'POST' });

  assert.equal(created.channel.kind, 'public');
  assert.equal(discoverable.isMember, false);
  assert.equal(joined.channel.isMember, true);
  assert.equal(joined.channel.memberCount, 3);

  await assert.rejects(
    requestDemo('/channels/2/join', { method: 'POST' }),
    /公开群组不存在/
  );
});

test('demo room socket echoes sent messages through the real-time contract', async () => {
  const frames = [];
  const inboxFrames = [];
  const inboxSocket = connectDemoInboxSocket({
    onMessage(frame) {
      inboxFrames.push(JSON.parse(frame));
    },
    onStatus() {}
  });
  let socket;
  await new Promise((resolve) => {
    socket = connectDemoRoomSocket({
      kind: 'public',
      roomId: 1,
      onMessage(frame) {
        frames.push(JSON.parse(frame));
      },
      onStatus(event) {
        if (event.status === 'open') resolve();
      }
    });
  });

  socket.send(JSON.stringify({ type: 'send', content: '浏览器本地消息', attachment: null }));

  assert.equal(frames.length, 1);
  assert.equal(frames[0].type, 'message');
  assert.equal(frames[0].message.content, '浏览器本地消息');
  assert.equal(frames[0].message.sender.id, 1);

  const history = await requestDemo('/messages?kind=public&roomId=1');
  assert.equal(history.messages.at(-1).content, '浏览器本地消息');
  assert.deepEqual(inboxFrames, []);
  socket.close();
  inboxSocket.close();
});

test('Telegram replies increment the inbox unread projection', async () => {
  const inboxFrames = [];
  await requestDemo('/messages/read', {
    method: 'POST',
    body: { kind: 'public', roomId: 3 }
  });
  const inboxSocket = connectDemoInboxSocket({
    onMessage(frame) {
      inboxFrames.push(JSON.parse(frame));
    },
    onStatus() {}
  });
  let roomSocket;
  await new Promise((resolve) => {
    roomSocket = connectDemoRoomSocket({
      kind: 'public',
      roomId: 3,
      onMessage() {},
      onStatus(event) {
        if (event.status === 'open') resolve();
      }
    });
  });

  roomSocket.send(JSON.stringify({ type: 'send', content: 'Telegram 未读测试' }));
  await new Promise((resolve) => setTimeout(resolve, 720));

  assert.equal(inboxFrames.at(-1).unreadCount, 1);
  assert.equal(inboxFrames.at(-1).room.name, 'Telegram 联动');
  roomSocket.close();
  inboxSocket.close();
});
