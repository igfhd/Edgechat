<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import api, { apiFetch, getAuthToken } from '../../api.js';
import { formatBytes } from '../../composables/useCloudDrive.js';
import { renderMarkdown } from '../../markdown.js';
import {
  parseArchive,
  buildFileTree,
  getArchiveItemIcon,
  getArchiveFileMime,
  downloadArchiveSubFile
} from '../../utils/archiveUtils.js';

const props = defineProps({
  file: {
    type: Object,
    required: true
  },
  fileUrl: {
    type: String,
    default: ''
  },
  currentFolderId: {
    type: [String, Number, null],
    default: null
  }
});

const emit = defineEmits(['extract-done', 'close']);

// Archive Loading & Parsing State
const isLoading = ref(true);
const loadingText = ref('正在下载并解析压缩包...');
const parseError = ref('');
const fileTree = ref(null);
const flatFiles = ref([]);
const flatFolders = ref([]);
const rawFilesMap = ref({});
const searchQuery = ref('');

// Sub-file Preview State
const activeSubFile = ref(null);
const subFileText = ref('');
const subFileBlobUrl = ref('');
const isSubFileLoading = ref(false);

// Folder Expansion State (Set of folder paths)
const expandedFolders = ref(new Set());

// Batch Extraction State
const isExtracting = ref(false);
const extractCurrentIndex = ref(0);
const extractTotalCount = ref(0);
const extractCurrentFileName = ref('');

const archiveUrl = computed(() => {
  if (props.fileUrl) return props.fileUrl;
  return props.file?.id ? api.getDriveFileUrl(props.file.id, true) : '';
});

const downloadUrl = computed(() => {
  return props.file?.id ? api.getDriveFileUrl(props.file.id, false) : '';
});

// Load and parse archive
const loadArchive = async () => {
  isLoading.value = true;
  parseError.value = '';
  loadingText.value = '正在从云盘读取压缩文件...';

  try {
    const url = archiveUrl.value;
    if (!url) throw new Error('未获取到有效的压缩包访问链接');

    const res = await fetch(url);
    if (!res.ok) throw new Error(`加载压缩包失败 (${res.status})`);

    loadingText.value = '正在解析文件目录索引...';
    const buffer = await res.arrayBuffer();

    const parsed = await parseArchive(buffer, props.file.name);
    rawFilesMap.value = parsed;

    const tree = buildFileTree(parsed);
    fileTree.value = tree;

    // Collect all folders (including empty directory entries) and files
    const fileList = [];
    const folderSet = new Set();

    for (const [path, data] of Object.entries(parsed)) {
      const normalized = path.replace(/\\/g, '/').replace(/^\/+/, '');
      if (!normalized) continue;

      if (normalized.endsWith('/')) {
        // Explicit directory entry in ZIP
        const folderPath = normalized.replace(/\/+$/, '');
        if (folderPath) {
          const segs = folderPath.split('/').filter(Boolean);
          let acc = '';
          for (const seg of segs) {
            acc = acc ? `${acc}/${seg}` : seg;
            folderSet.add(acc);
          }
        }
      } else {
        // File entry: also ensure all ancestor directories are tracked
        const segs = normalized.split('/').filter(Boolean);
        const name = segs.pop();
        let acc = '';
        for (const seg of segs) {
          acc = acc ? `${acc}/${seg}` : seg;
          folderSet.add(acc);
        }
        fileList.push({
          name,
          path: normalized,
          isFolder: false,
          size: data?.byteLength || 0,
          data
        });
      }
    }
    flatFiles.value = fileList;
    flatFolders.value = Array.from(folderSet).sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));

    // Auto expand top level folders
    if (tree?.children) {
      for (const child of tree.children) {
        if (child.isFolder) expandedFolders.value.add(child.path);
      }
    }
  } catch (err) {
    parseError.value = err.message || '压缩包解析失败，可能已损坏或格式不受支持';
  } finally {
    isLoading.value = false;
  }
};

const toggleFolder = (folderPath) => {
  if (expandedFolders.value.has(folderPath)) {
    expandedFolders.value.delete(folderPath);
  } else {
    expandedFolders.value.add(folderPath);
  }
};

// Filtered items when searching
const filteredFiles = computed(() => {
  if (!searchQuery.value.trim()) return [];
  const q = searchQuery.value.trim().toLowerCase();
  return flatFiles.value.filter((f) => f.name.toLowerCase().includes(q) || f.path.toLowerCase().includes(q));
});

// Preview Sub-file
const openSubFilePreview = (item) => {
  if (item.isFolder || !item.data) return;

  // Clean previous blob url
  if (subFileBlobUrl.value) {
    URL.revokeObjectURL(subFileBlobUrl.value);
    subFileBlobUrl.value = '';
  }

  activeSubFile.value = item;
  isSubFileLoading.value = true;

  try {
    const mime = getArchiveFileMime(item.name);
    const ext = (item.name.split('.').pop() || '').toLowerCase();

    // Check if text/code/markdown/json
    const isTextual = mime.startsWith('text/') ||
      ['md', 'markdown', 'json', 'js', 'ts', 'jsx', 'tsx', 'vue', 'html', 'htm', 'css', 'scss', 'py', 'sql', 'sh', 'yaml', 'yml', 'toml', 'ini', 'env', 'log', 'txt', 'xml', 'csv'].includes(ext);

    if (isTextual) {
      subFileText.value = new TextDecoder('utf-8', { fatal: false }).decode(item.data);
    } else {
      const blob = new Blob([item.data], { type: mime });
      subFileBlobUrl.value = URL.createObjectURL(blob);
    }
  } catch (err) {
    subFileText.value = `无法解析文件内容: ${err.message}`;
  } finally {
    isSubFileLoading.value = false;
  }
};

const closeSubFilePreview = () => {
  if (subFileBlobUrl.value) {
    URL.revokeObjectURL(subFileBlobUrl.value);
    subFileBlobUrl.value = '';
  }
  activeSubFile.value = null;
  subFileText.value = '';
};

const handleDownloadSubFile = (item) => {
  if (item.isFolder || !item.data) return;
  downloadArchiveSubFile(item.data, item.name);
};

// Markdown HTML for sub-file
const renderedSubFileMarkdown = computed(() => {
  if (!activeSubFile.value) return '';
  const ext = (activeSubFile.value.name.split('.').pop() || '').toLowerCase();
  if (ext === 'md' || ext === 'markdown') {
    return renderMarkdown(subFileText.value);
  }
  return '';
});

// Single sub-file category getters
const isSubFileImage = computed(() => {
  if (!activeSubFile.value) return false;
  const mime = getArchiveFileMime(activeSubFile.value.name);
  const ext = (activeSubFile.value.name.split('.').pop() || '').toLowerCase();
  return mime.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif'].includes(ext);
});

const isSubFileVideo = computed(() => {
  if (!activeSubFile.value) return false;
  const mime = getArchiveFileMime(activeSubFile.value.name);
  const ext = (activeSubFile.value.name.split('.').pop() || '').toLowerCase();
  return mime.startsWith('video/') || ['mp4', 'webm', 'mov', 'mkv', 'avi'].includes(ext);
});

const isSubFileAudio = computed(() => {
  if (!activeSubFile.value) return false;
  const mime = getArchiveFileMime(activeSubFile.value.name);
  const ext = (activeSubFile.value.name.split('.').pop() || '').toLowerCase();
  return mime.startsWith('audio/') || ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac'].includes(ext);
});

const isSubFilePdf = computed(() => {
  if (!activeSubFile.value) return false;
  const ext = (activeSubFile.value.name.split('.').pop() || '').toLowerCase();
  return ext === 'pdf';
});

const isSubFileMarkdown = computed(() => {
  if (!activeSubFile.value) return false;
  const ext = (activeSubFile.value.name.split('.').pop() || '').toLowerCase();
  return ext === 'md' || ext === 'markdown';
});

// Batch Extract to Cloud Drive
const extractAllToDrive = async () => {
  const totalItems = flatFiles.value.length + flatFolders.value.length;
  if (totalItems === 0) {
    alert('压缩包中没有可解压的文件或文件夹');
    return;
  }

  const promptText = flatFiles.value.length > 0 && flatFolders.value.length > 0
    ? `确定要将压缩包中的 ${flatFolders.value.length} 个文件夹和 ${flatFiles.value.length} 个文件解压并保存到当前网盘目录吗？`
    : (flatFiles.value.length > 0
      ? `确定要将压缩包中的 ${flatFiles.value.length} 个文件解压并保存到当前网盘目录吗？`
      : `确定要将压缩包中的 ${flatFolders.value.length} 个文件夹解压并保存到当前网盘目录吗？`);

  if (!confirm(promptText)) {
    return;
  }

  isExtracting.value = true;
  extractTotalCount.value = totalItems;
  extractCurrentIndex.value = 0;

  try {
    const createdFolderIds = new Map(); // folderPath -> folderId
    createdFolderIds.set('', props.currentFolderId || null);

    // 1. 递归创建所有层级的文件夹（包括三层等任意深度的空文件夹）
    for (const folderPath of flatFolders.value) {
      extractCurrentIndex.value++;
      const segments = folderPath.split('/').filter(Boolean);
      const folderName = segments[segments.length - 1];
      extractCurrentFileName.value = `📁 ${folderName}/`;

      let currentParentId = props.currentFolderId || null;
      let pathAccumulator = '';

      for (const seg of segments) {
        pathAccumulator = pathAccumulator ? `${pathAccumulator}/${seg}` : seg;
        if (createdFolderIds.has(pathAccumulator)) {
          currentParentId = createdFolderIds.get(pathAccumulator);
        } else {
          try {
            const folderRes = await apiFetch('/api/drive/files/folder', {
              method: 'POST',
              body: JSON.stringify({ name: seg, parentId: currentParentId, getOrCreate: true })
            });
            if (folderRes?.folder?.id) {
              currentParentId = folderRes.folder.id;
              createdFolderIds.set(pathAccumulator, currentParentId);
            }
          } catch {
            // Folder might already exist, continue
          }
        }
      }
    }

    let successCount = 0;
    let failCount = 0;

    // 2. 依次上传所有子文件并调用 confirm-upload 激活
    for (let i = 0; i < flatFiles.value.length; i++) {
      const fileItem = flatFiles.value[i];
      extractCurrentIndex.value = flatFolders.value.length + i + 1;
      extractCurrentFileName.value = `📄 ${fileItem.name}`;

      const segments = fileItem.path.split('/').filter(Boolean);
      segments.pop(); // Remove filename to get folder path
      const folderPath = segments.join('/');
      const targetParentId = createdFolderIds.get(folderPath) ?? (props.currentFolderId || null);

      const mime = getArchiveFileMime(fileItem.name);
      const blob = new Blob([fileItem.data], { type: mime });
      const fileObj = new File([blob], fileItem.name, { type: mime });

      try {
        // Step A: 获取上传凭证与目标上传地址
        const ticket = await apiFetch('/api/drive/files/upload-ticket', {
          method: 'POST',
          body: JSON.stringify({
            name: fileItem.name,
            size: fileItem.size,
            mimeType: mime,
            parentId: targetParentId
          })
        });

        // Step B: 二进制直传文件
        let gdriveFileId = null;
        await new Promise((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          const uploadTargetUrl = ticket.directWorkerUpload && ticket.uploadUrl.startsWith('/api')
            ? `${api.getBasePrefix()}${ticket.uploadUrl}`
            : ticket.uploadUrl;
          xhr.open(ticket.method || 'PUT', uploadTargetUrl);

          if (ticket.headers) {
            Object.entries(ticket.headers).forEach(([k, v]) => {
              xhr.setRequestHeader(k, v);
            });
          }

          if (ticket.directWorkerUpload) {
            const token = getAuthToken();
            if (token) {
              xhr.setRequestHeader('Authorization', `Bearer ${token}`);
            }
          }

          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              try {
                const resJson = JSON.parse(xhr.responseText);
                if (ticket.backend === 'gdrive' && resJson?.id) {
                  gdriveFileId = resJson.id;
                }
              } catch {
                // Non-JSON response is expected for R2 / S3
              }
              resolve();
            } else {
              reject(new Error(`上传失败: HTTP ${xhr.status}`));
            }
          };
          xhr.onerror = () => reject(new Error('网络错误，上传中断'));
          xhr.send(fileObj);
        });

        // Step C: 确认上传使文件状态生效为 active
        await apiFetch('/api/drive/files/confirm', {
          method: 'POST',
          body: JSON.stringify({
            fileId: ticket.fileId,
            actualSize: fileItem.size,
            hash: '',
            gdriveFileId
          })
        });
        successCount++;
      } catch (uploadErr) {
        failCount++;
        console.warn(`Upload subfile ${fileItem.name} failed:`, uploadErr);
      }
    }

    const folderTip = flatFolders.value.length ? `${flatFolders.value.length} 个文件夹、` : '';
    if (failCount === 0) {
      alert(`🎉 解压完成！共 ${folderTip}${flatFiles.value.length} 个文件已成功保存至您的网盘。`);
    } else if (successCount > 0) {
      alert(`⚠️ 解压部分完成：共 ${folderTip}${successCount} 个文件成功保存，${failCount} 个文件上传失败。`);
    } else if (flatFiles.value.length > 0) {
      alert(`❌ 解压失败：${failCount} 个文件上传均失败，请检查网络连接或重新登录。`);
    } else {
      alert(`🎉 解压完成！共创建了 ${flatFolders.value.length} 个文件夹。`);
    }
    emit('extract-done');
  } catch (err) {
    alert(`解压写入失败: ${err.message || '未知错误'}`);
  } finally {
    isExtracting.value = false;
  }
};

onMounted(() => {
  loadArchive();
});

onUnmounted(() => {
  if (subFileBlobUrl.value) {
    URL.revokeObjectURL(subFileBlobUrl.value);
  }
});
</script>

<template>
  <div class="archive-viewer-root">
    <!-- 1. LOADING STATE -->
    <div v-if="isLoading" class="archive-loading-state">
      <div class="spinner"></div>
      <span class="loading-title">{{ loadingText }}</span>
      <span class="loading-subtitle">纯客户端本地极速解压，不占用服务端算力</span>
    </div>

    <!-- 2. ERROR STATE -->
    <div v-else-if="parseError" class="archive-error-state">
      <span class="error-icon">⚠️</span>
      <h4 class="error-title">无法在线读取此压缩包</h4>
      <p class="error-desc">{{ parseError }}</p>
      <div class="error-actions">
        <a :href="downloadUrl" :download="file.name" class="btn-primary">
          ⬇️ 直接下载压缩包到本地
        </a>
      </div>
    </div>

    <!-- 3. SUB-FILE IN-PLACE PREVIEW -->
    <div v-else-if="activeSubFile" class="subfile-preview-layout">
      <div class="subfile-header">
        <button type="button" class="btn-back" @click="closeSubFilePreview">
          ⬅️ 返回压缩包目录
        </button>
        <div class="subfile-meta">
          <span class="subfile-icon">{{ getArchiveItemIcon(activeSubFile) }}</span>
          <span class="subfile-name" :title="activeSubFile.path">{{ activeSubFile.path }}</span>
          <span class="subfile-size">({{ formatBytes(activeSubFile.size) }})</span>
        </div>
        <div class="subfile-actions">
          <button type="button" class="btn-secondary" @click="handleDownloadSubFile(activeSubFile)">
            ⬇️ 单独提取下载
          </button>
        </div>
      </div>

      <div class="subfile-body">
        <!-- Sub-image -->
        <div v-if="isSubFileImage" class="subfile-media-view">
          <img :src="subFileBlobUrl" class="subfile-img" :alt="activeSubFile.name" />
        </div>

        <!-- Sub-video -->
        <div v-else-if="isSubFileVideo" class="subfile-media-view">
          <video :src="subFileBlobUrl" controls autoplay class="subfile-video" :aria-label="`视频预览：${activeSubFile.name}`"></video>
        </div>

        <!-- Sub-audio -->
        <div v-else-if="isSubFileAudio" class="subfile-media-view">
          <audio :src="subFileBlobUrl" controls autoplay class="subfile-audio" :aria-label="`音频预览：${activeSubFile.name}`"></audio>
        </div>

        <!-- Sub-pdf -->
        <div v-else-if="isSubFilePdf" class="subfile-pdf-view">
          <iframe :src="subFileBlobUrl" class="subfile-pdf-frame" title="PDF Preview"></iframe>
        </div>

        <!-- Sub-markdown -->
        <div v-else-if="isSubFileMarkdown" class="subfile-markdown-view">
          <div class="markdown-body" v-html="renderedSubFileMarkdown"></div>
        </div>

        <!-- Sub-code / plain text -->
        <div v-else class="subfile-text-view">
          <pre class="code-content"><code>{{ subFileText }}</code></pre>
        </div>
      </div>
    </div>

    <!-- 4. MAIN ARCHIVE TREE VIEW -->
    <div v-else class="archive-tree-layout">
      <!-- Top Control Bar -->
      <div class="archive-toolbar">
        <div class="toolbar-info">
          <span class="archive-badge">📦 压缩文件</span>
          <span v-if="flatFolders.length > 0" class="archive-stat">含 <strong>{{ flatFolders.length }}</strong> 个文件夹</span>
          <span v-if="flatFolders.length > 0" class="archive-stat-sep">·</span>
          <span class="archive-stat">含 <strong>{{ flatFiles.length }}</strong> 个文件</span>
          <span class="archive-stat-sep">·</span>
          <span class="archive-stat">解压总大小 <strong>{{ formatBytes(fileTree?.totalSize || 0) }}</strong></span>
        </div>

        <div class="toolbar-actions">
          <input
            v-model="searchQuery"
            type="text"
            placeholder="🔍 搜索包内文件..."
            class="archive-search-input"
          />
          <button type="button"
            class="btn-extract-all"
            :disabled="isExtracting"
            @click="extractAllToDrive"
          >
            {{ isExtracting ? `正在解压 (${extractCurrentIndex}/${extractTotalCount})...` : '📤 解压到当前网盘' }}
          </button>
          <a
            :href="downloadUrl"
            :download="file.name"
            class="btn-download-all"
            title="下载整个压缩文件"
          >
            ⬇️ 下载压缩包
          </a>
        </div>
      </div>

      <!-- Batch Extract Progress Banner -->
      <div v-if="isExtracting" class="extract-progress-banner">
        <div class="progress-bar-bg">
          <div
            class="progress-bar-fill"
            :style="{ width: `${Math.round((extractCurrentIndex / Math.max(1, extractTotalCount)) * 100)}%` }"
          ></div>
        </div>
        <div class="progress-info">
          <span>正在解压写入云盘: {{ extractCurrentFileName }}</span>
          <span>{{ extractCurrentIndex }} / {{ extractTotalCount }} ({{ Math.round((extractCurrentIndex / Math.max(1, extractTotalCount)) * 100) }}%)</span>
        </div>
      </div>

      <!-- Search Results View -->
      <div v-if="searchQuery.trim()" class="archive-list-container">
        <div v-if="filteredFiles.length === 0" class="empty-search">
          <span>未找到匹配「{{ searchQuery }}」的文件</span>
        </div>
        <div v-else class="archive-file-list">
          <div
            v-for="item in filteredFiles"
            :key="item.path"
            class="archive-row is-file"
            @click="openSubFilePreview(item)"
          >
            <span class="item-icon">{{ getArchiveItemIcon(item) }}</span>
            <div class="item-details">
              <span class="item-name">{{ item.name }}</span>
              <span class="item-subpath">{{ item.path }}</span>
            </div>
            <span class="item-size">{{ formatBytes(item.size) }}</span>
            <button type="button"
              class="btn-row-action"
              title="单独下载此文件"
              @click.stop="handleDownloadSubFile(item)"
            >
              ⬇️
            </button>
          </div>
        </div>
      </div>

      <!-- Hierarchical Tree View -->
      <div v-else class="archive-list-container">
        <div class="tree-root-box">
          <RecursiveTree
            :node="fileTree"
            :expanded-folders="expandedFolders"
            @toggle-folder="toggleFolder"
            @select-file="openSubFilePreview"
            @download-file="handleDownloadSubFile"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<script>
// Inline Recursive Sub-component for clean Tree rendering
import { defineComponent, h } from 'vue';

const RecursiveTree = defineComponent({
  name: 'RecursiveTree',
  props: ['node', 'expandedFolders'],
  emits: ['toggle-folder', 'select-file', 'download-file'],
  setup(props, { emit }) {
    return () => {
      if (!props.node?.children) return null;

      return h('div', { class: 'tree-nodes-list' }, props.node.children.map((child) => {
        if (child.isFolder) {
          const isExpanded = props.expandedFolders.has(child.path);
          return h('div', { key: child.path, class: 'tree-folder-group' }, [
            h('div', {
              class: ['archive-row is-folder', isExpanded ? 'is-open' : ''],
              onClick: () => emit('toggle-folder', child.path)
            }, [
              h('span', { class: 'folder-arrow' }, isExpanded ? '▼' : '▶'),
              h('span', { class: 'item-icon' }, isExpanded ? '📂' : '📁'),
              h('span', { class: 'item-name' }, child.name),
              h('span', { class: 'folder-badge' }, `${child.children?.length || 0} 项`)
            ]),
            isExpanded ? h('div', { class: 'tree-children-container' }, [
              h(RecursiveTree, {
                node: child,
                expandedFolders: props.expandedFolders,
                onToggleFolder: (p) => emit('toggle-folder', p),
                onSelectFile: (f) => emit('select-file', f),
                onDownloadFile: (f) => emit('download-file', f)
              })
            ]) : null
          ]);
        } else {
          return h('div', {
            key: child.path,
            class: 'archive-row is-file',
            onClick: () => emit('select-file', child)
          }, [
            h('span', { class: 'item-icon' }, getArchiveItemIcon(child)),
            h('span', { class: 'item-name' }, child.name),
            h('span', { class: 'item-size' }, formatBytes(child.size)),
            h('button', {
              class: 'btn-row-action',
              title: '单独提取下载',
              onClick: (e) => {
                e.stopPropagation();
                emit('download-file', child);
              }
            }, '⬇️')
          ]);
        }
      }));
    };
  }
});
</script>

<style scoped>
.archive-viewer-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
  background: var(--surface, #ffffff);
  color: var(--text, #0f172a);
  overflow: hidden;
}

.archive-loading-state,
.archive-error-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: 12px;
  padding: 40px 20px;
  text-align: center;
}

.loading-title {
  font-size: 1.05rem;
  font-weight: 600;
  color: var(--text, #0f172a);
}

.loading-subtitle {
  font-size: 0.84rem;
  color: var(--text-secondary, #64748b);
}

.error-icon {
  font-size: 3rem;
}

.error-title {
  font-size: 1.15rem;
  margin: 0;
  color: var(--text, #0f172a);
}

.error-desc {
  font-size: 0.88rem;
  color: var(--text-secondary, #64748b);
  max-width: 480px;
  margin: 0;
}

/* Tree Layout */
.archive-tree-layout {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.archive-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  border-bottom: 1px solid var(--border, #e2e8f0);
  background: var(--surface-2, #f8fafc);
  gap: 12px;
  flex-wrap: wrap;
}

.toolbar-info {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.86rem;
}

.archive-badge {
  background: rgba(56, 189, 248, 0.15);
  color: #0284c7;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 6px;
  font-size: 0.78rem;
}

.archive-stat-sep {
  color: var(--border, #cbd5e1);
}

.toolbar-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.archive-search-input {
  padding: 6px 12px;
  border: 1px solid var(--border, #cbd5e1);
  border-radius: 8px;
  font-size: 0.84rem;
  background: var(--surface, #ffffff);
  color: var(--text, #0f172a);
  outline: none;
  min-width: 160px;
}

.archive-search-input:focus {
  border-color: #38bdf8;
}

.btn-extract-all {
  background: #0284c7;
  color: #ffffff;
  border: none;
  padding: 6px 12px;
  border-radius: 8px;
  font-size: 0.84rem;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s ease;
  white-space: nowrap;
}

.btn-extract-all:hover:not(:disabled) {
  background: #0369a1;
}

.btn-extract-all:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn-download-all {
  background: var(--surface, #ffffff);
  border: 1px solid var(--border, #cbd5e1);
  color: var(--text, #334155);
  padding: 6px 12px;
  border-radius: 8px;
  font-size: 0.84rem;
  font-weight: 500;
  text-decoration: none;
  display: inline-flex;
  align-items: center;
  transition: all 0.15s ease;
  white-space: nowrap;
}

.btn-download-all:hover {
  background: var(--surface-3, #e2e8f0);
}

/* Extract Progress */
.extract-progress-banner {
  padding: 8px 16px;
  background: #f0f9ff;
  border-bottom: 1px solid #bae6fd;
}

.progress-bar-bg {
  height: 6px;
  background: #e0f2fe;
  border-radius: 4px;
  overflow: hidden;
  margin-bottom: 4px;
}

.progress-bar-fill {
  height: 100%;
  background: #0284c7;
  transition: width 0.15s ease;
}

.progress-info {
  display: flex;
  justify-content: space-between;
  font-size: 0.75rem;
  color: #0369a1;
}

/* List & Tree Rows */
.archive-list-container {
  flex: 1;
  overflow-y: auto;
  padding: 10px 16px;
}

:deep(.archive-row) {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.12s ease;
  user-select: none;
  font-size: 0.88rem;
}

:deep(.archive-row:hover) {
  background: var(--surface-2, #f1f5f9);
}

:deep(.archive-row.is-file) {
  padding-left: 28px;
}

:deep(.folder-arrow) {
  font-size: 0.65rem;
  color: var(--text-secondary, #94a3b8);
  width: 14px;
}

:deep(.item-icon) {
  font-size: 1.15rem;
  flex-shrink: 0;
}

:deep(.item-name) {
  font-weight: 500;
  color: var(--text, #0f172a);
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

:deep(.folder-badge) {
  font-size: 0.72rem;
  color: var(--text-secondary, #94a3b8);
  background: var(--surface-2, #f1f5f9);
  padding: 1px 6px;
  border-radius: 4px;
}

:deep(.item-size) {
  font-size: 0.76rem;
  color: var(--text-secondary, #64748b);
  margin-right: 6px;
}

:deep(.btn-row-action) {
  background: transparent;
  border: none;
  cursor: pointer;
  font-size: 0.88rem;
  padding: 2px 6px;
  border-radius: 4px;
  opacity: 0.6;
  transition: all 0.12s ease;
}

:deep(.btn-row-action:hover) {
  opacity: 1;
  background: var(--surface-3, #e2e8f0);
}

:deep(.tree-children-container) {
  padding-left: 20px;
  border-left: 1px dashed var(--border, #e2e8f0);
  margin-left: 16px;
}

.item-details {
  display: flex;
  flex-direction: column;
  flex: 1;
  overflow: hidden;
}

.item-subpath {
  font-size: 0.72rem;
  color: var(--text-secondary, #94a3b8);
}

/* Sub-file In-place Preview */
.subfile-preview-layout {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.subfile-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  background: var(--surface-2, #f8fafc);
  border-bottom: 1px solid var(--border, #e2e8f0);
  gap: 12px;
}

.btn-back {
  background: var(--surface, #ffffff);
  border: 1px solid var(--border, #cbd5e1);
  padding: 6px 12px;
  border-radius: 8px;
  font-size: 0.82rem;
  cursor: pointer;
  transition: all 0.15s ease;
}

.btn-back:hover {
  background: var(--surface-3, #e2e8f0);
}

.subfile-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  overflow: hidden;
}

.subfile-name {
  font-size: 0.88rem;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.subfile-size {
  font-size: 0.78rem;
  color: var(--text-secondary, #64748b);
}

.subfile-body {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-body, #f8fafc);
}

.subfile-media-view {
  max-width: 100%;
  max-height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.subfile-img {
  max-width: 100%;
  max-height: 70vh;
  object-fit: contain;
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.1);
}

.subfile-video {
  max-width: 100%;
  max-height: 70vh;
  border-radius: 8px;
}

.subfile-audio {
  width: 320px;
}

.subfile-pdf-view {
  width: 100%;
  height: 100%;
}

.subfile-pdf-frame {
  width: 100%;
  height: 70vh;
  border: none;
  border-radius: 8px;
}

.subfile-markdown-view,
.subfile-text-view {
  width: 100%;
  height: 100%;
  overflow-y: auto;
  background: var(--surface, #ffffff);
  padding: 16px;
  border-radius: 8px;
  border: 1px solid var(--border, #e2e8f0);
}

.code-content {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.85rem;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-all;
  margin: 0;
}
</style>
