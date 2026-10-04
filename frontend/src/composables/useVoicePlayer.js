import { ref } from "vue";
import api from "../api.js";
import { createDecryptedBlobUrl } from "../crypto/attachment-cipher.js";

const STORAGE_KEY = "edgechat_played_voice_ids";

function loadPlayedVoiceIds() {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return new Set();
		const arr = JSON.parse(raw);
		return new Set(Array.isArray(arr) ? arr.map(Number) : []);
	} catch (_e) {
		return new Set();
	}
}

function savePlayedVoiceIds(set) {
	try {
		const arr = Array.from(set).slice(-500); // keep last 500
		localStorage.setItem(STORAGE_KEY, JSON.stringify(arr));
	} catch (_e) {
		// ignore
	}
}

const playedVoiceIds = ref(loadPlayedVoiceIds());

export function useVoicePlayer() {
	const currentPlayingMessageId = ref(null);
	const isPlaying = ref(false);
	const isLoading = ref(false);

	let currentAudio = null;
	let currentAudioContext = null;
	let currentSourceNode = null;
	const decryptedCache = new Map();

	function isVoiceMessage(msg) {
		if (!msg?.attachment) return false;
		return (
			Boolean(msg.attachment.isVoice) ||
			msg.attachment.name?.startsWith("voice_") ||
			msg.attachment.type?.startsWith("audio/") ||
			msg.attachment.mimeType?.startsWith("audio/")
		);
	}

	function isVoiceUnread(msg, isOwn = false) {
		if (isOwn) return false;
		if (!isVoiceMessage(msg)) return false;
		return !playedVoiceIds.value.has(Number(msg.id));
	}

	function markVoiceAsPlayed(msgId) {
		const idNum = Number(msgId);
		if (!idNum) return;
		if (!playedVoiceIds.value.has(idNum)) {
			playedVoiceIds.value.add(idNum);
			playedVoiceIds.value = new Set(playedVoiceIds.value);
			savePlayedVoiceIds(playedVoiceIds.value);
		}
	}

	async function getAudioUrl(msg) {
		if (!msg?.attachment) return "";
		const att = msg.attachment;

		if (decryptedCache.has(msg.id)) {
			return decryptedCache.get(msg.id);
		}

		const fileKeyOrUrl = att.key || att.url;
		if (!fileKeyOrUrl) return "";

		if (att.fileKey && att.nonce) {
			const buffer = await api.fetchFileBuffer(fileKeyOrUrl);
			const mime = att.type || att.mimeType || (att.name?.endsWith(".wav") ? "audio/wav" : "audio/webm");
			const blobUrl = await createDecryptedBlobUrl(
				buffer,
				att.fileKey,
				att.nonce,
				mime,
			);
			decryptedCache.set(msg.id, blobUrl);
			return blobUrl;
		}

		try {
			const blob = await api.fetchFileBlob(fileKeyOrUrl);
			const blobUrl = URL.createObjectURL(blob);
			decryptedCache.set(msg.id, blobUrl);
			return blobUrl;
		} catch (e) {
			console.warn("Direct audio blob fetch failed, falling back to raw url:", e);
		}

		return api.getFileUrl(fileKeyOrUrl);
	}

	function stopCurrentAudio() {
		if (currentAudio) {
			currentAudio.pause();
			currentAudio.onplay = null;
			currentAudio.onplaying = null;
			currentAudio.onended = null;
			currentAudio.onerror = null;
			currentAudio = null;
		}
		if (currentSourceNode) {
			try {
				currentSourceNode.stop();
			} catch (_e) {}
			currentSourceNode.disconnect();
			currentSourceNode = null;
		}
		if (currentAudioContext && currentAudioContext.state !== "closed") {
			try {
				currentAudioContext.close().catch(() => {});
			} catch (_e) {}
			currentAudioContext = null;
		}
		isPlaying.value = false;
		currentPlayingMessageId.value = null;
		isLoading.value = false;
	}

	function playNextUnread(currentMsg, allMessages = []) {
		if (Array.isArray(allMessages) && allMessages.length > 0) {
			const currentIndex = allMessages.findIndex(
				(m) => Number(m.id) === Number(currentMsg.id),
			);
			if (currentIndex !== -1) {
				for (let i = currentIndex + 1; i < allMessages.length; i++) {
					const nextMsg = allMessages[i];
					if (isVoiceMessage(nextMsg) && isVoiceUnread(nextMsg, false)) {
						void playVoice(nextMsg, allMessages);
						break;
					}
				}
			}
		}
	}

	async function playViaWebAudio(url, msg, allMessages) {
		try {
			const res = await fetch(url);
			const arrayBuffer = await res.arrayBuffer();
			const AudioContextClass = window.AudioContext || window.webkitAudioContext;
			if (!AudioContextClass) throw new Error("Web Audio API not supported");
			const ctx = new AudioContextClass();
			currentAudioContext = ctx;
			const audioBuffer = await ctx.decodeAudioData(arrayBuffer);

			const source = ctx.createBufferSource();
			source.buffer = audioBuffer;
			source.connect(ctx.destination);

			source.onended = () => {
				stopCurrentAudio();
				playNextUnread(msg, allMessages);
			};

			source.start(0);
			currentSourceNode = source;
			isLoading.value = false;
			isPlaying.value = true;
		} catch (err) {
			console.error("Web Audio API playback fallback failed:", err);
			stopCurrentAudio();
		}
	}

	async function playVoice(msg, allMessages = []) {
		if (!msg || !isVoiceMessage(msg)) return;

		// Toggle pause if clicking already playing voice
		if (currentPlayingMessageId.value === Number(msg.id) && isPlaying.value) {
			stopCurrentAudio();
			return;
		}

		stopCurrentAudio();
		markVoiceAsPlayed(msg.id);

		currentPlayingMessageId.value = Number(msg.id);
		isLoading.value = true;

		try {
			const url = await getAudioUrl(msg);
			if (!url || currentPlayingMessageId.value !== Number(msg.id)) {
				stopCurrentAudio();
				return;
			}

			const audio = new Audio(url);
			currentAudio = audio;

			audio.onplay = () => {
				if (currentPlayingMessageId.value === Number(msg.id)) {
					isLoading.value = false;
					isPlaying.value = true;
				}
			};

			audio.onplaying = () => {
				if (currentPlayingMessageId.value === Number(msg.id)) {
					isLoading.value = false;
					isPlaying.value = true;
				}
			};

			audio.onended = () => {
				stopCurrentAudio();
				playNextUnread(msg, allMessages);
			};

			audio.onerror = async (err) => {
				console.warn("HTML5 Audio element playback failed, falling back to Web Audio API decoder:", err);
				if (currentPlayingMessageId.value === Number(msg.id)) {
					await playViaWebAudio(url, msg, allMessages);
				} else {
					stopCurrentAudio();
				}
			};

			await audio.play();
			isLoading.value = false;
			isPlaying.value = true;
		} catch (err) {
			console.warn("Direct HTML5 audio.play() rejected, attempting Web Audio API decoder fallback:", err);
			try {
				const url = await getAudioUrl(msg);
				if (url && currentPlayingMessageId.value === Number(msg.id)) {
					await playViaWebAudio(url, msg, allMessages);
				} else {
					stopCurrentAudio();
				}
			} catch (_fallbackErr) {
				stopCurrentAudio();
			}
		}
	}

	return {
		currentPlayingMessageId,
		isPlaying,
		isLoading,
		playedVoiceIds,
		isVoiceMessage,
		isVoiceUnread,
		markVoiceAsPlayed,
		playVoice,
		stopCurrentAudio,
	};
}
