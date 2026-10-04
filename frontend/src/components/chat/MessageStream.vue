<script setup>
import { computed, ref } from 'vue';
import MarkdownContent from './MarkdownContent.vue';
import MessageAttachment from './MessageAttachment.vue';
import SenderSourceBadge from './SenderSourceBadge.vue';
import UiAvatar from '../ui/Avatar.vue';
import UiButton from '../ui/Button.vue';
import UiSurface from '../ui/Surface.vue';
import { formatLocalDateTime, isPresenceOnline } from '../../date.js';
import store from '../../store.js';

const props = defineProps({
  messages: {
    type: Array,
    default: () => []
  },
  loading: {
    type: Boolean,
    default: false
  },
  error: {
    type: String,
    default: ''
  },
  emptyText: {
    type: String,
    default: '这里还没有消息。'
  },
  sessionUserId: {
    type: Number,
    default: 0
  },
  showOlder: {
    type: Boolean,
    default: false
  }
});

const emit = defineEmits(['load-older', 'jump-to-message']);
const scrollContainer = ref(null);
const session = computed(() => store.session);

function isOwnMessage(message) {
  if (!message?.sender) return false;
  return message.sender.kind !== 'external' && Number(message.sender.id) === Number(props.sessionUserId);
}

function getSenderAvatar(message) {
  if (isOwnMessage(message)) {
    return session.value?.avatarUrl || message.sender?.avatarUrl || '';
  }
  return message.sender?.avatarUrl || '';
}

function isSameSender(left, right) {
  return left && right
    && left.sender.kind === right.sender.kind
    && left.sender.source === right.sender.source
    && String(left.sender.id) === String(right.sender.id);
}

function bubbleRowClass(message, index) {
  return {
    'chat-bubble-row--own': isOwnMessage(message),
    'chat-bubble-row--stacked': isSameSender(props.messages[index - 1], message)
  };
}

function bubbleClass(message, index) {
  return {
    'chat-bubble--own': isOwnMessage(message),
    'chat-bubble--continued': isSameSender(props.messages[index - 1], message),
    'chat-bubble--tail-hidden': isSameSender(message, props.messages[index + 1]),
    'chat-bubble--colored': !isOwnMessage(message)
  };
}

/**
 * 根据发送者 ID 哈希生成独特的气泡背景/文字颜色。
 * 直接以 inline style 写入，绕过 background 的 !important 覆盖问题。
 * 亮色主题：高亮度（85%）浅色背景 + 黑色文字
 * 深色主题：低亮度（28%）深色背景 + 白色文字
 */
function senderBubbleStyle(message) {
  if (isOwnMessage(message)) return {};
  const idStr = String(message.sender?.id ?? '');
  let hash = 0;
  for (let i = 0; i < idStr.length; i++) {
    hash = idStr.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  const isDark =
    document.documentElement.dataset.theme === 'dark' ||
    document.documentElement.classList.contains('dark');
  const lightness = isDark ? 28 : 85;
  const saturation = isDark ? 35 : 50;
  return {
    background: `hsl(${hue}, ${saturation}%, ${lightness}%)`,
    color: isDark ? '#fff' : '#111'
  };
}

function formatTime(value) {
  return formatLocalDateTime(value);
}

function scrollToBottom() {
  if (scrollContainer.value) {
    scrollContainer.value.scrollTop = scrollContainer.value.scrollHeight;
  }
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

defineExpose({
  scrollToBottom
});
</script>

<template>
  <section class="message-stream">
    <div ref="scrollContainer" class="message-stream__scroll">
      <div v-if="showOlder" class="message-stream__load-older">
        <UiButton variant="secondary" size="sm" @click="emit('load-older')">加载更早消息</UiButton>
      </div>

      <UiSurface v-if="loading" tone="soft" class="empty-state">
        正在同步消息...
      </UiSurface>

      <UiSurface v-else-if="error" tone="soft" class="empty-state">
        {{ error }}
      </UiSurface>

      <UiSurface v-else-if="!messages.length" tone="soft" class="empty-state">
        {{ emptyText }}
      </UiSurface>

      <article
        v-for="(message, index) in messages"
        :id="`msg-${message.id}`"
        :key="message.id"
        class="chat-bubble-row"
        :class="bubbleRowClass(message, index)"
      >
        <UiAvatar
          v-if="!isOwnMessage(message)"
          :src="getSenderAvatar(message)"
          :fallback="message.sender.displayName"
          size="sm"
          :show-presence="isSenderPresenceApplicable(message.sender)"
          :is-online="isSenderOnline(message.sender)"
        />
        <div class="chat-bubble" :class="bubbleClass(message, index)" :style="senderBubbleStyle(message)">
          <div class="chat-bubble__meta">
            <strong>
              {{ isOwnMessage(message) ? '我' : message.sender.displayName }}
              <span v-if="message.sender?.isOwner" class="message-role-tag message-role-tag--owner" title="群主">群主</span>
              <span v-if="message.sender?.isAdmin" class="message-role-tag message-role-tag--admin" title="管理员">管理员</span>
              <SenderSourceBadge :source="message.sender.source" />
            </strong>
            <span>{{ formatTime(message.createdAt) }}</span>
          </div>
          <MarkdownContent v-if="message.content" :content="message.content" @jump-to-message="emit('jump-to-message', $event)" />
          <MessageAttachment v-if="message.attachment" :attachment="message.attachment" />
        </div>
        <UiAvatar
          v-if="isOwnMessage(message)"
          class="chat-bubble-avatar--own"
          :src="getSenderAvatar(message)"
          :fallback="session?.displayName || '我'"
          size="sm"
        />
      </article>
    </div>
  </section>
</template>

<style scoped>
.message-role-tag {
  display: inline-flex;
  align-items: center;
  margin-left: 4px;
  padding: 0 4px;
  font-size: 10px;
  font-weight: 600;
  border-radius: 4px;
  white-space: nowrap;
  vertical-align: middle;
  user-select: none;
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
:root.dark .message-role-tag--owner,
html[data-theme="dark"] .message-role-tag--owner {
  background: rgba(180, 83, 9, 0.28);
  color: #fde68a;
  border-color: rgba(245, 158, 11, 0.4);
}
:root.dark .message-role-tag--admin,
html[data-theme="dark"] .message-role-tag--admin {
  background: rgba(3, 105, 161, 0.28);
  color: #7dd3fc;
  border-color: rgba(2, 132, 199, 0.4);
}
</style>
