<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Crown,
  ExternalLink,
  Eye,
  EyeOff,
  Hash,
  Lock,
  LogIn,
  MessagesSquare,
  RefreshCw,
  Search,
  Shield,
  Trash2,
  UserMinus,
  Users,
  Volume2,
  VolumeX,
  X
} from '@lucide/vue';
import api from '../api.js';
import { formatLocalDateTime } from '../date.js';
import UiAvatar from '../components/ui/Avatar.vue';
import UiBadge from '../components/ui/Badge.vue';
import UiButton from '../components/ui/Button.vue';
import UiSurface from '../components/ui/Surface.vue';

const router = useRouter();
const loading = ref(false);
const savingSettings = ref(false);
const error = ref('');
const success = ref('');

const channels = ref([]);
const searchQuery = ref('');
const generalSettings = reactive({
  hidden: false,
  muted: false
});

// 成员管理弹窗
const showMembersModal = ref(false);
const activeChannel = ref(null);
const channelMembers = ref([]);
const loadingMembers = ref(false);
const memberSearchQuery = ref('');

async function loadData() {
  loading.value = true;
  error.value = '';
  try {
    const payload = await api.adminChannels();
    channels.value = payload.channels || [];
    generalSettings.hidden = Boolean(payload.generalChannelHidden);
    generalSettings.muted = Boolean(payload.generalChannelMuted);
  } catch (err) {
    error.value = err.message || '加载群聊列表失败';
  } finally {
    loading.value = false;
  }
}

async function updateGeneralSetting(field, value) {
  savingSettings.value = true;
  error.value = '';
  success.value = '';
  try {
    const payload = {
      [field]: value
    };
    const res = await api.updateGeneralChannelSettings(payload);
    generalSettings.hidden = Boolean(res.generalChannelHidden);
    generalSettings.muted = Boolean(res.generalChannelMuted);
    success.value = field === 'hidden'
      ? (value ? '默认公开群已设置为隐藏（普通用户不可见）' : '默认公开群已设置为显示（全员可见）')
      : (value ? '默认公开群已开启全员禁言（仅管理员可发言）' : '默认公开群已开启全员自由发言');
    await loadData();
  } catch (err) {
    error.value = err.message || '更新系统群设置失败';
  } finally {
    savingSettings.value = false;
  }
}

async function handleJoinChannel(channel) {
  error.value = '';
  success.value = '';
  try {
    await api.joinChannel(channel.id);
    success.value = `已成功加入群聊「${channel.name}」`;
    await loadData();
  } catch (err) {
    error.value = err.message || '加入群聊失败';
  }
}

function handleGoToChat(channel) {
  void router.push({
    path: '/',
    query: { room: `${channel.kind === 'private' ? 'private' : 'channel'}:${channel.id}` }
  });
}

async function handleDeleteChannel(channel) {
  if (channel.isGeneral) {
    alert('系统默认公开群组不能被删除。如需隐藏请在上方开关中开启「隐藏模式」。');
    return;
  }

  if (!window.confirm(`确定要删除群聊「${channel.name}」吗？此操作将解散该群聊并对所有成员不可见。`)) {
    return;
  }

  error.value = '';
  success.value = '';
  try {
    await api.deleteChannel(channel.id);
    success.value = `群聊「${channel.name}」已成功删除`;
    await loadData();
  } catch (err) {
    error.value = err.message || '删除群聊失败';
  }
}

async function openMembersModal(channel) {
  activeChannel.value = channel;
  memberSearchQuery.value = '';
  showMembersModal.value = true;
  await loadChannelMembers(channel.id);
}

async function loadChannelMembers(channelId) {
  loadingMembers.value = true;
  try {
    const payload = await api.getChannelMembers(channelId);
    channelMembers.value = payload.members || [];
  } catch (err) {
    error.value = err.message || '获取群成员失败';
  } finally {
    loadingMembers.value = false;
  }
}

function closeMembersModal() {
  showMembersModal.value = false;
  activeChannel.value = null;
  channelMembers.value = [];
}

async function handleRemoveMember(member) {
  if (!activeChannel.value) return;
  if (activeChannel.value.isGeneral) {
    alert('系统默认公开群包含全员，不可手动移出单个成员。');
    return;
  }
  if (!window.confirm(`确定要将「${member.displayName}」移出群聊「${activeChannel.value.name}」吗？`)) {
    return;
  }

  error.value = '';
  try {
    await api.removeChannelMember(activeChannel.value.id, member.id);
    await loadChannelMembers(activeChannel.value.id);
    await loadData();
    success.value = `已将「${member.displayName}」移出群聊`;
  } catch (err) {
    error.value = err.message || '移出群成员失败';
  }
}

async function handleTransferOwner(member) {
  if (!activeChannel.value) return;
  if (activeChannel.value.isGeneral) {
    alert('系统默认公开群不可转让群主。');
    return;
  }
  if (!window.confirm(`确定要将群聊「${activeChannel.value.name}」的群主转让给「${member.displayName}」吗？`)) {
    return;
  }

  error.value = '';
  try {
    await api.transferChannelOwner(activeChannel.value.id, member.id);
    await loadChannelMembers(activeChannel.value.id);
    await loadData();
    success.value = `已将群主转让给「${member.displayName}」`;
  } catch (err) {
    error.value = err.message || '转让群主失败';
  }
}

const filteredChannels = computed(() => {
  const q = searchQuery.value.trim().toLowerCase();
  if (!q) return channels.value;
  return channels.value.filter((c) =>
    (c.name || '').toLowerCase().includes(q) ||
    (c.description || '').toLowerCase().includes(q) ||
    (c.ownerDisplayName || '').toLowerCase().includes(q)
  );
});

const filteredMembers = computed(() => {
  const q = memberSearchQuery.value.trim().toLowerCase();
  if (!q) return channelMembers.value;
  return channelMembers.value.filter((m) =>
    (m.displayName || '').toLowerCase().includes(q) ||
    (m.username || '').toLowerCase().includes(q)
  );
});

onMounted(loadData);
</script>

<template>
  <div class="admin-section admin-channels-page">
    <header class="admin-section__header">
      <div class="admin-section__heading">
        <h2>群聊管理</h2>
        <p>维护全站公开群组与私有群组，配置系统默认公开群的显隐与禁言策略，支持管理员直接加入与解散群聊。</p>
      </div>
      <div class="admin-header-actions">
        <UiButton variant="secondary" :disabled="loading" @click="loadData">
          <RefreshCw :size="16" :class="{ 'admin-spin': loading }" />
          刷新
        </UiButton>
      </div>
    </header>

    <div class="admin-section__body">
      <p v-if="error" class="error-text">{{ error }}</p>
      <p v-if="success" class="success-text">{{ success }}</p>

      <!-- 顶部默认系统群策略卡片 -->
      <UiSurface class="panel general-settings-panel">
        <div class="general-settings-header">
          <div class="general-settings-title-row">
            <div class="general-icon-badge">
              <Hash :size="20" />
            </div>
            <div>
              <h3 class="panel-title">默认公开群组设置（#general）</h3>
              <p class="general-panel-subtitle">系统内置的全员大厅，新用户注册后默认关联。支持一键隐藏为「纯私密协同模式」或开启「全员禁言公告模式」。</p>
            </div>
          </div>
          <UiBadge v-if="generalSettings.hidden" variant="cold">已隐藏（纯私密）</UiBadge>
          <UiBadge v-else variant="primary">已显示（全员大厅）</UiBadge>
        </div>

        <div class="general-controls-grid">
          <!-- 开关 1: 可见性 / 隐藏模式 -->
          <div class="general-control-card" :class="{ 'general-control-card--active': generalSettings.hidden }">
            <div class="general-control-info">
              <div class="general-control-title">
                <component :is="generalSettings.hidden ? EyeOff : Eye" :size="18" class="control-icon" />
                <strong>群聊可见性（隐藏模式）</strong>
              </div>
              <p class="general-control-desc">
                {{ generalSettings.hidden
                  ? '当前已开启隐藏模式：普通用户在会话列表看不到 #general，仅展示私聊与被邀请的私密群。'
                  : '当前处于公开展示状态：所有注册用户在前台会话列表均可看到并进入 #general 综合大厅。'
                }}
              </p>
            </div>
            <div class="general-control-action">
              <button
                type="button"
                class="ui-toggle-switch"
                :class="{ 'ui-toggle-switch--on': generalSettings.hidden }"
                :disabled="savingSettings"
                role="switch"
                :aria-checked="generalSettings.hidden"
                @click="updateGeneralSetting('hidden', !generalSettings.hidden)"
              >
                <span class="toggle-handle"></span>
              </button>
              <span class="toggle-status-label">{{ generalSettings.hidden ? '已隐藏' : '已显示' }}</span>
            </div>
          </div>

          <!-- 开关 2: 发言权限 / 全员禁言 -->
          <div class="general-control-card" :class="{ 'general-control-card--active': generalSettings.muted }">
            <div class="general-control-info">
              <div class="general-control-title">
                <component :is="generalSettings.muted ? VolumeX : Volume2" :size="18" class="control-icon" />
                <strong>发言权限（全员禁言）</strong>
              </div>
              <p class="general-control-desc">
                {{ generalSettings.muted
                  ? '当前已开启全员禁言：普通用户在 #general 内无法发送消息，适合用作官方系统通知公告墙。'
                  : '当前处于自由发言状态：所有群内用户均可在 #general 畅所欲言。'
                }}
              </p>
            </div>
            <div class="general-control-action">
              <button
                type="button"
                class="ui-toggle-switch"
                :class="{ 'ui-toggle-switch--on': generalSettings.muted }"
                :disabled="savingSettings"
                role="switch"
                :aria-checked="generalSettings.muted"
                @click="updateGeneralSetting('muted', !generalSettings.muted)"
              >
                <span class="toggle-handle"></span>
              </button>
              <span class="toggle-status-label">{{ generalSettings.muted ? '禁言中' : '可发言' }}</span>
            </div>
          </div>
        </div>
      </UiSurface>

      <!-- 全站群聊列表 -->
      <UiSurface class="panel panel--table">
        <div class="panel-header-row">
          <div class="panel-title-group">
            <h3 class="panel-title">全站群聊列表 ({{ filteredChannels.length }})</h3>
            <span class="panel-subtitle">涵盖系统默认群、公开群组与私密工作群</span>
          </div>
          <div class="panel-search-wrap">
            <Search :size="16" class="search-icon" />
            <input
              v-model="searchQuery"
              type="search"
              class="ui-input search-input"
              placeholder="搜索群名称、简介或群主..."
            />
          </div>
        </div>

        <div class="admin-table-wrap">
          <table class="list-table">
            <thead>
              <tr>
                <th>群聊信息</th>
                <th>群类型</th>
                <th>群主 / 创建者</th>
                <th>成员数</th>
                <th>历史消息</th>
                <th>创建时间</th>
                <th class="th-actions">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="loading && !channels.length">
                <td colspan="7" class="muted">正在加载群聊列表...</td>
              </tr>
              <tr v-else-if="!filteredChannels.length">
                <td colspan="7" class="muted">没有匹配的群聊</td>
              </tr>
              <tr v-for="c in filteredChannels" :key="c.id">
                <td>
                  <div class="channel-info-cell">
                    <UiAvatar :src="c.avatarUrl" :fallback="c.name" size="sm" />
                    <div class="channel-meta">
                      <div class="channel-name-row">
                        <strong>{{ c.name }}</strong>
                        <span v-if="c.isGeneral" class="system-tag">系统内置</span>
                      </div>
                      <span v-if="c.description" class="channel-desc" :title="c.description">
                        {{ c.description }}
                      </span>
                    </div>
                  </div>
                </td>
                <td>
                  <span v-if="c.isGeneral" class="type-badge type-badge--general">
                    <Hash :size="12" /> 全员大厅
                  </span>
                  <span v-else-if="c.kind === 'public'" class="type-badge type-badge--public">
                    <Users :size="12" /> 公开群
                  </span>
                  <span v-else class="type-badge type-badge--private">
                    <Lock :size="12" /> 私有群
                  </span>
                </td>
                <td>
                  <span class="owner-name">{{ c.ownerDisplayName || '系统创建' }}</span>
                </td>
                <td>
                  <strong>{{ c.memberCount }}</strong> 人
                </td>
                <td>
                  <span class="message-count-badge">{{ c.messageCount }} 条</span>
                </td>
                <td>
                  <span class="date-text">{{ formatLocalDateTime(c.createdAt) }}</span>
                </td>
                <td class="td-actions">
                  <div class="channel-actions-group">
                    <UiButton
                      v-if="c.isMember"
                      variant="secondary"
                      size="sm"
                      title="打开聊天会话"
                      @click="handleGoToChat(c)"
                    >
                      <ExternalLink :size="14" />
                      进入
                    </UiButton>
                    <UiButton
                      v-else
                      variant="primary"
                      size="sm"
                      title="以管理员身份加入此群"
                      @click="handleJoinChannel(c)"
                    >
                      <LogIn :size="14" />
                      加入
                    </UiButton>

                    <UiButton
                      variant="secondary"
                      size="sm"
                      title="查看群成员列表"
                      @click="openMembersModal(c)"
                    >
                      <Users :size="14" />
                      成员
                    </UiButton>

                    <UiButton
                      v-if="!c.isGeneral"
                      variant="destructive"
                      size="sm"
                      title="删除并解散群聊"
                      @click="handleDeleteChannel(c)"
                    >
                      <Trash2 :size="14" />
                      删除
                    </UiButton>
                    <span v-else class="general-protect-hint" title="系统群不可删除，可使用上方开关隐藏">
                      保护中
                    </span>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </UiSurface>
    </div>

    <!-- 群成员查看模态弹窗 -->
    <Teleport to="body">
      <div v-if="showMembersModal && activeChannel" class="admin-modal-overlay" @click.self="closeMembersModal">
        <div class="admin-modal-card">
          <header class="admin-modal-header">
            <div>
              <h3>群成员列表 - {{ activeChannel.name }}</h3>
              <p class="modal-subhead">当前共 {{ channelMembers.length }} 位成员</p>
            </div>
            <button type="button" class="admin-modal-close" @click="closeMembersModal">
              <X :size="18" />
            </button>
          </header>

          <div class="admin-modal-body">
            <div class="members-filter-bar">
              <input
                v-model="memberSearchQuery"
                type="search"
                class="ui-input search-input"
                placeholder="搜索成员昵称或用户名..."
              />
            </div>

            <div v-if="loadingMembers" class="empty-hint">
              正在加载成员列表...
            </div>
            <div v-else-if="!filteredMembers.length" class="empty-hint">
              暂无匹配的成员
            </div>
            <div v-else class="members-list-scroll">
              <div v-for="m in filteredMembers" :key="m.id" class="member-list-item">
                <UiAvatar :src="m.avatarUrl" :fallback="m.displayName" size="sm" />
                <div class="member-info">
                  <div class="member-name-row">
                    <strong>{{ m.displayName }}</strong>
                    <span class="muted">@{{ m.username }}</span>
                  </div>
                  <span class="member-joined-at">加入时间：{{ formatLocalDateTime(m.joinedAt) }}</span>
                </div>
                <div class="member-actions">
                  <UiBadge v-if="m.role === 'owner'" variant="warm">群主</UiBadge>
                  <UiBadge v-else variant="cold">成员</UiBadge>

                  <button
                    v-if="!activeChannel.isGeneral && m.role !== 'owner'"
                    type="button"
                    class="btn-transfer-owner"
                    title="转让群主给此成员"
                    @click="handleTransferOwner(m)"
                  >
                    <Crown :size="14" />
                  </button>

                  <button
                    v-if="!activeChannel.isGeneral && m.role !== 'owner'"
                    type="button"
                    class="btn-remove-member"
                    title="移出此群"
                    @click="handleRemoveMember(m)"
                  >
                    <UserMinus :size="14" />
                  </button>
                </div>
              </div>
            </div>
          </div>

          <footer class="admin-modal-footer">
            <UiButton type="button" variant="secondary" @click="closeMembersModal">
              关闭
            </UiButton>
          </footer>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.admin-channels-page {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.admin-header-actions {
  display: flex;
  gap: 10px;
  align-items: center;
}

/* 顶部通用群设置卡片 */
.general-settings-panel {
  display: flex;
  flex-direction: column;
  gap: 18px;
  background: #ffffff;
  border-radius: 14px;
  padding: 20px;
  border: 1px solid #e2e8f0;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.03);
}

.general-settings-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  flex-wrap: wrap;
}

.general-settings-title-row {
  display: flex;
  gap: 12px;
  align-items: flex-start;
}

.general-icon-badge {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  background: rgba(14, 165, 233, 0.1);
  color: #0284c7;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.general-panel-subtitle {
  margin: 4px 0 0;
  font-size: 13px;
  color: #64748b;
  line-height: 1.4;
}

.general-controls-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: 14px;
}

.general-control-card {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 14px;
  padding: 14px 16px;
  border-radius: 10px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  transition: all 0.2s ease;
}

.general-control-card--active {
  background: rgba(14, 165, 233, 0.04);
  border-color: #bae6fd;
}

.general-control-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
}

.general-control-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  color: #1e293b;
}

.control-icon {
  color: #0284c7;
}

.general-control-desc {
  margin: 0;
  font-size: 12px;
  color: #64748b;
  line-height: 1.35;
}

.general-control-action {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.toggle-status-label {
  font-size: 11.5px;
  font-weight: 600;
  color: #475569;
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
}

.ui-toggle-switch--on {
  background: #0284c7;
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
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
  transition: transform 0.2s ease;
  transform: translateX(0);
}

.ui-toggle-switch--on .toggle-handle {
  transform: translateX(20px);
}

/* 表格与搜索栏 */
.panel-header-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
  flex-wrap: wrap;
  gap: 12px;
}

.panel-title-group {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.panel-subtitle {
  font-size: 12.5px;
  color: #64748b;
}

.panel-search-wrap {
  position: relative;
  display: flex;
  align-items: center;
  width: min(280px, 100%);
}

.search-icon {
  position: absolute;
  left: 10px;
  color: #94a3b8;
  pointer-events: none;
}

.search-input {
  width: 100%;
  padding-left: 32px !important;
  font-size: 13px;
}

.channel-info-cell {
  display: flex;
  align-items: center;
  gap: 10px;
}

.channel-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-width: 260px;
}

.channel-name-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.system-tag {
  font-size: 11px;
  color: #0284c7;
  background: #e0f2fe;
  padding: 1px 6px;
  border-radius: 4px;
  font-weight: 600;
}

.channel-desc {
  font-size: 12px;
  color: #64748b;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.type-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  padding: 3px 8px;
  border-radius: 6px;
  font-weight: 500;
}

.type-badge--general {
  background: #e0f2fe;
  color: #0369a1;
}

.type-badge--public {
  background: #f0fdf4;
  color: #15803d;
}

.type-badge--private {
  background: #fef3c7;
  color: #b45309;
}

.owner-name {
  font-size: 13px;
  color: #334155;
}

.message-count-badge {
  font-size: 12.5px;
  color: #475569;
  background: #f1f5f9;
  padding: 2px 6px;
  border-radius: 4px;
}

.date-text {
  font-size: 12px;
  color: #64748b;
}

.channel-actions-group {
  display: flex;
  gap: 6px;
  align-items: center;
}

.general-protect-hint {
  font-size: 11.5px;
  color: #94a3b8;
  padding: 4px 6px;
  background: #f8fafc;
  border-radius: 4px;
  cursor: help;
}

/* 模态弹窗 */
.admin-modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.5);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
  padding: 16px;
}

.admin-modal-card {
  background: #ffffff;
  border-radius: 16px;
  width: min(540px, 100%);
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.15);
  overflow: hidden;
}

.admin-modal-header {
  padding: 16px 20px;
  border-bottom: 1px solid #e2e8f0;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.admin-modal-header h3 {
  margin: 0;
  font-size: 16.5px;
  font-weight: 700;
  color: #0f172a;
}

.modal-subhead {
  margin: 2px 0 0;
  font-size: 12.5px;
  color: #64748b;
}

.admin-modal-close {
  background: transparent;
  border: none;
  color: #64748b;
  cursor: pointer;
  padding: 4px;
  border-radius: 6px;
  display: inline-flex;
}

.admin-modal-close:hover {
  background: #f1f5f9;
  color: #0f172a;
}

.admin-modal-body {
  padding: 16px 20px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.members-filter-bar {
  margin-bottom: 4px;
}

.members-list-scroll {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 380px;
  overflow-y: auto;
}

.member-list-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
}

.member-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  overflow: hidden;
}

.member-name-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13.5px;
}

.member-name-row strong {
  color: #0f172a;
}

.member-joined-at {
  font-size: 11.5px;
  color: #94a3b8;
}

.member-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.btn-remove-member {
  background: transparent;
  border: none;
  color: #ef4444;
  cursor: pointer;
  padding: 4px;
  border-radius: 6px;
  display: inline-flex;
  transition: all 0.15s ease;
}

.btn-remove-member:hover {
  background: #fee2e2;
}

.btn-transfer-owner {
  background: transparent;
  border: none;
  color: #b45309;
  cursor: pointer;
  padding: 4px;
  border-radius: 6px;
  display: inline-flex;
  transition: all 0.15s ease;
}

.btn-transfer-owner:hover {
  background: #fef3c7;
}

.empty-hint {
  text-align: center;
  padding: 30px 0;
  color: #64748b;
  font-size: 13.5px;
}

.admin-modal-footer {
  padding: 14px 20px;
  border-top: 1px solid #e2e8f0;
  background: #f8fafc;
  display: flex;
  justify-content: flex-end;
}

/* 移动端响应式适配 */
@media (max-width: 640px) {
  .admin-channels-page {
    gap: 14px;
  }

  .admin-section__header {
    flex-direction: column;
    align-items: stretch;
    gap: 12px;
  }

  .admin-header-actions {
    width: 100%;
    justify-content: flex-end;
  }

  .general-settings-panel {
    padding: 14px 16px;
    gap: 14px;
  }

  .general-controls-grid {
    grid-template-columns: 1fr;
    gap: 10px;
  }

  .general-control-card {
    flex-direction: column;
    align-items: flex-start;
    gap: 10px;
    padding: 12px 14px;
  }

  .general-control-action {
    width: 100%;
    flex-direction: row;
    justify-content: space-between;
    padding-top: 8px;
    border-top: 1px dashed #e2e8f0;
  }

  .panel-header-row {
    flex-direction: column;
    align-items: stretch;
    gap: 10px;
  }

  .panel-search-wrap {
    width: 100%;
  }

  .channel-actions-group {
    flex-wrap: nowrap;
  }

  .admin-modal-overlay {
    padding: 8px;
  }

  .admin-modal-card {
    width: 100%;
    max-height: 92vh;
    border-radius: 14px;
  }

  .admin-modal-header {
    padding: 12px 16px;
  }

  .admin-modal-body {
    padding: 14px 16px;
  }

  .admin-modal-footer {
    padding: 10px 16px;
  }
}
</style>
