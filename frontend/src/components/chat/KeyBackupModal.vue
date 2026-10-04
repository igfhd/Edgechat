<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import store from '../../store.js';
import { generateRecoveryPhrase } from '../../crypto/bip39.js';

const props = defineProps({
  show: {
    type: Boolean,
    default: false
  }
});

const emit = defineEmits(['close', 'backed-up']);

const activeTab = ref('passphrase'); // 'passphrase' | 'phrase'
const passphrase = ref('');
const confirmPassphrase = ref('');
const showPassword = ref(false);
const loading = ref(false);
const errorMsg = ref('');
const successMsg = ref('');

const generatedPhrase = ref('');
const phraseCopied = ref(false);
const phraseConfirmedSaved = ref(false);

function switchTab(tab) {
  activeTab.value = tab;
  errorMsg.value = '';
  successMsg.value = '';
}

async function refreshGeneratedPhrase() {
  generatedPhrase.value = await generateRecoveryPhrase();
  phraseCopied.value = false;
  phraseConfirmedSaved.value = false;
}

watch(() => props.show, (val) => {
  if (val) {
    passphrase.value = '';
    confirmPassphrase.value = '';
    errorMsg.value = '';
    successMsg.value = '';
    if (!generatedPhrase.value) {
      void refreshGeneratedPhrase();
    }
  }
});

async function copyPhrase() {
  if (!generatedPhrase.value) return;
  try {
    await navigator.clipboard.writeText(generatedPhrase.value);
    phraseCopied.value = true;
    setTimeout(() => {
      phraseCopied.value = false;
    }, 2500);
  } catch {
    // Fallback
    const el = document.createElement('textarea');
    el.value = generatedPhrase.value;
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    document.body.removeChild(el);
    phraseCopied.value = true;
    setTimeout(() => {
      phraseCopied.value = false;
    }, 2500);
  }
}

async function handleBackupWithPassphrase() {
  errorMsg.value = '';
  successMsg.value = '';

  if (!passphrase.value) {
    errorMsg.value = '请输入独立私钥安全口令';
    return;
  }
  if (passphrase.value.length < 8) {
    errorMsg.value = '安全口令长度建议至少 8 位';
    return;
  }
  if (passphrase.value !== confirmPassphrase.value) {
    errorMsg.value = '两次输入的口令不一致，请核对';
    return;
  }

  loading.value = true;
  try {
    await store.setupKeyBackup(passphrase.value);
    successMsg.value = '私钥已使用您的安全口令在本地加密 (600,000 轮 PBKDF2) 并同步至云端！';
    emit('backed-up');
    setTimeout(() => {
      emit('close');
    }, 1500);
  } catch (err) {
    errorMsg.value = err?.message || '私钥备份失败';
  } finally {
    loading.value = false;
  }
}

async function handleBackupWithPhrase() {
  errorMsg.value = '';
  successMsg.value = '';

  if (!generatedPhrase.value) {
    errorMsg.value = '未生成恢复短语';
    return;
  }
  if (!phraseConfirmedSaved.value) {
    errorMsg.value = '请确认您已将 12 词恢复短语抄录或妥善保存';
    return;
  }

  loading.value = true;
  try {
    await store.setupKeyBackup(generatedPhrase.value);
    successMsg.value = '私钥已使用 12 词高熵恢复短语在本地加密并同步至云端！';
    emit('backed-up');
    setTimeout(() => {
      emit('close');
    }, 1500);
  } catch (err) {
    errorMsg.value = err?.message || '私钥备份失败';
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  if (props.show) {
    void refreshGeneratedPhrase();
  }
});
</script>

<template>
  <Transition name="modal">
    <div v-if="show" class="backup-modal-backdrop" @click.self="emit('close')">
      <div class="backup-modal-card" role="dialog" aria-modal="true">
        <div class="backup-modal-header">
          <div class="backup-icon-wrapper">
            <span class="backup-icon">🛡️</span>
          </div>
          <h3 class="backup-modal-title">端到端私钥安全备份</h3>
          <p class="backup-modal-subtitle">
            私钥在离开您的设备前将在本地使用 600,000 轮 PBKDF2 强化加密，服务端永不接触您的明文口令或私钥。
          </p>
        </div>

        <div class="backup-tab-bar">
          <button
            type="button"
            class="backup-tab-btn"
            :class="{ 'backup-tab-btn--active': activeTab === 'passphrase' }"
            @click="switchTab('passphrase')"
          >
            自定义安全口令
          </button>
          <button
            type="button"
            class="backup-tab-btn"
            :class="{ 'backup-tab-btn--active': activeTab === 'phrase' }"
            @click="switchTab('phrase')"
          >
            12 词高熵恢复短语
          </button>
        </div>

        <div v-if="activeTab === 'passphrase'" class="backup-body">
          <form class="backup-form" @submit.prevent="handleBackupWithPassphrase">
            <div class="form-group">
              <label class="form-label" for="backup-pass">设置 E2EE 安全口令</label>
              <div class="input-with-action">
                <input
                  id="backup-pass"
                  v-model="passphrase"
                  :type="showPassword ? 'text' : 'password'"
                  class="backup-input"
                  placeholder="独立安全口令 (不与登录密码强制绑定)"
                  autocomplete="new-password"
                />
                <button
                  type="button"
                  class="reveal-btn"
                  tabindex="-1"
                  @click="showPassword = !showPassword"
                >
                  {{ showPassword ? '🙈' : '👁️' }}
                </button>
              </div>
            </div>

            <div class="form-group">
              <label class="form-label" for="backup-pass-confirm">确认安全口令</label>
              <input
                id="backup-pass-confirm"
                v-model="confirmPassphrase"
                :type="showPassword ? 'text' : 'password'"
                class="backup-input"
                placeholder="请再次输入以确认"
                autocomplete="new-password"
              />
            </div>

            <div v-if="errorMsg" class="backup-alert backup-alert--error">
              <span>⚠️ {{ errorMsg }}</span>
            </div>
            <div v-if="successMsg" class="backup-alert backup-alert--success">
              <span>✅ {{ successMsg }}</span>
            </div>

            <div class="backup-actions">
              <button type="button" class="btn-cancel" @click="emit('close')">取消</button>
              <button
                type="submit"
                class="btn-confirm"
                :disabled="loading || !passphrase || !confirmPassphrase"
              >
                {{ loading ? '正在本地加密并上传...' : '立即加密备份' }}
              </button>
            </div>
          </form>
        </div>

        <div v-else class="backup-body">
          <div class="phrase-section">
            <div class="phrase-header-row">
              <span class="phrase-label">系统生成的 12 词高熵助记词 (128-bit)</span>
              <button type="button" class="phrase-regen-btn" @click="refreshGeneratedPhrase">
                🔄 换一组
              </button>
            </div>

            <div class="phrase-grid">
              <div
                v-for="(word, idx) in (generatedPhrase ? generatedPhrase.split(' ') : [])"
                :key="idx"
                class="phrase-chip"
              >
                <span class="phrase-chip-idx">{{ idx + 1 }}</span>
                <span class="phrase-chip-word">{{ word }}</span>
              </div>
            </div>

            <div class="phrase-copy-row">
              <button type="button" class="btn-copy" @click="copyPhrase">
                {{ phraseCopied ? '✅ 已复制到剪贴板' : '📋 一键复制 12 词' }}
              </button>
            </div>

            <label class="phrase-confirm-checkbox">
              <input v-model="phraseConfirmedSaved" type="checkbox" />
              <span>我已完整抄录或妥善保存以上 12 词恢复短语</span>
            </label>

            <div v-if="errorMsg" class="backup-alert backup-alert--error">
              <span>⚠️ {{ errorMsg }}</span>
            </div>
            <div v-if="successMsg" class="backup-alert backup-alert--success">
              <span>✅ {{ successMsg }}</span>
            </div>

            <div class="backup-actions">
              <button type="button" class="btn-cancel" @click="emit('close')">取消</button>
              <button
                type="button"
                class="btn-confirm"
                :disabled="loading || !phraseConfirmedSaved"
                @click="handleBackupWithPhrase"
              >
                {{ loading ? '正在本地加密并上传...' : '使用此短语备份私钥' }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.backup-modal-backdrop {
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

.backup-modal-card {
  width: 100%;
  max-width: 480px;
  background: #ffffff;
  border-radius: 20px;
  box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25), 0 0 0 1px rgba(0, 0, 0, 0.05);
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.backup-modal-header {
  text-align: center;
}

.backup-icon-wrapper {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  border-radius: 14px;
  background: rgba(16, 185, 129, 0.1);
  margin-bottom: 10px;
}

.backup-icon {
  font-size: 24px;
}

.backup-modal-title {
  font-size: 18px;
  font-weight: 700;
  color: #0f172a;
  margin: 0 0 6px;
}

.backup-modal-subtitle {
  font-size: 12px;
  line-height: 1.5;
  color: #64748b;
  margin: 0;
}

.backup-tab-bar {
  display: flex;
  gap: 4px;
  background: #f1f5f9;
  padding: 4px;
  border-radius: 10px;
}

.backup-tab-btn {
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

.backup-tab-btn--active {
  background: #ffffff;
  color: #0f172a;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
}

.backup-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.backup-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
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

.input-with-action {
  position: relative;
  display: flex;
  align-items: center;
}

.backup-input {
  width: 100%;
  padding: 10px 14px;
  font-size: 14px;
  border: 1px solid #cbd5e1;
  border-radius: 10px;
  outline: none;
  color: #0f172a;
  background: #f8fafc;
  transition: border-color 0.15s ease;
}

.backup-input:focus {
  border-color: #10b981;
  background: #ffffff;
  box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.12);
}

.reveal-btn {
  position: absolute;
  right: 10px;
  background: none;
  border: none;
  font-size: 16px;
  cursor: pointer;
  padding: 4px;
  opacity: 0.7;
}

.phrase-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.phrase-header-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.phrase-label {
  font-size: 12px;
  font-weight: 600;
  color: #334155;
}

.phrase-regen-btn {
  background: none;
  border: none;
  font-size: 12px;
  color: #2563eb;
  cursor: pointer;
}

.phrase-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  background: #f8fafc;
  padding: 12px;
  border-radius: 12px;
  border: 1px dashed #cbd5e1;
}

.phrase-chip {
  display: flex;
  align-items: center;
  gap: 6px;
  background: #ffffff;
  padding: 6px 8px;
  border-radius: 6px;
  border: 1px solid #e2e8f0;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}

.phrase-chip-idx {
  font-size: 10px;
  color: #94a3b8;
  font-weight: 600;
}

.phrase-chip-word {
  font-size: 12px;
  color: #0f172a;
  font-weight: 600;
}

.phrase-copy-row {
  display: flex;
}

.btn-copy {
  width: 100%;
  padding: 8px;
  border: 1px solid #cbd5e1;
  background: #ffffff;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
  color: #334155;
  cursor: pointer;
  transition: all 0.15s ease;
}

.btn-copy:hover {
  background: #f1f5f9;
}

.phrase-confirm-checkbox {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: #475569;
  cursor: pointer;
  user-select: none;
}

.backup-alert {
  padding: 8px 12px;
  border-radius: 8px;
  font-size: 12px;
  line-height: 1.4;
}

.backup-alert--error {
  background: #fef2f2;
  border: 1px solid #fecaca;
  color: #dc2626;
}

.backup-alert--success {
  background: #ecfdf5;
  border: 1px solid #a7f3d0;
  color: #059669;
}

.backup-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 4px;
}

.btn-cancel {
  padding: 10px 16px;
  border: 1px solid #cbd5e1;
  background: #ffffff;
  color: #475569;
  font-size: 13px;
  font-weight: 500;
  border-radius: 8px;
  cursor: pointer;
}

.btn-confirm {
  padding: 10px 18px;
  border: none;
  background: #10b981;
  color: #ffffff;
  font-size: 13px;
  font-weight: 600;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s ease;
}

.btn-confirm:hover:not(:disabled) {
  background: #059669;
}

.btn-confirm:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

/* Dark mode */
@media (prefers-color-scheme: dark) {
  :global(html.dark) .backup-modal-card {
    background: #1e293b;
    border-color: #334155;
  }
  :global(html.dark) .backup-modal-title {
    color: #f8fafc;
  }
  :global(html.dark) .backup-modal-subtitle {
    color: #94a3b8;
  }
  :global(html.dark) .backup-tab-bar {
    background: #0f172a;
  }
  :global(html.dark) .backup-tab-btn {
    color: #94a3b8;
  }
  :global(html.dark) .backup-tab-btn--active {
    background: #334155;
    color: #f8fafc;
  }
  :global(html.dark) .form-label,
  :global(html.dark) .phrase-label {
    color: #cbd5e1;
  }
  :global(html.dark) .backup-input {
    background: #0f172a;
    border-color: #334155;
    color: #f8fafc;
  }
  :global(html.dark) .phrase-grid {
    background: #0f172a;
    border-color: #334155;
  }
  :global(html.dark) .phrase-chip {
    background: #1e293b;
    border-color: #334155;
  }
  :global(html.dark) .phrase-chip-word {
    color: #f8fafc;
  }
  :global(html.dark) .btn-copy,
  :global(html.dark) .btn-cancel {
    background: #1e293b;
    border-color: #334155;
    color: #cbd5e1;
  }
}
</style>
