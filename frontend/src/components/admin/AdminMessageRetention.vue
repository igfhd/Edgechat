<script setup>
import { onMounted, reactive, ref } from 'vue';
import api from '../../api.js';
import UiButton from '../ui/Button.vue';
import UiSurface from '../ui/Surface.vue';

const loading = ref(false);
const saving = ref(false);
const runningGc = ref(false);
const error = ref('');
const successMessage = ref('');
const gcResult = ref(null);

const presetDays = [3, 7, 10, 15, 30, 90];

const form = reactive({
  autoCleanupEnabled: true,
  messageRetentionDays: 7,
  deletionPolicy: 'daily_reset_purge'
});

async function loadSettings() {
  loading.value = true;
  error.value = '';
  try {
    const payload = await api.adminSiteSettings();
    form.autoCleanupEnabled = payload.site?.autoCleanupEnabled ?? true;
    form.messageRetentionDays = Number(payload.site?.messageRetentionDays) || 7;
    form.deletionPolicy = payload.site?.deletionPolicy || 'daily_reset_purge';
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
    const days = Math.max(1, Math.min(3650, Number(form.messageRetentionDays) || 7));
    const payload = await api.updateAdminSiteSettings({
      autoCleanupEnabled: form.autoCleanupEnabled,
      messageRetentionDays: days,
      deletionPolicy: form.deletionPolicy
    });
    form.autoCleanupEnabled = payload.site?.autoCleanupEnabled ?? true;
    form.messageRetentionDays = Number(payload.site?.messageRetentionDays) || 7;
    form.deletionPolicy = payload.site?.deletionPolicy || 'daily_reset_purge';
    successMessage.value = '消息清理与删除策略已保存';
    setTimeout(() => {
      if (successMessage.value === '消息清理与删除策略已保存') {
        successMessage.value = '';
      }
    }, 3000);
  } catch (currentError) {
    error.value = currentError.message;
  } finally {
    saving.value = false;
  }
}

async function runManualCleanup() {
  if (!window.confirm(`确认立即执行一次清理吗？系统将粉碎所有软删除的群组、消息及超过 ${form.messageRetentionDays} 天的过期消息，此操作不可逆。`)) {
    return;
  }
  runningGc.value = true;
  error.value = '';
  gcResult.value = null;
  try {
    const res = await api.runAdminGc();
    gcResult.value = res.summary || {};
  } catch (currentError) {
    error.value = currentError.message;
  } finally {
    runningGc.value = false;
  }
}

function selectPreset(days) {
  form.messageRetentionDays = days;
}

onMounted(loadSettings);
</script>

<template>
  <UiSurface class="panel admin-message-retention">
    <div class="admin-message-retention__heading">
      <div>
        <h3 class="panel-title">聊天清理与数据粉碎策略</h3>
        <p>设定群聊与消息的删除粉碎模式及消息保留期限。系统在每日北京时间 07:55（23:55 UTC，即 Cloudflare 免费配额重置前 5 分钟）自动进行物理粉碎与清理。</p>
      </div>
      <UiButton variant="secondary" size="sm" :disabled="loading" @click="loadSettings">
        {{ loading ? '读取中...' : '重新读取' }}
      </UiButton>
    </div>

    <p v-if="error" class="error-text">{{ error }}</p>
    <p v-if="successMessage" class="success-text">{{ successMessage }}</p>

    <div class="retention-config-body">
      <div class="field deletion-policy-field">
        <label>
          <strong>聊天删除策略</strong>
          <span class="field-sublabel">群组与聊天消息的删除模式（云盘回收站独立不受此影响）</span>
        </label>
        <div class="policy-radio-cards">
          <label class="policy-card" :class="{ 'policy-card--active': form.deletionPolicy === 'daily_reset_purge' }">
            <input v-model="form.deletionPolicy" type="radio" value="daily_reset_purge" />
            <div class="policy-card__content">
              <div class="policy-card__title">
                <span>每日重置前物理粉碎</span>
                <span class="policy-badge">推荐</span>
              </div>
              <p>日常操作立即释放群名称并软删除，节省白天峰值写入额度；每日 23:55 UTC（07:55 北京时间）利用当日剩余额度彻底物理粉碎并清理 R2 附件，5 分钟后配额即重置。</p>
            </div>
          </label>

          <label class="policy-card" :class="{ 'policy-card--active': form.deletionPolicy === 'immediate_purge' }">
            <input v-model="form.deletionPolicy" type="radio" value="immediate_purge" />
            <div class="policy-card__content">
              <div class="policy-card__title">
                <span>立即级联物理硬删除</span>
              </div>
              <p>删除时立即物理销毁群组、消息及其关联附件。适合对数据即时物理抹除有强需求的环境，白天操作会直接消耗 D1 数据库写入配额。</p>
            </div>
          </label>
        </div>
      </div>

      <label class="toggle-field">
        <input v-model="form.autoCleanupEnabled" type="checkbox" />
        <div class="toggle-field__info">
          <strong>启用每日定时自动清理</strong>
          <span>开启后，Cloudflare 定时任务将在每日北京时间 07:55（23:55 UTC）自动触发清理</span>
        </div>
      </label>

      <div class="field retention-days-field" :class="{ 'field--disabled': !form.autoCleanupEnabled }">
        <label for="retention-days-input">
          <span>消息保留天数（天）</span>
        </label>
        <div class="retention-input-row">
          <input
            id="retention-days-input"
            v-model.number="form.messageRetentionDays"
            type="number"
            min="1"
            max="3650"
            :disabled="!form.autoCleanupEnabled"
            placeholder="默认 7 天"
          />
          <div class="preset-pill-group">
            <button
              v-for="d in presetDays"
              :key="d"
              type="button"
              class="preset-pill"
              :class="{ 'preset-pill--active': form.messageRetentionDays === d }"
              :disabled="!form.autoCleanupEnabled"
              @click="selectPreset(d)"
            >
              {{ d }} 天
            </button>
          </div>
        </div>
        <p class="field-hint">
          超过该天数的消息（包括文本、图片、音视频、文件附件及关联的 R2 存储）将被永久安全清除。
        </p>
      </div>

      <div class="inline-actions retention-actions">
        <UiButton :disabled="saving" @click="saveSettings">
          {{ saving ? '保存中...' : '保存策略' }}
        </UiButton>
        <UiButton
          variant="secondary"
          :disabled="runningGc"
          @click="runManualCleanup"
        >
          {{ runningGc ? '清理执行中...' : '立即执行一次清理' }}
        </UiButton>
      </div>

      <div v-if="gcResult" class="gc-result-banner">
        <strong>清理执行完成：</strong>
        <span>
          已粉碎 {{ (gcResult.expiredMessagesDeleted ?? 0) + (gcResult.softDeletedMessagesDeleted ?? 0) }} 条过期/软删消息，
          清理 {{ gcResult.channelsDeleted ?? 0 }} 个群组，
          清理 {{ gcResult.r2Deleted ?? 0 }} 个关联存储文件。
        </span>
      </div>
    </div>
  </UiSurface>
</template>

<style scoped>
.admin-message-retention {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.admin-message-retention__heading {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
}

.admin-message-retention__heading p {
  margin: 4px 0 0;
  font-size: 13px;
  color: #667781;
}

.retention-config-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.deletion-policy-field {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.field-sublabel {
  display: block;
  font-size: 12.5px;
  color: #64748b;
  margin-top: 2px;
  font-weight: normal;
}

.policy-radio-cards {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

@media (max-width: 640px) {
  .policy-radio-cards {
    grid-template-columns: 1fr;
  }
}

.policy-card {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px 14px;
  background: #ffffff;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.policy-card:hover {
  border-color: #008069;
}

.policy-card--active {
  border-color: #008069;
  background: #f1fdfb;
}

.policy-card input[type="radio"] {
  margin-top: 3px;
  accent-color: #008069;
}

.policy-card__content {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.policy-card__title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13.5px;
  font-weight: 600;
  color: #0f172a;
}

.policy-badge {
  font-size: 11px;
  font-weight: normal;
  padding: 1px 6px;
  border-radius: 4px;
  background: #008069;
  color: #ffffff;
}

.policy-card p {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: #64748b;
}

.toggle-field {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px 14px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  cursor: pointer;
  user-select: none;
}

.toggle-field input[type="checkbox"] {
  margin-top: 3px;
  width: 16px;
  height: 16px;
  cursor: pointer;
}

.toggle-field__info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.toggle-field__info strong {
  font-size: 14px;
  color: #0f172a;
}

.toggle-field__info span {
  font-size: 12.5px;
  color: #64748b;
}

.retention-days-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.retention-days-field.field--disabled {
  opacity: 0.55;
  pointer-events: none;
}

.retention-input-row {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.retention-input-row input {
  width: 130px;
  padding: 7px 10px;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  font-size: 14px;
}

.preset-pill-group {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.preset-pill {
  padding: 4px 10px;
  border: 1px solid #cbd5e1;
  background: #ffffff;
  border-radius: 14px;
  font-size: 12px;
  color: #475569;
  cursor: pointer;
  transition: all 0.15s ease;
}

.preset-pill:hover:not(:disabled) {
  border-color: #008069;
  color: #008069;
}

.preset-pill--active {
  background: #008069;
  border-color: #008069;
  color: #ffffff !important;
}

.field-hint {
  margin: 4px 0 0;
  font-size: 12px;
  color: #64748b;
}

.retention-actions {
  display: flex;
  gap: 10px;
  margin-top: 4px;
}

.success-text {
  margin: 0;
  padding: 8px 12px;
  background: #dcfce7;
  border: 1px solid #86efac;
  border-radius: 6px;
  font-size: 13px;
  color: #166534;
}

.gc-result-banner {
  padding: 10px 14px;
  background: #eff6ff;
  border: 1px solid #bfdbfe;
  border-radius: 6px;
  font-size: 13px;
  color: #1e40af;
  display: flex;
  align-items: center;
  gap: 6px;
}
</style>
