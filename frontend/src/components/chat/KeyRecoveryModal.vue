<script setup>
import { computed, ref, watch } from 'vue';
import store from '../../store.js';
import { validateRecoveryPhrase } from '../../crypto/bip39.js';

const emit = defineEmits(['recovered', 'reset']);

const show = computed(() => store.e2eeStatus === 'pending_recovery');
const activeTab = ref('passphrase'); // 'passphrase' | 'phrase'

const passphraseInput = ref('');
const phraseInput = ref('');
const showPassword = ref(false);
const loading = ref(false);
const errorMsg = ref('');
const showResetConfirm = ref(false);
const resetLoading = ref(false);

const phraseWordCount = computed(() => {
  const words = phraseInput.value.trim().split(/\s+/).filter(Boolean);
  return words.length;
});

function switchTab(tab) {
  activeTab.value = tab;
  errorMsg.value = '';
}

watch(show, (val) => {
  if (val) {
    passphraseInput.value = '';
    phraseInput.value = '';
    errorMsg.value = '';
    showResetConfirm.value = false;
  }
});

async function handleRecover() {
  errorMsg.value = '';
  const secret = activeTab.value === 'passphrase' ? passphraseInput.value.trim() : phraseInput.value.trim();

  if (!secret) {
    errorMsg.value = activeTab.value === 'passphrase' ? '请输入您的安全口令' : '请输入 12 词安全恢复短语';
    return;
  }

  if (activeTab.value === 'phrase') {
    const isValidPhrase = await validateRecoveryPhrase(secret);
    if (!isValidPhrase) {
      errorMsg.value = '恢复短语格式或校验和无效，请确认输入的 12 个助记单词完整且拼写正确';
      return;
    }
  }

  loading.value = true;
  try {
    await store.recoverPrivateKey(secret);
    passphraseInput.value = '';
    phraseInput.value = '';
    emit('recovered');
  } catch (err) {
    errorMsg.value = err?.message || '口令或恢复短语错误，无法解密私钥';
  } finally {
    loading.value = false;
  }
}

async function handleResetKey() {
  resetLoading.value = true;
  errorMsg.value = '';
  try {
    await store.resetIdentityKey();
    showResetConfirm.value = false;
    emit('reset');
  } catch (err) {
    errorMsg.value = err?.message || '重置密钥失败';
  } finally {
    resetLoading.value = false;
  }
}
</script>

<template>
  <Transition name="modal">
    <div v-if="show" class="key-recovery-backdrop" @click.self.prevent>
      <div class="key-recovery-card" role="dialog" aria-modal="true">
        <div class="key-recovery-header">
          <div class="key-icon-wrapper">
            <span class="key-icon">🔐</span>
          </div>
          <h3 class="key-recovery-title">恢复端到端加密私钥</h3>
          <p class="key-recovery-subtitle">
            检测到当前设备尚未解密历史私钥。请输入您先前设置的独立安全口令或 12 词恢复短语以解锁历史会话：
          </p>
        </div>

        <div class="recovery-tab-bar">
          <button
            type="button"
            class="recovery-tab-btn"
            :class="{ 'recovery-tab-btn--active': activeTab === 'passphrase' }"
            @click="switchTab('passphrase')"
          >
            安全口令解锁
          </button>
          <button
            type="button"
            class="recovery-tab-btn"
            :class="{ 'recovery-tab-btn--active': activeTab === 'phrase' }"
            @click="switchTab('phrase')"
          >
            12 词恢复短语
          </button>
        </div>

        <form class="key-recovery-body" @submit.prevent="handleRecover">
          <div v-if="activeTab === 'passphrase'" class="form-group">
            <label class="form-label" for="e2ee-passphrase">私钥安全口令</label>
            <div class="input-with-action">
              <input
                id="e2ee-passphrase"
                v-model="passphraseInput"
                :type="showPassword ? 'text' : 'password'"
                class="recovery-input"
                placeholder="请输入您先前备份时设置的安全口令"
                autocomplete="off"
              />
              <button
                type="button"
                class="reveal-btn"
                tabindex="-1"
                :title="showPassword ? '隐藏口令' : '显示口令'"
                @click="showPassword = !showPassword"
              >
                {{ showPassword ? '🙈' : '👁️' }}
              </button>
            </div>
          </div>

          <div v-else class="form-group">
            <div class="label-with-count">
              <label class="form-label" for="e2ee-phrase">12 词安全恢复短语</label>
              <span class="word-counter" :class="{ 'word-counter--ok': phraseWordCount === 12 }">
                已输入 {{ phraseWordCount }}/12 词
              </span>
            </div>
            <textarea
              id="e2ee-phrase"
              v-model="phraseInput"
              class="recovery-textarea"
              rows="3"
              placeholder="请输入空格分隔的 12 个助记单词，例如：apple banana dog cat..."
              autocomplete="off"
            ></textarea>
          </div>

          <div v-if="errorMsg" class="recovery-error-alert" role="alert">
            <span class="error-icon">⚠️</span>
            <span>{{ errorMsg }}</span>
          </div>

          <div class="recovery-actions">
            <button
              type="submit"
              class="recovery-submit-btn"
              :disabled="loading || (activeTab === 'passphrase' ? !passphraseInput : !phraseInput)"
            >
              {{ loading ? '正在解密验证 (PBKDF2 600K)...' : '解锁并恢复私钥' }}
            </button>
          </div>
        </form>

        <div class="recovery-footer">
          <div v-if="!showResetConfirm" class="reset-prompt">
            <span>忘记了口令且未保存 12 词短语？</span>
            <button
              type="button"
              class="reset-trigger-link"
              @click="showResetConfirm = true"
            >
              重置端到端密钥对
            </button>
          </div>

          <div v-else class="reset-confirm-panel">
            <p class="reset-warning-text">
              🚨 <strong>极度警告</strong>：重置将生成全新密钥对并覆盖云端公钥。您将<strong>永久无法再解密过往的历史加密消息</strong>，但可以正常发起和接收新的加密对话。
            </p>
            <div class="reset-confirm-actions">
              <button
                type="button"
                class="reset-cancel-btn"
                :disabled="resetLoading"
                @click="showResetConfirm = false"
              >
                取消
              </button>
              <button
                type="button"
                class="reset-danger-btn"
                :disabled="resetLoading"
                @click="handleResetKey"
              >
                {{ resetLoading ? '正在重置...' : '确认放弃旧私钥并重置' }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.key-recovery-backdrop {
  position: fixed;
  inset: 0;
  z-index: 10000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(15, 23, 42, 0.72);
  backdrop-filter: blur(8px);
  padding: 16px;
}

.key-recovery-card {
  width: 100%;
  max-width: 480px;
  background: #ffffff;
  border-radius: 20px;
  box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25), 0 0 0 1px rgba(0, 0, 0, 0.05);
  padding: 28px 24px 20px;
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.key-recovery-header {
  text-align: center;
}

.key-icon-wrapper {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 52px;
  height: 52px;
  border-radius: 16px;
  background: rgba(59, 130, 246, 0.1);
  margin-bottom: 12px;
}

.key-icon {
  font-size: 26px;
}

.key-recovery-title {
  font-size: 19px;
  font-weight: 700;
  color: #0f172a;
  margin: 0 0 6px;
}

.key-recovery-subtitle {
  font-size: 13px;
  line-height: 1.5;
  color: #64748b;
  margin: 0;
}

.recovery-tab-bar {
  display: flex;
  gap: 4px;
  background: #f1f5f9;
  padding: 4px;
  border-radius: 10px;
}

.recovery-tab-btn {
  flex: 1;
  padding: 8px 12px;
  border: none;
  background: transparent;
  color: #64748b;
  font-size: 13px;
  font-weight: 600;
  border-radius: 7px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.recovery-tab-btn--active {
  background: #ffffff;
  color: #0f172a;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
}

.key-recovery-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.form-label {
  font-size: 12px;
  font-weight: 600;
  color: #334155;
}

.label-with-count {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.word-counter {
  font-size: 11px;
  color: #94a3b8;
  font-weight: 500;
}

.word-counter--ok {
  color: #10b981;
  font-weight: 600;
}

.input-with-action {
  position: relative;
  display: flex;
  align-items: center;
}

.recovery-input {
  width: 100%;
  padding: 10px 40px 10px 14px;
  font-size: 14px;
  border: 1px solid #cbd5e1;
  border-radius: 10px;
  outline: none;
  color: #0f172a;
  background: #f8fafc;
  transition: border-color 0.15s ease, background 0.15s ease;
}

.recovery-input:focus {
  border-color: #3b82f6;
  background: #ffffff;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.12);
}

.reveal-btn {
  position: absolute;
  right: 10px;
  background: none;
  border: none;
  font-size: 16px;
  cursor: pointer;
  padding: 4px;
  border-radius: 6px;
  opacity: 0.7;
}

.reveal-btn:hover {
  opacity: 1;
}

.recovery-textarea {
  width: 100%;
  padding: 10px 14px;
  font-size: 13px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  border: 1px solid #cbd5e1;
  border-radius: 10px;
  outline: none;
  color: #0f172a;
  background: #f8fafc;
  resize: vertical;
  line-height: 1.5;
  transition: border-color 0.15s ease, background 0.15s ease;
}

.recovery-textarea:focus {
  border-color: #3b82f6;
  background: #ffffff;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.12);
}

.recovery-error-alert {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 12px;
  border-radius: 8px;
  background: #fef2f2;
  border: 1px solid #fecaca;
  color: #dc2626;
  font-size: 12px;
  line-height: 1.4;
}

.recovery-actions {
  display: flex;
  margin-top: 4px;
}

.recovery-submit-btn {
  width: 100%;
  padding: 12px;
  border-radius: 10px;
  border: none;
  background: #2563eb;
  color: #ffffff;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s ease;
}

.recovery-submit-btn:hover:not(:disabled) {
  background: #1d4ed8;
}

.recovery-submit-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.recovery-footer {
  border-top: 1px solid #f1f5f9;
  padding-top: 14px;
}

.reset-prompt {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #64748b;
}

.reset-trigger-link {
  background: none;
  border: none;
  padding: 0;
  font-size: 12px;
  color: #ef4444;
  font-weight: 600;
  cursor: pointer;
  text-decoration: underline;
}

.reset-trigger-link:hover {
  color: #dc2626;
}

.reset-confirm-panel {
  background: #fff1f2;
  border: 1px solid #ffe4e6;
  border-radius: 10px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.reset-warning-text {
  margin: 0;
  font-size: 12px;
  color: #9f1239;
  line-height: 1.45;
}

.reset-confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.reset-cancel-btn {
  padding: 6px 12px;
  border: 1px solid #cbd5e1;
  background: #ffffff;
  color: #475569;
  font-size: 12px;
  font-weight: 500;
  border-radius: 6px;
  cursor: pointer;
}

.reset-danger-btn {
  padding: 6px 12px;
  border: none;
  background: #e11d48;
  color: #ffffff;
  font-size: 12px;
  font-weight: 600;
  border-radius: 6px;
  cursor: pointer;
}

.reset-danger-btn:hover:not(:disabled) {
  background: #be123c;
}

/* Dark mode compatibility */
@media (prefers-color-scheme: dark) {
  :global(html.dark) .key-recovery-card {
    background: #1e293b;
    border-color: #334155;
  }
  :global(html.dark) .key-recovery-title {
    color: #f8fafc;
  }
  :global(html.dark) .key-recovery-subtitle {
    color: #94a3b8;
  }
  :global(html.dark) .recovery-tab-bar {
    background: #0f172a;
  }
  :global(html.dark) .recovery-tab-btn {
    color: #94a3b8;
  }
  :global(html.dark) .recovery-tab-btn--active {
    background: #334155;
    color: #f8fafc;
  }
  :global(html.dark) .form-label {
    color: #cbd5e1;
  }
  :global(html.dark) .recovery-input,
  :global(html.dark) .recovery-textarea {
    background: #0f172a;
    border-color: #334155;
    color: #f8fafc;
  }
  :global(html.dark) .recovery-footer {
    border-top-color: #334155;
  }
}
</style>
