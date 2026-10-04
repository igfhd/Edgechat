<script setup>
import { computed, ref, toRef, watch } from 'vue';
import {
  Check,
  FileText,
  Forward,
  Hash,
  Lock,
  MessageSquare,
  Mic,
  Search,
  Send,
  User,
  Users,
  X
} from '@lucide/vue';
import UiAvatar from '../ui/Avatar.vue';
import UiButton from '../ui/Button.vue';
import { useOverlayLifecycle } from '../../composables/useOverlayLifecycle.js';
import { executeForwardMessages } from '../../composables/useMessageForwarding.js';
import { isPresenceOnline } from '../../date.js';
import store from '../../store.js';

const props = defineProps({
  open: { type: Boolean, default: false },
  messages: { type: Array, default: () => [] },
  conversations: { type: Array, default: () => [] },
  currentRoom: { type: Object, default: () => null }
});

const emit = defineEmits(['close', 'forwarded']);

const searchKeyword = ref('');
const selectedTarget = ref(null);
const commentText = ref('');
const isSubmitting = ref(false);
const progressInfo = ref({ current: 0, total: 0, status: '' });
const errorText = ref('');
const searchInputEl = ref(null);

useOverlayLifecycle({
  open: toRef(props, 'open'),
  onClose: handleClose,
  focusTarget: searchInputEl
});

watch(
  () => props.open,
  (val) => {
    if (val) {
      searchKeyword.value = '';
      selectedTarget.value = null;
      commentText.value = '';
      errorText.value = '';
      isSubmitting.value = false;
      progressInfo.value = { current: 0, total: props.messages.length, status: '' };
    }
  }
);

function handleClose() {
  if (isSubmitting.value) return;
  emit('close');
}

// 格式化可转发的会话列表
const targetList = computed(() => {
  const list = [];
  const currentKey = props.currentRoom ? `${props.currentRoom.kind}:${props.currentRoom.id}` : '';

  for (const item of props.conversations) {
    if (!item?.id || !item.kind) continue;
    const key = `${item.kind}:${item.id}`;
    const isCurrent = key === currentKey;
    const displayName = item.title || item.name || (item.otherUser?.displayName) || '未命名会话';
    const subtitle = item.kind === 'dm'
      ? (item.otherUser?.username ? `@${item.otherUser.username}` : '私聊')
      : (item.isGeneral ? '全员群组' : (item.isPrivate ? '私密群组' : '公开群组'));

    list.push({
      ...item,
      key,
      isCurrent,
      displayName,
      subtitle
    });
  }

  return list;
});

// 搜索过滤
const filteredTargets = computed(() => {
  const kw = searchKeyword.value.trim().toLowerCase();
  if (!kw) return targetList.value;

  return targetList.value.filter((item) => {
    return (
      item.displayName.toLowerCase().includes(kw) ||
      (item.subtitle?.toLowerCase().includes(kw)) ||
      (item.otherUser?.username?.toLowerCase().includes(kw))
    );
  });
});

function selectTarget(target) {
  if (isSubmitting.value) return;
  selectedTarget.value = target;
}

function isTargetOnline(target) {
  if (target.kind !== 'dm' || !target.otherUser?.id) return false;
  const uid = Number(target.otherUser.id);
  const presence = store.getUserPresence(uid);
  return isPresenceOnline(presence.lastActiveAt || target.otherUser.lastActiveAt, presence.online);
}

// 消息摘要预览
function getMessageSnippet(msg) {
  if (msg.attachment) {
    if (msg.attachment.isVoice) return `[语音] ${msg.attachment.duration || 1}s`;
    return `[附件] ${msg.attachment.name || '文件'}`;
  }
  return msg.content || '[空消息]';
}

async function handleConfirmForward() {
  if (!selectedTarget.value || props.messages.length === 0 || isSubmitting.value) return;

  isSubmitting.value = true;
  errorText.value = '';
  progressInfo.value = {
    current: 0,
    total: props.messages.length,
    status: '准备转发...'
  };

  try {
    await executeForwardMessages({
      messages: props.messages,
      targetRoom: selectedTarget.value,
      commentText: commentText.value,
      session: store.session,
      onProgress: (prog) => {
        progressInfo.value = prog;
      }
    });

    emit('forwarded', {
      targetRoom: selectedTarget.value,
      count: props.messages.length
    });
    emit('close');
  } catch (err) {
    errorText.value = err.message || '转发失败，请重试';
    isSubmitting.value = false;
  }
}
</script>

<template>
  <Teleport to="body">
    <Transition name="forward-modal-fade">
      <div v-if="open" class="forward-modal-overlay" @click.self="handleClose">
        <div
          class="forward-modal-card"
          role="dialog"
          aria-modal="true"
          aria-labelledby="forward-modal-title"
        >
          <!-- 头部 -->
          <header class="forward-modal-header">
            <div class="forward-modal-header__title-group">
              <Forward :size="20" class="forward-modal-header__icon" aria-hidden="true" />
              <h2 id="forward-modal-title">转发消息</h2>
              <span class="forward-modal-header__badge">{{ messages.length }} 条</span>
            </div>
            <button
              type="button"
              class="forward-modal-close-btn"
              title="关闭"
              aria-label="关闭"
              :disabled="isSubmitting"
              @click="handleClose"
            >
              <X :size="18" aria-hidden="true" />
            </button>
          </header>

          <!-- 消息预览折叠栏 -->
          <section class="forward-messages-preview">
            <div class="forward-messages-preview__header">
              <span>待转发内容</span>
            </div>
            <div class="forward-messages-preview__list">
              <div
                v-for="msg in messages.slice(0, 3)"
                :key="msg.id"
                class="forward-preview-item"
              >
                <span class="forward-preview-sender">{{ msg.sender?.displayName || '成员' }}:</span>
                <span class="forward-preview-content">{{ getMessageSnippet(msg) }}</span>
              </div>
              <div v-if="messages.length > 3" class="forward-preview-more">
                以及其他 {{ messages.length - 3 }} 条消息...
              </div>
            </div>
          </section>

          <!-- 搜索输入框 -->
          <div class="forward-search-box">
            <Search :size="16" class="forward-search-icon" aria-hidden="true" />
            <input
              ref="searchInputEl"
              v-model="searchKeyword"
              type="text"
              class="forward-search-input"
              placeholder="搜索频道、群组或联系人..."
              :disabled="isSubmitting"
            />
            <button
              v-if="searchKeyword"
              type="button"
              class="forward-search-clear"
              title="清除"
              @click="searchKeyword = ''"
            >
              <X :size="14" />
            </button>
          </div>

          <!-- 目标列表 -->
          <section class="forward-targets-container">
            <div v-if="filteredTargets.length === 0" class="forward-targets-empty">
              未找到匹配的聊天会话
            </div>

            <div v-else class="forward-targets-list">
              <div
                v-for="target in filteredTargets"
                :key="target.key"
                class="forward-target-item"
                :class="{
                  'forward-target-item--selected': selectedTarget?.key === target.key,
                  'forward-target-item--disabled': isSubmitting
                }"
                role="button"
                tabindex="0"
                @click="selectTarget(target)"
                @keydown.enter="selectTarget(target)"
              >
                <div class="forward-target-avatar-wrap">
                  <UiAvatar
                    :src="target.avatarUrl || target.otherUser?.avatarUrl"
                    :fallback="target.displayName"
                    size="sm"
                    :show-presence="target.kind === 'dm'"
                    :is-online="isTargetOnline(target)"
                  />
                  <span v-if="target.isPrivate" class="forward-target-badge--lock" title="端到端加密群组">
                    <Lock :size="10" />
                  </span>
                </div>

                <div class="forward-target-info">
                  <div class="forward-target-name-row">
                    <span class="forward-target-name">{{ target.displayName }}</span>
                    <span v-if="target.isCurrent" class="forward-target-current-tag">当前会话</span>
                  </div>
                  <div class="forward-target-meta">
                    <span>{{ target.subtitle }}</span>
                  </div>
                </div>

                <div class="forward-target-radio">
                  <div
                    class="forward-target-radio__circle"
                    :class="{ 'forward-target-radio__circle--checked': selectedTarget?.key === target.key }"
                  >
                    <Check v-if="selectedTarget?.key === target.key" :size="12" :stroke-width="3" />
                  </div>
                </div>
              </div>
            </div>
          </section>

          <!-- 附言输入区 -->
          <div class="forward-comment-section">
            <input
              v-model="commentText"
              type="text"
              class="forward-comment-input"
              placeholder="添加附言（可选，将随转发消息一同发送）..."
              :disabled="isSubmitting"
              @keydown.enter="handleConfirmForward"
            />
          </div>

          <!-- 错误与进度提示 -->
          <div v-if="errorText" class="forward-error-banner" role="alert">
            {{ errorText }}
          </div>

          <div v-if="isSubmitting" class="forward-progress-bar">
            <div class="forward-progress-spinner"></div>
            <span class="forward-progress-text">{{ progressInfo.status || '正在转发...' }}</span>
          </div>

          <!-- 底部操作按钮 -->
          <footer class="forward-modal-footer">
            <UiButton
              variant="secondary"
              size="sm"
              :disabled="isSubmitting"
              @click="handleClose"
            >
              取消
            </UiButton>
            <UiButton
              variant="primary"
              size="sm"
              :disabled="!selectedTarget || isSubmitting"
              @click="handleConfirmForward"
            >
              <Send :size="14" aria-hidden="true" />
              <span>{{ isSubmitting ? '正在处理...' : `转发给 ${selectedTarget ? selectedTarget.displayName : '...'}` }}</span>
            </UiButton>
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.forward-modal-fade-enter-active,
.forward-modal-fade-leave-active {
  transition: opacity 0.2s ease;
}
.forward-modal-fade-enter-from,
.forward-modal-fade-leave-to {
  opacity: 0;
}

.forward-modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 1200;
  background: rgba(11, 20, 26, 0.5);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
}

.forward-modal-card {
  width: min(480px, 100%);
  max-height: min(640px, 90vh);
  background: var(--surface-panel, #ffffff);
  border: 1px solid var(--line-soft, #e2e8f0);
  border-radius: 16px;
  box-shadow: 0 12px 32px rgba(11, 20, 26, 0.16);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.forward-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--line-soft, #e2e8f0);
}

.forward-modal-header__title-group {
  display: flex;
  align-items: center;
  gap: 8px;
}

.forward-modal-header__icon {
  color: var(--brand-color, #0f766e);
}

.forward-modal-header h2 {
  margin: 0;
  font-size: 1.1rem;
  font-weight: 600;
  color: var(--text-primary, #0f172a);
}

.forward-modal-header__badge {
  font-size: 12px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 10px;
  background: rgba(15, 118, 110, 0.12);
  color: var(--brand-color, #0f766e);
}

.forward-modal-close-btn {
  background: transparent;
  border: none;
  color: var(--text-muted, #64748b);
  cursor: pointer;
  padding: 4px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s ease;
}

.forward-modal-close-btn:hover:not(:disabled) {
  background: rgba(0, 0, 0, 0.05);
  color: var(--text-primary, #0f172a);
}

.forward-messages-preview {
  background: rgba(15, 118, 110, 0.04);
  border-bottom: 1px solid var(--line-soft, #e2e8f0);
  padding: 10px 20px;
  font-size: 12px;
}

.forward-messages-preview__header {
  font-weight: 600;
  color: var(--text-muted, #64748b);
  margin-bottom: 4px;
}

.forward-preview-item {
  display: flex;
  gap: 6px;
  line-height: 1.5;
  color: var(--text-primary, #0f172a);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.forward-preview-sender {
  font-weight: 600;
  color: var(--brand-color, #0f766e);
  flex-shrink: 0;
}

.forward-preview-content {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.forward-preview-more {
  margin-top: 2px;
  color: var(--text-muted, #64748b);
  font-style: italic;
}

.forward-search-box {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 20px;
  border-bottom: 1px solid var(--line-soft, #e2e8f0);
  position: relative;
}

.forward-search-icon {
  color: var(--text-muted, #64748b);
}

.forward-search-input {
  flex: 1;
  border: none;
  background: transparent;
  font-size: 14px;
  color: var(--text-primary, #0f172a);
  outline: none;
}

.forward-search-clear {
  border: none;
  background: transparent;
  color: var(--text-muted, #64748b);
  cursor: pointer;
  padding: 2px;
}

.forward-targets-container {
  flex: 1;
  overflow-y: auto;
  min-height: 160px;
  max-height: 280px;
}

.forward-targets-empty {
  padding: 32px 20px;
  text-align: center;
  color: var(--text-muted, #64748b);
  font-size: 13px;
}

.forward-targets-list {
  display: flex;
  flex-direction: column;
}

.forward-target-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 20px;
  cursor: pointer;
  transition: background 0.12s ease;
  user-select: none;
}

.forward-target-item:hover:not(.forward-target-item--disabled) {
  background: rgba(15, 118, 110, 0.05);
}

.forward-target-item--selected {
  background: rgba(15, 118, 110, 0.1) !important;
}

.forward-target-avatar-wrap {
  position: relative;
}

.forward-target-badge--lock {
  position: absolute;
  bottom: -2px;
  right: -2px;
  background: #0f766e;
  color: #fff;
  border-radius: 50%;
  width: 14px;
  height: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.forward-target-info {
  flex: 1;
  min-width: 0;
}

.forward-target-name-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.forward-target-name {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--text-primary, #0f172a);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.forward-target-current-tag {
  font-size: 10px;
  padding: 1px 5px;
  border-radius: 4px;
  background: rgba(100, 116, 139, 0.12);
  color: #64748b;
  flex-shrink: 0;
}

.forward-target-meta {
  font-size: 11.5px;
  color: var(--text-muted, #64748b);
  margin-top: 2px;
}

.forward-target-radio {
  flex-shrink: 0;
}

.forward-target-radio__circle {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 1.5px solid var(--line-strong, #cbd5e1);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s ease;
}

.forward-target-radio__circle--checked {
  background: var(--brand-color, #0f766e);
  border-color: var(--brand-color, #0f766e);
  color: #fff;
}

.forward-comment-section {
  padding: 10px 20px;
  border-top: 1px solid var(--line-soft, #e2e8f0);
}

.forward-comment-input {
  width: 100%;
  border: 1px solid var(--line-soft, #e2e8f0);
  border-radius: 8px;
  padding: 8px 12px;
  font-size: 13px;
  background: var(--surface-field, #f8fafc);
  color: var(--text-primary, #0f172a);
  outline: none;
  box-sizing: border-box;
}

.forward-comment-input:focus {
  border-color: var(--brand-color, #0f766e);
  background: #ffffff;
}

.forward-error-banner {
  margin: 8px 20px 0;
  padding: 8px 12px;
  border-radius: 6px;
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.3);
  color: #dc2626;
  font-size: 12px;
}

.forward-progress-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 8px 20px 0;
  padding: 8px 12px;
  border-radius: 6px;
  background: rgba(15, 118, 110, 0.08);
  border: 1px solid rgba(15, 118, 110, 0.2);
}

.forward-progress-spinner {
  width: 14px;
  height: 14px;
  border: 2px solid rgba(15, 118, 110, 0.3);
  border-top-color: var(--brand-color, #0f766e);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.forward-progress-text {
  font-size: 12px;
  color: var(--brand-color, #0f766e);
  font-weight: 500;
}

.forward-modal-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  padding: 14px 20px;
  border-top: 1px solid var(--line-soft, #e2e8f0);
}

/* 暗黑模式适配 */
html[data-theme="dark"] .forward-modal-card,
html.dark .forward-modal-card {
  background: #1e2433 !important;
  border-color: rgba(255, 255, 255, 0.12) !important;
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.5) !important;
}

html[data-theme="dark"] .forward-modal-header,
html.dark .forward-modal-header,
html[data-theme="dark"] .forward-search-box,
html.dark .forward-search-box,
html[data-theme="dark"] .forward-comment-section,
html.dark .forward-comment-section,
html[data-theme="dark"] .forward-modal-footer,
html.dark .forward-modal-footer {
  border-color: rgba(255, 255, 255, 0.08) !important;
}

html[data-theme="dark"] .forward-modal-header h2,
html.dark .forward-modal-header h2,
html[data-theme="dark"] .forward-target-name,
html.dark .forward-target-name,
html[data-theme="dark"] .forward-preview-item,
html.dark .forward-preview-item {
  color: #f1f5f9 !important;
}

html[data-theme="dark"] .forward-messages-preview,
html.dark .forward-messages-preview {
  background: rgba(15, 118, 110, 0.15) !important;
  border-color: rgba(255, 255, 255, 0.08) !important;
}

html[data-theme="dark"] .forward-search-input,
html.dark .forward-search-input {
  color: #f1f5f9 !important;
}

html[data-theme="dark"] .forward-comment-input,
html.dark .forward-comment-input {
  background: #131824 !important;
  border-color: rgba(255, 255, 255, 0.12) !important;
  color: #f1f5f9 !important;
}
</style>
