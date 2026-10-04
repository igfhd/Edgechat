<script setup>
import { ref, computed, onMounted } from 'vue';
import { ChevronDown, Folder, MessageSquare, Search, Users, X, Check } from '@lucide/vue';
import { groupCandidatesForSharing } from '../../utils/userGrouping.js';
import api from '../../api.js';
import { useCloudDrive } from '../../composables/useCloudDrive.js';
import { getEdgeChatServerOrigin, isCapacitorAndroid } from '../../capacitor-platform.js';
import UiAvatar from '../ui/Avatar.vue';

const props = defineProps({
  file: {
    type: Object,
    required: true
  },
  onClose: {
    type: Function,
    required: true
  },
  onCreateShare: {
    type: Function,
    required: true
  }
});

const { loadShareCandidates, loadMemberShares, createMemberShare, revokeMemberShare } = useCloudDrive();

// Active tab: 'member' | 'external'
const activeTab = ref('member');

// External Share State
const permission = ref('view');
const expiresDays = ref(7);
const password = ref('');
const isSubmittingExternal = ref(false);
const shareResult = ref(null);
const copied = ref(false);

// Internal Member Share State
const candidates = ref({ users: [], rooms: [] });
const isLoadingCandidates = ref(true);
const selectedTargetKeys = ref(new Set()); // Set of "user:123" | "room:456"
const memberPermission = ref('read');
const isSubmittingMember = ref(false);
const activeMemberShares = ref([]);
const isLoadingMemberShares = ref(false);
const searchQuery = ref('');
const collapsedGroupKeys = ref(new Set());

const groupedCandidates = computed(() => {
  return groupCandidatesForSharing(candidates.value, searchQuery.value);
});

function isGroupExpanded(groupKey) {
  if (searchQuery.value.trim()) {
    return true; // 搜索时自动展开匹配的分组
  }
  return !collapsedGroupKeys.value.has(groupKey);
}

function toggleGroup(groupKey) {
  const next = new Set(collapsedGroupKeys.value);
  if (next.has(groupKey)) {
    next.delete(groupKey);
  } else {
    next.add(groupKey);
  }
  collapsedGroupKeys.value = next;
}

function expandAllGroups() {
  collapsedGroupKeys.value = new Set();
}

function collapseAllGroups() {
  collapsedGroupKeys.value = new Set(groupedCandidates.value.map((g) => g.id));
}

function isTargetSelected(item) {
  return selectedTargetKeys.value.has(item.targetKey);
}

function toggleTarget(item) {
  const key = item.targetKey;
  const next = new Set(selectedTargetKeys.value);
  if (next.has(key)) {
    next.delete(key);
  } else {
    next.add(key);
  }
  selectedTargetKeys.value = next;
}

function selectTarget(item) {
  toggleTarget(item);
}

function isGroupAllSelected(group) {
  if (!group?.items || group.items.length === 0) return false;
  return group.items.every((item) => selectedTargetKeys.value.has(item.targetKey));
}

function toggleGroupSelection(group, event) {
  if (event) event.stopPropagation();
  const allSelected = isGroupAllSelected(group);
  const next = new Set(selectedTargetKeys.value);
  if (allSelected) {
    for (const item of group.items) {
      next.delete(item.targetKey);
    }
  } else {
    for (const item of group.items) {
      next.add(item.targetKey);
    }
  }
  selectedTargetKeys.value = next;
}

function selectAllVisible() {
  const next = new Set(selectedTargetKeys.value);
  for (const group of groupedCandidates.value) {
    for (const item of group.items) {
      next.add(item.targetKey);
    }
  }
  selectedTargetKeys.value = next;
}

function clearAllSelection() {
  selectedTargetKeys.value = new Set();
}

function removeTargetKey(key) {
  const next = new Set(selectedTargetKeys.value);
  next.delete(key);
  selectedTargetKeys.value = next;
}

const selectedTargetsList = computed(() => {
  if (selectedTargetKeys.value.size === 0) return [];
  const list = [];
  const userMap = new Map((candidates.value?.users || []).map((user) => [Number(user.id), user]));
  const roomMap = new Map((candidates.value?.rooms || []).map((room) => [Number(room.id), room]));

  for (const key of selectedTargetKeys.value) {
    const [targetType, targetIdStr] = key.split(':');
    const targetId = Number(targetIdStr);
    if (targetType === 'user') {
      const u = userMap.get(targetId);
      if (u) {
        list.push({
          key,
          targetType: 'user',
          targetId,
          name: u.displayName || u.display_name || u.username,
          sub: `@${u.username}`
        });
      }
    } else if (targetType === 'room') {
      const r = roomMap.get(targetId);
      if (r) {
        list.push({
          key,
          targetType: 'room',
          targetId,
          name: r.name,
          sub: r.kind === 'private' ? '私密群组' : '公开群组'
        });
      }
    }
  }
  return list;
});

// 向后兼容保留单项预览
const selectedTargetSummary = computed(() => {
  const first = selectedTargetsList.value[0];
  return first || null;
});

onMounted(async () => {
  isLoadingCandidates.value = true;
  isLoadingMemberShares.value = true;
  try {
    const [candRes, shares] = await Promise.all([
      loadShareCandidates(),
      loadMemberShares(props.file.id)
    ]);
    candidates.value = candRes || { users: [], rooms: [] };
    activeMemberShares.value = shares || [];
  } catch (err) {
    console.warn('Failed to load share candidates or member shares:', err);
  } finally {
    isLoadingCandidates.value = false;
    isLoadingMemberShares.value = false;
  }
});

const handleAddMemberShare = async () => {
  if (selectedTargetKeys.value.size === 0) {
    alert('请选择要授权的成员或群聊');
    return;
  }
  const targets = Array.from(selectedTargetKeys.value).map((key) => {
    const [targetType, targetIdStr] = key.split(':');
    return {
      targetType,
      targetId: Number(targetIdStr)
    };
  });

  isSubmittingMember.value = true;
  try {
    await createMemberShare(props.file.id, targets, memberPermission.value);
    activeMemberShares.value = await loadMemberShares(props.file.id);
    selectedTargetKeys.value = new Set();
  } catch (err) {
    alert(err.message || '添加授权失败');
  } finally {
    isSubmittingMember.value = false;
  }
};

const handleRevokeMember = async (shareId) => {
  if (confirm('确定要撤销该成员/群组的访问权限吗？')) {
    try {
      await revokeMemberShare(shareId);
      activeMemberShares.value = await loadMemberShares(props.file.id);
    } catch (err) {
      alert(err.message || '撤销授权失败');
    }
  }
};

const handleCreateExternal = async () => {
  isSubmittingExternal.value = true;
  try {
    const res = await props.onCreateShare(props.file.id, {
      permission: permission.value,
      expiresDays: Number(expiresDays.value),
      password: password.value.trim() || null
    });
    const origin = isCapacitorAndroid ? getEdgeChatServerOrigin() : window.location.origin;
    const prefix = api.getBasePrefix();
    shareResult.value = {
      ...res,
      fullUrl: `${origin}${prefix}/s/${res.shareToken}`
    };
  } catch (err) {
    alert(err.message || '创建分享链接失败');
  } finally {
    isSubmittingExternal.value = false;
  }
};

const copyShareLink = async () => {
  if (!shareResult.value?.fullUrl) return;
  try {
    await navigator.clipboard.writeText(shareResult.value.fullUrl);
    copied.value = true;
    setTimeout(() => { copied.value = false; }, 2000);
  } catch {
    alert('复制失败，请手动复制');
  }
};

const formatMemberPerm = (p) => {
  if (p === 'admin') return '完全管理';
  if (p === 'write') return '读写协同';
  return '只读下载';
};
</script>

<template>
  <div class="share-dialog-backdrop" @click.self="onClose">
    <div class="share-dialog-card">
      <div class="share-dialog-header">
        <div class="header-titles">
          <span class="file-icon">{{ file.is_folder ? '📁' : '📄' }}</span>
          <h3 class="share-dialog-title" :title="file.name">分享「{{ file.name }}」</h3>
        </div>
        <button type="button" class="share-close-btn" @click="onClose" title="关闭">×</button>
      </div>

      <!-- Tab Switcher -->
      <div class="share-tabs-bar">
        <button type="button"
          class="share-tab-btn"
          :class="{ active: activeTab === 'member' }"
          @click="activeTab = 'member'"
        >
          <span>👥 站内成员分享</span>
        </button>
        <button type="button"
          class="share-tab-btn"
          :class="{ active: activeTab === 'external' }"
          @click="activeTab = 'external'"
        >
          <span>🌐 公开外链分享</span>
        </button>
      </div>

      <!-- TAB 1: INTERNAL MEMBER SHARING -->
      <div v-if="activeTab === 'member'" class="share-dialog-body">
        <div class="member-add-box">
          <!-- 搜索与分组折叠控制栏 -->
          <div class="share-candidate-search-bar">
            <div class="share-search-box">
              <Search :size="14" class="share-search-icon" />
              <input
                v-model="searchQuery"
                type="search"
                class="share-search-input"
                placeholder="搜索成员姓名、用户名、部门或群聊..."
              />
              <button
                v-if="searchQuery"
                type="button"
                class="share-search-clear"
                title="清空"
                @click="searchQuery = ''"
              >
                <X :size="13" />
              </button>
            </div>
            <div v-if="groupedCandidates.length > 0" class="share-tools-actions">
              <button type="button" class="btn-text-action" @click="selectAllVisible">全选结果</button>
              <span class="action-divider">|</span>
              <button
                v-if="selectedTargetKeys.size > 0"
                type="button"
                class="btn-text-action btn-text-action--danger"
                @click="clearAllSelection"
              >
                清空已选
              </button>
              <span v-if="selectedTargetKeys.size > 0" class="action-divider">|</span>
              <button type="button" class="btn-text-action" @click="expandAllGroups">全部展开</button>
              <span class="action-divider">|</span>
              <button type="button" class="btn-text-action" @click="collapseAllGroups">全部折叠</button>
            </div>
          </div>

          <!-- 分组候选列表 -->
          <div class="share-candidate-list">
            <div v-if="isLoadingCandidates" class="share-candidate-empty">
              正在加载成员与群组列表...
            </div>
            <div v-else-if="!groupedCandidates.length" class="share-candidate-empty">
              {{ searchQuery ? '未找到匹配的成员或群聊' : '暂无可授权的成员或群聊' }}
            </div>
            <div
              v-for="group in groupedCandidates"
              :key="group.id"
              class="share-group-accordion"
            >
              <!-- 分组标题 -->
              <button
                type="button"
                class="share-group-header"
                :aria-expanded="isGroupExpanded(group.id)"
                @click="toggleGroup(group.id)"
              >
                <div class="share-group-header__left">
                  <ChevronDown
                    :size="15"
                    class="share-group-chevron"
                    :class="{ 'share-group-chevron--collapsed': !isGroupExpanded(group.id) }"
                  />
                  <MessageSquare v-if="group.type === 'room'" :size="14" class="share-group-icon share-group-icon--room" />
                  <Folder v-else-if="group.groupId" :size="14" class="share-group-icon" />
                  <Users v-else :size="14" class="share-group-icon" />
                  <strong class="share-group-name">{{ group.name }}</strong>
                  <span class="share-group-count">{{ group.items.length }} {{ group.type === 'room' ? '间' : '人' }}</span>
                </div>
                <div class="share-group-header__right">
                  <button
                    type="button"
                    class="btn-group-select-all"
                    :title="isGroupAllSelected(group) ? '取消全选本组' : '全选本组'"
                    @click.stop="toggleGroupSelection(group, $event)"
                  >
                    {{ isGroupAllSelected(group) ? '取消全选' : '全选本组' }}
                  </button>
                  <span class="share-group-hint">{{ isGroupExpanded(group.id) ? '折叠' : '展开' }}</span>
                </div>
              </button>

              <!-- 分组内部候选成员/群聊卡片 -->
              <div v-show="isGroupExpanded(group.id)" class="share-group-body">
                <button
                  v-for="item in group.items"
                  :key="item.targetKey"
                  type="button"
                  class="share-candidate-card"
                  :class="{ 'share-candidate-card--selected': isTargetSelected(item) }"
                  @click="toggleTarget(item)"
                >
                  <div class="share-candidate-card__left">
                    <UiAvatar
                      v-if="item.targetType === 'user'"
                      :src="item.avatarUrl || item.avatar_url"
                      :fallback="(item.displayName || item.display_name || '?')[0]"
                      size="sm"
                    />
                    <span v-else class="share-room-icon">💬</span>
                    <div class="share-candidate-info">
                      <div class="share-candidate-title-row">
                        <strong class="share-candidate-title">{{ item.displayName || item.name }}</strong>
                        <span v-if="item.isLeader" class="share-leader-tag">组长</span>
                      </div>
                      <small v-if="item.username" class="share-candidate-sub">@{{ item.username }}</small>
                      <small v-else class="share-candidate-sub">{{ item.kind === 'private' ? '私密群组' : '公开群组' }}</small>
                    </div>
                  </div>
                  <div class="share-candidate-card__right">
                    <div
                      class="share-select-checkbox share-select-radio"
                      :class="{
                        'share-select-checkbox--checked': isTargetSelected(item),
                        'share-select-radio--checked': isTargetSelected(item)
                      }"
                    >
                      <Check v-if="isTargetSelected(item)" :size="12" :stroke-width="3" />
                    </div>
                  </div>
                </button>
              </div>
            </div>
          </div>

          <!-- 授权确认面板 -->
          <div class="share-action-panel">
            <div class="selected-target-preview">
              <div class="selected-target-header">
                <span class="selected-target-label">
                  授权对象<span v-if="selectedTargetKeys.size > 0" class="selected-count-badge">（已选 {{ selectedTargetKeys.size }} 个）</span>：
                </span>
                <button
                  v-if="selectedTargetKeys.size > 0"
                  type="button"
                  class="btn-text-action btn-text-action--danger btn-clear-all"
                  @click="clearAllSelection"
                >
                  清空已选
                </button>
              </div>
              <div v-if="selectedTargetsList.length > 0" class="selected-target-pills-wrap">
                <span
                  v-for="target in selectedTargetsList"
                  :key="target.key"
                  class="selected-target-pill"
                >
                  <span class="pill-icon">{{ target.targetType === 'user' ? '👤' : '💬' }}</span>
                  <strong class="pill-name">{{ target.name }}</strong>
                  <button
                    type="button"
                    class="btn-clear-selection"
                    :title="`取消选择 ${target.name}`"
                    @click="removeTargetKey(target.key)"
                  >
                    ×
                  </button>
                </span>
              </div>
              <span v-else class="selected-target-placeholder">请在上方勾选要授权的成员或群聊（支持多选与分组全选）</span>
            </div>

            <div class="member-controls-row">
              <select v-model="memberPermission" class="share-select perm-select">
                <option value="read">👁️ 只读下载</option>
                <option v-if="file.is_folder" value="write">✏️ 读写协同</option>
                <option value="admin">👑 完全管理</option>
              </select>

              <button
                type="button"
                class="share-btn share-btn-primary add-member-btn"
                :disabled="selectedTargetKeys.size === 0 || isSubmittingMember"
                @click="handleAddMemberShare"
              >
                {{
                  isSubmittingMember
                    ? '授权中...'
                    : selectedTargetKeys.size > 1
                      ? `批量添加授权 (${selectedTargetKeys.size})`
                      : selectedTargetKeys.size === 1
                        ? '添加授权 (1)'
                        : '添加授权'
                }}
              </button>
            </div>
          </div>
          <p class="member-perm-tip">
            💡 授权后，对方可在网盘左侧的<strong>「与我共享」</strong>专区直接查看该文件并参与协同。
          </p>
        </div>

        <!-- Existing Member Shares List -->
        <div class="member-shares-section">
          <div class="section-title">已授权成员与群组 ({{ activeMemberShares.length }})</div>

          <div v-if="activeMemberShares.length === 0" class="member-shares-empty">
            <span>暂未向任何站内成员授权</span>
          </div>

          <div v-else class="member-shares-list">
            <div v-for="ms in activeMemberShares" :key="ms.id" class="member-share-item">
              <div class="member-info">
                <UiAvatar
                  v-if="ms.target_type === 'user'"
                  :src="ms.target_avatar_url"
                  :fallback="(ms.target_name || 'U')[0]"
                  size="sm"
                />
                <span v-else class="room-avatar-icon">💬</span>
                <div class="member-text">
                  <strong class="member-name">{{ ms.target_name }}</strong>
                  <span v-if="ms.target_username" class="member-uname">@{{ ms.target_username }}</span>
                </div>
              </div>

              <div class="member-actions">
                <span
                  class="badge"
                  :class="{
                    'badge-admin': ms.permission === 'admin',
                    'badge-write': ms.permission === 'write',
                    'badge-read': ms.permission === 'read'
                  }"
                >
                  {{ formatMemberPerm(ms.permission) }}
                </span>
                <button type="button"
                  class="btn-revoke-share"
                  title="撤销该成员权限"
                  @click="handleRevokeMember(ms.id)"
                >
                  撤销
                </button>
              </div>
            </div>
          </div>
        </div>

        <div class="share-dialog-actions">
          <button type="button" class="share-btn share-btn-primary" @click="onClose">完成</button>
        </div>
      </div>

      <!-- TAB 2: EXTERNAL PUBLIC SHARING -->
      <div v-else-if="activeTab === 'external' && !shareResult" class="share-dialog-body">
        <div class="share-form-group">
          <label class="share-form-label">访问权限</label>
          <select v-model="permission" class="share-select">
            <option value="view">仅查看与下载</option>
            <option v-if="file.is_folder" value="upload">仅允许上传（匿名投稿箱）</option>
            <option v-if="file.is_folder" value="view_upload">查看与上传协同</option>
          </select>
        </div>

        <div class="share-form-group">
          <label class="share-form-label">有效期</label>
          <select v-model="expiresDays" class="share-select">
            <option :value="1">1 天后失效</option>
            <option :value="7">7 天后失效</option>
            <option :value="30">30 天后失效</option>
            <option :value="0">永久有效</option>
          </select>
        </div>

        <div class="share-form-group">
          <label class="share-form-label">访问提取码 / 密码（可选）</label>
          <input
            v-model="password"
            type="text"
            placeholder="留空则无需密码直接访问"
            class="share-input"
            maxlength="32"
          />
        </div>

        <div class="share-dialog-actions">
          <button type="button" class="share-btn share-btn-secondary" @click="onClose">取消</button>
          <button type="button" class="share-btn share-btn-primary" :disabled="isSubmittingExternal" @click="handleCreateExternal">
            {{ isSubmittingExternal ? '生成中...' : '生成公开外链' }}
          </button>
        </div>
      </div>

      <!-- External Share Success Body -->
      <div v-else-if="activeTab === 'external' && shareResult" class="share-dialog-body share-success-body">
        <div class="share-success-icon">🎉</div>
        <h4 class="share-success-heading">外链分享已生成</h4>
        <div class="share-link-box">
          <input type="text" readonly :value="shareResult.fullUrl" class="share-link-input" />
          <button type="button" class="share-btn share-btn-primary share-copy-btn" @click="copyShareLink">
            {{ copied ? '已复制 ✓' : '复制链接' }}
          </button>
        </div>
        <p v-if="password" class="share-pwd-hint">
          提取密码：<strong class="share-pwd-badge">{{ password }}</strong>
        </p>
        <div class="share-dialog-actions">
          <button type="button" class="share-btn share-btn-secondary" @click="shareResult = null">重新配置</button>
          <button type="button" class="share-btn share-btn-primary" @click="onClose">完成</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.share-dialog-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(8px);
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
}

.share-dialog-card {
  background: var(--surface, #ffffff);
  border: 1px solid var(--border, #e2e8f0);
  border-radius: 16px;
  width: 100%;
  max-width: 620px;
  height: min(780px, calc(100dvh - 36px));
  max-height: calc(100dvh - 36px);
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.2);
  color: var(--text, #0f172a);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.share-dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  background: var(--surface-1, #f8fafc);
  border-bottom: 1px solid var(--border, #e2e8f0);
  flex: 0 0 auto;
}

.header-titles {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.file-icon {
  font-size: 1.25rem;
}

.share-dialog-title {
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
  color: var(--text, #0f172a);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.share-close-btn {
  background: transparent;
  border: none;
  color: var(--text-secondary, #64748b);
  font-size: 1.4rem;
  cursor: pointer;
  padding: 0 4px;
  line-height: 1;
}

.share-close-btn:hover {
  color: var(--text, #0f172a);
}

/* Tabs Bar */
.share-tabs-bar {
  display: flex;
  border-bottom: 1px solid var(--border, #e2e8f0);
  background: var(--surface, #ffffff);
  flex: 0 0 auto;
}

.share-tab-btn {
  flex: 1;
  padding: 11px 16px;
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  color: var(--text-secondary, #64748b);
  font-size: 0.9rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease;
}

.share-tab-btn:hover {
  color: var(--text, #0f172a);
}

.share-tab-btn.active {
  color: #008069;
  border-bottom-color: #008069;
  font-weight: 600;
  background: rgba(0, 128, 105, 0.04);
}

.share-dialog-body {
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}

/* Member Add Box */
.member-add-box {
  display: flex;
  flex-direction: column;
  gap: 10px;
  background: var(--surface-1, #f8fafc);
  padding: 14px;
  border-radius: 12px;
  border: 1px solid var(--border, #e2e8f0);
  flex: 1;
  min-height: 320px;
}

.share-candidate-search-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
  flex: 0 0 auto;
}

.share-search-box {
  position: relative;
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 180px;
}

.share-search-icon {
  position: absolute;
  left: 9px;
  color: var(--text-secondary, #94a3b8);
  pointer-events: none;
}

.share-search-input {
  width: 100%;
  min-height: 32px;
  padding: 6px 28px 6px 28px !important;
  border: 1px solid var(--border, #cbd5e1);
  border-radius: 6px;
  font-size: 12.5px;
  background: var(--surface, #ffffff);
  color: var(--text, #0f172a);
  outline: none;
  transition: border-color 0.15s ease;
}

.share-search-input:focus {
  border-color: #008069;
  box-shadow: 0 0 0 2px rgba(0, 128, 105, 0.12);
}

.share-search-clear {
  position: absolute;
  right: 6px;
  background: transparent;
  border: none;
  color: var(--text-secondary, #94a3b8);
  cursor: pointer;
  padding: 2px;
}

.share-tools-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11.5px;
  flex-shrink: 0;
}

.btn-text-action {
  background: transparent;
  border: none;
  color: #008069;
  font-size: 11.5px;
  cursor: pointer;
  padding: 2px 4px;
  border-radius: 4px;
  font-weight: 500;
}

.btn-text-action:hover {
  background: rgba(0, 128, 105, 0.08);
}

.action-divider {
  color: var(--border, #cbd5e1);
  font-size: 11px;
}

/* Candidate Group Accordion List */
.share-candidate-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 1;
  min-height: 180px;
  overflow-y: auto !important;
  overflow-x: hidden;
  -webkit-overflow-scrolling: touch;
  padding-right: 4px;
  scrollbar-width: thin;
  scrollbar-color: #94a3b8 #f1f5f9;
}

.share-candidate-list::-webkit-scrollbar {
  width: 6px;
}

.share-candidate-list::-webkit-scrollbar-track {
  background: #f1f5f9;
  border-radius: 3px;
}

.share-candidate-list::-webkit-scrollbar-thumb {
  background: #94a3b8;
  border-radius: 3px;
}

.share-candidate-empty {
  padding: 16px;
  text-align: center;
  font-size: 12px;
  color: var(--text-secondary, #64748b);
  background: var(--surface, #ffffff);
  border: 1px dashed var(--border, #cbd5e1);
  border-radius: 8px;
}

.share-group-accordion {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border, #e2e8f0);
  border-radius: 8px;
  background: var(--surface, #ffffff);
  overflow: hidden;
  flex-shrink: 0;
}

.share-group-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 7px 10px;
  background: #edf4f2;
  border: none;
  border-bottom: 1px solid #d8e8e4;
  cursor: pointer;
  user-select: none;
  transition: background 150ms ease;
  flex-shrink: 0;
}

.share-group-header:hover {
  background: #e2edea;
}

.share-group-header__left {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  flex: 1;
}

.share-group-chevron {
  color: var(--text-secondary, #64748b);
  transition: transform 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  flex-shrink: 0;
}

.share-group-chevron--collapsed {
  transform: rotate(-90deg);
}

.share-group-icon {
  color: #008069;
  flex-shrink: 0;
}

.share-group-icon--room {
  color: #0284c7;
}

.share-group-name {
  font-size: 12.5px;
  color: var(--text, #0f172a);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.share-group-count {
  font-size: 11px;
  color: var(--text-secondary, #64748b);
  background: rgba(0, 0, 0, 0.05);
  padding: 1px 5px;
  border-radius: 4px;
  flex-shrink: 0;
}

.share-group-hint {
  font-size: 11px;
  color: var(--text-secondary, #94a3b8);
  flex-shrink: 0;
}

.share-group-body {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
  gap: 4px;
  padding: 6px 6px 6px 18px;
  background: var(--surface, #ffffff);
  flex-shrink: 0;
}

.share-candidate-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 8px;
  background: var(--surface-1, #fafafa);
  border: 1px solid var(--border, #f1f5f9);
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.15s ease;
  text-align: left;
  flex-shrink: 0;
  width: 100%;
}

.share-candidate-card:hover {
  background: #f0fdf4;
  border-color: #86efac;
}

.share-candidate-card--selected {
  background: #f0fdf4 !important;
  border-color: #008069 !important;
  box-shadow: 0 0 0 1px #008069;
}

.share-candidate-card__left {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex: 1;
}

.share-room-icon {
  font-size: 1.1rem;
}

.share-candidate-info {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.share-candidate-title-row {
  display: flex;
  align-items: center;
  gap: 5px;
}

.share-candidate-title {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text, #0f172a);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.share-leader-tag {
  font-size: 10px;
  font-weight: 700;
  color: #b45309;
  background: #fef3c7;
  border: 1px solid #fde68a;
  padding: 0 3px;
  border-radius: 3px;
  line-height: 1.2;
  flex-shrink: 0;
}

.share-candidate-sub {
  font-size: 11px;
  color: var(--text-secondary, #64748b);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.share-candidate-card__right {
  margin-left: 8px;
  flex-shrink: 0;
}

.share-select-checkbox,
.share-select-radio {
  width: 18px;
  height: 18px;
  border-radius: 4px;
  border: 1.5px solid var(--border, #cbd5e1);
  background: var(--surface, #ffffff);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s ease;
  flex-shrink: 0;
}

.share-select-checkbox--checked,
.share-select-radio--checked {
  background: #008069;
  border-color: #008069;
  color: #ffffff;
}

.share-group-header__right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.btn-group-select-all {
  background: rgba(0, 128, 105, 0.08);
  border: 1px solid rgba(0, 128, 105, 0.2);
  color: #008069;
  font-size: 11px;
  font-weight: 500;
  padding: 2px 7px;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s ease;
  line-height: 1.3;
}

.btn-group-select-all:hover {
  background: rgba(0, 128, 105, 0.16);
  border-color: #008069;
}

/* Action confirmation panel */
.share-action-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-top: 4px;
  flex: 0 0 auto;
}

.selected-target-preview {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  min-height: 24px;
}

.selected-target-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
}

.selected-count-badge {
  color: #008069;
  font-weight: 600;
}

.btn-clear-all {
  font-size: 11px;
  padding: 1px 4px;
}

.btn-text-action--danger {
  color: #dc2626;
}

.btn-text-action--danger:hover {
  background: rgba(220, 38, 38, 0.08);
}

.selected-target-pills-wrap {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  max-height: 64px;
  overflow-y: auto;
  width: 100%;
  padding: 2px 0;
  scrollbar-width: thin;
}

.selected-target-label {
  color: var(--text-secondary, #64748b);
  font-size: 12px;
  flex-shrink: 0;
}

.selected-target-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 7px;
  background: #e6f4f1;
  border: 1px solid #b7e4db;
  border-radius: 6px;
  color: #008069;
  font-size: 11.5px;
}

.pill-icon {
  font-size: 11px;
  flex-shrink: 0;
}

.pill-name {
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.selected-target-pill small {
  color: #006a57;
}

.btn-clear-selection {
  background: transparent;
  border: none;
  color: #008069;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  padding: 0 2px;
  line-height: 1;
}

.btn-clear-selection:hover {
  color: #dc2626;
}

.selected-target-placeholder {
  color: var(--text-secondary, #94a3b8);
  font-style: italic;
  font-size: 12px;
}

.member-controls-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.perm-select {
  flex: 1;
  min-width: 110px;
}

.add-member-btn {
  white-space: nowrap;
}

.member-perm-tip {
  margin: 0;
  font-size: 0.76rem;
  color: var(--text-secondary, #64748b);
  line-height: 1.4;
}

.member-shares-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: 0 0 auto;
}

.section-title {
  font-size: 0.84rem;
  font-weight: 600;
  color: var(--text, #0f172a);
  flex: 0 0 auto;
}

.member-shares-empty {
  padding: 10px 14px;
  text-align: center;
  font-size: 0.85rem;
  color: var(--text-secondary, #64748b);
  background: var(--surface-1, #f8fafc);
  border-radius: 8px;
  flex: 0 0 auto;
}

.member-shares-list {
  max-height: 120px;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 0 0 auto;
}

.member-share-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  background: var(--surface-1, #f8fafc);
  border: 1px solid var(--border, #e2e8f0);
  border-radius: 8px;
  gap: 12px;
}

.member-info {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.room-avatar-icon {
  font-size: 1.2rem;
}

.member-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.member-name {
  font-size: 0.88rem;
  color: var(--text, #0f172a);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.member-uname {
  font-size: 0.75rem;
  color: var(--text-secondary, #64748b);
}

.member-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.badge {
  padding: 2px 7px;
  border-radius: 6px;
  font-size: 0.75rem;
  font-weight: 500;
}

.badge-admin {
  background: #fef3c7;
  color: #b45309;
}

.badge-write {
  background: #dcfce7;
  color: #15803d;
}

.badge-read {
  background: #e0f2fe;
  color: #0369a1;
}

.btn-revoke-share {
  background: transparent;
  border: none;
  color: #dc2626;
  font-size: 0.8rem;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 4px;
  transition: background 0.15s ease;
}

.btn-revoke-share:hover {
  background: #fee2e2;
}

/* External form */
.share-form-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.share-form-label {
  font-size: 0.86rem;
  color: var(--text, #475569);
  font-weight: 500;
}

.share-select,
.share-input,
.share-link-input {
  width: 100%;
  padding: 9px 12px;
  background: var(--surface-1, #f8fafc);
  border: 1px solid var(--border, #e2e8f0);
  border-radius: 8px;
  color: var(--text, #0f172a);
  font-size: 0.9rem;
  outline: none;
  box-sizing: border-box;
  transition: border-color 0.15s ease;
}

.share-select:focus,
.share-input:focus {
  border-color: #008069;
  background: var(--surface, #ffffff);
}

.share-dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 6px;
  flex: 0 0 auto;
}

.share-btn {
  padding: 8px 16px;
  border-radius: 8px;
  font-size: 0.88rem;
  font-weight: 500;
  cursor: pointer;
  border: none;
  transition: all 0.15s ease;
}

.share-btn-primary {
  background: #008069;
  color: #ffffff;
}

.share-btn-primary:hover:not(:disabled) {
  background: #006a57;
}

.share-btn-primary:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.share-btn-secondary {
  background: var(--surface-1, #f1f5f9);
  border: 1px solid var(--border, #e2e8f0);
  color: var(--text, #334155);
}

.share-btn-secondary:hover {
  background: var(--surface-2, #e2e8f0);
}

.share-success-body {
  align-items: center;
  text-align: center;
}

.share-success-icon {
  font-size: 2.6rem;
}

.share-success-heading {
  margin: 0;
  font-size: 1.1rem;
  font-weight: 600;
  color: var(--text, #0f172a);
}

.share-link-box {
  display: flex;
  gap: 8px;
  width: 100%;
}

.share-link-input {
  flex: 1;
  font-size: 0.85rem;
}

.share-copy-btn {
  white-space: nowrap;
}

.share-pwd-hint {
  font-size: 0.85rem;
  color: var(--text-secondary, #64748b);
  margin: 0;
}

.share-pwd-badge {
  background: var(--surface-2, #f1f5f9);
  padding: 2px 7px;
  border-radius: 4px;
  color: #008069;
  font-family: monospace;
}

@media (max-width: 640px) {
  .share-dialog-backdrop {
    align-items: flex-end;
    padding: 0;
  }
  .share-dialog-card {
    max-width: 100%;
    border-radius: 18px 18px 0 0;
    height: min(92vh, calc(100dvh - env(safe-area-inset-top, 0px)));
    max-height: calc(100dvh - env(safe-area-inset-top, 0px));
    padding-bottom: max(10px, env(safe-area-inset-bottom, 10px));
  }
  .share-dialog-header {
    padding: 12px 14px;
  }
  .share-dialog-body {
    padding: 12px 10px;
    gap: 10px;
  }
  .share-candidate-search-bar {
    flex-direction: column;
    align-items: stretch;
    gap: 6px;
  }
  .share-tools-actions {
    justify-content: flex-end;
    flex-wrap: wrap;
    gap: 3px;
  }
  .share-group-header {
    padding: 8px 10px;
  }
  .btn-group-select-all {
    padding: 3px 8px;
    font-size: 11px;
  }
  .share-group-body {
    grid-template-columns: 1fr;
    padding: 6px 6px 6px 12px;
  }
  .share-candidate-card {
    padding: 8px 10px;
    min-height: 44px; /* 触屏操作适宜尺寸 */
  }
  .member-add-box {
    min-height: 240px;
    padding: 10px;
  }
  .selected-target-pills-wrap {
    max-height: 56px;
  }
  .member-controls-row {
    flex-direction: column;
    gap: 8px;
  }
  .share-select,
  .add-member-btn {
    width: 100%;
    min-height: 38px;
  }
  .share-link-box {
    flex-direction: column;
  }
  .share-copy-btn {
    width: 100%;
    min-height: 38px;
  }
  .share-dialog-actions {
    flex-direction: column;
  }
  .share-dialog-actions .share-btn {
    width: 100%;
    min-height: 38px;
  }
}
</style>
