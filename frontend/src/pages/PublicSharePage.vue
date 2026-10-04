<script setup>
import { ref, onMounted, computed } from 'vue';
import { useRoute } from 'vue-router';
import api from '../api.js';
import { formatBytes } from '../composables/useCloudDrive.js';
import DriveFilePreviewModal from '../components/drive/DriveFilePreviewModal.vue';
import UiAvatar from '../components/ui/Avatar.vue';

const route = useRoute();
const token = route.params.token;
const prefix = api.getBasePrefix();

const shareInfo = ref(null);
const files = ref([]);
const breadcrumbs = ref([]);
const currentFolderId = ref(null);
const password = ref('');
const isVerifying = ref(false);
const verified = ref(false);
const error = ref('');
const isLoading = ref(true);
const previewFile = ref(null);

const loadShare = async () => {
  isLoading.value = true;
  error.value = '';
  try {
    const res = await fetch(`${prefix}/api/drive/public/shares/${encodeURIComponent(token)}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || '分享链接无效或已过期');
    }
    const data = await res.json();
    shareInfo.value = data;

    if (!data.hasPassword) {
      verified.value = true;
      if (data.isFolder) {
        breadcrumbs.value = [{ id: null, name: data.name }];
        await loadSharedFolderFiles(null);
      }
    }
  } catch (err) {
    error.value = err.message || '加载分享失败';
  } finally {
    isLoading.value = false;
  }
};

const handleVerify = async () => {
  if (!password.value.trim()) return;
  isVerifying.value = true;
  error.value = '';
  try {
    const res = await fetch(`${prefix}/api/drive/public/shares/${encodeURIComponent(token)}/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: password.value.trim() })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || '提取码或密码错误');
    }
    verified.value = true;
    if (shareInfo.value?.isFolder) {
      breadcrumbs.value = [{ id: null, name: shareInfo.value.name }];
      await loadSharedFolderFiles(null);
    }
  } catch (err) {
    error.value = err.message;
  } finally {
    isVerifying.value = false;
  }
};

const loadSharedFolderFiles = async (parentId = null) => {
  try {
    currentFolderId.value = parentId;
    const url = `${prefix}/api/drive/public/shares/${encodeURIComponent(token)}/files${parentId ? `?parentId=${encodeURIComponent(parentId)}` : ''}`;
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      files.value = data.files || [];
    }
  } catch (err) {
    console.error('Failed to load shared files:', err);
  }
};

const navigateToFolder = (folder) => {
  breadcrumbs.value.push({ id: folder.id, name: folder.name });
  loadSharedFolderFiles(folder.id);
};

const navigateToBreadcrumb = (index) => {
  const target = breadcrumbs.value[index];
  breadcrumbs.value = breadcrumbs.value.slice(0, index + 1);
  loadSharedFolderFiles(target.id);
};

const formatDate = (dateStr) => {
  if (!dateStr) return '-';
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
  if (file.is_folder || file.isFolder) return '📁';
  const ext = (file.name?.split('.').pop() || '').toLowerCase();
  const mime = file.mime_type || file.mimeType || '';

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

const singleFileDownloadUrl = computed(() => {
  return `${prefix}/api/drive/public/shares/${encodeURIComponent(token)}/download/single`;
});

const getFolderFileDownloadUrl = (fileId) => {
  return `${prefix}/api/drive/public/shares/${encodeURIComponent(token)}/download/${encodeURIComponent(fileId)}`;
};

const openSingleFilePreview = () => {
  if (!shareInfo.value) return;
  previewFile.value = {
    id: shareInfo.value.token,
    name: shareInfo.value.name,
    size: shareInfo.value.size,
    mime_type: shareInfo.value.mimeType,
    updated_at: shareInfo.value.updatedAt
  };
};

const openFolderFilePreview = (file) => {
  previewFile.value = {
    id: file.id,
    name: file.name,
    size: file.size,
    mime_type: file.mime_type,
    updated_at: file.updated_at,
    is_folder: file.is_folder
  };
};

const currentPreviewUrls = computed(() => {
  if (!previewFile.value) return { viewUrl: '', downloadUrl: '' };
  if (!shareInfo.value?.isFolder) {
    return {
      viewUrl: singleFileDownloadUrl.value,
      downloadUrl: singleFileDownloadUrl.value
    };
  }
  const fileId = previewFile.value.id;
  return {
    viewUrl: getFolderFileDownloadUrl(fileId),
    downloadUrl: getFolderFileDownloadUrl(fileId)
  };
});

onMounted(() => {
  void loadShare();
});
</script>

<template>
  <div class="public-share-layout">
    <div class="public-share-container" :class="{ 'is-folder-mode': shareInfo?.isFolder && verified }">
      <!-- Top Brand Header -->
      <div class="share-header-bar">
        <div class="brand-logo">
          <span class="logo-emoji">☁️</span>
          <span class="logo-text">EdgeChat 云盘分享</span>
        </div>
      </div>

      <!-- Loading State -->
      <div v-if="isLoading" class="share-loading">
        <div class="spinner"></div>
        <span>正在加载分享内容...</span>
      </div>

      <!-- Error State -->
      <div v-else-if="error && !verified" class="share-error-box">
        <span class="error-icon">⚠️</span>
        <h3 class="error-title">无法访问此分享</h3>
        <p class="error-msg">{{ error }}</p>
      </div>

      <!-- Password Form -->
      <div v-else-if="!verified && shareInfo?.hasPassword" class="share-pwd-box">
        <!-- Sharer Header in Password View -->
        <div class="sharer-profile-row">
          <UiAvatar
            :src="shareInfo.ownerAvatarUrl"
            :fallback="(shareInfo.ownerName || 'U')[0]"
            size="md"
          />
          <div class="sharer-profile-info">
            <div class="sharer-name-line">
              <span class="sharer-name">{{ shareInfo.ownerName }}</span>
              <span v-if="shareInfo.ownerUsername" class="sharer-username">@{{ shareInfo.ownerUsername }}</span>
            </div>
            <span class="share-date-line">分享于 {{ formatDate(shareInfo.sharedAt) }}</span>
          </div>
        </div>

        <div class="share-file-meta-card">
          <span class="file-icon">{{ getFileIcon(shareInfo) }}</span>
          <h3 class="file-name" :title="shareInfo.name">{{ shareInfo.name }}</h3>
          <div class="meta-tags-row">
            <span class="meta-tag">{{ shareInfo.isFolder ? '文件夹' : formatBytes(shareInfo.size) }}</span>
            <span v-if="shareInfo.updatedAt" class="meta-tag">修改于 {{ formatDate(shareInfo.updatedAt) }}</span>
          </div>
        </div>

        <p class="pwd-prompt">🔒 该分享设置了访问密码，请输入提取码查看：</p>
        <div class="pwd-input-row">
          <input
            v-model="password"
            type="password"
            placeholder="请输入提取码"
            class="pwd-input"
            @keyup.enter="handleVerify"
          />
          <button type="button" class="verify-btn" :disabled="isVerifying" @click="handleVerify">
            {{ isVerifying ? '验证中...' : '提取文件' }}
          </button>
        </div>
        <p v-if="error" class="verify-err">{{ error }}</p>
      </div>

      <!-- Verified Content Area -->
      <div v-else-if="verified && shareInfo" class="share-content-box">
        <!-- Sharer Profile Bar -->
        <div class="sharer-profile-row">
          <UiAvatar
            :src="shareInfo.ownerAvatarUrl"
            :fallback="(shareInfo.ownerName || 'U')[0]"
            size="md"
          />
          <div class="sharer-profile-info">
            <div class="sharer-name-line">
              <span class="sharer-name">{{ shareInfo.ownerName }}</span>
              <span v-if="shareInfo.ownerUsername" class="sharer-username">@{{ shareInfo.ownerUsername }}</span>
            </div>
            <span class="share-date-line">分享于 {{ formatDate(shareInfo.sharedAt) }}</span>
          </div>
          <div class="share-perm-badge">
            {{ shareInfo.permission === 'view_upload' ? '读写协同' : '只读下载' }}
          </div>
        </div>

        <!-- 1. SINGLE FILE VIEW -->
        <div v-if="!shareInfo.isFolder" class="single-file-section">
          <div class="file-detail-card">
            <span class="file-icon-large">{{ getFileIcon(shareInfo) }}</span>
            <h2 class="file-title" :title="shareInfo.name">{{ shareInfo.name }}</h2>

            <div class="file-properties-grid">
              <div class="property-item">
                <span class="prop-label">文件大小</span>
                <span class="prop-value">{{ formatBytes(shareInfo.size) }}</span>
              </div>
              <div class="property-item">
                <span class="prop-label">修改日期</span>
                <span class="prop-value">{{ formatDate(shareInfo.updatedAt) }}</span>
              </div>
              <div class="property-item">
                <span class="prop-label">链接有效性</span>
                <span class="prop-value">{{ shareInfo.expiresAt ? `至 ${formatDate(shareInfo.expiresAt)}` : '永久有效' }}</span>
              </div>
            </div>

            <div class="single-file-actions">
              <button type="button" class="preview-btn" @click="openSingleFilePreview">
                <span>👁️</span> 在线预览
              </button>
              <a :href="singleFileDownloadUrl" class="download-btn">
                <span>⬇️</span> 立即下载 ({{ formatBytes(shareInfo.size) }})
              </a>
            </div>
          </div>
        </div>

        <!-- 2. FOLDER BROWSER VIEW -->
        <div v-else class="folder-browser-section">
          <div class="folder-header-info">
            <div class="folder-title-row">
              <span class="folder-icon-large">📁</span>
              <div class="folder-title-box">
                <h2 class="folder-title">{{ shareInfo.name }}</h2>
                <div class="folder-meta-sub">
                  <span>修改日期: {{ formatDate(shareInfo.updatedAt) }}</span>
                  <span>•</span>
                  <span>{{ shareInfo.expiresAt ? `有效期至: ${formatDate(shareInfo.expiresAt)}` : '永久有效' }}</span>
                </div>
              </div>
            </div>

            <!-- Breadcrumbs -->
            <div class="folder-breadcrumbs">
              <span
                v-for="(bc, index) in breadcrumbs"
                :key="bc.id || 'root'"
                class="breadcrumb-item"
              >
                <span
                  class="bc-link"
                  :class="{ 'is-active': index === breadcrumbs.length - 1 }"
                  @click="navigateToBreadcrumb(index)"
                >
                  {{ bc.name }}
                </span>
                <span v-if="index < breadcrumbs.length - 1" class="bc-sep">/</span>
              </span>
            </div>
          </div>

          <!-- Files Table -->
          <div class="folder-files-container">
            <div v-if="files.length === 0" class="empty-folder-state">
              <span class="empty-folder-icon">📂</span>
              <p>文件夹为空</p>
            </div>
            <table v-else class="shared-files-table">
              <thead>
                <tr>
                  <th style="width: 48%;">文件名</th>
                  <th style="width: 18%;">文件大小</th>
                  <th style="width: 22%;">修改日期</th>
                  <th style="width: 12%; text-align: right;">操作</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="f in files" :key="f.id" class="table-row">
                  <td>
                    <div class="col-filename">
                      <span class="row-file-icon">{{ getFileIcon(f) }}</span>
                      <span
                        class="row-file-name"
                        :class="{ 'is-folder-link': f.is_folder, 'is-file-link': !f.is_folder }"
                        :title="f.name"
                        @click="f.is_folder ? navigateToFolder(f) : openFolderFilePreview(f)"
                      >
                        {{ f.name }}
                      </span>
                    </div>
                  </td>
                  <td class="col-filesize">{{ f.is_folder ? '-' : formatBytes(f.size) }}</td>
                  <td class="col-date">{{ formatDate(f.updated_at) }}</td>
                  <td style="text-align: right;">
                    <div class="col-actions">
                      <button type="button"
                        v-if="!f.is_folder"
                        class="act-btn preview-act-btn"
                        title="预览"
                        @click="openFolderFilePreview(f)"
                      >
                        👁️
                      </button>
                      <a
                        v-if="!f.is_folder"
                        :href="getFolderFileDownloadUrl(f.id)"
                        class="act-btn download-act-btn"
                        title="下载"
                      >
                        ⬇️
                      </a>
                      <button type="button"
                        v-else
                        class="act-btn open-act-btn"
                        title="进入文件夹"
                        @click="navigateToFolder(f)"
                      >
                        📂
                      </button>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>

    <!-- Rich File Preview Modal for Public Share -->
    <DriveFilePreviewModal
      v-if="previewFile"
      :file="previewFile"
      :file-url="currentPreviewUrls.viewUrl"
      :download-url="currentPreviewUrls.downloadUrl"
      :on-close="() => { previewFile = null; }"
    />
  </div>
</template>

<style scoped>
.public-share-layout {
  min-height: 100vh;
  width: 100vw;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-body, #f8fafc);
  color: var(--text-primary, #0f172a);
  padding: 24px;
  box-sizing: border-box;
}

.public-share-container {
  background: var(--surface, #ffffff);
  border: 1px solid var(--border, #e2e8f0);
  border-radius: 20px;
  width: 100%;
  max-width: 580px;
  padding: 32px;
  box-shadow: 0 20px 48px rgba(0, 0, 0, 0.08);
  transition: max-width 0.2s ease;
}

.public-share-container.is-folder-mode {
  max-width: 900px;
}

.share-header-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 24px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--border, #e2e8f0);
}

.brand-logo {
  display: flex;
  align-items: center;
  gap: 8px;
}

.logo-emoji {
  font-size: 1.5rem;
}

.logo-text {
  font-size: 1.05rem;
  font-weight: 700;
  color: var(--text, #0f172a);
  letter-spacing: -0.01em;
}

/* Sharer Profile Row */
.sharer-profile-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  background: var(--surface-1, #f8fafc);
  border-radius: 12px;
  border: 1px solid var(--border, #e2e8f0);
  margin-bottom: 24px;
}

.sharer-profile-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
}

.sharer-name-line {
  display: flex;
  align-items: center;
  gap: 6px;
}

.sharer-name {
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--text, #0f172a);
}

.sharer-username {
  font-size: 0.8rem;
  color: var(--text-secondary, #64748b);
}

.share-date-line {
  font-size: 0.78rem;
  color: var(--text-secondary, #64748b);
}

.share-perm-badge {
  font-size: 0.78rem;
  background: rgba(16, 185, 129, 0.12);
  color: #059669;
  padding: 4px 10px;
  border-radius: 6px;
  font-weight: 500;
  white-space: nowrap;
}

/* Single File Detail */
.file-detail-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 16px;
  padding: 16px 0;
}

.file-icon-large {
  font-size: 4rem;
  line-height: 1;
}

.file-title {
  margin: 0;
  font-size: 1.35rem;
  font-weight: 700;
  color: var(--text, #0f172a);
  word-break: break-all;
  max-width: 480px;
}

.file-properties-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  width: 100%;
  background: var(--surface-1, #f8fafc);
  padding: 16px;
  border-radius: 12px;
  border: 1px solid var(--border, #e2e8f0);
}

.property-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.prop-label {
  font-size: 0.76rem;
  color: var(--text-secondary, #64748b);
  text-transform: uppercase;
}

.prop-value {
  font-size: 0.88rem;
  font-weight: 600;
  color: var(--text, #0f172a);
  word-break: break-all;
}

.single-file-actions {
  display: flex;
  gap: 12px;
  width: 100%;
  margin-top: 8px;
}

.preview-btn,
.download-btn {
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 12px 20px;
  border-radius: 10px;
  font-weight: 600;
  font-size: 0.95rem;
  cursor: pointer;
  text-decoration: none;
  transition: all 0.15s ease;
}

.preview-btn {
  background: var(--surface-1, #f8fafc);
  border: 1px solid var(--border, #e2e8f0);
  color: var(--text, #0f172a);
}

.preview-btn:hover {
  background: var(--surface-2, #e2e8f0);
}

.download-btn {
  background: #008069;
  border: 1px solid #008069;
  color: #ffffff;
}

.download-btn:hover {
  background: #006a57;
}

/* Folder Browser */
.folder-header-info {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 16px;
}

.folder-title-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.folder-icon-large {
  font-size: 2.2rem;
}

.folder-title-box {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.folder-title {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--text, #0f172a);
}

.folder-meta-sub {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.8rem;
  color: var(--text-secondary, #64748b);
}

.folder-breadcrumbs {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  font-size: 0.88rem;
  padding: 8px 12px;
  background: var(--surface-1, #f8fafc);
  border-radius: 8px;
  border: 1px solid var(--border, #e2e8f0);
}

.bc-link {
  color: #008069;
  cursor: pointer;
  font-weight: 500;
}

.bc-link:hover {
  text-decoration: underline;
}

.bc-link.is-active {
  color: var(--text, #0f172a);
  font-weight: 600;
  cursor: default;
  text-decoration: none;
}

.bc-sep {
  color: var(--text-secondary, #94a3b8);
}

.folder-files-container {
  border: 1px solid var(--border, #e2e8f0);
  border-radius: 12px;
  overflow: hidden;
  max-height: 440px;
  overflow-y: auto;
}

.shared-files-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.88rem;
}

.shared-files-table th {
  background: var(--surface-1, #f8fafc);
  padding: 10px 14px;
  font-weight: 600;
  color: var(--text-secondary, #64748b);
  border-bottom: 1px solid var(--border, #e2e8f0);
  text-align: left;
  position: sticky;
  top: 0;
  z-index: 1;
}

.shared-files-table td {
  padding: 10px 14px;
  border-bottom: 1px solid var(--border, #e2e8f0);
  color: var(--text, #0f172a);
}

.table-row:hover {
  background: var(--surface-1, #f8fafc);
}

.col-filename {
  display: flex;
  align-items: center;
  gap: 8px;
}

.row-file-icon {
  font-size: 1.2rem;
}

.row-file-name {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 320px;
}

.row-file-name.is-folder-link,
.row-file-name.is-file-link {
  cursor: pointer;
}

.row-file-name.is-folder-link:hover,
.row-file-name.is-file-link:hover {
  color: #008069;
  text-decoration: underline;
}

.col-filesize,
.col-date {
  color: var(--text-secondary, #64748b);
  font-size: 0.82rem;
  white-space: nowrap;
}

.col-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
}

.act-btn {
  padding: 5px 8px;
  border-radius: 6px;
  border: 1px solid var(--border, #e2e8f0);
  background: transparent;
  cursor: pointer;
  text-decoration: none;
  font-size: 0.85rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s ease;
}

.act-btn:hover {
  background: var(--surface-2, #e2e8f0);
}

.empty-folder-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px;
  color: var(--text-secondary, #64748b);
  gap: 8px;
}

.empty-folder-icon {
  font-size: 2.5rem;
}

/* Password Form */
.share-file-meta-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 10px;
  margin-bottom: 20px;
}

.meta-tags-row {
  display: flex;
  gap: 8px;
}

.meta-tag {
  font-size: 0.8rem;
  color: var(--text-secondary, #64748b);
  background: var(--surface-1, #f8fafc);
  padding: 2px 8px;
  border-radius: 4px;
  border: 1px solid var(--border, #e2e8f0);
}

.pwd-prompt {
  font-size: 0.92rem;
  color: var(--text-secondary, #64748b);
  margin-bottom: 12px;
}

.pwd-input-row {
  display: flex;
  gap: 10px;
}

.pwd-input {
  flex: 1;
  padding: 10px 14px;
  background: var(--surface-1, #f8fafc);
  border: 1px solid var(--border, #e2e8f0);
  border-radius: 8px;
  color: var(--text, #0f172a);
  font-size: 0.95rem;
  outline: none;
}

.pwd-input:focus {
  border-color: #008069;
  background: var(--surface, #ffffff);
}

.verify-btn {
  padding: 10px 20px;
  background: #008069;
  color: #ffffff;
  border: none;
  border-radius: 8px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s ease;
}

.verify-btn:hover {
  background: #006a57;
}

.verify-err {
  color: #ef4444;
  font-size: 0.88rem;
  margin-top: 8px;
}

.spinner {
  width: 32px;
  height: 32px;
  border: 3px solid var(--border, #e2e8f0);
  border-top-color: #008069;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

@media (max-width: 640px) {
  .public-share-layout {
    padding: 12px;
  }
  .public-share-container {
    padding: 20px;
    border-radius: 14px;
  }
  .file-properties-grid {
    grid-template-columns: 1fr;
  }
  .single-file-actions {
    flex-direction: column;
  }
}
</style>
