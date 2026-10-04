import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const createGroupDialog = readFileSync(
  new URL('../frontend/src/components/chat/CreateGroupDialog.vue', import.meta.url),
  'utf8'
);
const chatPage = readFileSync(
  new URL('../frontend/src/pages/ChatPage.vue', import.meta.url),
  'utf8'
);
const discovery = readFileSync(
  new URL('../frontend/src/components/chat/PublicGroupDiscovery.vue', import.meta.url),
  'utf8'
);
const joinDialog = readFileSync(
  new URL('../frontend/src/components/chat/PublicGroupJoinDialog.vue', import.meta.url),
  'utf8'
);

test('创建群聊弹窗提供公开和私有类型切换', () => {
  assert.match(createGroupDialog, /role="radiogroup"/);
  assert.match(createGroupDialog, /form\.kind === 'public'/);
  assert.match(createGroupDialog, />公开群组</);
  assert.match(createGroupDialog, />私有群组</);
});

test('未加入公开群位于侧栏底部折叠区并通过确认弹窗加入', () => {
  assert.match(chatPage, /<PublicGroupDiscovery/);
  assert.match(chatPage, /publicGroupItems/);
  assert.match(chatPage, /<PublicGroupJoinDialog/);
  assert.match(discovery, />未加入群组</);
  assert.match(discovery, /aria-expanded="expanded"/);
  assert.match(joinDialog, /加入群组/);
  assert.match(joinDialog, /channel\.memberCount/);
});
