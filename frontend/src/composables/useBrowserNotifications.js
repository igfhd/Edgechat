import { computed, ref } from "vue";
import { getNativeNotificationBridge } from "../capacitor-platform.js";

const STORAGE_KEY_PREFIX = "edgechat:browser-notifications";

export function browserNotificationRoomKey(room) {
	return room ? `${room.kind}:${Number(room.id)}` : "";
}

function loadPreferences(storage, storageKey) {
	const raw = storage?.getItem(storageKey);
	if (!raw) {
		return { enabled: false, mutedRooms: [] };
	}

	try {
		const value = JSON.parse(raw);
		return {
			enabled: value.enabled === true,
			mutedRooms: Array.isArray(value.mutedRooms) ? value.mutedRooms : [],
		};
	} catch {
		return { enabled: false, mutedRooms: [] };
	}
}

export function useBrowserNotifications(options = {}) {
	const browserWindow =
		options.browserWindow === undefined ? globalThis.window : options.browserWindow;
	const notificationApi =
		options.notificationApi === undefined
			? browserWindow?.Notification
			: options.notificationApi;
	const storage =
		options.storage === undefined ? browserWindow?.localStorage : options.storage;
	const nativeNotifications =
		options.nativeNotifications === undefined
			? getNativeNotificationBridge()
			: options.nativeNotifications;
	const storageKey = `${STORAGE_KEY_PREFIX}:${options.userId || "guest"}`;
	const savedPreferences = loadPreferences(storage, storageKey);
	const supported = computed(
		() => Boolean(nativeNotifications) || typeof notificationApi === "function",
	);
	const permission = ref(
		nativeNotifications
			? "prompt"
			: supported.value
				? notificationApi.permission
				: "unsupported",
	);
	const enabled = ref(
		savedPreferences.enabled &&
			(Boolean(nativeNotifications) || permission.value === "granted"),
	);
	const mutedRoomKeys = ref(new Set(savedPreferences.mutedRooms));

	function persistPreferences() {
		storage?.setItem(
			storageKey,
			JSON.stringify({
				enabled: enabled.value,
				mutedRooms: [...mutedRoomKeys.value],
			}),
		);
	}

	function syncPermission() {
		if (nativeNotifications) {
			return nativeNotifications.checkPermission().then((state) => {
				permission.value = state;
				if (state !== "granted" && enabled.value) {
					enabled.value = false;
					persistPreferences();
				}
				return state;
			});
		}
		permission.value = supported.value
			? notificationApi.permission
			: "unsupported";
		if (permission.value !== "granted" && enabled.value) {
			enabled.value = false;
			persistPreferences();
		}
		return Promise.resolve(permission.value);
	}

	const notificationStateLabel = computed(() => {
		if (!supported.value) return "通知不可用";
		if (permission.value === "denied") return "权限禁用";
		return enabled.value ? "通知开启" : "通知关闭";
	});

	const notificationActionLabel = computed(() => {
		if (!supported.value) return "当前浏览器不支持通知";
		if (permission.value === "denied") return "浏览器已阻止通知";
		return enabled.value ? "关闭通知" : "开启通知";
	});

	const notificationToggleDisabled = computed(
		() => !supported.value || permission.value === "denied",
	);

	async function toggleNotifications() {
		await syncPermission();
		if (notificationToggleDisabled.value) {
			return notificationActionLabel.value;
		}

		if (enabled.value) {
			enabled.value = false;
			persistPreferences();
			return notificationActionLabel.value;
		}

		if (nativeNotifications) {
			permission.value = await nativeNotifications.requestPermission();
		} else if (permission.value === "default") {
			permission.value = await notificationApi.requestPermission();
		}
		enabled.value = permission.value === "granted";
		persistPreferences();
		return notificationActionLabel.value;
	}

	function isRoomMuted(room) {
		return mutedRoomKeys.value.has(browserNotificationRoomKey(room));
	}

	function toggleRoomMuted(room) {
		const key = browserNotificationRoomKey(room);
		if (!key) return false;

		const nextMutedRooms = new Set(mutedRoomKeys.value);
		if (nextMutedRooms.has(key)) {
			nextMutedRooms.delete(key);
		} else {
			nextMutedRooms.add(key);
		}
		mutedRoomKeys.value = nextMutedRooms;
		persistPreferences();
		return nextMutedRooms.has(key);
	}

	function notifyRoom(room, message = null, { bypassMute = false } = {}) {
		void syncPermission();
		if (!enabled.value) {
			return false;
		}
		if (isRoomMuted(room) && !bypassMute) {
			return false;
		}

		let title = room?.name || "EdgeChat";
		let body = room?.kind === "dm" ? "收到一条新私信" : "收到一条新群聊消息";

		if (bypassMute) {
			title = `[有人@了你] ${room?.name || "EdgeChat"}`;
			if (message?.content) {
				body = `${message.sender?.displayName || "成员"}: ${message.content.slice(0, 80)}`;
			}
		} else if (message?.content) {
			body = `${message.sender?.displayName || "成员"}: ${message.content.slice(0, 80)}`;
		}

		if (nativeNotifications) {
			void nativeNotifications.showNotification({
				title,
				body,
				tag: `edgechat:${browserNotificationRoomKey(room)}`,
				roomKind: room.kind,
				roomId: Number(room.id),
			});
			return true;
		}

		const notification = new notificationApi(title, {
			body,
			tag: `edgechat:${browserNotificationRoomKey(room)}`,
			renotify: true,
		});
		notification.onclick = () => {
			browserWindow?.focus();
			options.onOpenRoom?.(room);
			notification.close();
		};
		return true;
	}

	return {
		notificationsEnabled: enabled,
		notificationPermission: permission,
		notificationStateLabel,
		notificationActionLabel,
		notificationToggleDisabled,
		syncNotificationPermission: syncPermission,
		toggleNotifications,
		isRoomMuted,
		toggleRoomMuted,
		notifyRoom,
	};
}
