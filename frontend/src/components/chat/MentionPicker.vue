<script setup>
import { computed, nextTick, ref, watch } from 'vue';
import UiAvatar from '../ui/Avatar.vue';
import { Users } from '@lucide/vue';

const props = defineProps({
  show: {
    type: Boolean,
    default: false
  },
  query: {
    type: String,
    default: ''
  },
  members: {
    type: Array,
    default: () => []
  },
  allowAll: {
    type: Boolean,
    default: true
  }
});

const emit = defineEmits(['select', 'close']);

const selectedIndex = ref(0);
const listEl = ref(null);

const filteredCandidates = computed(() => {
  const q = String(props.query || '').trim().toLowerCase();
  const list = [];

  // Add "@所有人" option if applicable
  if (props.allowAll) {
    if (!q || '所有人'.includes(q) || 'all'.includes(q) || 'everyone'.includes(q)) {
      list.push({
        id: 'all',
        isAll: true,
        displayName: '所有人',
        username: 'all',
        hint: '通知当前群聊所有成员',
        insertText: '@所有人 '
      });
    }
  }

  // Add matching members
  const memberList = props.members || [];
  for (const m of memberList) {
    if (!m) continue;
    const name = String(m.displayName || '').toLowerCase();
    const uname = String(m.username || '').toLowerCase();
    if (!q || name.includes(q) || uname.includes(q)) {
      list.push({
        id: m.id || m.userId,
        isAll: false,
        displayName: m.displayName || m.name || '成员',
        username: m.username || '',
        avatarUrl: m.avatarUrl || '',
        isOnline: Boolean(m.isOnline),
        insertText: `@${m.username || m.displayName} `
      });
    }
  }

  return list;
});

watch(
  () => filteredCandidates.value.length,
  () => {
    selectedIndex.value = 0;
  }
);

function selectItem(item) {
  if (!item) return;
  emit('select', item);
}

function selectNext() {
  if (!filteredCandidates.value.length) return;
  selectedIndex.value = (selectedIndex.value + 1) % filteredCandidates.value.length;
  scrollSelectedIntoView();
}

function selectPrev() {
  if (!filteredCandidates.value.length) return;
  selectedIndex.value =
    (selectedIndex.value - 1 + filteredCandidates.value.length) % filteredCandidates.value.length;
  scrollSelectedIntoView();
}

function selectCurrent() {
  if (filteredCandidates.value.length > 0 && filteredCandidates.value[selectedIndex.value]) {
    selectItem(filteredCandidates.value[selectedIndex.value]);
    return true;
  }
  return false;
}

function scrollSelectedIntoView() {
  nextTick(() => {
    if (!listEl.value) return;
    const activeEl = listEl.value.querySelector('.mention-picker__item--active');
    if (activeEl) {
      activeEl.scrollIntoView({ block: 'nearest' });
    }
  });
}

defineExpose({
  selectNext,
  selectPrev,
  selectCurrent,
  hasCandidates: computed(() => filteredCandidates.value.length > 0)
});
</script>

<template>
  <div v-if="show && filteredCandidates.length" class="mention-picker" role="listbox" aria-label="提及成员">
    <div class="mention-picker__header">
      <span>提及成员</span>
      <span class="mention-picker__shortcut-hint">↑ ↓ 导航 · ↵ 确认</span>
    </div>
    <div ref="listEl" class="mention-picker__list">
      <button
        v-for="(item, index) in filteredCandidates"
        :key="item.id"
        type="button"
        class="mention-picker__item"
        :class="{ 'mention-picker__item--active': index === selectedIndex }"
        role="option"
        :aria-selected="index === selectedIndex"
        @mousedown.prevent="selectItem(item)"
        @mouseenter="selectedIndex = index"
      >
        <!-- Icon/Avatar for All vs Member -->
        <div v-if="item.isAll" class="mention-picker__all-icon">
          <Users :size="16" aria-hidden="true" />
        </div>
        <UiAvatar
          v-else
          :src="item.avatarUrl"
          :fallback="item.displayName?.[0] || '?'"
          size="sm"
          :show-presence="true"
          :is-online="item.isOnline"
        />

        <div class="mention-picker__info">
          <div class="mention-picker__name-row">
            <strong class="mention-picker__name">{{ item.displayName }}</strong>
            <span v-if="item.username && !item.isAll" class="mention-picker__username">@{{ item.username }}</span>
          </div>
          <span v-if="item.hint" class="mention-picker__hint">{{ item.hint }}</span>
        </div>
      </button>
    </div>
  </div>
</template>

<style scoped>
.mention-picker {
  position: absolute;
  bottom: 100%;
  left: 12px;
  right: 12px;
  max-width: 320px;
  max-height: 240px;
  margin-bottom: 8px;
  background: #ffffff;
  border-radius: 12px;
  box-shadow: 0 8px 24px rgba(11, 20, 26, 0.15), 0 2px 6px rgba(11, 20, 26, 0.08);
  border: 1px solid rgba(0, 0, 0, 0.08);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  z-index: 60;
  animation: mentionPopup 0.15s cubic-bezier(0.16, 1, 0.3, 1);
}

@keyframes mentionPopup {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.mention-picker__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px 6px;
  font-size: 11.5px;
  font-weight: 600;
  color: #64748b;
  border-bottom: 1px solid #f1f5f9;
  background: #f8fafc;
}

.mention-picker__shortcut-hint {
  font-size: 10.5px;
  color: #94a3b8;
  font-weight: normal;
}

.mention-picker__list {
  flex: 1;
  overflow-y: auto;
  padding: 4px;
  overscroll-behavior: contain;
}

.mention-picker__list::-webkit-scrollbar {
  width: 4px;
}
.mention-picker__list::-webkit-scrollbar-thumb {
  background: rgba(0, 0, 0, 0.15);
  border-radius: 2px;
}

.mention-picker__item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 6px 8px;
  border: none;
  border-radius: 8px;
  background: transparent;
  text-align: left;
  cursor: pointer;
  transition: background 0.12s ease;
  touch-action: manipulation;
}

.mention-picker__item:hover,
.mention-picker__item--active {
  background: #f0fdf4;
}

.mention-picker__all-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: rgba(234, 88, 12, 0.12);
  color: #c2410c;
  flex-shrink: 0;
}

.mention-picker__info {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
  flex: 1;
}

.mention-picker__name-row {
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
}

.mention-picker__name {
  font-size: 13.5px;
  color: #1e293b;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.mention-picker__item--active .mention-picker__name {
  color: #008069;
}

.mention-picker__username {
  font-size: 11.5px;
  color: #64748b;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.mention-picker__hint {
  font-size: 11px;
  color: #94a3b8;
}
</style>
