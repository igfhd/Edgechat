import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const chatPageContent = readFileSync(
  new URL('../frontend/src/pages/ChatPage.vue', import.meta.url),
  'utf8'
).replaceAll('\r\n', '\n');

const textareaContent = readFileSync(
  new URL('../frontend/src/components/ui/Textarea.vue', import.meta.url),
  'utf8'
).replaceAll('\r\n', '\n');

test('ChatPage uses concise placeholder and prevents multi-line wrapping in composer input', () => {
  // Verify placeholder string is simplified and does not have the bulky 30+ char helper string
  assert.ok(
    chatPageContent.includes(":placeholder=\"editingMessage ? '编辑消息内容... (按 Esc 取消)' : (isRoomE2ee(activeRoom) ? '发送端到端加密消息...' : '输入消息...')\""),
    'Placeholder should be clean and concise'
  );
  assert.ok(
    !chatPageContent.includes('(支持 @提及、Markdown、拖放或粘贴)'),
    'Old bulky placeholder text should be removed'
  );

  // Verify CSS ::placeholder has nowrap and ellipsis to strictly prevent multi-line wrap
  assert.match(chatPageContent, /:deep\(\.composer-input\.ui-textarea::placeholder\)[\s\S]*?white-space:\s*nowrap/);
  assert.match(chatPageContent, /:deep\(\.composer-input\.ui-textarea::placeholder\)[\s\S]*?text-overflow:\s*ellipsis/);
  assert.match(chatPageContent, /:deep\(\.composer-input\.ui-textarea::placeholder\)[\s\S]*?overflow:\s*hidden/);
});

test('UiTextarea syncHeight does not stretch empty textarea on long placeholder', () => {
  assert.match(
    textareaContent,
    /if\s*\(!el\.value\)\s*\{\s*el\.style\.height\s*=\s*'';\s*el\.style\.overflowY\s*=\s*'hidden';\s*return;\s*\}/,
    'syncHeight should reset style.height to empty when textarea is empty'
  );
});
