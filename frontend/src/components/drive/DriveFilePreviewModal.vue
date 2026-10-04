<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import api, { apiFetch } from '../../api.js';
import { formatBytes } from '../../composables/useCloudDrive.js';
import { renderMarkdown } from '../../markdown.js';
import { registerBackHandler } from '../../back-navigation.js';
import DriveArchiveViewer from './DriveArchiveViewer.vue';

const props = defineProps({
  file: {
    type: Object,
    required: true
  },
  fileUrl: {
    type: String,
    default: ''
  },
  downloadUrl: {
    type: String,
    default: ''
  },
  onClose: {
    type: Function,
    required: true
  },
  onShare: {
    type: Function,
    default: null
  },
  currentFolderId: {
    type: [String, Number, null],
    default: null
  }
});

const emit = defineEmits(['extract-done', 'close']);

// Format Category
const ext = computed(() => (props.file.name?.split('.').pop() || '').toLowerCase());
const mime = computed(() => props.file.mime_type || '');

const isImage = computed(() => {
  return mime.value.startsWith('image/') ||
    ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif'].includes(ext.value);
});

const isVideo = computed(() => {
  return mime.value.startsWith('video/') ||
    ['mp4', 'webm', 'mov', 'mkv', 'ogg', 'avi'].includes(ext.value);
});

const isAudio = computed(() => {
  return mime.value.startsWith('audio/') ||
    ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac'].includes(ext.value);
});

const isPdf = computed(() => {
  return ext.value === 'pdf' || mime.value.includes('pdf');
});

const isMarkdown = computed(() => {
  return ['md', 'markdown'].includes(ext.value);
});

const isCsv = computed(() => {
  return ['csv', 'tsv'].includes(ext.value);
});

const isTextOrCode = computed(() => {
  if (isImage.value || isVideo.value || isAudio.value || isPdf.value) return false;
  return mime.value.startsWith('text/') ||
    isMarkdown.value ||
    isCsv.value ||
    ['txt', 'json', 'js', 'ts', 'jsx', 'tsx', 'vue', 'html', 'htm', 'css', 'scss', 'less',
     'py', 'sql', 'sh', 'bash', 'go', 'rs', 'java', 'c', 'cpp', 'h', 'hpp', 'cs', 'php',
     'rb', 'xml', 'yaml', 'yml', 'toml', 'ini', 'env', 'log', 'gitignore'].includes(ext.value);
});

const isOffice = computed(() => {
  return ['docx', 'doc', 'xlsx', 'xls', 'pptx', 'ppt'].includes(ext.value);
});

const isOnlineArchive = computed(() => {
  return ['zip', 'tar', 'gz', 'tgz'].includes(ext.value) ||
    mime.value.includes('zip') || mime.value.includes('tar') || mime.value.includes('gzip');
});

const isProprietaryArchive = computed(() => {
  return ['7z', 'rar', 'bz2', 'xz'].includes(ext.value);
});

// Image viewer state (zoom & rotation)
const imageScale = ref(1);
const imageRotation = ref(0);

const zoomIn = () => { imageScale.value = Math.min(imageScale.value + 0.25, 4); };
const zoomOut = () => { imageScale.value = Math.max(imageScale.value - 0.25, 0.25); };
const rotateImage = () => { imageRotation.value = (imageRotation.value + 90) % 360; };
const resetImage = () => { imageScale.value = 1; imageRotation.value = 0; };

// Text/Code state
const textContent = ref('');
const isTextLoading = ref(false);
const textError = ref('');
const markdownMode = ref('rendered'); // 'rendered' | 'raw'
const wrapLines = ref(true);
const isCopied = ref(false);

// Edit state
const isEditing = ref(false);
const editableContent = ref('');
const isSaving = ref(false);
const hasUnsavedChanges = computed(() => isEditing.value && editableContent.value !== textContent.value);

// CSV state
const csvHeaders = ref([]);
const csvRows = ref([]);

const viewUrl = computed(() => {
  if (props.fileUrl) return props.fileUrl;
  return props.file?.id ? api.getDriveFileUrl(props.file.id, true) : '';
});

const directDownloadUrl = computed(() => {
  if (props.downloadUrl) return props.downloadUrl;
  return props.file?.id ? api.getDriveFileUrl(props.file.id, false) : '';
});

const parseCsvData = (text, delimiter = ',') => {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length === 0) return;
  const parseLine = (line) => {
    const row = [];
    let inQuotes = false;
    let cur = '';
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        inQuotes = !inQuotes;
      } else if (c === delimiter && !inQuotes) {
        row.push(cur.trim());
      } else {
        cur += c;
      }
    }
    row.push(cur.trim());
    return row;
  };
  csvHeaders.value = parseLine(lines[0]);
  csvRows.value = lines.slice(1, 101).map(parseLine);
};

const loadFileContent = async () => {
  if (!isTextOrCode.value) return;
  isTextLoading.value = true;
  textError.value = '';
  try {
    const url = viewUrl.value;
    if (!url) throw new Error('未找到文件链接');
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`加载文件失败 (${res.status})`);
    }
    const text = await res.text();
    textContent.value = text;
    editableContent.value = text;
    if (isCsv.value) {
      parseCsvData(text, ext.value === 'tsv' ? '\t' : ',');
    }
  } catch (err) {
    textError.value = err.message || '无法读取文件内容';
  } finally {
    isTextLoading.value = false;
  }
};

const renderedMarkdownHtml = computed(() => {
  const source = isEditing.value ? editableContent.value : textContent.value;
  if (!isMarkdown.value || !source) return '';
  return renderMarkdown(source);
});

const textLineList = computed(() => {
  const source = isEditing.value ? editableContent.value : textContent.value;
  if (!source) return [];
  return source.split('\n');
});

const startEditing = () => {
  editableContent.value = textContent.value;
  isEditing.value = true;
};

const cancelEditing = () => {
  if (hasUnsavedChanges.value && !confirm('您有未保存的更改，确定要放弃吗？')) {
    return;
  }
  editableContent.value = textContent.value;
  isEditing.value = false;
};

const handleSaveContent = async () => {
  if (!props.file?.id) return;
  isSaving.value = true;
  try {
    await apiFetch(`/api/drive/files/${encodeURIComponent(props.file.id)}/content`, {
      method: 'PUT',
      body: JSON.stringify({ content: editableContent.value })
    });
    textContent.value = editableContent.value;
    isEditing.value = false;
    props.file.size = new TextEncoder().encode(editableContent.value).byteLength;
    alert('文件已成功保存至云盘！');
  } catch (err) {
    alert(`保存失败: ${err.message || '未知错误'}`);
  } finally {
    isSaving.value = false;
  }
};

const handleCopyText = async () => {
  const source = isEditing.value ? editableContent.value : textContent.value;
  if (!source) return;
  try {
    await navigator.clipboard.writeText(source);
    isCopied.value = true;
    setTimeout(() => { isCopied.value = false; }, 2000);
  } catch {
    alert('复制失败');
  }
};

const handleDownload = async () => {
  if (!props.file?.id) return;
  const downloadUrl = await api.ensureDriveFileUrl(props.file.id, false);
  const a = document.createElement('a');
  a.href = downloadUrl;
  a.download = props.file.name || 'download';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
};

const handleSafeClose = () => {
  if (hasUnsavedChanges.value && !confirm('您有未保存的代码修改，确定要关闭吗？')) {
    return;
  }
  props.onClose();
};

const handleKeydown = (e) => {
  if (e.key === 'Escape') {
    handleSafeClose();
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    if (isEditing.value) {
      e.preventDefault();
      void handleSaveContent();
    }
  }
};

let unregisterPreviewBack = null;

onMounted(() => {
  unregisterPreviewBack = registerBackHandler(110, () => {
    handleSafeClose();
    return true;
  });
  window.addEventListener('keydown', handleKeydown);
  loadFileContent();
});

onUnmounted(() => {
  if (unregisterPreviewBack) {
    unregisterPreviewBack();
    unregisterPreviewBack = null;
  }
  window.removeEventListener('keydown', handleKeydown);
});

watch(() => props.file.id, () => {
  resetImage();
  isEditing.value = false;
  loadFileContent();
});

const fileIcon = computed(() => {
  if (isImage.value) return '🖼️';
  if (isVideo.value) return '🎬';
  if (isAudio.value) return '🎵';
  if (isPdf.value) return '📕';
  if (isMarkdown.value) return '📖';
  if (isCsv.value) return '📊';
  if (isOffice.value) return '📑';
  if (isOnlineArchive.value || isProprietaryArchive.value) return '📦';
  if (isTextOrCode.value) return '📝';
  return '📄';
});
</script>

<template>
  <div class="preview-backdrop" @click.self="handleSafeClose">
    <div class="preview-modal" :class="{ 'is-editing-modal': isEditing }">
      <!-- HEADER TOOLBAR -->
      <header class="preview-header">
        <div class="preview-meta">
          <button
            type="button"
            class="preview-back-btn"
            title="返回并关闭预览"
            aria-label="返回并关闭预览"
            @click="handleSafeClose"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label="返回">
              <title>返回</title>
              <line x1="19" y1="12" x2="5" y2="12"></line>
              <polyline points="12 19 5 12 12 5"></polyline>
            </svg>
          </button>
          <span class="preview-icon">{{ fileIcon }}</span>
          <div class="preview-title-box">
            <h3 class="preview-title" :title="file.name">
              {{ file.name }}
              <span v-if="hasUnsavedChanges" class="unsaved-badge" title="有未保存修改">*</span>
            </h3>
            <span class="preview-filesize">{{ formatBytes(file.size) }}</span>
          </div>
        </div>

        <div class="preview-actions">
          <!-- Text/Code Editing and Mode Controls -->
          <template v-if="isTextOrCode && !isCsv">
            <template v-if="!isEditing">
              <button type="button"
                class="action-btn-pill"
                title="在线编辑文件"
                @click="startEditing"
              >
                ✏️ 在线编辑
              </button>
            </template>
            <template v-else>
              <button type="button"
                class="action-btn-pill is-save"
                :disabled="isSaving"
                title="保存修改至云盘 (Ctrl+S)"
                @click="handleSaveContent"
              >
                💾 {{ isSaving ? '保存中...' : '保存更改' }}
              </button>
              <button type="button"
                class="action-btn-pill is-cancel"
                title="取消编辑"
                @click="cancelEditing"
              >
                ✖ 取消
              </button>
            </template>
          </template>

          <template v-if="isMarkdown && !isEditing">
            <div class="mode-switch-group">
              <button type="button"
                class="mode-btn"
                :class="{ active: markdownMode === 'rendered' }"
                @click="markdownMode = 'rendered'"
              >
                📖 排版
              </button>
              <button type="button"
                class="mode-btn"
                :class="{ active: markdownMode === 'raw' }"
                @click="markdownMode = 'raw'"
              >
                💻 源码
              </button>
            </div>
          </template>

          <button type="button"
            v-if="isTextOrCode && !isEditing"
            class="action-icon-btn"
            :title="wrapLines ? '取消换行' : '自动换行'"
            @click="wrapLines = !wrapLines"
          >
            ↩️
          </button>

          <button type="button"
            v-if="isTextOrCode"
            class="action-icon-btn"
            title="复制全部内容"
            @click="handleCopyText"
          >
            {{ isCopied ? '已复制 ✓' : '📋' }}
          </button>

          <!-- Image Viewer Controls -->
          <template v-if="isImage">
            <button type="button" class="action-icon-btn" title="放大" @click="zoomIn">🔍+</button>
            <button type="button" class="action-icon-btn" title="缩小" @click="zoomOut">🔍-</button>
            <button type="button" class="action-icon-btn" title="顺时针旋转90°" @click="rotateImage">🔄</button>
            <button type="button" class="action-icon-btn" title="重置大小" @click="resetImage">1:1</button>
          </template>

          <!-- Share button if provided -->
          <button type="button"
            v-if="onShare && !isEditing"
            class="action-icon-btn"
            title="分享文件"
            @click="onShare(file)"
          >
            🔗
          </button>

          <!-- Download button -->
          <button type="button" class="action-icon-btn preview-download-btn" title="下载文件" @click="handleDownload">
            ⬇️
          </button>
        </div>

        <!-- Close button -->
        <button type="button" class="preview-close-btn" title="关闭 (Esc)" aria-label="关闭预览" @click="handleSafeClose">×</button>
      </header>

      <!-- BODY CONTENT AREA -->
      <main class="preview-body">
        <!-- 1. IMAGE PREVIEW -->
        <div v-if="isImage" class="preview-image-container">
          <img
            :src="viewUrl"
            :alt="file.name"
            class="preview-img"
            :style="{
              transform: `scale(${imageScale}) rotate(${imageRotation}deg)`,
              transition: 'transform 0.2s ease-out'
            }"
          />
        </div>

        <!-- 2. VIDEO PREVIEW -->
        <div v-else-if="isVideo" class="preview-media-container">
          <video
            :src="viewUrl"
            controls
            autoplay
            class="preview-video"
            :aria-label="`视频预览：${file.name}`"
          >
            您的浏览器不支持视频播放。
          </video>
        </div>

        <!-- 3. AUDIO PREVIEW -->
        <div v-else-if="isAudio" class="preview-audio-container">
          <div class="audio-card">
            <span class="audio-card-icon">🎵</span>
            <span class="audio-card-name">{{ file.name }}</span>
            <audio
              :src="viewUrl"
              controls
              autoplay
              class="preview-audio-player"
              :aria-label="`音频预览：${file.name}`"
            ></audio>
          </div>
        </div>

        <!-- 4. PDF PREVIEW -->
        <div v-else-if="isPdf" class="preview-pdf-container">
          <iframe
            :src="viewUrl"
            class="preview-pdf-frame"
            title="PDF Preview"
          ></iframe>
        </div>

        <!-- 5. CSV / TSV PREVIEW -->
        <div v-else-if="isCsv" class="preview-csv-container">
          <div v-if="isTextLoading" class="preview-loading">
            <div class="spinner"></div>
            <span>正在解析表格数据...</span>
          </div>
          <div v-else-if="textError" class="preview-error">
            <span>{{ textError }}</span>
          </div>
          <div v-else class="csv-table-wrapper">
            <table class="csv-table">
              <thead>
                <tr>
                  <th class="csv-index-col">#</th>
                  <th v-for="(h, idx) in csvHeaders" :key="idx">{{ h }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(row, rIdx) in csvRows" :key="rIdx">
                  <td class="csv-index-col">{{ rIdx + 1 }}</td>
                  <td v-for="(cell, cIdx) in row" :key="cIdx">{{ cell }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- 6. MARKDOWN & CODE / TEXT PREVIEW & EDITING -->
        <div v-else-if="isTextOrCode" class="preview-text-container">
          <div v-if="isTextLoading" class="preview-loading">
            <div class="spinner"></div>
            <span>正在读取文件内容...</span>
          </div>
          <div v-else-if="textError" class="preview-error">
            <span>{{ textError }}</span>
          </div>

          <!-- Edit Mode (Dual pane for Markdown or Full Monospace Editor) -->
          <div v-else-if="isEditing" class="editor-container" :class="{ 'is-split-layout': isMarkdown }">
            <div class="editor-pane">
              <div class="editor-pane-header">
                <span class="editor-hint">✏️ 编辑代码/文本 (按 Ctrl+S 快速保存)</span>
              </div>
              <textarea
                v-model="editableContent"
                class="editor-textarea"
                placeholder="输入文本内容..."
                spellcheck="false"
              ></textarea>
            </div>
            <div v-if="isMarkdown" class="editor-live-preview">
              <div class="editor-pane-header">
                <span class="editor-hint">👁️ 实时排版预览</span>
              </div>
              <div class="markdown-preview-wrap">
                <div class="markdown-body" v-html="renderedMarkdownHtml"></div>
              </div>
            </div>
          </div>

          <!-- Markdown Read-only rendered view -->
          <div
            v-else-if="isMarkdown && markdownMode === 'rendered'"
            class="markdown-preview-wrap"
          >
            <div class="markdown-body" v-html="renderedMarkdownHtml"></div>
          </div>

          <!-- Plain code / text Read-only view with line numbers -->
          <div
            v-else
            class="code-viewer-wrap"
            :class="{ 'wrap-lines': wrapLines }"
          >
            <div class="line-numbers">
              <span v-for="(_, index) in textLineList" :key="index">{{ index + 1 }}</span>
            </div>
            <pre class="code-content"><code>{{ textContent }}</code></pre>
          </div>
        </div>

        <!-- 7. OFFICE DOCUMENT PREVIEW FALLBACK CARD -->
        <div v-else-if="isOffice" class="preview-fallback-container">
          <div class="fallback-card">
            <span class="fallback-icon">📑</span>
            <h4 class="fallback-title">{{ file.name }}</h4>
            <p class="fallback-desc">Microsoft Office 文档 ({{ ext.toUpperCase() }})，文件大小 {{ formatBytes(file.size) }}</p>
            <div class="fallback-actions">
              <button type="button" class="btn-primary" @click="handleDownload">
                ⬇️ 下载文件
              </button>
            </div>
          </div>
        </div>

        <!-- 8. ARCHIVE VIEWER (PURE CLIENT-SIDE ZIP/TAR/GZ PARSER & EXTRACTOR) -->
        <div v-else-if="isOnlineArchive" class="preview-archive-container">
          <DriveArchiveViewer
            :file="file"
            :file-url="viewUrl"
            :current-folder-id="file.parent_id"
            @extract-done="() => { emit('extract-done'); props.onClose(); }"
          />
        </div>

        <!-- 9. PROPRIETARY ARCHIVE (7Z / RAR / BZ2 / XZ) FALLBACK CARD -->
        <div v-else-if="isProprietaryArchive" class="preview-fallback-container">
          <div class="fallback-card">
            <span class="fallback-icon">📦</span>
            <h4 class="fallback-title">{{ file.name }}</h4>
            <p class="fallback-desc">{{ ext.toUpperCase() }} 专用压缩包 · 文件大小 {{ formatBytes(file.size) }}</p>
            <p class="fallback-tip" style="font-size: 0.82rem; color: var(--text-secondary, #64748b); max-width: 440px; margin: 8px auto 16px; line-height: 1.5;">
              💡 7z / RAR 格式采用了专有的 LZMA/RAR5 压缩算法，建议下载后在本地使用 7-Zip / WinRAR 解压；若需在网页端免下载直接在线浏览与提取包内文件，建议打包为 <strong>.zip</strong> 或 <strong>.tar.gz</strong> 格式上传。
            </p>
            <div class="fallback-actions">
              <button type="button" class="btn-primary" @click="handleDownload">
                ⬇️ 下载 {{ ext.toUpperCase() }} 压缩包
              </button>
            </div>
          </div>
        </div>

        <!-- 10. GENERIC UNKNOWN FILE FALLBACK -->
        <div v-else class="preview-fallback-container">
          <div class="fallback-card">
            <span class="fallback-icon">📄</span>
            <h4 class="fallback-title">{{ file.name }}</h4>
            <p class="fallback-desc">二进制/专用格式文件，文件大小 {{ formatBytes(file.size) }}</p>
            <div class="fallback-actions">
              <button type="button" class="btn-primary" @click="handleDownload">
                ⬇️ 下载文件
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  </div>
</template>

<style scoped>
.preview-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.75);
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

.preview-modal {
  background: var(--surface, #ffffff);
  border: 1px solid var(--border, #e2e8f0);
  border-radius: 16px;
  width: 100%;
  max-width: 960px;
  height: 85vh;
  max-height: 860px;
  display: flex;
  flex-direction: column;
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.35);
  color: var(--text, #0f172a);
  overflow: hidden;
  transition: all 0.2s ease;
}

.preview-modal.is-editing-modal {
  max-width: 1200px;
}

.preview-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 20px;
  background: var(--surface-1, #f8fafc);
  border-bottom: 1px solid var(--border, #e2e8f0);
  flex-shrink: 0;
  gap: 12px;
}

.preview-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  overflow: hidden;
  min-width: 0;
}

.preview-back-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text, #0f172a);
  cursor: pointer;
  flex-shrink: 0;
  transition: background 0.15s ease;
}

.preview-back-btn:hover {
  background: var(--surface-2, #e2e8f0);
}

.preview-back-btn:active {
  background: var(--surface-3, #cbd5e1);
}

.preview-icon {
  font-size: 1.4rem;
  flex-shrink: 0;
}

.preview-title-box {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-width: 0;
}

.preview-title {
  margin: 0;
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--text, #0f172a);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.unsaved-badge {
  color: #ef4444;
  font-weight: bold;
  font-size: 1.1rem;
}

.preview-filesize {
  font-size: 0.76rem;
  color: var(--text-secondary, #64748b);
}

.preview-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.action-btn-pill {
  padding: 4px 10px;
  border-radius: 6px;
  font-size: 0.78rem;
  font-weight: 500;
  background: var(--surface-2, #e2e8f0);
  border: 1px solid var(--border, #cbd5e1);
  color: var(--text, #1e293b);
  cursor: pointer;
  transition: all 0.15s ease;
}

.action-btn-pill:hover {
  background: var(--surface-3, #cbd5e1);
}

.action-btn-pill.is-save {
  background: #008069;
  color: #ffffff;
  border-color: #008069;
}

.action-btn-pill.is-save:hover {
  background: #006a57;
}

.action-btn-pill.is-cancel {
  background: rgba(239, 68, 68, 0.1);
  color: #ef4444;
  border-color: rgba(239, 68, 68, 0.3);
}

.action-btn-pill.is-cancel:hover {
  background: rgba(239, 68, 68, 0.2);
}

.mode-switch-group {
  display: flex;
  background: var(--surface-2, #e2e8f0);
  padding: 2px;
  border-radius: 6px;
}

.mode-btn {
  background: transparent;
  border: none;
  font-size: 0.76rem;
  padding: 3px 8px;
  border-radius: 4px;
  color: var(--text-secondary, #64748b);
  cursor: pointer;
  transition: all 0.15s ease;
}

.mode-btn.active {
  background: var(--surface, #ffffff);
  color: var(--text, #0f172a);
  font-weight: 600;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}

.action-icon-btn {
  background: var(--surface-2, #f1f5f9);
  border: 1px solid var(--border, #e2e8f0);
  color: var(--text, #334155);
  padding: 4px 8px;
  border-radius: 6px;
  font-size: 0.8rem;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s ease;
}

.action-icon-btn:hover {
  background: var(--surface-3, #e2e8f0);
  color: var(--text, #0f172a);
}

.preview-download-btn {
  background: #0284c7;
  color: #ffffff;
  border-color: #0284c7;
}

.preview-download-btn:hover {
  background: #0369a1;
}

.preview-close-btn {
  background: transparent;
  border: none;
  color: var(--text-secondary, #64748b);
  font-size: 1.4rem;
  cursor: pointer;
  line-height: 1;
  padding: 0 4px;
}

.preview-close-btn:hover {
  color: var(--text, #0f172a);
}

.preview-body {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  position: relative;
  background: var(--surface, #ffffff);
}

.preview-archive-container {
  flex: 1;
  width: 100%;
  height: 100%;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

/* Image */
.preview-image-container {
  flex: 1;
  overflow: auto;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: rgba(0, 0, 0, 0.03);
}

.preview-img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
  border-radius: 6px;
}

/* Media */
.preview-media-container {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #000000;
}

.preview-video {
  max-width: 100%;
  max-height: 100%;
}

/* Audio */
.preview-audio-container {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 30px;
}

.audio-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  background: var(--surface-1, #f8fafc);
  border: 1px solid var(--border, #e2e8f0);
  border-radius: 16px;
  padding: 30px;
  max-width: 440px;
  width: 100%;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.06);
}

.audio-card-icon {
  font-size: 3.5rem;
}

.audio-card-name {
  font-size: 1.05rem;
  font-weight: 600;
  text-align: center;
  color: var(--text, #0f172a);
}

.preview-audio-player {
  width: 100%;
}

/* PDF */
.preview-pdf-container {
  flex: 1;
  display: flex;
}

.preview-pdf-frame {
  flex: 1;
  width: 100%;
  height: 100%;
  border: none;
}

/* CSV Table */
.preview-csv-container {
  flex: 1;
  overflow: auto;
  padding: 16px;
}

.csv-table-wrapper {
  overflow-x: auto;
}

.csv-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.84rem;
}

.csv-table th,
.csv-table td {
  border: 1px solid var(--border, #e2e8f0);
  padding: 6px 12px;
  text-align: left;
}

.csv-table th {
  background: var(--surface-1, #f8fafc);
  font-weight: 600;
  color: var(--text, #0f172a);
  position: sticky;
  top: 0;
}

.csv-index-col {
  color: var(--text-secondary, #94a3b8);
  width: 40px;
  text-align: center !important;
  background: var(--surface-1, #f8fafc);
}

/* Text / Code Viewer */
.preview-text-container {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.preview-loading,
.preview-error {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: var(--text-secondary, #64748b);
  font-size: 0.9rem;
}

.markdown-preview-wrap {
  flex: 1;
  overflow-y: auto;
  padding: 24px 30px;
  background: var(--surface, #ffffff);
}

.code-viewer-wrap {
  flex: 1;
  overflow: auto;
  display: flex;
  font-family: 'JetBrains Mono', Consolas, Monaco, monospace;
  font-size: 0.86rem;
  line-height: 1.6;
  background: var(--surface-0, #f8fafc);
}

.line-numbers {
  display: flex;
  flex-direction: column;
  padding: 14px 10px;
  background: var(--surface-1, #f1f5f9);
  border-right: 1px solid var(--border, #e2e8f0);
  color: var(--text-secondary, #94a3b8);
  user-select: none;
  text-align: right;
  min-width: 40px;
}

.code-content {
  margin: 0;
  padding: 14px 16px;
  flex: 1;
  overflow-x: auto;
  color: var(--text, #0f172a);
}

.code-viewer-wrap.wrap-lines .code-content {
  white-space: pre-wrap;
  word-break: break-all;
}

/* Editor container */
.editor-container {
  flex: 1;
  display: flex;
  overflow: hidden;
}

.editor-container.is-split-layout {
  display: grid;
  grid-template-columns: 1fr 1fr;
}

.editor-pane {
  flex: 1;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--border, #e2e8f0);
  background: var(--surface, #ffffff);
  overflow: hidden;
}

.editor-pane-header {
  padding: 6px 14px;
  background: var(--surface-1, #f8fafc);
  border-bottom: 1px solid var(--border, #e2e8f0);
  font-size: 0.76rem;
  color: var(--text-secondary, #64748b);
  font-weight: 500;
}

.editor-textarea {
  flex: 1;
  width: 100%;
  border: none;
  outline: none;
  padding: 14px 18px;
  font-family: 'JetBrains Mono', Consolas, Monaco, monospace;
  font-size: 0.88rem;
  line-height: 1.6;
  background: var(--surface, #ffffff);
  color: var(--text, #0f172a);
  resize: none;
}

.editor-live-preview {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--surface, #ffffff);
}

/* Fallback Card */
.preview-fallback-container {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 30px;
}

.fallback-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  max-width: 420px;
  gap: 12px;
  background: var(--surface-1, #f8fafc);
  border: 1px solid var(--border, #e2e8f0);
  border-radius: 16px;
  padding: 32px 24px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.06);
}

.fallback-icon {
  font-size: 3.5rem;
}

.fallback-title {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 600;
  color: var(--text, #0f172a);
}

.fallback-desc {
  margin: 0;
  font-size: 0.85rem;
  color: var(--text-secondary, #64748b);
}

.fallback-actions {
  margin-top: 10px;
}

.btn-primary {
  background: #0284c7;
  color: #ffffff;
  border: none;
  padding: 8px 18px;
  border-radius: 8px;
  font-size: 0.88rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease;
}

.btn-primary:hover {
  background: #0369a1;
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

@media (max-width: 768px) {
  .preview-backdrop {
    padding: 0;
  }

  .preview-modal {
    width: 100vw;
    height: 100dvh;
    max-width: 100vw;
    max-height: 100dvh;
    border-radius: 0;
    border: none;
  }

  .preview-header {
    padding: max(8px, env(safe-area-inset-top)) max(12px, env(safe-area-inset-right)) 8px max(12px, env(safe-area-inset-left));
    display: grid;
    grid-template-columns: 1fr auto;
    grid-template-areas:
      "meta close"
      "actions actions";
    gap: 8px 10px;
    align-items: center;
  }

  .preview-meta {
    grid-area: meta;
    min-width: 0;
  }

  .preview-title {
    max-width: 220px;
    font-size: 0.9rem;
  }

  .preview-close-btn {
    grid-area: close;
    width: 36px;
    height: 36px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    font-size: 1.6rem;
    padding: 0;
  }

  .preview-actions {
    grid-area: actions;
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: nowrap;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
    padding-bottom: 2px;
    width: 100%;
  }

  .preview-actions::-webkit-scrollbar {
    display: none;
  }

  .action-btn-pill,
  .action-icon-btn,
  .mode-switch-group {
    flex-shrink: 0;
  }

  .editor-container.is-split-layout {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: 1fr 1fr;
  }

  .editor-pane {
    border-right: none;
    border-bottom: 1px solid var(--border, #e2e8f0);
  }
}
</style>
