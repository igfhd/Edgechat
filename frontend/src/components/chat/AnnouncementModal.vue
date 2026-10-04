<script setup>
import { computed, ref, watch } from 'vue';
import { Megaphone, Pin, X, Calendar, User, ChevronRight } from '@lucide/vue';
import { formatLocalDateTime } from '../../date.js';
import { renderMarkdown } from '../../markdown.js';
import UiButton from '../ui/Button.vue';

const props = defineProps({
  show: {
    type: Boolean,
    default: false
  },
  announcements: {
    type: Array,
    default: () => []
  },
  selectedAnnouncementId: {
    type: [Number, String],
    default: null
  }
});

const emit = defineEmits(['close']);

const activeId = ref(null);

watch(
  () => props.selectedAnnouncementId,
  (val) => {
    if (val) {
      activeId.value = Number(val);
    } else if (props.announcements.length && !activeId.value) {
      activeId.value = props.announcements[0].id;
    }
  },
  { immediate: true }
);

watch(
  () => props.announcements,
  (list) => {
    if (!list.length) {
      activeId.value = null;
    } else if (!activeId.value || !list.some((a) => a.id === activeId.value)) {
      activeId.value = list[0].id;
    }
  },
  { immediate: true }
);

const currentAnnouncement = computed(() => {
  return props.announcements.find((a) => a.id === activeId.value) || props.announcements[0] || null;
});

const renderedHtml = computed(() => {
  return currentAnnouncement.value ? renderMarkdown(currentAnnouncement.value.content) : '';
});
</script>

<template>
  <Teleport to="body">
    <div v-if="show" class="announcement-modal-overlay" @click.self="emit('close')">
      <div class="announcement-modal-container">
        <header class="announcement-modal-header">
          <div class="announcement-modal-title">
            <Megaphone :size="20" class="announcement-modal-icon" />
            <h3>系统公告中心</h3>
          </div>
          <button
            type="button"
            class="announcement-modal-close"
            aria-label="关闭"
            @click="emit('close')"
          >
            <X :size="20" />
          </button>
        </header>

        <div class="announcement-modal-body">
          <!-- Left Announcement List (if > 1 announcements) -->
          <aside v-if="announcements.length > 1" class="announcement-sidebar-list">
            <button
              v-for="item in announcements"
              :key="item.id"
              type="button"
              class="announcement-list-item"
              :class="{ 'announcement-list-item--active': item.id === activeId }"
              @click="activeId = item.id"
            >
              <div class="item-title-row">
                <Pin v-if="item.isPinned" :size="13" class="item-pin-icon" />
                <span class="item-title">{{ item.title }}</span>
              </div>
              <span class="item-date">{{ formatLocalDateTime(item.createdAt) }}</span>
            </button>
          </aside>

          <!-- Right / Main Announcement Detail View -->
          <main class="announcement-detail-content">
            <template v-if="currentAnnouncement">
              <div class="detail-header">
                <div class="detail-badge-line">
                  <span v-if="currentAnnouncement.isPinned" class="detail-pinned-tag">
                    <Pin :size="12" /> 置顶公告
                  </span>
                  <span class="detail-time-tag">
                    <Calendar :size="12" />
                    {{ formatLocalDateTime(currentAnnouncement.createdAt) }}
                  </span>
                  <span class="detail-creator-tag">
                    <User :size="12" />
                    {{ currentAnnouncement.creatorName }}
                  </span>
                </div>
                <h2 class="detail-title">{{ currentAnnouncement.title }}</h2>
              </div>

              <div class="detail-body markdown-body" v-html="renderedHtml"></div>
            </template>
            <div v-else class="detail-empty">
              <p class="muted">当前暂无有效公告</p>
            </div>
          </main>
        </div>

        <footer class="announcement-modal-footer">
          <UiButton variant="primary" @click="emit('close')">
            我知道了
          </UiButton>
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.announcement-modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: rgba(11, 20, 26, 0.45);
  backdrop-filter: blur(3px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  animation: fadeIn 0.15s ease-out;
}

.announcement-modal-container {
  background: #ffffff;
  border-radius: 12px;
  box-shadow: 0 20px 48px rgba(0, 0, 0, 0.2);
  width: 100%;
  max-width: 800px;
  height: 600px;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  animation: scaleIn 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}

.announcement-modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid #e9edef;
  background: #ffffff;
}

.announcement-modal-title {
  display: flex;
  align-items: center;
  gap: 10px;
}

.announcement-modal-title h3 {
  margin: 0;
  font-size: 17px;
  color: #111b21;
}

.announcement-modal-icon {
  color: #16a34a;
}

.announcement-modal-close {
  border: none;
  background: transparent;
  color: #667781;
  cursor: pointer;
  padding: 4px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.announcement-modal-close:hover {
  background: #f0f2f5;
  color: #111b21;
}

.announcement-modal-body {
  display: flex;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.announcement-sidebar-list {
  width: 240px;
  flex-shrink: 0;
  background: #f8fafc;
  border-right: 1px solid #e2e8f0;
  overflow-y: auto;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.announcement-list-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid transparent;
  background: transparent;
  text-align: left;
  cursor: pointer;
  transition: all 0.15s ease;
}

.announcement-list-item:hover {
  background: #f1f5f9;
}

.announcement-list-item--active {
  background: #e0f2fe;
  border-color: #bae6fd;
}

.item-title-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.item-pin-icon {
  color: #0284c7;
  flex-shrink: 0;
}

.item-title {
  font-size: 13.5px;
  font-weight: 600;
  color: #1e293b;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.item-date {
  font-size: 11.5px;
  color: #64748b;
}

.announcement-detail-content {
  flex: 1;
  padding: 24px 28px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
  background: #ffffff;
}

.detail-header {
  border-bottom: 1px solid #f1f5f9;
  padding-bottom: 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.detail-badge-line {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  font-size: 12.5px;
  color: #64748b;
}

.detail-pinned-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 12px;
  background: #dcfce7;
  color: #15803d;
  font-size: 12px;
  font-weight: 600;
}

.detail-time-tag,
.detail-creator-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.detail-title {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
  color: #0f172a;
}

.detail-body {
  font-size: 15px;
  line-height: 1.65;
  color: #334155;
}

.detail-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
}

.announcement-modal-footer {
  display: flex;
  justify-content: flex-end;
  padding: 12px 20px;
  border-top: 1px solid #e9edef;
  background: #ffffff;
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes scaleIn {
  from { transform: scale(0.96); opacity: 0; }
  to { transform: scale(1); opacity: 1; }
}

@media (max-width: 640px) {
  .announcement-sidebar-list {
    width: 100%;
    border-right: none;
    border-bottom: 1px solid #e2e8f0;
    max-height: 140px;
  }

  .announcement-modal-body {
    flex-direction: column;
  }
}
</style>
