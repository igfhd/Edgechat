<script setup>
import { computed } from 'vue';
import { formatBytes } from '../../composables/useCloudDrive.js';

const props = defineProps({
  queue: {
    type: Array,
    required: true
  },
  onClose: {
    type: Function,
    required: true
  }
});

const activeCount = computed(() => props.queue.filter(t => t.status === 'uploading').length);
const successCount = computed(() => props.queue.filter(t => t.status === 'success').length);
</script>

<template>
  <div v-if="queue.length > 0" class="upload-modal-container">
    <div class="upload-modal-card">
      <div class="upload-modal-header">
        <div class="upload-header-info">
          <span class="upload-header-title">文件传输队列</span>
          <span class="upload-header-badge">
            {{ activeCount > 0 ? `正在上传 ${activeCount} 个` : `完成 ${successCount} 个` }}
          </span>
        </div>
        <button type="button" class="upload-close-btn" @click="onClose" title="收起">×</button>
      </div>

      <div class="upload-list">
        <div v-for="task in queue" :key="task.id" class="upload-item">
          <div class="upload-item-header">
            <span class="upload-item-name" :title="task.name">{{ task.name }}</span>
            <span class="upload-item-size">
              {{ task.status === 'uploading' && task.loaded ? `${formatBytes(task.loaded)} / ` : '' }}{{ formatBytes(task.size) }}
            </span>
          </div>

          <div class="upload-progress-bar-bg">
            <div
              class="upload-progress-bar-fill"
              :class="{
                'fill-success': task.status === 'success',
                'fill-error': task.status === 'error'
              }"
              :style="{ width: `${task.progress}%` }"
            ></div>
          </div>

          <div class="upload-item-status">
            <div v-if="task.status === 'uploading'" class="status-uploading-row">
              <span class="status-uploading">{{ task.progress }}% 上传中</span>
              <span v-if="task.speed" class="status-speed-badge">⚡ {{ task.speed }}</span>
            </div>
            <span v-else-if="task.status === 'success'" class="status-success">已完成 ✓</span>
            <span v-else class="status-error">{{ task.error || '上传失败' }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.upload-modal-container {
  position: fixed;
  bottom: 24px;
  right: 24px;
  width: 360px;
  max-width: calc(100vw - 48px);
  z-index: 900;
  box-shadow: 0 16px 36px rgba(0, 0, 0, 0.12);
}

.upload-modal-card {
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.upload-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  background: #f8fafc;
  border-bottom: 1px solid #e2e8f0;
}

.upload-header-title {
  font-size: 0.9rem;
  font-weight: 600;
  color: #0f172a;
}

.upload-header-badge {
  font-size: 0.75rem;
  background: rgba(0, 128, 105, 0.1);
  color: #008069;
  padding: 2px 8px;
  border-radius: 999px;
  margin-left: 8px;
  font-weight: 500;
}

.upload-close-btn {
  background: transparent;
  border: none;
  color: #64748b;
  font-size: 1.2rem;
  cursor: pointer;
  line-height: 1;
}

.upload-close-btn:hover {
  color: #0f172a;
}

.upload-list {
  max-height: 240px;
  overflow-y: auto;
  padding: 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.upload-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.upload-item-header {
  display: flex;
  justify-content: space-between;
  font-size: 0.82rem;
}

.upload-item-name {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 220px;
  color: #0f172a;
  font-weight: 500;
}

.upload-item-size {
  color: #64748b;
}

.upload-progress-bar-bg {
  width: 100%;
  height: 4px;
  background: #e2e8f0;
  border-radius: 2px;
  overflow: hidden;
}

.upload-progress-bar-fill {
  height: 100%;
  background: #008069;
  transition: width 0.2s ease;
}

.fill-success {
  background: #10b981;
}

.fill-error {
  background: #ef4444;
}

.upload-item-status {
  font-size: 0.75rem;
}

.status-uploading-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.status-uploading {
  color: #008069;
  font-weight: 500;
}

.status-speed-badge {
  color: #0284c7;
  font-weight: 600;
  font-size: 0.73rem;
}

.status-success {
  color: #10b981;
  font-weight: 500;
}

.status-error {
  color: #ef4444;
}

@media (max-width: 640px) {
  .upload-modal-container {
    bottom: 12px;
    right: 12px;
    left: 12px;
    width: auto;
    max-width: none;
  }
}
</style>
