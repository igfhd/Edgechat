/**
 * voice-effects.js - Web Audio API Digital Signal Processing (DSP) voice modulator
 */

export const VOICE_EFFECTS = [
	{ id: "original", name: "原声", icon: "🎙️", desc: "真人原声音效" },
	{ id: "cute", name: "萝莉", icon: "👧", desc: "清脆可爱童声音效" },
	{ id: "uncle", name: "大叔", icon: "🧔", desc: "沉稳磁性低声音效" },
	{ id: "robot", name: "机械", icon: "🤖", desc: "赛博电子机械音效" },
	{ id: "echo", name: "空灵", icon: "🏛️", desc: "大厅回声混响音效" },
];

/**
 * Encode an AudioBuffer into a standard 16-bit PCM WAV Blob
 */
export function audioBufferToWavBlob(audioBuffer) {
	const numChannels = audioBuffer.numberOfChannels;
	const sampleRate = audioBuffer.sampleRate;
	const format = 1; // PCM
	const bitDepth = 16;
	const numSamples = audioBuffer.length;
	const bytesPerSample = bitDepth / 8;
	const blockAlign = numChannels * bytesPerSample;
	const byteRate = sampleRate * blockAlign;
	const dataSize = numSamples * blockAlign;
	const buffer = new ArrayBuffer(44 + dataSize);
	const view = new DataView(buffer);

	function writeString(offset, string) {
		for (let i = 0; i < string.length; i++) {
			view.setUint8(offset + i, string.charCodeAt(i));
		}
	}

	// RIFF header
	writeString(0, "RIFF");
	view.setUint32(4, 36 + dataSize, true);
	writeString(8, "WAVE");

	// fmt sub-chunk
	writeString(12, "fmt ");
	view.setUint32(16, 16, true);
	view.setUint16(20, format, true);
	view.setUint16(22, numChannels, true);
	view.setUint32(24, sampleRate, true);
	view.setUint32(28, byteRate, true);
	view.setUint16(32, blockAlign, true);
	view.setUint16(34, bitDepth, true);

	// data sub-chunk
	writeString(36, "data");
	view.setUint32(40, dataSize, true);

	// Write interleaved samples
	let offset = 44;
	const channels = [];
	for (let c = 0; c < numChannels; c++) {
		channels.push(audioBuffer.getChannelData(c));
	}

	for (let i = 0; i < numSamples; i++) {
		for (let c = 0; c < numChannels; c++) {
			let s = channels[c][i];
			s = Math.max(-1, Math.min(1, s));
			const intVal = s < 0 ? s * 0x8000 : s * 0x7fff;
			view.setInt16(offset, intVal, true);
			offset += 2;
		}
	}

	return new Blob([buffer], { type: "audio/wav" });
}

/**
 * Apply pitch-shift and frequency formant filtering
 */
async function applyPitchShiftAndEq(audioBuffer, pitchRatio, preset) {
	const sampleRate = audioBuffer.sampleRate;
	const numChannels = audioBuffer.numberOfChannels;
	const targetLength = Math.max(1, Math.round(audioBuffer.length / pitchRatio));

	const offlineCtx = new (window.OfflineAudioContext ||
		window.webkitOfflineAudioContext)(numChannels, targetLength, sampleRate);

	const source = offlineCtx.createBufferSource();
	source.buffer = audioBuffer;
	source.playbackRate.value = pitchRatio;

	if (preset === "cute") {
		// High-pass filter + peaking mid-high boost for crisp voice
		const highPass = offlineCtx.createBiquadFilter();
		highPass.type = "highpass";
		highPass.frequency.value = 180;

		const peak = offlineCtx.createBiquadFilter();
		peak.type = "peaking";
		peak.frequency.value = 3200;
		peak.gain.value = 6.5;

		source.connect(highPass);
		highPass.connect(peak);
		peak.connect(offlineCtx.destination);
	} else if (preset === "uncle") {
		// Low-pass filter + low bass boost for deep male voice
		const lowPass = offlineCtx.createBiquadFilter();
		lowPass.type = "lowpass";
		lowPass.frequency.value = 1800;

		const bass = offlineCtx.createBiquadFilter();
		bass.type = "lowshelf";
		bass.frequency.value = 220;
		bass.gain.value = 7.0;

		source.connect(lowPass);
		lowPass.connect(bass);
		bass.connect(offlineCtx.destination);
	} else {
		source.connect(offlineCtx.destination);
	}

	source.start(0);
	const renderedBuffer = await offlineCtx.startRendering();
	return audioBufferToWavBlob(renderedBuffer);
}

/**
 * Apply robot / ring modulation effect
 */
async function applyRobotEffect(audioBuffer) {
	const sampleRate = audioBuffer.sampleRate;
	const numChannels = audioBuffer.numberOfChannels;
	const length = audioBuffer.length;

	const offlineCtx = new (window.OfflineAudioContext ||
		window.webkitOfflineAudioContext)(numChannels, length, sampleRate);

	// Create modulated buffer
	const robotBuffer = offlineCtx.createBuffer(numChannels, length, sampleRate);
	const carrierFreq = 54.0; // 54Hz ring modulation carrier

	for (let c = 0; c < numChannels; c++) {
		const inData = audioBuffer.getChannelData(c);
		const outData = robotBuffer.getChannelData(c);
		for (let i = 0; i < length; i++) {
			const t = i / sampleRate;
			const carrier = Math.sin(2 * Math.PI * carrierFreq * t);
			// Soft-clip distortion
			const raw = inData[i] * carrier * 1.5;
			outData[i] = Math.tanh(raw);
		}
	}

	const source = offlineCtx.createBufferSource();
	source.buffer = robotBuffer;

	// Bandpass filter for metallic walkie-talkie tone
	const bandpass = offlineCtx.createBiquadFilter();
	bandpass.type = "bandpass";
	bandpass.frequency.value = 1400;
	bandpass.Q.value = 0.8;

	source.connect(bandpass);
	bandpass.connect(offlineCtx.destination);
	source.start(0);

	const renderedBuffer = await offlineCtx.startRendering();
	return audioBufferToWavBlob(renderedBuffer);
}

/**
 * Apply echo / cathedral reverb effect
 */
async function applyEchoEffect(audioBuffer) {
	const sampleRate = audioBuffer.sampleRate;
	const numChannels = audioBuffer.numberOfChannels;
	const extraDelaySamples = Math.round(sampleRate * 0.6);
	const length = audioBuffer.length + extraDelaySamples;

	const offlineCtx = new (window.OfflineAudioContext ||
		window.webkitOfflineAudioContext)(numChannels, length, sampleRate);

	const source = offlineCtx.createBufferSource();
	source.buffer = audioBuffer;

	const delay1 = offlineCtx.createDelay();
	delay1.delayTime.value = 0.16;
	const gain1 = offlineCtx.createGain();
	gain1.gain.value = 0.42;

	const delay2 = offlineCtx.createDelay();
	delay2.delayTime.value = 0.32;
	const gain2 = offlineCtx.createGain();
	gain2.gain.value = 0.22;

	const delay3 = offlineCtx.createDelay();
	delay3.delayTime.value = 0.48;
	const gain3 = offlineCtx.createGain();
	gain3.gain.value = 0.11;

	// Dry signal
	source.connect(offlineCtx.destination);

	// Wet taps
	source.connect(delay1);
	delay1.connect(gain1);
	gain1.connect(offlineCtx.destination);

	source.connect(delay2);
	delay2.connect(gain2);
	gain2.connect(offlineCtx.destination);

	source.connect(delay3);
	delay3.connect(gain3);
	gain3.connect(offlineCtx.destination);

	source.start(0);
	const renderedBuffer = await offlineCtx.startRendering();
	return audioBufferToWavBlob(renderedBuffer);
}

/**
 * Main dispatcher to process voice modulation
 */
export async function applyVoiceEffect(audioBlob, effectId = "original") {
	if (
		!audioBlob ||
		effectId === "original" ||
		typeof window === "undefined" ||
		!(window.AudioContext || window.webkitAudioContext)
	) {
		return audioBlob;
	}

	const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
	try {
		const arrayBuffer = await audioBlob.arrayBuffer();
		const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);

		if (effectId === "cute") {
			return await applyPitchShiftAndEq(audioBuffer, 1.34, "cute");
		}
		if (effectId === "uncle") {
			return await applyPitchShiftAndEq(audioBuffer, 0.78, "uncle");
		}
		if (effectId === "robot") {
			return await applyRobotEffect(audioBuffer);
		}
		if (effectId === "echo") {
			return await applyEchoEffect(audioBuffer);
		}
		return audioBlob;
	} catch (err) {
		console.warn("Voice effect processing fallback:", err);
		return audioBlob;
	} finally {
		if (audioCtx.state !== "closed") {
			void audioCtx.close();
		}
	}
}
