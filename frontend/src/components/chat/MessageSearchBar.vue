<script setup>
import { ref, computed, watch, nextTick, onMounted } from 'vue';
import { ChevronUp, ChevronDown, Search, X } from '@lucide/vue';

const props = defineProps({
  messages: {
    type: Array,
    default: () => []
  },
  activeRoom: {
    type: Object,
    default: null
  }
});

const emit = defineEmits(['locate-message', 'close']);

const inputRef = ref(null);
const searchText = ref('');
const currentIndex = ref(0);

onMounted(() => {
  nextTick(() => {
    inputRef.value?.focus();
  });
});

const matchedMessages = computed(() => {
  const query = searchText.value.trim().toLowerCase();
  if (!query) return [];

  return props.messages.filter(msg => {
    if (msg.isRecalled) return false;
    const content = (msg.content || '').toLowerCase();
    const sender = (msg.sender?.displayName || '').toLowerCase();
    const username = (msg.sender?.username || '').toLowerCase();
    const attName = (msg.attachment?.name || '').toLowerCase();
    return content.includes(query) || sender.includes(query) || username.includes(query) || attName.includes(query);
  });
});

const totalMatches = computed(() => matchedMessages.value.length);

watch(searchText, () => {
  currentIndex.value = 0;
  if (matchedMessages.value.length > 0) {
    emitLocate(0);
  }
});

const emitLocate = (index) => {
  if (matchedMessages.value[index]) {
    emit('locate-message', Number(matchedMessages.value[index].id));
  }
};

const handleNext = () => {
  if (totalMatches.value === 0) return;
  currentIndex.value = (currentIndex.value + 1) % totalMatches.value;
  emitLocate(currentIndex.value);
};

const handlePrev = () => {
  if (totalMatches.value === 0) return;
  currentIndex.value = (currentIndex.value - 1 + totalMatches.value) % totalMatches.value;
  emitLocate(currentIndex.value);
};

const handleKeydown = (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    if (e.shiftKey) {
      handlePrev();
    } else {
      handleNext();
    }
  } else if (e.key === 'Escape') {
    e.preventDefault();
    emit('close');
  }
};
</script>

<template>
  <div class="message-search-bar" role="search" aria-label="搜索消息">
    <div class="search-input-wrapper">
      <Search :size="16" class="search-icon" aria-hidden="true" />
      <input
        ref="inputRef"
        v-model="searchText"
        type="text"
        placeholder="在当前会话中搜索消息 (Enter 跳转)..."
        class="search-input"
        @keydown="handleKeydown"
      />
      <button
        v-if="searchText"
        type="button"
        class="search-clear-btn"
        title="清空搜索"
        @click="searchText = ''"
      >
        <X :size="14" />
      </button>
    </div>

    <div class="search-actions">
      <span v-if="searchText" class="search-counter">
        <template v-if="totalMatches > 0">
          {{ currentIndex + 1 }} / {{ totalMatches }}
        </template>
        <template v-else>
          无结果
        </template>
      </span>

      <div class="nav-btns">
        <button
          type="button"
          class="search-nav-btn"
          :disabled="totalMatches <= 1"
          title="上一个匹配 (Shift+Enter)"
          @click="handlePrev"
        >
          <ChevronUp :size="16" />
        </button>
        <button
          type="button"
          class="search-nav-btn"
          :disabled="totalMatches <= 1"
          title="下一个匹配 (Enter)"
          @click="handleNext"
        >
          <ChevronDown :size="16" />
        </button>
      </div>

      <button
        type="button"
        class="search-close-btn"
        title="关闭搜索 (Esc)"
        @click="emit('close')"
      >
        <X :size="18" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.message-search-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 16px;
  background: var(--surface-1, #f8fafc);
  border-bottom: 1px solid var(--border, #e2e8f0);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
  gap: 12px;
  z-index: 20;
  animation: slideDown 0.15s ease-out;
}

@keyframes slideDown {
  from {
    transform: translateY(-100%);
    opacity: 0;
  }
  to {
    transform: translateY(0);
    opacity: 1;
  }
}

.search-input-wrapper {
  display: flex;
  align-items: center;
  flex: 1;
  background: var(--surface, #ffffff);
  border: 1px solid var(--border, #cbd5e1);
  border-radius: 8px;
  padding: 0 10px;
  height: 34px;
  transition: all 0.15s ease;
}

.search-input-wrapper:focus-within {
  border-color: #008069;
  box-shadow: 0 0 0 2px rgba(0, 128, 105, 0.15);
}

.search-icon {
  color: var(--text-secondary, #64748b);
  margin-right: 8px;
  flex-shrink: 0;
}

.search-input {
  flex: 1;
  border: none;
  background: transparent;
  color: var(--text, #0f172a);
  font-size: 0.88rem;
  outline: none;
  min-width: 0;
}

.search-clear-btn {
  background: transparent;
  border: none;
  color: var(--text-secondary, #94a3b8);
  cursor: pointer;
  padding: 2px;
  display: flex;
  align-items: center;
  border-radius: 50%;
}

.search-clear-btn:hover {
  color: var(--text, #0f172a);
  background: var(--surface-2, #e2e8f0);
}

.search-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.search-counter {
  font-size: 0.8rem;
  color: var(--text-secondary, #64748b);
  min-width: 50px;
  text-align: center;
  font-variant-numeric: tabular-nums;
}

.nav-btns {
  display: flex;
  align-items: center;
  gap: 2px;
}

.search-nav-btn {
  background: var(--surface, #ffffff);
  border: 1px solid var(--border, #cbd5e1);
  color: var(--text, #334155);
  border-radius: 6px;
  padding: 4px 6px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s ease;
}

.search-nav-btn:hover:not(:disabled) {
  background: var(--surface-2, #f1f5f9);
  color: #008069;
  border-color: #008069;
}

.search-nav-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.search-close-btn {
  background: transparent;
  border: none;
  color: var(--text-secondary, #64748b);
  cursor: pointer;
  padding: 4px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  transition: all 0.15s ease;
}

.search-close-btn:hover {
  color: var(--text, #0f172a);
  background: var(--surface-2, #e2e8f0);
}
</style>
