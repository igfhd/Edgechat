<script setup>
import { ref, onMounted, computed } from 'vue';
import { useCloudDrive, formatBytes } from '../../composables/useCloudDrive.js';

const props = defineProps({
  show: {
    type: Boolean,
    default: false
  },
  onClose: {
    type: Function,
    required: true
  },
  onSelectFile: {
    type: Function,
    required: true
  },
  onShareCard: {
    type: Function,
    default: null
  }
});

const {
  files,
  breadcrumbs,
  currentFolderId,
  isLoading,
  loadFiles
} = useCloudDrive();

const selectedFile = ref(null);
const searchKeyword = ref('');
const sharePermission = ref('read');

onMounted(() => {
  if (props.show) {
    loadFiles();
  }
});

const handleNavigate = (folderId) => {
  selectedFile.value = null;
  searchKeyword.value = '';
  loadFiles(folderId);
};

const handleSelect = (file) => {
  if (selectedFile.value?.id === file.id && file.is_folder) {
    handleNavigate(file.id);
  } else {
    selectedFile.value = file;
  }
};

const handleConfirmAttachment = () => {
  if (selectedFile.value && !selectedFile.value.is_folder) {
    props.onSelectFile(selectedFile.value);
    props.onClose();
  }
};

const handleConfirmShareCard = () => {
  if (selectedFile.value && props.onShareCard) {
    props.onShareCard({
      file: selectedFile.value,
      permission: sharePermission.value
    });
    props.onClose();
  }
};

const formatDate = (dateStr) => {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
};

const getFileIcon = (file) => {
  if (file.is_folder) return '📁';
  const mime = file.mime_type || '';
  const ext = (file.name?.split('.').pop() || '').toLowerCase();

  if (mime.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif'].includes(ext)) return '🖼️';
  if (mime.startsWith('video/') || ['mp4', 'mkv', 'webm', 'mov', 'avi'].includes(ext)) return '🎬';
  if (mime.startsWith('audio/') || ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac'].includes(ext)) return '🎵';
  if (ext === 'pdf' || mime.includes('pdf')) return '📕';
  if (['md', 'markdown'].includes(ext)) return '📖';
  if (['csv', 'tsv'].includes(ext)) return '📊';
  if (['docx', 'doc', 'xlsx', 'xls', 'pptx', 'ppt'].includes(ext)) return '📑';
  if (['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz'].includes(ext)) return '📦';
  if (['js', 'ts', 'jsx', 'tsx', 'vue', 'json', 'py', 'go', 'rs', 'java', 'c', 'cpp', 'h', 'hpp', 'cs', 'php', 'rb', 'html', 'htm', 'css', 'scss', 'sql', 'sh', 'bash', 'yaml', 'yml', 'toml', 'ini', 'env', 'log', 'txt'].includes(ext)) return '📝';
  return '📄';
};

const filteredFiles = computed(() => {
  if (!searchKeyword.value.trim()) return files.value;
  const kw = searchKeyword.value.trim().toLowerCase();
  return files.value.filter(f => f.name.toLowerCase().includes(kw));
});
</script>

<template>
  <div v-if="show" class="picker-backdrop" @click.self="onClose">
    <div class="picker-card">
      <div class="picker-header">
        <div class="picker-title-row">
          <span class="picker-icon">📁</span>
          <h3 class="picker-title">从我的云盘选取 / 共享文件</h3>
        </div>
        <button type="button" class="picker-close-btn" @click="onClose">×</button>
      </div>

      <!-- Search & Breadcrumbs Bar -->
      <div class="picker-nav-bar">
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

        <div class="picker-search-box">
          <input
            v-model="searchKeyword"
            type="text"
            placeholder="搜索当前目录..."
            class="picker-search-input"
          />
        </div>
      </div>

      <!-- File List -->
      <div class="picker-body">
        <div v-if="isLoading" class="picker-loading">
          <div class="spinner"></div>
          <span>正在读取云盘文件...</span>
        </div>

        <div v-else-if="filteredFiles.length === 0" class="picker-empty">
          <span class="empty-icon">📂</span>
          <span>{{ searchKeyword ? '未找到匹配的文件' : '此目录下暂无文件' }}</span>
        </div>

        <div v-else class="picker-file-list">
          <div
            v-for="file in filteredFiles"
            :key="file.id"
            class="picker-file-item"
            :class="{
              'is-selected': selectedFile?.id === file.id,
              'is-folder': file.is_folder
            }"
            @click="handleSelect(file)"
            @dblclick="file.is_folder && handleNavigate(file.id)"
          >
            <span class="pfi-icon">{{ getFileIcon(file) }}</span>
            <div class="pfi-info">
              <span class="pfi-name" :title="file.name">{{ file.name }}</span>
              <div class="pfi-meta-row">
                <span class="pfi-size-badge">{{ file.is_folder ? '文件夹' : formatBytes(file.size) }}</span>
                <span v-if="file.updated_at" class="pfi-date">修改于 {{ formatDate(file.updated_at) }}</span>
              </div>
            </div>
            <button
              v-if="file.is_folder"
              type="button"
              class="folder-enter-btn"
              title="进入此文件夹"
              @click.stop="handleNavigate(file.id)"
            >
              进入 ›
            </button>
            <span v-if="selectedFile?.id === file.id" class="pfi-check">✓</span>
          </div>
        </div>
      </div>

      <!-- Footer with Dual Actions -->
      <div class="picker-footer">
        <div class="footer-left">
          <div class="selected-hint">
            <template v-if="selectedFile">
              <span class="selected-label">已选：</span>
              <span class="selected-name" :title="selectedFile.name">{{ selectedFile.name }}</span>
              <span class="selected-size">({{ selectedFile.is_folder ? '文件夹' : formatBytes(selectedFile.size) }})</span>
            </template>
            <span v-else class="placeholder-hint">点击文件或文件夹以选择</span>
          </div>

          <!-- Permission Selector for Share Card -->
          <div v-if="selectedFile && onShareCard" class="perm-picker">
            <span class="perm-label">协同权限:</span>
            <label class="perm-radio">
              <input v-model="sharePermission" type="radio" value="read" />
              <span>只读</span>
            </label>
            <label class="perm-radio">
              <input v-model="sharePermission" type="radio" value="write" />
              <span>协同编辑</span>
            </label>
          </div>
        </div>

        <div class="picker-actions">
          <button type="button" class="picker-btn picker-btn-secondary" @click="onClose">取消</button>
          
          <!-- Send as regular attachment (only for files) -->
          <button type="button"
            v-if="selectedFile && !selectedFile.is_folder"
            class="picker-btn picker-btn-secondary"
            @click="handleConfirmAttachment"
          >
            📤 发送为附件
          </button>

          <!-- Send as Drive Collaboration Card -->
          <button type="button"
            v-if="selectedFile && onShareCard"
            class="picker-btn picker-btn-primary"
            @click="handleConfirmShareCard"
          >
            🤝 发送共享协作卡片
          </button>

          <!-- Fallback when only onSelectFile is bound -->
          <button type="button"
            v-else-if="selectedFile && !selectedFile.is_folder"
            class="picker-btn picker-btn-primary"
            @click="handleConfirmAttachment"
          >
            发送文件
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.picker-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.65);
  backdrop-filter: blur(8px);
  z-index: 1200;
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

.picker-card {
  background: var(--surface, #ffffff);
  border: 1px solid var(--border, #e2e8f0);
  border-radius: 16px;
  width: 100%;
  max-width: 640px;
  height: 580px;
  display: flex;
  flex-direction: column;
  box-shadow: 0 24px 56px rgba(0, 0, 0, 0.2);
  color: var(--text, #0f172a);
  overflow: hidden;
}

.picker-header {
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
  padding: 0 4px;
}

.picker-close-btn:hover {
  color: var(--text, #0f172a);
}

.picker-nav-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 16px;
  background: var(--surface-1, #f8fafc);
  border-bottom: 1px solid var(--border, #e2e8f0);
  gap: 12px;
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

.picker-search-input {
  padding: 5px 10px;
  border-radius: 6px;
  border: 1px solid var(--border, #e2e8f0);
  background: var(--surface, #ffffff);
  color: var(--text, #0f172a);
  font-size: 0.8rem;
  outline: none;
  width: 140px;
}

.picker-search-input:focus {
  border-color: #008069;
}

.picker-body {
  flex: 1;
  overflow-y: auto;
  padding: 10px 14px;
  background: var(--surface, #ffffff);
}

.picker-loading,
.picker-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--text-secondary, #64748b);
  font-size: 0.88rem;
  gap: 8px;
}

.empty-icon {
  font-size: 2rem;
}

.spinner {
  width: 28px;
  height: 28px;
  border: 3px solid var(--border, #e2e8f0);
  border-top-color: #008069;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.picker-file-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.picker-file-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  background: var(--surface-1, #f8fafc);
  border: 1px solid var(--border, #e2e8f0);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.picker-file-item:hover {
  background: var(--surface-2, #f1f5f9);
  border-color: var(--border-hover, #cbd5e1);
}

.picker-file-item.is-selected {
  background: rgba(0, 128, 105, 0.08);
  border-color: #008069;
}

.pfi-icon {
  font-size: 1.4rem;
  flex-shrink: 0;
}

.pfi-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow: hidden;
  min-width: 0;
}

.pfi-name {
  font-size: 0.88rem;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--text, #0f172a);
}

.pfi-meta-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.74rem;
  color: var(--text-secondary, #64748b);
}

.pfi-size-badge {
  background: var(--surface-2, #e2e8f0);
  padding: 1px 5px;
  border-radius: 4px;
  white-space: nowrap;
}

.pfi-date {
  white-space: nowrap;
}

.folder-enter-btn {
  background: var(--surface-2, #e2e8f0);
  border: 1px solid var(--border, #cbd5e1);
  padding: 3px 8px;
  border-radius: 4px;
  font-size: 0.74rem;
  color: var(--text, #334155);
  cursor: pointer;
  transition: all 0.15s ease;
}

.folder-enter-btn:hover {
  background: #008069;
  color: #ffffff;
  border-color: #008069;
}

.pfi-check {
  color: #008069;
  font-weight: bold;
  font-size: 1.1rem;
}

.picker-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 18px;
  background: var(--surface-1, #f8fafc);
  border-top: 1px solid var(--border, #e2e8f0);
  flex-wrap: wrap;
  gap: 10px;
}

.footer-left {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-width: 280px;
}

.selected-hint {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 0.82rem;
  color: var(--text-secondary, #64748b);
  overflow: hidden;
}

.selected-label {
  font-weight: 600;
  color: #008069;
}

.selected-name {
  color: var(--text, #0f172a);
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.selected-size {
  white-space: nowrap;
}

.placeholder-hint {
  color: var(--text-secondary, #94a3b8);
}

.perm-picker {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.75rem;
  color: var(--text, #334155);
}

.perm-label {
  font-weight: 500;
  color: var(--text-secondary, #64748b);
}

.perm-radio {
  display: flex;
  align-items: center;
  gap: 3px;
  cursor: pointer;
}

.picker-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.picker-btn {
  padding: 7px 14px;
  border-radius: 8px;
  font-size: 0.84rem;
  font-weight: 500;
  border: none;
  cursor: pointer;
  transition: all 0.15s ease;
  white-space: nowrap;
}

.picker-btn-primary {
  background: #0284c7;
  color: #ffffff;
}

.picker-btn-primary:hover {
  background: #0369a1;
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
</style>
