<script setup>
import { Download, FileCode, FileSpreadsheet, FileText, Loader2, X } from '@lucide/vue';
import { ref, toRef, watch } from 'vue';
import api from '../../api.js';
import {
  downloadFile,
  fetchAllDecryptedMessages,
  formatAsJson,
  formatAsMarkdown,
  formatAsPlainText,
  generateExportFileName,
} from '../../chat-export.js';
import { useOverlayLifecycle } from '../../composables/useOverlayLifecycle.js';

const props = defineProps({
  show: { type: Boolean, default: false },
  room: { type: Object, default: null },
  session: { type: Object, default: null },
});

const emit = defineEmits(['close']);

const selectedFormat = ref('txt');
const exporting = ref(false);
const progressText = ref('');
const error = ref('');
const rootEl = ref(null);

useOverlayLifecycle({
  open: toRef(props, 'show'),
  onClose: () => emit('close'),
  focusTarget: rootEl,
});

watch(
  () => props.show,
  (val) => {
    if (val) {
      error.value = '';
      progressText.value = '';
      exporting.value = false;
    }
  }
);

async function startExport() {
  if (!props.room || exporting.value) return;
  exporting.value = true;
  error.value = '';
  progressText.value = '正在检索所有历史记录...';

  try {
    const messages = await fetchAllDecryptedMessages({
      room: props.room,
      session: props.session,
      api,
      onProgress({ stage, count }) {
        if (stage === 'fetching') {
          progressText.value = `正在拉取历史记录... (已获取 ${count} 条)`;
        } else if (stage === 'decrypting') {
          progressText.value = `正在解密端到端消息并校准时序... (共 ${count} 条)`;
        }
      },
    });

    if (messages.length === 0) {
      error.value = '当前会话暂无任何聊天记录可导出';
      exporting.value = false;
      return;
    }

    progressText.value = `格式化生成 ${messages.length} 条消息...`;

    let fileContent = '';
    let mimeType = 'text/plain';

    if (selectedFormat.value === 'json') {
      fileContent = formatAsJson(props.room, messages);
      mimeType = 'application/json';
    } else if (selectedFormat.value === 'md') {
      fileContent = formatAsMarkdown(props.room, messages);
      mimeType = 'text/markdown';
    } else {
      fileContent = formatAsPlainText(props.room, messages);
      mimeType = 'text/plain';
    }

    const fileName = generateExportFileName(props.room, selectedFormat.value);
    downloadFile(fileContent, fileName, mimeType);

    progressText.value = `导出成功！已自动下载 ${fileName}`;
    setTimeout(() => {
      emit('close');
    }, 1500);
  } catch (err) {
    error.value = `导出失败: ${err.message || err}`;
  } finally {
    exporting.value = false;
  }
}
</script>

<template>
  <Transition name="modal-fade">
    <div v-if="show" class="export-dialog-overlay" @click.self="emit('close')">
      <section ref="rootEl" class="export-dialog" role="dialog" aria-modal="true" aria-labelledby="export-chat-title">
        <div class="export-dialog__header">
          <div>
            <h2 id="export-chat-title">导出聊天记录</h2>
            <p class="export-dialog__sub">
              {{ room?.displayName || room?.name || '当前会话' }}
              <span v-if="room?.isPrivate || room?.kind === 'dm'" class="e2ee-tag">🔒 端到端解密导出</span>
            </p>
          </div>
          <button type="button" class="export-close-btn" aria-label="关闭" @click="emit('close')">
            <X :size="18" aria-hidden="true" />
          </button>
        </div>

        <p v-if="error" class="export-error-text">{{ error }}</p>

        <div class="export-formats-section">
          <label class="export-section-label">选择导出格式</label>
          <div class="export-format-cards">
            <button
              type="button"
              class="format-card"
              :class="{ 'format-card--active': selectedFormat === 'txt' }"
              :disabled="exporting"
              @click="selectedFormat = 'txt'"
            >
              <FileText :size="22" class="format-card__icon" />
              <div class="format-card__meta">
                <strong>纯文本 (.txt)</strong>
                <span>清晰工整的排版，通用易读</span>
              </div>
            </button>

            <button
              type="button"
              class="format-card"
              :class="{ 'format-card--active': selectedFormat === 'md' }"
              :disabled="exporting"
              @click="selectedFormat = 'md'"
            >
              <FileSpreadsheet :size="22" class="format-card__icon" />
              <div class="format-card__meta">
                <strong>Markdown (.md)</strong>
                <span>保留格式、链接与结构化标题</span>
              </div>
            </button>

            <button
              type="button"
              class="format-card"
              :class="{ 'format-card--active': selectedFormat === 'json' }"
              :disabled="exporting"
              @click="selectedFormat = 'json'"
            >
              <FileCode :size="22" class="format-card__icon" />
              <div class="format-card__meta">
                <strong>结构化数据 (.json)</strong>
                <span>包含完整元数据与程序可用字段</span>
              </div>
            </button>
          </div>
        </div>

        <div class="export-tips">
          <ul>
            <li>✨ <strong>明文解密</strong>：所有端到端加密消息均由当前浏览器私钥安全解密为明文后导出。</li>
            <li>⏱️ <strong>严格正序</strong>：所有历史消息自动按发送时间正序升序排列，顺序井然有序。</li>
            <li>📎 <strong>附件包含</strong>：图片、视频和文件附件将输出名称、尺寸及可访问链接。</li>
          </ul>
        </div>

        <div v-if="progressText" class="export-progress">
          <Loader2 v-if="exporting" :size="16" class="export-spin" />
          <span>{{ progressText }}</span>
        </div>

        <div class="export-dialog__actions">
          <button type="button" class="export-btn-secondary" :disabled="exporting" @click="emit('close')">
            取消
          </button>
          <button type="button" class="export-btn-primary" :disabled="exporting" @click="startExport">
            <Download :size="17" aria-hidden="true" />
            <span>{{ exporting ? '正在导出中...' : '开始导出并下载' }}</span>
          </button>
        </div>
      </section>
    </div>
  </Transition>
</template>

<style scoped>
.export-dialog-overlay {
  position: fixed;
  inset: 0;
  z-index: 110;
  display: flex;
  align-items: center;
  justify-content: center;
  padding:
    max(16px, env(safe-area-inset-top))
    max(16px, env(safe-area-inset-right))
    max(16px, env(safe-area-inset-bottom))
    max(16px, env(safe-area-inset-left));
  background: rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(4px);
}

.export-dialog {
  width: min(480px, 100%);
  max-height: calc(100dvh - 32px);
  overflow-y: auto;
  padding: 24px;
  border-radius: 16px;
  background: #ffffff;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.2);
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.export-dialog__header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
}

.export-dialog__header h2 {
  margin: 0;
  font-size: 18px;
  color: #111b21;
}

.export-dialog__sub {
  margin: 4px 0 0;
  font-size: 13px;
  color: #667781;
  display: flex;
  align-items: center;
  gap: 6px;
}

.e2ee-tag {
  display: inline-flex;
  align-items: center;
  padding: 2px 6px;
  background: #ecfdf5;
  border: 1px solid #a7f3d0;
  border-radius: 4px;
  font-size: 11px;
  color: #065f46;
}

.export-close-btn {
  border: none;
  background: transparent;
  color: #667781;
  cursor: pointer;
  padding: 4px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.export-close-btn:hover {
  background: #f0f2f5;
  color: #111b21;
}

.export-section-label {
  display: block;
  font-size: 13px;
  font-weight: 600;
  color: #334155;
  margin-bottom: 8px;
}

.export-format-cards {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.format-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  border: 1.5px solid #e2e8f0;
  border-radius: 10px;
  background: #ffffff;
  cursor: pointer;
  text-align: left;
  transition: all 0.15s ease;
}

.format-card:hover:not(:disabled) {
  border-color: #cbd5e1;
  background: #f8fafc;
}

.format-card--active {
  border-color: #008069 !important;
  background: #f0fdf4 !important;
}

.format-card__icon {
  color: #008069;
  flex-shrink: 0;
}

.format-card__meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.format-card__meta strong {
  font-size: 13.5px;
  color: #0f172a;
}

.format-card__meta span {
  font-size: 12px;
  color: #64748b;
}

.export-tips {
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 10px 14px;
}

.export-tips ul {
  margin: 0;
  padding-left: 16px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.export-tips li {
  font-size: 12px;
  color: #475569;
  line-height: 1.4;
}

.export-progress {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: #eff6ff;
  border: 1px solid #bfdbfe;
  border-radius: 6px;
  font-size: 13px;
  color: #1e40af;
}

.export-spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.export-error-text {
  margin: 0;
  padding: 8px 12px;
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: 6px;
  font-size: 13px;
  color: #b91c1c;
}

.export-dialog__actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 4px;
}

.export-btn-secondary,
.export-btn-primary {
  min-height: 40px;
  padding: 8px 18px;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  touch-action: manipulation;
  transition: all 0.15s ease;
}

.export-btn-secondary {
  border: 1px solid #cbd5e1;
  background: #ffffff;
  color: #334155;
}

.export-btn-secondary:hover:not(:disabled) {
  background: #f1f5f9;
}

.export-btn-primary {
  border: none;
  background: #008069;
  color: #ffffff;
}

.export-btn-primary:hover:not(:disabled) {
  background: #006b57;
}

.export-btn-primary:disabled,
.export-btn-secondary:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.modal-fade-enter-active { transition: opacity 200ms ease; }
.modal-fade-leave-active { transition: opacity 150ms ease; }
.modal-fade-enter-from, .modal-fade-leave-to { opacity: 0; }

@media (max-width: 480px) {
  .export-dialog-overlay {
    align-items: flex-end;
    padding: env(safe-area-inset-top) 0 0;
  }

  .export-dialog {
    width: 100%;
    max-height: calc(100dvh - env(safe-area-inset-top));
    padding: 20px 16px max(16px, env(safe-area-inset-bottom));
    border-radius: 16px 16px 0 0;
  }

  .export-dialog__actions {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  }
}
</style>
