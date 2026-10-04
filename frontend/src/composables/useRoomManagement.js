import { computed, reactive, ref, watch } from "vue";
import api from "../api.js";
import store from "../store.js";

export function useRoomManagement({
	activeRoom,
	channels,
	users,
	error,
	refreshSidebar,
	conversationItems,
	openConversation,
	canManageActiveRoom,
	onRoomDeleted = () => {},
	returnToConversationList = () => {},
	roomApi = api,
	confirmAction = (message) => window.confirm(message),
}) {
	const showCreateGroup = ref(false);
	const creatingGroup = ref(false);
	const createGroupForm = reactive({
		name: "",
		kind: "private",
		memberUserIds: [],
	});
	const groupMembers = ref([]);
	const memberLoading = ref(false);
	const inviteSubmitting = ref(false);
	const groupSettingsSaving = ref(false);
	const groupAvatarUploading = ref(false);
	const showGroupEditor = ref(false);
	const showMemberPanel = ref(false);
	const inviteUserId = ref("");
	const groupSettingsForm = reactive({
		name: "",
		avatarUrl: "",
		avatarKey: "",
	});

	const availableInviteUsers = computed(() => {
		const memberIds = new Set(
			groupMembers.value.map((member) => Number(member.id)),
		);
		return users.value.filter((user) => !memberIds.has(Number(user.id)));
	});

	function syncGroupSettingsForm() {
		groupSettingsForm.name = activeRoom.value?.name || "";
		groupSettingsForm.avatarUrl = activeRoom.value?.avatarUrl || "";
		groupSettingsForm.avatarKey = activeRoom.value?.avatarKey || "";
	}

	function openCreateGroup() {
		showCreateGroup.value = true;
	}

	function closeCreateGroup() {
		showCreateGroup.value = false;
		createGroupForm.name = "";
		createGroupForm.kind = "private";
		createGroupForm.memberUserIds = [];
	}

	function toggleCreateGroupMember(userId) {
		const index = createGroupForm.memberUserIds.indexOf(userId);
		if (index >= 0) {
			createGroupForm.memberUserIds.splice(index, 1);
			return;
		}
		createGroupForm.memberUserIds.push(userId);
	}

	async function createGroup() {
		if (!createGroupForm.name.trim()) {
			return;
		}

		creatingGroup.value = true;
		error.value = "";
		try {
			const payload = await roomApi.createGroup({
				name: createGroupForm.name.trim(),
				kind: createGroupForm.kind,
				memberUserIds: createGroupForm.memberUserIds,
			});
			await refreshSidebar();
			const item = conversationItems.value.find(
				(conversation) =>
					conversation.kind === payload.channel.kind &&
					Number(conversation.id) === Number(payload.channel.id),
			);
			if (item) {
				await openConversation(item);
			}
			closeCreateGroup();
		} catch (currentError) {
			error.value = currentError.message;
		} finally {
			creatingGroup.value = false;
		}
	}

	async function loadMembers() {
		if (!activeRoom.value || activeRoom.value.kind === "dm") {
			groupMembers.value = [];
			return;
		}

		memberLoading.value = true;
		try {
				const payload = await roomApi.getChannelMembers(activeRoom.value.id);
			groupMembers.value = payload.members;
			if (Array.isArray(payload.members)) {
				store.setBatchPresence(payload.members);
			}
			activeRoom.value.canManage = payload.room.canManage;
			activeRoom.value.myRole = payload.room.myRole;
				activeRoom.value.memberCount = payload.members.length;
				activeRoom.value.name = payload.room.name || activeRoom.value.name;
				activeRoom.value.isGeneral = Boolean(payload.room.isGeneral);
			activeRoom.value.avatarUrl = payload.room.avatarUrl || "";
			activeRoom.value.avatarKey = payload.room.avatarKey || "";
			syncGroupSettingsForm();
		} catch (currentError) {
			error.value = currentError.message;
		} finally {
			memberLoading.value = false;
		}
	}

	function openGroupEditor() {
		if (!canManageActiveRoom.value) {
			return;
		}
		syncGroupSettingsForm();
		showGroupEditor.value = true;
	}

	function closeGroupEditor() {
		showGroupEditor.value = false;
	}

	async function toggleMemberPanel() {
		showMemberPanel.value = !showMemberPanel.value;
		if (showMemberPanel.value) {
			await loadMembers();
		}
	}

	function closeMemberPanel() {
		showMemberPanel.value = false;
	}

	async function inviteMember() {
		if (!activeRoom.value || activeRoom.value.kind === "dm" || !inviteUserId.value) {
			return;
		}

		inviteSubmitting.value = true;
		error.value = "";
		try {
			const payload = await roomApi.inviteChannelMembers(activeRoom.value.id, [
				Number(inviteUserId.value),
			]);
			groupMembers.value = payload.members;
			if (Array.isArray(payload.members)) {
				store.setBatchPresence(payload.members);
			}
			activeRoom.value.memberCount = payload.members.length;
			inviteUserId.value = "";
			await refreshSidebar();
		} catch (currentError) {
			error.value = currentError.message;
		} finally {
			inviteSubmitting.value = false;
		}
	}

	async function transferOwner(member) {
		if (
			!activeRoom.value ||
			activeRoom.value.kind === "dm" ||
			activeRoom.value.isGeneral ||
			!member
		) {
			return;
		}
		if (!confirmAction(`确定要将群主转让给「${member.displayName}」吗？转让后您将成为普通成员。`)) {
			return;
		}

		try {
			const payload = await roomApi.transferChannelOwner(activeRoom.value.id, member.id);
			groupMembers.value = payload.members || [];
			if (Array.isArray(payload.members)) {
				store.setBatchPresence(payload.members);
			}
			await loadMembers();
			await refreshSidebar();
		} catch (currentError) {
			error.value = currentError.message || "转让群主失败";
			alert(error.value);
		}
	}

	async function removeMember(member) {
			if (
				!activeRoom.value ||
				activeRoom.value.kind === "dm" ||
				activeRoom.value.isGeneral
			) {
			return;
		}
		if (!confirmAction(`Remove ${member.displayName} from this group?`)) {
			return;
		}

		try {
			const payload = await roomApi.removeChannelMember(activeRoom.value.id, member.id);
			groupMembers.value = payload.members;
			if (Array.isArray(payload.members)) {
				store.setBatchPresence(payload.members);
			}
			activeRoom.value.memberCount = payload.members.length;
			await refreshSidebar();
		} catch (currentError) {
			error.value = currentError.message;
		}
	}

		async function deleteGroup() {
			if (
				!activeRoom.value ||
				activeRoom.value.kind === "dm" ||
				activeRoom.value.isGeneral
			) {
			return;
		}
		if (!confirmAction(`Delete group ${activeRoom.value.name}?`)) {
			return;
		}

		try {
			await roomApi.deleteOwnedChannel(activeRoom.value.id);
			activeRoom.value = null;
			groupMembers.value = [];
			showGroupEditor.value = false;
			showMemberPanel.value = false;
			onRoomDeleted();
			returnToConversationList();
			await refreshSidebar();
		} catch (currentError) {
			error.value = currentError.message;
		}
	}

	async function uploadGroupAvatar(event) {
		const file = event.target.files?.[0];
		if (!file || !activeRoom.value) {
			return;
		}

		groupAvatarUploading.value = true;
		error.value = "";
		try {
			const payload = await roomApi.uploadFile(file);
			groupSettingsForm.avatarUrl = payload.file.url;
			groupSettingsForm.avatarKey = payload.file.key;
		} catch (currentError) {
			error.value = currentError.message;
		} finally {
			groupAvatarUploading.value = false;
			event.target.value = "";
		}
	}

	async function saveGroupSettings() {
		if (!activeRoom.value || activeRoom.value.kind === "dm") {
			return;
		}

		const name = groupSettingsForm.name.trim();
		if (!name) {
			error.value = "Please enter a group name.";
			return;
		}

		groupSettingsSaving.value = true;
		error.value = "";
		try {
			const payload = await roomApi.updateChannel(activeRoom.value.id, {
				name,
				avatarKey: groupSettingsForm.avatarKey || null,
			});
			activeRoom.value.name = payload.channel.name;
			activeRoom.value.avatarKey = payload.channel.avatarKey || "";
			activeRoom.value.avatarUrl = payload.channel.avatarUrl || "";
			syncGroupSettingsForm();

			const channel = channels.value.find(
				(item) => Number(item.id) === Number(activeRoom.value.id),
			);
			if (channel) {
				channel.name = activeRoom.value.name;
				channel.avatarKey = activeRoom.value.avatarKey;
				channel.avatarUrl = activeRoom.value.avatarUrl;
			}
			closeGroupEditor();
			await refreshSidebar();
		} catch (currentError) {
			error.value = currentError.message;
		} finally {
			groupSettingsSaving.value = false;
		}
	}

	watch(
		() => activeRoom.value && `${activeRoom.value.kind}:${activeRoom.value.id}`,
		() => {
			groupMembers.value = [];
			inviteUserId.value = "";
			showGroupEditor.value = false;
			showMemberPanel.value = false;
			syncGroupSettingsForm();
		},
	);

	return {
		creation: {
			show: showCreateGroup,
			submitting: creatingGroup,
			form: createGroupForm,
			open: openCreateGroup,
			close: closeCreateGroup,
			toggleMember: toggleCreateGroupMember,
			submit: createGroup,
		},
		members: {
			show: showMemberPanel,
			items: groupMembers,
			loading: memberLoading,
			inviteUserId,
			availableUsers: availableInviteUsers,
			inviteSubmitting,
			toggle: toggleMemberPanel,
			close: closeMemberPanel,
			load: loadMembers,
			invite: inviteMember,
			transferOwner,
			remove: removeMember,
		},
		settings: {
			show: showGroupEditor,
			form: groupSettingsForm,
			saving: groupSettingsSaving,
			avatarUploading: groupAvatarUploading,
			open: openGroupEditor,
			close: closeGroupEditor,
			uploadAvatar: uploadGroupAvatar,
			save: saveGroupSettings,
		},
		deleteGroup,
	};
}
