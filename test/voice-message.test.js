import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const voiceRecorderModule = readFileSync(
	new URL("../frontend/src/composables/useVoiceRecorder.js", import.meta.url),
	"utf8",
).replaceAll("\r\n", "\n");

const voicePlayerModule = readFileSync(
	new URL("../frontend/src/composables/useVoicePlayer.js", import.meta.url),
	"utf8",
).replaceAll("\r\n", "\n");

const voiceBubble = readFileSync(
	new URL("../frontend/src/components/chat/VoiceMessageBubble.vue", import.meta.url),
	"utf8",
).replaceAll("\r\n", "\n");

const chatRoomModule = readFileSync(
	new URL("../frontend/src/composables/useChatRoom.js", import.meta.url),
	"utf8",
).replaceAll("\r\n", "\n");

const chatPage = readFileSync(
	new URL("../frontend/src/pages/ChatPage.vue", import.meta.url),
	"utf8",
).replaceAll("\r\n", "\n");

test("useVoiceRecorder provides MediaRecorder lifecycle and slide-to-cancel support", () => {
	assert.match(voiceRecorderModule, /export function useVoiceRecorder\(\)/);
	assert.match(voiceRecorderModule, /const isRecording = ref\(false\)/);
	assert.match(voiceRecorderModule, /const isCanceling = ref\(false\)/);
	assert.match(voiceRecorderModule, /const isTooShort = ref\(false\)/);
	assert.match(voiceRecorderModule, /navigator\.mediaDevices\.getUserMedia/);
	assert.match(voiceRecorderModule, /new MediaRecorder/);
	assert.match(voiceRecorderModule, /setCanceling/);
	assert.match(voiceRecorderModule, /stopRecording/);
	assert.match(voiceRecorderModule, /cancelRecording/);
});

test("useVoicePlayer provides unread red dot tracking and consecutive auto-play queue", () => {
	assert.match(voicePlayerModule, /export function useVoicePlayer\(\)/);
	assert.match(voicePlayerModule, /const currentPlayingMessageId = ref\(null\)/);
	assert.match(voicePlayerModule, /const isPlaying = ref\(false\)/);
	assert.match(voicePlayerModule, /function isVoiceUnread/);
	assert.match(voicePlayerModule, /function markVoiceAsPlayed/);
	assert.match(voicePlayerModule, /function playVoice/);
	assert.match(voicePlayerModule, /audio\.onended/);
	// Consecutive auto-play check
	assert.match(voicePlayerModule, /for \(let i = currentIndex \+ 1; i < allMessages\.length; i\+\+\)/);
});

test("VoiceMessageBubble provides WeChat-style soundwaves, duration, and unread dot", () => {
	assert.match(voiceBubble, /class="voice-bubble"/);
	assert.match(voiceBubble, /class="voice-bubble__waves"/);
	assert.match(voiceBubble, /class="voice-wave voice-wave--1"/);
	assert.match(voiceBubble, /class="voice-wave voice-wave--2"/);
	assert.match(voiceBubble, /class="voice-wave voice-wave--3"/);
	assert.match(voiceBubble, /class="voice-unread-dot"/);
	assert.match(voiceBubble, /bubbleWidth/);
});

test("useChatRoom exposes sendVoiceMessage with E2EE support", () => {
	assert.match(chatRoomModule, /async function sendVoiceMessage\(audioBlob, duration = 1\)/);
	assert.match(chatRoomModule, /isVoice:\s*true/);
	assert.match(chatRoomModule, /sendVoiceMessage,/);
});

test("ChatPage provides inputMode switch, voice hold-to-talk button, and recording HUD", () => {
	assert.match(chatPage, /const inputMode = ref\('text'\)/);
	assert.match(chatPage, /function toggleInputMode\(\)/);
	assert.match(chatPage, /class="voice-record-btn"/);
	assert.match(chatPage, /@pointerdown\.prevent="handleVoiceStart"/);
	assert.match(chatPage, /@pointermove\.prevent="handleVoiceMove"/);
	assert.match(chatPage, /@pointerup\.prevent="handleVoiceEnd"/);
	assert.match(chatPage, /@pointercancel\.prevent="handleVoiceCancel"/);
	assert.match(chatPage, /class="voice-recording-overlay"/);
	assert.match(chatPage, /class="voice-recording-hud"/);
	assert.match(chatPage, /松开手指，取消发送/);
	assert.match(chatPage, /说话时间太短/);
	assert.match(chatPage, /VoiceMessageBubble/);
});

import { encryptDmPayload, decryptDmPayload } from "../frontend/src/crypto/message-cipher.js";
import { generateIdentityKeyPair, exportPublicKey } from "../frontend/src/crypto/x25519.js";

test("E2EE DM payload enables both sender and recipient to decrypt voice attachment", async () => {
	const senderKeyPair = await generateIdentityKeyPair();
	const recipientKeyPair = await generateIdentityKeyPair();
	const senderPubBase64 = await exportPublicKey(senderKeyPair.publicKey);
	const recipientPubBase64 = await exportPublicKey(recipientKeyPair.publicKey);

	const voiceAttachment = {
		key: "test_key_123",
		name: "voice_12345.webm",
		type: "audio/webm",
		isVoice: true,
		duration: 5,
		fileKey: "dGVzdF9maWxlX2tleV8xMjM0NTY3ODkxMjM0NTY3OA==",
		nonce: "dGVzdF9ub25jZV8xMjM="
	};

	const envelope = await encryptDmPayload({
		senderId: 101,
		senderKeyPair,
		senderPublicKeyBase64: senderPubBase64,
		recipientId: 202,
		recipientPublicKeyBase64: recipientPubBase64,
		roomId: 1,
		text: "",
		attachment: voiceAttachment
	});

	// 1. Recipient decryption
	const recipientDecrypted = await decryptDmPayload({
		currentUserId: 202,
		currentUserPrivateKey: recipientKeyPair.privateKey,
		roomId: 1,
		envelopeContent: envelope
	});
	assert.equal(recipientDecrypted.attachment?.name, "voice_12345.webm");
	assert.equal(recipientDecrypted.attachment?.fileKey, "dGVzdF9maWxlX2tleV8xMjM0NTY3ODkxMjM0NTY3OA==");
	assert.equal(recipientDecrypted.attachment?.nonce, "dGVzdF9ub25jZV8xMjM=");

	// 2. Sender decryption (crucial for sender's own voice playback!)
	const senderDecrypted = await decryptDmPayload({
		currentUserId: 101,
		currentUserPrivateKey: senderKeyPair.privateKey,
		roomId: 1,
		envelopeContent: envelope
	});
	assert.equal(senderDecrypted.attachment?.name, "voice_12345.webm");
	assert.equal(senderDecrypted.attachment?.fileKey, "dGVzdF9maWxlX2tleV8xMjM0NTY3ODkxMjM0NTY3OA==");
	assert.equal(senderDecrypted.attachment?.nonce, "dGVzdF9ub25jZV8xMjM=");
});

import { mapMessage } from "../worker/src/data/messages.js";

test("群聊普通语音消息保留时长并在 mapMessage 中正确解析", () => {
	const msgWithDuration = mapMessage({
		id: "10",
		channel_id: "1",
		content: "",
		created_at: "2026-08-24T00:00:00Z",
		sender_id: "1",
		sender_username: "alice",
		sender_display_name: "Alice",
		attachment_key: "files/voice.webm",
		attachment_name: "voice_18_1724458900000.webm",
		attachment_type: "audio/webm",
		attachment_size: "34000",
	});

	assert.equal(msgWithDuration.attachment?.isVoice, true);
	assert.equal(msgWithDuration.attachment?.duration, 18);
});
