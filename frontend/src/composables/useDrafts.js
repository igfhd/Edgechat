import { reactive } from "vue";

const draftsMap = reactive(new Map());
let isInitialized = false;

function getStorageKey(userId) {
	return `edgechat_drafts_${userId || "default"}`;
}

export function useDrafts(session) {
	function init() {
		if (isInitialized || typeof window === "undefined") return;
		try {
			const userId = session?.value?.id;
			const raw = localStorage.getItem(getStorageKey(userId));
			if (raw) {
				const parsed = JSON.parse(raw);
				Object.entries(parsed).forEach(([k, v]) => {
					if (v && typeof v === "string" && v.trim()) {
						draftsMap.set(k, v);
					}
				});
			}
		} catch {}
		isInitialized = true;
	}

	function persist() {
		if (typeof window === "undefined") return;
		try {
			const userId = session?.value?.id;
			const obj = {};
			draftsMap.forEach((v, k) => {
				if (v?.trim()) obj[k] = v;
			});
			localStorage.setItem(getStorageKey(userId), JSON.stringify(obj));
		} catch {}
	}

	function getDraft(roomKey) {
		if (!roomKey) return "";
		return draftsMap.get(roomKey) || "";
	}

	function setDraft(roomKey, text) {
		if (!roomKey) return;
		const str = String(text || "");
		if (str.trim()) {
			draftsMap.set(roomKey, str);
		} else {
			draftsMap.delete(roomKey);
		}
		persist();
	}

	function clearDraft(roomKey) {
		if (!roomKey) return;
		draftsMap.delete(roomKey);
		persist();
	}

	function hasDraft(roomKey) {
		if (!roomKey) return false;
		const val = draftsMap.get(roomKey);
		return Boolean(val?.trim());
	}

	return {
		draftsMap,
		init,
		getDraft,
		setDraft,
		clearDraft,
		hasDraft,
	};
}
