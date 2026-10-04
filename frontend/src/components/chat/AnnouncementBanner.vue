<script setup>
import { computed, ref, watch } from 'vue';
import { ChevronLeft, ChevronRight, Megaphone, X } from '@lucide/vue';

const props = defineProps({
  announcements: {
    type: Array,
    default: () => []
  }
});

const emit = defineEmits(['open-announcement', 'open-all', 'dismiss']);

const currentIndex = ref(0);

// Filter out announcements already dismissed in localStorage
const visibleAnnouncements = computed(() => {
  return props.announcements;
});

const currentAnnouncement = computed(() => {
  if (!visibleAnnouncements.value.length) return null;
  const idx = Math.min(Math.max(0, currentIndex.value), visibleAnnouncements.value.length - 1);
  return visibleAnnouncements.value[idx];
});

watch(
  () => visibleAnnouncements.value.length,
  (newLen) => {
    if (currentIndex.value >= newLen) {
      currentIndex.value = Math.max(0, newLen - 1);
    }
  }
);

function prevAnnouncement() {
  if (visibleAnnouncements.value.length <= 1) return;
  currentIndex.value = (currentIndex.value - 1 + visibleAnnouncements.value.length) % visibleAnnouncements.value.length;
}

function nextAnnouncement() {
  if (visibleAnnouncements.value.length <= 1) return;
  currentIndex.value = (currentIndex.value + 1) % visibleAnnouncements.value.length;
}

function handleDismiss(event) {
  event.stopPropagation();
  if (currentAnnouncement.value) {
    emit('dismiss', currentAnnouncement.value);
  }
}
</script>

<template>
  <div v-if="currentAnnouncement" class="announcement-banner" role="alert">
    <div class="announcement-banner__main" @click="emit('open-announcement', currentAnnouncement)">
      <div class="announcement-icon-badge">
        <Megaphone :size="16" aria-hidden="true" />
      </div>

      <div class="announcement-content">
        <div class="announcement-header-line">
          <span class="announcement-tag">系统公告</span>
          <strong class="announcement-title">{{ currentAnnouncement.title }}</strong>
        </div>
        <p class="announcement-snippet">
          {{ currentAnnouncement.content.replace(/[#*`_~>\-\n]/g, ' ').trim() }}
        </p>
      </div>
    </div>

    <div class="announcement-actions" @click.stop>
      <button
        type="button"
        class="announcement-view-btn"
        @click="emit('open-announcement', currentAnnouncement)"
      >
        查看详情
      </button>

      <div v-if="visibleAnnouncements.length > 1" class="announcement-carousel-ctrls">
        <button
          type="button"
          class="carousel-arrow-btn"
          title="上一条"
          aria-label="上一条公告"
          @click="prevAnnouncement"
        >
          <ChevronLeft :size="14" />
        </button>
        <span class="carousel-counter">{{ currentIndex + 1 }}/{{ visibleAnnouncements.length }}</span>
        <button
          type="button"
          class="carousel-arrow-btn"
          title="下一条"
          aria-label="下一条公告"
          @click="nextAnnouncement"
        >
          <ChevronRight :size="14" />
        </button>
      </div>

      <button
        type="button"
        class="announcement-dismiss-btn"
        title="关闭公告"
        aria-label="关闭当前公告"
        @click="handleDismiss"
      >
        <X :size="16" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.announcement-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 16px;
  background: linear-gradient(90deg, #f0fdf4 0%, #f7fee7 100%);
  border-bottom: 1px solid #bbf7d0;
  border-left: 4px solid #16a34a;
  gap: 12px;
  z-index: 20;
  transition: all 0.2s ease;
  user-select: none;
}

.announcement-banner__main {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1;
  min-width: 0;
  cursor: pointer;
}

.announcement-title {
  font-size: 13.5px;
  font-weight: 600;
  color: #14532d;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.announcement-banner__main:hover .announcement-title {
  color: #15803d;
  text-decoration: underline;
}

.announcement-icon-badge {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: #dcfce7;
  color: #16a34a;
  flex-shrink: 0;
}

.announcement-content {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  overflow: hidden;
}

.announcement-header-line {
  display: flex;
  align-items: center;
  gap: 8px;
}

.announcement-tag {
  display: inline-block;
  padding: 1px 6px;
  border-radius: 4px;
  background: #16a34a;
  color: #ffffff;
  font-size: 11px;
  font-weight: 600;
  line-height: 1.3;
  flex-shrink: 0;
}

.announcement-snippet {
  margin: 0;
  font-size: 12.5px;
  color: #3f6212;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  opacity: 0.9;
}

.announcement-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}

.announcement-view-btn {
  padding: 3px 10px;
  border-radius: 6px;
  border: 1px solid #86efac;
  background: #ffffff;
  color: #15803d;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
}

.announcement-view-btn:hover {
  background: #dcfce7;
  border-color: #4ade80;
}

.announcement-carousel-ctrls {
  display: flex;
  align-items: center;
  gap: 4px;
  background: rgba(255, 255, 255, 0.7);
  padding: 2px 6px;
  border-radius: 12px;
  border: 1px solid #bbf7d0;
}

.carousel-arrow-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: #15803d;
  padding: 2px;
  border-radius: 4px;
  cursor: pointer;
}

.carousel-arrow-btn:hover {
  background: #dcfce7;
}

.carousel-counter {
  font-size: 11px;
  font-weight: 600;
  color: #166534;
  padding: 0 2px;
}

.announcement-dismiss-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: #4d7c0f;
  padding: 4px;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.announcement-dismiss-btn:hover {
  background: rgba(22, 163, 74, 0.15);
  color: #14532d;
}

@media (max-width: 640px) {
  .announcement-snippet {
    display: none;
  }

  .announcement-banner {
    padding: 6px 12px;
  }
}
</style>
