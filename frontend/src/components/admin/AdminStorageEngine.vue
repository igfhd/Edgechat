<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import api from '../../api.js';

const loading = ref(false);
const saving = ref(false);
const testing = ref(false);
const testMessage = ref('');
const testSuccess = ref(false);
const message = ref('');
const error = ref('');

const form = reactive({
  storageType: 'r2',
  storageAccountId: '',
  storageBucketName: 'edgechat-files',
  storageAccessKeyId: '',
  storageSecretAccessKey: '',
  storageEndpoint: '',
  storageRegion: 'auto',
  storagePublicDomain: '',
  gdriveClientId: '',
  gdriveClientSecret: '',
  gdriveRefreshToken: '',
  gdriveFolderId: ''
});

const isSecretConfigured = ref(false);
const isGdriveSecretConfigured = ref(false);
const isGdriveRefreshConfigured = ref(false);
const storageSource = ref('binding');

const isCustomS3 = computed(() => form.storageType === 's3');
const isGDrive = computed(() => form.storageType === 'gdrive');

async function loadSettings() {
  loading.value = true;
  error.value = '';
  try {
    const res = await api.adminSiteSettings();
    const site = res.site || {};
    form.storageType = site.storageType || 'r2';
    form.storageAccountId = site.storageAccountId || '';
    form.storageBucketName = site.storageBucketName || 'edgechat-files';
    form.storageAccessKeyId = site.storageAccessKeyId || '';
    form.storageEndpoint = site.storageEndpoint || '';
    form.storageRegion = site.storageRegion || 'auto';
    form.storagePublicDomain = site.storagePublicDomain || '';
    isSecretConfigured.value = Boolean(site.storageSecretAccessKeyConfigured);
    form.storageSecretAccessKey = isSecretConfigured.value ? '********' : '';

    form.gdriveClientId = site.gdriveClientId || '';
    isGdriveSecretConfigured.value = Boolean(site.gdriveClientSecretConfigured);
    form.gdriveClientSecret = isGdriveSecretConfigured.value ? '********' : '';
    isGdriveRefreshConfigured.value = Boolean(site.gdriveRefreshTokenConfigured);
    form.gdriveRefreshToken = isGdriveRefreshConfigured.value ? '********' : '';
    form.gdriveFolderId = site.gdriveFolderId || '';

    storageSource.value = site.storageSource || 'binding';
  } catch (err) {
    error.value = err.message || '加载存储设置失败';
  } finally {
    loading.value = false;
  }
}

async function handleSave() {
  saving.value = true;
  testMessage.value = '';
  message.value = '';
  error.value = '';
  try {
    const payload = {
      storageType: form.storageType,
      storageAccountId: form.storageAccountId.trim(),
      storageBucketName: form.storageBucketName.trim(),
      storageAccessKeyId: form.storageAccessKeyId.trim(),
      storageEndpoint: form.storageEndpoint.trim(),
      storageRegion: form.storageRegion.trim(),
      storagePublicDomain: form.storagePublicDomain.trim(),
      gdriveClientId: form.gdriveClientId.trim(),
      gdriveFolderId: form.gdriveFolderId.trim()
    };
    if (form.storageSecretAccessKey && form.storageSecretAccessKey !== '********') {
      payload.storageSecretAccessKey = form.storageSecretAccessKey.trim();
    }
    if (form.gdriveClientSecret && form.gdriveClientSecret !== '********') {
      payload.gdriveClientSecret = form.gdriveClientSecret.trim();
    }
    if (form.gdriveRefreshToken && form.gdriveRefreshToken !== '********') {
      payload.gdriveRefreshToken = form.gdriveRefreshToken.trim();
    }
    const res = await api.updateAdminSiteSettings(payload);
    const site = res.site || {};
    isSecretConfigured.value = Boolean(site.storageSecretAccessKeyConfigured);
    if (isSecretConfigured.value && (!form.storageSecretAccessKey || form.storageSecretAccessKey !== '********')) {
      form.storageSecretAccessKey = '********';
    }
    isGdriveSecretConfigured.value = Boolean(site.gdriveClientSecretConfigured);
    if (isGdriveSecretConfigured.value && (!form.gdriveClientSecret || form.gdriveClientSecret !== '********')) {
      form.gdriveClientSecret = '********';
    }
    isGdriveRefreshConfigured.value = Boolean(site.gdriveRefreshTokenConfigured);
    if (isGdriveRefreshConfigured.value && (!form.gdriveRefreshToken || form.gdriveRefreshToken !== '********')) {
      form.gdriveRefreshToken = '********';
    }
    message.value = '存储配置保存成功！';
    setTimeout(() => { message.value = ''; }, 3000);
  } catch (err) {
    error.value = err.message || '保存存储设置失败';
  } finally {
    saving.value = false;
  }
}

async function handleTest() {
  testing.value = true;
  testMessage.value = '';
  testSuccess.value = false;
  try {
    const payload = {
      storageType: form.storageType,
      storageAccountId: form.storageAccountId.trim(),
      storageBucketName: form.storageBucketName.trim(),
      storageAccessKeyId: form.storageAccessKeyId.trim(),
      storageSecretAccessKey: form.storageSecretAccessKey.trim(),
      storageEndpoint: form.storageEndpoint.trim(),
      storageRegion: form.storageRegion.trim(),
      gdriveClientId: form.gdriveClientId.trim(),
      gdriveClientSecret: form.gdriveClientSecret.trim(),
      gdriveRefreshToken: form.gdriveRefreshToken.trim(),
      gdriveFolderId: form.gdriveFolderId.trim()
    };
    const res = await api.testAdminStorage(payload);
    if (res.ok !== false) {
      testSuccess.value = true;
      testMessage.value = `✅ ${res.message || '存储服务器连接测试成功！'}`;
    } else {
      testSuccess.value = false;
      testMessage.value = `❌ ${res.error || res.message || '存储服务器连接测试失败'}`;
    }
  } catch (err) {
    testSuccess.value = false;
    testMessage.value = `❌ ${err.message || '存储服务器连接测试失败'}`;
  } finally {
    testing.value = false;
  }
}

onMounted(() => {
  void loadSettings();
});
</script>

<template>
  <div class="admin-card">
    <div class="admin-card__header">
      <div>
        <h3 class="admin-card__title">网盘存储引擎与后端配置</h3>
        <p class="admin-card__desc">
          配置全站网盘与附件默认使用的存储引擎（支持 Cloudflare R2、Google Drive 及自定义 S3 兼容对象存储）。
        </p>
      </div>
      <div v-if="storageSource" class="storage-source-badge">
        <span v-if="storageSource === 'database'" class="badge-db">数据库已自定义</span>
        <span v-else-if="storageSource === 'environment'" class="badge-env">环境变量配置中</span>
        <span v-else class="badge-native">Cloudflare 原生绑定</span>
      </div>
    </div>

    <div v-if="loading" class="admin-card__loading">
      <span>正在读取存储配置...</span>
    </div>

    <form v-else class="admin-card__body" @submit.prevent="handleSave">
      <div v-if="message" class="admin-alert admin-alert--success">
        {{ message }}
      </div>
      <div v-if="error" class="admin-alert admin-alert--error">
        {{ error }}
      </div>

      <div class="admin-form-grid">
        <!-- Storage Type -->
        <div class="admin-form-group admin-form-group--full">
          <label class="admin-form-label">存储引擎类型</label>
          <div class="admin-radio-group">
            <label class="admin-radio-label">
              <input v-model="form.storageType" type="radio" value="r2" />
              <span>Cloudflare R2 对象存储 (默认推荐)</span>
            </label>
            <label class="admin-radio-label">
              <input v-model="form.storageType" type="radio" value="gdrive" />
              <span>Google Drive 云端硬盘 (无需绑卡 · 15GB 免费空间)</span>
            </label>
            <label class="admin-radio-label">
              <input v-model="form.storageType" type="radio" value="s3" />
              <span>自定义 S3 兼容对象存储 (AWS S3 / MinIO / Wasabi 等)</span>
            </label>
          </div>
          <p class="admin-form-hint">
            使用 Google Drive 可免绑定信用卡并直接使用 Google 官方 15GB 免费配额；使用 R2 可享 Cloudflare 全球低延迟访问。
          </p>
        </div>

        <!-- Google Drive Section -->
        <template v-if="form.storageType === 'gdrive'">
          <div class="admin-form-group admin-form-group--full gdrive-guide-card">
            <div class="guide-icon">💡</div>
            <div class="guide-content">
              <strong>Google Drive OAuth 凭证获取指南：</strong>
              <p>1. 前往 <a href="https://console.cloud.google.com/" target="_blank" rel="noopener">Google Cloud Console</a> 创建项目并启用 <strong>Google Drive API</strong>；</p>
              <p>2. 在「凭据」中创建 <strong>OAuth 客户端 ID</strong>（类型选择 Web 应用），获取 Client ID 与 Client Secret；</p>
              <p>3. 通过 Google OAuth Playground 或 rclone 授权获取永久 <strong>Refresh Token</strong>。</p>
            </div>
          </div>

          <div class="admin-form-group">
            <label class="admin-form-label">Google Client ID <span class="req-star">*</span></label>
            <input
              v-model="form.gdriveClientId"
              type="text"
              placeholder="例如: 123456789-xxx.apps.googleusercontent.com"
              class="admin-form-input"
              required
            />
          </div>

          <div class="admin-form-group">
            <label class="admin-form-label">Google Client Secret <span class="req-star">*</span></label>
            <input
              v-model="form.gdriveClientSecret"
              type="password"
              placeholder="例如: GOCSPX-xxxxxxxxxxxx"
              class="admin-form-input"
              autocomplete="new-password"
            />
            <p class="admin-form-hint">已配置时显示安全掩码。留空或保持原样则不修改密钥。</p>
          </div>

          <div class="admin-form-group">
            <label class="admin-form-label">Google Refresh Token <span class="req-star">*</span></label>
            <input
              v-model="form.gdriveRefreshToken"
              type="password"
              placeholder="例如: 1//04xxxxxxxxxxxx"
              class="admin-form-input"
              autocomplete="new-password"
            />
            <p class="admin-form-hint">用于自动向 Google 换取临时上传与访问 Access Token。</p>
          </div>

          <div class="admin-form-group">
            <label class="admin-form-label">目标根目录 Folder ID (可选)</label>
            <input
              v-model="form.gdriveFolderId"
              type="text"
              placeholder="例如: 1AbC2dEfG3hIjKlMnOpQrStUv"
              class="admin-form-input"
            />
            <p class="admin-form-hint">可指定 Google Drive 中的具体文件夹 ID（在网盘打开文件夹时 URL 末尾的字符串），留空则保存至根目录。</p>
          </div>
        </template>

        <!-- R2 / S3 Section -->
        <template v-else>
          <!-- Account ID (R2 only) -->
          <div v-if="form.storageType === 'r2'" class="admin-form-group">
            <label class="admin-form-label">Cloudflare Account ID (账户 ID)</label>
            <input
              v-model="form.storageAccountId"
              type="text"
              placeholder="例如: 8a7c2b5d4e1f..."
              class="admin-form-input"
            />
            <p class="admin-form-hint">Cloudflare 控制台右上角或 Workers 仪表盘中的 32 位十六进制 Account ID。</p>
          </div>

          <!-- Bucket Name -->
          <div class="admin-form-group">
            <label class="admin-form-label">Bucket 存储桶名称</label>
            <input
              v-model="form.storageBucketName"
              type="text"
              placeholder="例如: edgechat-files"
              class="admin-form-input"
              required
            />
          </div>

          <!-- Custom S3 Endpoint (if S3 type) -->
          <div v-if="form.storageType === 's3'" class="admin-form-group">
            <label class="admin-form-label">自定义 S3 服务端点 (Endpoint URL)</label>
            <input
              v-model="form.storageEndpoint"
              type="text"
              placeholder="例如: https://s3.us-east-1.amazonaws.com 或 http://192.168.1.50:9000"
              class="admin-form-input"
            />
            <p class="admin-form-hint">留空则根据 Region 默认连接标准 AWS S3 端点。</p>
          </div>

          <!-- Region -->
          <div class="admin-form-group">
            <label class="admin-form-label">存储区域 (Region)</label>
            <input
              v-model="form.storageRegion"
              type="text"
              placeholder="例如: auto 或 us-east-1"
              class="admin-form-input"
            />
            <p class="admin-form-hint">R2 请填 auto，AWS S3 可填写具体的区域代号（如 ap-east-1）。</p>
          </div>

          <!-- Access Key ID -->
          <div class="admin-form-group">
            <label class="admin-form-label">S3 Access Key ID (访问凭证公钥)</label>
            <input
              v-model="form.storageAccessKeyId"
              type="text"
              placeholder="例如: 9f7b1e4a..."
              class="admin-form-input"
            />
            <p class="admin-form-hint">用于生成预签名直传 URL。若仅使用 Worker 原生 R2 绑定可留空。</p>
          </div>

          <!-- Secret Access Key -->
          <div class="admin-form-group">
            <label class="admin-form-label">S3 Secret Access Key (访问凭证私钥)</label>
            <input
              v-model="form.storageSecretAccessKey"
              type="password"
              placeholder="例如: c3d8e9f0..."
              class="admin-form-input"
              autocomplete="new-password"
            />
            <p class="admin-form-hint">已配置时显示安全掩码。留空或保持原样则不修改密钥。</p>
          </div>

          <!-- Custom Public Domain / CDN -->
          <div class="admin-form-group admin-form-group--full">
            <label class="admin-form-label">自定义下载加速域名 / CDN 前缀 (可选)</label>
            <input
              v-model="form.storagePublicDomain"
              type="text"
              placeholder="例如: https://files.example.com"
              class="admin-form-input"
            />
            <p class="admin-form-hint">如已为存储桶绑定了自定义域名并开启了 Cloudflare CDN 缓存加速，可填入加速前缀。</p>
          </div>
        </template>
      </div>

      <!-- 测试结果提示 -->
      <div
        v-if="testMessage"
        class="storage-test-banner"
        :class="{ 'storage-test-banner--success': testSuccess, 'storage-test-banner--error': !testSuccess }"
      >
        {{ testMessage }}
      </div>

      <div class="admin-card__actions">
        <button
          type="button"
          class="admin-btn admin-btn--secondary"
          :disabled="testing || saving"
          @click="handleTest"
        >
          <span>{{ testing ? '正在探测...' : '🔌 测试存储连接' }}</span>
        </button>
        <button
          type="submit"
          class="admin-btn admin-btn--primary"
          :disabled="saving || testing"
        >
          <span>{{ saving ? '保存中...' : '💾 保存存储配置' }}</span>
        </button>
      </div>
    </form>
  </div>
</template>

<style scoped>
.admin-card {
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 14px;
  padding: 24px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
}

.admin-card__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 20px;
  padding-bottom: 16px;
  border-bottom: 1px solid #f1f5f9;
}

.admin-card__title {
  margin: 0 0 6px 0;
  font-size: 1.15rem;
  font-weight: 600;
  color: #0f172a;
}

.admin-card__desc {
  margin: 0;
  font-size: 0.88rem;
  color: #64748b;
  line-height: 1.5;
}

.storage-source-badge {
  flex-shrink: 0;
}

.badge-db {
  background: #e0f2fe;
  color: #0369a1;
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 0.75rem;
  font-weight: 600;
}

.badge-env {
  background: #fef3c7;
  color: #b45309;
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 0.75rem;
  font-weight: 600;
}

.badge-native {
  background: #dcfce7;
  color: #15803d;
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 0.75rem;
  font-weight: 600;
}

.admin-alert {
  padding: 12px 16px;
  border-radius: 8px;
  font-size: 0.88rem;
  margin-bottom: 16px;
}

.admin-alert--success {
  background: #ecfdf5;
  border: 1px solid #a7f3d0;
  color: #065f46;
}

.admin-alert--error {
  background: #fef2f2;
  border: 1px solid #fecaca;
  color: #991b1b;
}

.storage-test-banner {
  padding: 12px 16px;
  border-radius: 8px;
  font-size: 0.88rem;
  line-height: 1.45;
  margin-top: 16px;
}

.storage-test-banner--success {
  background: #f0fdf4;
  border: 1px solid #bbf7d0;
  color: #166534;
}

.storage-test-banner--error {
  background: #fef2f2;
  border: 1px solid #fecaca;
  color: #991b1b;
}

.admin-form-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 18px;
}

@media (max-width: 768px) {
  .admin-form-grid {
    grid-template-columns: 1fr;
  }
}

.admin-form-group--full {
  grid-column: 1 / -1;
}

.gdrive-guide-card {
  background: #f0fdf4;
  border: 1px solid #bbf7d0;
  border-radius: 10px;
  padding: 14px 16px;
  display: flex;
  gap: 12px;
  align-items: flex-start;
  font-size: 0.85rem;
  color: #166534;
}

.guide-icon {
  font-size: 1.2rem;
  flex-shrink: 0;
}

.guide-content p {
  margin: 4px 0 0 0;
  line-height: 1.45;
}

.guide-content a {
  color: #15803d;
  font-weight: 600;
  text-decoration: underline;
}

.req-star {
  color: #ef4444;
  margin-left: 2px;
}

.admin-form-label {
  display: block;
  font-size: 0.88rem;
  font-weight: 600;
  color: #334155;
  margin-bottom: 6px;
}

.admin-radio-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 6px;
}

.admin-radio-label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.9rem;
  color: #1e293b;
  cursor: pointer;
}

.admin-form-input {
  width: 100%;
  padding: 9px 12px;
  background: #f8fafc;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  color: #0f172a;
  font-size: 0.9rem;
  outline: none;
  box-sizing: border-box;
  transition: border-color 0.15s ease;
}

.admin-form-input:focus {
  border-color: #008069;
  background: #ffffff;
}

.admin-form-hint {
  margin: 5px 0 0 0;
  font-size: 0.76rem;
  color: #64748b;
  line-height: 1.4;
}

.admin-card__actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 24px;
  padding-top: 16px;
  border-top: 1px solid #f1f5f9;
}

.admin-btn {
  padding: 9px 18px;
  border-radius: 8px;
  font-size: 0.9rem;
  font-weight: 500;
  cursor: pointer;
  border: none;
  transition: all 0.15s ease;
}

.admin-btn--primary {
  background: #008069;
  color: #ffffff;
}

.admin-btn--primary:hover:not(:disabled) {
  background: #006a57;
}

.admin-btn--secondary {
  background: #f1f5f9;
  border: 1px solid #cbd5e1;
  color: #334155;
}

.admin-btn--secondary:hover:not(:disabled) {
  background: #e2e8f0;
  color: #0f172a;
}

.admin-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>


