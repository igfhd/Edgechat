<script setup>
import { computed } from 'vue';

const props = defineProps({
  reactions: {
    type: Array,
    default: () => []
  },
  messageId: {
    type: [Number, String],
    required: true
  }
});

const emit = defineEmits(['toggle-reaction']);

const activeReactions = computed(() => {
  if (!Array.isArray(props.reactions)) return [];
  return props.reactions.filter(r => r && r.count > 0);
});

const formatTooltip = (item) => {
  if (!item.userNames || item.userNames.length === 0) return '';
  const names = item.userNames.slice(0, 5).join('、');
  if (item.userNames.length > 5) {
    return `${names} 等 ${item.userNames.length} 人`;
  }
  return names;
};
</script>

<template>
  <div v-if="activeReactions.length > 0" class="message-reactions-row">
    <button
      v-for="item in activeReactions"
      :key="item.reaction"
      type="button"
      class="reaction-badge"
      :class="{ 'is-reacted': item.reactedByMe }"
      :title="formatTooltip(item)"
      @click.stop="emit('toggle-reaction', item.reaction)"
    >
      <span class="reaction-emoji">{{ item.reaction }}</span>
      <span class="reaction-count">{{ item.count }}</span>
    </button>
  </div>
</template>

<style scoped>
.message-reactions-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  margin-top: 4px;
  user-select: none;
}

.reaction-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 7px;
  background: var(--surface-1, #f1f5f9);
  border: 1px solid var(--border, #cbd5e1);
  border-radius: 12px;
  font-size: 0.76rem;
  color: var(--text, #334155);
  cursor: pointer;
  transition: all 0.15s ease;
  line-height: 1.2;
}

.reaction-badge:hover {
  background: var(--surface-2, #e2e8f0);
  border-color: #008069;
  transform: scale(1.05);
}

.reaction-badge.is-reacted {
  background: rgba(0, 128, 105, 0.12);
  border-color: #008069;
  color: #008069;
  font-weight: 600;
}

.reaction-emoji {
  font-size: 0.9rem;
}

.reaction-count {
  font-size: 0.72rem;
}
</style>
