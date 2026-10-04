import { ref } from "vue";
import { VOICE_EFFECTS, applyVoiceEffect } from "./voice-effects.js";
import { requestNativeMicrophonePermission } from "../capacitor-platform.js";

/**
 * useVoiceRecorder - WeChat-style audio recording with MediaRecorder and DSP Voice Modulator
 */
export function useVoiceRecorder() {
	const isRecording = ref(false);
	const isCanceling = ref(false);
	const duration = ref(0);
	const error = ref("");
	const isTooShort = ref(false);
	const currentEffect = ref(
		(typeof localStorage !== "undefined" &&
			localStorage.getItem("edgechat_voice_effect")) ||
			"original",
	);

	function setVoiceEffect(effectId) {
		currentEffect.value = effectId;
		if (typeof localStorage !== "undefined") {
			localStorage.setItem("edgechat_voice_effect", effectId);
		}
	}

	let activeStream = null;
	let mediaRecorder = null;
	let audioChunks = [];
	let timer = null;
	let startTime = 0;
	let mimeTypeUsed = "audio/webm";
	let isStarting = false;
	let pendingStop = false;
	let pendingCancel = false;

	function getSupportedMimeType() {
		if (typeof window === "undefined" || !window.MediaRecorder) {
			return "audio/webm";
		}
		const types = [
			"audio/webm;codecs=opus",
			"audio/webm",
			"audio/ogg;codecs=opus",
			"audio/ogg",
			"audio/mp4",
			"audio/aac",
		];
		for (const t of types) {
			if (MediaRecorder.isTypeSupported(t)) {
				return t;
			}
		}
		return "";
	}

	function isStreamLive(stream) {
		if (!stream) return false;
		const tracks = stream.getAudioTracks();
		return tracks.length > 0 && tracks.some((t) => t.readyState === "live" && t.enabled);
	}

	async function acquireAudioStream() {
		await requestNativeMicrophonePermission();
		if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
			throw new Error("当前浏览器不支持语音录制功能，或未在 HTTPS / 本地安全环境下运行。");
		}

		// If active stream is already live and warm, reuse it directly (0ms delay, no driver reinit)
		if (isStreamLive(activeStream)) {
			return activeStream;
		}

		// 1. 优先尝试开启硬件与浏览器级别的完整 DSP 降噪处理 (降噪 + 回声消除 + 自动增益控制 + 单声道人声聚焦)
		try {
			activeStream = await navigator.mediaDevices.getUserMedia({
				audio: {
					echoCancellation: true,
					noiseSuppression: true,
					autoGainControl: true,
					channelCount: 1,
				},
			});
			return activeStream;
		} catch (_dspErr) {
			// 降级尝试更宽松约束
		}

		// 2. 尝试标准音频降噪约束
		try {
			activeStream = await navigator.mediaDevices.getUserMedia({
				audio: {
					echoCancellation: true,
					noiseSuppression: true,
				},
			});
			return activeStream;
		} catch (_stdErr) {
			// 降级尝试
		}

		// 3. 扫描所有可用输入设备（针对蓝牙耳机 / USB 麦克风）
		if (navigator.mediaDevices.enumerateDevices) {
			try {
				const devices = await navigator.mediaDevices.enumerateDevices();
				const audioInputs = devices.filter((d) => d.kind === "audioinput");

				const sortedInputs = [
					...audioInputs.filter((d) => d.deviceId && d.deviceId !== "default" && d.deviceId !== "communications"),
					...audioInputs.filter((d) => d.deviceId === "default" || d.deviceId === "communications" || !d.deviceId),
				];

				for (const dev of sortedInputs) {
					if (!dev.deviceId) continue;
					try {
						activeStream = await navigator.mediaDevices.getUserMedia({
							audio: {
								deviceId: { exact: dev.deviceId },
								echoCancellation: true,
								noiseSuppression: true,
								autoGainControl: true,
								channelCount: 1,
							},
						});
						if (activeStream) return activeStream;
					} catch (_exactErr) {
						try {
							activeStream = await navigator.mediaDevices.getUserMedia({
								audio: {
									deviceId: { ideal: dev.deviceId },
									echoCancellation: true,
									noiseSuppression: true,
									autoGainControl: true,
									channelCount: 1,
								},
							});
							if (activeStream) return activeStream;
						} catch (_idealErr) {
							// Try next available device
						}
					}
				}
			} catch (enumErr) {
				if (enumErr.name === "NotFoundError" || enumErr.message?.includes("未检测到")) {
					throw enumErr;
				}
			}
		}

		// 4. 基础音频捕获保底（驱动级无约束）
		try {
			activeStream = await navigator.mediaDevices.getUserMedia({ audio: true });
			return activeStream;
		} catch (_basicErr) {
			// 抛出最终未找到设备错误
		}

		const finalErr = new Error("未找到可用的麦克风输入设备。请检查蓝牙耳机是否已连接并在系统声音设置中设为默认输入设备。");
		finalErr.name = "NotFoundError";
		throw finalErr;
	}

	async function startRecording() {
		if (isStarting || isRecording.value) {
			return false;
		}

		error.value = "";
		isTooShort.value = false;
		isCanceling.value = false;
		duration.value = 0;
		audioChunks = [];
		isStarting = true;
		pendingStop = false;
		pendingCancel = false;

		if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
			error.value = "当前浏览器不支持语音录制功能，或未在 HTTPS / 本地安全环境下运行。";
			isStarting = false;
			return false;
		}

		try {
			const stream = await acquireAudioStream();

			if (pendingCancel) {
				resetRecorder();
				isStarting = false;
				return false;
			}

			if (pendingStop) {
				resetRecorder();
				isStarting = false;
				isTooShort.value = true;
				setTimeout(() => {
					isTooShort.value = false;
				}, 1200);
				return false;
			}

			mimeTypeUsed = getSupportedMimeType();
			const recorderOptions = {
				mimeType: mimeTypeUsed || undefined,
				audioBitsPerSecond: 64000,
			};
			try {
				mediaRecorder = new MediaRecorder(stream, recorderOptions);
			} catch (_optErr) {
				mediaRecorder = new MediaRecorder(stream);
			}

			mimeTypeUsed = mediaRecorder.mimeType || mimeTypeUsed || "audio/webm";

			mediaRecorder.ondataavailable = (event) => {
				if (event.data && event.data.size > 0) {
					audioChunks.push(event.data);
				}
			};

			// Record complete container with full duration metadata
			mediaRecorder.start();
			startTime = Date.now();
			isRecording.value = true;
			isStarting = false;

			timer = setInterval(() => {
				const elapsed = (Date.now() - startTime) / 1000;
				duration.value = elapsed;
				if (elapsed >= 60) {
					// Auto stop at max 60s
					clearInterval(timer);
				}
			}, 100);

			return true;
		} catch (err) {
			console.error("Microphone permission or recording error:", err);
			if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
				error.value = "无法访问麦克风，请在浏览器地址栏检查并授予麦克风权限。";
			} else if (err.name === "NotFoundError" || err.name === "DevicesNotFoundError" || err.message?.includes("not found") || err.message?.includes("Requested device")) {
				error.value = "未找到可用的麦克风输入设备。请检查：1. 蓝牙耳机是否已连接并启用通话/免提模式；2. 在系统声音设置中将蓝牙耳机设为默认输入设备。";
			} else if (err.name === "NotReadableError" || err.name === "TrackStartError") {
				error.value = "麦克风已被其他应用程序占用，请关闭占用麦克风的软件后重试。";
			} else {
				error.value = `录音启动失败：${err.message || err.name || "未知错误"}`;
			}
			cleanup();
			isStarting = false;
			return false;
		}
	}

	function setCanceling(val) {
		isCanceling.value = Boolean(val);
	}

	function resetRecorder() {
		isRecording.value = false;
		if (timer) {
			clearInterval(timer);
			timer = null;
		}
		if (mediaRecorder && mediaRecorder.state !== "inactive") {
			try {
				mediaRecorder.stop();
			} catch (_e) {
				// ignore
			}
		}
		mediaRecorder = null;
		audioChunks = [];
	}

	async function stopRecording() {
		if (isStarting) {
			pendingStop = true;
			return null;
		}

		if (!isRecording.value || !mediaRecorder) {
			resetRecorder();
			return null;
		}

		if (timer) clearInterval(timer);
		const finalDuration = duration.value;
		isRecording.value = false;

		return new Promise((resolve) => {
			mediaRecorder.onstop = async () => {
				const actualMime = mediaRecorder?.mimeType || mimeTypeUsed || "audio/webm";
				const rawBlob = new Blob(audioChunks, { type: actualMime });
				resetRecorder();

				if (isCanceling.value) {
					resolve(null);
					return;
				}

				if (finalDuration < 1 || rawBlob.size === 0) {
					isTooShort.value = true;
					setTimeout(() => {
						isTooShort.value = false;
					}, 1200);
					resolve(null);
					return;
				}

				try {
					const processedBlob = await applyVoiceEffect(
						rawBlob,
						currentEffect.value,
					);
					resolve({
						blob: processedBlob,
						duration: Math.max(1, Math.round(finalDuration)),
						mimeType: processedBlob.type || actualMime,
					});
				} catch (err) {
					console.warn("Voice modulation failed, fallback to raw audio:", err);
					resolve({
						blob: rawBlob,
						duration: Math.max(1, Math.round(finalDuration)),
						mimeType: actualMime,
					});
				}
			};

			try {
				if (mediaRecorder.state !== "inactive") {
					mediaRecorder.stop();
				}
			} catch (_e) {
				resetRecorder();
				resolve(null);
			}
		});
	}

	function cancelRecording() {
		if (isStarting) {
			pendingCancel = true;
			return;
		}
		isCanceling.value = true;
		resetRecorder();
	}

	function cleanup() {
		isRecording.value = false;
		isStarting = false;
		pendingStop = false;
		pendingCancel = false;
		if (timer) {
			clearInterval(timer);
			timer = null;
		}
		if (activeStream) {
			activeStream.getTracks().forEach((t) => { t.stop(); });
			activeStream = null;
		}
		mediaRecorder = null;
		audioChunks = [];
	}

	return {
		isRecording,
		isCanceling,
		isTooShort,
		duration,
		error,
		currentEffect,
		setVoiceEffect,
		voiceEffects: VOICE_EFFECTS,
		startRecording,
		setCanceling,
		stopRecording,
		cancelRecording,
		cleanup,
	};
}
