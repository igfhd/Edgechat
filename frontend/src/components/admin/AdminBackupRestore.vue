<script setup>
import { computed, reactive, ref } from 'vue';
import { Download, Upload, ShieldCheck, AlertTriangle, CheckCircle2, FileJson, RefreshCw } from '@lucide/vue';
import api from '../../api.js';
import UiButton from '../ui/Button.vue';
import UiSurface from '../ui/Surface.vue';

const exporting = ref(false);
const exportError = ref('');
const exportSuccess = ref('');

const fileInput = ref(null);
const parsing = ref(false);
const importing = ref(false);
const importError = ref('');
const importSuccess = ref('');
const backupPayload = ref(null);
const previewData = ref(null);
const importResult = ref(null);

const options = reactive({
  adminConflictStrategy: 'keep_current',
  userConflictStrategy: 'skip',
  importSettings: false
});

async function handleExport() {
  exporting.value = true;
  exportError.value = '';
  exportSuccess.value = '';
  try {
    const data = await api.adminBackupExport();
    const jsonStr = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const dateStr = new Date().toISOString().slice(0, 10);
    link.href = url;
    link.download = `edgechat-backup-${dateStr}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    exportSuccess.value = `已成功导出 ${data.summary?.usersCount || 0} 个用户及组织数据！`;
    setTimeout(() => { exportSuccess.value = ''; }, 4000);
  } catch (err) {
    exportError.value = err.message || '导出数据失败';
  } finally {
    exporting.value = false;
  }
}

function triggerFileInput() {
  fileInput.value?.click();
}

async function handleFileSelect(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  importError.value = '';
  importSuccess.value = '';
  importResult.value = null;
  previewData.value = null;
  parsing.value = true;

  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    backupPayload.value = parsed;
    const preview = await api.adminBackupPreview(parsed);
    previewData.value = preview;
  } catch (err) {
    importError.value = err.message || '解析备份文件失败，请确保上传有效的 Edgechat 备份 JSON 文件';
    backupPayload.value = null;
    previewData.value = null;
  } finally {
    parsing.value = false;
    if (fileInput.value) fileInput.value.value = '';
  }
}

async function handleImport() {
  if (!backupPayload.value) return;
  importing.value = true;
  importError.value = '';
  importSuccess.value = '';
  try {
    const payload = {
      backup: backupPayload.value,
      adminConflictStrategy: options.adminConflictStrategy,
      userConflictStrategy: options.userConflictStrategy,
      importSettings: options.importSettings
    };
    const res = await api.adminBackupImport(payload);
    importResult.value = res.imported || {};
    importSuccess.value = '数据恢复成功！';
    previewData.value = null;
    backupPayload.value = null;
  } catch (err) {
    importError.value = err.message || '导入数据失败';
  } finally {
    importing.value = false;
  }
}

function cancelImport() {
  previewData.value = null;
  backupPayload.value = null;
  importError.value = '';
}
</script>

<template>
  <UiSurface class="panel admin-backup-restore">
    <div class="admin-backup-restore__heading">
      <div>
        <h3 class="panel-title">数据备份与恢复 (用户与配置迁移)</h3>
        <p>支持将服务器中的所有用户、分组及基础架构导出为便携 JSON 文件，或导入外部备份。不含任何历史聊天消息及私钥口令。</p>
      </div>
    </div>

    <div class="backup-grid">
      <!-- 导出卡片 -->
      <div class="backup-card">
        <div class="backup-card__header">
          <div class="backup-card__icon-box backup-card__icon-box--export">
            <Download :size="20" />
          </div>
          <div>
            <h4 class="backup-card__title">导出数据备份</h4>
            <p class="backup-card__desc">生成脱敏安全备份包，包含用户账号、权限、分组与群聊体系。</p>
          </div>
        </div>

        <div class="backup-card__features">
          <div class="feature-item">
            <ShieldCheck :size="16" class="feature-icon feature-icon--safe" />
            <span><strong>私钥完全脱敏：</strong>不导出用户的 E2EE 私钥与口令，恢复后用户自动生成新私钥</span>
          </div>
          <div class="feature-item">
            <ShieldCheck :size="16" class="feature-icon feature-icon--safe" />
            <span><strong>纯净架构：</strong>不导出历史聊天消息与附件，备份包极致轻量便携</span>
          </div>
        </div>

        <div v-if="exportError" class="backup-alert backup-alert--error">
          {{ exportError }}
        </div>
        <div v-if="exportSuccess" class="backup-alert backup-alert--success">
          {{ exportSuccess }}
        </div>

        <div class="backup-card__action">
          <UiButton
            type="button"
            variant="primary"
            :disabled="exporting"
            @click="handleExport"
          >
            <Download :size="16" aria-hidden="true" />
            {{ exporting ? '正在生成备份...' : '立即导出备份文件 (.json)' }}
          </UiButton>
        </div>
      </div>

      <!-- 导入卡片 -->
      <div class="backup-card">
        <div class="backup-card__header">
          <div class="backup-card__icon-box backup-card__icon-box--import">
            <Upload :size="20" />
          </div>
          <div>
            <h4 class="backup-card__title">导入数据恢复</h4>
            <p class="backup-card__desc">从备份 JSON 文件恢复用户体系，支持智能冲突解决与预检机制。</p>
          </div>
        </div>

        <input
          ref="fileInput"
          type="file"
          accept=".json,application/json"
          class="visually-hidden-file-input"
          @change="handleFileSelect"
        />

        <div v-if="importError" class="backup-alert backup-alert--error">
          {{ importError }}
        </div>
        <div v-if="importSuccess" class="backup-alert backup-alert--success">
          {{ importSuccess }}
        </div>

        <!-- 导入完成摘要 -->
        <div v-if="importResult" class="import-summary-box">
          <div class="import-summary-header">
            <CheckCircle2 :size="18" class="text-green" />
            <strong>导入执行结果摘要</strong>
          </div>
          <div class="import-summary-metrics">
            <div class="summary-metric">
              <span>新建用户</span>
              <strong>{{ importResult.usersCreated }}</strong>
            </div>
            <div class="summary-metric">
              <span>更新用户</span>
              <strong>{{ importResult.usersUpdated }}</strong>
            </div>
            <div class="summary-metric">
              <span>跳过用户</span>
              <strong>{{ importResult.usersSkipped }}</strong>
            </div>
            <div class="summary-metric">
              <span>恢复分组</span>
              <strong>{{ importResult.groupsCreated }}</strong>
            </div>
          </div>
        </div>

        <!-- 预检分析区域 -->
        <div v-if="previewData" class="preview-box">
          <div class="preview-header">
            <FileJson :size="18" class="text-blue" />
            <div>
              <strong>备份预检报告 (共 {{ previewData.totalUsersInBackup }} 个用户)</strong>
              <small>备份导出时间：{{ previewData.exportedAt || '未知' }}</small>
            </div>
          </div>

          <div class="preview-stats-row">
            <span class="badge badge-new">待新增用户: {{ previewData.newUsersCount }}</span>
            <span class="badge badge-conflict" :class="{ 'badge-conflict--warn': previewData.conflictsCount > 0 }">
              已存在同名用户: {{ previewData.conflictsCount }}
            </span>
          </div>

          <!-- 冲突策略配置 -->
          <div class="conflict-options">
            <div class="option-group">
              <label class="option-label">管理员冲突处理策略 (Admin Conflict)</label>
              <div class="radio-options">
                <label class="radio-label">
                  <input
                    v-model="options.adminConflictStrategy"
                    type="radio"
                    value="keep_current"
                  />
                  <span>
                    <strong>保留当前环境管理员（推荐）</strong>
                    <small>保护当前登录管理员的密码与登录凭证，防止被锁在后台之外</small>
                  </span>
                </label>
                <label class="radio-label">
                  <input
                    v-model="options.adminConflictStrategy"
                    type="radio"
                    value="overwrite"
                  />
                  <span>
                    <strong>使用备份覆盖管理员</strong>
                    <small>将当前管理员密码重置为备份中的密码</small>
                  </span>
                </label>
              </div>
            </div>

            <div class="option-group">
              <label class="option-label">普通重名用户冲突策略</label>
              <div class="radio-options">
                <label class="radio-label">
                  <input
                    v-model="options.userConflictStrategy"
                    type="radio"
                    value="skip"
                  />
                  <span>跳过已存在用户（保留现有密码与资料）</span>
                </label>
                <label class="radio-label">
                  <input
                    v-model="options.userConflictStrategy"
                    type="radio"
                    value="update"
                  />
                  <span>覆盖已存在用户（更新资料与密码）</span>
                </label>
              </div>
            </div>
          </div>

          <div class="preview-actions">
            <UiButton
              type="button"
              variant="secondary"
              size="sm"
              :disabled="importing"
              @click="cancelImport"
            >
              取消
            </UiButton>
            <UiButton
              type="button"
              variant="primary"
              size="sm"
              :disabled="importing"
              @click="handleImport"
            >
              {{ importing ? '正在恢复写入中...' : '确认执行恢复' }}
            </UiButton>
          </div>
        </div>

        <div v-else class="backup-card__action">
          <UiButton
            type="button"
            variant="secondary"
            :disabled="parsing"
            @click="triggerFileInput"
          >
            <Upload :size="16" aria-hidden="true" />
            {{ parsing ? '正在解析备份文件...' : '选择备份文件并预检 (.json)' }}
          </UiButton>
        </div>
      </div>
    </div>
  </UiSurface>
</template>

<style scoped>
.admin-backup-restore {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  padding: 1.5rem;
}

.admin-backup-restore__heading {
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

.admin-backup-restore__heading p {
  margin: 0;
  font-size: 0.875rem;
  color: var(--color-text-secondary, #667781);
}

.backup-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 1.25rem;
}

@media (max-width: 860px) {
  .backup-grid {
    grid-template-columns: 1fr;
  }
}

.backup-card {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 1.25rem;
  border: 1px solid var(--color-border, #e2e8f0);
  border-radius: 10px;
  background: var(--color-surface, #ffffff);
  gap: 1rem;
}

.backup-card__header {
  display: flex;
  align-items: flex-start;
  gap: 0.875rem;
}

.backup-card__icon-box {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: 8px;
  flex-shrink: 0;
}

.backup-card__icon-box--export {
  background: #ecfdf5;
  color: #059669;
}

.backup-card__icon-box--import {
  background: #eff6ff;
  color: #2563eb;
}

.backup-card__title {
  margin: 0 0 0.2rem;
  font-size: 1rem;
  font-weight: 600;
  color: var(--color-text-primary, #111b21);
}

.backup-card__desc {
  margin: 0;
  font-size: 0.8125rem;
  color: var(--color-text-secondary, #667781);
  line-height: 1.4;
}

.backup-card__features {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.75rem;
  background: var(--color-surface-hover, #f8fafc);
  border-radius: 6px;
  font-size: 0.8125rem;
}

.feature-item {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  color: var(--color-text-secondary, #475569);
  line-height: 1.4;
}

.feature-icon--safe {
  color: #059669;
  flex-shrink: 0;
  margin-top: 2px;
}

.backup-alert {
  padding: 0.625rem 0.875rem;
  border-radius: 6px;
  font-size: 0.8125rem;
  line-height: 1.4;
}

.backup-alert--error {
  background: #fef2f2;
  border: 1px solid #fecaca;
  color: #991b1b;
}

.backup-alert--success {
  background: #f0fdf4;
  border: 1px solid #bbf7d0;
  color: #166534;
}

.backup-card__action {
  display: flex;
  justify-content: flex-end;
}

.preview-box {
  display: flex;
  flex-direction: column;
  gap: 0.875rem;
  padding: 1rem;
  background: #f8fafc;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
}

.preview-header {
  display: flex;
  align-items: center;
  gap: 0.625rem;
}

.preview-header strong {
  display: block;
  font-size: 0.875rem;
  color: #0f172a;
}

.preview-header small {
  display: block;
  font-size: 0.75rem;
  color: #64748b;
}

.preview-stats-row {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.badge {
  padding: 0.2rem 0.5rem;
  border-radius: 4px;
  font-size: 0.75rem;
  font-weight: 500;
}

.badge-new {
  background: #ecfdf5;
  color: #047857;
}

.badge-conflict {
  background: #f1f5f9;
  color: #475569;
}

.badge-conflict--warn {
  background: #fef3c7;
  color: #b45309;
}

.conflict-options {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 0.75rem;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
}

.option-group {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.option-label {
  font-size: 0.8125rem;
  font-weight: 600;
  color: #334155;
}

.radio-options {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.radio-label {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  font-size: 0.8125rem;
  color: #1e293b;
  cursor: pointer;
}

.radio-label small {
  display: block;
  color: #64748b;
  font-size: 0.75rem;
}

.preview-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  margin-top: 0.25rem;
}

.import-summary-box {
  padding: 0.875rem;
  background: #f0fdf4;
  border: 1px solid #bbf7d0;
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  gap: 0.625rem;
}

.import-summary-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.875rem;
  color: #166534;
}

.import-summary-metrics {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 0.5rem;
}

.summary-metric {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 0.4rem;
  background: #ffffff;
  border-radius: 4px;
  border: 1px solid #dcfce7;
}

.summary-metric span {
  font-size: 0.75rem;
  color: #64748b;
}

.summary-metric strong {
  font-size: 1rem;
  color: #15803d;
}

.text-green { color: #16a34a; }
.text-blue { color: #2563eb; }

.visually-hidden-file-input {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
  opacity: 0;
  pointer-events: none;
}
</style>

