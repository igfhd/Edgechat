<script setup>
import { computed, onUnmounted, ref, watch } from 'vue';
import api from '../../api.js';
import { useOverlayLifecycle } from '../../composables/useOverlayLifecycle.js';
import { isPreviewableImageAttachment } from './attachment-utils.js';
import { createDecryptedBlobUrl } from '../../crypto/attachment-cipher.js';
import { formatBytes } from '../../composables/useCloudDrive.js';

const props = defineProps({
  attachment: {
    type: Object,
    required: true
  },
  isOwn: {
    type: Boolean,
    default: false
  }
});

const emit = defineEmits(['preview-file']);

const previewOpen = ref(false);
const previewEl = ref(null);
const imageFailed = ref(false);
const decryptedBlobUrl = ref('');
const decrypting = ref(false);

const isImage = computed(() => isPreviewableImageAttachment(props.attachment));
const isE2ee = computed(() => Boolean(props.attachment?.isE2ee || props.attachment?.fileKey));
const displayName = computed(() => props.attachment?.name || '未命名文件');
const fileSizeDisplay = computed(() => {
  const size = props.attachment?.size;
  return Number.isFinite(size) && size > 0 ? formatBytes(size) : '';
});
const openOriginalLabel = computed(() => `打开原图：${displayName.value}`);

const attachmentUrl = computed(() => {
  if (decryptedBlobUrl.value) {
    return decryptedBlobUrl.value;
  }
  return api.getFileUrl(props.attachment?.key || props.attachment?.url);
});

const fileExt = computed(() => (displayName.value.split('.').pop() || '').toLowerCase());

const fileIcon = computed(() => {
  const ext = fileExt.value;
  if (['pdf'].includes(ext)) return '📕';
  if (['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'].includes(ext)) return '📑';
  if (['zip', 'rar', '7z', 'tar', 'gz', 'bz2'].includes(ext)) return '📦';
  if (['mp3', 'wav', 'ogg', 'm4a', 'flac'].includes(ext)) return '🎵';
  if (['mp4', 'webm', 'mov', 'mkv', 'avi'].includes(ext)) return '🎬';
  if (['txt', 'md', 'json', 'js', 'ts', 'py', 'sql', 'html', 'css', 'sh'].includes(ext)) return '📝';
  return '📄';
});

useOverlayLifecycle({
  open: previewOpen,
  onClose: closePreview,
  focusTarget: previewEl
});

function openPreview() {
  if (!isImage.value || imageFailed.value) {
    return;
  }
  previewOpen.value = true;
}

function closePreview() {
  previewOpen.value = false;
}

function handleCardPreview() {
  emit('preview-file', {
    ...props.attachment,
    fileUrl: attachmentUrl.value,
    downloadUrl: attachmentUrl.value
  });
}

const fallbackTried = ref(false);

async function handleImageError() {
  if (fallbackTried.value || isE2ee.value) {
    imageFailed.value = true;
    return;
  }
  fallbackTried.value = true;
  const fileKeyOrUrl = props.attachment?.key || props.attachment?.url;
  if (!fileKeyOrUrl) {
    imageFailed.value = true;
    return;
  }
  try {
    const blob = await api.fetchFileBlob(fileKeyOrUrl);
    const blobUrl = URL.createObjectURL(blob);
    if (decryptedBlobUrl.value) {
      URL.revokeObjectURL(decryptedBlobUrl.value);
    }
    decryptedBlobUrl.value = blobUrl;
    imageFailed.value = false;
  } catch (err) {
    console.error('Fallback image fetch failed', err);
    imageFailed.value = true;
  }
}

async function resolveE2eeAttachment() {
  if (!isE2ee.value || !props.attachment?.fileKey || !props.attachment?.nonce) {
    return;
  }
  const fileKeyOrUrl = props.attachment?.key || props.attachment?.url;
  if (!fileKeyOrUrl) return;

  decrypting.value = true;
  try {
    const buffer = await api.fetchFileBuffer(fileKeyOrUrl);
    const blobUrl = await createDecryptedBlobUrl(
      buffer,
      props.attachment.fileKey,
      props.attachment.nonce,
      props.attachment.type || 'application/octet-stream'
    );
    if (decryptedBlobUrl.value) {
      URL.revokeObjectURL(decryptedBlobUrl.value);
    }
    decryptedBlobUrl.value = blobUrl;
  } catch (err) {
    console.error('Failed to decrypt attachment', err);
    imageFailed.value = true;
  } finally {
    decrypting.value = false;
  }
}

watch(
  () => [props.attachment?.key, props.attachment?.fileKey, props.attachment?.nonce],
  () => {
    imageFailed.value = false;
    fallbackTried.value = false;
    if (isE2ee.value) {
      void resolveE2eeAttachment();
    }
  },
  { immediate: true }
);

onUnmounted(() => {
  if (decryptedBlobUrl.value) {
    URL.revokeObjectURL(decryptedBlobUrl.value);
  }
});
</script>

<template>
  <div class="message-attachment" :class="{ 'message-attachment--image': isImage && !imageFailed }">
    <!-- Image Preview -->
    <template v-if="isImage && !imageFailed">
      <div class="image-bubble-container">
        <button
          type="button"
          class="message-attachment__image-button"
          :aria-label="`预览图片：${displayName}`"
          @click="openPreview"
        >
          <img
            class="message-attachment__image"
            :src="attachmentUrl"
            :alt="displayName"
            loading="lazy"
            @error="handleImageError"
          />
        </button>
        <div v-if="fileSizeDisplay || isE2ee" class="image-bubble-meta">
          <span v-if="isE2ee" class="e2ee-tag" title="端到端加密">🔒</span>
          <span class="image-size-text">{{ fileSizeDisplay }}</span>
        </div>
      </div>

      <Teleport to="body">
        <div
          v-if="previewOpen"
          ref="previewEl"
          class="image-preview-overlay"
          role="dialog"
          aria-modal="true"
          :aria-label="`图片预览：${displayName}`"
          tabindex="-1"
          @click.self="closePreview"
        >
          <div class="image-preview-overlay__toolbar">
            <span class="image-preview-overlay__title">{{ displayName }} {{ fileSizeDisplay ? `(${fileSizeDisplay})` : '' }}</span>
            <a
              class="image-preview-overlay__action"
              :href="attachmentUrl"
              :download="isE2ee ? displayName : undefined"
              :target="isE2ee ? undefined : '_blank'"
              rel="noreferrer"
              :aria-label="openOriginalLabel"
            >
              {{ isE2ee ? '下载原图' : '打开原图' }}
            </a>
            <button type="button" class="image-preview-overlay__close" aria-label="关闭图片预览" @click="closePreview">
              关闭
            </button>
          </div>
          <img class="image-preview-overlay__image" :src="attachmentUrl" :alt="displayName" />
        </div>
      </Teleport>
    </template>

    <!-- Rich File Attachment Card (Non-Image or image load failed) -->
    <div
      v-else
      class="chat-file-card"
      :class="{ 'is-own': isOwn }"
      @click="handleCardPreview"
    >
      <div class="file-card-icon-box">
        <span class="file-card-icon">{{ fileIcon }}</span>
      </div>

      <div class="file-card-content">
        <div class="file-card-title-row">
          <span class="file-card-name" :title="displayName">{{ displayName }}</span>
        </div>
        <div class="file-card-meta-row">
          <span v-if="isE2ee" class="file-card-e2ee-badge" title="端到端加密">🔒 加密</span>
          <span v-if="fileSizeDisplay" class="file-card-size">{{ fileSizeDisplay }}</span>
          <span v-if="decrypting" class="file-card-status">解密中...</span>
        </div>
      </div>

      <div class="file-card-actions" @click.stop>
        <button
          type="button"
          class="file-action-btn file-action-preview"
          title="在线预览文件"
          @click="handleCardPreview"
        >
          👁️
        </button>
        <a
          :href="attachmentUrl"
          :download="isE2ee ? displayName : undefined"
          :target="isE2ee ? undefined : '_blank'"
          rel="noreferrer"
          class="file-action-btn file-action-download"
          title="下载文件"
        >
          ⬇️
        </a>
      </div>
    </div>
  </div>
</template>

<style scoped>
.message-attachment {
  display: block;
  margin-top: 4px;
}

.image-bubble-container {
  position: relative;
  display: inline-block;
  max-width: 100%;
}

.image-bubble-meta {
  position: absolute;
  bottom: 6px;
  right: 6px;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(4px);
  color: #ffffff;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 0.72rem;
  display: flex;
  align-items: center;
  gap: 4px;
}

/* Rich File Card */
.chat-file-card {
  display: flex;
  align-items: center;
  gap: 12px;
  background: var(--surface-1, #f8fafc);
  border: 1px solid var(--border, #e2e8f0);
  border-radius: 12px;
  padding: 10px 14px;
  max-width: 380px;
  min-width: 240px;
  cursor: pointer;
  transition: all 0.15s ease;
  user-select: none;
}

.chat-file-card:hover {
  background: var(--surface-2, #f1f5f9);
  border-color: #008069;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
}

.file-card-icon-box {
  width: 42px;
  height: 42px;
  background: var(--surface-0, #ffffff);
  border: 1px solid var(--border, #e2e8f0);
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.file-card-icon {
  font-size: 1.4rem;
}

.file-card-content {
  display: flex;
  flex-direction: column;
  gap: 3px;
  flex: 1;
  overflow: hidden;
  min-width: 0;
}

.file-card-title-row {
  display: flex;
  align-items: center;
  overflow: hidden;
}

.file-card-name {
  font-size: 0.88rem;
  font-weight: 600;
  color: var(--text, #0f172a);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.3;
}

.file-card-meta-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.76rem;
  color: var(--text-secondary, #64748b);
}

.file-card-e2ee-badge {
  background: rgba(16, 185, 129, 0.12);
  color: #008069;
  padding: 1px 4px;
  border-radius: 4px;
  font-size: 0.7rem;
  font-weight: 500;
}

.file-card-size {
  color: var(--text-secondary, #64748b);
}

.file-card-status {
  color: #0284c7;
}

.file-card-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.file-action-btn {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  border: 1px solid var(--border, #cbd5e1);
  background: var(--surface-0, #ffffff);
  color: var(--text, #1e293b);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.88rem;
  cursor: pointer;
  text-decoration: none;
  transition: all 0.15s ease;
}

.file-action-btn:hover {
  background: #008069;
  color: #ffffff;
  border-color: #008069;
}

.file-action-download {
  background: #0284c7;
  color: #ffffff;
  border-color: #0284c7;
}

.file-action-download:hover {
  background: #0369a1;
  border-color: #0369a1;
}

/* Own message bubble adaptation */
.chat-bubble--own .chat-file-card {
  background: rgba(255, 255, 255, 0.15);
  border-color: rgba(255, 255, 255, 0.25);
  color: #ffffff;
}

.chat-bubble--own .chat-file-card:hover {
  background: rgba(255, 255, 255, 0.22);
}

.chat-bubble--own .file-card-name {
  color: #ffffff;
}

.chat-bubble--own .file-card-meta-row,
.chat-bubble--own .file-card-size {
  color: rgba(255, 255, 255, 0.85);
}

.chat-bubble--own .file-card-icon-box {
  background: rgba(255, 255, 255, 0.2);
  border-color: rgba(255, 255, 255, 0.3);
}
</style>
