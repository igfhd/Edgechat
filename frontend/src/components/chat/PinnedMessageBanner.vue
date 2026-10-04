<script setup>
import { computed } from 'vue';
import { Pin, X } from '@lucide/vue';

const props = defineProps({
  pinnedMessage: {
    type: Object,
    default: null
  },
  canManage: {
    type: Boolean,
    default: false
  }
});

const emit = defineEmits(['jump-to-pinned', 'unpin']);

const snippet = computed(() => {
  if (!props.pinnedMessage) return '';
  const c = props.pinnedMessage.content || '';
  if (props.pinnedMessage.attachment) {
    return c ? `${c} [附件: ${props.pinnedMessage.attachment.name || '文件'}]` : `[附件: ${props.pinnedMessage.attachment.name || '文件'}]`;
  }
  return c || '置顶消息';
});

const senderTitle = computed(() => {
  return props.pinnedMessage?.sender?.displayName || props.pinnedMessage?.sender?.username || '成员';
});
</script>

<template>
  <div v-if="pinnedMessage" class="pinned-banner" role="region" aria-label="置顶消息">
    <div class="pinned-main" @click="emit('jump-to-pinned', pinnedMessage.id)">
      <div class="pinned-icon-wrapper">
        <Pin :size="16" class="pin-icon" aria-hidden="true" />
      </div>
      <div class="pinned-content">
        <span class="pinned-title">置顶消息 (来自 {{ senderTitle }})</span>
        <span class="pinned-snippet" :title="snippet">{{ snippet }}</span>
      </div>
    </div>

    <button
      v-if="canManage"
      type="button"
      class="unpin-btn"
      title="取消置顶"
      aria-label="取消置顶"
      @click="emit('unpin')"
    >
      <X :size="16" />
    </button>
  </div>
</template>

<style scoped>
.pinned-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 16px;
  background: var(--surface-1, #f8fafc);
  border-bottom: 1px solid var(--border, #e2e8f0);
  border-left: 3px solid #008069;
  gap: 12px;
  z-index: 15;
  transition: all 0.15s ease;
}

.pinned-main {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1;
  min-width: 0;
  cursor: pointer;
}

.pinned-title {
  font-size: 0.74rem;
  font-weight: 600;
  color: #008069;
  line-height: 1.2;
}

.pinned-main:hover .pinned-title {
  color: #008069;
}

.pinned-icon-wrapper {
  color: #008069;
  display: flex;
  align-items: center;
  flex-shrink: 0;
}

.pinned-content {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-width: 0;
}

.pinned-snippet {
  font-size: 0.82rem;
  color: var(--text, #0f172a);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.3;
}

.unpin-btn {
  background: transparent;
  border: none;
  color: var(--text-secondary, #94a3b8);
  cursor: pointer;
  padding: 4px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  transition: all 0.15s ease;
}

.unpin-btn:hover {
  color: #ef4444;
  background: rgba(239, 68, 68, 0.1);
}
</style>
