<script setup>
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { formatBytes } from '../../composables/useCloudDrive.js';
import api from '../../api.js';

const props = defineProps({
  shareData: {
    type: Object,
    required: true
  },
  isOwn: {
    type: Boolean,
    default: false
  }
});

const emit = defineEmits(['preview-file']);

const router = useRouter();

const getIcon = computed(() => {
  if (props.shareData.isFolder) return '📁';
  const name = props.shareData.name || '';
  const ext = name.split('.').pop()?.toLowerCase() || '';

  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'].includes(ext)) return '🖼️';
  if (['mp4', 'mkv', 'webm', 'mov', 'avi'].includes(ext)) return '🎬';
  if (['mp3', 'wav', 'ogg', 'm4a', 'flac'].includes(ext)) return '🎵';
  if (ext === 'pdf') return '📕';
  if (['md', 'markdown'].includes(ext)) return '📖';
  if (['csv', 'tsv'].includes(ext)) return '📊';
  if (['docx', 'doc', 'xlsx', 'xls', 'pptx', 'ppt'].includes(ext)) return '📑';
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return '📦';
  if (['js', 'ts', 'jsx', 'tsx', 'vue', 'json', 'py', 'go', 'rs', 'java', 'c', 'cpp', 'html', 'css', 'sql', 'sh'].includes(ext)) return '📝';
  return '📄';
});

const handleOpenInDrive = () => {
  const nameParam = encodeURIComponent(props.shareData.name || '');
  if (props.shareData.isFolder) {
    if (props.isOwn) {
      router.push(`/drive?folderId=${encodeURIComponent(props.shareData.fileId)}&name=${nameParam}`);
    } else {
      router.push(`/drive?tab=shared&folderId=${encodeURIComponent(props.shareData.fileId)}&name=${nameParam}`);
    }
  } else {
    if (props.isOwn) {
      router.push(`/drive?fileId=${encodeURIComponent(props.shareData.fileId)}&name=${nameParam}`);
    } else {
      router.push(`/drive?tab=shared&fileId=${encodeURIComponent(props.shareData.fileId)}&name=${nameParam}`);
    }
  }
};

const handleManageShare = () => {
  const nameParam = encodeURIComponent(props.shareData.name || '');
  router.push(`/drive?manageShare=1&fileId=${encodeURIComponent(props.shareData.fileId)}&name=${nameParam}&isFolder=${props.shareData.isFolder ? '1' : '0'}`);
};

const handlePreview = () => {
  emit('preview-file', {
    id: props.shareData.fileId,
    name: props.shareData.name,
    size: props.shareData.size,
    is_folder: false
  });
};

const downloadUrl = computed(() => {
  if (props.shareData.isFolder) return '';
  return api.getDriveFileUrl(props.shareData.fileId, false);
});
</script>

<template>
  <div class="drive-share-card">
    <div class="card-header">
      <span class="card-badge">🤝 网盘协作共享</span>
      <span class="permission-tag" :class="{ 'is-write': shareData.permission === 'write' || shareData.permission === 'admin' }">
        {{ (shareData.permission === 'write' || shareData.permission === 'admin') ? '✏️ 协同可读写' : '👀 只读查看' }}
      </span>
    </div>

    <div class="card-body">
      <span class="card-icon">{{ getIcon }}</span>
      <div class="card-details">
        <h4 class="card-name" :title="shareData.name">{{ shareData.name }}</h4>
        <div class="card-meta">
          <span class="meta-item">{{ shareData.isFolder ? '文件夹' : formatBytes(shareData.size) }}</span>
          <span v-if="shareData.ownerName" class="meta-sep">·</span>
          <span v-if="shareData.ownerName" class="meta-item">来自 {{ shareData.ownerName }}</span>
        </div>
      </div>
    </div>

    <div class="card-actions">
      <button type="button" class="card-action-btn primary" @click="handleOpenInDrive">
        📂 在网盘中打开
      </button>
      <button
        v-if="isOwn"
        type="button"
        class="card-action-btn secondary"
        title="查看或撤销站内成员/群聊协同授权"
        @click="handleManageShare"
      >
        ⚙️ 权限管理
      </button>
      <button
        v-else-if="!shareData.isFolder"
        type="button"
        class="card-action-btn secondary"
        @click="handlePreview"
      >
        👁️ 在线预览
      </button>
      <a
        v-if="!shareData.isFolder && downloadUrl"
        :href="downloadUrl"
        :download="shareData.name"
        class="card-action-btn secondary download-link"
      >
        ⬇️ 下载
      </a>
    </div>
  </div>
</template>

<style scoped>
.drive-share-card {
  background: var(--surface, #ffffff);
  border: 1px solid #38bdf8;
  border-radius: 12px;
  padding: 12px 14px;
  margin: 4px 0 2px 0;
  max-width: 380px;
  width: 100%;
  box-shadow: 0 4px 16px rgba(56, 189, 248, 0.12);
  color: var(--text, #0f172a);
  transition: all 0.2s ease;
  user-select: none;
}

.drive-share-card:hover {
  box-shadow: 0 6px 20px rgba(56, 189, 248, 0.2);
  border-color: #0284c7;
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.card-badge {
  font-size: 0.76rem;
  font-weight: 600;
  color: #0284c7;
  background: rgba(56, 189, 248, 0.12);
  padding: 2px 8px;
  border-radius: 6px;
}

.permission-tag {
  font-size: 0.72rem;
  font-weight: 500;
  color: #475569;
  background: var(--surface-2, #f1f5f9);
  padding: 2px 6px;
  border-radius: 4px;
}

.permission-tag.is-write {
  color: #059669;
  background: rgba(16, 185, 129, 0.12);
}

.card-body {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}

.card-icon {
  font-size: 1.8rem;
  flex-shrink: 0;
}

.card-details {
  flex: 1;
  overflow: hidden;
  min-width: 0;
}

.card-name {
  margin: 0 0 3px 0;
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--text, #0f172a);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.card-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.75rem;
  color: var(--text-secondary, #64748b);
}

.meta-sep {
  color: var(--text-secondary, #cbd5e1);
}

.card-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  border-top: 1px solid var(--border, #e2e8f0);
  padding-top: 8px;
  margin-top: 4px;
}

.card-action-btn {
  flex: 1;
  padding: 5px 8px;
  border-radius: 6px;
  font-size: 0.78rem;
  font-weight: 500;
  border: none;
  cursor: pointer;
  text-align: center;
  text-decoration: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s ease;
  white-space: nowrap;
}

.card-action-btn.primary {
  background: #0284c7;
  color: #ffffff;
}

.card-action-btn.primary:hover {
  background: #0369a1;
}

.card-action-btn.secondary {
  background: var(--surface-2, #f1f5f9);
  border: 1px solid var(--border, #e2e8f0);
  color: var(--text, #334155);
}

.card-action-btn.secondary:hover {
  background: var(--surface-3, #e2e8f0);
  color: var(--text, #0f172a);
}

.download-link {
  color: inherit;
}
</style>
