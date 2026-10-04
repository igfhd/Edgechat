<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import api from '../api.js';
import store from '../store.js';
import UiAvatar from '../components/ui/Avatar.vue';
import KeyBackupModal from '../components/chat/KeyBackupModal.vue';
import { getLocalIdentityKeyPair, getOrCreateIdentityKeyPair } from '../crypto/keystore.js';
import { computeKeyFingerprint } from '../crypto/key-backup.js';
import { isTrafficObfuscationEnabled, setTrafficObfuscationEnabled } from '../traffic-obfuscation.js';
import { getQuickReplies, addQuickReply, deleteQuickReply, updateQuickReply, resetQuickRepliesToDefault } from '../quick-replies.js';
import { usePwa } from '../composables/usePwa.js';
import { useCloudDrive, formatBytes } from '../composables/useCloudDrive.js';
import { useTheme } from '../composables/useTheme.js';
import { useFontSize } from '../composables/useFontSize.js';
import { getEdgeChatServerOrigin, isCapacitorAndroid } from '../capacitor-platform.js';
import { registerBackHandler } from '../back-navigation.js';

const router = useRouter();
const session = computed(() => store.session);
const showAdminEntry = computed(() => Boolean(session.value?.isAdmin));
const { themePreference, setTheme } = useTheme();
const { messageFontSize, setFontSize, resetFontSize, FONT_SIZE_PRESETS } = useFontSize();

const {
  stats: driveStats,
  quotaPercent: driveQuotaPercent,
  loadStats: loadDriveStats,
  loadAppPasswords,
  createAppPassword,
  deleteAppPassword
} = useCloudDrive();

const appPasswords = ref([]);
const newAppPasswordName = ref('');
const createdAppPassword = ref(null);
const webdavEndpoint = computed(() => {
  const origin = isCapacitorAndroid
    ? getEdgeChatServerOrigin()
    : (typeof window !== 'undefined' ? window.location.origin : '');
  const prefix = api.getBasePrefix();
  return `${origin}${prefix}/dav/`;
});
const webdavPath = computed(() => {
  const prefix = api.getBasePrefix();
  return `${prefix}/dav/`;
});
const copiedKey = ref('');

async function copySettingValue(text, key) {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    copiedKey.value = key;
    setTimeout(() => {
      if (copiedKey.value === key) copiedKey.value = '';
    }, 2000);
  } catch (err) {
    console.warn('Copy failed:', err);
  }
}

let unregisterSettingsBack = null;

onMounted(async () => {
  unregisterSettingsBack = registerBackHandler(30, () => {
    router.push('/');
    return true;
  });
  void loadDriveStats();
  try {
    appPasswords.value = await loadAppPasswords();
  } catch (err) {
    console.warn('Failed to load app passwords:', err);
  }
});

onBeforeUnmount(() => {
  if (unregisterSettingsBack) {
    unregisterSettingsBack();
    unregisterSettingsBack = null;
  }
});

async function handleCreateAppPassword() {
  if (!newAppPasswordName.value.trim()) return;
  try {
    const res = await createAppPassword(newAppPasswordName.value.trim());
    createdAppPassword.value = res.appPassword;
    newAppPasswordName.value = '';
    appPasswords.value = await loadAppPasswords();
  } catch (err) {
    alert(err.message || '生成应用密码失败');
  }
}

async function handleDeleteAppPassword(id) {
  if (confirm('确定要撤回并删除此 WebDAV 应用密码吗？')) {
    try {
      await deleteAppPassword(id);
      appPasswords.value = await loadAppPasswords();
    } catch (err) {
      alert(err.message || '删除失败');
    }
  }
}

const { isInstallable, isInstalled, hasUpdate, promptInstall, applyUpdate } = usePwa();

const quickRepliesList = ref(getQuickReplies());
const newQuickReplyText = ref('');
const editingQuickReplyId = ref(null);
const editingQuickReplyText = ref('');

function handleAddQuickReply() {
  if (!newQuickReplyText.value.trim()) return;
  quickRepliesList.value = addQuickReply(newQuickReplyText.value);
  newQuickReplyText.value = '';
}

function startEditQuickReply(item) {
  editingQuickReplyId.value = item.id;
  editingQuickReplyText.value = item.text;
}

function saveEditQuickReply(id) {
  if (!editingQuickReplyText.value.trim()) return;
  quickRepliesList.value = updateQuickReply(id, editingQuickReplyText.value);
  editingQuickReplyId.value = null;
  editingQuickReplyText.value = '';
}

function cancelEditQuickReply() {
  editingQuickReplyId.value = null;
  editingQuickReplyText.value = '';
}

function handleDeleteQuickReply(id) {
  quickRepliesList.value = deleteQuickReply(id);
}

function handleResetQuickReplies() {
  if (window.confirm('确认恢复默认预设快捷回复短语吗？')) {
    quickRepliesList.value = resetQuickRepliesToDefault();
  }
}

const trafficObfuscationEnabled = ref(isTrafficObfuscationEnabled());
const keyFingerprint = ref('');
const keyBackupStatus = ref('检查中...');
const keyBackupLoading = ref(false);
const backupPassword = ref('');
const showBackupDialog = ref(false);

function onToggleTrafficObfuscation() {
  setTrafficObfuscationEnabled(trafficObfuscationEnabled.value);
  info.value = trafficObfuscationEnabled.value
    ? '已开启网络流量混淆与抗分析保护（高隐蔽模式）'
    : '已关闭网络流量混淆保护（普通实时模式）';
}

const profileForm = reactive({
  displayName: session.value?.displayName || '',
  customBackground: localStorage.getItem('customBackground') || ''
});
const passwordForm = reactive({
  currentPassword: '',
  newPassword: ''
});

const info = ref('');
const error = ref('');
const savingProfile = ref(false);
const savingPassword = ref(false);
const uploadingAvatar = ref(false);
const avatarInputEl = ref(null);

const managedGroups = ref([]);
const loadingManagedGroups = ref(false);

async function loadManagedGroups() {
  loadingManagedGroups.value = true;
  try {
    const payload = await api.getManagedGroups();
    managedGroups.value = payload.groups || [];
  } catch (err) {
    console.warn('Failed to load managed groups:', err);
  } finally {
    loadingManagedGroups.value = false;
  }
}

async function toggleGroupPolicy(group) {
  const nextVal = !group.allowMemberDm;
  try {
    await api.updateManagedGroupPolicy(group.id, nextVal);
    group.allowMemberDm = nextVal;
    info.value = `已${nextVal ? '开启' : '关闭'}「${group.name}」组员互发私聊`;
    setTimeout(() => { if (info.value.includes(group.name)) info.value = ''; }, 3000);
  } catch (err) {
    error.value = err.message || '更新私聊管制策略失败';
  }
}

onMounted(() => {
  void loadManagedGroups();
});

const showCropper = ref(false);
const cropperCanvas = ref(null);
const cropZoom = ref(1);
const cropFile = ref(null);
const cropImageUrl = ref('');
const cropImage = ref(null);
const cropOffset = reactive({ x: 0, y: 0 });
const cropDragging = ref(false);
const cropDragStart = reactive({ x: 0, y: 0 });
const cropOffsetStart = reactive({ x: 0, y: 0 });

const CANVAS_SIZE = 280;
const CROP_SIZE = 240;

function clearMessage() {
  info.value = '';
  error.value = '';
}

async function saveProfile() {
  clearMessage();
  savingProfile.value = true;
  try {
    const payload = await api.updateProfile(profileForm);
    store.setSession(payload.session);
    if (profileForm.customBackground) {
      localStorage.setItem('customBackground', profileForm.customBackground);
      document.body.style.background = profileForm.customBackground;
    } else {
      localStorage.removeItem('customBackground');
      document.body.style.background = '';
    }
    info.value = '资料已更新';
  } catch (currentError) {
    error.value = currentError.message;
  } finally {
    savingProfile.value = false;
  }
}

function openAvatarPicker() {
  avatarInputEl.value?.click();
}

function onAvatarFileSelected(event) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  cropFile.value = file;
  const url = URL.createObjectURL(file);
  cropImageUrl.value = url;
  cropZoom.value = 1;
  cropOffset.x = 0;
  cropOffset.y = 0;
  showCropper.value = true;
}

watch(showCropper, async (visible) => {
  if (!visible) return;
  await nextTick();
  const img = new Image();
  img.onload = () => {
    cropImage.value = img;
    drawCropCanvas();
  };
  img.src = cropImageUrl.value;
});

function drawCropCanvas() {
  const canvas = cropperCanvas.value;
  if (!canvas || !cropImage.value) return;
  const ctx = canvas.getContext('2d');
  const img = cropImage.value;

  const baseScale = Math.max(CANVAS_SIZE / img.naturalWidth, CANVAS_SIZE / img.naturalHeight);
  const totalScale = baseScale * cropZoom.value;

  const drawW = img.naturalWidth * totalScale;
  const drawH = img.naturalHeight * totalScale;
  const drawX = (CANVAS_SIZE - drawW) / 2 + cropOffset.x;
  const drawY = (CANVAS_SIZE - drawH) / 2 + cropOffset.y;

  const cropLeft = (CANVAS_SIZE - CROP_SIZE) / 2;
  const cropTop = (CANVAS_SIZE - CROP_SIZE) / 2;

  ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

  ctx.save();
  ctx.beginPath();
  ctx.rect(cropLeft, cropTop, CROP_SIZE, CROP_SIZE);
  ctx.clip();
  ctx.drawImage(img, drawX, drawY, drawW, drawH);
  ctx.restore();

  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = '#1a2332';
  ctx.fillRect(0, 0, CANVAS_SIZE, cropTop);
  ctx.fillRect(0, cropTop + CROP_SIZE, CANVAS_SIZE, CANVAS_SIZE - cropTop - CROP_SIZE);
  ctx.fillRect(0, cropTop, cropLeft, CROP_SIZE);
  ctx.fillRect(cropLeft + CROP_SIZE, cropTop, CANVAS_SIZE - cropLeft - CROP_SIZE, CROP_SIZE);
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
  ctx.lineWidth = 2;
  ctx.strokeRect(cropLeft, cropTop, CROP_SIZE, CROP_SIZE);
  ctx.restore();
}

watch(() => cropZoom.value, () => { if (showCropper.value) drawCropCanvas(); });
watch(() => cropOffset.x, () => { if (showCropper.value) drawCropCanvas(); });
watch(() => cropOffset.y, () => { if (showCropper.value) drawCropCanvas(); });

function onCropPointerDown(event) {
  event.preventDefault();
  cropDragging.value = true;
  cropDragStart.x = event.clientX;
  cropDragStart.y = event.clientY;
  cropOffsetStart.x = cropOffset.x;
  cropOffsetStart.y = cropOffset.y;
}

function onCropPointerMove(event) {
  if (!cropDragging.value) return;
  event.preventDefault();
  cropOffset.x = cropOffsetStart.x + (event.clientX - cropDragStart.x);
  cropOffset.y = cropOffsetStart.y + (event.clientY - cropDragStart.y);
}

function onCropPointerUp() {
  cropDragging.value = false;
}

onBeforeUnmount(() => {
  cropDragging.value = false;
});

function getCroppedBlob() {
  const exportCanvas = document.createElement('canvas');
  exportCanvas.width = CROP_SIZE;
  exportCanvas.height = CROP_SIZE;
  const ctx = exportCanvas.getContext('2d');
  const img = cropImage.value;

  const baseScale = Math.max(CANVAS_SIZE / img.naturalWidth, CANVAS_SIZE / img.naturalHeight);
  const totalScale = baseScale * cropZoom.value;

  const drawW = img.naturalWidth * totalScale;
  const drawH = img.naturalHeight * totalScale;
  const drawX = (CANVAS_SIZE - drawW) / 2 + cropOffset.x;
  const drawY = (CANVAS_SIZE - drawH) / 2 + cropOffset.y;

  const cropLeft = (CANVAS_SIZE - CROP_SIZE) / 2;
  const cropTop = (CANVAS_SIZE - CROP_SIZE) / 2;

  const sourceX = Math.max(0, (cropLeft - drawX) / totalScale);
  const sourceY = Math.max(0, (cropTop - drawY) / totalScale);
  const sourceW = Math.min(img.naturalWidth - sourceX, CROP_SIZE / totalScale);
  const sourceH = Math.min(img.naturalHeight - sourceY, CROP_SIZE / totalScale);

  ctx.drawImage(img, sourceX, sourceY, sourceW, sourceH, 0, 0, CROP_SIZE, CROP_SIZE);

  return new Promise((resolve) => {
    exportCanvas.toBlob((blob) => resolve(blob), 'image/png', 0.92);
  });
}

async function confirmCrop() {
  clearMessage();
  uploadingAvatar.value = true;
  showCropper.value = false;
  try {
    const blob = await getCroppedBlob();
    const file = new File([blob], 'avatar.png', { type: 'image/png' });
    const upload = await api.uploadFile(file);
    const payload = await api.updateProfile({
      displayName: profileForm.displayName,
      avatarKey: upload.file.key
    });
    store.setSession(payload.session);
    info.value = '头像已更新';
  } catch (currentError) {
    error.value = currentError.message;
  } finally {
    uploadingAvatar.value = false;
    cleanupCrop();
  }
}

async function removeAvatar() {
  clearMessage();
  uploadingAvatar.value = true;
  try {
    const payload = await api.updateProfile({
      displayName: profileForm.displayName,
      avatarKey: null
    });
    store.setSession(payload.session);
    info.value = '头像已移除';
  } catch (currentError) {
    error.value = currentError.message;
  } finally {
    uploadingAvatar.value = false;
  }
}

function cancelCrop() {
  showCropper.value = false;
  cleanupCrop();
}

function cleanupCrop() {
  if (cropImageUrl.value) {
    URL.revokeObjectURL(cropImageUrl.value);
  }
  cropImageUrl.value = '';
  cropImage.value = null;
  cropFile.value = null;
  cropZoom.value = 1;
  cropOffset.x = 0;
  cropOffset.y = 0;
}

async function loadKeyInfo() {
  if (!session.value?.userId) return;
  try {
    let keyInfo = await getLocalIdentityKeyPair(session.value.userId);
    if (!keyInfo) {
      keyInfo = await getOrCreateIdentityKeyPair(session.value.userId);
    }
    keyFingerprint.value = await computeKeyFingerprint(keyInfo?.publicKeyBase64);
    const backupRes = await api.getKeyBackup();
    keyBackupStatus.value = backupRes?.backup?.encryptedPrivateKey ? '已加密备份到云端 (零知识)' : '云端未备份';
  } catch (err) {
    const msg = String(err?.message || '');
    if (
      msg.includes('X25519') ||
      msg.includes('operation-specific') ||
      err?.name === 'OperationError' ||
      err?.name === 'NotSupportedError'
    ) {
      keyFingerprint.value = '不可用（当前浏览器内核不支持 X25519，请升级现代浏览器）';
    } else {
      keyFingerprint.value = `生成失败：${msg || '环境不支持'}`;
    }
    keyBackupStatus.value = '未就绪';
  }
}

const regeneratingKey = ref(false);

async function handleRegenerateKey() {
  if (!session.value?.userId) return;
  if (!window.confirm('确认重新生成并重置端到端加密密钥对吗？\n\n⚠️ 注意：重置后将无法解密过往的历史加密消息，但可以正常进行后续的新加密聊天。')) {
    return;
  }
  regeneratingKey.value = true;
  clearMessage();
  try {
    const keyInfo = await store.resetIdentityKey();
    keyFingerprint.value = await computeKeyFingerprint(keyInfo.publicKeyBase64);
    keyBackupStatus.value = '云端未备份 (建议重新备份)';
    info.value = '端到端加密密钥已成功重置并同步至云端！';
  } catch (err) {
    error.value = `密钥生成失败：${err.message || '未知错误'}`;
  } finally {
    regeneratingKey.value = false;
  }
}

onMounted(() => {
  void loadKeyInfo();
});

watch(session, () => {
  void loadKeyInfo();
});

async function changePassword() {
  clearMessage();
  savingPassword.value = true;
  try {
    await api.changePassword(passwordForm);
    passwordForm.currentPassword = '';
    passwordForm.newPassword = '';
    info.value = '登录密码修改成功';
  } catch (currentError) {
    error.value = currentError.message;
  } finally {
    savingPassword.value = false;
  }
}
</script>

<template>
  <div class="settings-page">
    <div class="settings-container">
      <header class="settings-header">
        <div class="settings-header__left">
          <button
            type="button"
            class="settings-back-btn"
            title="返回聊天"
            aria-label="返回聊天"
            @click="router.push('/')"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <line x1="19" y1="12" x2="5" y2="12" />
              <polyline points="12 19 5 12 12 5" />
            </svg>
            <span>返回聊天</span>
          </button>
          <h1>设置</h1>
          <span class="settings-kicker">个人中心</span>
        </div>
        <div class="settings-header__right">
          <div class="avatar-block">
            <button type="button" class="avatar-trigger" @click="openAvatarPicker" title="点击更换头像">
              <UiAvatar
                :src="session?.avatarUrl"
                :fallback="session?.displayName || session?.username || 'U'"
                size="md"
              />
              <span class="avatar-overlay">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><title>更换头像</title><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
              </span>
            </button>
            <input
              ref="avatarInputEl"
              type="file"
              class="avatar-input"
              accept="image/*"
              @change="onAvatarFileSelected"
            />
            <div class="avatar-actions">
              <span class="avatar-hint">{{ uploadingAvatar ? '处理中...' : '点击头像更换' }}</span>
              <button
                v-if="session?.avatarUrl"
                type="button"
                class="avatar-remove"
                :disabled="uploadingAvatar"
                @click="removeAvatar"
              >
                移除头像
              </button>
            </div>
          </div>
        </div>
      </header>

      <Transition name="banner">
        <div v-if="info" class="info-banner" role="status">{{ info }}</div>
      </Transition>
      <Transition name="banner">
        <div v-if="error" class="error-banner" role="alert">{{ error }}</div>
      </Transition>

      <div class="settings-layout">
        <!-- 左侧列：个人账户与核心安全 -->
        <div class="settings-col">
          <!-- 1. 个人资料 (置顶最上方) -->
          <section class="settings-section">
            <h2>👤 个人资料</h2>
            <label class="field-compact">
              <span>显示名称</span>
              <input
                v-model.trim="profileForm.displayName"
                placeholder="将展示给其他用户"
                autocomplete="nickname"
              />
            </label>
            <button type="button" class="save-btn" :disabled="savingProfile" @click="saveProfile">
              {{ savingProfile ? '保存中' : '保存资料' }}
            </button>
          </section>

          <!-- 团队私聊权限管理 (仅组长/负责人可见) -->
          <section v-if="managedGroups.length > 0" class="settings-section">
            <h2>👑 团队私聊权限管理</h2>
            <p class="section-desc">您担任以下团队/部门的负责人，可按需开启或关闭组员私聊权限：</p>
            <div class="managed-groups-list">
              <div
                v-for="g in managedGroups"
                :key="g.id"
                class="managed-group-item"
                :class="{ 'managed-group-item--enabled': g.allowMemberDm, 'managed-group-item--disabled': !g.allowMemberDm }"
              >
                <div class="managed-group-header">
                  <div class="managed-group-title-row">
                    <strong class="managed-group-name">{{ g.name }}</strong>
                    <span class="managed-group-member-count">👥 {{ g.memberCount }} 位成员</span>
                  </div>
                  <span
                    class="managed-group-badge"
                    :class="g.allowMemberDm ? 'managed-group-badge--enabled' : 'managed-group-badge--disabled'"
                  >
                    {{ g.allowMemberDm ? '🟢 允许组员互发私聊' : '🔒 组员私聊已管制' }}
                  </span>
                </div>

                <p class="managed-group-desc">
                  {{ g.allowMemberDm
                    ? '当前状态：组员之间可以自由发起 1对1 私聊与沟通。'
                    : '当前状态：已开启私聊管制。普通组员只能与组长/管理员私聊，组员之间无法发起私聊。'
                  }}
                </p>

                <div class="managed-group-footer">
                  <span class="managed-group-switch-label">组员互发私聊权限</span>
                  <div class="managed-group-switch-box">
                    <button
                      type="button"
                      class="ui-toggle-switch"
                      :class="{ 'ui-toggle-switch--on': g.allowMemberDm }"
                      role="switch"
                      :aria-checked="g.allowMemberDm"
                      :title="g.allowMemberDm ? '点击关闭组员互发私聊（开启私聊管制）' : '点击开启组员互发私聊（允许组员自由私聊）'"
                      :aria-label="`${g.name} 组员私聊权限开关`"
                      @click="toggleGroupPolicy(g)"
                    >
                      <span class="toggle-handle"></span>
                    </button>
                    <span
                      class="toggle-status-text"
                      :class="{ 'toggle-status-text--on': g.allowMemberDm }"
                    >
                      {{ g.allowMemberDm ? '已开启' : '已关闭' }}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <!-- 2. 安全设置 -->
          <section class="settings-section">
            <h2>🔒 安全设置</h2>
            <label class="field-compact">
              <span>当前密码</span>
              <input
                v-model="passwordForm.currentPassword"
                type="password"
                autocomplete="current-password"
              />
            </label>
            <label class="field-compact">
              <span>新密码</span>
              <input
                v-model="passwordForm.newPassword"
                type="password"
                autocomplete="new-password"
              />
            </label>
            <button type="button" class="save-btn" :disabled="savingPassword" @click="changePassword">
              {{ savingPassword ? '更新中' : '更新密码' }}
            </button>
          </section>

          <!-- 3. 端到端加密 (E2EE) 密钥 -->
          <section class="settings-section">
            <h2>🛡️ 端到端加密 (E2EE) 密钥</h2>
            <div class="field-compact">
              <span>公钥指纹 (SHA-256)</span>
              <div class="key-fingerprint-box">
                <code>{{ keyFingerprint || '加载中...' }}</code>
              </div>
            </div>
            <div class="field-compact">
              <span>云端私钥备份</span>
              <div class="backup-status-row">
                <span class="backup-status-pill" :class="{ 'backup-status-pill--ok': keyBackupStatus.includes('已加密') }">
                  {{ keyBackupStatus }}
                </span>
              </div>
            </div>
            <p class="e2ee-help-text">
              私钥仅存储在本地设备中。云端备份采用独立安全口令或 12 词恢复短语派生密钥（PBKDF2 600,000 轮 + AES-256-GCM）在本地加密后上传，服务端零知识，无法解密。
            </p>
            <div class="e2ee-actions-row">
              <button
                type="button"
                class="save-btn save-btn--secondary"
                @click="showBackupDialog = true"
              >
                配置/更新私钥云端备份
              </button>
              <button
                type="button"
                class="save-btn save-btn--secondary"
                :disabled="regeneratingKey"
                title="重新生成并修复本地加密密钥"
                @click="handleRegenerateKey"
              >
                {{ regeneratingKey ? '重置中...' : '重置端到端密钥对' }}
              </button>
            </div>
          </section>

          <!-- 4. 网络流量混淆与抗分析保护 -->
          <section class="settings-section">
            <h2>🌐 网络流量混淆与抗分析保护</h2>
            <label class="traffic-toggle-card">
              <input
                v-model="trafficObfuscationEnabled"
                type="checkbox"
                class="traffic-toggle-input"
                @change="onToggleTrafficObfuscation"
              />
              <div class="traffic-toggle-content">
                <div class="traffic-toggle-header">
                  <strong>高隐蔽网络混淆模式</strong>
                  <span class="traffic-default-badge">默认开启</span>
                </div>
                <span class="traffic-toggle-desc">抵抗 ISP 与网络监听者的包大小推测、打字按键时序分析与在线活跃特征探测。</span>
              </div>
            </label>
            <div class="traffic-feature-grid">
              <div class="traffic-feature-item">
                <div class="traffic-feature-title">📦 分组数据桶填充</div>
                <p>所有通信信封与消息填充对齐至 256B / 1024B / 4096B 固定尺寸桶，彻底隐藏内容真实长度。</p>
              </div>
              <div class="traffic-feature-item">
                <div class="traffic-feature-title">🔀 双向背景诱饵流量</div>
                <p>活跃期（4~10s）与空闲期（45~180s）周期性自动收发背景伪装包，混淆聊天活跃与挂机状态。</p>
              </div>
              <div class="traffic-feature-item">
                <div class="traffic-feature-title">⏳ 发送窗口整流与输入混淆</div>
                <p>消息及键盘输入状态（正在输入）按 2.8s~4.2s 随机窗口均匀送出，粉碎击键时序指纹关联。</p>
              </div>
            </div>
          </section>

          <!-- 5. 独立客户端 (PWA) -->
          <section class="settings-section">
            <h2>📱 独立客户端 (PWA)</h2>
            <p class="section-desc">将 EdgeChat 安装到手机主屏幕或桌面，享受沉浸式全屏与即时启动体验。</p>
            <div class="pwa-install-card">
              <div class="pwa-status-row">
                <span class="pwa-status-badge" :class="{ 'pwa-status-badge--installed': isInstalled }">
                  {{ isInstalled ? '✅ 已作为独立应用安装运行' : (isInstallable ? '💡 可直接一键安装到本机' : '🌐 浏览器网页运行中') }}
                </span>
              </div>
              <div v-if="!isInstalled" class="pwa-actions-row">
                <button
                  v-if="isInstallable"
                  type="button"
                  class="save-btn pwa-install-btn"
                  @click="promptInstall"
                >
                  📲 一键安装 EdgeChat 到主屏幕
                </button>
                <div v-else class="pwa-manual-tips">
                  <p>💡 提示：在手机浏览器菜单中点击<strong>「添加到主屏幕」</strong>或在电脑浏览器地址栏点击<strong>「安装图标」</strong>即可快捷安装为独立 App。</p>
                </div>
              </div>
              <div v-if="hasUpdate" class="pwa-update-box">
                <span>🎉 发现新版本更新！</span>
                <button type="button" class="save-btn" @click="applyUpdate">立即刷新更新</button>
              </div>
            </div>
          </section>
        </div>

        <!-- 右侧列：个性化偏好、聊天体验与云盘 -->
        <div class="settings-col">
          <!-- 5. 外观与主题 (置顶最上方) -->
          <section class="settings-section">
            <h2>🎨 外观与主题</h2>
            <div class="field-compact">
              <span>主题模式</span>
              <div class="theme-picker-group">
                <button
                  type="button"
                  class="theme-choice-btn"
                  :class="{ active: themePreference === 'light' }"
                  @click="setTheme('light')"
                >
                  <span class="theme-choice-icon">☀️</span>
                  <span class="theme-choice-label">浅色明亮</span>
                </button>
                <button
                  type="button"
                  class="theme-choice-btn"
                  :class="{ active: themePreference === 'dark' }"
                  @click="setTheme('dark')"
                >
                  <span class="theme-choice-icon">🌙</span>
                  <span class="theme-choice-label">深色暗黑</span>
                </button>
                <button
                  type="button"
                  class="theme-choice-btn"
                  :class="{ active: themePreference === 'system' }"
                  @click="setTheme('system')"
                >
                  <span class="theme-choice-icon">💻</span>
                  <span class="theme-choice-label">跟随系统</span>
                </button>
              </div>
            </div>
            <!-- 消息字体大小调节与实时预览 -->
            <div class="field-compact" style="margin-top: 4px;">
              <div class="font-size-header-row">
                <span>💬 聊天消息字号</span>
                <div class="font-size-val-actions">
                  <span class="font-size-badge">{{ messageFontSize }} px</span>
                  <button
                    v-if="messageFontSize !== 15"
                    type="button"
                    class="font-reset-link"
                    title="恢复默认字号 (15px)"
                    @click="resetFontSize"
                  >
                    恢复默认
                  </button>
                </div>
              </div>

              <!-- 快捷预设档位 -->
              <div class="font-presets-grid">
                <button
                  v-for="preset in FONT_SIZE_PRESETS"
                  :key="preset.size"
                  type="button"
                  class="font-preset-btn"
                  :class="{ active: messageFontSize === preset.size }"
                  @click="setFontSize(preset.size)"
                >
                  {{ preset.label }} ({{ preset.size }}px)
                </button>
              </div>

              <!-- 连续无极微调滑动条 -->
              <div class="font-slider-container">
                <span class="font-slider-label-min">A</span>
                <input
                  type="range"
                  min="12"
                  max="24"
                  step="1"
                  :value="messageFontSize"
                  class="font-slider-input"
                  aria-label="调节消息字体大小"
                  @input="setFontSize(Number($event.target.value))"
                />
                <span class="font-slider-label-max">A</span>
              </div>

              <!-- 实时气泡预览卡片 -->
              <div class="font-preview-card">
                <div class="font-preview-bubble font-preview-bubble--peer">
                  <span class="font-preview-sender">EdgeChat 小助手</span>
                  <p class="font-preview-msg">你好！拖动上方滑块可以实时微调文字大小 ✨</p>
                  <span class="font-preview-time">10:24</span>
                </div>
                <div class="font-preview-bubble font-preview-bubble--own">
                  <p class="font-preview-msg">收到！当前字号阅读起来非常舒适 👍</p>
                  <span class="font-preview-time">10:25 ✓✓</span>
                </div>
              </div>
            </div>

            <label class="field-compact" style="margin-top: 4px;">
              <span>自定义背景</span>
              <input
                v-model.trim="profileForm.customBackground"
                placeholder="CSS 渐变、纯色或图片 URL"
              />
            </label>
          </section>

          <!-- 6. 自定义快捷回复短语 -->
          <section id="quick-replies" class="settings-section">
            <h2>💬 自定义快捷回复短语</h2>
            <p class="section-desc">在聊天窗口输入框可一键调用您自定义的常用回复短语。</p>

            <div class="quick-reply-add-box">
              <input
                v-model.trim="newQuickReplyText"
                class="quick-reply-input"
                placeholder="输入新的常用快捷回复短语..."
                @keydown.enter.prevent="handleAddQuickReply"
              />
              <button
                type="button"
                class="save-btn quick-reply-add-btn"
                :disabled="!newQuickReplyText"
                @click="handleAddQuickReply"
              >
                添加短语
              </button>
            </div>

            <div class="quick-reply-list-box">
              <div
                v-for="item in quickRepliesList"
                :key="item.id"
                class="quick-reply-item-row"
              >
                <input
                  v-if="editingQuickReplyId === item.id"
                  v-model.trim="editingQuickReplyText"
                  class="quick-reply-edit-input"
                  @keydown.enter.prevent="saveEditQuickReply(item.id)"
                  @keydown.esc="cancelEditQuickReply"
                />
                <span v-else class="quick-reply-text">{{ item.text }}</span>

                <div class="quick-reply-item-actions">
                  <template v-if="editingQuickReplyId === item.id">
                    <button type="button" class="action-link-btn action-link-btn--ok" @click="saveEditQuickReply(item.id)">保存</button>
                    <button type="button" class="action-link-btn" @click="cancelEditQuickReply">取消</button>
                  </template>
                  <template v-else>
                    <button type="button" class="action-link-btn" @click="startEditQuickReply(item)">编辑</button>
                    <button type="button" class="action-link-btn action-link-btn--danger" @click="handleDeleteQuickReply(item.id)">删除</button>
                  </template>
                </div>
              </div>
              <p v-if="!quickRepliesList.length" class="empty-hint">暂无快捷回复短语，请在上方添加</p>
            </div>

            <div class="quick-reply-footer">
              <button type="button" class="reset-preset-link" @click="handleResetQuickReplies">
                恢复默认预设短语
              </button>
            </div>
          </section>

          <!-- 7. 我的云盘与 WebDAV 挂载 -->
          <section class="settings-section">
            <h2>📁 我的云盘与 WebDAV 挂载</h2>
            <p class="section-desc">查看个人云盘容量配额，并获取第三方播放器与客户端挂载所需的 WebDAV 连接参数。</p>

            <!-- 1. 存储容量配额卡片 -->
            <div class="webdav-card quota-card">
              <div class="quota-card-header">
                <span class="quota-card-title">📦 存储空间用量</span>
                <span class="quota-card-stat">
                  已用 <strong>{{ formatBytes(driveStats.usedBytes) }}</strong> / 总配额 {{ formatBytes(driveStats.quotaBytes) }}
                </span>
              </div>
              <div class="quota-progress-track">
                <div class="quota-progress-fill" :style="{ width: `${driveQuotaPercent}%` }"></div>
              </div>
              <div class="quota-card-footer">
                <span class="quota-percent-badge">{{ driveQuotaPercent }}% 已用</span>
                <button type="button" class="btn-goto-drive" @click="router.push('/drive')">
                  进入我的云盘 ➔
                </button>
              </div>
            </div>

            <!-- 2. WebDAV 挂载连接配置卡片 -->
            <div class="webdav-card">
              <div class="webdav-card-header">
                <h3 class="webdav-card-title">🌐 WebDAV 挂载连接参数</h3>
                <p class="webdav-card-tip">
                  支持在 Infuse、RaiDrive、PotPlayer、VidHub、Mac Finder、Windows 网络位置等客户端直接挂载。
                </p>
              </div>

              <div class="webdav-param-list">
                <!-- 服务器地址 -->
                <div class="webdav-param-item">
                  <div class="param-label-box">
                    <span class="param-name">服务器连接地址 (URL)</span>
                    <span class="param-hint">部分客户端仅需输入域名或完整 URL</span>
                  </div>
                  <div class="param-value-box">
                    <code class="param-code" :title="webdavEndpoint">{{ webdavEndpoint }}</code>
                    <button
                      type="button"
                      class="btn-param-copy"
                      :class="{ 'is-copied': copiedKey === 'endpoint' }"
                      @click="copySettingValue(webdavEndpoint, 'endpoint')"
                    >
                      {{ copiedKey === 'endpoint' ? '已复制 ✓' : '📋 复制' }}
                    </button>
                  </div>
                </div>

                <!-- 账号 / 用户名 -->
                <div class="webdav-param-item">
                  <div class="param-label-box">
                    <span class="param-name">账号 / 用户名 (Username)</span>
                    <span class="param-hint">您的 EdgeChat 账号登录用户名</span>
                  </div>
                  <div class="param-value-box">
                    <code class="param-code">{{ session?.username || '-' }}</code>
                    <button
                      type="button"
                      class="btn-param-copy"
                      :class="{ 'is-copied': copiedKey === 'username' }"
                      @click="copySettingValue(session?.username, 'username')"
                    >
                      {{ copiedKey === 'username' ? '已复制 ✓' : '📋 复制' }}
                    </button>
                  </div>
                </div>

                <!-- 挂载路径 -->
                <div class="webdav-param-item">
                  <div class="param-label-box">
                    <span class="param-name">挂载路径 (Path)</span>
                    <span class="param-hint">若客户端将服务器与路径分开填写时使用</span>
                  </div>
                  <div class="param-value-box">
                    <code class="param-code">{{ webdavPath }}</code>
                    <button
                      type="button"
                      class="btn-param-copy"
                      :class="{ 'is-copied': copiedKey === 'path' }"
                      @click="copySettingValue(webdavPath, 'path')"
                    >
                      {{ copiedKey === 'path' ? '已复制 ✓' : '📋 复制' }}
                    </button>
                  </div>
                </div>

                <!-- 协议与端口 -->
                <div class="webdav-param-item">
                  <div class="param-label-box">
                    <span class="param-name">协议与端口 (Protocol / Port)</span>
                    <span class="param-hint">默认采用标准安全的 HTTPS 加密通道</span>
                  </div>
                  <div class="param-value-box">
                    <span class="param-badge">HTTPS (端口 443)</span>
                  </div>
                </div>
              </div>
            </div>

            <!-- 3. WebDAV 应用专用密码管理 -->
            <div class="webdav-card">
              <div class="webdav-card-header">
                <h3 class="webdav-card-title">🔑 WebDAV 应用专用密码</h3>
                <p class="webdav-card-tip">
                  为各设备独立生成专用连接密码，可随时单独撤回，避免泄露主账号密码。
                </p>
              </div>

              <!-- 创建输入行 -->
              <div class="app-pwd-create-row">
                <input
                  v-model="newAppPasswordName"
                  type="text"
                  placeholder="应用名称 (例如: Apple TV Infuse, Windows RaiDrive)"
                  class="app-pwd-input"
                  @keydown.enter.prevent="handleCreateAppPassword"
                />
                <button
                  type="button"
                  class="btn-create-pwd"
                  :disabled="!newAppPasswordName.trim()"
                  @click="handleCreateAppPassword"
                >
                  ➕ 生成新密码
                </button>
              </div>

              <!-- 刚刚生成的密码高亮卡片 -->
              <div v-if="createdAppPassword" class="app-pwd-created-banner">
                <div class="created-banner-header">
                  <span class="created-banner-badge">🎉 密码已生成成功</span>
                  <span class="created-banner-warning">（仅显示一次，离开页面后将无法再次查看）</span>
                </div>
                <div class="created-pwd-box">
                  <code class="created-pwd-text">{{ createdAppPassword.password }}</code>
                  <button
                    type="button"
                    class="btn-pwd-copy"
                    :class="{ 'is-copied': copiedKey === 'newpwd' }"
                    @click="copySettingValue(createdAppPassword.password, 'newpwd')"
                  >
                    {{ copiedKey === 'newpwd' ? '已复制 ✓' : '📋 一键复制' }}
                  </button>
                </div>
              </div>

              <!-- 已授权应用密码列表 -->
              <div class="app-pwd-list-wrap">
                <div v-if="appPasswords.length" class="app-pwd-list">
                  <div
                    v-for="ap in appPasswords"
                    :key="ap.id"
                    class="app-pwd-item"
                  >
                    <div class="app-pwd-info">
                      <span class="app-pwd-icon">🔑</span>
                      <div class="app-pwd-details">
                        <strong class="app-pwd-name">{{ ap.name }}</strong>
                        <span class="app-pwd-time">创建于 {{ new Date(ap.created_at).toLocaleDateString() }}</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      class="btn-revoke-pwd"
                      title="撤回该应用访问权限"
                      @click="handleDeleteAppPassword(ap.id)"
                    >
                      🗑️ 撤回
                    </button>
                  </div>
                </div>
                <p v-else class="empty-hint" style="margin: 6px 0;">
                  暂未创建应用专用密码，您也可以使用账号登录密码直接连接 WebDAV
                </p>
              </div>
            </div>
          </section>
        </div>
      </div>

      <nav class="settings-nav">
        <button type="button" class="nav-link" @click="router.push('/')">
          <svg aria-hidden="true" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          返回聊天
        </button>
        <button
          v-if="showAdminEntry"
          type="button"
          class="nav-link"
          @click="router.push('/admin')"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="7" height="7" rx="1" />
            <rect x="14" y="3" width="7" height="7" rx="1" />
            <rect x="3" y="14" width="7" height="7" rx="1" />
            <rect x="14" y="14" width="7" height="7" rx="1" />
          </svg>
          管理后台
        </button>
      </nav>
    </div>

    <Transition name="modal">
      <div v-if="showCropper" class="crop-modal" @click.self="cancelCrop">
        <div class="crop-panel">
          <h3>裁剪头像</h3>
          <div class="crop-stage">
            <canvas
              ref="cropperCanvas"
              :width="CANVAS_SIZE"
              :height="CANVAS_SIZE"
              class="crop-canvas"
              @pointerdown="onCropPointerDown"
              @pointermove="onCropPointerMove"
              @pointerup="onCropPointerUp"
              @pointerleave="onCropPointerUp"
            />
          </div>
          <div class="crop-controls">
            <span>缩放</span>
            <input
              v-model.number="cropZoom"
              type="range"
              min="0.5"
              max="5"
              step="0.05"
              class="crop-zoom"
            />
          </div>
          <p class="crop-hint">拖动图片调整位置，滑动缩放选择范围</p>
          <div class="crop-actions">
            <button type="button" class="crop-cancel" @click="cancelCrop">取消</button>
            <button type="button" class="crop-confirm" @click="confirmCrop">确认裁剪</button>
          </div>
        </div>
      </div>
    </Transition>

    <KeyBackupModal
      :show="showBackupDialog"
      @close="showBackupDialog = false"
      @backed-up="loadKeyInfo"
    />
  </div>
</template>

<style scoped>
.key-fingerprint-box {
  background: rgba(15, 23, 42, 0.06);
  border-radius: 8px;
  padding: 8px 12px;
  border: 1px solid rgba(148, 163, 184, 0.2);
  user-select: all;
  word-break: break-all;
  overflow-wrap: anywhere;
  max-width: 100%;
  box-sizing: border-box;
}

.key-fingerprint-box code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
  color: #0f172a;
  letter-spacing: 0.05em;
  word-break: break-all;
  white-space: normal;
  display: block;
  overflow-wrap: anywhere;
}

.backup-status-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 500;
  background: rgba(100, 116, 139, 0.12);
  color: #475569;
}

.backup-status-pill--ok {
  background: rgba(16, 185, 129, 0.12);
  color: #059669;
}

.e2ee-help-text {
  font-size: 12px;
  line-height: 1.5;
  color: var(--color-text-secondary, #64748b);
  margin: 4px 0 10px;
}

.save-btn--secondary {
  background: rgba(59, 130, 246, 0.1);
  color: #2563eb;
  border: 1px solid rgba(59, 130, 246, 0.25);
}

.save-btn--secondary:hover {
  background: rgba(59, 130, 246, 0.18);
}

.e2ee-actions-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  width: 100%;
}

.e2ee-actions-row .save-btn {
  flex: 1 1 auto;
  min-width: 140px;
}

.key-backup-modal {
  max-width: 400px;
  padding: 24px;
}

.key-backup-desc {
  font-size: 13px;
  color: var(--color-text-secondary, #64748b);
  line-height: 1.5;
  margin-bottom: 16px;
}

.settings-page {
  position: fixed;
  inset: 0;
  width: 100%;
  height: 100dvh;
  overflow-y: auto;
  overflow-x: hidden;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 40px 20px;
  background: linear-gradient(135deg, #f5f7fa 0%, #e8ecf1 100%);
  overscroll-behavior: contain;
  box-sizing: border-box;
  scrollbar-width: thin;
  scrollbar-color: #94a3b8 #f1f5f9;
  z-index: 10;
}

.settings-page::-webkit-scrollbar {
  width: 10px;
  display: block;
}

.settings-page::-webkit-scrollbar-track {
  background: #f1f5f9;
  border-radius: 8px;
}

.settings-page::-webkit-scrollbar-thumb {
  background: #94a3b8;
  border-radius: 8px;
  border: 2px solid #f1f5f9;
}

.settings-page::-webkit-scrollbar-thumb:hover {
  background: #64748b;
}

.settings-container {
  width: min(1040px, 100%);
  max-width: 100%;
  margin: 0 auto;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 28px;
  border-radius: 24px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.82), rgba(247, 250, 253, 0.68)),
    rgba(255, 255, 255, 0.4);
  border: 1px solid rgba(255, 255, 255, 0.7);
  box-shadow:
    0 24px 60px rgba(91, 141, 191, 0.1),
    inset 0 1px 0 rgba(255, 255, 255, 0.8);
  backdrop-filter: blur(24px) saturate(180%);
  -webkit-backdrop-filter: blur(24px) saturate(180%);
  opacity: 0;
  animation: containerRise 0.5s cubic-bezier(0.22, 1, 0.36, 1) 0.1s forwards;
  box-sizing: border-box;
  min-width: 0;
}

.settings-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  width: 100%;
  box-sizing: border-box;
  min-width: 0;
}

.settings-header__left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.settings-back-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 36px;
  padding: 6px 14px;
  border-radius: 999px;
  border: 1px solid rgba(91, 141, 191, 0.25);
  background: rgba(255, 255, 255, 0.9);
  color: #2c4a6e;
  font-size: 13.5px;
  font-weight: 600;
  cursor: pointer;
  box-shadow: 0 2px 6px rgba(91, 141, 191, 0.08);
  transition: all 0.18s cubic-bezier(0.16, 1, 0.3, 1);
  text-decoration: none;
}

.settings-back-btn:hover {
  background: #ffffff;
  border-color: #008069;
  color: #008069;
  box-shadow: 0 3px 12px rgba(0, 128, 105, 0.16);
  transform: translateX(-2px);
}

.settings-header__left h1 {
  margin: 0;
  font-size: 22px;
  font-weight: 700;
  color: #2c4a6e;
  letter-spacing: -0.02em;
}

.settings-kicker {
  padding: 4px 12px;
  border-radius: 999px;
  background: rgba(91, 141, 191, 0.08);
  border: 1px solid rgba(91, 141, 191, 0.12);
  color: #5b8dbf;
  font-size: 11px;
  font-weight: 600;
}

.avatar-block {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-direction: row;
}

.avatar-trigger {
  position: relative;
  border: none;
  background: none;
  cursor: pointer;
  padding: 0;
  border-radius: 16px;
  overflow: hidden;
  transition: transform 0.2s ease;
}

.avatar-trigger:hover {
  transform: scale(1.05);
}

.avatar-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(26, 35, 50, 0.45);
  color: #fff;
  opacity: 0;
  transition: opacity 0.2s ease;
  border-radius: 16px;
}

.avatar-trigger:hover .avatar-overlay {
  opacity: 1;
}

.avatar-input {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.avatar-hint {
  font-size: 11px;
  color: #6b8aab;
  white-space: nowrap;
}

.avatar-actions {
  display: flex;
  align-items: flex-start;
  flex-direction: column;
  gap: 2px;
}

.avatar-remove {
  border: 0;
  padding: 0;
  background: transparent;
  color: #b34a57;
  font-size: 11px;
  cursor: pointer;
}

.avatar-remove:disabled {
  cursor: default;
  opacity: 0.5;
}

.info-banner,
.error-banner {
  padding: 10px 16px;
  border-radius: 12px;
  font-size: 13px;
}

.info-banner {
  background: rgba(91, 141, 191, 0.08);
  border: 1px solid rgba(91, 141, 191, 0.15);
  color: #5b8dbf;
}

.error-banner {
  background: rgba(217, 83, 79, 0.08);
  border: 1px solid rgba(217, 83, 79, 0.15);
  color: #d9534f;
}

.banner-enter-active,
.banner-leave-active {
  transition: opacity 200ms ease, transform 200ms ease;
}

.banner-enter-from,
.banner-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

.settings-layout {
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr);
  gap: 20px;
  align-items: start;
  width: 100%;
  min-width: 0;
}

.settings-col {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
  max-width: 100%;
  width: 100%;
  box-sizing: border-box;
}

.settings-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 20px;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.5);
  border: 1px solid rgba(255, 255, 255, 0.5);
  box-shadow:
    0 4px 16px rgba(91, 141, 191, 0.04),
    inset 0 1px 0 rgba(255, 255, 255, 0.6);
  opacity: 0;
  animation: sectionRise 0.4s cubic-bezier(0.22, 1, 0.36, 1) forwards;
  min-width: 0;
  max-width: 100%;
  width: 100%;
  box-sizing: border-box;
  word-break: break-word;
}

.settings-section:nth-child(1) {
  animation-delay: 0.2s;
}

.settings-section:nth-child(2) {
  animation-delay: 0.3s;
}

.settings-section h2 {
  margin: 0;
  font-size: 14px;
  font-weight: 700;
  color: #2c4a6e;
  padding-bottom: 10px;
  border-bottom: 1px solid rgba(91, 141, 191, 0.08);
}

.field-compact {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.field-compact span {
  font-size: 11px;
  font-weight: 600;
  color: #6b8aab;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.field-compact input {
  width: 100%;
  padding: 10px 14px;
  border-radius: 12px;
  border: 1px solid rgba(0, 0, 0, 0.08);
  background: rgba(255, 255, 255, 0.6);
  color: #2c4a6e;
  font-size: 14px;
  outline: none;
  transition: border-color 0.2s ease, box-shadow 0.2s ease, background 0.2s ease;
  box-sizing: border-box;
}

.field-compact input:focus {
  border-color: rgba(91, 141, 191, 0.35);
  box-shadow: 0 0 0 3px rgba(91, 141, 191, 0.08);
  background: rgba(255, 255, 255, 0.9);
}

.field-compact input::placeholder {
  color: rgba(107, 138, 171, 0.5);
  font-size: 13px;
}

.save-btn {
  margin-top: 6px;
  padding: 10px 20px;
  border: none;
  border-radius: 12px;
  background: linear-gradient(135deg, rgba(91, 141, 191, 0.85), rgba(69, 121, 186, 0.8));
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  box-shadow: 0 2px 8px rgba(91, 141, 191, 0.2);
}

.save-btn:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(91, 141, 191, 0.3);
}

.save-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.settings-nav {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  opacity: 0;
  animation: sectionRise 0.4s cubic-bezier(0.22, 1, 0.36, 1) 0.4s forwards;
}

.nav-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border-radius: 999px;
  border: 1px solid rgba(91, 141, 191, 0.1);
  background: rgba(255, 255, 255, 0.4);
  color: #6b8aab;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.nav-link:hover {
  background: rgba(255, 255, 255, 0.7);
  border-color: rgba(91, 141, 191, 0.2);
  color: #2c4a6e;
  transform: translateY(-1px);
}

.nav-link svg {
  width: 13px;
  height: 13px;
}

.crop-modal {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(26, 35, 50, 0.5);
  backdrop-filter: blur(8px);
  z-index: 100;
  padding: 24px;
}

.crop-panel {
  width: min(480px, 100%);
  max-width: 100%;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 20px;
  padding: 36px;
  border-radius: 28px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.88), rgba(247, 250, 253, 0.72)),
    rgba(255, 255, 255, 0.5);
  border: 1px solid rgba(255, 255, 255, 0.7);
  box-shadow:
    0 30px 80px rgba(26, 35, 50, 0.2),
    inset 0 1px 0 rgba(255, 255, 255, 0.8);
  backdrop-filter: blur(24px) saturate(180%);
}

.crop-panel h3 {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
  color: #2c4a6e;
}

.crop-stage {
  width: 280px;
  height: 280px;
  border-radius: 16px;
  overflow: hidden;
  box-shadow:
    0 8px 32px rgba(91, 141, 191, 0.15),
    inset 0 0 0 2px rgba(255, 255, 255, 0.3);
}

.crop-canvas {
  display: block;
  cursor: grab;
  touch-action: none;
}

.crop-canvas:active {
  cursor: grabbing;
}

.crop-controls {
  display: flex;
  align-items: center;
  gap: 16px;
  width: 100%;
  padding: 0 8px;
}

.crop-controls span {
  font-size: 15px;
  font-weight: 600;
  color: #6b8aab;
  flex-shrink: 0;
}

.crop-zoom {
  flex: 1;
  height: 6px;
  appearance: none;
  border-radius: 3px;
  background: rgba(91, 141, 191, 0.15);
  outline: none;
}

.crop-zoom::-webkit-slider-thumb {
  appearance: none;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: linear-gradient(135deg, #5b8dbf, #4579ba);
  box-shadow: 0 2px 6px rgba(91, 141, 191, 0.3);
  cursor: pointer;
  transition: transform 0.15s ease;
}

.crop-zoom::-webkit-slider-thumb:hover {
  transform: scale(1.15);
}

.crop-hint {
  margin: 0;
  font-size: 13px;
  color: #6b8aab;
  text-align: center;
}

.crop-actions {
  display: flex;
  gap: 12px;
  width: 100%;
}

.crop-cancel {
  flex: 1;
  padding: 14px;
  border: 1px solid rgba(91, 141, 191, 0.15);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.5);
  color: #6b8aab;
  font-size: 16px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.crop-cancel:hover {
  background: rgba(255, 255, 255, 0.8);
  color: #2c4a6e;
}

.crop-confirm {
  flex: 1;
  padding: 14px;
  border: none;
  border-radius: 14px;
  background: linear-gradient(135deg, rgba(91, 141, 191, 0.85), rgba(69, 121, 186, 0.8));
  color: #fff;
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(91, 141, 191, 0.2);
  transition: all 0.2s ease;
}

.crop-confirm:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(91, 141, 191, 0.3);
}

.modal-enter-active {
  transition: opacity 250ms ease;
}

.modal-enter-active .crop-panel {
  transition: transform 300ms cubic-bezier(0.22, 1, 0.36, 1), opacity 250ms ease;
}

.modal-leave-active {
  transition: opacity 200ms ease;
}

.modal-leave-active .crop-panel {
  transition: transform 200ms ease, opacity 200ms ease;
}

.modal-enter-from {
  opacity: 0;
}

.modal-enter-from .crop-panel {
  transform: scale(0.92) translateY(12px);
  opacity: 0;
}

.modal-leave-to {
  opacity: 0;
}

.modal-leave-to .crop-panel {
  transform: scale(0.96);
  opacity: 0;
}

@keyframes containerRise {
  from {
    opacity: 0;
    transform: translateY(16px) scale(0.98);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

@keyframes sectionRise {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@media (max-width: 900px) {
  .settings-layout {
    grid-template-columns: 1fr;
    gap: 16px;
  }
}

@media (max-width: 640px) {
  .settings-page {
    padding: 12px 8px;
    align-items: flex-start;
    justify-content: center;
  }

  .settings-container {
    padding: 16px 12px;
    gap: 14px;
    margin: 0 auto !important;
    width: 100%;
    max-width: 100%;
    border-radius: 18px;
  }

  .settings-header {
    flex-direction: row;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }

  .settings-header__left {
    flex-wrap: wrap;
    gap: 8px;
  }

  .settings-header__left h1 {
    font-size: 19px;
  }

  .settings-section {
    padding: 14px 12px;
    border-radius: 14px;
    gap: 10px;
  }
}

.traffic-toggle-card {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  padding: 14px 16px;
  background: #f8fafc;
  border: 1.5px solid #e2e8f0;
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.traffic-toggle-card:hover {
  background: #f1f5f9;
  border-color: #cbd5e1;
}

.traffic-toggle-input {
  width: 18px;
  height: 18px;
  margin-top: 2px;
  accent-color: #008069;
  cursor: pointer;
}

.traffic-toggle-content {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.traffic-toggle-header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.traffic-toggle-header strong {
  font-size: 14px;
  color: #0f172a;
}

.traffic-default-badge {
  padding: 2px 6px;
  background: #ecfdf5;
  border: 1px solid #a7f3d0;
  border-radius: 4px;
  font-size: 11px;
  color: #065f46;
  font-weight: 500;
}

.traffic-toggle-desc {
  font-size: 12.5px;
  color: #64748b;
  line-height: 1.4;
}

.traffic-feature-grid {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 10px;
}

.traffic-feature-item {
  padding: 10px 14px;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
}

.traffic-feature-title {
  font-size: 13px;
  font-weight: 600;
  color: #1e293b;
  margin-bottom: 2px;
}

.traffic-feature-item p {
  margin: 0;
  font-size: 12px;
  color: #64748b;
  line-height: 1.4;
}

.quick-reply-add-box {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}

.quick-reply-input {
  flex: 1;
  padding: 8px 12px;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  font-size: 13px;
}

.quick-reply-input:focus {
  outline: none;
  border-color: #008069;
}

.quick-reply-add-btn {
  white-space: nowrap;
  padding: 8px 16px;
}

.quick-reply-list-box {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 280px;
  overflow-y: auto;
  padding-right: 4px;
}

.quick-reply-item-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 12px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  transition: all 0.15s ease;
}

.quick-reply-item-row:hover {
  background: #f1f5f9;
  border-color: #cbd5e1;
}

.quick-reply-text {
  flex: 1;
  font-size: 13px;
  color: #334155;
}

.quick-reply-edit-input {
  flex: 1;
  padding: 4px 8px;
  border: 1px solid #008069;
  border-radius: 4px;
  font-size: 13px;
}

.quick-reply-item-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.action-link-btn {
  border: none;
  background: transparent;
  padding: 2px 6px;
  font-size: 12px;
  color: #0284c7;
  cursor: pointer;
  border-radius: 4px;
}

.action-link-btn:hover {
  background: rgba(2, 132, 199, 0.1);
}

.action-link-btn--ok {
  color: #059669;
  font-weight: 600;
}

.action-link-btn--ok:hover {
  background: rgba(5, 150, 105, 0.1);
}

.action-link-btn--danger {
  color: #dc2626;
}

.action-link-btn--danger:hover {
  background: rgba(220, 38, 38, 0.1);
}

.quick-reply-footer {
  margin-top: 10px;
  display: flex;
  justify-content: flex-end;
}

.reset-preset-link {
  border: none;
  background: transparent;
  color: #64748b;
  font-size: 12px;
  cursor: pointer;
  text-decoration: underline;
}

.reset-preset-link:hover {
  color: #0f172a;
}

.empty-hint {
  margin: 12px 0;
  text-align: center;
  font-size: 12.5px;
  color: #94a3b8;
}

.pwa-install-card {
  padding: 16px;
  background: var(--surface-secondary, rgba(0, 0, 0, 0.03));
  border-radius: 12px;
  border: 1px solid var(--border-color, rgba(0, 0, 0, 0.08));
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.pwa-status-row {
  display: flex;
  align-items: center;
}

.pwa-status-badge {
  font-size: 13px;
  font-weight: 500;
  color: #64748b;
  background: rgba(100, 116, 139, 0.1);
  padding: 4px 10px;
  border-radius: 8px;
}

.pwa-status-badge--installed {
  color: #059669;
  background: rgba(5, 150, 105, 0.12);
  font-weight: 600;
}

.managed-groups-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 10px;
}

.managed-group-item {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px 16px;
  background: var(--surface-1, #ffffff);
  border: 1.5px solid var(--border, #e2e8f0);
  border-radius: 12px;
  transition: all 0.2s ease;
}

.managed-group-item--enabled {
  border-color: #86efac;
  background: rgba(16, 185, 129, 0.04);
}

.managed-group-item--disabled {
  border-color: #cbd5e1;
  background: #f8fafc;
}

.managed-group-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}

.managed-group-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.managed-group-name {
  font-size: 14px;
  font-weight: 700;
  color: var(--text, #0f172a);
}

.managed-group-member-count {
  font-size: 12px;
  color: var(--text-secondary, #64748b);
  background: rgba(0, 0, 0, 0.04);
  padding: 2px 8px;
  border-radius: 6px;
}

.managed-group-badge {
  font-size: 12px;
  font-weight: 600;
  padding: 3px 10px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
}

.managed-group-badge--enabled {
  background: #dcfce7;
  color: #15803d;
  border: 1px solid #86efac;
}

.managed-group-badge--disabled {
  background: #f1f5f9;
  color: #475569;
  border: 1px solid #cbd5e1;
}

.managed-group-desc {
  margin: 0;
  font-size: 12.5px;
  color: var(--text-secondary, #64748b);
  line-height: 1.45;
}

.managed-group-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: 10px;
  border-top: 1px dashed var(--border, #e2e8f0);
}

.managed-group-switch-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--text, #334155);
}

.managed-group-switch-box {
  display: flex;
  align-items: center;
  gap: 8px;
}

.toggle-status-text {
  font-size: 12.5px;
  font-weight: 700;
  color: #64748b;
  min-width: 40px;
}

.toggle-status-text--on {
  color: #008069;
}

/* UI 切换开关 */
.ui-toggle-switch {
  position: relative;
  width: 44px;
  height: 24px;
  border-radius: 999px;
  background: #cbd5e1;
  border: none;
  cursor: pointer;
  padding: 2px;
  transition: background-color 0.2s ease;
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
}

.ui-toggle-switch--on {
  background: #008069;
}

.ui-toggle-switch:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.toggle-handle {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #ffffff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
  transition: transform 0.2s ease;
  transform: translateX(0);
}

.ui-toggle-switch--on .toggle-handle {
  transform: translateX(20px);
}

/* 暗色主题适配 */
html[data-theme="dark"] .managed-group-item--disabled,
html.dark .managed-group-item--disabled {
  background: #1e2433 !important;
  border-color: rgba(255, 255, 255, 0.1) !important;
}

html[data-theme="dark"] .managed-group-item--enabled,
html.dark .managed-group-item--enabled {
  background: rgba(16, 185, 129, 0.08) !important;
  border-color: rgba(16, 185, 129, 0.4) !important;
}

html[data-theme="dark"] .managed-group-badge--disabled,
html.dark .managed-group-badge--disabled {
  background: rgba(255, 255, 255, 0.08) !important;
  color: #94a3b8 !important;
  border-color: rgba(255, 255, 255, 0.15) !important;
}

html[data-theme="dark"] .managed-group-badge--enabled,
html.dark .managed-group-badge--enabled {
  background: rgba(16, 185, 129, 0.2) !important;
  color: #34d399 !important;
  border-color: rgba(16, 185, 129, 0.4) !important;
}

html[data-theme="dark"] .managed-group-member-count,
html.dark .managed-group-member-count {
  background: rgba(255, 255, 255, 0.06) !important;
  color: #94a3b8 !important;
}

html[data-theme="dark"] .toggle-status-text--on,
html.dark .toggle-status-text--on {
  color: #34d399 !important;
}

.pwa-actions-row {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.pwa-install-btn {
  background: #008069;
  color: #ffffff;
  font-weight: 600;
  padding: 10px 18px;
  border-radius: 10px;
}

.pwa-install-btn:hover {
  background: #006b57;
}

.pwa-manual-tips {
  font-size: 12.5px;
  color: #64748b;
  line-height: 1.5;
}

.pwa-manual-tips strong {
  color: #0f172a;
}

.pwa-update-box {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  background: rgba(245, 158, 11, 0.15);
  border: 1px solid rgba(245, 158, 11, 0.35);
  border-radius: 8px;
  color: #b45309;
  font-size: 13px;
  font-weight: 500;
}

.theme-picker-group {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
  margin-top: 6px;
}

.theme-choice-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 12px 10px;
  background: var(--surface-1, #ffffff);
  border: 1px solid var(--border, #e2e8f0);
  border-radius: 12px;
  color: var(--text-secondary, #64748b);
  cursor: pointer;
  transition: all 0.2s ease;
}

.theme-choice-btn:hover {
  background: var(--surface-2, #f1f5f9);
  color: var(--text, #0f172a);
  border-color: var(--border-strong, #cbd5e1);
}

.theme-choice-btn.active {
  background: rgba(0, 168, 132, 0.12);
  border-color: #008069;
  color: #008069;
  font-weight: 600;
  box-shadow: 0 0 0 1px #008069;
}

.theme-choice-icon {
  font-size: 1.4rem;
}

.theme-choice-label {
  font-size: 0.82rem;
}

/* WebDAV & Drive Section Styles */
.webdav-card {
  background: var(--surface-1, rgba(255, 255, 255, 0.6));
  border: 1px solid var(--border, rgba(91, 141, 191, 0.12));
  border-radius: 14px;
  padding: 16px 18px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.02);
}

/* Quota Card */
.quota-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}

.quota-card-title {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--text, #1e293b);
}

.quota-card-stat {
  font-size: 12.5px;
  color: var(--text-secondary, #64748b);
}

.quota-card-stat strong {
  color: var(--text, #0f172a);
}

.quota-progress-track {
  width: 100%;
  height: 8px;
  background: rgba(0, 0, 0, 0.06);
  border-radius: 999px;
  overflow: hidden;
}

.quota-progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #0284c7, #38bdf8);
  border-radius: 999px;
  transition: width 0.3s ease;
}

.quota-card-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.quota-percent-badge {
  font-size: 11.5px;
  font-weight: 600;
  color: #0284c7;
  background: rgba(56, 189, 248, 0.12);
  padding: 2px 8px;
  border-radius: 6px;
}

.btn-goto-drive {
  background: #0284c7;
  color: #ffffff;
  border: none;
  border-radius: 8px;
  padding: 6px 14px;
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease;
}

.btn-goto-drive:hover {
  background: #0369a1;
  transform: translateY(-1px);
}

/* WebDAV Params Card */
.webdav-card-header {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.webdav-card-title {
  margin: 0;
  font-size: 13.5px;
  font-weight: 700;
  color: var(--text, #1e293b);
}

.webdav-card-tip {
  margin: 0;
  font-size: 12px;
  color: var(--text-secondary, #64748b);
  line-height: 1.5;
}

.webdav-param-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  background: rgba(0, 0, 0, 0.02);
  border: 1px solid var(--border, rgba(0, 0, 0, 0.05));
  border-radius: 10px;
  padding: 12px;
}

.webdav-param-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 0;
  border-bottom: 1px solid var(--border, rgba(0, 0, 0, 0.05));
}

.webdav-param-item:last-child {
  border-bottom: none;
  padding-bottom: 0;
}

.webdav-param-item:first-child {
  padding-top: 0;
}

.param-label-box {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 140px;
}

.param-name {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text, #1e293b);
}

.param-hint {
  font-size: 11px;
  color: var(--text-secondary, #94a3b8);
}

.param-value-box {
  display: flex;
  align-items: center;
  gap: 8px;
  max-width: 60%;
}

.param-code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
  background: var(--surface-2, rgba(0, 0, 0, 0.05));
  color: var(--text, #0f172a);
  padding: 4px 8px;
  border-radius: 6px;
  border: 1px solid var(--border, rgba(0, 0, 0, 0.06));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  user-select: all;
}

.btn-param-copy {
  background: var(--surface-1, #ffffff);
  border: 1px solid var(--border, #cbd5e1);
  color: var(--text, #475569);
  padding: 4px 8px;
  border-radius: 6px;
  font-size: 11.5px;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.15s ease;
  flex-shrink: 0;
}

.btn-param-copy:hover {
  background: var(--surface-3, #f1f5f9);
  color: var(--text, #0f172a);
}

.btn-param-copy.is-copied {
  background: rgba(5, 150, 105, 0.12);
  border-color: #10b981;
  color: #059669;
  font-weight: 600;
}

.param-badge {
  font-size: 12px;
  font-weight: 500;
  color: #0284c7;
  background: rgba(56, 189, 248, 0.1);
  padding: 3px 8px;
  border-radius: 6px;
}

/* App Password Create & List */
.app-pwd-create-row {
  display: flex;
  gap: 8px;
  align-items: center;
}

.app-pwd-input {
  flex: 1;
  padding: 8px 12px;
  border-radius: 10px;
  border: 1px solid var(--border, #cbd5e1);
  background: var(--surface, #ffffff);
  color: var(--text, #0f172a);
  font-size: 13px;
  outline: none;
  transition: border-color 0.2s ease;
}

.app-pwd-input:focus {
  border-color: #0284c7;
}

.btn-create-pwd {
  background: #0284c7;
  color: #ffffff;
  border: none;
  padding: 8px 14px;
  border-radius: 10px;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.15s ease;
}

.btn-create-pwd:hover:not(:disabled) {
  background: #0369a1;
}

.btn-create-pwd:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.app-pwd-created-banner {
  background: rgba(56, 189, 248, 0.1);
  border: 1px solid #38bdf8;
  border-radius: 10px;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.created-banner-header {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.created-banner-badge {
  font-size: 12.5px;
  font-weight: 600;
  color: #0284c7;
}

.created-banner-warning {
  font-size: 11.5px;
  color: #ea580c;
}

.created-pwd-box {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  background: rgba(0, 0, 0, 0.06);
  padding: 8px 12px;
  border-radius: 8px;
}

.created-pwd-text {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 14px;
  font-weight: 700;
  color: var(--text, #0f172a);
  user-select: all;
  letter-spacing: 0.5px;
}

.btn-pwd-copy {
  background: #0284c7;
  color: #ffffff;
  border: none;
  padding: 5px 10px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
}

.btn-pwd-copy:hover {
  background: #0369a1;
}

.btn-pwd-copy.is-copied {
  background: #10b981;
}

.app-pwd-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.app-pwd-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  background: rgba(0, 0, 0, 0.02);
  border: 1px solid var(--border, rgba(0, 0, 0, 0.05));
  border-radius: 8px;
}

.app-pwd-info {
  display: flex;
  align-items: center;
  gap: 8px;
}

.app-pwd-icon {
  font-size: 1.1rem;
}

.app-pwd-details {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.app-pwd-name {
  font-size: 13px;
  color: var(--text, #0f172a);
}

.app-pwd-time {
  font-size: 11px;
  color: var(--text-secondary, #94a3b8);
}

.btn-revoke-pwd {
  background: transparent;
  border: 1px solid rgba(239, 68, 68, 0.3);
  color: #dc2626;
  padding: 4px 8px;
  border-radius: 6px;
  font-size: 11.5px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.btn-revoke-pwd:hover {
  background: rgba(239, 68, 68, 0.1);
  border-color: #ef4444;
}

@media (max-width: 640px) {
  .crop-modal {
    padding: 12px;
  }
  .crop-panel {
    padding: 20px 16px;
    border-radius: 18px;
    gap: 14px;
  }
  .crop-stage {
    max-width: 100%;
  }
  .webdav-param-item {
    flex-direction: column;
    align-items: stretch;
    gap: 8px;
  }
  .param-value-box {
    max-width: 100%;
    width: 100%;
    min-width: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .param-code {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

/* Font Size Controls & Live Preview */
.font-size-header-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.font-size-val-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.font-size-badge {
  font-size: 11px;
  font-weight: 700;
  color: #0284c7;
  background: rgba(56, 189, 248, 0.12);
  padding: 2px 8px;
  border-radius: 6px;
}

.font-reset-link {
  background: none;
  border: none;
  padding: 0;
  color: #64748b;
  font-size: 11px;
  cursor: pointer;
  text-decoration: underline;
  transition: color 0.15s;
}

.font-reset-link:hover {
  color: #0284c7;
}

.font-presets-grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 6px;
  margin-top: 6px;
}

.font-preset-btn {
  padding: 6px 2px;
  font-size: 11.5px;
  background: var(--surface-1, #ffffff);
  border: 1px solid var(--border, #e2e8f0);
  border-radius: 8px;
  color: var(--text-secondary, #64748b);
  cursor: pointer;
  text-align: center;
  transition: all 0.15s ease;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.font-preset-btn:hover {
  background: var(--surface-2, #f1f5f9);
  color: var(--text, #0f172a);
  border-color: var(--border-strong, #cbd5e1);
}

.font-preset-btn.active {
  background: rgba(0, 168, 132, 0.12);
  border-color: #008069;
  color: #008069;
  font-weight: 700;
  box-shadow: 0 0 0 1px #008069;
}

.font-slider-container {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 8px;
  padding: 4px 6px;
  background: rgba(0, 0, 0, 0.02);
  border-radius: 10px;
}

.font-slider-label-min {
  font-size: 12px;
  font-weight: 700;
  color: var(--text-secondary, #64748b);
  user-select: none;
}

.font-slider-label-max {
  font-size: 18px;
  font-weight: 700;
  color: var(--text, #0f172a);
  user-select: none;
}

.font-slider-input {
  flex: 1;
  height: 6px;
  accent-color: #008069;
  cursor: pointer;
}

.font-preview-card {
  margin-top: 8px;
  padding: 12px 14px;
  background: var(--surface-2, rgba(0, 0, 0, 0.03));
  border: 1px dashed var(--border, rgba(0, 0, 0, 0.1));
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.font-preview-bubble {
  position: relative;
  max-width: 85%;
  padding: 6px 10px 7px;
  border-radius: 8px;
  box-shadow: 0 1px 0.5px rgba(11,20,26,.13);
  word-break: break-word;
}

.font-preview-bubble--peer {
  align-self: flex-start;
  background: var(--surface-1, #ffffff);
  border: 1px solid var(--border, rgba(11, 20, 26, 0.08));
}

.font-preview-bubble--own {
  align-self: flex-end;
  background: #d9fdd3;
  border: 1px solid rgba(45, 156, 151, 0.22);
}

html[data-theme="dark"] .font-preview-bubble--peer,
html.dark .font-preview-bubble--peer {
  background: #1e2433 !important;
  border-color: rgba(255, 255, 255, 0.08) !important;
}

html[data-theme="dark"] .font-preview-bubble--own,
html.dark .font-preview-bubble--own {
  background: #054d3b !important;
  border-color: rgba(45, 156, 151, 0.3) !important;
}

.font-preview-sender {
  display: block;
  font-size: 11px;
  font-weight: 600;
  color: #008069;
  margin-bottom: 2px;
}

.font-preview-msg {
  margin: 0;
  font-size: var(--chat-font-size, 15px);
  line-height: var(--chat-line-height, 1.45);
  color: var(--text, #111b21);
}

.font-preview-time {
  display: block;
  text-align: right;
  font-size: clamp(10px, calc(var(--chat-font-size, 15px) * 0.74), 13px);
  color: #667781;
  margin-top: 2px;
  line-height: 1;
}

@media (max-width: 640px) {
  .font-presets-grid {
    grid-template-columns: repeat(auto-fit, minmax(62px, 1fr));
    gap: 4px;
  }
  .font-preset-btn {
    font-size: 10.5px;
    padding: 5px 2px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .settings-container,
  .settings-section,
  .settings-nav {
    animation: none;
    opacity: 1;
    transform: none;
  }
}
</style>
