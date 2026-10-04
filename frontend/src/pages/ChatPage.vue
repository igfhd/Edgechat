<script setup>
import { ArrowLeft, Bell, BellOff, Check, CheckSquare, ChevronDown, Crown, Download, Folder, Forward, Globe, Keyboard, ListChecks, Lock, Megaphone, Menu, Mic, Paperclip, Pencil, Phone, PhoneCall, Pin, Reply, Scissors, Search, Settings, Shield, Square, Trash2, User, UsersRound, Volume2, VolumeX, X } from '@lucide/vue';
import { Users } from '@lucide/vue';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { registerBackHandler } from '../back-navigation.js';
import { isDemoMode } from '../runtime.js';
import AddConversationDialog from '../components/chat/AddConversationDialog.vue';
import AnnouncementBanner from '../components/chat/AnnouncementBanner.vue';
import AnnouncementModal from '../components/chat/AnnouncementModal.vue';
import AudioCallModal from '../components/chat/AudioCallModal.vue';
import GroupAudioConferenceBar from '../components/chat/GroupAudioConferenceBar.vue';
import CreateGroupDialog from '../components/chat/CreateGroupDialog.vue';
import ExportChatDialog from '../components/chat/ExportChatDialog.vue';
import ForwardMessageModal from '../components/chat/ForwardMessageModal.vue';
import GroupSettingsDialog from '../components/chat/GroupSettingsDialog.vue';
import KeyRecoveryModal from '../components/chat/KeyRecoveryModal.vue';
import MemberPanel from '../components/chat/MemberPanel.vue';
import MessageAttachment from '../components/chat/MessageAttachment.vue';
import MessageContextMenu from '../components/chat/MessageContextMenu.vue';
import MobileNavigationDrawer from '../components/chat/MobileNavigationDrawer.vue';
import SenderSourceBadge from '../components/chat/SenderSourceBadge.vue';
import PendingAttachmentPreview from '../components/chat/PendingAttachmentPreview.vue';
import PublicGroupDiscovery from '../components/chat/PublicGroupDiscovery.vue';
import PublicGroupJoinDialog from '../components/chat/PublicGroupJoinDialog.vue';
import MarkdownContent from '../components/chat/MarkdownContent.vue';
import VoiceMessageBubble from '../components/chat/VoiceMessageBubble.vue';
import EmojiPicker from '../components/chat/EmojiPicker.vue';
import QuickReplyPicker from '../components/chat/QuickReplyPicker.vue';
import FormattingToolbar from '../components/chat/FormattingToolbar.vue';
import MentionPicker from '../components/chat/MentionPicker.vue';
import ScreenshotModal from '../components/chat/ScreenshotModal.vue';
import DriveFilePickerModal from '../components/chat/DriveFilePickerModal.vue';
import DriveFolderSelectorModal from '../components/drive/DriveFolderSelectorModal.vue';
import DriveShareCard from '../components/chat/DriveShareCard.vue';
import DriveFilePreviewModal from '../components/drive/DriveFilePreviewModal.vue';
import MessageSearchBar from '../components/chat/MessageSearchBar.vue';
import PinnedMessageBanner from '../components/chat/PinnedMessageBanner.vue';
import MessageReactions from '../components/chat/MessageReactions.vue';
import UiAvatar from '../components/ui/Avatar.vue';
import UiTextarea from '../components/ui/Textarea.vue';
import api, { apiFetch } from '../api.js';
import { createDecryptedBlobUrl } from '../crypto/attachment-cipher.js';
import { isUserMentioned } from '../mentions.js';
import { useActiveRoom } from '../composables/useActiveRoom.js';
import { useAudioCall } from '../composables/useAudioCall.js';
import { useBrowserNotifications } from '../composables/useBrowserNotifications.js';
import { useNotificationSound } from '../composables/useNotificationSound.js';
import { isRoomE2ee, useChatRoom } from '../composables/useChatRoom.js';
import { useVoiceRecorder } from '../composables/useVoiceRecorder.js';
import { useVoicePlayer } from '../composables/useVoicePlayer.js';
import { useScreenshot } from '../composables/useScreenshot.js';
import { useAnnouncements } from '../composables/useAnnouncements.js';
import { useChatSidebar } from '../composables/useChatSidebar.js';
import { useChatViewport } from '../composables/useChatViewport.js';
import { useConversationCreation } from '../composables/useConversationCreation.js';
import { useRoomManagement } from '../composables/useRoomManagement.js';
import { useUnreadInbox } from '../composables/useUnreadInbox.js';
import { useTheme } from '../composables/useTheme.js';
import { formatBubbleTime, formatDateDivider, formatLocalDateTime, formatUserPresenceStatus, isPresenceOnline, isSameDay } from '../date.js';
import store from '../store.js';
import { groupDmsByDepartment } from '../utils/userGrouping.js';

const router = useRouter();
const { isDark, toggleTheme } = useTheme();
const error = ref('');
const activeRoom = ref(null);
const showMobileNavigation = ref(false);
const showExportDialog = ref(false);
const publicGroupPreview = ref(null);
const joiningPublicGroup = ref(false);
const session = computed(() => store.session);
const showAdminEntry = computed(() => Boolean(session.value?.isAdmin));

const textareaComponentRef = ref(null);
const showEmojiPicker = ref(false);
const showQuickReplies = ref(false);
const showFormattingBar = ref(false);
const showMentionPicker = ref(false);
const mentionQuery = ref('');
const mentionPickerRef = ref(null);

function handleEmojiSelect(emoji) {
  textareaComponentRef.value?.insertEmoji(emoji);
  showEmojiPicker.value = false;
}

function handleQuickReplySelect(text) {
  textareaComponentRef.value?.insertTextAtCursor(text, '', '');
  showQuickReplies.value = false;
}

function handleFormatApply({ prefix, suffix, defaultText }) {
  textareaComponentRef.value?.insertTextAtCursor(prefix, suffix, defaultText);
  nextTick(() => {
    handleTextareaSelection();
  });
}

function handleTextareaSelection() {
  const el = textareaComponentRef.value?.textareaEl;
  if (!el) {
    showFormattingBar.value = false;
    return;
  }
  const start = el.selectionStart;
  const end = el.selectionEnd;
  if (typeof start === 'number' && typeof end === 'number' && end > start) {
    const selectedText = (el.value || '').substring(start, end).trim();
    if (selectedText.length > 0) {
      showFormattingBar.value = true;
      return;
    }
  }
  showFormattingBar.value = false;
}

function handleTextareaBlur(e) {
  if (e?.relatedTarget?.closest?.('.formatting-toolbar')) return;
  setTimeout(() => {
    const el = textareaComponentRef.value?.textareaEl;
    if (document.activeElement !== el) {
      showFormattingBar.value = false;
    }
  }, 200);
}

function handleMentionSelect(item) {
  textareaComponentRef.value?.replaceMentionAtCursor(item.insertText);
  showMentionPicker.value = false;
}

function handleTextareaKeyup() {
  handleTextareaSelection();
  checkMentionTrigger?.();
}

function toggleEmojiPicker() {
  showEmojiPicker.value = !showEmojiPicker.value;
  if (showEmojiPicker.value) {
    showQuickReplies.value = false;
    showMentionPicker.value = false;
  }
}

function toggleQuickReplies() {
  showQuickReplies.value = !showQuickReplies.value;
  if (showQuickReplies.value) {
    showEmojiPicker.value = false;
    showMentionPicker.value = false;
  }
}

function closePickers() {
  showEmojiPicker.value = false;
  showQuickReplies.value = false;
  showMentionPicker.value = false;
}

function openExportDialog() {
  showExportDialog.value = true;
}

const { activeRoomKey, canManageActiveRoom, applyActiveChannel, selectDm, roomLabel } =
  useActiveRoom({ activeRoom });
const {
  isMobileViewport,
  mobileView,
  startViewportSync,
  stopViewportSync,
  openConversationView,
  returnToConversationList
} = useChatViewport({ activeRoom });
const activeRoomAvatar = computed(() => {
  if (!activeRoom.value) return '';
  return activeRoom.value.kind === 'dm'
    ? activeRoom.value.otherUser?.avatarUrl || ''
    : activeRoom.value.avatarUrl || '';
});

const {
  channels, dms, users, sidebarLoading, conversationItems, groupConversations, dmConversations, publicGroupItems, formatListTime,
  refreshSidebar, openConversation, joinPublicChannel, deleteDm, markConversationRead, applyConversationActivity,
  togglePinConversation, isConversationPinned
} = useChatSidebar({ applyActiveChannel, selectDm });

async function confirmDeleteDm(item) {
  if (!item || item.kind !== 'dm') return;
  const targetName = item.title || '该用户';
  if (!window.confirm(`确定要删除与「${targetName}」的私聊会话吗？删除后将同时清空该私聊的历史聊天记录。`)) {
    return;
  }
  try {
    await deleteDm(item.id);
    if (activeRoom.value && activeRoom.value.kind === 'dm' && Number(activeRoom.value.id) === Number(item.id)) {
      activeRoom.value = null;
      returnToConversationList();
    }
  } catch (err) {
    alert(err.message || '删除私聊会话失败');
  }
}

const showSearchBar = ref(false);

const isGroupSectionExpanded = ref(localStorage.getItem('edgechat_group_section_expanded') === 'true');
const isDmSectionExpanded = ref(localStorage.getItem('edgechat_dm_section_expanded') !== 'false');

// 会话搜索状态与动态过滤
const conversationSearchText = ref('');
const isSearchingConversations = computed(() => Boolean(conversationSearchText.value.trim()));
const conversationSearchQuery = computed(() => conversationSearchText.value.trim().toLowerCase());

function clearConversationSearch() {
  conversationSearchText.value = '';
}

function matchesConversation(item, query) {
  if (!query) return true;
  const title = (item?.title || '').toLowerCase();
  const subtitle = (item?.subtitle || '').toLowerCase();
  const username = (item?.otherUser?.username || '').toLowerCase();
  const ownerName = (item?.source?.ownerDisplayName || '').toLowerCase();
  const groupNames = Array.isArray(item?.groups)
    ? item.groups.map((g) => (g?.name || '').toLowerCase()).join(' ')
    : '';

  const typeKeywords = [];
  if (item?.kind === 'dm') {
    typeKeywords.push('私聊', '单聊', '联系人', 'dm');
  } else if (item?.kind === 'public') {
    typeKeywords.push('公开', '公开群', 'public');
    if (item?.isGeneral) {
      typeKeywords.push('全员', '全员群', 'general');
    }
  } else if (item?.kind === 'private') {
    typeKeywords.push('私密', '私密群', '私有', 'private');
    if (item?.isGeneral) {
      typeKeywords.push('全员', '全员群', 'general');
    }
  }

  return (
    title.includes(query) ||
    subtitle.includes(query) ||
    username.includes(query) ||
    ownerName.includes(query) ||
    groupNames.includes(query) ||
    typeKeywords.some((k) => k.includes(query) || query.includes(k))
  );
}

const filteredGroupConversations = computed(() => {
  const query = conversationSearchQuery.value;
  if (!query) return groupConversations.value || [];
  return (groupConversations.value || []).filter((item) => matchesConversation(item, query));
});

const filteredDmConversations = computed(() => {
  const query = conversationSearchQuery.value;
  if (!query) return dmConversations.value || [];
  return (dmConversations.value || []).filter((item) => matchesConversation(item, query));
});

const hasAnySearchMatches = computed(() => {
  return filteredGroupConversations.value.length > 0 || filteredDmConversations.value.length > 0;
});

// 搜索状态下用户若手动折叠/展开，进行会话期临时覆盖
const searchCollapsedGroup = ref(false);
const searchCollapsedDm = ref(false);
const searchCollapsedDmGroups = ref(new Set());

// 当搜索关键字发生改变时，重置手动覆盖，确保符合条件的会话自动展开呈现
watch(conversationSearchQuery, () => {
  searchCollapsedGroup.value = false;
  searchCollapsedDm.value = false;
  searchCollapsedDmGroups.value.clear();
});

const isGroupSectionEffectiveExpanded = computed(() => {
  if (isSearchingConversations.value) {
    if (searchCollapsedGroup.value) return false;
    // 搜索有匹配项时自动展开
    return filteredGroupConversations.value.length > 0;
  }
  return isGroupSectionExpanded.value;
});

const isDmSectionEffectiveExpanded = computed(() => {
  if (isSearchingConversations.value) {
    if (searchCollapsedDm.value) return false;
    // 搜索有匹配项时自动展开
    return filteredDmConversations.value.length > 0;
  }
  return isDmSectionExpanded.value;
});

function toggleGroupSection() {
  if (isSearchingConversations.value) {
    searchCollapsedGroup.value = !searchCollapsedGroup.value;
    return;
  }
  isGroupSectionExpanded.value = !isGroupSectionExpanded.value;
  try {
    localStorage.setItem('edgechat_group_section_expanded', String(isGroupSectionExpanded.value));
  } catch {}
}

function toggleDmSection() {
  if (isSearchingConversations.value) {
    searchCollapsedDm.value = !searchCollapsedDm.value;
    return;
  }
  isDmSectionExpanded.value = !isDmSectionExpanded.value;
  try {
    localStorage.setItem('edgechat_dm_section_expanded', String(isDmSectionExpanded.value));
  } catch {}
}

const groupUnreadTotal = computed(() => {
  return (filteredGroupConversations.value || []).reduce((acc, item) => acc + (Number(item.unreadCount) || 0), 0);
});

const dmUnreadTotal = computed(() => {
  return (filteredDmConversations.value || []).reduce((acc, item) => acc + (Number(item.unreadCount) || 0), 0);
});

const dmGroupingMode = ref(localStorage.getItem('edgechat_dm_grouping_mode') || 'grouped');
const collapsedDmGroupKeys = ref(new Set());
try {
  const rawCollapsed = localStorage.getItem('edgechat_collapsed_dm_groups');
  if (rawCollapsed) {
    collapsedDmGroupKeys.value = new Set(JSON.parse(rawCollapsed));
  }
} catch {}

function toggleDmGroupingMode() {
  dmGroupingMode.value = dmGroupingMode.value === 'grouped' ? 'flat' : 'grouped';
  try {
    localStorage.setItem('edgechat_dm_grouping_mode', dmGroupingMode.value);
  } catch {}
}

const filteredGroupedDmSections = computed(() => {
  const sections = groupDmsByDepartment(filteredDmConversations.value);
  if (isSearchingConversations.value) {
    return sections.filter((s) => (s.items || []).length > 0);
  }
  return sections;
});

const hasMultipleFilteredDmGroups = computed(() => {
  return filteredGroupedDmSections.value.length > 1;
});

const filteredPinnedDms = computed(() => {
  return (filteredDmConversations.value || []).filter((d) => d.isPinned);
});

function isDmGroupEffectiveExpanded(groupId) {
  if (isSearchingConversations.value) {
    if (searchCollapsedDmGroups.value.has(groupId)) return false;
    return true; // 搜索时部门手风琴自动展开显示匹配会话
  }
  return !collapsedDmGroupKeys.value.has(groupId);
}

function toggleDmGroup(groupId) {
  if (isSearchingConversations.value) {
    const next = new Set(searchCollapsedDmGroups.value);
    if (next.has(groupId)) {
      next.delete(groupId);
    } else {
      next.add(groupId);
    }
    searchCollapsedDmGroups.value = next;
    return;
  }

  const next = new Set(collapsedDmGroupKeys.value);
  if (next.has(groupId)) {
    next.delete(groupId);
  } else {
    next.add(groupId);
  }
  collapsedDmGroupKeys.value = next;
  try {
    localStorage.setItem('edgechat_collapsed_dm_groups', JSON.stringify([...next]));
  } catch {}
}

function getGroupUnreadTotal(group) {
  return (group.items || []).reduce((sum, item) => sum + (Number(item.unreadCount) || 0), 0);
}

const {
  notificationsEnabled,
  notificationStateLabel,
  notificationActionLabel,
  notificationToggleDisabled,
  syncNotificationPermission,
  toggleNotifications,
  isRoomMuted,
  toggleRoomMuted,
  notifyRoom
} = useBrowserNotifications({
  userId: session.value?.userId,
  onOpenRoom: openRoomFromNotification
});
const activeRoomMuted = computed(() => isRoomMuted(activeRoom.value));

const {
  soundEnabled,
  toggleSound,
  setSoundEnabled,
  playMessageSound,
  playMentionSound,
  handleIncomingMessageSound
} = useNotificationSound();

function handleRoomActivity({ room, message }) {
  applyConversationActivity({
    kind: room.kind,
    roomId: room.id,
    lastMessageAt: message.createdAt,
    unreadCount: 0
  });
  markConversationRead(room.kind, room.id);
}

function handleRoomAccessRevoked(room) {
  const roomName = room.name || 'this private room';
  error.value = room.kind === 'private'
    ? `You no longer have access to "${roomName}".`
    : 'You no longer have access to this room.';
  activeRoom.value = null;
  returnToConversationList();
  void refreshSidebar();
}

let sendCallSignalRef = null;

const isCurrentRoomOwner = computed(() =>
  Boolean(activeRoom.value?.ownerUserId && (session.value?.userId || session.value?.id) && Number(activeRoom.value.ownerUserId) === Number(session.value.userId || session.value.id))
);

const audioCall = useAudioCall({
  sendSignal(signal) {
    if (sendCallSignalRef) {
      sendCallSignalRef({
        ...signal,
        displayName: session.value?.displayName || session.value?.username || '成员',
        avatarUrl: session.value?.avatarUrl || null
      });
    }
  },
  currentUserId: () => (session.value?.userId !== undefined ? session.value.userId : session.value?.id),
  currentUserName: () => session.value?.displayName || session.value?.username || '管理员',
  currentUserRole: () => (isCurrentRoomOwner.value ? 'owner' : (canManageActiveRoom.value || session.value?.isAdmin ? 'admin' : 'member')),
  onError(msg) {
    error.value = msg;
  },
  onNotice(msg) {
    error.value = msg;
  }
});

const {
  messages, pinnedMessage, loading, wsStatus, composerText, pendingAttachment, sending, typingStatusText,
  getDraft, setDraft, clearDraft, hasDraft,
  messagesEl, fileInputEl, isOwnMessage, sendCallSignal,
  loadMessages, activateRoom, deactivateRoom, disconnectSocket, sendMessage, retrySendMessage, sendVoiceMessage, editMessage, deleteMessage, handleComposerKeydown,
  openFilePicker, uploadAttachment, processAndUploadFile, clearAttachment, loadOlder,
  uploadingAttachment, isDraggingFile, onDragEnter, onDragOver, onDragLeave, onDrop, onPaste,
  isMessageRead, maxPeerReadMessageId, toggleReaction, pinMessage
} = useChatRoom({
  activeRoom,
  session,
  error,
  onRoomActivity: handleRoomActivity,
  onRoomAccessRevoked: handleRoomAccessRevoked,
  onIncomingMessage: (msg, room) => {
    handleIncomingMessageSound(msg, room, {
      session: session.value,
      isMuted: isRoomMuted(room)
    });
  },
  onCallSignal: (packet) => handleCallSignal(packet)
});

sendCallSignalRef = sendCallSignal;

const activeGroupMeetings = ref(new Map());
const activeGroupMeetingRevisions = ref(new Map());

function handleCallSignal(packet) {
  if (!packet || packet.type !== 'call_signal') return;
  if (packet.callType === 'group' && packet.roomId) {
    const rid = Number(packet.roomId);
    const revision = packet.roomAudioRevision == null ? null : Number(packet.roomAudioRevision);
    if (revision !== null && Number.isFinite(revision)) {
      const lastRevision = activeGroupMeetingRevisions.value.get(rid) || 0;
      if (revision < lastRevision) return;
      activeGroupMeetingRevisions.value.set(rid, revision);
    }
    if (packet.action === 'room_audio_state') {
      const parts = Array.isArray(packet.participants) ? packet.participants : [];
      if (parts.length > 0) {
        activeGroupMeetings.value.set(rid, parts);
      } else {
        activeGroupMeetings.value.delete(rid);
      }
      activeGroupMeetings.value = new Map(activeGroupMeetings.value);
    } else if (packet.action === 'join' || packet.action === 'track_published') {
      const current = activeGroupMeetings.value.get(rid) || [];
      const exists = current.find((p) => Number(p.userId) === Number(packet.senderId));
      if (!exists) {
        activeGroupMeetings.value.set(rid, [
          ...current,
          {
            userId: packet.senderId,
            displayName: packet.displayName || '成员',
            avatarUrl: packet.avatarUrl,
            sessionId: packet.sessionId,
            trackName: packet.trackName
          }
        ]);
        activeGroupMeetings.value = new Map(activeGroupMeetings.value);
      }
    } else if (packet.action === 'leave' || packet.action === 'hangup') {
      const current = activeGroupMeetings.value.get(rid) || [];
      const filtered = current.filter((p) => Number(p.userId) !== Number(packet.senderId));
      if (filtered.length > 0) {
        activeGroupMeetings.value.set(rid, filtered);
      } else {
        activeGroupMeetings.value.delete(rid);
      }
      activeGroupMeetings.value = new Map(activeGroupMeetings.value);
    }
  }
  audioCall.handleIncomingSignal(packet);
}

const isJoinedToActiveMeeting = computed(() =>
  audioCall.callType.value === 'group' &&
  audioCall.isConnected.value &&
  Number(audioCall.currentRoom.value?.id) === Number(activeRoom.value?.id)
);

const showGroupAudioBar = computed(() => {
  if (!activeRoom.value || activeRoom.value.kind === 'dm') return false;
  const rid = Number(activeRoom.value.id);
  const meetingParticipants = activeGroupMeetings.value.get(rid);
  const isMeetingActive = Boolean(meetingParticipants && meetingParticipants.length > 0);
  return isJoinedToActiveMeeting.value || isMeetingActive;
});

function isGroupCallInvite(content) {
  return typeof content === 'string' && (
    content.includes('发起了群聊语音会议') ||
    content.includes('[GROUP_VOICE_CONFERENCE_INVITE]')
  );
}

const currentGroupParticipantsCount = computed(() => {
  if (!activeRoom.value) return 1;
  const rid = Number(activeRoom.value.id);
  if (audioCall.isConnected.value && Number(audioCall.currentRoom.value?.id) === rid) {
    return audioCall.groupParticipants.value.length + 1;
  }
  const meetingParticipants = activeGroupMeetings.value.get(rid);
  return meetingParticipants?.length || 1;
});

const {
  isCapturing: isCapturingScreen,
  screenshotImage,
  showModal: showScreenshotModal,
  error: screenshotError,
  captureScreen,
  closeScreenshotModal
} = useScreenshot();

async function handleTriggerScreenshot() {
  try {
    await captureScreen();
  } catch (err) {
    if (err.message) {
      error.value = err.message;
    }
  }
}

async function handleScreenshotConfirm(payload) {
  const file = payload?.file || payload;
  const autoSend = payload?.autoSend !== undefined ? payload.autoSend : true;
  closeScreenshotModal();
  if (!file) return;

  try {
    const ok = await processAndUploadFile(file);
    if (ok && autoSend) {
      await sendMessage();
    }
  } catch (err) {
    error.value = err?.message || '发送截图失败';
  }
}

const siteCallsEnabled = ref(true);
async function checkSiteCallsEnabled() {
  try {
    const siteData = await api.getSite();
    if (siteData?.site) {
      siteCallsEnabled.value = siteData.site.callsEnabled !== false;
    }
  } catch {}
}

async function handleCallButtonClick() {
  if (!activeRoom.value) return;
  if (activeRoom.value.kind === 'dm') {
    const other = activeRoom.value.otherUser || { id: activeRoom.value.id, displayName: activeRoom.value.name, avatarUrl: activeRoom.value.avatarUrl };
    const presence = store.getUserPresence(other.id);
    const isOnline = isPresenceOnline(
      presence.lastActiveAt || other.lastActiveAt,
      presence.online
    );
    if (!isOnline) {
      error.value = `「${other.displayName || '对方'}」当前不在线，无法发起语音电话`;
      return;
    }
    await audioCall.startDmCall(activeRoom.value, other);
  } else {
    await audioCall.joinGroupMeeting(activeRoom.value);
  }
}

const notifyGroupCooldown = ref(false);
const notifyGroupSuccess = ref(false);
async function notifyGroupAboutMeeting() {
  if (!activeRoom.value || activeRoom.value.kind === 'dm' || notifyGroupCooldown.value) return;
  try {
    sendCallSignalRef?.({
      action: 'notify_group',
      callType: 'group',
      roomId: activeRoom.value.id
    });
    await sendMessage('📞 发起了群聊语音会议，点击聊天界面顶部横幅或下方卡片即可一键加入！');
    notifyGroupSuccess.value = true;
    notifyGroupCooldown.value = true;
    setTimeout(() => {
      notifyGroupSuccess.value = false;
    }, 3000);
    setTimeout(() => {
      notifyGroupCooldown.value = false;
    }, 15000);
  } catch (err) {
    error.value = `发送群通知失败: ${err.message}`;
  }
}

const { connectUnreadInbox, disconnectUnreadInbox } = useUnreadInbox({
  activeRoom,
  markConversationRead,
  applyConversationActivity,
  notifyRoom,
  onIncomingMessage: (msg, room) => {
    handleIncomingMessageSound(msg, room, {
      session: session.value,
      isMuted: isRoomMuted(room)
    });
  },
  onCallSignal: (packet) => handleCallSignal(packet)
});

const wsConnected = computed(() => wsStatus.value === 'open');

function getSenderAvatar(msg) {
  if (isOwnMessage(msg)) {
    return session.value?.avatarUrl || msg.sender?.avatarUrl || '';
  }
  return msg.sender?.avatarUrl || '';
}

const dmOtherUserPresence = computed(() => {
  if (activeRoom.value?.kind !== 'dm' || !activeRoom.value?.otherUser) {
    return null;
  }
  const uid = activeRoom.value.otherUser.id;
  const presence = store.getUserPresence(uid);
  const isOnline = isPresenceOnline(
    presence.lastActiveAt || activeRoom.value.otherUser.lastActiveAt,
    presence.online
  );
  const text = formatUserPresenceStatus(
    presence.lastActiveAt || activeRoom.value.otherUser.lastActiveAt,
    isOnline
  );
  return { isOnline, text };
});

function isConversationOnline(item) {
  if (item.kind !== 'dm' || !item.source?.otherUser) return false;
  const uid = item.source.otherUser.id;
  const presence = store.getUserPresence(uid);
  return isPresenceOnline(
    presence.lastActiveAt || item.source.otherUser.lastActiveAt,
    presence.online
  );
}

function isSenderPresenceApplicable(sender) {
  return Boolean(sender?.id && sender.source !== 'telegram');
}

function isSenderOnline(sender) {
  if (!sender?.id || sender.source === 'telegram') return false;
  const uid = Number(sender.id);
  const presence = store.getUserPresence(uid);
  return isPresenceOnline(presence.lastActiveAt, presence.online);
}

// 精心调配的 12 套现代 IM 群聊成员色彩主题（符合 WCAG AA/AAA 对比度标准，完美适配浅色与暗黑模式）
const SENDER_PALETTES = [
  { // 0: 晴空蓝 (Sky Blue)
    light: { bg: '#eff6ff', border: 'rgba(59, 130, 246, 0.25)', name: '#1d4ed8' },
    dark:  { bg: '#111e33', border: 'rgba(96, 165, 250, 0.35)', name: '#60a5fa' }
  },
  { // 1: 紫罗兰 (Violet)
    light: { bg: '#f5f3ff', border: 'rgba(139, 92, 246, 0.25)', name: '#6d28d9' },
    dark:  { bg: '#201633', border: 'rgba(192, 132, 252, 0.35)', name: '#c084fc' }
  },
  { // 2: 玫瑰红 (Rose)
    light: { bg: '#fff1f2', border: 'rgba(244, 63, 94, 0.25)', name: '#be123c' },
    dark:  { bg: '#2b141e', border: 'rgba(251, 113, 133, 0.35)', name: '#fb7185' }
  },
  { // 3: 暖琥珀 (Amber)
    light: { bg: '#fffbeb', border: 'rgba(245, 158, 11, 0.28)', name: '#b45309' },
    dark:  { bg: '#261b0a', border: 'rgba(251, 191, 36, 0.35)', name: '#fbbf24' }
  },
  { // 4: 碧海青 (Teal)
    light: { bg: '#f0fdfa', border: 'rgba(20, 184, 166, 0.25)', name: '#0f766e' },
    dark:  { bg: '#0c2422', border: 'rgba(45, 212, 191, 0.35)', name: '#2dd4bf' }
  },
  { // 5: 靓靛青 (Indigo)
    light: { bg: '#eef2ff', border: 'rgba(99, 102, 241, 0.25)', name: '#4338ca' },
    dark:  { bg: '#171738', border: 'rgba(129, 140, 248, 0.35)', name: '#818cf8' }
  },
  { // 6: 翡翠绿 (Emerald)
    light: { bg: '#ecfdf5', border: 'rgba(16, 185, 129, 0.25)', name: '#047857' },
    dark:  { bg: '#092419', border: 'rgba(52, 211, 153, 0.35)', name: '#34d399' }
  },
  { // 7: 澄湖蓝 (Cyan)
    light: { bg: '#ecfeff', border: 'rgba(6, 182, 212, 0.25)', name: '#0e7490' },
    dark:  { bg: '#092329', border: 'rgba(34, 211, 238, 0.35)', name: '#22d3ee' }
  },
  { // 8: 魅惑紫 (Fuchsia)
    light: { bg: '#fdf4ff', border: 'rgba(217, 70, 239, 0.25)', name: '#a21caf' },
    dark:  { bg: '#26122d', border: 'rgba(232, 121, 249, 0.35)', name: '#e879f9' }
  },
  { // 9: 暖橙色 (Warm Orange)
    light: { bg: '#fff7ed', border: 'rgba(249, 115, 22, 0.25)', name: '#c2410c' },
    dark:  { bg: '#28150c', border: 'rgba(251, 146, 60, 0.35)', name: '#fb923c' }
  },
  { // 10: 青柠绿 (Lime)
    light: { bg: '#f7fee7', border: 'rgba(132, 204, 22, 0.25)', name: '#4d7c0f' },
    dark:  { bg: '#152208', border: 'rgba(163, 230, 53, 0.35)', name: '#a3e635' }
  },
  { // 11: 暖金色 (Gold)
    light: { bg: '#fefce8', border: 'rgba(234, 179, 8, 0.28)', name: '#a16207' },
    dark:  { bg: '#241e08', border: 'rgba(250, 204, 21, 0.35)', name: '#facc15' }
  }
];

function getSenderPalette(sender) {
  if (!sender) return SENDER_PALETTES[0];
  const key = String(sender.id || sender.username || sender.displayName || '');
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = ((hash << 5) - hash) + key.charCodeAt(i);
    hash |= 0;
  }
  const idx = Math.abs(hash) % SENDER_PALETTES.length;
  return SENDER_PALETTES[idx];
}

function getSenderBubbleStyle(msg) {
  if (isOwnMessage(msg)) return {};
  if (activeRoom.value?.kind === 'dm') return {};
  const palette = getSenderPalette(msg.sender);
  return {
    '--sender-bubble-bg': palette.light.bg,
    '--sender-bubble-border': palette.light.border,
    '--sender-name-color': palette.light.name,
    '--sender-bubble-bg-dark': palette.dark.bg,
    '--sender-bubble-border-dark': palette.dark.border,
    '--sender-name-color-dark': palette.dark.name
  };
}

const isGroupChat = computed(() => {
  return Boolean(activeRoom.value && activeRoom.value.kind !== 'dm');
});

function getMessageSenderRole(msg) {
  if (!isGroupChat.value || !msg) {
    return { isOwner: false, isAdmin: false };
  }

  const isOwn = isOwnMessage(msg);
  const senderId = isOwn
    ? Number(session.value?.userId || session.value?.id || 0)
    : Number(msg.sender?.id || 0);

  // 1. 群主身份 (普通公开群/私有群的创建者或 owner 角色)
  let isOwner = false;
  if (!activeRoom.value?.isGeneral) {
    if (activeRoom.value?.createdBy && senderId > 0 && senderId === Number(activeRoom.value.createdBy)) {
      isOwner = true;
    } else if (isOwn && activeRoom.value?.myRole === 'owner') {
      isOwner = true;
    } else if (msg.sender?.isOwner) {
      isOwner = true;
    } else if (groupMembers.value?.length && senderId > 0) {
      const m = groupMembers.value.find((item) => Number(item.id) === senderId);
      if (m?.role === 'owner') {
        isOwner = true;
      }
    }
  }

  // 2. 管理员身份 (系统超级管理员)
  let isAdmin = false;
  if (isOwn) {
    isAdmin = Boolean(session.value?.isAdmin);
  } else if (msg.sender?.isAdmin) {
    isAdmin = true;
  } else if (groupMembers.value?.length && senderId > 0) {
    const m = groupMembers.value.find((item) => Number(item.id) === senderId);
    if (m?.isAdmin) {
      isAdmin = true;
    }
  }
  if (!isAdmin && users.value?.length && senderId > 0) {
    const u = users.value.find((item) => Number(item.id) === senderId);
    if (u?.isAdmin) {
      isAdmin = true;
    }
  }

  return { isOwner, isAdmin };
}

const activeRoomSubtitle = computed(() => {
  if (!activeRoom.value) return '';
  if (typingStatusText.value) {
    return typingStatusText.value;
  }
  if (activeRoom.value.kind === 'dm') {
    const handle = activeRoom.value.otherUser?.username
      ? `@${activeRoom.value.otherUser.username}`
      : '';
    const status = dmOtherUserPresence.value?.text || (wsConnected.value ? '在线' : '离线');
    return handle ? `${handle} · ${status}` : status;
  }
  if (activeRoom.value.memberCount) {
    return `${activeRoom.value.memberCount} 位成员`;
  }
  return activeRoom.value.isGeneral ? '全员群组' : '群组会话';
});
const canModerateMessages = computed(
  () => Boolean(session.value?.isAdmin || canManageActiveRoom.value)
);
const isCurrentRoomMuted = computed(
  () => Boolean(activeRoom.value?.isMuted) && !session.value?.isAdmin
);
const messageMenu = ref({ message: null, x: 0, y: 0 });
const editingMessage = ref(null);
const replyingToMessage = ref(null);
const highlightedMsgId = ref(null);
const firstUnreadMessageId = ref(null);
let pendingUnreadCount = 0;
let highlightTimer = null;
let longPressTimer = null;
let longPressOrigin = null;

function scrollToMessage(targetId) {
  if (!targetId) return;
  const idNum = Number(targetId);
  const el = document.getElementById(`msg-${idNum}`);
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    highlightedMsgId.value = idNum;
    if (highlightTimer) clearTimeout(highlightTimer);
    highlightTimer = setTimeout(() => {
      if (highlightedMsgId.value === idNum) {
        highlightedMsgId.value = null;
      }
    }, 1600);
  } else if (typeof loadOlder === 'function') {
    loadOlder().then(() => {
      nextTick(() => {
        const retryEl = document.getElementById(`msg-${idNum}`);
        if (retryEl) {
          retryEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
          highlightedMsgId.value = idNum;
          if (highlightTimer) clearTimeout(highlightTimer);
          highlightTimer = setTimeout(() => {
            if (highlightedMsgId.value === idNum) {
              highlightedMsgId.value = null;
            }
          }, 1600);
        }
      });
    });
  }
}

const isScrolledUp = ref(false);
const isFloatingDateVisible = ref(false);
const currentFloatingDate = ref('');
let floatingDateTimer = null;

function shouldShowDateDivider(msg, index) {
  if (!msg?.createdAt) return false;
  if (index === 0) return true;
  const prevMsg = messages.value[index - 1];
  if (!prevMsg?.createdAt) return true;
  return !isSameDay(prevMsg.createdAt, msg.createdAt);
}

function updateFloatingDate() {
  if (!messagesEl.value || !messages.value.length) return;
  const container = messagesEl.value;
  const containerRect = container.getBoundingClientRect();
  const rows = container.querySelectorAll('.message-row');
  let targetDate = null;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rect = row.getBoundingClientRect();
    if (rect.bottom >= containerRect.top + 30) {
      if (row.id?.startsWith('msg-')) {
        const msgId = Number(row.id.slice(4));
        const msg = messages.value.find(m => Number(m.id) === msgId);
        if (msg?.createdAt) {
          targetDate = msg.createdAt;
          break;
        }
      }
    }
  }

  if (!targetDate && messages.value.length > 0) {
    targetDate = messages.value[0].createdAt;
  }

  if (targetDate) {
    currentFloatingDate.value = formatDateDivider(targetDate);
  }
}

const unreadCountBadge = computed(() => {
  if (!firstUnreadMessageId.value) return 0;
  const idx = messages.value.findIndex(m => m.id === firstUnreadMessageId.value);
  if (idx === -1) return 0;
  return messages.value.slice(idx).filter(m => !isOwnMessage(m)).length;
});

function handleMessagesScroll() {
  if (!messagesEl.value) return;
  const { scrollTop, scrollHeight, clientHeight } = messagesEl.value;
  const distanceFromBottom = scrollHeight - (scrollTop + clientHeight);
  isScrolledUp.value = distanceFromBottom > 100;

  if (firstUnreadMessageId.value && distanceFromBottom <= 30) {
    firstUnreadMessageId.value = null;
  }

  if (messages.value.length > 0) {
    updateFloatingDate();
    isFloatingDateVisible.value = true;
    if (floatingDateTimer) clearTimeout(floatingDateTimer);
    floatingDateTimer = setTimeout(() => {
      isFloatingDateVisible.value = false;
    }, 1500);
  }
}

function scrollToUnreadOrBottom() {
  if (firstUnreadMessageId.value) {
    const unreadEl = document.querySelector('.unread-messages-divider') || document.getElementById(`msg-${firstUnreadMessageId.value}`);
    if (unreadEl && messagesEl.value) {
      const unreadRect = unreadEl.getBoundingClientRect();
      const containerRect = messagesEl.value.getBoundingClientRect();
      if (unreadRect.top > containerRect.bottom) {
        unreadEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
    }
  }
  if (messagesEl.value) {
    messagesEl.value.scrollTo({
      top: messagesEl.value.scrollHeight,
      behavior: 'smooth'
    });
  }
}

const voiceRecorder = useVoiceRecorder();
const voicePlayer = useVoicePlayer();
const inputMode = ref('text');
let startPointerY = 0;

function toggleInputMode() {
  inputMode.value = inputMode.value === 'text' ? 'voice' : 'text';
  if (inputMode.value === 'text') {
    nextTick(() => {
      const textarea = document.querySelector('.composer-input textarea');
      textarea?.focus();
    });
  }
}

async function handleVoiceStart(e) {
  startPointerY = e.clientY;
  await voiceRecorder.startRecording();
}

function handleVoiceMove(e) {
  if (voiceRecorder.isRecording.value) {
    const dy = startPointerY - e.clientY;
    if (dy > 50) {
      voiceRecorder.setCanceling(true);
    } else {
      voiceRecorder.setCanceling(false);
    }
  }
}

async function handleVoiceEnd() {
  if (!voiceRecorder.isRecording.value) return;
  const result = await voiceRecorder.stopRecording();
  if (result?.blob) {
    await sendVoiceMessage(result.blob, result.duration);
  }
}

function handleVoiceCancel() {
  voiceRecorder.cancelRecording();
}

onBeforeUnmount(() => {
  voiceRecorder.cleanup();
  voicePlayer.stopCurrentAudio();
});

watch(activeRoom, () => {
  editingMessage.value = null;
  replyingToMessage.value = null;
  highlightedMsgId.value = null;
  isScrolledUp.value = false;
  isFloatingDateVisible.value = false;
  currentFloatingDate.value = '';
  if (floatingDateTimer) {
    clearTimeout(floatingDateTimer);
    floatingDateTimer = null;
  }
  inputMode.value = 'text';
  voicePlayer.stopCurrentAudio();
  exitMultiSelectMode();
  closeMessageMenu();
});

const isMultiSelectMode = ref(false);
const selectedMessageIds = ref(new Set());
const isBatchDeleting = ref(false);

const isDragSelecting = ref(false);
const dragSelectionBox = ref({ startX: 0, startY: 0, currentX: 0, currentY: 0 });

function enterMultiSelectMode(initialMsgId = null) {
  isMultiSelectMode.value = true;
  closeMessageMenu();
  if (initialMsgId) {
    selectedMessageIds.value = new Set([Number(initialMsgId)]);
  } else {
    selectedMessageIds.value = new Set();
  }
}

function exitMultiSelectMode() {
  isMultiSelectMode.value = false;
  selectedMessageIds.value = new Set();
  isDragSelecting.value = false;
}

function toggleSelectMessage(msgId) {
  if (!isMultiSelectMode.value) return;
  const numId = Number(msgId);
  const nextSet = new Set(selectedMessageIds.value);
  if (nextSet.has(numId)) {
    nextSet.delete(numId);
  } else {
    nextSet.add(numId);
  }
  selectedMessageIds.value = nextSet;
}

function toggleSelectAllMessages() {
  const visibleValidMessages = messages.value.filter(m => !m.isRecalled);
  if (selectedMessageIds.value.size >= visibleValidMessages.length) {
    selectedMessageIds.value = new Set();
  } else {
    selectedMessageIds.value = new Set(visibleValidMessages.map(m => Number(m.id)));
  }
}

function handleMessageRowClick(msg, event) {
  if (isMultiSelectMode.value && !msg.isRecalled) {
    event.preventDefault();
    event.stopPropagation();
    toggleSelectMessage(msg.id);
  }
}

function handleDragSelectStart(e) {
  if (!isMultiSelectMode.value) return;
  if (e.target.closest('button, a, input, .voice-bubble, .message-bubble-attachment, .message-context-menu')) return;

  const containerRect = messagesEl.value?.getBoundingClientRect();
  if (!containerRect) return;

  isDragSelecting.value = true;
  dragSelectionBox.value = {
    startX: e.clientX - containerRect.left,
    startY: e.clientY - containerRect.top + (messagesEl.value?.scrollTop || 0),
    currentX: e.clientX - containerRect.left,
    currentY: e.clientY - containerRect.top + (messagesEl.value?.scrollTop || 0)
  };
}

function handleDragSelectMove(e) {
  if (!isDragSelecting.value || !messagesEl.value) return;
  const containerRect = messagesEl.value.getBoundingClientRect();
  dragSelectionBox.value.currentX = e.clientX - containerRect.left;
  dragSelectionBox.value.currentY = e.clientY - containerRect.top + messagesEl.value.scrollTop;

  const left = Math.min(dragSelectionBox.value.startX, dragSelectionBox.value.currentX);
  const right = Math.max(dragSelectionBox.value.startX, dragSelectionBox.value.currentX);
  const top = Math.min(dragSelectionBox.value.startY, dragSelectionBox.value.currentY);
  const bottom = Math.max(dragSelectionBox.value.startY, dragSelectionBox.value.currentY);

  const messageElements = messagesEl.value.querySelectorAll('.message-row');
  const nextSet = new Set(selectedMessageIds.value);
  for (const el of messageElements) {
    const idStr = el.id?.replace('msg-', '');
    if (!idStr) continue;
    const elTop = el.offsetTop;
    const elBottom = elTop + el.offsetHeight;
    const elLeft = el.offsetLeft;
    const elRight = elLeft + el.offsetWidth;

    if (elLeft < right && elRight > left && elTop < bottom && elBottom > top) {
      nextSet.add(Number(idStr));
    }
  }
  selectedMessageIds.value = nextSet;
}

function handleDragSelectEnd() {
  isDragSelecting.value = false;
}

async function handleBatchDelete() {
  if (selectedMessageIds.value.size === 0 || isBatchDeleting.value) return;

  const selectedList = messages.value.filter(m => selectedMessageIds.value.has(Number(m.id)) && !m.isRecalled);
  const deletableList = selectedList.filter(m => isOwnMessage(m) || canModerateMessages.value);

  if (deletableList.length === 0) {
    alert('选中的消息中没有您可以删除的消息（只能删除自己发送的消息或您管理的群消息）。');
    return;
  }

  let confirmMsg = `确定要删除选中的 ${deletableList.length} 条消息吗？删除后会话中的所有人都将看不到它们。`;
  if (deletableList.length < selectedList.length) {
    confirmMsg += `\n（另外 ${selectedList.length - deletableList.length} 条无权删除的消息将被跳过）`;
  }

  if (!window.confirm(confirmMsg)) return;

  isBatchDeleting.value = true;
  try {
    for (const msg of deletableList) {
      deleteMessage(msg.id);
    }
    exitMultiSelectMode();
  } finally {
    isBatchDeleting.value = false;
  }
}

const MESSAGE_EDIT_WINDOW_MS = 5 * 60 * 1000;

function canEditMessage(msg) {
  if (!msg?.sender) return false;
  if (!isOwnMessage(msg) || !msg.content || msg.attachment) return false;
  if (msg.createdAt) {
    const createdAtMs = new Date(msg.createdAt).getTime();
    if (Number.isFinite(createdAtMs) && Date.now() - createdAtMs > MESSAGE_EDIT_WINDOW_MS) {
      return false;
    }
  }
  return true;
}

function canDeleteMessage(msg) {
  if (!msg?.sender || msg.isRecalled) return false;
  if (canModerateMessages.value) return true;
  if (!isOwnMessage(msg)) return false;
  return true;
}

function closeMessageMenu() {
  messageMenu.value = { message: null, x: 0, y: 0 };
}

function openMessageMenuAt(message, x, y) {
  messageMenu.value = { message, x, y };
}

function cancelMessageLongPress() {
  if (longPressTimer !== null) {
    window.clearTimeout(longPressTimer);
    longPressTimer = null;
  }
  longPressOrigin = null;
}

function openMessageContextMenu(event, message) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  cancelMessageLongPress();
  openMessageMenuAt(message, event.clientX, event.clientY);
}

function startMessageLongPress(event, message) {
  cancelMessageLongPress();
  if (event.pointerType === 'mouse') return;

  const origin = {
    pointerId: event.pointerId,
    x: event.clientX,
    y: event.clientY
  };
  longPressOrigin = origin;
  longPressTimer = window.setTimeout(() => {
    openMessageMenuAt(message, origin.x, origin.y);
    longPressTimer = null;
  }, 500);
}

function trackMessageLongPress(event) {
  if (!longPressOrigin || event.pointerId !== longPressOrigin.pointerId) return;
  if (
    Math.abs(event.clientX - longPressOrigin.x) > 10 ||
    Math.abs(event.clientY - longPressOrigin.y) > 10
  ) {
    cancelMessageLongPress();
  }
}

const forwardModalState = ref({
  open: false,
  messages: []
});

function openForwardForSingleMessage(msg) {
  closeMessageMenu();
  if (!msg || msg.isRecalled) return;
  forwardModalState.value = {
    open: true,
    messages: [msg]
  };
}

function openBatchForwardModal() {
  const selectedList = messages.value.filter(
    (m) => selectedMessageIds.value.has(Number(m.id)) && !m.isRecalled
  );
  if (selectedList.length === 0) return;
  forwardModalState.value = {
    open: true,
    messages: selectedList
  };
}

function handleForwardCompleted() {
  if (isMultiSelectMode.value) {
    exitMultiSelectMode();
  }
}

function copyMessageText() {
  const message = messageMenu.value.message;
  closeMessageMenu();
  if (message?.content) {
    void navigator.clipboard?.writeText(message.content);
  }
}

async function downloadAttachment() {
  const message = messageMenu.value.message;
  const attachment = message?.attachment;
  closeMessageMenu();
  if (!attachment) return;

  const rawUrl = api.getFileUrl(attachment.key || attachment.url);
  if (!rawUrl) return;

  const filename = attachment.name || 'attachment';

  if (attachment.fileKey && attachment.nonce) {
    try {
      const res = await fetch(rawUrl);
      if (!res.ok) throw new Error('下载加密文件失败');
      const buffer = await res.arrayBuffer();
      const blobUrl = await createDecryptedBlobUrl(
        buffer,
        attachment.fileKey,
        attachment.nonce,
        attachment.type || 'application/octet-stream'
      );
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
    } catch (err) {
      alert(`下载失败：${err?.message || '无法解密文件'}`);
    }
  } else {
    const link = document.createElement('a');
    link.href = rawUrl;
    link.download = filename;
    link.target = '_blank';
    link.rel = 'noreferrer';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
}

const showDriveFilePicker = ref(false);
const showFolderSelector = ref(false);
const folderSelectorTitle = ref('选择转存目录');
const folderSelectorConfirmText = ref('存入此目录');
const folderSelectorHandler = ref(null);
const previewDriveFile = ref(null);

function parseDriveShareData(content) {
  if (!content || typeof content !== 'string') return null;
  const marker = '[edgechat-drive-share:';
  const startIdx = content.indexOf(marker);
  if (startIdx === -1) return null;
  const endIdx = content.indexOf(']', startIdx);
  if (endIdx === -1) return null;
  try {
    const jsonStr = content.slice(startIdx + marker.length, endIdx);
    return JSON.parse(jsonStr);
  } catch {
    return null;
  }
}

async function handleSendDriveFile(driveFile) {
  if (!activeRoom.value || !driveFile) return;
  try {
    const fileUrl = api.getDriveFileUrl(driveFile.id);
    const res = await fetch(fileUrl);
    if (!res.ok) throw new Error('读取云盘文件失败');
    const blob = await res.blob();
    const file = new File([blob], driveFile.name, { type: driveFile.mime_type || 'application/octet-stream' });
    await processAndUploadFile(file);
  } catch (err) {
    alert(`发送云盘文件失败: ${err.message || '未知错误'}`);
  }
}

async function handleSendDriveShareCard({ file, permission }) {
  if (!activeRoom.value || !file) return;
  try {
    const targetType = 'room';
    const targetId = Number(activeRoom.value.id);

    await apiFetch('/api/drive/member-shares', {
      method: 'POST',
      body: JSON.stringify({
        fileId: file.id,
        targetType,
        targetId,
        permission: permission || 'read'
      })
    });

    const sharePayload = {
      fileId: file.id,
      name: file.name,
      isFolder: Boolean(file.is_folder),
      size: Number(file.size || 0),
      permission: permission || 'read',
      ownerName: session.value?.displayName || '我'
    };

    const content = `[edgechat-drive-share:${JSON.stringify(sharePayload)}] 共享了网盘${file.is_folder ? '文件夹' : '文件'}「${file.name}」`;
    await sendMessage(content);
  } catch (err) {
    alert(`发送共享协作卡片失败: ${err.message || '未知错误'}`);
  }
}

function saveAttachmentToDrive(explicitAttachment = null) {
  const attachment = explicitAttachment || messageMenu.value.message?.attachment;
  closeMessageMenu();
  if (!attachment) return;

  const attachmentKey = attachment.key || attachment.url;
  if (!attachmentKey) return;

  folderSelectorTitle.value = `转存「${attachment.name || '附件'}」至网盘`;
  folderSelectorConfirmText.value = '存入此目录';
  folderSelectorHandler.value = async ({ folderId, folderName }) => {
    await apiFetch('/api/drive/files/save-from-attachment', {
      method: 'POST',
      body: JSON.stringify({
        attachmentKey,
        name: attachment.name || '转存文件',
        size: attachment.size || 0,
        mimeType: attachment.type || 'application/octet-stream',
        parentId: folderId
      })
    });
    alert(`已成功转存至网盘目录「${folderName}」！`);
  };
  showFolderSelector.value = true;
}

function openArchiveMessagesToDrive() {
  if (selectedMessageIds.value.size === 0) return;
  folderSelectorTitle.value = `归档 ${selectedMessageIds.value.size} 条聊天记录至网盘`;
  folderSelectorConfirmText.value = '归档至此目录';
  folderSelectorHandler.value = async ({ folderId, folderName }) => {
    const selectedMsgs = messages.value
      .filter(m => selectedMessageIds.value.has(Number(m.id)) && !m.isRecalled)
      .sort((a, b) => Number(a.id) - Number(b.id));

    if (selectedMsgs.length === 0) return;

    const roomName = activeRoom.value?.name || activeRoom.value?.title || '会话';
    const now = new Date();
    const dateTag = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
    const fileName = `[Edgechat]_${roomName}_聊天记录_${dateTag}.md`;

    let markdown = `# ${roomName} 聊天记录归档\n\n`;
    markdown += `> **归档时间**: ${now.toLocaleString('zh-CN')}  \n`;
    markdown += `> **会话名称**: ${roomName}  \n`;
    markdown += `> **消息条数**: ${selectedMsgs.length} 条  \n\n---\n\n`;

    for (const msg of selectedMsgs) {
      const senderName = isOwnMessage(msg) ? (session.value?.displayName || '我') : (msg.sender?.displayName || '未知用户');
      const time = new Date(msg.createdAt).toLocaleString('zh-CN');
      markdown += `### 💬 ${senderName} <small>(${time})</small>\n\n`;
      if (msg.content) {
        const parsedShare = parseDriveShareData(msg.content);
        if (parsedShare) {
          markdown += `🤝 **网盘共享**: [${parsedShare.name}](edgechat-drive://${parsedShare.fileId}) (${parsedShare.isFolder ? '文件夹' : '文件'}, 权限: ${parsedShare.permission})\n\n`;
        } else {
          markdown += `${msg.content}\n\n`;
        }
      }
      if (msg.attachment) {
        markdown += `📎 **附件**: ${msg.attachment.name || '文件'} (${msg.attachment.type || 'unknown'})\n\n`;
      }
    }

    await apiFetch('/api/drive/files/create-text-file', {
      method: 'POST',
      body: JSON.stringify({
        name: fileName,
        content: markdown,
        parentId: folderId,
        mimeType: 'text/markdown; charset=utf-8'
      })
    });

    exitMultiSelectMode();
    alert(`已成功将 ${selectedMsgs.length} 条记录归档至「${folderName}」！\n文件名为：${fileName}`);
  };
  showFolderSelector.value = true;
}

function openDriveFilePreview(file) {
  previewDriveFile.value = file;
}

function startReplyMessage() {
  const message = messageMenu.value.message;
  closeMessageMenu();
  if (!message || message.isRecalled) return;
  replyingToMessage.value = message;
  editingMessage.value = null;
  nextTick(() => {
    textareaComponentRef.value?.focus();
  });
}

function cancelReplyMessage() {
  replyingToMessage.value = null;
}

function startEditMessage() {
  const message = messageMenu.value.message;
  closeMessageMenu();
  if (!message || !canEditMessage(message)) return;
  editingMessage.value = message;
  replyingToMessage.value = null;
  composerText.value = message.content || '';
  nextTick(() => {
    const textarea = document.querySelector('.composer-input textarea');
    textarea?.focus();
  });
}

function cancelEditMessage() {
  editingMessage.value = null;
  composerText.value = '';
}

async function handleSendMessageOrEdit() {
  if (editingMessage.value) {
    const targetId = editingMessage.value.id;
    const text = composerText.value;
    editingMessage.value = null;
    composerText.value = '';
    await editMessage(targetId, text);
  } else {
    let finalContent = composerText.value;
    if (replyingToMessage.value) {
      const rep = replyingToMessage.value;
      const author = rep.sender?.displayName || '成员';
      let excerpt = (rep.content || '').replace(/\n+/g, ' ').slice(0, 100).trim();
      if (!excerpt && rep.attachment) {
        excerpt = `[附件: ${rep.attachment.name || '文件'}]`;
      }
      const quoteBlock = `> [↩ @${author}](#msg-${rep.id}): ${excerpt}\n`;
      finalContent = quoteBlock + finalContent;
      replyingToMessage.value = null;
    }
    const attachment = pendingAttachment.value;
    composerText.value = '';
    await sendMessage(finalContent, attachment);
  }
}

function onComposerKeydown(event) {
  if (showMentionPicker.value) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      mentionPickerRef.value?.selectNext();
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      mentionPickerRef.value?.selectPrev();
      return;
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
      if (mentionPickerRef.value?.selectCurrent()) {
        event.preventDefault();
        return;
      }
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      showMentionPicker.value = false;
      return;
    }
  }
  if (event.key === 'Escape') {
    if (editingMessage.value) {
      event.preventDefault();
      cancelEditMessage();
      return;
    }
    if (replyingToMessage.value) {
      event.preventDefault();
      cancelReplyMessage();
      return;
    }
  }
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    void handleSendMessageOrEdit();
  }
}

const roomManagement = useRoomManagement({
  activeRoom, channels, users, error, refreshSidebar, conversationItems,
  openConversation, canManageActiveRoom,
  returnToConversationList,
  onRoomDeleted: () => {
    disconnectSocket();
    messages.value = [];
  }
});
const { creation, members: memberManagement, settings: groupSettings, deleteGroup } = roomManagement;
const {
  show: showCreateGroup,
  form: createGroupForm,
  submitting: creatingGroup,
  open: openCreateGroup,
  close: closeCreateGroup,
  toggleMember: toggleCreateGroupMember,
  submit: createGroup
} = creation;
const {
  show: showAddConversation,
  usersWithoutDm,
  openingDmUserId,
  open: openAddConversation,
  close: closeAddConversation,
  startGroupCreation,
  openDm
} = useConversationCreation({
  users,
  dms,
  error,
  refreshSidebar,
  conversationItems,
  openConversation,
  openGroupDialog: openCreateGroup
});
const {
  show: showMemberPanel,
  items: groupMembers,
  loading: memberLoading,
  inviteUserId,
  availableUsers: availableInviteUsers,
  inviteSubmitting,
  toggle: toggleMemberPanel,
  close: closeMemberPanel,
  load: loadGroupMembers,
  invite: inviteMember,
  transferOwner,
  remove: removeMember
} = memberManagement;
const {
  show: showGroupEditor,
  form: groupSettingsForm,
  saving: groupSettingsSaving,
  avatarUploading: groupAvatarUploading,
  open: openGroupEditor,
  close: closeGroupEditor,
  uploadAvatar: uploadGroupAvatar,
  save: saveGroupSettings
} = groupSettings;

const {
  announcements,
  showModal: showAnnouncementModal,
  selectedId: selectedAnnouncementId,
  activeUndismissedAnnouncements,
  loadAnnouncements,
  dismissAnnouncement,
  openAnnouncementDetail,
  openAllAnnouncements,
  closeModal: closeAnnouncementModal
} = useAnnouncements();

function checkMentionTrigger() {
  if (!activeRoom.value || activeRoom.value.kind === 'dm') {
    showMentionPicker.value = false;
    return;
  }
  const textarea = textareaComponentRef.value?.textareaEl;
  const text = composerText.value || '';
  const cursor = textarea?.selectionStart ?? text.length;
  const textBefore = text.substring(0, cursor);

  // 匹配光标前紧邻的 @ 及后续文本（支持中英文字符与下划线）
  const match = /@([a-zA-Z0-9_\-\u4e00-\u9fa5]*)$/.exec(textBefore);
  if (match) {
    mentionQuery.value = match[1] || '';
    showMentionPicker.value = true;
    if ((!groupMembers.value || groupMembers.value.length === 0) && typeof loadGroupMembers === 'function') {
      loadGroupMembers();
    }
  } else {
    showMentionPicker.value = false;
  }
}

watch(composerText, () => {
  nextTick(checkMentionTrigger);
});

watch(activeRoom, (newRoom) => {
  showMentionPicker.value = false;
  if (newRoom && newRoom.kind !== 'dm') {
    nextTick(() => {
      if (typeof loadGroupMembers === 'function') {
        loadGroupMembers();
      }
    });
  }
});

const savingRoomMute = ref(false);
async function toggleGeneralRoomMute() {
  if (!activeRoom.value?.isGeneral || !session.value?.isAdmin) return;
  savingRoomMute.value = true;
  const nextMuted = !activeRoom.value.isMuted;
  try {
    const res = await api.updateGeneralChannelSettings({ muted: nextMuted });
    const mutedVal = Boolean(res.generalChannelMuted);
    activeRoom.value.isMuted = mutedVal;
    for (const c of channels.value) {
      if (c.isGeneral || c.name === 'general') {
        c.isMuted = mutedVal;
      }
    }
  } catch (err) {
    error.value = err.message || '切换禁言状态失败';
  } finally {
    savingRoomMute.value = false;
  }
}

async function selectConversation(item) {
  try {
    closeMemberPanel();
    pendingUnreadCount = Number(item?.unreadCount || 0);
    firstUnreadMessageId.value = null;
    await openConversation(item);
    openConversationView();
  } catch (currentError) {
    error.value = currentError.message;
  }
}

function handleSidebarClick() {
  if (showMemberPanel.value) {
    closeMemberPanel();
  }
}

function handleChatMainClick() {
  if (showMemberPanel.value) {
    closeMemberPanel();
  }
}

function openPublicGroupPreview(item) {
  publicGroupPreview.value = item.source;
}

function closePublicGroupPreview() {
  if (!joiningPublicGroup.value) publicGroupPreview.value = null;
}

async function confirmPublicGroupJoin() {
  const channel = publicGroupPreview.value;
  if (!channel) return;

  joiningPublicGroup.value = true;
  error.value = '';
  try {
    await joinPublicChannel(channel);
    const item = conversationItems.value.find(
      (conversation) => conversation.kind === channel.kind && Number(conversation.id) === Number(channel.id)
    );
    publicGroupPreview.value = null;
    if (item) await selectConversation(item);
  } catch (currentError) {
    error.value = currentError.message;
  } finally {
    joiningPublicGroup.value = false;
  }
}

function openRoomFromNotification(room) {
  const item = conversationItems.value.find(
    (conversation) => conversation.kind === room.kind && Number(conversation.id) === Number(room.id)
  );
  if (item) void selectConversation(item);
}

function toggleActiveRoomMute() {
  if (activeRoom.value) toggleRoomMuted(activeRoom.value);
}

async function logout() { await store.logout(); await router.push('/login'); }
function openAdmin() { router.push('/admin'); }
function openSettings() { router.push('/settings'); }
function closeMobileNavigation() { showMobileNavigation.value = false; }
function navigateFromMobileDrawer(callback) {
  closeMobileNavigation();
  callback();
}
function returnToMobileConversationList() {
  closeMemberPanel();
  closeMessageMenu();
  returnToConversationList();
}

async function bootstrap() {
  error.value = '';
  try {
    void loadAnnouncements();
    await refreshSidebar();
    if (isDemoMode && !activeRoom.value) {
      const general = conversationItems.value.find((item) => item.isGeneral);
      if (general) await selectConversation(general);
    }
  }
  catch (e) { error.value = e.message; }
}

watch(activeRoomKey, async (k) => {
  closeMessageMenu();
  cancelMessageLongPress();
  showMentionPicker.value = false;
  if (!k) {
    firstUnreadMessageId.value = null;
    pendingUnreadCount = 0;
    deactivateRoom();
    return;
  }
  openConversationView();
  if (activeRoom.value?.kind !== 'dm') {
    void loadGroupMembers?.();
  }
  const unreadToMark = pendingUnreadCount || Number(activeRoom.value?.unreadCount || 0);
  pendingUnreadCount = 0;
  const loaded = await activateRoom();
  if (!loaded || activeRoomKey.value !== k) return;

  if (unreadToMark > 0 && messages.value.length > 0) {
    let count = 0;
    let targetId = null;
    for (let i = messages.value.length - 1; i >= 0; i--) {
      const m = messages.value[i];
      if (!isOwnMessage(m)) {
        count++;
        targetId = m.id;
        if (count >= unreadToMark) break;
      }
    }
    firstUnreadMessageId.value = targetId || messages.value[0].id;
  } else {
    firstUnreadMessageId.value = null;
  }

  for (const delay of [0, 50, 150, 300]) {
    await new Promise(r => setTimeout(r, delay));
    if (activeRoomKey.value !== k) return;
    if (firstUnreadMessageId.value) {
      const unreadEl = document.querySelector('.unread-messages-divider') || document.getElementById(`msg-${firstUnreadMessageId.value}`);
      if (unreadEl) {
        unreadEl.scrollIntoView({ behavior: 'auto', block: 'start' });
        continue;
      }
    }
    if (messagesEl.value) {
      messagesEl.value.scrollTop = messagesEl.value.scrollHeight;
    }
  }
});

function confirmDeleteMessage() {
  const message = messageMenu.value.message;
  closeMessageMenu();
  if (!message || !window.confirm('确认删除这条消息吗？删除后会话中的所有人都将看不到它。')) {
    return;
  }
  deleteMessage(message.id);
}

function onGlobalPointerDown(e) {
  if (!e.target.closest('.composer-popover') && !e.target.closest('.composer-btn') && !e.target.closest('.formatting-toolbar') && !e.target.closest('.mention-picker')) {
    closePickers();
  }
}

function onGlobalKeydown(e) {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
    if (activeRoom.value) {
      e.preventDefault();
      showSearchBar.value = true;
    }
  } else if (e.key === 'Escape') {
    if (showSearchBar.value) {
      showSearchBar.value = false;
    } else if (isMultiSelectMode.value) {
      exitMultiSelectMode();
    }
  }
}

let unregisterChatBackHandler = null;

onMounted(() => {
  startViewportSync();
  window.addEventListener('focus', syncNotificationPermission);
  window.addEventListener('pointerdown', onGlobalPointerDown);
  window.addEventListener('keydown', onGlobalKeydown);
  unregisterChatBackHandler = registerBackHandler(50, () => {
    if (showMessageMenu.value) {
      closeMessageMenu();
      return true;
    }
    if (showMemberPanel.value) {
      closeMemberPanel();
      return true;
    }
    if (showMobileNavigation.value) {
      closeMobileNavigation();
      return true;
    }
    if (showSearchBar.value) {
      showSearchBar.value = false;
      return true;
    }
    if (isMobileViewport.value && mobileView.value === 'chat') {
      returnToMobileConversationList();
      return true;
    }
    return false;
  });
  // The inbox socket must be available even if a non-critical bootstrap
  // request fails; incoming calls are delivered through this global channel.
  // Start the global call-signal channel immediately; bootstrap is unrelated
  // to incoming call delivery and may take longer or fail independently.
  connectUnreadInbox();
  void bootstrap();
  void checkSiteCallsEnabled();
});

onBeforeUnmount(() => {
  if (unregisterChatBackHandler) {
    unregisterChatBackHandler();
    unregisterChatBackHandler = null;
  }
  if (floatingDateTimer) clearTimeout(floatingDateTimer);
  cancelMessageLongPress();
  window.removeEventListener('focus', syncNotificationPermission);
  window.removeEventListener('pointerdown', onGlobalPointerDown);
  window.removeEventListener('keydown', onGlobalKeydown);
  disconnectUnreadInbox();
  disconnectSocket();
  stopViewportSync();
});
</script>

<template>
  <div
    class="chat-layout"
    :class="{
      'chat-layout--mobile': isMobileViewport,
      'chat-layout--mobile-list': isMobileViewport && mobileView === 'list',
      'chat-layout--mobile-chat': isMobileViewport && mobileView === 'chat'
    }"
  >
    <!-- Far-Left Navigation Sidebar -->
    <aside class="right-sidebar">
      <div class="right-sidebar-inner">
        <div class="right-sidebar-section right-sidebar-actions">
          <button
            type="button"
            class="right-sidebar-action right-sidebar-action--labeled tooltip"
            :class="{ 'right-sidebar-action--notification-active': notificationsEnabled }"
            :data-tooltip="notificationActionLabel"
            :aria-label="notificationActionLabel"
            :aria-pressed="notificationsEnabled"
            :disabled="notificationToggleDisabled"
            @click="toggleNotifications"
          >
            <Bell v-if="notificationsEnabled" :size="20" aria-hidden="true" />
            <BellOff v-else :size="20" aria-hidden="true" />
            <span class="right-sidebar-action__label">{{ notificationStateLabel }}</span>
          </button>
          <button
            type="button"
            class="right-sidebar-action right-sidebar-action--labeled tooltip"
            :class="{ 'right-sidebar-action--notification-active': soundEnabled }"
            :data-tooltip="soundEnabled ? '提示音已开启 (点击静音)' : '提示音已静音 (点击开启)'"
            :aria-label="soundEnabled ? '提示音已开启' : '提示音已关闭'"
            :aria-pressed="soundEnabled"
            @click="toggleSound"
          >
            <Volume2 v-if="soundEnabled" :size="20" aria-hidden="true" />
            <VolumeX v-else :size="20" aria-hidden="true" />
            <span class="right-sidebar-action__label">{{ soundEnabled ? '声音开启' : '声音关闭' }}</span>
          </button>
          <button
            type="button"
            class="right-sidebar-action right-sidebar-action--labeled tooltip"
            data-tooltip="我的云盘"
            aria-label="我的云盘"
            @click="router.push('/drive')"
          >
            <Folder :size="20" aria-hidden="true" />
            <span class="right-sidebar-action__label">云盘</span>
          </button>
          <button
            v-if="showAdminEntry"
            type="button"
            class="right-sidebar-action right-sidebar-action--admin tooltip"
            data-tooltip="管理后台"
            @click="openAdmin"
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8">
              <title>管理后台</title>
              <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
              <rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>
            </svg>
            <span class="right-sidebar-action__label">管理后台</span>
          </button>
        </div>

        <div class="right-sidebar-section right-sidebar-user-group">
          <button
            type="button"
            class="right-sidebar-action tooltip"
            :data-tooltip="isDark ? '切换浅色模式' : '切换深色暗黑模式'"
            :aria-label="isDark ? '切换浅色模式' : '切换深色暗黑模式'"
            @click="toggleTheme"
          >
            <span style="font-size: 1.25rem; line-height: 1;">{{ isDark ? '☀️' : '🌙' }}</span>
            <span class="right-sidebar-action__label">{{ isDark ? '浅色' : '深色' }}</span>
          </button>
          <button type="button" class="right-sidebar-user tooltip" data-tooltip="个人设置" aria-label="个人设置" @click="router.push('/settings')">
            <UiAvatar :src="session?.avatarUrl" :fallback="session?.displayName?.[0] || 'U'" size="sm" />
          </button>
          <button type="button" class="right-sidebar-action right-sidebar-action--danger tooltip" data-tooltip="退出" aria-label="退出登录" @click="logout">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8">
              <title>退出</title>
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
          </button>
        </div>
      </div>
    </aside>

    <!-- Middle-Left Chat List Sidebar -->
    <aside class="left-sidebar" @click="handleSidebarClick">
      <div class="sidebar-inner">
        <div class="sidebar-header">
          <button
            type="button"
            class="header-action mobile-menu-action"
            aria-label="打开导航"
            :aria-expanded="showMobileNavigation"
            @click="showMobileNavigation = true"
          >
            <Menu :size="22" aria-hidden="true" />
          </button>
          <h1 class="brand-title">EdgeChat</h1>
          <div class="sidebar-header-actions">
            <button
              type="button"
              class="header-action announcement-header-btn"
              title="系统公告中心"
              aria-label="系统公告中心"
              @click="openAllAnnouncements"
            >
              <Megaphone :size="19" aria-hidden="true" />
              <span v-if="activeUndismissedAnnouncements.length > 0" class="announcement-unread-dot" aria-label="有新公告"></span>
            </button>
            <button
              type="button"
              class="header-action"
              title="添加人员"
              aria-label="添加人员"
              aria-haspopup="dialog"
              :aria-expanded="showAddConversation"
              @click="openAddConversation"
            >
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
                <title>添加人员</title>
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
                <line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/>
              </svg>
            </button>
          </div>
        </div>

        <div class="sidebar-divider"></div>

        <!-- 会话搜索栏 -->
        <div class="sidebar-search-wrap">
          <div class="sidebar-search-box">
            <Search :size="15" class="sidebar-search-icon" aria-hidden="true" />
            <input
              v-model="conversationSearchText"
              type="text"
              class="sidebar-search-input"
              placeholder="搜索群聊或私聊..."
              aria-label="搜索会话"
              @keydown.esc="clearConversationSearch"
            />
            <button
              v-if="conversationSearchText"
              type="button"
              class="sidebar-search-clear"
              aria-label="清空搜索"
              title="清空搜索 (Esc)"
              @click="clearConversationSearch"
            >
              <X :size="13" aria-hidden="true" />
            </button>
          </div>
        </div>

        <div class="sidebar-divider"></div>

        <div class="sidebar-section sidebar-list">
          <div v-if="sidebarLoading" class="sidebar-hint">加载中...</div>
          <div v-else-if="!groupConversations.length && !dmConversations.length" class="sidebar-hint">暂无会话</div>

          <!-- 搜索无匹配结果空状态 -->
          <div v-else-if="isSearchingConversations && !hasAnySearchMatches" class="sidebar-search-empty">
            <div class="sidebar-search-empty__icon">
              <Search :size="22" aria-hidden="true" />
            </div>
            <p class="sidebar-search-empty__title">未找到匹配会话</p>
            <p class="sidebar-search-empty__desc">未找到包含 “{{ conversationSearchText }}” 的群聊或私聊</p>
            <button type="button" class="sidebar-search-empty__btn" @click="clearConversationSearch">
              清空搜索
            </button>
          </div>

          <template v-else>
            <!-- 👥 群聊分组 -->
            <div v-if="!isSearchingConversations || filteredGroupConversations.length > 0" class="sidebar-group">
              <button
                type="button"
                class="sidebar-group-header"
                :aria-expanded="isGroupSectionEffectiveExpanded"
                @click="toggleGroupSection"
              >
                <div class="sidebar-group-header__title">
                  <svg
                    class="sidebar-group-chevron"
                    :class="{ 'sidebar-group-chevron--collapsed': !isGroupSectionEffectiveExpanded }"
                    viewBox="0 0 24 24"
                    width="14"
                    height="14"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2.5"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    aria-hidden="true"
                  >
                    <polyline points="6 9 12 15 18 9"/>
                  </svg>
                  <span>群聊</span>
                  <span class="sidebar-group-count">({{ filteredGroupConversations.length }})</span>
                </div>
                <div class="sidebar-group-header__meta">
                  <span v-if="!isGroupSectionEffectiveExpanded && groupUnreadTotal > 0" class="sidebar-group-unread-pill">
                    {{ groupUnreadTotal > 99 ? '99+' : groupUnreadTotal }}
                  </span>
                </div>
              </button>

              <div v-show="isGroupSectionEffectiveExpanded" class="sidebar-group-content">
                <div v-if="!filteredGroupConversations.length" class="sidebar-group-empty">
                  {{ isSearchingConversations ? '无匹配群聊' : '暂无群聊' }}
                </div>
                <button
                  v-for="item in filteredGroupConversations"
                  :key="item.key"
                  type="button"
                  class="sidebar-item"
                  :class="{
                    'sidebar-item--group': true,
                    'sidebar-item--general': item.isGeneral,
                    'sidebar-item--public': !item.isGeneral && item.kind === 'public',
                    'sidebar-item--private': !item.isGeneral && item.kind === 'private',
                    'sidebar-item--active': activeRoomKey === item.key,
                    'sidebar-item--pinned': item.isPinned
                  }"
                  @click="selectConversation(item)"
                  @contextmenu.prevent.stop="togglePinConversation(item.key)"
                >
                  <div class="sidebar-item__avatar-wrap">
                    <UiAvatar
                      :src="item.avatarUrl"
                      :fallback="item.fallback?.[0] || '群'"
                      size="sm"
                      :show-presence="false"
                    />
                    <span
                      class="sidebar-avatar-badge"
                      :class="{
                        'sidebar-avatar-badge--group': true,
                        'sidebar-avatar-badge--general': item.isGeneral,
                        'sidebar-avatar-badge--public': !item.isGeneral && item.kind === 'public',
                        'sidebar-avatar-badge--private': !item.isGeneral && item.kind === 'private'
                      }"
                      :title="item.isGeneral ? '全员群组' : (item.kind === 'public' ? '公开群聊' : '私密群聊')"
                    >
                      <UsersRound v-if="item.isGeneral" :size="9" aria-hidden="true" />
                      <Globe v-else-if="item.kind === 'public'" :size="9" aria-hidden="true" />
                      <Lock v-else :size="9" aria-hidden="true" />
                    </span>
                  </div>
                  <div class="sidebar-label-group">
                    <div class="sidebar-item__top">
                      <div class="sidebar-item__title-wrap">
                        <Pin v-if="item.isPinned" :size="12" class="sidebar-pinned-icon" title="已置顶会话 (右键取消置顶)" aria-label="已置顶" />
                        <strong class="sidebar-label">{{ item.title }}</strong>
                        <span v-if="item.isGeneral" class="sidebar-tag sidebar-tag--general">
                          <UsersRound :size="10" class="sidebar-tag__icon" aria-hidden="true" />
                          全员
                        </span>
                        <span v-else-if="item.kind === 'public'" class="sidebar-tag sidebar-tag--public">
                          <Globe :size="10" class="sidebar-tag__icon" aria-hidden="true" />
                          公开
                        </span>
                        <span v-else class="sidebar-tag sidebar-tag--private sidebar-tag--group">
                          <Lock :size="10" class="sidebar-tag__icon" aria-hidden="true" />
                          私密
                        </span>
                      </div>
                      <span class="sidebar-label sidebar-item__time">{{ formatListTime(item.lastMessageAt) }}</span>
                    </div>
                    <div class="sidebar-item__bottom">
                      <p class="sidebar-label sidebar-item__preview">
                        <template v-if="hasDraft(item.key)">
                          <span class="sidebar-draft-tag">[草稿]</span>
                          <span class="sidebar-draft-text">{{ getDraft(item.key) }}</span>
                        </template>
                        <template v-else>
                          {{ item.subtitle }}
                        </template>
                      </p>
                      <span
                        v-if="isRoomMuted(item)"
                        class="sidebar-muted-indicator"
                        title="已设为免打扰"
                        aria-label="已设为免打扰"
                      >
                        <BellOff :size="14" aria-hidden="true" />
                      </span>
                      <span
                        v-if="item.unreadCount > 0"
                        class="sidebar-unread-badge"
                        :class="{ 'sidebar-unread-badge--muted': isRoomMuted(item) }"
                      >
                        {{ item.unreadCount > 99 ? '99+' : item.unreadCount }}
                      </span>
                    </div>
                  </div>
                </button>
              </div>
            </div>

            <!-- 💬 私聊分组 -->
            <div v-if="!isSearchingConversations || filteredDmConversations.length > 0" class="sidebar-group">
              <button
                type="button"
                class="sidebar-group-header"
                :aria-expanded="isDmSectionEffectiveExpanded"
                @click="toggleDmSection"
              >
                <div class="sidebar-group-header__title">
                  <svg
                    class="sidebar-group-chevron"
                    :class="{ 'sidebar-group-chevron--collapsed': !isDmSectionEffectiveExpanded }"
                    viewBox="0 0 24 24"
                    width="14"
                    height="14"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2.5"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    aria-hidden="true"
                  >
                    <polyline points="6 9 12 15 18 9"/>
                  </svg>
                  <span>私聊</span>
                  <span class="sidebar-group-count">({{ filteredDmConversations.length }})</span>
                </div>
                <div class="sidebar-group-header__meta">
                  <button
                    v-if="hasMultipleFilteredDmGroups && !isSearchingConversations"
                    type="button"
                    class="sidebar-group-mode-btn"
                    :class="{ 'sidebar-group-mode-btn--active': dmGroupingMode === 'grouped' }"
                    :title="dmGroupingMode === 'grouped' ? '当前：按部门分组（点击切换为时间平铺）' : '当前：时间平铺（点击切换为部门分组）'"
                    @click.stop="toggleDmGroupingMode"
                  >
                    {{ dmGroupingMode === 'grouped' ? '按部门' : '平铺' }}
                  </button>
                  <span v-if="!isDmSectionEffectiveExpanded && dmUnreadTotal > 0" class="sidebar-group-unread-pill">
                    {{ dmUnreadTotal > 99 ? '99+' : dmUnreadTotal }}
                  </span>
                </div>
              </button>

              <div v-show="isDmSectionEffectiveExpanded" class="sidebar-group-content">
                <div v-if="!filteredDmConversations.length" class="sidebar-group-empty">
                  {{ isSearchingConversations ? '无匹配私聊' : '暂无私聊会话' }}
                </div>

                <!-- 按部门分组折叠/展开展示 -->
                <template v-else-if="dmGroupingMode === 'grouped' && hasMultipleFilteredDmGroups">
                  <!-- 置顶私聊分组 (若存在) -->
                  <div v-if="filteredPinnedDms.length > 0" class="sidebar-subgroup sidebar-subgroup--pinned">
                    <div class="sidebar-subgroup-header sidebar-subgroup-header--static">
                      <div class="sidebar-subgroup-header__left">
                        <Pin :size="12" class="sidebar-pinned-subgroup-icon" />
                        <strong class="sidebar-subgroup-title">置顶会话</strong>
                        <span class="sidebar-subgroup-count">({{ filteredPinnedDms.length }})</span>
                      </div>
                    </div>
                    <div class="sidebar-subgroup-body">
                      <button
                        v-for="item in filteredPinnedDms"
                        :key="`pinned-${item.key}`"
                        type="button"
                        class="sidebar-item"
                        :class="{
                          'sidebar-item--dm': true,
                          'sidebar-item--pinned': true,
                          'sidebar-item--active': activeRoomKey === item.key
                        }"
                        @click="selectConversation(item)"
                        @contextmenu.prevent.stop="togglePinConversation(item.key)"
                      >
                        <div class="sidebar-item__avatar-wrap">
                          <UiAvatar
                            :src="item.avatarUrl"
                            :fallback="item.fallback?.[0] || '?'"
                            size="sm"
                            :show-presence="true"
                            :is-online="isConversationOnline(item)"
                          />
                        </div>
                        <div class="sidebar-label-group">
                          <div class="sidebar-item__top">
                            <div class="sidebar-item__title-wrap">
                              <Pin v-if="item.isPinned" :size="12" class="sidebar-pinned-icon" title="已置顶会话 (右键取消置顶)" aria-label="已置顶" />
                              <strong class="sidebar-label">{{ item.title }}</strong>
                              <span class="sidebar-tag sidebar-tag--dm">
                                <User :size="10" class="sidebar-tag__icon" aria-hidden="true" />
                                私聊
                              </span>
                            </div>
                            <span class="sidebar-label sidebar-item__time">{{ formatListTime(item.lastMessageAt) }}</span>
                          </div>
                          <div class="sidebar-item__bottom">
                            <p class="sidebar-label sidebar-item__preview">
                              <template v-if="hasDraft(item.key)">
                                <span class="sidebar-draft-tag">[草稿]</span>
                                <span class="sidebar-draft-text">{{ getDraft(item.key) }}</span>
                              </template>
                              <template v-else>
                                {{ item.subtitle }}
                              </template>
                            </p>
                            <span
                              v-if="isRoomMuted(item)"
                              class="sidebar-muted-indicator"
                              title="已设为免打扰"
                              aria-label="已设为免打扰"
                            >
                              <BellOff :size="14" aria-hidden="true" />
                            </span>
                            <span
                              v-if="item.unreadCount > 0"
                              class="sidebar-unread-badge"
                              :class="{ 'sidebar-unread-badge--muted': isRoomMuted(item) }"
                            >
                              {{ item.unreadCount > 99 ? '99+' : item.unreadCount }}
                            </span>
                            <button
                              type="button"
                              class="sidebar-item__delete-btn"
                              title="删除私聊会话"
                              aria-label="删除私聊会话"
                              @click.stop.prevent="confirmDeleteDm(item)"
                            >
                              <Trash2 :size="13" aria-hidden="true" />
                            </button>
                          </div>
                        </div>
                      </button>
                    </div>
                  </div>

                  <!-- 各部门手风琴分组列表 -->
                  <div
                    v-for="group in filteredGroupedDmSections"
                    :key="group.id"
                    class="sidebar-subgroup"
                  >
                    <button
                      type="button"
                      class="sidebar-subgroup-header"
                      :aria-expanded="isDmGroupEffectiveExpanded(group.id)"
                      @click="toggleDmGroup(group.id)"
                    >
                      <div class="sidebar-subgroup-header__left">
                        <ChevronDown
                          :size="13"
                          class="sidebar-subgroup-chevron"
                          :class="{ 'sidebar-subgroup-chevron--collapsed': !isDmGroupEffectiveExpanded(group.id) }"
                        />
                        <Folder v-if="group.groupId" :size="13" class="sidebar-subgroup-folder" />
                        <Users v-else :size="13" class="sidebar-subgroup-folder" />
                        <strong class="sidebar-subgroup-title">{{ group.name }}</strong>
                        <span class="sidebar-subgroup-count">({{ group.items.length }})</span>
                      </div>
                      <div class="sidebar-subgroup-header__right">
                        <span
                          v-if="!isDmGroupEffectiveExpanded(group.id) && getGroupUnreadTotal(group) > 0"
                          class="sidebar-subgroup-unread-pill"
                        >
                          {{ getGroupUnreadTotal(group) > 99 ? '99+' : getGroupUnreadTotal(group) }}
                        </span>
                      </div>
                    </button>

                    <div v-show="isDmGroupEffectiveExpanded(group.id)" class="sidebar-subgroup-body">
                      <button
                        v-for="item in group.items"
                        :key="`${group.id}-${item.key}`"
                        type="button"
                        class="sidebar-item"
                        :class="{
                          'sidebar-item--dm': true,
                          'sidebar-item--active': activeRoomKey === item.key,
                          'sidebar-item--pinned': item.isPinned
                        }"
                        @click="selectConversation(item)"
                        @contextmenu.prevent.stop="togglePinConversation(item.key)"
                      >
                        <div class="sidebar-item__avatar-wrap">
                          <UiAvatar
                            :src="item.avatarUrl"
                            :fallback="item.fallback?.[0] || '?'"
                            size="sm"
                            :show-presence="true"
                            :is-online="isConversationOnline(item)"
                          />
                        </div>
                        <div class="sidebar-label-group">
                          <div class="sidebar-item__top">
                            <div class="sidebar-item__title-wrap">
                              <Pin v-if="item.isPinned" :size="12" class="sidebar-pinned-icon" title="已置顶会话 (右键取消置顶)" aria-label="已置顶" />
                              <strong class="sidebar-label">{{ item.title }}</strong>
                              <span class="sidebar-tag sidebar-tag--dm">
                                <User :size="10" class="sidebar-tag__icon" aria-hidden="true" />
                                私聊
                              </span>
                            </div>
                            <span class="sidebar-label sidebar-item__time">{{ formatListTime(item.lastMessageAt) }}</span>
                          </div>
                          <div class="sidebar-item__bottom">
                            <p class="sidebar-label sidebar-item__preview">
                              <template v-if="hasDraft(item.key)">
                                <span class="sidebar-draft-tag">[草稿]</span>
                                <span class="sidebar-draft-text">{{ getDraft(item.key) }}</span>
                              </template>
                              <template v-else>
                                {{ item.subtitle }}
                              </template>
                            </p>
                            <span
                              v-if="isRoomMuted(item)"
                              class="sidebar-muted-indicator"
                              title="已设为免打扰"
                              aria-label="已设为免打扰"
                            >
                              <BellOff :size="14" aria-hidden="true" />
                            </span>
                            <span
                              v-if="item.unreadCount > 0"
                              class="sidebar-unread-badge"
                              :class="{ 'sidebar-unread-badge--muted': isRoomMuted(item) }"
                            >
                              {{ item.unreadCount > 99 ? '99+' : item.unreadCount }}
                            </span>
                            <button
                              type="button"
                              class="sidebar-item__delete-btn"
                              title="删除私聊会话"
                              aria-label="删除私聊会话"
                              @click.stop.prevent="confirmDeleteDm(item)"
                            >
                              <Trash2 :size="13" aria-hidden="true" />
                            </button>
                          </div>
                        </div>
                      </button>
                    </div>
                  </div>
                </template>

                <!-- 平铺模式或无分组时 -->
                <template v-else>
                  <button
                    v-for="item in filteredDmConversations"
                    :key="item.key"
                    type="button"
                    class="sidebar-item"
                    :class="{
                      'sidebar-item--dm': true,
                      'sidebar-item--active': activeRoomKey === item.key,
                      'sidebar-item--pinned': item.isPinned
                    }"
                    @click="selectConversation(item)"
                    @contextmenu.prevent.stop="togglePinConversation(item.key)"
                  >
                    <div class="sidebar-item__avatar-wrap">
                      <UiAvatar
                        :src="item.avatarUrl"
                        :fallback="item.fallback?.[0] || '?'"
                        size="sm"
                        :show-presence="true"
                        :is-online="isConversationOnline(item)"
                      />
                    </div>
                    <div class="sidebar-label-group">
                      <div class="sidebar-item__top">
                        <div class="sidebar-item__title-wrap">
                          <Pin v-if="item.isPinned" :size="12" class="sidebar-pinned-icon" title="已置顶会话 (右键取消置顶)" aria-label="已置顶" />
                          <strong class="sidebar-label">{{ item.title }}</strong>
                          <span class="sidebar-tag sidebar-tag--dm">
                            <User :size="10" class="sidebar-tag__icon" aria-hidden="true" />
                            私聊
                          </span>
                        </div>
                        <span class="sidebar-label sidebar-item__time">{{ formatListTime(item.lastMessageAt) }}</span>
                      </div>
                      <div class="sidebar-item__bottom">
                        <p class="sidebar-label sidebar-item__preview">
                          <template v-if="hasDraft(item.key)">
                            <span class="sidebar-draft-tag">[草稿]</span>
                            <span class="sidebar-draft-text">{{ getDraft(item.key) }}</span>
                          </template>
                          <template v-else>
                            {{ item.subtitle }}
                          </template>
                        </p>
                        <span
                          v-if="isRoomMuted(item)"
                          class="sidebar-muted-indicator"
                          title="已设为免打扰"
                          aria-label="已设为免打扰"
                        >
                          <BellOff :size="14" aria-hidden="true" />
                        </span>
                        <span
                          v-if="item.unreadCount > 0"
                          class="sidebar-unread-badge"
                          :class="{ 'sidebar-unread-badge--muted': isRoomMuted(item) }"
                        >
                          {{ item.unreadCount > 99 ? '99+' : item.unreadCount }}
                        </span>
                        <button
                          type="button"
                          class="sidebar-item__delete-btn"
                          title="删除私聊会话"
                          aria-label="删除私聊会话"
                          @click.stop.prevent="confirmDeleteDm(item)"
                        >
                          <Trash2 :size="13" aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                  </button>
                </template>
              </div>
            </div>
          </template>
        </div>

        <PublicGroupDiscovery v-if="!isSearchingConversations" :items="publicGroupItems" @select="openPublicGroupPreview" />
      </div>
    </aside>

    <!-- Right Main Chat Window -->
    <main
      class="chat-main"
      :class="{ 'chat-main--dragging': isDraggingFile && Boolean(activeRoom) }"
      @dragenter="onDragEnter"
      @dragover="onDragOver"
      @dragleave="onDragLeave"
      @drop="onDrop"
      @click="handleChatMainClick"
    >
      <template v-if="activeRoom">
        <!-- Drag and drop visual overlay -->
        <Transition name="drag-fade">
          <div
            v-if="isDraggingFile"
            class="chat-drag-overlay"
            @dragover.prevent
            @drop.prevent="onDrop"
            @dragleave.prevent="onDragLeave"
          >
            <div class="chat-drag-box">
              <div class="chat-drag-icon">
                <svg viewBox="0 0 24 24" width="44" height="44" fill="none" stroke="#008069" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="17 8 12 3 7 8"/>
                  <line x1="12" y1="3" x2="12" y2="15"/>
                </svg>
              </div>
              <h3>拖放文件到此处作为附件</h3>
              <p>松开鼠标即可添加并{{ isRoomE2ee(activeRoom) ? '端到端加密' : '' }}上传至当前会话</p>
            </div>
          </div>
        </Transition>

        <header class="chat-header">
          <button
            type="button"
            class="chat-header__back"
            aria-label="返回会话列表"
            @click="returnToMobileConversationList"
          >
            <ArrowLeft :size="24" aria-hidden="true" />
          </button>
          <UiAvatar
            class="chat-header__avatar"
            :src="activeRoomAvatar"
            :fallback="roomLabel(activeRoom)?.[0] || '?'"
            size="sm"
            :show-presence="activeRoom.kind === 'dm'"
            :is-online="dmOtherUserPresence?.isOnline || false"
          />
          <div class="chat-header__identity">
            <div class="chat-header__title-row">
              <h2>{{ roomLabel(activeRoom) }}</h2>
              <span v-if="isRoomE2ee(activeRoom)" class="e2ee-header-badge" title="端到端加密会话">
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                  <title>端到端加密</title>
                  <rect width="18" height="11" x="3" y="11" rx="2" ry="2"/>
                  <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                </svg>
                <span>E2EE</span>
              </span>
            </div>
            <span :class="{ 'chat-header__subtitle--typing': Boolean(typingStatusText) }">
              <span v-if="typingStatusText" class="typing-dots-inline" aria-hidden="true">
                <span class="typing-dot"></span>
                <span class="typing-dot"></span>
                <span class="typing-dot"></span>
              </span>
              {{ activeRoomSubtitle }}
            </span>
          </div>
          <div class="chat-header__actions">
            <div
              class="chat-header__status"
              :class="wsConnected ? 'online' : 'offline'"
              :title="wsConnected ? '实时连接正常' : '正在连接'"
              :aria-label="wsConnected ? '实时连接正常' : '正在连接'"
              role="status"
            ></div>
            <button
              v-if="siteCallsEnabled"
              type="button"
              class="chat-header__button"
              :class="{ 'chat-header__button--active': audioCall.isCallActive.value }"
              :disabled="!activeRoom || Boolean(editingMessage)"
              :title="activeRoom?.kind === 'dm' ? '发起语音电话' : '开启/加入语音会议'"
              :aria-label="activeRoom?.kind === 'dm' ? '发起语音电话' : '开启/加入语音会议'"
              @click="handleCallButtonClick"
            >
              <Phone v-if="activeRoom?.kind === 'dm'" :size="19" aria-hidden="true" />
              <PhoneCall v-else :size="19" aria-hidden="true" />
              <span>{{ activeRoom?.kind === 'dm' ? '电话' : '语音会议' }}</span>
            </button>
            <button
              type="button"
              class="chat-header__button"
              :class="{ 'chat-header__button--active': showSearchBar }"
              :disabled="!activeRoom || Boolean(editingMessage)"
              title="搜索会话消息 (Ctrl+F)"
              aria-label="搜索消息"
              @click="showSearchBar = !showSearchBar"
            >
              <Search :size="19" aria-hidden="true" />
              <span>{{ showSearchBar ? '关闭搜索' : '搜索' }}</span>
            </button>
            <button
              type="button"
              class="chat-header__button"
              :class="{ 'chat-header__button--active': isMultiSelectMode }"
              :title="isMultiSelectMode ? '退出多选' : '多选消息'"
              :aria-label="isMultiSelectMode ? '退出多选' : '多选消息'"
              @click="isMultiSelectMode ? exitMultiSelectMode() : enterMultiSelectMode()"
            >
              <ListChecks :size="19" aria-hidden="true" />
              <span>{{ isMultiSelectMode ? '退出多选' : '多选' }}</span>
            </button>
            <button
              type="button"
              class="chat-header__button"
              :disabled="!activeRoom || Boolean(editingMessage) || uploadingAttachment"
              title="添加附件 (也可直接拖放或粘贴文件)"
              aria-label="添加附件"
              @click="openFilePicker"
            >
              <Paperclip :size="19" aria-hidden="true" />
              <span>附件</span>
            </button>
            <button
              type="button"
              class="chat-header__button"
              :disabled="!activeRoom || Boolean(editingMessage) || uploadingAttachment"
              title="从我的云盘选取文件发送"
              aria-label="从云盘选取"
              @click="showDriveFilePicker = true"
            >
              <Folder :size="19" aria-hidden="true" />
              <span>云盘</span>
            </button>
            <button
              type="button"
              class="chat-header__button"
              :class="{ 'chat-header__button--active': activeRoomMuted }"
              :title="activeRoomMuted ? '关闭当前会话免打扰' : '开启当前会话免打扰'"
              :aria-label="activeRoomMuted ? '关闭当前会话免打扰' : '开启当前会话免打扰'"
              :aria-pressed="activeRoomMuted"
              @click="toggleActiveRoomMute"
            >
              <BellOff v-if="activeRoomMuted" :size="19" aria-hidden="true" />
              <Bell v-else :size="19" aria-hidden="true" />
              <span>{{ activeRoomMuted ? '已免打扰' : '免打扰' }}</span>
            </button>
            <button
              type="button"
              class="chat-header__button"
              title="导出聊天记录"
              aria-label="导出聊天记录"
              @click="openExportDialog"
            >
              <Download :size="19" aria-hidden="true" />
              <span>导出</span>
            </button>
            <button
              v-if="activeRoom.kind !== 'dm'"
              type="button"
              class="chat-header__button"
              :aria-label="showMemberPanel ? '关闭成员列表' : '查看成员列表'"
              :aria-expanded="showMemberPanel"
              @click.stop="toggleMemberPanel"
            >
              <UsersRound :size="19" aria-hidden="true" />
              <span>{{ showMemberPanel ? '收起成员' : '成员' }}</span>
            </button>
            <button
              v-if="activeRoom.isGeneral && session?.isAdmin"
              type="button"
              class="chat-header__button"
              :class="{ 'chat-header__button--active': activeRoom.isMuted }"
              :disabled="savingRoomMute"
              :title="activeRoom.isMuted ? '当前已全员禁言，点击解除禁言' : '点击开启全员禁言（仅管理员可发言）'"
              :aria-label="activeRoom.isMuted ? '解除禁言' : '全员禁言'"
              @click="toggleGeneralRoomMute"
            >
              <VolumeX v-if="activeRoom.isMuted" :size="19" aria-hidden="true" />
              <Volume2 v-else :size="19" aria-hidden="true" />
              <span>{{ activeRoom.isMuted ? '已禁言' : '全员禁言' }}</span>
            </button>
            <button
              v-if="canManageActiveRoom"
              type="button"
              class="chat-header__button"
              aria-label="打开群设置"
              @click.stop="openGroupEditor"
            >
              <Settings :size="19" aria-hidden="true" />
              <span>群设置</span>
            </button>
          </div>
        </header>

        <!-- System Announcements Top Banner -->
        <AnnouncementBanner
          v-if="activeUndismissedAnnouncements.length > 0"
          :announcements="activeUndismissedAnnouncements"
          @open-announcement="openAnnouncementDetail"
          @open-all="openAllAnnouncements"
          @dismiss="dismissAnnouncement"
        />

        <!-- Message Search Bar -->
        <MessageSearchBar
          v-if="showSearchBar"
          :messages="messages"
          :active-room="activeRoom"
          @locate-message="scrollToMessage"
          @close="showSearchBar = false"
        />

        <!-- Pinned Message Banner -->
        <PinnedMessageBanner
          v-if="pinnedMessage"
          :pinned-message="pinnedMessage"
          :can-manage="Boolean(activeRoom?.canManage || activeRoom?.kind === 'dm' || session?.isAdmin)"
          @jump-to-pinned="scrollToMessage"
          @unpin="() => pinMessage(null)"
        />

        <!-- Group Audio Conference Top Bar -->
        <GroupAudioConferenceBar
          v-if="showGroupAudioBar"
          :is-connected="audioCall.isConnected.value && Number(audioCall.currentRoom.value?.id) === Number(activeRoom?.id)"
          :participants-count="currentGroupParticipantsCount"
          :formatted-duration="audioCall.formattedDuration.value"
          :notify-group-cooldown="notifyGroupCooldown"
          :notify-group-success="notifyGroupSuccess"
          @join="audioCall.joinGroupMeeting(activeRoom)"
          @leave="audioCall.leaveGroupMeeting"
          @notify-group="notifyGroupAboutMeeting"
        />

        <div class="chat-messages-wrapper">
          <!-- Floating Sticky Date Capsule (Telegram style) -->
          <Transition name="floating-date-fade">
            <div
              v-if="isFloatingDateVisible && currentFloatingDate"
              class="chat-floating-date"
              role="status"
              aria-live="polite"
            >
              <span>{{ currentFloatingDate }}</span>
            </div>
          </Transition>

          <section
            ref="messagesEl"
            class="chat-messages"
            :class="{ 'chat-messages--multi-select': isMultiSelectMode }"
            @scroll="handleMessagesScroll"
            @pointerdown="handleDragSelectStart"
            @pointermove="handleDragSelectMove"
            @pointerup="handleDragSelectEnd"
            @pointercancel="handleDragSelectEnd"
          >
            <!-- Drag Selection Box Overlay -->
            <div
              v-if="isDragSelecting"
              class="drag-selection-box"
              :style="{
                left: `${Math.min(dragSelectionBox.startX, dragSelectionBox.currentX)}px`,
                top: `${Math.min(dragSelectionBox.startY, dragSelectionBox.currentY)}px`,
                width: `${Math.abs(dragSelectionBox.currentX - dragSelectionBox.startX)}px`,
                height: `${Math.abs(dragSelectionBox.currentY - dragSelectionBox.startY)}px`
              }"
            />

            <button v-if="messages.length" type="button" class="load-more-btn" @click="loadOlder">加载更早</button>
            <div v-if="loading" class="messages-hint">加载中...</div>
            <div v-else-if="!messages.length" class="messages-hint">暂无消息</div>

            <template v-for="(msg, index) in messages" :key="msg.id">
              <!-- In-Stream Date Divider -->
              <div
                v-if="shouldShowDateDivider(msg, index)"
                class="chat-date-divider"
                role="separator"
                :aria-label="formatDateDivider(msg.createdAt)"
              >
                <span class="chat-date-divider__badge">{{ formatDateDivider(msg.createdAt) }}</span>
              </div>

              <div
                v-if="firstUnreadMessageId === msg.id"
                class="unread-messages-divider"
                role="separator"
                aria-orientation="horizontal"
                aria-label="未读消息"
              >
                <div class="unread-messages-divider__line"></div>
                <div class="unread-messages-divider__badge">
                  <span class="unread-messages-divider__text">未读消息</span>
                </div>
                <div class="unread-messages-divider__line"></div>
              </div>

              <article
                :id="`msg-${msg.id}`"
                class="message-row"
                :class="{
                  'message-row--own': isOwnMessage(msg),
                  'message-row--mentioned': isUserMentioned(msg.content, session) && !isOwnMessage(msg),
                  'message-row--highlighted': highlightedMsgId === Number(msg.id),
                  'message-row--moderatable': canModerateMessages && !msg.isRecalled,
                  'message-row--recalled': msg.isRecalled,
                  'message-row--multi-select': isMultiSelectMode,
                  'message-row--selected': selectedMessageIds.has(Number(msg.id))
                }"
                @click="handleMessageRowClick(msg, $event)"
                @contextmenu.prevent.stop="openMessageContextMenu($event, msg)"
              >
                <!-- Multi-select Checkbox -->
                <div
                  v-if="isMultiSelectMode && !msg.isRecalled"
                  class="message-select-checkbox"
                  :class="{ 'message-select-checkbox--checked': selectedMessageIds.has(Number(msg.id)) }"
                  aria-hidden="true"
                >
                  <Check v-if="selectedMessageIds.has(Number(msg.id))" :size="13" :stroke-width="3" />
                </div>
                <div v-if="msg.isRecalled" class="message-recalled-row">
                  <span class="message-recalled-tip">
                    {{ isOwnMessage(msg) ? '你撤回了一条消息' : `${msg.sender?.displayName || '对方'} 撤回了一条消息` }}
                  </span>
                </div>
                <template v-else>
                  <div
                    v-if="!isOwnMessage(msg)"
                    class="message-avatar-wrap"
                  >
                    <UiAvatar
                      v-if="!isOwnMessage(msg)"
                      class="message-avatar"
                      :src="getSenderAvatar(msg)"
                      :alt="msg.sender?.displayName"
                      :fallback="msg.sender?.displayName"
                      size="sm"
                      :show-presence="isSenderPresenceApplicable(msg.sender)"
                      :is-online="isSenderOnline(msg.sender)"
                    />
                    <span
                      v-if="isGroupChat && getMessageSenderRole(msg).isOwner"
                      class="message-avatar-badge message-avatar-badge--owner"
                      title="群主"
                      aria-label="群主"
                    >
                      <Crown :size="9" />
                    </span>
                    <span
                      v-else-if="isGroupChat && getMessageSenderRole(msg).isAdmin"
                      class="message-avatar-badge message-avatar-badge--admin"
                      title="管理员"
                      aria-label="管理员"
                    >
                      <Shield :size="9" />
                    </span>
                  </div>
                  <div
                    class="message-bubble"
                    :class="{
                      'message-bubble--with-attachment': msg.attachment,
                      'message-bubble--with-card': Boolean(parseDriveShareData(msg.content)),
                      'message-bubble--edited': Boolean(msg.editedAt),
                      'message-bubble--e2ee': Boolean(msg.isE2ee)
                    }"
                    :style="getSenderBubbleStyle(msg)"
                    @contextmenu.prevent.stop="openMessageContextMenu($event, msg)"
                    @pointerdown="startMessageLongPress($event, msg)"
                    @pointermove="trackMessageLongPress"
                    @pointerup="cancelMessageLongPress"
                    @pointercancel="cancelMessageLongPress"
                  >
                    <div class="message-sender-name">
                      <span class="message-sender-title">{{ isOwnMessage(msg) ? (session?.displayName || '我') : (msg.sender?.displayName || '未知用户') }}</span>
                      <template v-if="isGroupChat">
                        <span
                          v-if="getMessageSenderRole(msg).isOwner"
                          class="message-role-tag message-role-tag--owner"
                          title="群主"
                        >
                          <Crown :size="10" class="message-role-tag__icon" />
                          <span>群主</span>
                        </span>
                        <span
                          v-if="getMessageSenderRole(msg).isAdmin"
                          class="message-role-tag message-role-tag--admin"
                          title="管理员"
                        >
                          <Shield :size="10" class="message-role-tag__icon" />
                          <span>管理员</span>
                        </span>
                      </template>
                      <span v-if="!isOwnMessage(msg) && msg.sender?.username" class="message-sender-username">@{{ msg.sender.username }}</span>
                      <span v-else-if="isOwnMessage(msg) && session?.username" class="message-sender-username">@{{ session.username }}</span>
                      <SenderSourceBadge :source="msg.sender?.source" />
                    </div>
                    <DriveShareCard
                      v-if="parseDriveShareData(msg.content)"
                      :share-data="parseDriveShareData(msg.content)"
                      :is-own="isOwnMessage(msg)"
                      @preview-file="openDriveFilePreview"
                    />
                    <div
                      v-else-if="isGroupCallInvite(msg.content)"
                      class="group-call-message-card"
                      :class="{ 'group-call-message-card--ended': !showGroupAudioBar }"
                    >
                      <div class="group-call-card-icon" :class="{ 'group-call-card-icon--ended': !showGroupAudioBar }">
                        <Volume2 v-if="showGroupAudioBar" :size="18" />
                        <PhoneOff v-else :size="18" />
                      </div>
                      <div class="group-call-card-content">
                        <div class="group-call-card-title">群聊语音会议</div>
                        <div class="group-call-card-desc">
                          {{ showGroupAudioBar
                               ? (isJoinedToActiveMeeting ? `已在通话中 (${currentGroupParticipantsCount} 人在线)` : `群内正在通话中 (${currentGroupParticipantsCount} 人在线)`)
                               : '通话已结束' }}
                        </div>
                        <div class="group-call-card-actions">
                          <template v-if="showGroupAudioBar">
                            <button
                              v-if="!isJoinedToActiveMeeting"
                              type="button"
                              class="group-call-card-btn"
                              @click="audioCall.joinGroupMeeting(activeRoom)"
                            >
                              <Phone :size="13" />
                              立即加入
                            </button>
                            <span v-else class="group-call-card-joined">
                              <Check :size="13" />
                              已在通话中
                            </span>
                          </template>
                          <span v-else class="group-call-card-ended-label">通话已结束</span>
                        </div>
                      </div>
                    </div>
                    <template v-else>
                      <MarkdownContent v-if="msg.content && !voicePlayer.isVoiceMessage(msg)" :content="msg.content" @jump-to-message="scrollToMessage" />
                      <VoiceMessageBubble
                        v-if="voicePlayer.isVoiceMessage(msg)"
                        :message="msg"
                        :is-own="isOwnMessage(msg)"
                        :is-playing="voicePlayer.currentPlayingMessageId.value === Number(msg.id) && voicePlayer.isPlaying.value"
                        :is-loading="voicePlayer.currentPlayingMessageId.value === Number(msg.id) && voicePlayer.isLoading.value"
                        :is-unread="voicePlayer.isVoiceUnread(msg, isOwnMessage(msg))"
                        @play="voicePlayer.playVoice(msg, messages)"
                      />
                      <MessageAttachment
                        v-if="msg.attachment && !voicePlayer.isVoiceMessage(msg)"
                        :attachment="msg.attachment"
                        :is-own="isOwnMessage(msg)"
                        @preview-file="openDriveFilePreview"
                      />
                    </template>
                    <MessageReactions
                      v-if="msg.reactions && msg.reactions.length > 0"
                      :reactions="msg.reactions"
                      :message-id="msg.id"
                      @toggle-reaction="(emoji) => toggleReaction(msg.id, emoji)"
                    />
                    <span class="message-time" :title="formatLocalDateTime(msg.createdAt)">
                      <span v-if="msg.isE2ee" class="e2ee-msg-tag" title="端到端加密">🔒</span>
                      <span v-if="msg.editedAt" class="message-edited-tag" title="该消息已被编辑">已编辑 · </span>
                      {{ formatBubbleTime(msg.createdAt) }}
                      <span
                        v-if="isOwnMessage(msg)"
                        class="message-read-receipt"
                        :class="{
                          'is-read': isMessageRead(msg),
                          'is-unread': !isMessageRead(msg) && msg.status !== 'sending' && msg.status !== 'failed',
                          'is-pending': msg.status === 'sending',
                          'is-failed': msg.status === 'failed'
                        }"
                        :title="msg.status === 'sending' ? '发送中...' : msg.status === 'failed' ? '发送失败，点击重试' : (isMessageRead(msg) ? (activeRoom?.kind === 'dm' ? '已读' : '已有成员已读') : (activeRoom?.kind === 'dm' ? '未读' : '群成员未读'))"
                      >
                        <svg v-if="msg.status === 'sending'" class="receipt-icon receipt-icon--pending" viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
                          <circle cx="8" cy="8" r="6" stroke-dasharray="24" stroke-dashoffset="8" />
                          <polyline points="8 4.5 8 8 10 9.5" />
                        </svg>
                        <button v-else-if="msg.status === 'failed'" type="button" class="receipt-icon-btn--failed" title="发送失败，点击重试" aria-label="重新发送" @click.stop="retrySendMessage(msg)">
                          <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="#ef4444" stroke-width="2" aria-hidden="true">
                            <circle cx="8" cy="8" r="6.5" fill="#fee2e2" />
                            <line x1="8" y1="4.5" x2="8" y2="8.5" stroke="#ef4444" />
                            <circle cx="8" cy="11.5" r="0.75" fill="#ef4444" stroke="none" />
                          </svg>
                        </button>
                        <svg v-else-if="isMessageRead(msg)" class="receipt-icon receipt-icon--read" viewBox="0 0 16 15" width="14" height="14" fill="currentColor" aria-hidden="true">
                          <path d="M15.01 3.316l-.478-.372a.365.365 0 0 0-.51.063L6.466 12.078 2.03 7.824a.365.365 0 0 0-.51.004l-.442.446a.365.365 0 0 0-.004.51l4.947 4.966a.365.365 0 0 0 .53-.016l8.522-9.904a.365.365 0 0 0-.063-.51z" />
                          <path d="M11.51 3.316l-.478-.372a.365.365 0 0 0-.51.063L2.966 12.078l-.75-.75a.365.365 0 0 0-.51.004l-.442.446a.365.365 0 0 0-.004.51l1.258 1.258a.365.365 0 0 0 .53-.016l8.522-9.904a.365.365 0 0 0-.063-.51z" />
                        </svg>
                        <svg v-else class="receipt-icon receipt-icon--sent" viewBox="0 0 16 15" width="13" height="13" fill="currentColor" aria-hidden="true">
                          <path d="M15.01 3.316l-.478-.372a.365.365 0 0 0-.51.063L6.466 12.078 2.03 7.824a.365.365 0 0 0-.51.004l-.442.446a.365.365 0 0 0-.004.51l4.947 4.966a.365.365 0 0 0 .53-.016l8.522-9.904a.365.365 0 0 0-.063-.51z" />
                        </svg>
                      </span>
                    </span>
                  </div>
                  <div
                    v-if="isOwnMessage(msg)"
                    class="message-avatar-wrap message-avatar-wrap--own"
                  >
                    <UiAvatar
                      v-if="isOwnMessage(msg)"
                      class="message-avatar message-avatar--own"
                      :src="getSenderAvatar(msg)"
                      :alt="session?.displayName || '我'"
                      :fallback="session?.displayName || '我'"
                      size="sm"
                    />
                    <span
                      v-if="isGroupChat && getMessageSenderRole(msg).isOwner"
                      class="message-avatar-badge message-avatar-badge--owner"
                      title="群主"
                      aria-label="群主"
                    >
                      <Crown :size="9" />
                    </span>
                    <span
                      v-else-if="isGroupChat && getMessageSenderRole(msg).isAdmin"
                      class="message-avatar-badge message-avatar-badge--admin"
                      title="管理员"
                      aria-label="管理员"
                    >
                      <Shield :size="9" />
                    </span>
                  </div>
                </template>
              </article>
            </template>
            <div v-if="typingStatusText" class="chat-typing-indicator" role="status" aria-live="polite">
              <span class="typing-dots" aria-hidden="true">
                <span class="typing-dot"></span>
                <span class="typing-dot"></span>
                <span class="typing-dot"></span>
              </span>
              <span class="typing-text">{{ typingStatusText }}</span>
            </div>
          </section>

          <!-- Floating Jump to Bottom / Unread button -->
          <Transition name="fab-fade">
            <button
              v-if="isScrolledUp"
              type="button"
              class="chat-scroll-bottom-btn"
              :title="firstUnreadMessageId ? '跳转到未读消息' : '回到底部最新消息'"
              :aria-label="firstUnreadMessageId ? '跳转到未读消息' : '回到底部最新消息'"
              @click="scrollToUnreadOrBottom"
            >
              <ChevronDown :size="22" aria-hidden="true" />
              <span v-if="unreadCountBadge > 0" class="chat-scroll-bottom-badge">
                {{ unreadCountBadge > 99 ? '99+' : unreadCountBadge }}
              </span>
            </button>
          </Transition>
        </div>

        <MessageContextMenu
          v-if="Boolean(messageMenu.message)"
          :open="Boolean(messageMenu.message)"
          :x="messageMenu.x"
          :y="messageMenu.y"
          :can-reply="!messageMenu.message?.isRecalled"
          :can-forward="!messageMenu.message?.isRecalled"
          :can-download="Boolean(messageMenu.message?.attachment)"
          :can-edit="canEditMessage(messageMenu.message)"
          :can-delete="canDeleteMessage(messageMenu.message)"
          :can-copy="Boolean(messageMenu.message?.content)"
          :can-pin="Boolean(activeRoom?.canManage || activeRoom?.kind === 'dm' || session?.isAdmin)"
          :is-pinned="Boolean(pinnedMessage && Number(pinnedMessage.id) === Number(messageMenu.message?.id))"
          :is-own="isOwnMessage(messageMenu.message)"
          @close="closeMessageMenu"
          @reply="startReplyMessage"
          @forward="openForwardForSingleMessage(messageMenu.message)"
          @download="downloadAttachment"
          @save-to-drive="saveAttachmentToDrive"
          @copy="copyMessageText"
          @edit="startEditMessage"
          @delete="confirmDeleteMessage"
          @select="enterMultiSelectMode(messageMenu.message?.id)"
          @react="(emoji) => toggleReaction(messageMenu.message?.id, emoji)"
          @pin="() => pinMessage(messageMenu.message?.id)"
          @unpin="() => pinMessage(null)"
        />

        <!-- Floating Batch Action Bar -->
        <Transition name="batch-bar-slide">
          <div v-if="isMultiSelectMode" class="batch-action-bar" role="toolbar" aria-label="批量操作">
            <div class="batch-action-bar__left">
              <button
                type="button"
                class="batch-action-btn batch-action-btn--toggle"
                @click="toggleSelectAllMessages"
              >
                <CheckSquare v-if="selectedMessageIds.size > 0 && selectedMessageIds.size >= messages.filter(m => !m.isRecalled).length" :size="16" />
                <Square v-else :size="16" />
                <span>{{ selectedMessageIds.size > 0 && selectedMessageIds.size >= messages.filter(m => !m.isRecalled).length ? '取消全选' : '全选消息' }}</span>
              </button>
              <span class="batch-action-count">已选择 <strong>{{ selectedMessageIds.size }}</strong> 条消息</span>
            </div>

            <div class="batch-action-bar__right">
              <button
                type="button"
                class="batch-action-btn batch-action-btn--forward"
                :disabled="selectedMessageIds.size === 0"
                title="将所选消息转发至其他频道或私聊"
                @click="openBatchForwardModal"
              >
                <Forward :size="16" aria-hidden="true" />
                <span>批量转发 ({{ selectedMessageIds.size }})</span>
              </button>
              <button
                type="button"
                class="batch-action-btn batch-action-btn--primary"
                :disabled="selectedMessageIds.size === 0"
                title="将所选消息一键打包归档至我的云盘"
                @click="openArchiveMessagesToDrive"
              >
                <Folder :size="16" aria-hidden="true" />
                <span>归档到云盘 ({{ selectedMessageIds.size }})</span>
              </button>
              <button
                type="button"
                class="batch-action-btn batch-action-btn--danger"
                :disabled="selectedMessageIds.size === 0 || isBatchDeleting"
                @click="handleBatchDelete"
              >
                <Trash2 :size="16" aria-hidden="true" />
                <span>{{ isBatchDeleting ? '正在删除...' : `批量删除 (${selectedMessageIds.size})` }}</span>
              </button>
              <button
                type="button"
                class="batch-action-btn batch-action-btn--cancel"
                @click="exitMultiSelectMode"
              >
                <X :size="16" aria-hidden="true" />
                <span>退出</span>
              </button>
            </div>
          </div>
        </Transition>

        <footer class="chat-composer" @click="closePickers">
          <div v-if="replyingToMessage" class="composer-reply-bar">
            <div class="composer-reply-bar__lead">
              <Reply :size="14" aria-hidden="true" />
              <span>回复 <strong>@{{ replyingToMessage.sender?.displayName || '成员' }}</strong>:</span>
            </div>
            <div class="composer-reply-bar__preview">
              {{ replyingToMessage.content || (replyingToMessage.attachment ? `[附件: ${replyingToMessage.attachment.name || '文件'}]` : '') }}
            </div>
            <button type="button" class="composer-reply-bar__cancel" title="取消回复" aria-label="取消回复" @click="cancelReplyMessage">
              <X :size="16" aria-hidden="true" />
            </button>
          </div>
          <div v-if="editingMessage" class="composer-editing-bar">
            <div class="composer-editing-bar__lead">
              <Pencil :size="14" aria-hidden="true" />
              <span>编辑消息</span>
            </div>
            <div class="composer-editing-bar__preview">{{ editingMessage.content }}</div>
            <button type="button" class="composer-editing-bar__cancel" title="取消编辑" aria-label="取消编辑" @click="cancelEditMessage">
              <X :size="16" aria-hidden="true" />
            </button>
          </div>
          <div v-if="uploadingAttachment" class="composer-uploading-bar">
            <span class="uploading-spinner"></span>
            <span>正在{{ isRoomE2ee(activeRoom) ? '加密并' : '' }}上传附件...</span>
          </div>
          <div v-if="pendingAttachment" class="composer-attachment">
            <PendingAttachmentPreview :attachment="pendingAttachment" @clear="clearAttachment" />
          </div>
          <div v-if="isCurrentRoomMuted" class="composer-muted-bar">
            <span>🔕 当前群聊已开启全员禁言，仅管理员可以发言</span>
          </div>
          <div v-if="error" class="composer-error">{{ error }}</div>

          <!-- Formatting Toolbar row -->
          <Transition name="fmt-fade">
            <div v-if="showFormattingBar && activeRoom" class="composer-formatting-bar-row">
              <FormattingToolbar @format="handleFormatApply" />
            </div>
          </Transition>

          <!-- Voice Effects Toolbar (when inputMode === 'voice') -->
          <Transition name="fmt-fade">
            <div v-if="inputMode === 'voice' && activeRoom" class="composer-voice-effects-bar">
              <span class="voice-effects-label">变音音效:</span>
              <div class="voice-effects-list">
                <button
                  v-for="eff in voiceRecorder.voiceEffects"
                  :key="eff.id"
                  type="button"
                  class="voice-effect-pill"
                  :class="{ 'voice-effect-pill--active': voiceRecorder.currentEffect.value === eff.id }"
                  :title="eff.desc"
                  @click="voiceRecorder.setVoiceEffect(eff.id)"
                >
                  <span class="voice-effect-icon">{{ eff.icon }}</span>
                  <span class="voice-effect-name">{{ eff.name }}</span>
                </button>
              </div>
            </div>
          </Transition>

          <!-- Mention Auto-complete Popover -->
          <Transition name="popover-fade">
            <MentionPicker
              v-if="showMentionPicker && activeRoom?.kind !== 'dm'"
              ref="mentionPickerRef"
              :show="showMentionPicker"
              :query="mentionQuery"
              :members="groupMembers.length ? groupMembers : users"
              :allow-all="true"
              @select="handleMentionSelect"
              @close="showMentionPicker = false"
            />
          </Transition>

          <div class="composer-row">
            <input ref="fileInputEl" type="file" class="composer-file-input" @change="uploadAttachment" />

            <!-- Voice / Text Mode Toggle Button -->
            <button
              type="button"
              class="composer-btn"
              :class="{ 'composer-btn--active': inputMode === 'voice' }"
              :disabled="!activeRoom || Boolean(editingMessage) || isCurrentRoomMuted"
              :title="inputMode === 'voice' ? '切换到文字输入' : '切换到语音输入'"
              :aria-label="inputMode === 'voice' ? '切换到文字输入' : '切换到语音输入'"
              @click="toggleInputMode"
            >
              <Keyboard v-if="inputMode === 'voice'" :size="20" aria-hidden="true" />
              <Mic v-else :size="20" aria-hidden="true" />
            </button>

            <!-- Attachment File Button -->
            <button
              v-if="inputMode === 'text'"
              type="button"
              class="composer-btn composer-btn--attachment"
              :disabled="!activeRoom || Boolean(editingMessage) || uploadingAttachment || isCurrentRoomMuted"
              title="添加附件 (图片/视频/文件)"
              aria-label="添加附件"
              @click="openFilePicker"
            >
              <Paperclip :size="19" aria-hidden="true" />
            </button>

            <!-- Emoji Picker Trigger & Popover -->
            <div v-if="inputMode === 'text'" class="composer-popover-anchor">
              <button
                type="button"
                class="composer-btn"
                :class="{ 'composer-btn--active': showEmojiPicker }"
                :disabled="!activeRoom || isCurrentRoomMuted"
                title="表情 Emoji"
                aria-label="表情"
                @click.stop="toggleEmojiPicker"
              >
                <span class="composer-icon-emoji">😀</span>
              </button>
              <Transition name="popover-fade">
                <div v-if="showEmojiPicker" class="composer-popover composer-popover--emoji">
                  <EmojiPicker @select="handleEmojiSelect" @close="showEmojiPicker = false" />
                </div>
              </Transition>
            </div>

            <!-- Quick Reply Popover Trigger -->
            <div v-if="inputMode === 'text'" class="composer-popover-anchor composer-popover-anchor--quick">
              <button
                type="button"
                class="composer-btn"
                :class="{ 'composer-btn--active': showQuickReplies }"
                :disabled="!activeRoom || isCurrentRoomMuted"
                title="自定义快捷回复"
                aria-label="快捷回复"
                @click.stop="toggleQuickReplies"
              >
                <span class="composer-icon-quick">⚡</span>
              </button>
              <Transition name="popover-fade">
                <div v-if="showQuickReplies" class="composer-popover composer-popover--quick">
                  <QuickReplyPicker @select="handleQuickReplySelect" @close="showQuickReplies = false" />
                </div>
              </Transition>
            </div>

            <!-- Screenshot Snipping Tool Trigger Button -->
            <button
              v-if="inputMode === 'text'"
              type="button"
              class="composer-btn composer-btn--screenshot"
              :disabled="!activeRoom || uploadingAttachment || isCapturingScreen || isCurrentRoomMuted"
              title="屏幕截图 (点击抓取并框选截取)"
              aria-label="屏幕截图"
              @click="handleTriggerScreenshot"
            >
              <Scissors :size="18" aria-hidden="true" />
            </button>

            <!-- Voice Hold-to-Record Button -->
            <button
              v-if="inputMode === 'voice'"
              type="button"
              class="voice-record-btn"
              :class="{
                'voice-record-btn--recording': voiceRecorder.isRecording.value,
                'voice-record-btn--canceling': voiceRecorder.isCanceling.value
              }"
              :disabled="!activeRoom || isCurrentRoomMuted"
              @pointerdown.prevent="handleVoiceStart"
              @pointermove.prevent="handleVoiceMove"
              @pointerup.prevent="handleVoiceEnd"
              @pointercancel.prevent="handleVoiceCancel"
              @contextmenu.prevent
            >
              <Mic :size="17" aria-hidden="true" />
              <span>{{ voiceRecorder.isRecording.value ? (voiceRecorder.isCanceling.value ? '松开手指，取消发送' : '松开 结束') : '按住 说话' }}</span>
            </button>

            <!-- Text Input Area -->
            <UiTextarea
              v-else
              ref="textareaComponentRef"
              v-model="composerText"
              class="composer-input"
              auto-grow
              :max-height="120"
              rows="1"
              :disabled="!activeRoom || isCurrentRoomMuted"
              :placeholder="editingMessage ? '编辑消息内容... (按 Esc 取消)' : (isRoomE2ee(activeRoom) ? '发送端到端加密消息...' : '输入消息...')"
              @keydown="onComposerKeydown"
              @paste="onPaste"
              @select="handleTextareaSelection"
              @mouseup="handleTextareaSelection"
              @keyup="handleTextareaKeyup"
              @blur="handleTextareaBlur"
              @click="checkMentionTrigger"
            />
            <button
              v-if="inputMode === 'text'"
              type="button"
              class="composer-send"
              :disabled="sending || !activeRoom || isCurrentRoomMuted || (!composerText.trim() && !pendingAttachment)"
              :title="editingMessage ? '保存修改' : '发送消息'"
              :aria-label="editingMessage ? '保存修改' : '发送消息'"
              @click="handleSendMessageOrEdit"
            >
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#3b82f6" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <title>{{ editingMessage ? '保存修改' : '发送' }}</title>
                <line x1="4" y1="12" x2="20" y2="12"/>
                <polyline points="14 6 20 12 14 18"/>
              </svg>
            </button>
          </div>
        </footer>

        <!-- WeChat Style Voice Recording HUD Overlay -->
        <Teleport to="body">
          <Transition name="hud-fade">
            <div
              v-if="voiceRecorder.isRecording.value || voiceRecorder.isTooShort.value"
              class="voice-recording-overlay"
              role="status"
              aria-live="assertive"
            >
              <div
                class="voice-recording-hud"
                :class="{
                  'voice-recording-hud--canceling': voiceRecorder.isCanceling.value,
                  'voice-recording-hud--short': voiceRecorder.isTooShort.value
                }"
              >
                <template v-if="voiceRecorder.isTooShort.value">
                  <div class="voice-hud-icon voice-hud-icon--warning">!</div>
                  <div class="voice-hud-text">说话时间太短</div>
                </template>
                <template v-else-if="voiceRecorder.isCanceling.value">
                  <div class="voice-hud-icon voice-hud-icon--cancel">
                    <Trash2 :size="40" aria-hidden="true" />
                  </div>
                  <div class="voice-hud-text voice-hud-text--cancel">松开手指，取消发送</div>
                </template>
                <template v-else>
                  <div class="voice-hud-waves-box">
                    <Mic :size="36" class="voice-hud-mic" aria-hidden="true" />
                    <div class="voice-hud-bars" aria-hidden="true">
                      <span class="vbar vbar-1"></span>
                      <span class="vbar vbar-2"></span>
                      <span class="vbar vbar-3"></span>
                      <span class="vbar vbar-4"></span>
                      <span class="vbar vbar-5"></span>
                    </div>
                  </div>
                  <div v-if="voiceRecorder.currentEffect.value !== 'original'" class="voice-hud-effect-tag">
                    {{ voiceRecorder.voiceEffects.find(e => e.id === voiceRecorder.currentEffect.value)?.icon }}
                    {{ voiceRecorder.voiceEffects.find(e => e.id === voiceRecorder.currentEffect.value)?.name }}变音
                  </div>
                  <div class="voice-hud-duration">{{ Math.round(voiceRecorder.duration.value) }}" / 60"</div>
                  <div class="voice-hud-text">手指上滑，取消发送</div>
                </template>
              </div>
            </div>
          </Transition>
        </Teleport>
      </template>

      <div v-else class="chat-empty">
        <div class="empty-content">
          <div class="empty-brand">
            <span class="empty-title">EdgeChat</span>
          </div>
        </div>
      </div>
    </main>

    <div v-if="showMemberPanel" class="room-management-layer" @click.self="closeMemberPanel">
      <aside class="room-management-sidebar">
        <MemberPanel
          :room="activeRoom"
          :members="groupMembers"
          :loading="memberLoading"
          :can-manage="canManageActiveRoom"
          :invite-user-id="inviteUserId"
          :available-invite-users="availableInviteUsers"
          :invite-submitting="inviteSubmitting"
          @close="closeMemberPanel"
          @update:invite-user-id="inviteUserId = $event"
          @invite="inviteMember"
          @transfer-owner="transferOwner"
          @remove-member="removeMember"
          @delete-group="deleteGroup"
        />
      </aside>
    </div>

    <MobileNavigationDrawer
      :show="showMobileNavigation"
      :session="session"
      :show-admin="showAdminEntry"
      :notifications-enabled="notificationsEnabled"
      :notification-label="notificationActionLabel"
      :notification-disabled="notificationToggleDisabled"
      :sound-enabled="soundEnabled"
      @close="closeMobileNavigation"
      @drive="navigateFromMobileDrawer(() => router.push('/drive'))"
      @settings="navigateFromMobileDrawer(openSettings)"
      @admin="navigateFromMobileDrawer(openAdmin)"
      @notification="toggleNotifications"
      @sound="toggleSound"
      @logout="navigateFromMobileDrawer(logout)"
    />

    <AddConversationDialog
      :show="showAddConversation"
      :users="usersWithoutDm"
      :opening-dm-user-id="openingDmUserId"
      :error="error"
      @close="closeAddConversation"
      @create-group="startGroupCreation"
      @open-dm="openDm"
    />

    <CreateGroupDialog
      :show="showCreateGroup"
      :users="users"
      :form="createGroupForm"
      :submitting="creatingGroup"
      @close="closeCreateGroup"
      @toggle-member="toggleCreateGroupMember"
      @submit="createGroup"
    />

    <PublicGroupJoinDialog
      :show="Boolean(publicGroupPreview)"
      :channel="publicGroupPreview"
      :joining="joiningPublicGroup"
      @close="closePublicGroupPreview"
      @join="confirmPublicGroupJoin"
    />

    <GroupSettingsDialog
      :show="showGroupEditor"
      :room="activeRoom"
      :form="groupSettingsForm"
      :saving="groupSettingsSaving"
      :avatar-uploading="groupAvatarUploading"
      :is-admin="Boolean(session?.isAdmin)"
      @close="closeGroupEditor"
      @upload-avatar="uploadGroupAvatar"
      @save="saveGroupSettings"
      @toggle-mute="toggleGeneralRoomMute"
    />

    <ExportChatDialog
      :show="showExportDialog"
      :room="activeRoom"
      :session="session"
      @close="showExportDialog = false"
    />

    <!-- System Announcements Full Modal -->
    <AnnouncementModal
      :show="showAnnouncementModal"
      :announcements="announcements"
      :selected-announcement-id="selectedAnnouncementId"
      @close="closeAnnouncementModal"
    />

    <!-- Global Audio Call Modal & Floating Widget -->
    <AudioCallModal
      :call-status="audioCall.callStatus.value"
      :call-type="audioCall.callType.value"
      :target-user="audioCall.targetUser.value"
      :current-room="audioCall.currentRoom.value"
      :is-muted="audioCall.isMuted.value"
      :is-minimized="audioCall.isMinimized.value"
      :is-local-speaking="audioCall.isLocalSpeaking.value"
      :is-remote-speaking="audioCall.isRemoteSpeaking.value"
      :is-hand-raised="audioCall.isHandRaised.value"
      :can-manage="Boolean(canManageActiveRoom || isCurrentRoomOwner || session?.isAdmin)"
      :is-owner="Boolean(isCurrentRoomOwner)"
      :current-voice-effect="audioCall.currentVoiceEffect.value"
      :available-voice-effects="audioCall.availableVoiceEffects"
      :formatted-duration="audioCall.formattedDuration.value"
      :group-participants="audioCall.groupParticipants.value"
      :error-message="audioCall.errorMessage.value"
      :notify-group-cooldown="notifyGroupCooldown"
      :notify-group-success="notifyGroupSuccess"
      @accept="audioCall.acceptCall"
      @reject="audioCall.rejectCall"
      @end="audioCall.endCall"
      @toggle-mute="audioCall.toggleMute"
      @toggle-minimize="audioCall.isMinimized.value = !audioCall.isMinimized.value"
      @leave-group="audioCall.leaveGroupMeeting"
      @notify-group="notifyGroupAboutMeeting"
      @set-voice-effect="audioCall.setVoiceEffect"
      @raise-hand="audioCall.raiseHand"
      @lower-hand="audioCall.lowerHand"
      @toggle-hand="audioCall.toggleHand"
      @mute-participant="audioCall.muteParticipant"
      @mute-all="audioCall.muteAll"
      @kick-participant="audioCall.kickParticipant"
      @approve-hand="audioCall.approveHand"
      @reject-hand="audioCall.rejectHand"
    />

    <!-- Interactive Screenshot Snipping Modal -->
    <ScreenshotModal
      v-if="showScreenshotModal && screenshotImage"
      :image-src="screenshotImage"
      @confirm="handleScreenshotConfirm"
      @cancel="closeScreenshotModal"
    />

    <!-- Drive File Picker Modal -->
    <DriveFilePickerModal
      v-if="showDriveFilePicker"
      :show="showDriveFilePicker"
      :on-close="() => (showDriveFilePicker = false)"
      :on-select-file="handleSendDriveFile"
      :on-share-card="handleSendDriveShareCard"
    />

    <!-- Drive Folder Selector Modal for Saving/Archiving -->
    <DriveFolderSelectorModal
      v-if="showFolderSelector"
      :show="showFolderSelector"
      :title="folderSelectorTitle"
      :confirm-text="folderSelectorConfirmText"
      :on-close="() => (showFolderSelector = false)"
      :on-confirm="folderSelectorHandler"
    />

    <!-- Drive File Preview Modal from Chat Card -->
    <DriveFilePreviewModal
      v-if="previewDriveFile"
      :file="previewDriveFile"
      :file-url="api.getDriveFileUrl(previewDriveFile.id, true)"
      :download-url="api.getDriveFileUrl(previewDriveFile.id, false)"
      :on-close="() => (previewDriveFile = null)"
    />

    <!-- Forward Message Dialog -->
    <ForwardMessageModal
      :open="forwardModalState.open"
      :messages="forwardModalState.messages"
      :conversations="conversationItems"
      :current-room="activeRoom"
      @close="forwardModalState.open = false"
      @forwarded="handleForwardCompleted"
    />

    <!-- E2EE Key Recovery Modal (Roaming / New Device) -->
    <KeyRecoveryModal
      @recovered="activeRoom && loadMessages()"
      @reset="activeRoom && loadMessages()"
    />
  </div>
</template>

<style scoped>
.chat-layout {
  position: fixed;
  top: var(--chat-viewport-offset-top, 0px);
  left: 0;
  display: flex;
  width: 100%;
  height: var(--chat-viewport-height, 100dvh);
  min-height: 100dvh;
  overflow: hidden;
  background: #efeae2;
}

.left-sidebar {
  flex-shrink: 0;
  width: 350px;
  height: 100%;
  position: relative;
  z-index: 10;
  overflow: hidden;
  background: #ffffff;
  border-right: 1px solid #e9edef;
}

.left-sidebar .sidebar-inner {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: #ffffff;
  overflow: hidden;
}

.sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 16px 12px;
  background: #ffffff;
}

.mobile-menu-action {
  display: none;
}

.brand-title {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
  color: #008069;
  font-family: system-ui, -apple-system, sans-serif;
}

.sidebar-header-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.header-action {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 36px;
  width: 36px;
  height: 36px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: #54656f;
  cursor: pointer;
  text-decoration: none;
  transition: background 150ms, color 150ms;
}

.header-action:hover {
  background: rgba(0, 0, 0, 0.05);
  color: #111b21;
}

.announcement-header-btn {
  position: relative;
}

.announcement-unread-dot {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #16a34a;
  box-shadow: 0 0 0 2px #ffffff;
}

.header-action:active,
.sidebar-item:active,
.chat-header__button:active,
.composer-btn:active:not(:disabled),
.composer-send:active:not(:disabled) {
  background: rgba(0, 0, 0, 0.08);
}

.sidebar-section {
  flex-shrink: 0;
}

.sidebar-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 0;
  touch-action: pan-y;
}

.sidebar-list::-webkit-scrollbar { width: 4px; }
.sidebar-list::-webkit-scrollbar-thumb { background: rgba(0, 0, 0, 0.15); border-radius: 2px; }

.sidebar-search-wrap {
  padding: 8px 12px 10px;
  background: #ffffff;
  flex-shrink: 0;
}

.sidebar-search-box {
  display: flex;
  align-items: center;
  gap: 8px;
  background: #f0f2f5;
  border-radius: 8px;
  padding: 6px 10px;
  border: 1px solid transparent;
  transition: all 0.2s ease;
}

.sidebar-search-box:focus-within {
  background: #ffffff;
  border-color: #008069;
  box-shadow: 0 0 0 2px rgba(0, 128, 105, 0.15);
}

.sidebar-search-icon {
  color: #8696a0;
  flex-shrink: 0;
}

.sidebar-search-input {
  flex: 1;
  min-width: 0;
  border: none;
  background: transparent;
  font-size: 13px;
  color: #111b21;
  outline: none;
  padding: 0;
}

.sidebar-search-input::placeholder {
  color: #8696a0;
}

.sidebar-search-clear {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border: none;
  border-radius: 50%;
  background: #d1d7db;
  color: #54656f;
  cursor: pointer;
  padding: 0;
  transition: all 0.15s ease;
  flex-shrink: 0;
}

.sidebar-search-clear:hover {
  background: #bec5c9;
  color: #111b21;
}

.sidebar-search-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 36px 20px;
  text-align: center;
  color: #8696a0;
}

.sidebar-search-empty__icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: rgba(0, 128, 105, 0.08);
  color: #008069;
  margin-bottom: 12px;
}

.sidebar-search-empty__title {
  font-size: 14px;
  font-weight: 600;
  color: #111b21;
  margin: 0 0 6px;
}

.sidebar-search-empty__desc {
  font-size: 12.5px;
  color: #667781;
  margin: 0 0 16px;
  max-width: 220px;
  line-height: 1.4;
  word-break: break-word;
}

.sidebar-search-empty__btn {
  padding: 5px 14px;
  font-size: 12.5px;
  border: 1px solid #d1d7db;
  border-radius: 6px;
  background: #ffffff;
  color: #008069;
  cursor: pointer;
  transition: all 0.15s ease;
}

.sidebar-search-empty__btn:hover {
  background: #f0f2f5;
  border-color: #008069;
}

.sidebar-divider {
  flex-shrink: 0;
  height: 1px;
  background: #f0f2f5;
}

.sidebar-hint {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px 8px;
  font-size: 13px;
  color: #8696a0;
}

.sidebar-item svg {
  flex-shrink: 0;
}

.sidebar-label-group {
  flex: 1;
  min-width: 0;
}

.sidebar-item__avatar-wrap {
  position: relative;
  flex-shrink: 0;
  display: inline-flex;
}

/* 群聊头像微圆角几何化设计（Squircle 现代风格） */
.sidebar-item--group :deep(.ui-avatar),
.sidebar-item--group :deep(.ui-avatar__inner),
.sidebar-item--group :deep(.ui-avatar__inner img) {
  border-radius: 11px !important;
}

/* 私聊头像保持正圆个人头像 */
.sidebar-item--dm :deep(.ui-avatar),
.sidebar-item--dm :deep(.ui-avatar__inner),
.sidebar-item--dm :deep(.ui-avatar__inner img) {
  border-radius: 50% !important;
}

.sidebar-avatar-badge {
  position: absolute;
  bottom: -2px;
  right: -2px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 15px;
  height: 15px;
  border-radius: 50%;
  border: 2px solid #ffffff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
  color: #ffffff;
  z-index: 1;
}

.sidebar-avatar-badge--group {
  background: #6366f1;
}

.sidebar-avatar-badge--public {
  background: #0284c7;
}

.sidebar-avatar-badge--private {
  background: #6366f1;
}

.sidebar-avatar-badge--general {
  background: #f59e0b;
}

.sidebar-item :deep(.ui-avatar) {
  flex-shrink: 0;
}

.sidebar-item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 12px;
  width: calc(100% - 16px);
  margin: 3px 8px;
  padding: 10px 14px;
  border: 1px solid transparent;
  border-radius: 12px;
  background: transparent;
  cursor: pointer;
  text-align: left;
  transition: all 180ms cubic-bezier(0.4, 0, 0.2, 1);
  touch-action: manipulation;
  user-select: none;
}

.sidebar-item:hover {
  background: rgba(0, 0, 0, 0.035);
  transform: translateX(2px);
}

.sidebar-item:active {
  transform: scale(0.985);
}

.sidebar-item--pinned {
  background: rgba(0, 128, 105, 0.035);
}

.sidebar-item--pinned:hover {
  background: rgba(0, 128, 105, 0.065);
}

/* 群聊专属外观风格 */
.sidebar-item--group:hover {
  background: rgba(99, 102, 241, 0.04);
}

.sidebar-item--group.sidebar-item--active {
  background: linear-gradient(135deg, rgba(99, 102, 241, 0.09) 0%, rgba(255, 255, 255, 0.98) 100%);
  border-color: rgba(99, 102, 241, 0.25);
  box-shadow: 0 4px 14px rgba(99, 102, 241, 0.12), 0 1px 3px rgba(0, 0, 0, 0.04);
}

.sidebar-item--group.sidebar-item--active::before {
  background: #6366f1;
  box-shadow: 0 0 6px rgba(99, 102, 241, 0.5);
}

.sidebar-item--group.sidebar-item--active:hover {
  background: linear-gradient(135deg, rgba(99, 102, 241, 0.12) 0%, rgba(255, 255, 255, 1) 100%);
}

.sidebar-item--group.sidebar-item--active .sidebar-item__top strong {
  color: #3730a3;
}

.sidebar-item--group.sidebar-item--active .sidebar-item__time {
  color: #6366f1;
}

/* 公开群专属外观风格 */
.sidebar-item--public:hover {
  background: rgba(2, 132, 199, 0.04);
}

.sidebar-item--public.sidebar-item--active {
  background: linear-gradient(135deg, rgba(2, 132, 199, 0.09) 0%, rgba(255, 255, 255, 0.98) 100%);
  border-color: rgba(2, 132, 199, 0.25);
  box-shadow: 0 4px 14px rgba(2, 132, 199, 0.12), 0 1px 3px rgba(0, 0, 0, 0.04);
}

.sidebar-item--public.sidebar-item--active::before {
  background: #0284c7;
  box-shadow: 0 0 6px rgba(2, 132, 199, 0.5);
}

.sidebar-item--public.sidebar-item--active:hover {
  background: linear-gradient(135deg, rgba(2, 132, 199, 0.12) 0%, rgba(255, 255, 255, 1) 100%);
}

.sidebar-item--public.sidebar-item--active .sidebar-item__top strong {
  color: #075985;
}

.sidebar-item--public.sidebar-item--active .sidebar-item__time {
  color: #0284c7;
}

/* 私密群专属外观风格 */
.sidebar-item--private:hover {
  background: rgba(99, 102, 241, 0.04);
}

.sidebar-item--private.sidebar-item--active {
  background: linear-gradient(135deg, rgba(99, 102, 241, 0.09) 0%, rgba(255, 255, 255, 0.98) 100%);
  border-color: rgba(99, 102, 241, 0.25);
  box-shadow: 0 4px 14px rgba(99, 102, 241, 0.12), 0 1px 3px rgba(0, 0, 0, 0.04);
}

.sidebar-item--private.sidebar-item--active::before {
  background: #6366f1;
  box-shadow: 0 0 6px rgba(99, 102, 241, 0.5);
}

.sidebar-item--private.sidebar-item--active:hover {
  background: linear-gradient(135deg, rgba(99, 102, 241, 0.12) 0%, rgba(255, 255, 255, 1) 100%);
}

.sidebar-item--private.sidebar-item--active .sidebar-item__top strong {
  color: #3730a3;
}

.sidebar-item--private.sidebar-item--active .sidebar-item__time {
  color: #6366f1;
}

/* 全员群特殊色调 */
.sidebar-item--general.sidebar-item--active {
  background: linear-gradient(135deg, rgba(245, 158, 11, 0.1) 0%, rgba(255, 255, 255, 0.98) 100%);
  border-color: rgba(245, 158, 11, 0.28);
  box-shadow: 0 4px 14px rgba(245, 158, 11, 0.12), 0 1px 3px rgba(0, 0, 0, 0.04);
}

.sidebar-item--general.sidebar-item--active::before {
  background: #f59e0b;
  box-shadow: 0 0 6px rgba(245, 158, 11, 0.5);
}

.sidebar-item--general.sidebar-item--active .sidebar-item__top strong {
  color: #92400e;
}

.sidebar-item--general.sidebar-item--active .sidebar-item__time {
  color: #d97706;
}

/* 私聊专属外观风格 */
.sidebar-item--dm:hover {
  background: rgba(0, 128, 105, 0.04);
}

.sidebar-item__top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}

.sidebar-item__title-wrap {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  flex: 1;
  overflow: hidden;
}

.sidebar-item__top strong {
  font-size: 15px;
  font-weight: 500;
  color: #111b21;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
  flex-shrink: 1;
}

.sidebar-tag {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 3px;
  padding: 1px 5px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 600;
  line-height: 1.3;
  flex-shrink: 0;
  letter-spacing: 0.2px;
}

.sidebar-tag__icon {
  flex-shrink: 0;
  opacity: 0.85;
}

.sidebar-tag--group {
  color: #4f46e5;
  background: rgba(99, 102, 241, 0.08);
  border: 1px solid rgba(99, 102, 241, 0.2);
}

.sidebar-tag--public {
  color: #0369a1;
  background: rgba(2, 132, 199, 0.08);
  border: 1px solid rgba(2, 132, 199, 0.22);
}

.sidebar-tag--private {
  color: #4338ca;
  background: rgba(99, 102, 241, 0.08);
  border: 1px solid rgba(99, 102, 241, 0.2);
}

.sidebar-tag--general {
  color: #b45309;
  background: rgba(245, 158, 11, 0.1);
  border: 1px solid rgba(245, 158, 11, 0.25);
}

.sidebar-tag--dm {
  color: #059669;
  background: rgba(16, 185, 129, 0.08);
  border: 1px solid rgba(16, 185, 129, 0.2);
}

.sidebar-item__time {
  font-size: 12px;
  color: #667781;
  flex-shrink: 0;
}

.sidebar-item--active {
  background: linear-gradient(135deg, rgba(0, 128, 105, 0.08) 0%, rgba(255, 255, 255, 0.95) 100%);
  border-color: rgba(0, 128, 105, 0.22);
  box-shadow: 0 4px 14px rgba(0, 128, 105, 0.12), 0 1px 3px rgba(0, 0, 0, 0.04);
}

.sidebar-item--active::before {
  content: '';
  position: absolute;
  left: 0;
  top: 8px;
  bottom: 8px;
  width: 3.5px;
  border-radius: 0 4px 4px 0;
  background: #008069;
  box-shadow: 0 0 6px rgba(0, 128, 105, 0.5);
}

.sidebar-item--active:hover {
  background: linear-gradient(135deg, rgba(0, 128, 105, 0.1) 0%, rgba(255, 255, 255, 0.98) 100%);
  transform: none;
}

.sidebar-item--active .sidebar-item__top strong {
  font-weight: 600;
  color: #064e3b;
}

.sidebar-item--active .sidebar-item__time {
  color: #008069;
  font-weight: 500;
}

.sidebar-item__preview {
  margin: 0;
  font-size: 13px;
  color: #667781;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sidebar-draft-tag {
  display: inline-flex;
  align-items: center;
  padding: 1px 5px;
  font-size: 11px;
  color: #ea580c;
  background: rgba(234, 88, 12, 0.1);
  border-radius: 4px;
  font-weight: 600;
  margin-right: 4px;
  line-height: 1.2;
}

.sidebar-draft-text {
  color: #475569;
  font-style: italic;
}

.sidebar-item__bottom {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
  min-width: 0;
}

.sidebar-unread-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  min-width: 20px;
  height: 20px;
  padding: 0 6px;
  border-radius: 999px;
  background: #25d366;
  color: #ffffff;
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
  font-variant-numeric: tabular-nums;
  box-shadow: 0 1px 3px rgba(37, 211, 102, 0.35);
  letter-spacing: -0.2px;
}

.sidebar-unread-badge--muted {
  background: #94a3b8;
  box-shadow: 0 1px 3px rgba(148, 163, 184, 0.25);
}

.sidebar-item__delete-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: none;
  background: transparent;
  color: #94a3b8;
  border-radius: 6px;
  cursor: pointer;
  opacity: 0;
  flex-shrink: 0;
  transition: all 0.15s ease;
}

.sidebar-item:hover .sidebar-item__delete-btn,
.sidebar-item:focus-within .sidebar-item__delete-btn,
.sidebar-item__delete-btn:focus-visible {
  opacity: 0.75;
}

.sidebar-item__delete-btn:hover {
  opacity: 1;
  color: #ef4444;
  background: rgba(239, 68, 68, 0.12);
}

@media (hover: none) {
  .sidebar-item__delete-btn {
    opacity: 0.65;
  }
}

.sidebar-group {
  margin-bottom: 4px;
}

.sidebar-group-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 8px 16px 6px;
  background: transparent;
  border: none;
  cursor: pointer;
  user-select: none;
  transition: background 150ms ease;
  touch-action: manipulation;
}

.sidebar-group-header:hover {
  background: rgba(0, 0, 0, 0.03);
}

.sidebar-group-header__title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
  color: #54656f;
  letter-spacing: 0.2px;
}

.sidebar-group-chevron {
  color: #8696a0;
  transition: transform 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}

.sidebar-group-chevron--collapsed {
  transform: rotate(-90deg);
}

.sidebar-group-count {
  font-size: 11.5px;
  color: #8696a0;
  font-weight: 500;
}

.sidebar-group-header__meta {
  display: flex;
  align-items: center;
  gap: 6px;
}

.sidebar-group-unread-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 999px;
  background: #25d366;
  color: #ffffff;
  font-size: 10.5px;
  font-weight: 700;
  line-height: 1;
}

.sidebar-group-empty {
  padding: 6px 16px 10px 32px;
  font-size: 12.5px;
  color: #8696a0;
}

.sidebar-group-content {
  display: flex;
  flex-direction: column;
}

.sidebar-group-mode-btn {
  background: rgba(0, 128, 105, 0.08);
  border: 1px solid rgba(0, 128, 105, 0.22);
  color: #008069;
  font-size: 11px;
  font-weight: 600;
  padding: 1px 7px;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s ease;
  line-height: 1.4;
}

.sidebar-group-mode-btn:hover {
  background: #008069;
  color: #ffffff;
}

.sidebar-group-mode-btn--active {
  background: #008069;
  color: #ffffff;
}

.sidebar-subgroup {
  display: flex;
  flex-direction: column;
}

.sidebar-subgroup-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 7px 16px 6px 20px;
  background: #eef5f3;
  border: none;
  border-radius: 6px;
  margin: 2px 8px;
  width: calc(100% - 16px);
  cursor: pointer;
  user-select: none;
  transition: background 150ms ease;
  text-align: left;
}

.sidebar-subgroup-header:hover {
  background: #e1ede9;
}

.sidebar-subgroup-header--static {
  cursor: default;
  background: #fef8ec;
}

.sidebar-subgroup-header--static:hover {
  background: #fef8ec;
}

.sidebar-subgroup-header__left {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  flex: 1;
}

.sidebar-subgroup-chevron {
  color: #94a3b8;
  transition: transform 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  flex-shrink: 0;
}

.sidebar-subgroup-chevron--collapsed {
  transform: rotate(-90deg);
}

.sidebar-subgroup-folder {
  color: #008069;
  flex-shrink: 0;
}

.sidebar-pinned-subgroup-icon {
  color: #f59e0b;
  flex-shrink: 0;
}

.sidebar-subgroup-title {
  font-size: 12px;
  color: #475569;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sidebar-subgroup-count {
  font-size: 11px;
  color: #94a3b8;
  flex-shrink: 0;
}

.sidebar-subgroup-header__right {
  display: flex;
  align-items: center;
  flex-shrink: 0;
}

.sidebar-subgroup-unread-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 999px;
  background: #25d366;
  color: #ffffff;
  font-size: 10px;
  font-weight: 700;
  line-height: 1;
}

.sidebar-subgroup-body {
  display: flex;
  flex-direction: column;
  padding-left: 12px;
}

.right-sidebar {
  flex-shrink: 0;
  width: 68px;
  height: 100%;
  position: relative;
  z-index: 10;
  overflow: hidden;
  background: #f0f2f5;
  border-right: 1px solid #e9edef;
}

.right-sidebar-inner {
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  background: #f0f2f5;
  padding: 16px 8px;
  align-items: center;
}

.right-sidebar-section {
  display: flex;
  flex-direction: column;
  gap: 16px;
  align-items: center;
  width: 100%;
}

.right-sidebar-user-group {
  margin-top: auto;
}

.right-sidebar-action,
.right-sidebar-user {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 42px;
  height: 42px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: #54656f;
  cursor: pointer;
  transition: background 150ms, color 150ms, transform 150ms;
  padding: 0;
  position: relative;
  touch-action: manipulation;
}

.sidebar-muted-indicator {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  color: #8696a0;
}

.right-sidebar-action:hover,
.right-sidebar-user:hover {
  background: rgba(0, 0, 0, 0.05);
  color: #111b21;
}

.right-sidebar-action--danger:hover {
  background: rgba(254, 242, 242, 0.8);
  color: #dc2626;
}

.right-sidebar-action--admin,
.right-sidebar-action--labeled {
  width: 52px;
  height: 56px;
  gap: 4px;
  border-radius: 8px;
}

.right-sidebar-action--admin {
  flex-direction: column;
}

.right-sidebar-action--labeled {
  flex-direction: column;
}

.right-sidebar-action--notification-active {
  background: rgba(0, 128, 105, 0.1);
  color: #008069;
}

.right-sidebar-action:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.right-sidebar-action__label {
  font-size: 10px;
  line-height: 1.2;
  white-space: nowrap;
}

.tooltip {
  position: relative;
}

.tooltip::after {
  content: attr(data-tooltip);
  position: absolute;
  left: 120%;
  top: 50%;
  transform: translateY(-50%);
  background: #333;
  color: #fff;
  padding: 6px 10px;
  border-radius: 6px;
  font-size: 12px;
  white-space: nowrap;
  opacity: 0;
  pointer-events: none;
  transition: opacity 150ms ease, transform 150ms ease;
  z-index: 1000;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

.tooltip:hover::after {
  opacity: 1;
  transform: translateY(-50%) translateX(4px);
}

.chat-main {
  position: relative;
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: #efeae2;
}

.chat-main--dragging {
  user-select: none;
}

.chat-drag-overlay {
  position: absolute;
  inset: 0;
  z-index: 99;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(240, 242, 245, 0.88);
  backdrop-filter: blur(5px);
  -webkit-backdrop-filter: blur(5px);
  padding: 24px;
  pointer-events: auto;
}

.chat-drag-box {
  width: min(420px, 90%);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 36px 24px;
  border: 2.5px dashed #008069;
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.95);
  box-shadow: 0 16px 40px rgba(0, 128, 105, 0.15);
  text-align: center;
  pointer-events: none;
  animation: dragPulse 1.6s ease-in-out infinite alternate;
}

.chat-drag-icon {
  margin-bottom: 14px;
  padding: 14px;
  border-radius: 50%;
  background: #e8f5e9;
  display: flex;
  align-items: center;
  justify-content: center;
}

.chat-drag-box h3 {
  margin: 0 0 6px;
  font-size: 17px;
  font-weight: 600;
  color: #111b21;
}

.chat-drag-box p {
  margin: 0;
  font-size: 13px;
  color: #667781;
}

@keyframes dragPulse {
  from { transform: scale(0.98); }
  to { transform: scale(1.02); }
}

.drag-fade-enter-active {
  transition: opacity 180ms ease, transform 180ms ease;
}

.drag-fade-leave-active {
  transition: opacity 150ms ease;
}

.drag-fade-enter-from,
.drag-fade-leave-to {
  opacity: 0;
}

.composer-uploading-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  margin-bottom: 8px;
  background: #f0fdf4;
  border: 1px solid #bbf7d0;
  border-radius: 8px;
  font-size: 12.5px;
  color: #15803d;
}

.uploading-spinner {
  width: 14px;
  height: 14px;
  border: 2px solid #bbf7d0;
  border-top-color: #15803d;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  flex-shrink: 0;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.chat-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 16px;
  background: #f0f2f5;
  border-bottom: 1px solid #e9edef;
  min-width: 0;
}

.chat-header__back {
  display: none;
}

.chat-header__avatar {
  flex: 0 0 auto;
}

.chat-header__identity {
  display: grid;
  flex: 1;
  gap: 2px;
  min-width: 0;
  overflow: hidden;
}

.chat-header__identity span {
  overflow: hidden;
  color: #667781;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chat-header__actions {
  display: flex;
  align-items: center;
  gap: 8px;
  max-width: 100%;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
  -webkit-overflow-scrolling: touch;
  touch-action: pan-x;
}

.chat-header__actions::-webkit-scrollbar {
  display: none;
}

.chat-header__button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 36px;
  padding: 6px 10px;
  border: 1px solid #d8dee2;
  border-radius: 8px;
  background: #fff;
  color: #54656f;
  font-size: 12px;
  cursor: pointer;
  transition: background 150ms, color 150ms, border-color 150ms;
  touch-action: manipulation;
  flex-shrink: 0;
  white-space: nowrap;
}

.chat-header__button:hover {
  background: #f5f7fa;
  border-color: #c7d0d6;
  color: #111b21;
}

.chat-header__button--active {
  border-color: rgba(0, 128, 105, 0.28);
  background: rgba(0, 128, 105, 0.08);
  color: #008069;
}

.header-action:focus-visible {
  outline: 2px solid #008069;
  outline-offset: 2px;
}

.header-action img {
  display: block;
  width: 20px;
  height: 20px;
}

.chat-header h2 {
  margin: 0;
  padding: 0;
  font-size: 16px;
  font-weight: 600;
  color: #111b21;
  background: transparent;
  border-radius: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chat-header__status {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #d1d5db;
}

.chat-header__status.online {
  background: #10b981;
}

.chat-messages-wrapper {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.chat-scroll-bottom-btn {
  position: absolute;
  right: 18px;
  bottom: 14px;
  z-index: 15;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.96);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  border: 1px solid rgba(11, 20, 26, 0.12);
  box-shadow: 0 4px 12px rgba(11, 20, 26, 0.15), 0 1px 3px rgba(11, 20, 26, 0.08);
  color: #54656f;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  padding: 0;
  transition: transform 0.15s ease, background-color 0.15s ease, color 0.15s ease, box-shadow 0.15s ease;
}

.chat-scroll-bottom-btn:hover {
  background: #f0fdf4;
  color: #008069;
  transform: translateY(-2px);
  box-shadow: 0 6px 16px rgba(0, 128, 105, 0.22), 0 2px 6px rgba(11, 20, 26, 0.1);
}

.chat-scroll-bottom-btn:active {
  transform: translateY(0);
}

.chat-scroll-bottom-badge {
  position: absolute;
  top: -4px;
  right: -4px;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 9px;
  background: #008069;
  color: #ffffff;
  font-size: 10.5px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
}

.fab-fade-enter-active,
.fab-fade-leave-active {
  transition: opacity 0.2s cubic-bezier(0.16, 1, 0.3, 1), transform 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}

.fab-fade-enter-from,
.fab-fade-leave-to {
  opacity: 0;
  transform: scale(0.7) translateY(8px);
}

.chat-messages {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 20px 24px;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
  touch-action: pan-y;
}

.chat-messages::-webkit-scrollbar { width: 6px; }
.chat-messages::-webkit-scrollbar-thumb { background: rgba(0, 0, 0, 0.15); border-radius: 3px; }

.load-more-btn {
  display: block;
  margin: 0 auto 16px;
  padding: 6px 16px;
  border: 1px solid #e8ecf0;
  border-radius: 16px;
  background: #fff;
  color: #54656f;
  font-size: 12px;
  cursor: pointer;
  transition: background 150ms, border-color 150ms;
}

.load-more-btn:hover {
  background: #f5f7fa;
  border-color: #d1d5db;
}

.messages-hint {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 64px 24px;
  color: #8696a0;
  font-size: 14px;
}

.unread-messages-divider {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  margin: 14px 0 10px;
  padding: 0 8px;
  user-select: none;
}

.chat-floating-date {
  position: absolute;
  top: 14px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 25;
  pointer-events: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 4px 14px;
  border-radius: 14px;
  background: rgba(15, 23, 42, 0.65);
  color: #ffffff;
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0.2px;
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.18), 0 1px 3px rgba(0, 0, 0, 0.1);
  user-select: none;
}

.floating-date-fade-enter-active,
.floating-date-fade-leave-active {
  transition: opacity 0.25s ease, transform 0.25s ease;
}

.floating-date-fade-enter-from,
.floating-date-fade-leave-to {
  opacity: 0;
  transform: translate(-50%, -6px);
}

.chat-date-divider {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  margin: 16px 0 12px;
  user-select: none;
}

.chat-date-divider__badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 3px 14px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.75);
  color: #54656f;
  font-size: 12px;
  font-weight: 500;
  box-shadow: 0 1px 3px rgba(11, 20, 26, 0.08);
  border: 1px solid rgba(11, 20, 26, 0.06);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}

.unread-messages-divider__line {
  flex: 1;
  height: 1px;
  background: rgba(0, 128, 105, 0.22);
}

.unread-messages-divider__badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 3px 14px;
  border-radius: 12px;
  background: #e8f5e9;
  border: 1px solid rgba(0, 128, 105, 0.2);
  box-shadow: 0 1px 2px rgba(0, 128, 105, 0.06);
}

.unread-messages-divider__text {
  font-size: 12px;
  font-weight: 600;
  color: #008069;
  letter-spacing: 0.3px;
}

.chat-messages--multi-select {
  user-select: none;
}

.drag-selection-box {
  position: absolute;
  border: 1.5px dashed #008069;
  background: rgba(0, 128, 105, 0.14);
  pointer-events: none;
  z-index: 20;
  border-radius: 4px;
}

.message-row {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  margin-bottom: 12px;
  width: 100%;
  justify-content: flex-start;
  transition: background-color 0.15s ease;
}

.message-row--multi-select {
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 8px;
}

.message-row--multi-select:hover {
  background: rgba(0, 0, 0, 0.025);
}

.message-row--selected {
  background: rgba(0, 128, 105, 0.09) !important;
}

.message-select-checkbox {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 2px solid #cbd5e1;
  background: #ffffff;
  color: #ffffff;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  margin-right: 8px;
  align-self: center;
  cursor: pointer;
  transition: all 0.16s cubic-bezier(0.16, 1, 0.3, 1);
  user-select: none;
}

.message-select-checkbox:hover {
  border-color: #008069;
}

.message-select-checkbox--checked {
  background: #008069;
  border-color: #008069;
  box-shadow: 0 2px 6px rgba(0, 128, 105, 0.3);
  transform: scale(1.05);
}

.checkbox-pop-enter-active,
.checkbox-pop-leave-active {
  transition: all 0.18s cubic-bezier(0.16, 1, 0.3, 1);
}

.checkbox-pop-enter-from,
.checkbox-pop-leave-to {
  opacity: 0;
  transform: scale(0.5) translateX(-8px);
}

.batch-action-bar {
  position: absolute;
  bottom: 14px;
  left: 18px;
  right: 18px;
  z-index: 90;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 18px;
  background: rgba(255, 255, 255, 0.96);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid rgba(11, 20, 26, 0.12);
  border-radius: 14px;
  box-shadow: 0 10px 30px rgba(11, 20, 26, 0.16), 0 2px 8px rgba(11, 20, 26, 0.08);
}

.batch-action-bar__left,
.batch-action-bar__right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.batch-action-count {
  font-size: 13.5px;
  color: #111b21;
  user-select: none;
}

.batch-action-count strong {
  color: #008069;
  font-weight: 700;
}

.batch-action-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 34px;
  padding: 0 14px;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  background: #ffffff;
  color: #374151;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease;
  user-select: none;
}

.batch-action-btn:hover:not(:disabled) {
  background: #f3f4f6;
  border-color: #9ca3af;
}

.batch-action-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.batch-action-btn--toggle {
  border-color: #008069;
  color: #008069;
  background: #f0fdf4;
}

.batch-action-btn--toggle:hover:not(:disabled) {
  background: #dcfce7;
}

.batch-action-btn--danger {
  background: #fee2e2;
  border-color: #fca5a5;
  color: #dc2626;
  font-weight: 600;
}

.batch-action-btn--danger:hover:not(:disabled) {
  background: #fecaca;
  border-color: #f87171;
  color: #b91c1c;
}

.batch-action-btn--cancel {
  color: #64748b;
}

.batch-bar-slide-enter-active,
.batch-bar-slide-leave-active {
  transition: opacity 0.22s cubic-bezier(0.16, 1, 0.3, 1), transform 0.22s cubic-bezier(0.16, 1, 0.3, 1);
}

.batch-bar-slide-enter-from,
.batch-bar-slide-leave-to {
  opacity: 0;
  transform: translateY(18px);
}

.message-row--own {
  justify-content: flex-end;
}

.message-avatar {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  box-shadow: none;
  flex-shrink: 0;
}

.message-avatar--own {
  order: 2;
  margin-left: 0;
}

.message-avatar-wrap {
  position: relative;
  width: 34px;
  height: 34px;
  flex-shrink: 0;
}

.message-avatar-wrap--own {
  order: 2;
  margin-left: 0;
}

.message-avatar-badge {
  position: absolute;
  top: -3px;
  right: -3px;
  width: 15px;
  height: 15px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  border: 1.5px solid var(--chat-window-bg, #efeae2);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
  z-index: 2;
  pointer-events: none;
}

.message-avatar-badge--owner {
  background: linear-gradient(135deg, #f59e0b, #d97706);
}

.message-avatar-badge--admin {
  background: linear-gradient(135deg, #0284c7, #0369a1);
}

.message-role-tag {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 0 5px;
  height: 17px;
  line-height: 17px;
  font-size: 10.5px;
  font-weight: 600;
  border-radius: 4px;
  white-space: nowrap;
  vertical-align: middle;
  user-select: none;
}

.message-role-tag__icon {
  flex-shrink: 0;
}

.message-role-tag--owner {
  background: #fef3c7;
  color: #92400e;
  border: 1px solid #fde68a;
}

.message-role-tag--admin {
  background: #e0f2fe;
  color: #0369a1;
  border: 1px solid #bae6fd;
}

html[data-theme="dark"] .message-role-tag--owner {
  background: rgba(180, 83, 9, 0.28);
  color: #fde68a;
  border-color: rgba(245, 158, 11, 0.4);
}

html[data-theme="dark"] .message-role-tag--admin {
  background: rgba(3, 105, 161, 0.28);
  color: #7dd3fc;
  border-color: rgba(2, 132, 199, 0.4);
}

html[data-theme="dark"] .message-avatar-badge {
  border-color: var(--chat-window-bg, #111b21);
}

.message-avatar :deep(.ui-avatar__presence) {
  width: 9px;
  height: 9px;
  bottom: -1px;
  right: -1px;
  border-width: 1.5px;
}

.message-bubble {
  max-width: 65%;
  padding: 6px 10px 7px;
  border-radius: 8px;
  background: var(--sender-bubble-bg, #ffffff);
  border: 1px solid var(--sender-bubble-border, rgba(11, 20, 26, 0.08));
  position: relative;
  word-break: break-word;
  box-shadow: 0 1px 0.5px rgba(11,20,26,.13);
  transition: background 0.15s ease, border-color 0.15s ease;
}

.message-row--highlighted {
  position: relative;
  z-index: 10;
}

.message-row--highlighted .message-bubble {
  animation: messagePulseFlash 1.6s cubic-bezier(0.25, 1, 0.5, 1) forwards;
}

@keyframes messagePulseFlash {
  0% {
    background: #fef08a;
    transform: scale(1.025);
    box-shadow: 0 0 0 4px rgba(234, 179, 8, 0.45), 0 6px 16px rgba(0, 0, 0, 0.12);
  }
  30% {
    background: #fef08a;
    transform: scale(1.02);
    box-shadow: 0 0 0 3px rgba(234, 179, 8, 0.35), 0 4px 12px rgba(0, 0, 0, 0.09);
  }
  70% {
    background: #fefce8;
    transform: scale(1.005);
    box-shadow: 0 0 0 1.5px rgba(234, 179, 8, 0.2), 0 2px 6px rgba(0, 0, 0, 0.05);
  }
  100% {
    transform: scale(1);
  }
}

.message-row--moderatable .message-bubble {
  touch-action: pan-y;
  -webkit-touch-callout: none;
}

.message-bubble--with-attachment,
.message-bubble--with-card {
  padding-bottom: 22px;
}

.message-row--recalled {
  justify-content: center;
}

.message-recalled-row {
  display: flex;
  justify-content: center;
  width: 100%;
  margin: 4px 0;
}

.message-recalled-tip {
  display: inline-block;
  padding: 3px 12px;
  background: rgba(11, 20, 26, 0.05);
  border-radius: 10px;
  font-size: 12px;
  color: #667781;
  text-align: center;
  user-select: none;
}

.message-row--own .message-bubble {
  background: #d9fdd3;
  border-color: rgba(45, 156, 151, 0.22);
}

.message-row--mentioned .message-bubble {
  border-left: 3.5px solid #f59e0b;
  background: #fffdf5;
  box-shadow: 0 1px 4px rgba(245, 158, 11, 0.18);
}

.message-sender-name {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 4px 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--sender-name-color, #008069);
  margin-bottom: 4px;
}

.message-row--own .message-sender-name {
  color: #0f766e;
}

.message-sender-title {
  font-weight: 600;
}

.message-sender-username {
  font-size: 11px;
  font-weight: normal;
  color: #64748b;
  opacity: 0.85;
}

.message-row--own .message-sender-username {
  color: #065f46;
  opacity: 0.75;
}

.message-time {
  position: absolute;
  right: 8px;
  bottom: 6px;
  font-size: clamp(10px, calc(var(--chat-font-size, 15px) * 0.74), 13px);
  line-height: 1;
  color: #667781;
  white-space: nowrap;
  user-select: none;
  display: inline-flex;
  align-items: center;
  gap: 3px;
}

.message-read-receipt {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
  margin-left: 2px;
}

.receipt-icon--read {
  color: #0284c7;
}

.receipt-icon--sent {
  color: #8696a0;
  opacity: 0.85;
}

.receipt-icon--pending {
  color: #8696a0;
  animation: pendingSpin 2s linear infinite;
}

@keyframes pendingSpin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.receipt-icon-btn--failed {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: none;
  background: transparent;
  cursor: pointer;
  line-height: 1;
}

.message-bubble p {
  margin: 0;
  font-size: var(--chat-font-size, 15px);
  line-height: var(--chat-line-height, 1.45);
  color: #111b21;
  white-space: pre-wrap;
  word-break: break-word;
}

/* 短消息在末行预留时间戳宽度，避免气泡收缩后正文与右下角时间重叠。 */
.message-bubble:not(.message-bubble--with-attachment) p:last-child::after,
.message-bubble:not(.message-bubble--with-attachment) .markdown-body > p:last-child::after,
.message-bubble:not(.message-bubble--with-attachment) .markdown-body::after {
  content: '';
  display: inline-block;
  width: 3.5em;
  height: 0;
}

/* 本人发送的消息增加已读未读勾选标记宽度 */
.message-row--own .message-bubble:not(.message-bubble--with-attachment) p:last-child::after,
.message-row--own .message-bubble:not(.message-bubble--with-attachment) .markdown-body > p:last-child::after,
.message-row--own .message-bubble:not(.message-bubble--with-attachment) .markdown-body::after {
  width: 4.8em;
}

/* 已编辑消息（含“已编辑 · ”字样）精准预留宽度，保持 1 个字符自然间距 */
.message-bubble--edited:not(.message-bubble--with-attachment) p:last-child::after,
.message-bubble--edited:not(.message-bubble--with-attachment) .markdown-body > p:last-child::after,
.message-bubble--edited:not(.message-bubble--with-attachment) .markdown-body::after {
  width: 5.5em;
}

.message-row--own .message-bubble--edited:not(.message-bubble--with-attachment) p:last-child::after,
.message-row--own .message-bubble--edited:not(.message-bubble--with-attachment) .markdown-body > p:last-child::after,
.message-row--own .message-bubble--edited:not(.message-bubble--with-attachment) .markdown-body::after {
  width: 6.6em;
}

/* 端到端加密未编辑消息预留宽度 */
.message-bubble--e2ee:not(.message-bubble--edited):not(.message-bubble--with-attachment) p:last-child::after,
.message-bubble--e2ee:not(.message-bubble--edited):not(.message-bubble--with-attachment) .markdown-body > p:last-child::after,
.message-bubble--e2ee:not(.message-bubble--edited):not(.message-bubble--with-attachment) .markdown-body::after {
  width: 4.2em;
}

.message-row--own .message-bubble--e2ee:not(.message-bubble--edited):not(.message-bubble--with-attachment) p:last-child::after,
.message-row--own .message-bubble--e2ee:not(.message-bubble--edited):not(.message-bubble--with-attachment) .markdown-body > p:last-child::after,
.message-row--own .message-bubble--e2ee:not(.message-bubble--edited):not(.message-bubble--with-attachment) .markdown-body::after {
  width: 5.0em;
}

/* 端到端加密 + 已编辑消息精准预留宽度 */
.message-bubble--e2ee.message-bubble--edited:not(.message-bubble--with-attachment) p:last-child::after,
.message-bubble--e2ee.message-bubble--edited:not(.message-bubble--with-attachment) .markdown-body > p:last-child::after,
.message-bubble--e2ee.message-bubble--edited:not(.message-bubble--with-attachment) .markdown-body::after {
  width: 6.2em;
}

.message-row--own .message-bubble--e2ee.message-bubble--edited:not(.message-bubble--with-attachment) p:last-child::after,
.message-row--own .message-bubble--e2ee.message-bubble--edited:not(.message-bubble--with-attachment) .markdown-body > p:last-child::after,
.message-row--own .message-bubble--e2ee.message-bubble--edited:not(.message-bubble--with-attachment) .markdown-body::after {
  width: 7.2em;
}

.message-edited-tag {
  font-size: 10px;
  opacity: 0.75;
  margin-right: 1px;
}

.chat-header__subtitle--typing {
  color: #008069 !important;
  font-weight: 500;
}

.typing-dots-inline {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  margin-right: 4px;
}

.typing-dots {
  display: inline-flex;
  align-items: center;
  gap: 3px;
}

.typing-dot {
  width: 4.5px;
  height: 4.5px;
  border-radius: 50%;
  background-color: #008069;
  animation: typingBounce 1.4s infinite ease-in-out both;
}

.typing-dots .typing-dot:nth-child(1),
.typing-dots-inline .typing-dot:nth-child(1) {
  animation-delay: -0.32s;
}

.typing-dots .typing-dot:nth-child(2),
.typing-dots-inline .typing-dot:nth-child(2) {
  animation-delay: -0.16s;
}

@keyframes typingBounce {
  0%, 80%, 100% {
    transform: scale(0.6);
    opacity: 0.4;
  }
  40% {
    transform: scale(1.15);
    opacity: 1;
  }
}

.chat-typing-indicator {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  margin: 4px 0 8px 12px;
  background: rgba(255, 255, 255, 0.9);
  backdrop-filter: blur(8px);
  border-radius: 12px;
  box-shadow: 0 1px 2px rgba(11, 20, 26, 0.08);
  font-size: 12.5px;
  color: #54656f;
  width: fit-content;
}

.chat-typing-indicator .typing-dot {
  background-color: #54656f;
}

.chat-composer {
  margin-top: auto;
  margin-bottom: 0;
  padding: 10px 16px;
  background: #f0f2f5;
  border-top: 1px solid #e9edef;
  position: relative;
  z-index: 2;
  margin-left: 0;
  margin-right: 0;
  border-radius: 0;
}

.composer-reply-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 12px;
  margin-bottom: 8px;
  background: #f0fdf4;
  border-left: 3.5px solid #008069;
  border-radius: 6px;
  font-size: 13px;
  color: #008069;
}

.composer-reply-bar__lead {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-weight: 600;
  white-space: nowrap;
  flex-shrink: 0;
}

.composer-reply-bar__preview {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: #54656f;
}

.composer-reply-bar__cancel {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: #54656f;
  cursor: pointer;
  padding: 0;
  flex-shrink: 0;
  transition: background 150ms, color 150ms;
}

.composer-reply-bar__cancel:hover {
  background: rgba(0, 0, 0, 0.08);
  color: #111b21;
}

.composer-editing-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 12px;
  margin-bottom: 8px;
  background: #e0f2fe;
  border-left: 3px solid #0284c7;
  border-radius: 6px;
  font-size: 13px;
  color: #0369a1;
}

.composer-editing-bar__lead {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-weight: 600;
  white-space: nowrap;
  flex-shrink: 0;
}

.composer-editing-bar__preview {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #334155;
}

.composer-editing-bar__cancel {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: #64748b;
  cursor: pointer;
  flex-shrink: 0;
}

.composer-editing-bar__cancel:hover {
  background: rgba(0, 0, 0, 0.08);
  color: #0f172a;
}

.composer-attachment {
  min-width: 0;
  margin-bottom: 10px;
}

.composer-muted-bar {
  font-size: 12.5px;
  color: #64748b;
  background: #f1f5f9;
  padding: 6px 12px;
  border-radius: 6px;
  margin-bottom: 8px;
  text-align: center;
}

.composer-error {
  margin-bottom: 8px;
  font-size: 12px;
  color: #dc2626;
  text-align: center;
}

.composer-row {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.composer-file-input {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
  opacity: 0;
  pointer-events: none;
}

.composer-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: #54656f;
  cursor: pointer;
  flex-shrink: 0;
  transition: background 150ms, color 150ms;
  touch-action: manipulation;
}

.composer-btn:hover:not(:disabled) {
  background: rgba(0, 0, 0, 0.05);
  color: #111b21;
}

.composer-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.composer-btn--active {
  background: rgba(0, 128, 105, 0.12) !important;
  color: #008069 !important;
}

.composer-formatting-bar-row {
  margin-bottom: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.composer-voice-effects-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  padding: 4px 6px;
  background: rgba(0, 0, 0, 0.03);
  border-radius: 8px;
  overflow-x: auto;
}

.voice-effects-label {
  font-size: 12px;
  font-weight: 600;
  color: #54656f;
  white-space: nowrap;
  padding-left: 4px;
}

.voice-effects-list {
  display: flex;
  align-items: center;
  gap: 6px;
}

.voice-effect-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border-radius: 14px;
  border: 1px solid #d1d5db;
  background: #ffffff;
  color: #374151;
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.15s ease;
  user-select: none;
}

.voice-effect-pill:hover {
  background: #f3f4f6;
  border-color: #9ca3af;
}

.voice-effect-pill--active {
  background: #dcfce7 !important;
  border-color: #22c55e !important;
  color: #15803d !important;
  font-weight: 600;
  box-shadow: 0 1px 3px rgba(34, 197, 94, 0.2);
}

.voice-effect-icon {
  font-size: 13px;
  line-height: 1;
}

.composer-popover-anchor {
  position: relative;
  display: flex;
  align-items: center;
}

.composer-popover {
  position: absolute;
  bottom: calc(100% + 10px);
  left: 0;
  z-index: 120;
}

.composer-popover--emoji {
  left: -20px;
}

.composer-popover--quick {
  left: -40px;
}

.composer-icon-emoji {
  font-size: 19px;
  line-height: 1;
}

.composer-icon-fmt {
  font-size: 16px;
  font-weight: 800;
  font-family: serif;
  line-height: 1;
  color: #475569;
}

.composer-icon-quick {
  font-size: 17px;
  line-height: 1;
}

.popover-fade-enter-active,
.popover-fade-leave-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}

.popover-fade-enter-from,
.popover-fade-leave-to {
  opacity: 0;
  transform: translateY(6px);
}

.fmt-fade-enter-active,
.fmt-fade-leave-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}

.fmt-fade-enter-from,
.fmt-fade-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

.composer-input {
  flex: 1;
  min-width: 0;
}

.voice-record-btn {
  flex: 1;
  min-width: 0;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  background: #ffffff;
  border: 1px solid #d8dee2;
  border-radius: 8px;
  color: #111b21;
  font-size: 14.5px;
  font-weight: 600;
  cursor: pointer;
  user-select: none;
  touch-action: none;
  transition: all 0.15s ease;
}

.voice-record-btn:hover:not(:disabled) {
  background: #f8fafc;
  border-color: #cbd5e1;
}

.voice-record-btn--recording {
  background: #d9fdd3 !important;
  border-color: #86efac !important;
  color: #008069 !important;
  transform: scale(0.99);
  box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.06);
}

.voice-record-btn--canceling {
  background: #fee2e2 !important;
  border-color: #fca5a5 !important;
  color: #dc2626 !important;
}

.voice-recording-overlay {
  position: fixed;
  inset: 0;
  z-index: 99999;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}

.voice-recording-hud {
  width: 160px;
  height: 160px;
  border-radius: 20px;
  background: rgba(17, 24, 39, 0.85);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  color: #ffffff;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.35);
  animation: hudPop 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  user-select: none;
}

.voice-recording-hud--canceling {
  background: rgba(220, 38, 38, 0.9) !important;
}

.voice-recording-hud--short {
  background: rgba(17, 24, 39, 0.9) !important;
}

@keyframes hudPop {
  0% { transform: scale(0.85); opacity: 0; }
  100% { transform: scale(1); opacity: 1; }
}

.voice-hud-waves-box {
  display: flex;
  align-items: center;
  gap: 8px;
}

.voice-hud-mic {
  color: #25d366;
  animation: micPulse 1.2s infinite ease-in-out;
}

@keyframes micPulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.1); }
}

.voice-hud-bars {
  display: flex;
  align-items: center;
  gap: 3px;
  height: 24px;
}

.vbar {
  width: 3.5px;
  border-radius: 2px;
  background: #25d366;
}

.vbar-1 { height: 8px; animation: vbarAnim 0.7s infinite alternate ease-in-out; }
.vbar-2 { height: 16px; animation: vbarAnim 0.7s infinite 0.15s alternate ease-in-out; }
.vbar-3 { height: 24px; animation: vbarAnim 0.7s infinite 0.3s alternate ease-in-out; }
.vbar-4 { height: 14px; animation: vbarAnim 0.7s infinite 0.2s alternate ease-in-out; }
.vbar-5 { height: 8px; animation: vbarAnim 0.7s infinite 0.1s alternate ease-in-out; }

@keyframes vbarAnim {
  0% { height: 4px; opacity: 0.4; }
  100% { height: 24px; opacity: 1; }
}

.voice-hud-effect-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 10px;
  background: rgba(34, 197, 94, 0.25);
  color: #86efac;
  font-size: 11.5px;
  font-weight: 600;
  letter-spacing: 0.3px;
}

.voice-hud-duration {
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.5px;
}

.voice-hud-text {
  font-size: 12.5px;
  color: rgba(255, 255, 255, 0.85);
}

.voice-hud-text--cancel {
  color: #ffffff;
  font-weight: 600;
}

.voice-hud-icon--warning {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: #f59e0b;
  color: #ffffff;
  font-size: 26px;
  font-weight: 800;
  display: flex;
  align-items: center;
  justify-content: center;
}

.voice-hud-icon--cancel {
  color: #ffffff;
  animation: cancelShake 0.4s ease-in-out infinite alternate;
}

@keyframes cancelShake {
  0% { transform: translateY(0); }
  100% { transform: translateY(-4px); }
}

.hud-fade-enter-active,
.hud-fade-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.hud-fade-enter-from,
.hud-fade-leave-to {
  opacity: 0;
  transform: scale(0.9);
}

:deep(.composer-input.ui-textarea) {
  width: 100%;
  min-width: 0;
  border: none;
  background: #ffffff;
  box-shadow: none;
  min-height: 40px;
  border-radius: 8px;
  padding: 10px 16px;
  color: #111b21;
  font-size: 16px;
  line-height: 20px;
  resize: none;
}

:deep(.composer-input.ui-textarea:focus) {
  border-color: transparent;
  box-shadow: none;
}

:deep(.composer-input.ui-textarea::placeholder) {
  color: #8696a0;
  text-overflow: ellipsis;
  white-space: nowrap;
  overflow: hidden;
}

.composer-send {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border: none;
  border-radius: 50%;
  background: transparent;
  cursor: pointer;
  flex-shrink: 0;
  transition: background 150ms;
  touch-action: manipulation;
}

.composer-send:hover:not(:disabled) {
  background: rgba(0, 0, 0, 0.05);
}

.composer-send:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.chat-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.empty-content {
  display: flex;
  align-items: center;
  justify-content: center;
}

.empty-brand {
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0.3;
  user-select: none;
}

.empty-title {
  font-size: 28px;
  font-weight: 400;
  font-family: 'Georgia', 'Times New Roman', serif;
  font-style: italic;
  letter-spacing: 0.02em;
  color: #111b21;
}

.room-management-layer {
  width: 340px;
  flex-shrink: 0;
  height: 100%;
}

.room-management-sidebar {
  width: 100%;
  height: 100%;
  overflow-y: auto;
  background: #f7f9fa;
  border-left: 1px solid #e9edef;
  touch-action: pan-y;
}

@media (max-width: 1280px) {
  .left-sidebar {
    width: clamp(260px, 24vw, 310px);
  }

  .chat-header__button {
    width: 36px;
    height: 36px;
    min-height: 36px;
    padding: 0;
    border-radius: 8px;
  }

  .chat-header__button span {
    display: none;
  }

  .room-management-layer {
    position: fixed;
    inset: 0;
    z-index: 40;
    display: flex;
    justify-content: flex-end;
    width: auto;
    height: auto;
    padding-left: 48px;
    background: rgba(11, 20, 26, 0.35);
  }

  .room-management-sidebar {
    width: min(360px, 100%);
    height: 100%;
    box-shadow: -12px 0 30px rgba(11, 20, 26, 0.16);
  }
}

@media (max-width: 960px) {
  .chat-layout {
    min-height: 0;
    background: #ffffff;
  }

  .right-sidebar {
    display: none;
  }

  .left-sidebar {
    width: 100%;
    max-width: none;
    border-right: 0;
  }

  .chat-main {
    width: 100%;
    flex: 0 0 100%;
  }

  .chat-layout--mobile-list .chat-main,
  .chat-layout--mobile-chat .left-sidebar {
    display: none;
  }

  .sidebar-header {
    min-height: 64px;
    gap: 8px;
    padding:
      max(8px, env(safe-area-inset-top))
      max(12px, env(safe-area-inset-right))
      8px
      max(8px, env(safe-area-inset-left));
  }

  .mobile-menu-action {
    display: flex;
    flex: 0 0 44px;
    width: 44px;
    height: 44px;
  }

  .brand-title {
    flex: 1;
    min-width: 0;
    font-size: 21px;
  }

  .header-action {
    flex-basis: 44px;
    width: 44px;
    height: 44px;
  }

  .sidebar-header-actions {
    gap: 0;
  }

  .sidebar-list {
    padding-bottom: max(8px, env(safe-area-inset-bottom));
    overscroll-behavior: contain;
  }

  .sidebar-item {
    width: 100%;
    min-height: 68px;
    margin: 0;
    padding: 11px max(16px, env(safe-area-inset-right)) 11px max(16px, env(safe-area-inset-left));
    border-radius: 0;
  }

  .sidebar-item + .sidebar-item {
    border-top: 1px solid #f0f2f5;
  }

  .chat-header {
    min-height: 64px;
    gap: 8px;
    padding:
      max(8px, env(safe-area-inset-top))
      max(8px, env(safe-area-inset-right))
      8px
      max(4px, env(safe-area-inset-left));
  }

  .chat-header__back {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 44px;
    width: 44px;
    height: 44px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: transparent;
    color: var(--text-primary, #111b21);
    touch-action: manipulation;
  }

  .chat-header__back:active {
    background: var(--hover-bg, rgba(0, 0, 0, 0.08));
  }

  .chat-header__avatar {
    flex: 0 0 36px;
  }

  .chat-header__identity h2 {
    font-size: 15px;
  }

  .chat-header__button {
    width: 44px;
    height: 44px;
    min-height: 44px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: transparent;
  }

  .chat-header__button span {
    display: none;
  }

  .chat-header__status {
    width: 7px;
    height: 7px;
  }

  .chat-header__actions {
    gap: 0;
  }

  .chat-messages {
    padding: 14px max(10px, env(safe-area-inset-right)) 18px max(10px, env(safe-area-inset-left));
    scrollbar-gutter: auto;
  }

  .message-row {
    margin-bottom: 8px;
  }

  .message-bubble {
    max-width: 88%;
  }

  .chat-composer {
    padding:
      8px
      max(8px, env(safe-area-inset-right))
      max(8px, env(safe-area-inset-bottom))
      max(8px, env(safe-area-inset-left));
  }

  .composer-row {
    gap: 4px;
  }

  .composer-btn,
  .composer-send {
    width: 44px;
    height: 44px;
  }

  .composer-btn--screenshot {
    display: none;
  }

  :deep(.composer-input.ui-textarea) {
    min-height: 44px;
    padding: 11px 12px;
    font-size: 16px;
    line-height: 22px;
  }

  .room-management-layer {
    position: fixed;
    inset: 0;
    z-index: 40;
    display: flex;
    justify-content: flex-end;
    width: auto;
    height: auto;
    padding-left: 48px;
    background: rgba(11, 20, 26, 0.35);
  }

  .room-management-sidebar {
    width: min(360px, 100%);
    height: 100%;
    padding-top: env(safe-area-inset-top);
    padding-bottom: env(safe-area-inset-bottom);
    box-shadow: -12px 0 30px rgba(11, 20, 26, 0.16);
  }
}

@media (max-width: 400px) {
  .chat-header__avatar,
  .chat-header__status {
    display: none;
  }

  .chat-header {
    gap: 4px;
  }

  .message-bubble {
    max-width: 92%;
  }

  .composer-popover-anchor--quick {
    display: none;
  }
}

.chat-header__title-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.e2ee-header-badge {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 1px 7px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  line-height: 1.4;
  letter-spacing: 0.02em;
  background: rgba(16, 185, 129, 0.12);
  color: #059669;
  border: 1px solid rgba(16, 185, 129, 0.28);
}

.e2ee-msg-tag {
  font-size: 11px;
  margin-right: 3px;
  opacity: 0.85;
}

@media (prefers-reduced-motion: reduce) {
  .header-action,
  .sidebar-item,
  .chat-header__button,
  .composer-btn,
  .composer-send {
    transition: none;
  }
}
</style>
