<script setup>
import { onMounted, reactive, ref } from 'vue';
import api from '../../api.js';
import UiButton from '../ui/Button.vue';
import UiSurface from '../ui/Surface.vue';

const loading = ref(false);
const saving = ref(false);
const testing = ref(false);
const error = ref('');
const successMessage = ref('');
const testMessage = ref('');
const testSuccess = ref(false);
const showSecret = ref(false);

const form = reactive({
  callsEnabled: false,
  callsAppId: '',
  callsAppSecret: '',
  callsAppSecretConfigured: false,
  callsAppSource: 'none'
});

async function loadSettings() {
  loading.value = true;
  error.value = '';
  try {
    const payload = await api.adminSiteSettings();
    const site = payload.site || {};
    form.callsEnabled = Boolean(site.callsEnabled);
    form.callsAppId = site.callsAppId || '';
    form.callsAppSecret = '';
    form.callsAppSecretConfigured = Boolean(site.callsAppSecretConfigured);
    form.callsAppSource = site.callsAppSource || 'none';
  } catch (currentError) {
    error.value = currentError.message;
  } finally {
    loading.value = false;
  }
}

async function saveSettings() {
  saving.value = true;
  error.value = '';
  successMessage.value = '';
  try {
    const updatePayload = {
      callsEnabled: form.callsEnabled,
      callsAppId: form.callsAppId.trim()
    };
    if (form.callsAppSecret.trim()) {
      updatePayload.callsAppSecret = form.callsAppSecret.trim();
    }
    const payload = await api.updateAdminSiteSettings(updatePayload);
    const site = payload.site || {};
    form.callsEnabled = Boolean(site.callsEnabled);
    form.callsAppId = site.callsAppId || '';
    form.callsAppSecret = '';
    form.callsAppSecretConfigured = Boolean(site.callsAppSecretConfigured);
    form.callsAppSource = site.callsAppSource || 'none';
    successMessage.value = '语音通话与 SFU 服务器配置已保存并实时生效';
    setTimeout(() => {
      if (successMessage.value === '语音通话与 SFU 服务器配置已保存并实时生效') {
        successMessage.value = '';
      }
    }, 3500);
  } catch (currentError) {
    error.value = currentError.message;
  } finally {
    saving.value = false;
  }
}

async function handleTestConnection() {
  testing.value = true;
  testMessage.value = '';
  testSuccess.value = false;
  try {
    const payload = {
      callsAppId: form.callsAppId.trim()
    };
    if (form.callsAppSecret.trim()) {
      payload.callsAppSecret = form.callsAppSecret.trim();
    }
    const res = await api.testCallsSettings(payload);
    if (res.ok) {
      testSuccess.value = true;
      testMessage.value = `✅ ${res.message || '连接正常，已成功与 Cloudflare Calls SFU Anycast 边缘节点握手'}`;
    } else {
      testSuccess.value = false;
      testMessage.value = `❌ ${res.error || '测试失败'}`;
    }
  } catch (err) {
    testSuccess.value = false;
    testMessage.value = `❌ ${err.message || '网络连接失败'}`;
  } finally {
    testing.value = false;
  }
}

onMounted(loadSettings);
</script>

<template>
  <UiSurface class="panel admin-calls-settings">
    <div class="admin-calls-settings__heading">
      <div>
        <h3 class="panel-title">语音通话与 SFU 服务器 (Cloudflare Calls)</h3>
        <p>配置基于 Cloudflare Calls Anycast 的无服务器 SFU，支持私聊语音电话与群聊多人语音会议。</p>
      </div>
      <UiButton variant="secondary" size="sm" :disabled="loading" @click="loadSettings">
        {{ loading ? '读取中...' : '重新读取' }}
      </UiButton>
    </div>

    <p v-if="error" class="error-text">{{ error }}</p>
    <p v-if="successMessage" class="success-text">{{ successMessage }}</p>

    <div class="calls-config-body">
      <!-- 功能总开关 -->
      <div class="calls-field-toggle">
        <label class="calls-toggle-label">
          <input
            v-model="form.callsEnabled"
            type="checkbox"
            class="calls-toggle-checkbox"
          />
          <span class="calls-toggle-switch"></span>
          <span class="calls-toggle-text">
            <strong>启用语音通话功能</strong>
            <small>开启后，聊天界面将显示语音通话与群会议入口</small>
          </span>
        </label>
      </div>

      <!-- 参数来源提示 -->
      <div class="calls-source-badge-row">
        <span class="calls-source-label">当前配置来源：</span>
        <span
          class="calls-source-badge"
          :class="{
            'calls-source-badge--env': form.callsAppSource === 'environment',
            'calls-source-badge--db': form.callsAppSource === 'database',
            'calls-source-badge--none': form.callsAppSource === 'none'
          }"
        >
          {{ form.callsAppSource === 'environment' ? '一键部署脚本环境变量 (自动创建)' : (form.callsAppSource === 'database' ? '管理后台数据库 (手动配置)' : '未配置') }}
        </span>
      </div>

      <!-- App ID 输入框 -->
      <div class="calls-input-group">
        <label class="calls-label" for="calls-app-id">
          <span>Calls App ID (UID)</span>
          <small>Cloudflare Dashboard -> Calls -> 应用详情中的 App ID</small>
        </label>
        <input
          id="calls-app-id"
          v-model="form.callsAppId"
          type="text"
          class="calls-input"
          placeholder="例如：68a1b2c3d4e5f67890abcdef12345678"
          autocomplete="off"
        />
      </div>

      <!-- App Secret 输入框 -->
      <div class="calls-input-group">
        <label class="calls-label" for="calls-app-secret">
          <span>Calls App Secret (接入密钥)</span>
          <small>{{ form.callsAppSecretConfigured ? '已配置密钥。如需更换请输入新密钥，留空则保持原密钥' : '请输入 Cloudflare Calls App API Token' }}</small>
        </label>
        <div class="calls-secret-wrapper">
          <input
            id="calls-app-secret"
            v-model="form.callsAppSecret"
            :type="showSecret ? 'text' : 'password'"
            class="calls-input calls-input--secret"
            :placeholder="form.callsAppSecretConfigured ? '•••••••••••••••••••••••• (已保存，留空则不修改)' : '请输入 Calls App Secret'"
            autocomplete="new-password"
          />
          <button
            type="button"
            class="calls-secret-toggle"
            @click="showSecret = !showSecret"
          >
            {{ showSecret ? '隐藏' : '显示' }}
          </button>
        </div>
      </div>

      <!-- 测试结果提示 -->
      <div v-if="testMessage" class="calls-test-banner" :class="{ 'calls-test-banner--success': testSuccess, 'calls-test-banner--error': !testSuccess }">
        {{ testMessage }}
      </div>

      <!-- 操作按钮栏 -->
      <div class="calls-actions">
        <UiButton
          type="button"
          variant="secondary"
          :disabled="testing || loading"
          @click="handleTestConnection"
        >
          {{ testing ? '正在握手测试...' : '🔌 测试 SFU 连通性' }}
        </UiButton>
        <UiButton
          type="button"
          variant="primary"
          :disabled="saving || loading"
          @click="saveSettings"
        >
          {{ saving ? '正在保存...' : '保存 SFU 配置' }}
        </UiButton>
      </div>
    </div>
  </UiSurface>
</template>

<style scoped>
.admin-calls-settings {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  padding: 1.5rem;
}

.admin-calls-settings__heading {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1rem;
}

.panel-title {
  margin: 0 0 0.25rem;
  font-size: 1.125rem;
  font-weight: 600;
  color: var(--color-text-primary, #111b21);
}

.admin-calls-settings__heading p {
  margin: 0;
  font-size: 0.875rem;
  color: var(--color-text-secondary, #667781);
}

.calls-config-body {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.calls-field-toggle {
  padding: 0.75rem 1rem;
  background: var(--color-surface-hover, #f8fafc);
  border: 1px solid var(--color-border, #e2e8f0);
  border-radius: 8px;
}

.calls-toggle-label {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  cursor: pointer;
}

.calls-toggle-checkbox {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}

.calls-toggle-switch {
  position: relative;
  width: 40px;
  height: 22px;
  background: #cbd5e1;
  border-radius: 20px;
  transition: background-color 0.2s;
  flex-shrink: 0;
}

.calls-toggle-switch::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 18px;
  height: 18px;
  background: #ffffff;
  border-radius: 50%;
  transition: transform 0.2s;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
}

.calls-toggle-checkbox:checked + .calls-toggle-switch {
  background: #008069;
}

.calls-toggle-checkbox:checked + .calls-toggle-switch::after {
  transform: translateX(18px);
}

.calls-toggle-text {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.calls-toggle-text strong {
  font-size: 0.9375rem;
  color: var(--color-text-primary, #111b21);
}

.calls-toggle-text small {
  font-size: 0.8125rem;
  color: var(--color-text-secondary, #667781);
}

.calls-source-badge-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.8125rem;
}

.calls-source-label {
  color: var(--color-text-secondary, #667781);
}

.calls-source-badge {
  display: inline-flex;
  align-items: center;
  padding: 0.15rem 0.5rem;
  border-radius: 4px;
  font-weight: 500;
  font-size: 0.75rem;
}

.calls-source-badge--env {
  background: #e0f2fe;
  color: #0369a1;
}

.calls-source-badge--db {
  background: #dcfce7;
  color: #15803d;
}

.calls-source-badge--none {
  background: #f1f5f9;
  color: #64748b;
}

.calls-input-group {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.calls-label {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
}

.calls-label span {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--color-text-primary, #111b21);
}

.calls-label small {
  font-size: 0.8125rem;
  color: var(--color-text-secondary, #667781);
}

.calls-input {
  width: 100%;
  height: 38px;
  padding: 0 0.75rem;
  font-size: 0.875rem;
  font-family: monospace;
  border: 1px solid var(--color-border, #cbd5e1);
  border-radius: 6px;
  background: var(--color-surface, #ffffff);
  color: var(--color-text-primary, #111b21);
  outline: none;
  transition: border-color 0.15s;
}

.calls-input:focus {
  border-color: #008069;
}

.calls-secret-wrapper {
  position: relative;
  display: flex;
  align-items: center;
}

.calls-input--secret {
  padding-right: 4rem;
}

.calls-secret-toggle {
  position: absolute;
  right: 0.5rem;
  padding: 0.25rem 0.5rem;
  background: transparent;
  border: none;
  font-size: 0.75rem;
  color: #008069;
  cursor: pointer;
}

.calls-test-banner {
  padding: 0.75rem 1rem;
  border-radius: 6px;
  font-size: 0.875rem;
  line-height: 1.4;
}

.calls-test-banner--success {
  background: #f0fdf4;
  border: 1px solid #bbf7d0;
  color: #166534;
}

.calls-test-banner--error {
  background: #fef2f2;
  border: 1px solid #fecaca;
  color: #991b1b;
}

.calls-actions {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 0.75rem;
  margin-top: 0.5rem;
}

.error-text {
  margin: 0;
  padding: 0.5rem 0.75rem;
  background: #fee2e2;
  color: #dc2626;
  border-radius: 6px;
  font-size: 0.875rem;
}

.success-text {
  margin: 0;
  padding: 0.5rem 0.75rem;
  background: #f0fdf4;
  color: #16a34a;
  border-radius: 6px;
  font-size: 0.875rem;
}
</style>
