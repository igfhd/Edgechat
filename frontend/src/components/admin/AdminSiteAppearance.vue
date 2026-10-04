<script setup>
import { onMounted, reactive, ref } from 'vue';
import api from '../../api.js';
import store from '../../store.js';
import UiButton from '../ui/Button.vue';
import UiSurface from '../ui/Surface.vue';

const loading = ref(false);
const error = ref('');
const saving = ref(false);
const iconUploading = ref(false);
const iconFileInputEl = ref(null);
const siteForm = reactive({ siteName: 'Edgechat', siteIconUrl: '' });

async function loadSiteSettings() {
  loading.value = true;
  error.value = '';
  try {
    const payload = await api.adminSiteSettings();
    siteForm.siteName = payload.site?.siteName || 'Edgechat';
    siteForm.siteIconUrl = payload.site?.siteIconUrl || '';
  } catch (currentError) {
    error.value = currentError.message;
  } finally {
    loading.value = false;
  }
}

function openIconPicker() {
  iconFileInputEl.value?.click();
}

async function uploadSiteIcon(event) {
  const file = event.target.files?.[0];
  if (!file) {
    return;
  }

  iconUploading.value = true;
  error.value = '';
  try {
    const payload = await api.uploadFile(file);
    siteForm.siteIconUrl = payload.file.url;
  } catch (currentError) {
    error.value = currentError.message;
  } finally {
    iconUploading.value = false;
    event.target.value = '';
  }
}

async function saveSiteSettings() {
  saving.value = true;
  error.value = '';
  try {
    const payload = await api.updateAdminSiteSettings(siteForm);
    siteForm.siteName = payload.site.siteName;
    siteForm.siteIconUrl = payload.site.siteIconUrl;
    store.setSite(payload.site);
  } catch (currentError) {
    error.value = currentError.message;
  } finally {
    saving.value = false;
  }
}

onMounted(loadSiteSettings);
</script>

<template>
  <UiSurface class="panel admin-site-appearance">
    <div class="admin-site-appearance__heading">
      <div>
        <h3 class="panel-title">站点外观</h3>
        <p>修改聊天站点显示的名称与图标。</p>
      </div>
      <UiButton variant="secondary" size="sm" :disabled="loading" @click="loadSiteSettings">
        {{ loading ? '读取中...' : '重新读取' }}
      </UiButton>
    </div>

    <p v-if="error" class="error-text">{{ error }}</p>
    <label class="field">
      <span>站点名称</span>
      <input v-model.trim="siteForm.siteName" placeholder="例如：Edgechat" />
    </label>
    <label class="field">
      <span>站点图标 URL</span>
      <input v-model.trim="siteForm.siteIconUrl" placeholder="/files/... 或 https://..." />
    </label>
    <div class="inline-actions">
      <input ref="iconFileInputEl" type="file" accept="image/*" class="admin-hidden-file-input" @change="uploadSiteIcon" />
      <UiButton variant="secondary" size="sm" :disabled="iconUploading" @click="openIconPicker">
        {{ iconUploading ? '上传中...' : '上传图标' }}
      </UiButton>
      <UiButton :disabled="saving" @click="saveSiteSettings">
        {{ saving ? '保存中...' : '保存设置' }}
      </UiButton>
    </div>
    <div class="admin-site-preview">
      <div class="admin-site-preview__icon">
        <img v-if="siteForm.siteIconUrl" :src="siteForm.siteIconUrl" alt="站点图标" />
        <span v-else>{{ siteForm.siteName.slice(0, 1) || 'C' }}</span>
      </div>
      <div class="admin-site-preview__meta">
        <strong>{{ siteForm.siteName || 'Edgechat' }}</strong>
        <span>{{ siteForm.siteIconUrl || '未设置图标 URL' }}</span>
      </div>
    </div>
  </UiSurface>
</template>

<style scoped src="../../styles/admin/site-appearance.css"></style>
