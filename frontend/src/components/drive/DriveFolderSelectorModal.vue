<script setup>
import { ref, onMounted, computed } from 'vue';
import { useCloudDrive } from '../../composables/useCloudDrive.js';

const props = defineProps({
  show: {
    type: Boolean,
    default: false
  },
  title: {
    type: String,
    default: '选择转存目录'
  },
  confirmText: {
    type: String,
    default: '存入此目录'
  },
  onClose: {
    type: Function,
    required: true
  },
  onConfirm: {
    type: Function,
    required: true
  }
});

const {
  files,
  breadcrumbs,
  currentFolderId,
  isLoading,
  loadFiles,
  createFolder
} = useCloudDrive();

const showNewFolderInput = ref(false);
const newFolderName = ref('');
const isSubmitting = ref(false);

onMounted(() => {
  if (props.show) {
    loadFiles(null);
  }
});

const folders = computed(() => {
  return files.value.filter(item => item.is_folder);
});

const currentFolderName = computed(() => {
  if (!currentFolderId.value) return '根目录';
  const current = breadcrumbs.value.find(b => b.id === currentFolderId.value);
  return current ? current.name : '当前文件夹';
});

const handleNavigate = (folderId) => {
  showNewFolderInput.value = false;
  newFolderName.value = '';
  loadFiles(folderId);
};

const handleCreateFolder = async () => {
  if (!newFolderName.value.trim()) return;
  const ok = await createFolder(newFolderName.value.trim());
  if (ok) {
    newFolderName.value = '';
    showNewFolderInput.value = false;
  }
};

const handleConfirm = async () => {
  isSubmitting.value = true;
  try {
    await props.onConfirm({
      folderId: currentFolderId.value,
      folderName: currentFolderName.value
    });
    props.onClose();
  } catch (err) {
    alert(err.message || '操作失败');
  } finally {
    isSubmitting.value = false;
  }
};
</script>

<template>
  <div v-if="show" class="folder-picker-backdrop" @click.self="onClose">
    <div class="folder-picker-card">
      <div class="folder-picker-header">
        <div class="picker-title-row">
          <span class="picker-icon">📂</span>
          <h3 class="picker-title">{{ title }}</h3>
        </div>
        <button type="button" class="picker-close-btn" @click="onClose">×</button>
      </div>

      <!-- Breadcrumbs & New Folder -->
      <div class="folder-picker-nav">
        <div class="picker-breadcrumbs">
          <button type="button" class="crumb-btn" :class="{ active: !currentFolderId }" @click="handleNavigate(null)">
            根目录
          </button>
          <template v-for="bc in breadcrumbs" :key="bc.id">
            <span class="crumb-sep">/</span>
            <button type="button" class="crumb-btn" :class="{ active: bc.id === currentFolderId }" @click="handleNavigate(bc.id)">
              {{ bc.name }}
            </button>
          </template>
        </div>

        <button
          type="button"
          class="new-folder-toggle-btn"
          @click="showNewFolderInput = !showNewFolderInput"
        >
          {{ showNewFolderInput ? '取消新建' : '+ 新建文件夹' }}
        </button>
      </div>

      <!-- New Folder Input Form -->
      <div v-if="showNewFolderInput" class="new-folder-form">
        <input
          v-model="newFolderName"
          type="text"
          placeholder="请输入文件夹名称..."
          class="new-folder-input"
          @keydown.enter.prevent="handleCreateFolder"
        />
        <button
          type="button"
          class="new-folder-submit-btn"
          :disabled="!newFolderName.trim()"
          @click="handleCreateFolder"
        >
          创建
        </button>
      </div>

      <!-- Folder List -->
      <div class="folder-picker-body">
        <div v-if="isLoading" class="folder-picker-loading">
          <div class="spinner"></div>
          <span>正在读取文件夹...</span>
        </div>

        <div v-else-if="folders.length === 0" class="folder-picker-empty">
          <span class="empty-icon">📁</span>
          <span>当前目录下暂无子文件夹，可直接存入当前目录</span>
        </div>

        <div v-else class="folder-grid">
          <div
            v-for="folder in folders"
            :key="folder.id"
            class="folder-item"
            @click="handleNavigate(folder.id)"
          >
            <span class="folder-icon">📁</span>
            <div class="folder-info">
              <span class="folder-name" :title="folder.name">{{ folder.name }}</span>
              <span class="folder-hint">点击进入</span>
            </div>
            <span class="folder-arrow">›</span>
          </div>
        </div>
      </div>

      <!-- Footer -->
      <div class="folder-picker-footer">
        <div class="selected-target-hint">
          <span class="target-label">目标位置：</span>
          <span class="target-badge">📁 {{ currentFolderName }}</span>
        </div>
        <div class="picker-actions">
          <button type="button" class="picker-btn picker-btn-secondary" @click="onClose">取消</button>
          <button type="button"
            class="picker-btn picker-btn-primary"
            :disabled="isSubmitting"
            @click="handleConfirm"
          >
            {{ isSubmitting ? '正在处理...' : confirmText }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.folder-picker-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.65);
  backdrop-filter: blur(8px);
  z-index: 1300;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  animation: fadeIn 0.15s ease-out;
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

.folder-picker-card {
  background: var(--surface, #ffffff);
  border: 1px solid var(--border, #e2e8f0);
  border-radius: 16px;
  width: 100%;
  max-width: 520px;
  height: 480px;
  display: flex;
  flex-direction: column;
  box-shadow: 0 24px 56px rgba(0, 0, 0, 0.2);
  color: var(--text, #0f172a);
  overflow: hidden;
}

.folder-picker-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 20px;
  background: var(--surface-1, #f8fafc);
  border-bottom: 1px solid var(--border, #e2e8f0);
}

.picker-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.picker-icon {
  font-size: 1.25rem;
}

.picker-title {
  margin: 0;
  font-size: 1.02rem;
  font-weight: 600;
  color: var(--text, #0f172a);
}

.picker-close-btn {
  background: transparent;
  border: none;
  color: var(--text-secondary, #64748b);
  font-size: 1.4rem;
  cursor: pointer;
  line-height: 1;
}

.picker-close-btn:hover {
  color: var(--text, #0f172a);
}

.folder-picker-nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 16px;
  background: var(--surface-1, #f8fafc);
  border-bottom: 1px solid var(--border, #e2e8f0);
  gap: 8px;
}

.picker-breadcrumbs {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
  font-size: 0.85rem;
  flex: 1;
  min-width: 0;
}

.crumb-btn {
  background: transparent;
  border: none;
  color: var(--text-secondary, #64748b);
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 4px;
  transition: all 0.15s ease;
}

.crumb-btn:hover {
  color: var(--text, #0f172a);
  background: var(--surface-2, #e2e8f0);
}

.crumb-btn.active {
  color: #008069;
  font-weight: 600;
}

.crumb-sep {
  color: var(--text-secondary, #94a3b8);
}

.new-folder-toggle-btn {
  padding: 4px 10px;
  border-radius: 6px;
  background: var(--surface-2, #e2e8f0);
  border: 1px solid var(--border, #cbd5e1);
  color: var(--text, #334155);
  font-size: 0.78rem;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.15s ease;
}

.new-folder-toggle-btn:hover {
  background: var(--surface-3, #cbd5e1);
  color: var(--text, #0f172a);
}

.new-folder-form {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  background: var(--surface-2, #f1f5f9);
  border-bottom: 1px solid var(--border, #e2e8f0);
}

.new-folder-input {
  flex: 1;
  padding: 6px 10px;
  border-radius: 6px;
  border: 1px solid var(--border, #cbd5e1);
  background: var(--surface, #ffffff);
  color: var(--text, #0f172a);
  font-size: 0.85rem;
  outline: none;
}

.new-folder-input:focus {
  border-color: #008069;
}

.new-folder-submit-btn {
  padding: 6px 12px;
  border-radius: 6px;
  background: #008069;
  color: #ffffff;
  border: none;
  font-size: 0.82rem;
  font-weight: 500;
  cursor: pointer;
}

.new-folder-submit-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.folder-picker-body {
  flex: 1;
  overflow-y: auto;
  padding: 12px 16px;
  background: var(--surface, #ffffff);
}

.folder-picker-loading,
.folder-picker-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--text-secondary, #64748b);
  font-size: 0.85rem;
  gap: 8px;
  text-align: center;
  padding: 20px;
}

.empty-icon {
  font-size: 2.2rem;
  opacity: 0.8;
}

.spinner {
  width: 26px;
  height: 26px;
  border: 3px solid var(--border, #e2e8f0);
  border-top-color: #008069;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.folder-grid {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.folder-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  background: var(--surface-1, #f8fafc);
  border: 1px solid var(--border, #e2e8f0);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.folder-item:hover {
  background: var(--surface-2, #f1f5f9);
  border-color: #008069;
}

.folder-icon {
  font-size: 1.4rem;
}

.folder-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow: hidden;
}

.folder-name {
  font-size: 0.9rem;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--text, #0f172a);
}

.folder-hint {
  font-size: 0.72rem;
  color: var(--text-secondary, #64748b);
}

.folder-arrow {
  font-size: 1.3rem;
  color: var(--text-secondary, #94a3b8);
  font-weight: bold;
}

.folder-picker-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 20px;
  background: var(--surface-1, #f8fafc);
  border-top: 1px solid var(--border, #e2e8f0);
}

.selected-target-hint {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.82rem;
  color: var(--text-secondary, #64748b);
  max-width: 260px;
  overflow: hidden;
}

.target-label {
  font-weight: 500;
}

.target-badge {
  background: var(--surface-2, #e2e8f0);
  color: #008069;
  padding: 2px 8px;
  border-radius: 6px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.picker-actions {
  display: flex;
  gap: 8px;
}

.picker-btn {
  padding: 8px 16px;
  border-radius: 8px;
  font-size: 0.88rem;
  font-weight: 500;
  border: none;
  cursor: pointer;
  transition: all 0.15s ease;
}

.picker-btn-primary {
  background: #008069;
  color: #ffffff;
}

.picker-btn-primary:hover {
  background: #006a57;
}

.picker-btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.picker-btn-secondary {
  background: var(--surface-2, #f1f5f9);
  border: 1px solid var(--border, #e2e8f0);
  color: var(--text, #334155);
}

.picker-btn-secondary:hover {
  background: var(--surface-3, #e2e8f0);
  color: var(--text, #0f172a);
}

@media (max-width: 640px) {
  .folder-picker-backdrop {
    padding: 10px;
  }
  .folder-picker-card {
    max-width: 100%;
    border-radius: 14px;
    height: 85vh;
  }
  .folder-picker-header {
    padding: 12px 14px;
  }
  .folder-picker-footer {
    flex-direction: column;
    gap: 10px;
    align-items: stretch;
  }
  .selected-target-hint {
    max-width: 100%;
  }
  .picker-actions {
    width: 100%;
  }
  .picker-actions .picker-btn {
    flex: 1;
  }
}
</style>
