import { computed, ref } from "vue";
import api from "../api.js";

export function useConversationCreation({
	users,
	dms,
	error,
	refreshSidebar,
	conversationItems,
	openConversation,
	openGroupDialog,
	conversationApi = api,
}) {
	const showAddConversation = ref(false);
	const openingDmUserId = ref(null);

	const usersWithoutDm = computed(() => {
		const existingDmUserIds = new Set(
			dms.value.map((dm) => Number(dm.otherUser?.id)),
		);
		return users.value.filter(
			(user) => !existingDmUserIds.has(Number(user.id)),
		);
	});

	function openAddConversation() {
		error.value = "";
		showAddConversation.value = true;
	}

	function closeAddConversation() {
		showAddConversation.value = false;
	}

	function startGroupCreation() {
		closeAddConversation();
		openGroupDialog();
	}

	async function openDm(user) {
		if (!user || openingDmUserId.value !== null) {
			return;
		}

		openingDmUserId.value = Number(user.id);
		error.value = "";
		try {
			const payload = await conversationApi.openDm(user.id);
			await refreshSidebar();
			const item = conversationItems.value.find(
				(conversation) =>
					conversation.kind === "dm" &&
					Number(conversation.id) === Number(payload.dm.id),
			);

			// 刷新后的侧栏投影通常包含新私聊；保留返回值兜底，避免投影延迟阻断用户进入会话。
			await openConversation(
				item || { kind: "dm", id: payload.dm.id, source: payload.dm },
			);
			closeAddConversation();
		} catch (currentError) {
			error.value = currentError.message;
		} finally {
			openingDmUserId.value = null;
		}
	}

	return {
		show: showAddConversation,
		usersWithoutDm,
		openingDmUserId,
		open: openAddConversation,
		close: closeAddConversation,
		startGroupCreation,
		openDm,
	};
}
