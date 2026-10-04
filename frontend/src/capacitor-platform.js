import { Capacitor, registerPlugin } from "@capacitor/core";
import { initBackNavigation } from "./back-navigation.js";

const NATIVE_SERVER_STORAGE_KEY = "edgechat.nativeServerOrigin";
export const NATIVE_SERVER_PREFIX_STORAGE_KEY = "edgechat.nativeServerPrefix";
const STANDARD_ROUTES = [
	"login",
	"register",
	"admin",
	"settings",
	"drive",
	"s",
	"api",
	"files",
	"dav",
];
const MAX_NATIVE_FILE_BYTES = 20 * 1024 * 1024;
const EdgeChatNative = registerPlugin("EdgeChatNative");

export const isCapacitorAndroid =
	Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
export const NATIVE_ROOM_OPEN_EVENT = "edgechat:native-room-open";
let pendingNativeRoomTarget = null;

export async function requestNativeMicrophonePermission() {
	if (!isCapacitorAndroid) return;
	const { state } = await EdgeChatNative.requestMicrophonePermission();
	if (state !== "granted") throw new Error("native_microphone_permission_denied");
}

export async function openNativeAppSettings() {
	if (isCapacitorAndroid) await EdgeChatNative.openAppSettings();
}

export async function minimizeNativeApp() {
	if (isCapacitorAndroid) await EdgeChatNative.minimizeApp();
}

export async function exitNativeApp() {
	if (isCapacitorAndroid) await EdgeChatNative.exitApp();
}

export function queueNativeRoomTarget(target) {
	pendingNativeRoomTarget = target;
	globalThis.window?.dispatchEvent(new CustomEvent(NATIVE_ROOM_OPEN_EVENT));
}

export function consumeNativeRoomTarget() {
	const target = pendingNativeRoomTarget;
	pendingNativeRoomTarget = null;
	return target;
}

export function resolveConfiguredServerOrigin(configuredOrigin) {
	let url;
	try {
		url = new URL(String(configuredOrigin || "").trim());
	} catch {
		throw new Error("native_server_https_required");
	}
	if (url.protocol !== "https:") {
		throw new Error("native_server_https_required");
	}
	return url.origin;
}

export function resolveConfiguredServerPrefix(configuredOrigin) {
	let url;
	try {
		url = new URL(String(configuredOrigin || "").trim());
	} catch {
		return "";
	}
	if (url.protocol !== "https:") {
		return "";
	}
	const firstSeg = url.pathname.split("/").filter(Boolean)[0] || "";
	return firstSeg && !STANDARD_ROUTES.includes(firstSeg) ? `/${firstSeg}` : "";
}

export function getStoredNativeServerOrigin() {
	if (!isCapacitorAndroid) {
		return "";
	}
	const raw = globalThis.localStorage?.getItem(NATIVE_SERVER_STORAGE_KEY) || "";
	if (!raw) return "";
	try {
		return new URL(raw).origin;
	} catch {
		return raw;
	}
}

export function getStoredNativeServerPrefix() {
	if (!isCapacitorAndroid) {
		return "";
	}
	const stored = globalThis.localStorage?.getItem(NATIVE_SERVER_PREFIX_STORAGE_KEY);
	if (stored !== null && stored !== undefined) {
		return stored;
	}
	const raw = globalThis.localStorage?.getItem(NATIVE_SERVER_STORAGE_KEY) || "";
	return resolveConfiguredServerPrefix(raw);
}

export function getStoredNativeServerUrl() {
	if (!isCapacitorAndroid) {
		return "";
	}
	const origin = getStoredNativeServerOrigin();
	if (!origin) return "";
	const prefix = getStoredNativeServerPrefix();
	return `${origin}${prefix}`;
}

export function setStoredNativeServerOrigin(configuredOrigin) {
	const origin = resolveConfiguredServerOrigin(configuredOrigin);
	const prefix = resolveConfiguredServerPrefix(configuredOrigin);
	globalThis.localStorage?.setItem(NATIVE_SERVER_STORAGE_KEY, origin);
	if (prefix) {
		globalThis.localStorage?.setItem(NATIVE_SERVER_PREFIX_STORAGE_KEY, prefix);
	} else {
		globalThis.localStorage?.removeItem(NATIVE_SERVER_PREFIX_STORAGE_KEY);
	}
	return origin;
}

export function restoreStoredNativeServerOrigin(origin, prefix = "") {
	if (origin) {
		globalThis.localStorage?.setItem(NATIVE_SERVER_STORAGE_KEY, origin);
	} else {
		globalThis.localStorage?.removeItem(NATIVE_SERVER_STORAGE_KEY);
	}
	if (prefix) {
		globalThis.localStorage?.setItem(NATIVE_SERVER_PREFIX_STORAGE_KEY, prefix);
	} else {
		globalThis.localStorage?.removeItem(NATIVE_SERVER_PREFIX_STORAGE_KEY);
	}
}

export function getEdgeChatServerOrigin() {
	if (isCapacitorAndroid) {
		const storedOrigin = getStoredNativeServerOrigin();
		if (!storedOrigin) {
			throw new Error("native_server_not_configured");
		}
		return storedOrigin;
	}
	return globalThis.location?.origin || "";
}

export function resolveServerUrl(path) {
	if (!isCapacitorAndroid) {
		return path;
	}
	const prefix = getStoredNativeServerPrefix();
	if (prefix && path.startsWith("/") && !path.startsWith(`${prefix}/`) && path !== prefix) {
		path = `${prefix}${path}`;
	}
	return new URL(path, `${getEdgeChatServerOrigin()}/`).toString();
}

export function resolveServerAssetUrl(value) {
	const raw = String(value || "");
	return isCapacitorAndroid && raw.startsWith("/")
		? resolveServerUrl(raw)
		: raw;
}

export async function pickNativeFile(accept = "*/*") {
	if (!isCapacitorAndroid) {
		return null;
	}

	const result = await EdgeChatNative.pickFile({ accept });
	if (result.cancelled || !result.uri || !result.name) {
		return null;
	}

	const response = await fetch(Capacitor.convertFileSrc(result.uri));
	const blob = await response.blob();
	if (blob.size > MAX_NATIVE_FILE_BYTES) {
		throw new Error("file_too_large");
	}
	return new File([blob], result.name, {
		type: result.type || blob.type || "application/octet-stream",
	});
}

export function getNativeNotificationBridge() {
	if (!isCapacitorAndroid) {
		return null;
	}

	return {
		async checkPermission() {
			return (await EdgeChatNative.checkNotificationPermission()).state;
		},
		async requestPermission() {
			return (await EdgeChatNative.requestNotificationPermission()).state;
		},
		showNotification(notification) {
			return EdgeChatNative.showNotification(notification);
		},
	};
}

function isExternalAnchor(anchor) {
	return (
		anchor.target === "_blank" &&
		/^(https?:|mailto:|tel:)$/.test(anchor.protocol)
	);
}

export async function installCapacitorIntegration(options) {
	if (!isCapacitorAndroid) {
		return;
	}

	initBackNavigation();
	await EdgeChatNative.addListener("notificationOpened", options.onOpenRoom);
	document.addEventListener("click", (event) => {
		const anchor = event.target?.closest?.("a[href]");
		if (!(anchor instanceof HTMLAnchorElement) || !isExternalAnchor(anchor)) {
			return;
		}

		event.preventDefault();
		void EdgeChatNative.openExternal({ url: anchor.href });
	});
}
