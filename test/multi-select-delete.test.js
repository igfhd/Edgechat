import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const contextMenuFile = readFileSync(
	new URL("../frontend/src/components/chat/MessageContextMenu.vue", import.meta.url),
	"utf8",
).replaceAll("\r\n", "\n");

const chatPageFile = readFileSync(
	new URL("../frontend/src/pages/ChatPage.vue", import.meta.url),
	"utf8",
).replaceAll("\r\n", "\n");

test("MessageContextMenu provides multi-select action and emits select event", () => {
	assert.match(contextMenuFile, /emit\('select'\)/);
	assert.match(contextMenuFile, /多选消息/);
	assert.match(contextMenuFile, /CheckSquare/);
});

test("ChatPage provides multi-select state, header trigger, and row selection handlers", () => {
	assert.match(chatPageFile, /const isMultiSelectMode = ref\(false\)/);
	assert.match(chatPageFile, /const selectedMessageIds = ref\(new Set\(\)\)/);
	assert.match(chatPageFile, /function enterMultiSelectMode/);
	assert.match(chatPageFile, /function exitMultiSelectMode/);
	assert.match(chatPageFile, /function toggleSelectMessage/);
	assert.match(chatPageFile, /function toggleSelectAllMessages/);
	assert.match(chatPageFile, /function handleMessageRowClick/);
	assert.match(chatPageFile, /ListChecks/);
	assert.match(chatPageFile, /class="message-select-checkbox"/);
	assert.match(chatPageFile, /message-row--multi-select/);
	assert.match(chatPageFile, /message-row--selected/);
});

test("ChatPage implements drag box selection (框选) handlers", () => {
	assert.match(chatPageFile, /const isDragSelecting = ref\(false\)/);
	assert.match(chatPageFile, /function handleDragSelectStart/);
	assert.match(chatPageFile, /function handleDragSelectMove/);
	assert.match(chatPageFile, /function handleDragSelectEnd/);
	assert.match(chatPageFile, /class="drag-selection-box"/);
});

test("ChatPage provides floating batch action bar with select-all, delete and exit controls", () => {
	assert.match(chatPageFile, /class="batch-action-bar"/);
	assert.match(chatPageFile, /class="batch-action-count"/);
	assert.match(chatPageFile, /class="batch-action-btn batch-action-btn--danger"/);
	assert.match(chatPageFile, /function handleBatchDelete/);
	assert.match(chatPageFile, /deleteMessage\(msg\.id\)/);
});

test("ChatPage renders attachment button in header actions and cleans up composer-row", () => {
	assert.match(chatPageFile, /chat-header__actions[\s\S]*?openFilePicker[\s\S]*?Paperclip/);
});
