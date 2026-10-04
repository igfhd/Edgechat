import { computed, nextTick, ref, watch } from "vue";
import api from "../api.js";
import { dispatchAuthInvalid } from "../auth-storage.js";
import { getOrCreateIdentityKeyPair } from "../crypto/keystore.js";
import {
	decryptMessagePayload,
	encryptDmPayload,
	encryptMultiRecipientPayload
} from "../crypto/message-cipher.js";
import { encryptAttachmentFile } from "../crypto/attachment-cipher.js";
import { isE2eeEnvelope } from "../crypto/utils.js";
import { createRealtimeSession } from "../realtime-session.js";
import { connectRoomSocket } from "../ws.js";
import { createTrafficObfuscationManager } from "../traffic-obfuscation.js";
import { useDrafts } from "./useDrafts.js";
import store from "../store.js";

const WS_CLOSE_UNAUTHORIZED = 4401;
const WS_CLOSE_FORBIDDEN = 4403;
const WS_REASON_UNAUTHORIZED = "session_invalid";
const WS_REASON_FORBIDDEN = "room_forbidden";

export function isRoomE2ee(room) {
	if (!room) return false;
	if (room.kind === "dm") return true;
	if (room.kind === "channel" && room.isPrivate && !room.telegramBridge) return true;
	return false;
}

export function useChatRoom({
	activeRoom,
	session,
	error,
	onRoomActivity = () => {},
	onRoomAccessRevoked = () => {},
	onIncomingMessage = () => {},
	onCallSignal = () => {},
	roomApi = api,
	openRoomConnection = connectRoomSocket,
}) {
	const { getDraft, setDraft, clearDraft, hasDraft, init: initDrafts } = useDrafts(session);
	initDrafts();

	const messages = ref([]);
	const loading = ref(false);
	const wsStatus = ref("closed");
	const initialDraft = activeRoom.value ? (getDraft(activeRoom.value.kind && activeRoom.value.id ? `${activeRoom.value.kind}:${activeRoom.value.id}` : "") || "") : "";
	const composerText = ref(initialDraft);
	const pendingAttachment = ref(null);
	const sending = ref(false);
	const messagesEl = ref(null);
	const fileInputEl = ref(null);
	const typingUsers = ref(new Map());
	const publicKeyCache = new Map();
	const maxPeerReadMessageId = ref(0);
	const myLastReadMessageId = ref(0);
	const pinnedMessage = ref(null);
	let messageLoadGeneration = 0;
	let lastTypingSentAt = 0;

	const typingStatusText = computed(() => {
		const count = typingUsers.value.size;
		if (count === 0) return "";
		const currentRoom = activeRoom.value;
		if (currentRoom?.kind === "dm") {
			return "对方正在输入...";
		}
		const names = Array.from(typingUsers.value.values()).map(
			(u) => u.displayName || "成员",
		);
		if (count === 1) {
			return `${names[0]} 正在输入...`;
		}
		if (count === 2) {
			return `${names[0]}、${names[1]} 正在输入...`;
		}
		return `${names[0]}、${names[1]} 等 ${count} 人正在输入...`;
	});

	function clearAllTypingTimers() {
		for (const item of typingUsers.value.values()) {
			if (item?.timer) clearTimeout(item.timer);
		}
		typingUsers.value = new Map();
	}

	function roomKey(room = activeRoom.value) {
		return room?.kind && room?.id ? `${room.kind}:${room.id}` : "";
	}

	function isOwnMessage(message) {
		if (!message?.sender) return false;
		return (
			message.sender.kind !== "external" &&
			Number(message.sender.id) === Number(session.value?.userId)
		);
	}

	async function getRecipientPublicKey(userId, forceRefresh = false) {
		const id = Number(userId);
		if (!id) return null;
		if (!forceRefresh && publicKeyCache.has(id)) {
			return publicKeyCache.get(id);
		}
		try {
			const res = await roomApi.getUserIdentityKey(id);
			if (res?.key?.publicKey) {
				publicKeyCache.set(id, res.key.publicKey);
				return res.key.publicKey;
			}
		} catch {
			// ignore
		}
		return null;
	}

	function enrichAttachmentMetadata(attachment) {
		if (!attachment || typeof attachment !== "object") return attachment;
		if (attachment.duration && attachment.isVoice) return attachment;
		const name = String(attachment.name || "");
		const match = name.match(/^voice_(\d+)_/);
		const isVoice = Boolean(attachment.isVoice) || name.startsWith("voice_") || Boolean(match);
		let duration = attachment.duration;
		if (!duration && match) {
			duration = Math.max(1, Math.round(Number(match[1])));
		}
		return {
			...attachment,
			...(isVoice ? { isVoice: true } : {}),
			...(duration ? { duration } : {}),
		};
	}

	async function processIncomingMessage(message) {
		if (!message) return message;
		const enrichedMessage = message.attachment
			? { ...message, attachment: enrichAttachmentMetadata(message.attachment) }
			: message;

		if (!isE2eeEnvelope(message.content)) {
			return enrichedMessage;
		}

		if (session.value?.userId) {
			try {
				const keyInfo = await getOrCreateIdentityKeyPair(session.value.userId);
				const decrypted = await decryptMessagePayload({
					currentUserId: session.value.userId,
					currentUserPrivateKey: keyInfo.keyPair.privateKey,
					roomId: activeRoom.value?.id || message.roomId,
					roomKind: activeRoom.value?.kind || "dm",
					envelopeContent: message.content,
				});

				const targetAttachment = decrypted.attachment || message.attachment;
				return {
					...message,
					content: decrypted.text,
					...(targetAttachment ? { attachment: enrichAttachmentMetadata(targetAttachment) } : {}),
					isE2ee: true,
				};
			} catch {
				return {
					...message,
					content: "🔒 [端到端加密消息，当前设备暂无法解密]",
					...(message.attachment ? { attachment: enrichAttachmentMetadata(message.attachment) } : {}),
					isE2ee: true,
					e2eeError: true,
				};
			}
		}

		return enrichedMessage;
	}

	function scrollToBottom() {
		const element = messagesEl.value;
		if (element) {
			requestAnimationFrame(() => {
				element.scrollTop = element.scrollHeight;
			});
		}
	}

	function applyActiveRoomActivity(message) {
		if (!activeRoom.value || !message) {
			return;
		}

		onRoomActivity({ room: activeRoom.value, message });

		if (!isOwnMessage(message)) {
			void roomApi
				.markRoomRead(activeRoom.value.kind, activeRoom.value.id, message.id)
				.catch(() => {});
			const key = roomKey();
			if (key && roomSession.isOpenFor(key)) {
				trafficManager.enqueue(
					{ type: "mark_read", messageId: Number(message.id) },
					key,
				);
			}
		}
	}

	function isMessageRead(message) {
		if (!message?.id) return false;
		const mid = Number(message.id);
		if (mid <= maxPeerReadMessageId.value) return true;

		// 容错判断：若消息流中在当前消息之后存在对方/他人发出的消息，则说明对方必然已阅并回复了前面的消息
		const msgIndex = messages.value.findIndex((m) => Number(m.id) === mid);
		if (msgIndex !== -1) {
			const hasSubsequentPeerMessage = messages.value
				.slice(msgIndex + 1)
				.some((m) => !isOwnMessage(m) && !m.isRecalled);
			if (hasSubsequentPeerMessage) {
				return true;
			}
		}
		return false;
	}

	function handleRoomAccessRevoked() {
		const room = activeRoom.value;
		if (!room) {
			return;
		}

		disconnectSocket();
		messages.value = [];
		onRoomAccessRevoked(room);
	}

	function handleSocketClose(event) {
		const code = Number(event?.code || 0);
		const reason = String(event?.reason || "");
		if (code === WS_CLOSE_UNAUTHORIZED || reason === WS_REASON_UNAUTHORIZED) {
			dispatchAuthInvalid("Your session is no longer valid. Please sign in again.");
			return;
		}
		if (code === WS_CLOSE_FORBIDDEN || reason === WS_REASON_FORBIDDEN) {
			handleRoomAccessRevoked();
		}
	}

	const roomSession = createRealtimeSession({
		openConnection(params, handlers) {
			return openRoomConnection({
				kind: params.kind,
				roomId: params.roomId,
				...handlers,
			});
		},
		onStatus(event) {
			wsStatus.value = event.status === "reconnecting" ? "connecting" : event.status;
			if (event.status === "open") {
				const key = roomKey();
				const lastMsg = messages.value.at(-1);
				if (key && lastMsg && Number(lastMsg.id) > 0) {
					trafficManager.enqueue(
						{ type: "mark_read", messageId: Number(lastMsg.id) },
						key,
					);
				}
			}
		},
		onClose: handleSocketClose,
		async onMessage(payload, connection) {
			if (connection?.key !== roomKey()) {
				return;
			}
			if (payload.type === "cover_traffic") {
				trafficManager.markUserActivity();
				return;
			}
			if (payload.type === "ready" && Array.isArray(payload.onlineUserIds)) {
				for (const uid of payload.onlineUserIds) {
					store.setPresence(uid, true);
				}
				if (activeRoom.value?.kind !== "dm" && activeRoom.value?.id) {
					sendCallSignal({ action: "query_room_audio_state", callType: "group", roomId: activeRoom.value.id });
				}
			}
			if (payload.type === "presence" && payload.userId) {
				store.setPresence(payload.userId, payload.online, payload.lastActiveAt);
			}
			if (payload.type === "room_read" && payload.lastReadMessageId) {
				const uid = Number(payload.userId);
				if (uid !== Number(session.value?.userId)) {
					maxPeerReadMessageId.value = Math.max(
						maxPeerReadMessageId.value,
						Number(payload.lastReadMessageId || 0),
					);
				}
			}
			if (payload.type === "typing" && payload.userId) {
				const targetUid = Number(payload.userId);
				if (targetUid === Number(session.value?.userId)) {
					return;
				}
				const existing = typingUsers.value.get(targetUid);
				if (existing?.timer) {
					clearTimeout(existing.timer);
				}
				const timer = setTimeout(() => {
					typingUsers.value.delete(targetUid);
					typingUsers.value = new Map(typingUsers.value);
				}, 4000);

				const displayName = payload.displayName || "成员";
				typingUsers.value.set(targetUid, { displayName, timer });
				typingUsers.value = new Map(typingUsers.value);
			}
			if (payload.type === "message" && payload.message) {
				const senderId = Number(payload.message.sender?.id);
				if (senderId && typingUsers.value.has(senderId)) {
					const existing = typingUsers.value.get(senderId);
					if (existing?.timer) clearTimeout(existing.timer);
					typingUsers.value.delete(senderId);
					typingUsers.value = new Map(typingUsers.value);
				}
				// 收到他人发来的消息时，对方的位置至少已推进到该消息所在 ID
				if (
					payload.message.sender?.kind !== "external" &&
					senderId !== Number(session.value?.userId)
				) {
					maxPeerReadMessageId.value = Math.max(
						maxPeerReadMessageId.value,
						Number(payload.message.id || 0),
					);
				}
				const processed = await processIncomingMessage(payload.message);

				// 调和乐观发送消息：优先按 clientMsgId 匹配，或匹配自己刚发送的同内容待确认项
				const optIndex = messages.value.findIndex(
					(m) =>
						(payload.clientMsgId && m.clientMsgId === payload.clientMsgId) ||
						(m.status === "sending" &&
							isOwnMessage(m) &&
							m.content === processed.content),
				);

				if (optIndex !== -1) {
					messages.value[optIndex] = { ...processed, status: "sent" };
					messages.value = [...messages.value];
				} else if (!messages.value.some((item) => item.id === payload.message.id)) {
					messages.value = [...messages.value, processed];
				}

				applyActiveRoomActivity(processed);
				onIncomingMessage(processed, activeRoom.value);
				nextTick().then(scrollToBottom);
			}
			if (payload.type === "message_edited" && payload.message) {
				const processed = await processIncomingMessage(payload.message);
				const index = messages.value.findIndex(
					(item) => Number(item.id) === Number(processed.id),
				);
				if (index !== -1) {
					messages.value[index] = processed;
					messages.value = [...messages.value];
				}
			}
			if (payload.type === "message_deleted") {
				const messageId = Number(payload.messageId);
				const index = messages.value.findIndex(
					(message) => Number(message.id) === messageId,
				);
				if (index !== -1) {
					const targetMsg = messages.value[index];
					messages.value[index] = {
						id: messageId,
						isRecalled: true,
						recalledBy: payload.recalledBy,
						sender: targetMsg.sender || {
							id: payload.senderId,
							displayName: payload.senderDisplayName || "成员",
							kind: "local",
						},
						content: "",
						attachment: null,
						createdAt: targetMsg.createdAt,
					};
					messages.value = [...messages.value];
				}
			}
			if (payload.type === "message_reaction") {
				const messageId = Number(payload.messageId);
				const target = messages.value.find((m) => Number(m.id) === messageId);
				if (target && payload.reactions) {
					target.reactions = payload.reactions;
					messages.value = [...messages.value];
				}
			}
			if (payload.type === "room_pinned_message") {
				if (payload.pinnedMessage) {
					processIncomingMessage(payload.pinnedMessage).then((processed) => {
						pinnedMessage.value = processed;
					});
				} else {
					pinnedMessage.value = null;
				}
			}
			if (payload.type === "call_signal") {
				onCallSignal(payload);
			}
			if (payload.type === "error") {
				error.value = payload.error;
				for (let i = messages.value.length - 1; i >= 0; i--) {
					const m = messages.value[i];
					if (m.status === "sending" && isOwnMessage(m)) {
						messages.value[i] = { ...m, status: "failed" };
						messages.value = [...messages.value];
						break;
					}
				}
			}
		},
	});

	const trafficManager = createTrafficObfuscationManager({
		sendSocketMessage(frame, key) {
			return roomSession.send(frame, key);
		},
		isSocketOpen(key) {
			return roomSession.isOpenFor(key);
		},
		getActiveRoomKey() {
			return roomKey();
		},
	});

	async function loadMessages(before = null, append = false) {
		const room = activeRoom.value;
		const key = roomKey(room);
		if (!key) {
			return false;
		}

		const generation = ++messageLoadGeneration;
		loading.value = true;
		error.value = "";
		try {
			const payload = await roomApi.getMessages(room.kind, room.id, before);
			if (generation !== messageLoadGeneration || roomKey() !== key) {
				return false;
			}
			if (payload.maxPeerReadMessageId !== undefined) {
				maxPeerReadMessageId.value = Number(payload.maxPeerReadMessageId || 0);
			}
			if (payload.myLastReadMessageId !== undefined) {
				myLastReadMessageId.value = Number(payload.myLastReadMessageId || 0);
			}
			if (payload.pinnedMessage) {
				pinnedMessage.value = await processIncomingMessage(payload.pinnedMessage);
			} else if (!append) {
				pinnedMessage.value = null;
			}
			const decryptedList = await Promise.all(
				payload.messages.map((item) => processIncomingMessage(item)),
			);
			messages.value = append
				? [...decryptedList, ...messages.value]
				: decryptedList;
			await nextTick();
			if (!append) {
				scrollToBottom();
				const lastMsg = decryptedList.at(-1);
				if (lastMsg && Number(lastMsg.id) > 0) {
					const lastMid = Number(lastMsg.id);
					void roomApi.markRoomRead(room.kind, room.id, lastMid).catch(() => {});
					if (roomSession.isOpenFor(key)) {
						trafficManager.enqueue(
							{ type: "mark_read", messageId: lastMid },
							key,
							{ immediate: true },
						);
					}
				}
			}
			return true;
		} catch (currentError) {
			if (generation === messageLoadGeneration && roomKey() === key) {
				error.value = currentError.message;
			}
			return false;
		} finally {
			if (generation === messageLoadGeneration) {
				loading.value = false;
			}
		}
	}

	async function activateRoom() {
		clearAllTypingTimers();
		publicKeyCache.clear();
		messageLoadGeneration += 1;
		messages.value = [];
		loading.value = false;
		connectSocket();
		trafficManager.start();
		return loadMessages();
	}

	function deactivateRoom() {
		clearAllTypingTimers();
		publicKeyCache.clear();
		trafficManager.flush();
		trafficManager.stop();
		messageLoadGeneration += 1;
		messages.value = [];
		loading.value = false;
		disconnectSocket();
	}

	function sendTyping() {
		const now = Date.now();
		if (now - lastTypingSentAt < 2500) return;
		lastTypingSentAt = now;
		const key = roomKey();
		if (!roomSession.isOpenFor(key)) return;
		const displayName =
			session.value?.displayName || session.value?.username || "成员";
		trafficManager.enqueue(
			{ type: "typing", displayName },
			key,
			{ isTyping: true },
		);
	}

	function connectSocket() {
		if (!activeRoom.value) {
			return;
		}
		const key = roomKey();
		roomSession.connect(key, {
			kind: activeRoom.value.kind,
			roomId: activeRoom.value.id,
		});
	}

	function disconnectSocket() {
		roomSession.disconnect();
	}

	async function waitForSocketReady(key, maxWaitMs = 1500) {
		if (roomSession.isOpenFor(key)) return true;
		connectSocket();
		const startTime = Date.now();
		while (Date.now() - startTime < maxWaitMs) {
			await new Promise((resolve) => setTimeout(resolve, 60));
			if (roomSession.isOpenFor(key)) return true;
		}
		return roomSession.isOpenFor(key);
	}

	async function sendMessage(overrideText = null, retryAttachment = null, isRetry = false) {
		const key = activeRoom.value
			? `${activeRoom.value.kind}:${activeRoom.value.id}`
			: "";
		if (!key) return;

		const rawText = overrideText !== null ? overrideText : composerText.value;
		const attachmentToSend =
			retryAttachment !== null ? retryAttachment : pendingAttachment.value;

		if (!rawText.trim() && !attachmentToSend) {
			return;
		}

		const targetIsE2ee = isRoomE2ee(activeRoom.value);
		const clientMsgId = `client-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
		const optimisticMsg = {
			id: clientMsgId,
			clientMsgId,
			status: "sending",
			content: rawText,
			attachment: attachmentToSend ? { ...attachmentToSend } : null,
			createdAt: new Date().toISOString(),
			sender: {
				kind: "local",
				id: Number(session.value?.userId || session.value?.id || 0),
				username: session.value?.username || "",
				displayName: session.value?.displayName || session.value?.username || "我",
				avatarUrl: session.value?.avatarUrl || "",
				source: "edgechat",
				isAdmin: Boolean(session.value?.isAdmin),
				isOwner: Boolean(
					activeRoom.value?.kind !== "dm" &&
					!activeRoom.value?.isGeneral &&
					(activeRoom.value?.myRole === "owner" ||
						(activeRoom.value?.createdBy &&
							Number(session.value?.userId || session.value?.id) === Number(activeRoom.value.createdBy)))
				),
			},
			isE2ee: targetIsE2ee,
		};

		// 立即乐观上屏并清空输入栏与草稿
		messages.value = [...messages.value, optimisticMsg];
		clearDraft(key);
		if (!isRetry) {
			composerText.value = "";
			pendingAttachment.value = null;
		}
		nextTick().then(scrollToBottom);

		if (!roomSession.isOpenFor(key)) {
			const isReady = await waitForSocketReady(key, 1500);
			if (!isReady) {
				error.value = "聊天服务器连接中，请稍候重试";
				const idx = messages.value.findIndex(
					(m) => m.clientMsgId === clientMsgId,
				);
				if (idx !== -1) {
					messages.value[idx] = { ...messages.value[idx], status: "failed" };
					messages.value = [...messages.value];
				}
				return;
			}
		}

		sending.value = true;
		error.value = "";
		try {
			let contentToSend = rawText;

			if (targetIsE2ee && session.value?.userId) {
				const senderKeyInfo = await getOrCreateIdentityKeyPair(session.value.userId);
				if (activeRoom.value?.kind === "dm") {
					const targetUserId = activeRoom.value?.otherUser?.id;
					if (targetUserId) {
						let recipientPubKey = await getRecipientPublicKey(targetUserId);
						if (!recipientPubKey) {
							recipientPubKey = await getRecipientPublicKey(targetUserId, true);
						}
						if (recipientPubKey) {
							try {
								contentToSend = await encryptDmPayload({
									senderId: session.value.userId,
									senderKeyPair: senderKeyInfo.keyPair,
									recipientId: targetUserId,
									recipientPublicKeyBase64: recipientPubKey,
									senderPublicKeyBase64: senderKeyInfo.publicKeyBase64,
									roomId: activeRoom.value.id,
									text: rawText,
									attachment: attachmentToSend,
								});
							} catch (e2eeErr) {
								// Retry once with fresh recipient public key in case they re-logged in on another device
								recipientPubKey = await getRecipientPublicKey(targetUserId, true);
								if (recipientPubKey) {
									contentToSend = await encryptDmPayload({
										senderId: session.value.userId,
										senderKeyPair: senderKeyInfo.keyPair,
										recipientId: targetUserId,
										recipientPublicKeyBase64: recipientPubKey,
										senderPublicKeyBase64: senderKeyInfo.publicKeyBase64,
										roomId: activeRoom.value.id,
										text: rawText,
										attachment: attachmentToSend,
									});
								} else {
									throw e2eeErr;
								}
							}
						} else {
							throw new Error("未能获取对方的端到端加密公钥，请确保对方账号已正常登录并生成公钥");
						}
					}
				} else if (activeRoom.value?.kind === "channel") {
					try {
						const membersRes = await roomApi.getChannelMembers(activeRoom.value.id);
						const memberIds = (membersRes?.members || [])
							.map((m) => Number(m.userId || m.id))
							.filter(Boolean);
						if (memberIds.length > 0) {
							const batchRes = await roomApi.getBatchUserIdentityKeys(memberIds);
							const recipientKeysMap = {};
							for (const [uid, keyData] of Object.entries(batchRes?.keys || {})) {
								if (keyData?.publicKey) {
									recipientKeysMap[Number(uid)] = keyData.publicKey;
								}
							}
							if (session.value?.userId && senderKeyInfo.publicKeyBase64) {
								recipientKeysMap[Number(session.value.userId)] = senderKeyInfo.publicKeyBase64;
							}
							contentToSend = await encryptMultiRecipientPayload({
								senderId: session.value.userId,
								senderKeyPair: senderKeyInfo.keyPair,
								senderPublicKeyBase64: senderKeyInfo.publicKeyBase64,
								recipientKeysMap,
								roomId: activeRoom.value.id,
								roomKind: "channel",
								text: rawText,
								attachment: attachmentToSend,
							});
						}
					} catch (channelErr) {
						console.warn("Failed to encrypt private channel message with E2EE:", channelErr);
					}
				}
			}

			const ok = trafficManager.enqueue(
				{
					type: "send",
					clientMsgId,
					content: contentToSend,
					attachment: attachmentToSend,
				},
				key,
				{ immediate: true },
			);

			if (!ok) {
				const idx = messages.value.findIndex(
					(m) => m.clientMsgId === clientMsgId,
				);
				if (idx !== -1) {
					messages.value[idx] = { ...messages.value[idx], status: "failed" };
					messages.value = [...messages.value];
				}
			}
		} catch (currentError) {
			const msg = String(currentError?.message || "");
			const idx = messages.value.findIndex(
				(m) => m.clientMsgId === clientMsgId,
			);
			if (idx !== -1) {
				messages.value[idx] = { ...messages.value[idx], status: "failed" };
				messages.value = [...messages.value];
			}
			if (
				msg.includes("operation-specific") ||
				currentError?.name === "OperationError" ||
				currentError?.name === "NotSupportedError"
			) {
				error.value = "端到端加密失败：当前浏览器内核暂不支持 X25519 或在非安全上下文（请升级 Chrome 130+、Safari 17+ 或在 HTTPS 下访问）";
			} else {
				error.value = msg || "发送失败，请重试";
			}
		} finally {
			sending.value = false;
		}
	}

	async function retrySendMessage(failedMsg) {
		if (!failedMsg || !activeRoom.value) return;
		const msgId = failedMsg.id || failedMsg.clientMsgId;
		messages.value = messages.value.filter(
			(m) => m.id !== msgId && m.clientMsgId !== msgId,
		);
		await sendMessage(failedMsg.content, failedMsg.attachment, true);
	}

	async function deleteMessage(messageId) {
		const key = activeRoom.value
			? `${activeRoom.value.kind}:${activeRoom.value.id}`
			: "";
		if (!key) return false;

		if (!roomSession.isOpenFor(key)) {
			const isReady = await waitForSocketReady(key, 1000);
			if (!isReady) {
				error.value = "聊天服务器连接中，请稍候重试";
				return false;
			}
		}

		error.value = "";
		return trafficManager.enqueue(
			{ type: "delete_message", messageId: Number(messageId) },
			key,
			{ immediate: true },
		);
	}

	async function editMessage(messageId, text) {
		const trimmed = String(text || "").trim();
		if (!trimmed) {
			error.value = "消息内容不能为空";
			return false;
		}
		const key = activeRoom.value
			? `${activeRoom.value.kind}:${activeRoom.value.id}`
			: "";
		if (!key) return false;

		if (!roomSession.isOpenFor(key)) {
			const isReady = await waitForSocketReady(key, 1000);
			if (!isReady) {
				error.value = "聊天服务器连接中，请稍候重试";
				return false;
			}
		}

		try {
			const targetRoom = activeRoom.value;
			let contentToSend = trimmed;
			const targetIsE2ee = isRoomE2ee(targetRoom);

			if (targetIsE2ee && session.value?.userId) {
				const senderKeyInfo = await getOrCreateIdentityKeyPair(session.value.userId);
				if (targetRoom.kind === "dm") {
					const targetUserId = targetRoom.otherUser?.id;
					if (targetUserId) {
						let recipientPubKey = await getRecipientPublicKey(targetUserId);
						if (!recipientPubKey) {
							recipientPubKey = await getRecipientPublicKey(targetUserId, true);
						}
						if (recipientPubKey) {
							try {
								contentToSend = await encryptDmPayload({
									senderId: session.value.userId,
									senderKeyPair: senderKeyInfo.keyPair,
									recipientId: targetUserId,
									recipientPublicKeyBase64: recipientPubKey,
									senderPublicKeyBase64: senderKeyInfo.publicKeyBase64,
									roomId: targetRoom.id,
									text: trimmed,
								});
							} catch (e2eeErr) {
								recipientPubKey = await getRecipientPublicKey(targetUserId, true);
								if (recipientPubKey) {
									contentToSend = await encryptDmPayload({
										senderId: session.value.userId,
										senderKeyPair: senderKeyInfo.keyPair,
										recipientId: targetUserId,
										recipientPublicKeyBase64: recipientPubKey,
										senderPublicKeyBase64: senderKeyInfo.publicKeyBase64,
										roomId: targetRoom.id,
										text: trimmed,
									});
								} else {
									throw e2eeErr;
								}
							}
						} else {
							throw new Error("未能获取对方的端到端加密公钥，请确保对方账号已正常登录并生成公钥");
						}
					}
				} else if (targetRoom.kind === "channel" || targetRoom.kind === "private") {
					try {
						const membersRes = await roomApi.getChannelMembers(targetRoom.id);
						const memberIds = (membersRes?.members || [])
							.map((m) => Number(m.userId || m.id))
							.filter(Boolean);
						if (memberIds.length > 0) {
							const batchRes = await roomApi.getBatchUserIdentityKeys(memberIds);
							const recipientKeysMap = {};
							for (const [uid, keyData] of Object.entries(batchRes?.keys || {})) {
								if (keyData?.publicKey) {
									recipientKeysMap[Number(uid)] = keyData.publicKey;
								}
							}
							if (session.value?.userId && senderKeyInfo.publicKeyBase64) {
								recipientKeysMap[Number(session.value.userId)] = senderKeyInfo.publicKeyBase64;
							}
							contentToSend = await encryptMultiRecipientPayload({
								senderId: session.value.userId,
								senderKeyPair: senderKeyInfo.keyPair,
								senderPublicKeyBase64: senderKeyInfo.publicKeyBase64,
								recipientKeysMap,
								roomId: targetRoom.id,
								roomKind: targetRoom.kind,
								text: trimmed,
							});
						}
					} catch (channelErr) {
						console.warn("Failed to encrypt edited private channel message with E2EE:", channelErr);
					}
				}
			}

			error.value = "";
			return trafficManager.enqueue(
				{
					type: "edit_message",
					messageId: Number(messageId),
					content: contentToSend,
				},
				key,
				{ immediate: true },
			);
		} catch (currentError) {
			const msg = String(currentError?.message || "");
			if (
				msg.includes("operation-specific") ||
				currentError?.name === "OperationError" ||
				currentError?.name === "NotSupportedError"
			) {
				error.value = "端到端加密失败：当前浏览器内核暂不支持 X25519 或在非安全上下文（请升级 Chrome 130+、Safari 17+ 或在 HTTPS 下访问）";
			} else {
				error.value = msg || "编辑失败，请重试";
			}
			return false;
		}
	}

	function handleComposerKeydown(event) {
		if (event.key === "Enter" && !event.shiftKey) {
			event.preventDefault();
			sendMessage();
		}
	}

	const uploadingAttachment = ref(false);
	const isDraggingFile = ref(false);
	let dragCounter = 0;

	function openFilePicker() {
		fileInputEl.value?.click();
	}

	async function processAndUploadFile(file) {
		if (!file || !activeRoom.value) {
			return false;
		}

		uploadingAttachment.value = true;
		error.value = "";
		try {
			const targetIsE2ee = isRoomE2ee(activeRoom.value);
			if (targetIsE2ee) {
				const encResult = await encryptAttachmentFile(file);
				const payload = await roomApi.uploadFile(encResult.encryptedBlob, true, encResult.originalName);
				pendingAttachment.value = {
					key: payload.file.key,
					name: encResult.originalName,
					type: encResult.originalType,
					size: encResult.originalSize,
					url: payload.file.url,
					isE2ee: true,
					fileKey: encResult.fileKeyBase64,
					nonce: encResult.nonceBase64,
				};
			} else {
				const payload = await roomApi.uploadFile(file);
				pendingAttachment.value = payload.file;
			}
			return true;
		} catch (currentError) {
			error.value = currentError.message;
			return false;
		} finally {
			uploadingAttachment.value = false;
		}
	}

	async function uploadAttachment(event) {
		const file = event.target?.files?.[0];
		try {
			await processAndUploadFile(file);
		} finally {
			if (event.target) {
				event.target.value = "";
			}
		}
	}

	async function sendVoiceMessage(audioBlob, duration = 1) {
		if (!audioBlob || !activeRoom.value) return false;
		uploadingAttachment.value = true;
		error.value = "";
		try {
			const ext = audioBlob.type?.includes("wav")
				? "wav"
				: audioBlob.type?.includes("mp4")
					? "m4a"
					: audioBlob.type?.includes("ogg")
						? "ogg"
						: "webm";
			const safeDuration = Math.max(1, Math.round(duration || 1));
			const voiceFileName = `voice_${safeDuration}_${Date.now()}.${ext}`;
			const voiceFile = new File([audioBlob], voiceFileName, {
				type: audioBlob.type || "audio/webm",
			});
			const targetIsE2ee = isRoomE2ee(activeRoom.value);
			let attachmentObj = null;

			if (targetIsE2ee) {
				const encResult = await encryptAttachmentFile(voiceFile);
				const payload = await roomApi.uploadFile(encResult.encryptedBlob, true, voiceFileName);
				attachmentObj = {
					key: payload.file.key,
					name: voiceFileName,
					type: encResult.originalType,
					size: encResult.originalSize,
					url: payload.file.url,
					isE2ee: true,
					isVoice: true,
					duration: safeDuration,
					fileKey: encResult.fileKeyBase64,
					nonce: encResult.nonceBase64,
				};
			} else {
				const payload = await roomApi.uploadFile(voiceFile);
				attachmentObj = {
					...payload.file,
					name: voiceFileName,
					isVoice: true,
					duration: safeDuration,
				};
			}

			const key = activeRoom.value
				? `${activeRoom.value.kind}:${activeRoom.value.id}`
				: "";
			if (!roomSession.isOpenFor(key)) {
				error.value = "实时连接未就绪，请稍后重试。";
				return false;
			}

			let contentToSend = "";
			if (targetIsE2ee && session.value?.userId) {
				const senderKeyInfo = await getOrCreateIdentityKeyPair(session.value.userId);
				if (activeRoom.value?.kind === "dm") {
					const targetUserId = activeRoom.value?.otherUser?.id;
					if (targetUserId) {
						let recipientPubKey = await getRecipientPublicKey(targetUserId);
						if (!recipientPubKey) {
							recipientPubKey = await getRecipientPublicKey(targetUserId, true);
						}
						if (recipientPubKey) {
							contentToSend = await encryptDmPayload({
								senderId: session.value.userId,
								senderKeyPair: senderKeyInfo.keyPair,
								recipientId: targetUserId,
								recipientPublicKeyBase64: recipientPubKey,
								senderPublicKeyBase64: senderKeyInfo.publicKeyBase64,
								roomId: activeRoom.value.id,
								text: "",
								attachment: attachmentObj,
							});
						} else {
							throw new Error("未能获取对方的端到端加密公钥，请确保对方账号已正常登录并生成公钥");
						}
					}
				} else if (activeRoom.value?.kind === "channel") {
					try {
						const membersRes = await roomApi.getChannelMembers(activeRoom.value.id);
						const memberIds = (membersRes?.members || [])
							.map((m) => Number(m.userId || m.id))
							.filter(Boolean);
						if (memberIds.length > 0) {
							const batchRes = await roomApi.getBatchUserIdentityKeys(memberIds);
							const recipientKeysMap = {};
							for (const [uid, keyData] of Object.entries(batchRes?.keys || {})) {
								if (keyData?.publicKey) {
									recipientKeysMap[Number(uid)] = keyData.publicKey;
								}
							}
							if (session.value?.userId && senderKeyInfo.publicKeyBase64) {
								recipientKeysMap[Number(session.value.userId)] = senderKeyInfo.publicKeyBase64;
							}
							contentToSend = await encryptMultiRecipientPayload({
								senderId: session.value.userId,
								senderKeyPair: senderKeyInfo.keyPair,
								senderPublicKeyBase64: senderKeyInfo.publicKeyBase64,
								recipientKeysMap,
								roomId: activeRoom.value.id,
								roomKind: "channel",
								text: "",
								attachment: attachmentObj,
							});
						}
					} catch (channelErr) {
						console.warn("Failed to encrypt private channel voice message with E2EE:", channelErr);
					}
				}
			}

			trafficManager.enqueue(
				{
					type: "send",
					content: contentToSend,
					attachment: attachmentObj,
				},
				key,
				{ immediate: true },
			);
			return true;
		} catch (err) {
			error.value = err.message;
			return false;
		} finally {
			uploadingAttachment.value = false;
		}
	}

	function onDragEnter(e) {
		if (!activeRoom.value) return;
		if (e.dataTransfer?.types?.includes("Files")) {
			e.preventDefault();
			dragCounter++;
			isDraggingFile.value = true;
		}
	}

	function onDragOver(e) {
		if (!activeRoom.value) return;
		if (e.dataTransfer?.types?.includes("Files")) {
			e.preventDefault();
			e.dataTransfer.dropEffect = "copy";
			isDraggingFile.value = true;
		}
	}

	function onDragLeave(_e) {
		if (!activeRoom.value) return;
		dragCounter = Math.max(0, dragCounter - 1);
		if (dragCounter === 0) {
			isDraggingFile.value = false;
		}
	}

	async function onDrop(e) {
		if (!activeRoom.value) return;
		e.preventDefault();
		dragCounter = 0;
		isDraggingFile.value = false;
		const file = e.dataTransfer?.files?.[0];
		if (file) {
			await processAndUploadFile(file);
		}
	}

	async function onPaste(e) {
		if (!activeRoom.value) return;
		const items = e.clipboardData?.items;
		if (!items) return;
		for (let i = 0; i < items.length; i++) {
			const item = items[i];
			if (item.kind === "file") {
				const file = item.getAsFile();
				if (file) {
					e.preventDefault();
					await processAndUploadFile(file);
					break;
				}
			}
		}
	}

	function clearAttachment() {
		pendingAttachment.value = null;
	}

	async function loadOlder() {
		if (loading.value) {
			return;
		}
		const firstMessage = messages.value[0];
		if (firstMessage) {
			await loadMessages(firstMessage.id, true);
		}
	}

	watch(
		messages,
		(current, previous) => {
			const receivedNewLastMessage =
				current.length > previous.length &&
				current.at(-1)?.id !== previous.at(-1)?.id;
			if (receivedNewLastMessage) {
				nextTick().then(scrollToBottom);
			}
		},
		{ flush: "post" },
	);

	watch(
		activeRoom,
		(newRoom, oldRoom) => {
			const oldKey = roomKey(oldRoom);
			const newKey = roomKey(newRoom);
			if (oldKey === newKey) return;

			if (oldKey) {
				setDraft(oldKey, composerText.value);
			}
			if (newKey) {
				composerText.value = getDraft(newKey) || "";
			} else {
				composerText.value = "";
			}
		},
		{ flush: "sync" }
	);

	watch(composerText, (text) => {
		const key = roomKey();
		if (key) {
			setDraft(key, text);
		}
		if (text?.trim()) {
			sendTyping();
		}
	});

	function sendCallSignal(signal) {
		const key = roomKey();
		if (!key || !signal) return false;
		return roomSession.send(
			JSON.stringify({
				type: "call_signal",
				...signal,
			}),
			key,
		);
	}

	async function toggleReaction(messageId, reaction) {
		const key = roomKey();
		const mid = Number(messageId);
		if (!key || !mid || !reaction) return;
		const sent = roomSession.send(
			JSON.stringify({
				type: "toggle_reaction",
				messageId: mid,
				reaction,
			}),
			key,
		);
		if (!sent) {
			try {
				const res = await roomApi.post(`/api/messages/${mid}/reactions`, { reaction });
				const target = messages.value.find((m) => Number(m.id) === mid);
				if (target && res?.reactions) {
					target.reactions = res.reactions;
					messages.value = [...messages.value];
				}
			} catch (e) {
				console.warn('toggle reaction failed', e);
			}
		}
	}

	async function pinMessage(messageId) {
		const key = roomKey();
		const room = activeRoom.value;
		if (!room) return;
		const mid = messageId ? Number(messageId) : null;
		const sent = roomSession.send(
			JSON.stringify({
				type: "pin_message",
				messageId: mid,
			}),
			key,
		);
		if (!sent) {
			try {
				const res = await roomApi.post(`/api/channels/${room.id}/pin`, { messageId: mid });
				pinnedMessage.value = res?.pinnedMessage ? await processIncomingMessage(res.pinnedMessage) : null;
			} catch (e) {
				console.warn('pin message failed', e);
			}
		}
	}

	return {
		messages,
		pinnedMessage,
		loading,
		wsStatus,
		composerText,
		pendingAttachment,
		sending,
		typingStatusText,
		getDraft,
		setDraft,
		clearDraft,
		hasDraft,
		sendCallSignal,
		messagesEl,
		fileInputEl,
		isOwnMessage,
		loadMessages,
		activateRoom,
		deactivateRoom,
		connectSocket,
		disconnectSocket,
		sendTyping,
		sendMessage,
		retrySendMessage,
		sendVoiceMessage,
		editMessage,
		deleteMessage,
		toggleReaction,
		pinMessage,
		handleComposerKeydown,
		openFilePicker,
		uploadAttachment,
		processAndUploadFile,
		clearAttachment,
		loadOlder,
		uploadingAttachment,
		isDraggingFile,
		onDragEnter,
		onDragOver,
		onDragLeave,
		onDrop,
		onPaste,
		maxPeerReadMessageId,
		myLastReadMessageId,
		isMessageRead,
	};
}
