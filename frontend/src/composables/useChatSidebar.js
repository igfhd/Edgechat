import { computed, ref } from "vue";
import api from "../api.js";
import { formatLocalDate, parseUtcDate } from "../date.js";
import store from "../store.js";

const PINNED_STORAGE_KEY = "edgechat_pinned_conversations";

function getStoredPinnedKeys() {
	try {
		const raw = localStorage.getItem(PINNED_STORAGE_KEY);
		return raw ? JSON.parse(raw) : [];
	} catch {
		return [];
	}
}

function savePinnedKeys(keys) {
	try {
		localStorage.setItem(PINNED_STORAGE_KEY, JSON.stringify([...keys]));
	} catch {}
}

function mapChannelItem(channel, subtitle, isPinned = false) {
	return {
		key: `${channel.kind}:${channel.id}`,
		id: channel.id,
		kind: channel.kind,
		isGeneral: Boolean(channel.isGeneral),
		isMuted: Boolean(channel.isMuted),
		title: channel.name,
		subtitle,
		avatarUrl: channel.avatarUrl || "",
		fallback: channel.name ? channel.name.slice(0, 1) : "群",
		lastMessageAt: channel.lastMessageAt || "",
		unreadCount: Number(channel.unreadCount || 0),
		isPinned,
		source: channel,
	};
}

export function useChatSidebar({ applyActiveChannel, selectDm, sidebarApi = api }) {
	const channels = ref([]);
	const dms = ref([]);
	const users = ref([]);
	const sidebarLoading = ref(false);
	const pinnedKeys = ref(new Set(getStoredPinnedKeys()));

	function togglePinConversation(conversationKey) {
		if (!conversationKey) return;
		const next = new Set(pinnedKeys.value);
		if (next.has(conversationKey)) {
			next.delete(conversationKey);
		} else {
			next.add(conversationKey);
		}
		pinnedKeys.value = next;
		savePinnedKeys(next);
	}

	function isConversationPinned(conversationKey) {
		return pinnedKeys.value.has(conversationKey);
	}

	function compareConversations(left, right) {
		const leftPinned = pinnedKeys.value.has(left.key);
		const rightPinned = pinnedKeys.value.has(right.key);
		if (leftPinned !== rightPinned) {
			return leftPinned ? -1 : 1;
		}
		if (left.isGeneral !== right.isGeneral) {
			return left.isGeneral ? -1 : 1;
		}
		const leftTime = left.lastMessageAt
			? parseUtcDate(left.lastMessageAt)?.getTime() || 0
			: 0;
		const rightTime = right.lastMessageAt
			? parseUtcDate(right.lastMessageAt)?.getTime() || 0
			: 0;
		if (leftTime !== rightTime) {
			return rightTime - leftTime;
		}
		return left.title.localeCompare(right.title, "zh-CN");
	}

	const groupConversations = computed(() => {
		return channels.value
			.filter((channel) => channel.isMember)
			.map((channel) => {
				const key = `${channel.kind}:${channel.id}`;
				return mapChannelItem(
					channel,
					channel.isGeneral
						? "全员群组"
						: `群主 ${channel.ownerDisplayName || "未知"}`,
					pinnedKeys.value.has(key),
				);
			})
			.sort(compareConversations);
	});

	const dmConversations = computed(() => {
		const userMap = new Map((users.value || []).map((u) => [Number(u.id), u]));
		return dms.value
			.map((dm) => {
				const key = `dm:${dm.id}`;
				const fullUser = userMap.get(Number(dm.otherUser?.id));
				const userGroups = dm.otherUser?.groups?.length
					? dm.otherUser.groups
					: (fullUser?.groups || []);
				return {
					key,
					id: dm.id,
					kind: "dm",
					title: dm.otherUser.displayName,
					subtitle: `联系人 @${dm.otherUser.username}`,
					avatarUrl: dm.otherUser.avatarUrl,
					fallback: dm.otherUser.displayName,
					lastMessageAt: dm.lastMessageAt || "",
					unreadCount: Number(dm.unreadCount || 0),
					isPinned: pinnedKeys.value.has(key),
					source: dm,
					otherUser: {
						...(fullUser || {}),
						...dm.otherUser,
						groups: userGroups,
					},
					groups: userGroups,
				};
			})
			.sort(compareConversations);
	});

	const conversationItems = computed(() => {
		return [...dmConversations.value, ...groupConversations.value].sort(compareConversations);
	});

	const publicGroupItems = computed(() =>
		channels.value
			.filter((channel) => channel.kind === "public" && !channel.isMember)
			.map((channel) =>
				mapChannelItem(channel, `${Number(channel.memberCount || 0)} 位成员`),
			)
			.sort((left, right) => left.title.localeCompare(right.title, "zh-CN")),
	);

	function formatListTime(value) {
		return formatLocalDate(value);
	}

	function findConversationSource(kind, roomId) {
		const list = kind === "dm" ? dms.value : channels.value;
		return list.find(
			(item) => item.kind === kind && Number(item.id) === Number(roomId),
		);
	}

	function markConversationRead(kind, roomId) {
		const source = findConversationSource(kind, roomId);
		if (source) {
			source.unreadCount = 0;
		}
	}

	function applyConversationActivity({
		kind,
		roomId,
		lastMessageAt,
		unreadCount,
	}) {
		const source = findConversationSource(kind, roomId);
		if (!source) {
			return;
		}

		if (lastMessageAt) {
			const currentTime = source.lastMessageAt
				? parseUtcDate(source.lastMessageAt)?.getTime() || 0
				: 0;
			const nextTime = parseUtcDate(lastMessageAt)?.getTime() || 0;
			if (!currentTime || nextTime >= currentTime) {
				source.lastMessageAt = lastMessageAt;
			}
		}

		if (unreadCount !== undefined) {
			source.unreadCount = Math.max(0, Number(unreadCount || 0));
		}
	}

	async function refreshSidebar() {
		sidebarLoading.value = true;
		try {
			const payload = await sidebarApi.bootstrap();
			channels.value = payload.channels || [];
			dms.value = payload.dms || [];
			users.value = payload.users || [];
			if (Array.isArray(payload.users)) {
				store.setBatchPresence(payload.users);
			}
			if (Array.isArray(payload.dms)) {
				store.setBatchPresence(payload.dms.map((d) => d.otherUser).filter(Boolean));
			}
		} finally {
			sidebarLoading.value = false;
		}
	}

	function selectChannel(channel) {
		applyActiveChannel(channel);
	}

	async function joinPublicChannel(channel) {
		await sidebarApi.joinChannel(channel.id);
		const joinedChannel = channels.value.find(
			(item) => item.kind === channel.kind && Number(item.id) === Number(channel.id),
		);
		joinedChannel.isMember = true;
		joinedChannel.myRole = "member";
		joinedChannel.memberCount = Number(joinedChannel.memberCount || 0) + 1;
		return joinedChannel;
	}

	async function openConversation(item) {
		if (item.kind === "dm") {
			selectDm(item.source);
			markConversationRead(item.kind, item.id);
			void sidebarApi.markRoomRead(item.kind, item.id).catch(() => {});
			return;
		}

		await selectChannel(item.source);
		markConversationRead(item.kind, item.id);
		void sidebarApi.markRoomRead(item.kind, item.id).catch(() => {});
	}

	async function deleteDm(dmId) {
		const idNum = Number(dmId);
		await sidebarApi.deleteDm(idNum);
		dms.value = dms.value.filter((d) => Number(d.id) !== idNum);
		const key = `dm:${idNum}`;
		if (pinnedKeys.value.has(key)) {
			pinnedKeys.value.delete(key);
			savePinnedKeys(pinnedKeys.value);
		}
	}

	return {
		channels,
		dms,
		users,
		sidebarLoading,
		conversationItems,
		groupConversations,
		dmConversations,
		publicGroupItems,
		formatListTime,
		markConversationRead,
		applyConversationActivity,
		refreshSidebar,
		openConversation,
		joinPublicChannel,
		deleteDm,
		pinnedKeys,
		togglePinConversation,
		isConversationPinned,
	};
}
