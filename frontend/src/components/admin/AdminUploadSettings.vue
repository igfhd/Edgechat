<script setup>
import { onMounted, reactive, ref } from 'vue';
import api from '../../api.js';
import UiButton from '../ui/Button.vue';
import UiSurface from '../ui/Surface.vue';

const loading = ref(false);
const saving = ref(false);
const error = ref('');
const successMessage = ref('');

const presetSizes = [5, 10, 20, 50, 100];

const form = reactive({
  uploadMaxFileSizeMb: 20,
  uploadRestrictionMode: 'none', // 'none' | 'allowlist' | 'blocklist'
  uploadAllowedTypes: 'image/*, video/*, audio/*, pdf, doc, docx, xls, xlsx, ppt, pptx, txt, zip, 7z, tar, gz',
  uploadBlockedTypes: 'exe, bat, cmd, sh, php'
});

async function loadSettings() {
  loading.value = true;
  error.value = '';
  try {
    const payload = await api.adminSiteSettings();
    form.uploadMaxFileSizeMb = Number(payload.site?.uploadMaxFileSizeMb) || 20;
    form.uploadRestrictionMode = payload.site?.uploadRestrictionMode || 'none';
    form.uploadAllowedTypes = payload.site?.uploadAllowedTypes || 'image/*, video/*, audio/*, pdf, doc, docx, xls, xlsx, ppt, pptx, txt, zip, 7z, tar, gz';
    form.uploadBlockedTypes = payload.site?.uploadBlockedTypes || 'exe, bat, cmd, sh, php';
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
    const sizeMb = Math.max(1, Math.min(100, Number(form.uploadMaxFileSizeMb) || 20));
    const payload = await api.updateAdminSiteSettings({
      uploadMaxFileSizeMb: sizeMb,
      uploadRestrictionMode: form.uploadRestrictionMode,
      uploadAllowedTypes: form.uploadAllowedTypes,
      uploadBlockedTypes: form.uploadBlockedTypes
    });
    form.uploadMaxFileSizeMb = Number(payload.site?.uploadMaxFileSizeMb) || 20;
    form.uploadRestrictionMode = payload.site?.uploadRestrictionMode || 'none';
    form.uploadAllowedTypes = payload.site?.uploadAllowedTypes || '';
    form.uploadBlockedTypes = payload.site?.uploadBlockedTypes || '';
    successMessage.value = '文件上传限制策略已保存';
    setTimeout(() => {
      if (successMessage.value === '文件上传限制策略已保存') {
        successMessage.value = '';
      }
    }, 3000);
  } catch (currentError) {
    error.value = currentError.message;
  } finally {
    saving.value = false;
  }
}

function appendToAllowed(preset) {
  const current = form.uploadAllowedTypes.trim();
  const additions = preset.split(',').map((s) => s.trim()).filter(Boolean);
  const currentList = current ? current.split(',').map((s) => s.trim()).filter(Boolean) : [];
  const set = new Set([...currentList, ...additions]);
  form.uploadAllowedTypes = Array.from(set).join(', ');
}

function appendToBlocked(preset) {
  const current = form.uploadBlockedTypes.trim();
  const additions = preset.split(',').map((s) => s.trim()).filter(Boolean);
  const currentList = current ? current.split(',').map((s) => s.trim()).filter(Boolean) : [];
  const set = new Set([...currentList, ...additions]);
  form.uploadBlockedTypes = Array.from(set).join(', ');
}

onMounted(loadSettings);
</script>

<template>
  <UiSurface class="panel admin-upload-settings">
    <div class="admin-upload-settings__heading">
    <div>
      <h3 class="panel-title">文件上传与类型限制</h3>
      <p>自定义单文件上传大小上限，以及禁止或允许上传的文件扩展名与 MIME 类型（对网盘与聊天界面附件全局生效）。</p>
    </div>
    <UiButton variant="secondary" size="sm" :disabled="loading" @click="loadSettings">
      {{ loading ? '读取中...' : '重新读取' }}
    </UiButton>
  </div>

  <p v-if="error" class="error-text">{{ error }}</p>
  <p v-if="successMessage" class="success-text">{{ successMessage }}</p>

  <div class="upload-config-body">
    <!-- File Size Limit -->
    <div class="field">
      <label for="upload-size-input">
        <span>单文件最大体积上限 (MB)</span>
      </label>
      <div class="size-input-row">
        <input
          id="upload-size-input"
          v-model.number="form.uploadMaxFileSizeMb"
          type="number"
          min="1"
          max="100"
          placeholder="默认 20MB"
        />
        <div class="preset-pill-group">
          <button
            v-for="s in presetSizes"
            :key="s"
            type="button"
            class="preset-pill"
            :class="{ 'preset-pill--active': form.uploadMaxFileSizeMb === s }"
            @click="form.uploadMaxFileSizeMb = s"
          >
            {{ s }} MB
          </button>
        </div>
      </div>
      <p class="field-hint">限制用户单次上传文件的最大大小（范围 1 ~ 100 MB）。</p>
    </div>

    <!-- Restriction Mode -->
    <div class="field">
      <label>
        <span>上传文件类型限制模式</span>
      </label>
      <div class="mode-cards-grid">
        <label
          class="mode-card"
          :class="{ 'mode-card--active': form.uploadRestrictionMode === 'none' }"
        >
          <input
            v-model="form.uploadRestrictionMode"
            type="radio"
            value="none"
            name="uploadRestrictionMode"
          />
          <div class="mode-card__content">
            <strong>🔓 自由模式（推荐）</strong>
            <span>允许上传绝大多数常见格式，仅封禁下方黑名单中的危险脚本/程序</span>
          </div>
        </label>

        <label
          class="mode-card"
          :class="{ 'mode-card--active': form.uploadRestrictionMode === 'blocklist' }"
        >
          <input
            v-model="form.uploadRestrictionMode"
            type="radio"
            value="blocklist"
            name="uploadRestrictionMode"
          />
          <div class="mode-card__content">
            <strong>🚫 黑名单模式</strong>
            <span>仅明确禁止列表中的指定后缀与类型，其余全部允许上传</span>
          </div>
        </label>

        <label
          class="mode-card"
          :class="{ 'mode-card--active': form.uploadRestrictionMode === 'allowlist' }"
        >
          <input
            v-model="form.uploadRestrictionMode"
            type="radio"
            value="allowlist"
            name="uploadRestrictionMode"
          />
          <div class="mode-card__content">
            <strong>🔒 白名单模式</strong>
            <span>严格限制！仅允许列表中指定的后缀与 MIME 类型上传，其余一律拒绝</span>
          </div>
        </label>
      </div>
    </div>

    <!-- Allowlist Config -->
    <div v-if="form.uploadRestrictionMode === 'allowlist'" class="field">
      <label for="allowed-types-input">
        <span>允许上传的文件类型列表 (白名单)</span>
      </label>
      <div class="preset-tag-row">
        <span>快捷添加预设：</span>
        <button type="button" class="tag-btn" @click="appendToAllowed('image/*, video/*, audio/*')">+ 多媒体 (图片/音视频)</button>
        <button type="button" class="tag-btn" @click="appendToAllowed('pdf, doc, docx, xls, xlsx, ppt, pptx')">+ 常用文档</button>
        <button type="button" class="tag-btn" @click="appendToAllowed('zip, 7z, rar, tar, gz')">+ 压缩文件</button>
        <button type="button" class="tag-btn" @click="appendToAllowed('txt, md, json, csv, log')">+ 文本与代码</button>
        <button type="button" class="tag-btn" @click="appendToAllowed('svg')">+ SVG 矢量图</button>
      </div>
      <textarea
        id="allowed-types-input"
        v-model="form.uploadAllowedTypes"
        rows="3"
        placeholder="例如：image/*, video/*, pdf, docx, zip, txt"
      ></textarea>
      <p class="field-hint">支持扩展名（如 <code>pdf, docx, png</code>）或 MIME 通配符（如 <code>image/*, video/*</code>），用逗号或空格分隔。</p>
    </div>

    <!-- Blocklist Config -->
    <div v-if="form.uploadRestrictionMode === 'blocklist' || form.uploadRestrictionMode === 'none'" class="field">
      <label for="blocked-types-input">
        <span>禁止上传的文件类型列表 (黑名单)</span>
      </label>
      <div class="preset-tag-row">
        <span>快捷添加预设：</span>
        <button type="button" class="tag-btn tag-btn--danger" @click="appendToBlocked('exe, bat, cmd, sh, php, msi')">+ 危险可执行文件</button>
        <button type="button" class="tag-btn tag-btn--danger" @click="appendToBlocked('html, htm, js, vbs')">+ 网页与脚本</button>
        <button type="button" class="tag-btn tag-btn--danger" @click="appendToBlocked('svg')">+ SVG 图片</button>
      </div>
      <textarea
        id="blocked-types-input"
        v-model="form.uploadBlockedTypes"
        rows="3"
        placeholder="例如：.exe, .bat, .cmd, .sh, .php 或 exe, bat, sh"
      ></textarea>
      <p class="field-hint">命中此列表的文件后缀或类型将被直接拦截，提示禁止上传。支持 <code>.bat, .sh, .exe</code> 或 <code>bat, sh, exe</code> 格式，对网盘与聊天附件全局生效。</p>
    </div>

      <div class="inline-actions">
        <UiButton :disabled="saving" @click="saveSettings">
          {{ saving ? '保存中...' : '保存上传策略' }}
        </UiButton>
      </div>
    </div>
  </UiSurface>
</template>

<style scoped>
.admin-upload-settings {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.admin-upload-settings__heading {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
}

.admin-upload-settings__heading p {
  margin: 4px 0 0;
  font-size: 13px;
  color: #667781;
}

.upload-config-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.size-input-row {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.size-input-row input {
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

.mode-cards-grid {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 4px;
}

.mode-card {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px 14px;
  background: #f8fafc;
  border: 1.5px solid #e2e8f0;
  border-radius: 10px;
  cursor: pointer;
  transition: all 0.15s ease;
  user-select: none;
}

.mode-card:hover {
  background: #f1f5f9;
  border-color: #cbd5e1;
}

.mode-card--active {
  background: #f0fdf4;
  border-color: #008069;
}

.mode-card input[type="radio"] {
  margin-top: 3px;
  width: 16px;
  height: 16px;
  cursor: pointer;
}

.mode-card__content {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.mode-card__content strong {
  font-size: 13.5px;
  color: #0f172a;
}

.mode-card__content span {
  font-size: 12px;
  color: #64748b;
}

.preset-tag-row {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  margin-bottom: 6px;
  font-size: 12px;
  color: #64748b;
}

.tag-btn {
  padding: 3px 8px;
  border: 1px dashed #cbd5e1;
  background: #ffffff;
  border-radius: 4px;
  font-size: 11.5px;
  color: #0369a1;
  cursor: pointer;
  transition: all 0.15s ease;
}

.tag-btn:hover {
  background: #f0f9ff;
  border-color: #0284c7;
}

.tag-btn--danger {
  color: #b91c1c;
}

.tag-btn--danger:hover {
  background: #fef2f2;
  border-color: #ef4444;
}

textarea {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  font-family: inherit;
  font-size: 13px;
  line-height: 1.5;
  resize: vertical;
}

textarea:focus {
  outline: none;
  border-color: #008069;
  box-shadow: 0 0 0 2px rgba(0, 128, 105, 0.15);
}

.field-hint {
  margin: 4px 0 0;
  font-size: 12px;
  color: #64748b;
}

.field-hint code {
  padding: 1px 4px;
  background: #f1f5f9;
  border-radius: 3px;
  font-family: monospace;
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
</style>
