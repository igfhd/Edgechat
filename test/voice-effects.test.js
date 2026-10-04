import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { VOICE_EFFECTS, audioBufferToWavBlob } from "../frontend/src/composables/voice-effects.js";

const voiceRecorderModule = readFileSync(
	new URL("../frontend/src/composables/useVoiceRecorder.js", import.meta.url),
	"utf8",
).replaceAll("\r\n", "\n");

const chatPage = readFileSync(
	new URL("../frontend/src/pages/ChatPage.vue", import.meta.url),
	"utf8",
).replaceAll("\r\n", "\n");

test("VOICE_EFFECTS provides standard preset collection (original, cute, uncle, robot, echo)", () => {
	assert.equal(VOICE_EFFECTS.length, 5);
	const ids = VOICE_EFFECTS.map((e) => e.id);
	assert.deepEqual(ids, ["original", "cute", "uncle", "robot", "echo"]);
});

test("audioBufferToWavBlob generates valid standard 16-bit PCM RIFF WAVE Blob", async () => {
	// Create mock AudioBuffer
	const sampleRate = 44100;
	const numSamples = 4410; // 0.1s
	const channelData = new Float32Array(numSamples);
	for (let i = 0; i < numSamples; i++) {
		channelData[i] = Math.sin((2 * Math.PI * 440 * i) / sampleRate);
	}

	const mockAudioBuffer = {
		numberOfChannels: 1,
		sampleRate,
		length: numSamples,
		getChannelData: () => channelData,
	};

	const wavBlob = audioBufferToWavBlob(mockAudioBuffer);
	assert.equal(wavBlob.type, "audio/wav");
	assert.equal(wavBlob.size, 44 + numSamples * 2);

	const arrayBuffer = await wavBlob.arrayBuffer();
	const view = new DataView(arrayBuffer);
	const riff = String.fromCharCode(
		view.getUint8(0),
		view.getUint8(1),
		view.getUint8(2),
		view.getUint8(3),
	);
	const wave = String.fromCharCode(
		view.getUint8(8),
		view.getUint8(9),
		view.getUint8(10),
		view.getUint8(11),
	);
	assert.equal(riff, "RIFF");
	assert.equal(wave, "WAVE");
	assert.equal(view.getUint16(20, true), 1); // PCM format
	assert.equal(view.getUint16(22, true), 1); // 1 channel
	assert.equal(view.getUint32(24, true), sampleRate);
	assert.equal(view.getUint16(34, true), 16); // 16-bit
});

test("useVoiceRecorder integrates voiceEffects and DSP processing", () => {
	assert.match(voiceRecorderModule, /import\s*\{\s*VOICE_EFFECTS,\s*applyVoiceEffect\s*\}\s*from\s*"\.\/voice-effects\.js"/);
	assert.match(voiceRecorderModule, /const currentEffect = ref/);
	assert.match(voiceRecorderModule, /function setVoiceEffect/);
	assert.match(voiceRecorderModule, /await applyVoiceEffect\(/);
});

test("ChatPage renders voice effects toolbar and recording HUD effect badge", () => {
	assert.match(chatPage, /class="composer-voice-effects-bar"/);
	assert.match(chatPage, /class="voice-effect-pill"/);
	assert.match(chatPage, /voiceRecorder\.setVoiceEffect/);
	assert.match(chatPage, /class="voice-hud-effect-tag"/);
});
