<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import {
  ArrowUpDown,
  Check,
  CheckSquare,
  Crown,
  Edit3,
  Plus,
  RefreshCw,
  Search,
  Square,
  Trash2,
  UserCheck,
  UserMinus,
  UserPlus,
  Users,
  X
} from '@lucide/vue';
import api from '../api.js';
import UiAvatar from '../components/ui/Avatar.vue';
import UiBadge from '../components/ui/Badge.vue';
import UiButton from '../components/ui/Button.vue';
import UiSurface from '../components/ui/Surface.vue';

const loading = ref(false);
const submitting = ref(false);
const error = ref('');
const success = ref('');

const groups = ref([]);
const allUsers = ref([]);

// 编辑/新建分组弹窗
const showGroupModal = ref(false);
const editingGroupId = ref(null);
const groupForm = reactive({
  name: '',
  description: '',
  allowMemberDm: true
});

// 管理成员弹窗
const showMembersModal = ref(false);
const activeGroup = ref(null);
const groupMembers = ref([]);
const loadingMembers = ref(false);
// 成员选人筛选与排序
const memberSearchQuery = ref('');
const currentMemberSearchQuery = ref('');
const filterGroupStatus = ref('all'); // 'all' | 'unassigned' | 'assigned' | 'admin'
const sortMode = ref('name_asc'); // 'name_asc' | 'unassigned_first' | 'created_desc' | 'username_asc'
const selectedUserIdsToAdd = ref([]);

async function loadData() {
  loading.value = true;
  error.value = '';
  try {
    const [groupsPayload, usersPayload] = await Promise.all([
      api.adminGroups(),
      api.adminUsers()
    ]);
    groups.value = groupsPayload.groups || [];
    allUsers.value = usersPayload.users || [];
  } catch (err) {
    error.value = err.message;
  } finally {
    loading.value = false;
  }
}

function openCreateGroupModal() {
  editingGroupId.value = null;
  groupForm.name = '';
  groupForm.description = '';
  groupForm.allowMemberDm = true;
  error.value = '';
  success.value = '';
  showGroupModal.value = true;
}

function openEditGroupModal(group) {
  editingGroupId.value = group.id;
  groupForm.name = group.name;
  groupForm.description = group.description;
  groupForm.allowMemberDm = group.allowMemberDm ?? true;
  error.value = '';
  success.value = '';
  showGroupModal.value = true;
}

function closeGroupModal() {
  showGroupModal.value = false;
  editingGroupId.value = null;
}

async function saveGroup() {
  if (!groupForm.name.trim()) {
    error.value = '请填写分组名称';
    return;
  }

  submitting.value = true;
  error.value = '';
  success.value = '';
  try {
    if (editingGroupId.value) {
      await api.updateAdminGroup(editingGroupId.value, {
        name: groupForm.name,
        description: groupForm.description,
        allowMemberDm: groupForm.allowMemberDm
      });
      success.value = '分组已成功更新';
    } else {
      await api.createAdminGroup({
        name: groupForm.name,
        description: groupForm.description,
        allowMemberDm: groupForm.allowMemberDm
      });
      success.value = '新分组已创建';
    }
    closeGroupModal();
    await loadData();
  } catch (err) {
    error.value = err.message;
  } finally {
    submitting.value = false;
  }
}

async function removeGroup(group) {
  if (!window.confirm(`确认删除分组「${group.name}」吗？此操作将移除该分组内所有用户的关联。`)) {
    return;
  }
  error.value = '';
  try {
    await api.deleteAdminGroup(group.id);
    success.value = `分组「${group.name}」已删除`;
    await loadData();
  } catch (err) {
    error.value = err.message;
  }
}

async function openManageMembersModal(group) {
  activeGroup.value = group;
  memberSearchQuery.value = '';
  currentMemberSearchQuery.value = '';
  filterGroupStatus.value = 'all';
  sortMode.value = 'name_asc';
  selectedUserIdsToAdd.value = [];
  error.value = '';
  success.value = '';
  showMembersModal.value = true;
  await loadGroupMembers(group.id);
}

async function loadGroupMembers(groupId) {
  loadingMembers.value = true;
  try {
    const payload = await api.getAdminGroupMembers(groupId);
    groupMembers.value = payload.members || [];
  } catch (err) {
    error.value = err.message;
  } finally {
    loadingMembers.value = false;
  }
}

function closeMembersModal() {
  showMembersModal.value = false;
  activeGroup.value = null;
  groupMembers.value = [];
}

const currentMemberIds = computed(() => new Set(groupMembers.value.map((m) => m.id)));

// 过滤后的当前组成员 (支持搜索并自动组长置顶 + 姓名升序)
const filteredGroupMembers = computed(() => {
  const query = currentMemberSearchQuery.value.trim().toLowerCase();
  let list = [...groupMembers.value];
  if (query) {
    list = list.filter(
      (m) =>
        (m.displayName || '').toLowerCase().includes(query) ||
        (m.username || '').toLowerCase().includes(query)
    );
  }
  list.sort((a, b) => {
    const aLeader = a.isLeader || a.role === 'leader' ? 0 : 1;
    const bLeader = b.isLeader || b.role === 'leader' ? 0 : 1;
    if (aLeader !== bLeader) return aLeader - bLeader;
    return (a.displayName || a.username || '').localeCompare(
      b.displayName || b.username || '',
      'zh-CN'
    );
  });
  return list;
});

// 统计未分配任何分组的候选用户数
const unassignedUsersCount = computed(() => {
  return allUsers.value.filter(
    (u) => !currentMemberIds.value.has(u.id) && (!u.groups || u.groups.length === 0)
  ).length;
});

// 待添加的候选用户列表（支持多维度过滤、智能搜索与规范排序）
const availableUsersToAdd = computed(() => {
  const query = memberSearchQuery.value.trim().toLowerCase();

  // 1. 过滤已加入当前组的用户
  let candidates = allUsers.value.filter((u) => !currentMemberIds.value.has(u.id));

  // 2. 状态标签分类过滤
  if (filterGroupStatus.value === 'unassigned') {
    candidates = candidates.filter((u) => !u.groups || u.groups.length === 0);
  } else if (filterGroupStatus.value === 'assigned') {
    candidates = candidates.filter((u) => u.groups && u.groups.length > 0);
  } else if (filterGroupStatus.value === 'admin') {
    candidates = candidates.filter((u) => u.isAdmin);
  }

  // 3. 关键字搜索 (支持匹配姓名、用户名、已在的分组名)
  if (query) {
    candidates = candidates.filter((u) => {
      const matchName = (u.displayName || '').toLowerCase().includes(query);
      const matchUsername = (u.username || '').toLowerCase().includes(query);
      const matchGroup = (u.groups || []).some((g) =>
        (g.name || '').toLowerCase().includes(query)
      );
      return matchName || matchUsername || matchGroup;
    });
  }

  // 4. 多种排序模式
  candidates.sort((a, b) => {
    if (sortMode.value === 'name_asc') {
      // 默认：按中文拼音/英文 A-Z 升序
      return (a.displayName || a.username || '').localeCompare(
        b.displayName || b.username || '',
        'zh-CN'
      );
    }
    if (sortMode.value === 'username_asc') {
      // 按账号 @username A-Z 升序
      return (a.username || '').localeCompare(b.username || '', 'en');
    }
    if (sortMode.value === 'unassigned_first') {
      // 未分配分组优先，其次按姓名 A-Z
      const aUnassigned = !a.groups || a.groups.length === 0 ? 0 : 1;
      const bUnassigned = !b.groups || b.groups.length === 0 ? 0 : 1;
      if (aUnassigned !== bUnassigned) return aUnassigned - bUnassigned;
      return (a.displayName || a.username || '').localeCompare(
        b.displayName || b.username || '',
        'zh-CN'
      );
    }
    if (sortMode.value === 'created_desc') {
      // 按注册时间倒序 (最新注册优先)
      return (b.id || 0) - (a.id || 0);
    }
    return 0;
  });

  return candidates;
});

// 全选当前筛选结果判定
const isAllFilteredSelected = computed(() => {
  if (!availableUsersToAdd.value.length) return false;
  return availableUsersToAdd.value.every((u) => selectedUserIdsToAdd.value.includes(u.id));
});

function toggleSelectAllFiltered() {
  if (isAllFilteredSelected.value) {
    const idsToRemove = new Set(availableUsersToAdd.value.map((u) => u.id));
    selectedUserIdsToAdd.value = selectedUserIdsToAdd.value.filter((id) => !idsToRemove.has(id));
  } else {
    const currentSet = new Set(selectedUserIdsToAdd.value);
    availableUsersToAdd.value.forEach((u) => currentSet.add(u.id));
    selectedUserIdsToAdd.value = Array.from(currentSet);
  }
}

function clearSelection() {
  selectedUserIdsToAdd.value = [];
}

function toggleSelectUser(userId) {
  const idx = selectedUserIdsToAdd.value.indexOf(userId);
  if (idx > -1) {
    selectedUserIdsToAdd.value.splice(idx, 1);
  } else {
    selectedUserIdsToAdd.value.push(userId);
  }
}

async function handleAddSelectedMembers() {
  if (!activeGroup.value || !selectedUserIdsToAdd.value.length) return;

  submitting.value = true;
  error.value = '';
  try {
    await api.addAdminGroupMembers(activeGroup.value.id, selectedUserIdsToAdd.value);
    selectedUserIdsToAdd.value = [];
    await loadGroupMembers(activeGroup.value.id);
    await loadData();
    success.value = '已成功添加成员到分组';
  } catch (err) {
    error.value = err.message;
  } finally {
    submitting.value = false;
  }
}

async function handleRemoveMember(member) {
  if (!activeGroup.value) return;
  if (!window.confirm(`确认将「${member.displayName}」从分组「${activeGroup.value.name}」中移出吗？`)) {
    return;
  }

  error.value = '';
  try {
    await api.removeAdminGroupMember(activeGroup.value.id, member.id);
    await loadGroupMembers(activeGroup.value.id);
    await loadData();
    success.value = `已将「${member.displayName}」从分组移出`;
  } catch (err) {
    error.value = err.message;
  }
}

async function handleToggleLeader(member) {
  if (!activeGroup.value || !member) return;
  const newRole = member.isLeader ? 'member' : 'leader';
  error.value = '';
  try {
    await api.setGroupMemberRole(activeGroup.value.id, member.id, newRole);
    await loadGroupMembers(activeGroup.value.id);
    await loadData();
    success.value = newRole === 'leader' ? `已将「${member.displayName}」设为组长` : `已取消「${member.displayName}」的组长身份`;
  } catch (err) {
    error.value = err.message || '设置成员角色失败';
  }
}

onMounted(loadData);
</script>

<template>
  <div class="admin-section admin-groups-page">
    <header class="admin-section__header">
      <div class="admin-section__heading">
        <h2>用户分组管理</h2>
        <p>创建与维护组织架构分组，实现基于分组交集的私聊隔离与防嗅探保护。</p>
      </div>
      <div class="admin-header-actions">
        <UiButton variant="secondary" :disabled="loading" @click="loadData">
          <RefreshCw :size="16" :class="{ 'admin-spin': loading }" />
          刷新
        </UiButton>
        <UiButton variant="primary" @click="openCreateGroupModal">
          <Plus :size="16" />
          新建分组
        </UiButton>
      </div>
    </header>

    <div class="admin-section__body">
      <p v-if="error" class="error-text">{{ error }}</p>
      <p v-if="success" class="success-text">{{ success }}</p>

      <!-- 分组卡片列表 -->
      <UiSurface class="panel">
        <div class="panel-header-row">
          <h3 class="panel-title">已有分组 ({{ groups.length }})</h3>
          <span class="group-rule-hint">💡 仅同属至少一个分组的成员或管理员可互相发起私聊</span>
        </div>

        <div v-if="loading && !groups.length" class="empty-hint">
          正在加载分组列表...
        </div>

        <div v-else-if="!groups.length" class="empty-hint">
          暂未创建任何用户分组。当前服务器处于全员开放模式。点击右上角「新建分组」开启隔离模式。
        </div>

        <div v-else class="groups-grid">
          <div v-for="g in groups" :key="g.id" class="group-card">
            <div class="group-card-header">
              <div class="group-card-icon">
                <Users :size="20" />
              </div>
              <div class="group-card-info">
                <h4 class="group-card-name">{{ g.name }}</h4>
                <p class="group-card-desc">{{ g.description || '暂无描述' }}</p>
              </div>
            </div>

            <div class="group-card-meta">
              <span class="group-member-count">
                👥 <strong>{{ g.memberCount }}</strong> 位成员
                <template v-if="g.leaderCount > 0">
                  · 👑 <strong>{{ g.leaderCount }}</strong> 位组长
                </template>
              </span>
              <span v-if="g.allowMemberDm" class="policy-pill policy-pill--open">💬 允许组员互聊</span>
              <span v-else class="policy-pill policy-pill--restricted">🔒 仅组长可私聊</span>
            </div>

            <div class="group-card-actions">
              <UiButton
                variant="primary"
                size="sm"
                @click="openManageMembersModal(g)"
              >
                <UserPlus :size="14" />
                管理成员
              </UiButton>
              <UiButton
                variant="secondary"
                size="sm"
                title="编辑分组信息"
                @click="openEditGroupModal(g)"
              >
                <Edit3 :size="14" />
                编辑
              </UiButton>
              <UiButton
                variant="destructive"
                size="sm"
                title="删除分组"
                @click="removeGroup(g)"
              >
                <Trash2 :size="14" />
                删除
              </UiButton>
            </div>
          </div>
        </div>
      </UiSurface>
    </div>

    <!-- 创建/编辑分组弹窗 -->
    <Teleport to="body">
      <div v-if="showGroupModal" class="admin-modal-overlay" @click.self="closeGroupModal">
        <div class="admin-modal-card">
          <header class="admin-modal-header">
            <h3>{{ editingGroupId ? '编辑分组' : '新建用户分组' }}</h3>
            <button type="button" class="admin-modal-close" @click="closeGroupModal">
              <X :size="18" />
            </button>
          </header>

          <form @submit.prevent="saveGroup">
            <div class="admin-modal-body">
              <div class="admin-form-group">
                <label for="group-name">分组名称 <span class="required">*</span></label>
                <input
                  id="group-name"
                  v-model.trim="groupForm.name"
                  type="text"
                  class="ui-input"
                  placeholder="例如：研发一部、华东大区、VIP社群"
                  required
                />
              </div>

              <div class="admin-form-group">
                <label for="group-desc">分组描述</label>
                <textarea
                  id="group-desc"
                  v-model.trim="groupForm.description"
                  class="ui-input group-desc-input"
                  rows="3"
                  placeholder="可简述该分组的业务范围或成员特征（选填）"
                ></textarea>
              </div>

              <div class="admin-form-group">
                <label class="toggle-option">
                  <input v-model="groupForm.allowMemberDm" type="checkbox" class="user-checkbox" />
                  <div class="toggle-option-info">
                    <strong>允许组员互相发起私聊</strong>
                    <small>开启后同组成员可自由私聊；关闭后处于管制模式，组员仅可联系组长与管理员</small>
                  </div>
                </label>
              </div>
            </div>

            <footer class="admin-modal-footer">
              <UiButton type="button" variant="secondary" :disabled="submitting" @click="closeGroupModal">
                取消
              </UiButton>
              <UiButton type="submit" variant="primary" :disabled="submitting">
                <Check v-if="!submitting" :size="16" />
                {{ submitting ? '保存中...' : (editingGroupId ? '保存更改' : '立即创建') }}
              </UiButton>
            </footer>
          </form>
        </div>
      </div>
    </Teleport>

    <!-- 管理分组内成员弹窗 -->
    <Teleport to="body">
      <div v-if="showMembersModal && activeGroup" class="admin-modal-overlay" @click.self="closeMembersModal">
        <div class="admin-modal-card admin-modal-card--wide">
          <header class="admin-modal-header">
            <div>
              <h3>管理成员 — {{ activeGroup.name }}</h3>
              <p class="modal-subhead">
                当前组成员 <strong>{{ groupMembers.length }}</strong> 人 · 候选待添加 <strong>{{ availableUsersToAdd.length }}</strong> 人
              </p>
            </div>
            <button type="button" class="admin-modal-close" @click="closeMembersModal">
              <X :size="18" />
            </button>
          </header>

          <div class="admin-modal-body members-modal-layout">
            <!-- 左侧：现有成员列表 -->
            <div class="members-pane current-members-pane">
              <div class="pane-header-row">
                <h4 class="pane-title">
                  👥 现有组成员 ({{ groupMembers.length }})
                </h4>
                <span v-if="groupMembers.length" class="pane-badge">👑 组长置顶</span>
              </div>

              <!-- 现有成员内搜索框 -->
              <div class="search-box-wrapper" style="margin-bottom: 8px;">
                <Search :size="14" class="search-box-icon" />
                <input
                  v-model="currentMemberSearchQuery"
                  type="search"
                  class="ui-input pane-search-input"
                  placeholder="搜索现有成员姓名或账号..."
                />
              </div>

              <div v-if="loadingMembers" class="empty-hint">
                正在加载成员...
              </div>
              <div v-else-if="!groupMembers.length" class="empty-hint">
                该分组暂无成员，请在右侧候选列表中勾选用户添加。
              </div>
              <div v-else-if="!filteredGroupMembers.length" class="empty-hint">
                未搜索到匹配的现有成员
              </div>
              <div v-else class="members-scroll-list">
                <div
                  v-for="m in filteredGroupMembers"
                  :key="m.id"
                  class="member-row"
                  :class="{ 'member-row--leader': m.isLeader }"
                >
                  <UiAvatar :src="m.avatarUrl" :fallback="m.displayName" size="sm" />
                  <div class="member-row-info">
                    <div class="member-name-line">
                      <strong>{{ m.displayName }}</strong>
                      <span class="user-handle">@{{ m.username }}</span>
                    </div>
                  </div>
                  <div class="member-row-actions">
                    <UiBadge v-if="m.isAdmin" variant="warm">管理员</UiBadge>
                    <UiBadge v-if="m.isLeader" variant="warm">👑 组长</UiBadge>
                    <UiBadge v-else-if="!m.isAdmin" variant="secondary">组员</UiBadge>

                    <button
                      type="button"
                      class="btn-icon-role"
                      :class="{ 'btn-icon-role--active': m.isLeader }"
                      :title="m.isLeader ? '取消组长身份 (降为组员)' : '设为本组组长 (负责管理与私聊权限)'"
                      @click="handleToggleLeader(m)"
                    >
                      <Crown :size="15" />
                    </button>

                    <button
                      type="button"
                      class="btn-icon-remove"
                      title="从本分组移出"
                      @click="handleRemoveMember(m)"
                    >
                      <UserMinus :size="15" />
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <!-- 右侧：添加新成员区域 -->
            <!-- 右侧：添加新成员候选区 (全面重构排序、过滤与批量勾选) -->
            <div class="members-pane add-members-pane">
              <div class="pane-header-row">
                <h4 class="pane-title">
                  ➕ 候选用户 ({{ availableUsersToAdd.length }})
                </h4>
                <!-- 排序方式下拉选择 -->
                <div class="sort-selector">
                  <ArrowUpDown :size="13" class="sort-icon" />
                  <select v-model="sortMode" class="sort-dropdown">
                    <option value="name_asc">🔤 按姓名 A-Z (默认)</option>
                    <option value="unassigned_first">⚡ 未分配分组优先</option>
                    <option value="created_desc">🕒 注册时间 (最新优先)</option>
                    <option value="username_asc">👤 账号 @username</option>
                  </select>
                </div>
              </div>

              <!-- 搜索栏 -->
              <div class="search-box-wrapper">
                <Search :size="14" class="search-box-icon" />
                <input
                  v-model="memberSearchQuery"
                  type="search"
                  class="ui-input pane-search-input"
                  placeholder="搜索姓名、@账号 或 已在分组..."
                />
              </div>

              <!-- 分类筛选快捷标签 (Filter Chips) -->
              <div class="filter-chips-row">
                <button
                  type="button"
                  class="filter-chip"
                  :class="{ 'filter-chip--active': filterGroupStatus === 'all' }"
                  @click="filterGroupStatus = 'all'"
                >
                  全部
                </button>
                <button
                  type="button"
                  class="filter-chip"
                  :class="{ 'filter-chip--active': filterGroupStatus === 'unassigned' }"
                  @click="filterGroupStatus = 'unassigned'"
                >
                  未分配分组 ({{ unassignedUsersCount }})
                </button>
                <button
                  type="button"
                  class="filter-chip"
                  :class="{ 'filter-chip--active': filterGroupStatus === 'assigned' }"
                  @click="filterGroupStatus = 'assigned'"
                >
                  已在其它组
                </button>
                <button
                  type="button"
                  class="filter-chip"
                  :class="{ 'filter-chip--active': filterGroupStatus === 'admin' }"
                  @click="filterGroupStatus = 'admin'"
                >
                  管理员
                </button>
              </div>

              <!-- 批量全选 / 清空控制条 -->
              <div class="batch-control-bar">
                <button
                  type="button"
                  class="btn-select-all"
                  :disabled="!availableUsersToAdd.length"
                  @click="toggleSelectAllFiltered"
                >
                  <component :is="isAllFilteredSelected ? CheckSquare : Square" :size="15" />
                  <span>{{ isAllFilteredSelected ? '取消全选本页' : '全选当前筛选' }} ({{ availableUsersToAdd.length }})</span>
                </button>

                <button
                  v-if="selectedUserIdsToAdd.length"
                  type="button"
                  class="btn-clear-selection"
                  @click="clearSelection"
                >
                  清空已选 ({{ selectedUserIdsToAdd.length }})
                </button>
              </div>

              <!-- 候选用户列表 (带分组标签、规整排序与高亮) -->
              <div class="available-users-list">
                <div
                  v-for="u in availableUsersToAdd"
                  :key="u.id"
                  class="selectable-user-item"
                  :class="{ 'selectable-user-item--selected': selectedUserIdsToAdd.includes(u.id) }"
                  @click="toggleSelectUser(u.id)"
                >
                  <input
                    type="checkbox"
                    :checked="selectedUserIdsToAdd.includes(u.id)"
                    class="user-checkbox"
                    @click.stop="toggleSelectUser(u.id)"
                  />
                  <UiAvatar :src="u.avatarUrl" :fallback="u.displayName" size="sm" />
                  <div class="selectable-user-info">
                    <div class="user-headline">
                      <strong class="user-display-name">{{ u.displayName }}</strong>
                      <span class="user-handle">@{{ u.username }}</span>
                      <UiBadge v-if="u.isAdmin" variant="warm" size="sm" class="user-admin-badge">管理员</UiBadge>
                    </div>

                    <!-- 分组归属标签 -->
                    <div class="user-groups-chips">
                      <span v-if="!u.groups || !u.groups.length" class="group-tag group-tag--none">
                        未分配分组
                      </span>
                      <template v-else>
                        <span
                          v-for="grp in u.groups"
                          :key="grp.id"
                          class="group-tag group-tag--assigned"
                          :title="'已在「' + grp.name + '」中担任 ' + (grp.role === 'leader' ? '组长' : '成员')"
                        >
                          {{ grp.role === 'leader' ? '👑 ' : '' }}{{ grp.name }}
                        </span>
                      </template>
                    </div>
                  </div>
                </div>

                <div v-if="!availableUsersToAdd.length" class="empty-hint" style="padding: 24px 0;">
                  <UserCheck :size="24" style="margin: 0 auto 6px; opacity: 0.5;" />
                  <div>没有匹配的候选用户</div>
                  <small style="color: #94a3b8; font-size: 12px;">可尝试清空搜索词或切换筛选标签</small>
                </div>
              </div>

              <!-- 底部操作栏 -->
              <div class="add-members-footer">
                <span class="selected-count-label">
                  已选中 <strong>{{ selectedUserIdsToAdd.length }}</strong> 位用户
                </span>
                <UiButton
                  variant="primary"
                  size="sm"
                  :disabled="submitting || !selectedUserIdsToAdd.length"
                  @click="handleAddSelectedMembers"
                >
                  <UserPlus :size="14" />
                  {{ submitting ? '正在加入...' : ('加入分组 (' + selectedUserIdsToAdd.length + ')') }}
                </UiButton>
              </div>
            </div>
          </div>

          <footer class="admin-modal-footer">
            <UiButton type="button" variant="secondary" @click="closeMembersModal">
              完成
            </UiButton>
          </footer>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.admin-groups-page {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.admin-header-actions {
  display: flex;
  gap: 10px;
  align-items: center;
}

.panel-header-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
  flex-wrap: wrap;
  gap: 10px;
}

.group-rule-hint {
  font-size: 12.5px;
  color: #0284c7;
  background: rgba(56, 189, 248, 0.1);
  padding: 4px 10px;
  border-radius: 6px;
  border: 1px solid rgba(56, 189, 248, 0.2);
}

.groups-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 16px;
}

.group-card {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 18px;
  border-radius: 14px;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.03);
  transition: all 0.2s ease;
}

.group-card:hover {
  border-color: #cbd5e1;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.06);
}

.group-card-header {
  display: flex;
  gap: 12px;
  align-items: flex-start;
}

.group-card-icon {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  background: rgba(0, 128, 105, 0.1);
  color: #008069;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.group-card-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
  overflow: hidden;
}

.group-card-name {
  margin: 0;
  font-size: 15.5px;
  font-weight: 600;
  color: #0f172a;
}

.group-card-desc {
  margin: 0;
  font-size: 13px;
  color: #64748b;
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.group-card-meta {
  margin: 14px 0;
  padding-top: 10px;
  border-top: 1px solid #f1f5f9;
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}

.group-member-count {
  font-size: 13px;
  color: #475569;
}

.policy-pill {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 6px;
  font-size: 11.5px;
  font-weight: 600;
}

.policy-pill--open {
  background: #f0fdf4;
  color: #166534;
  border: 1px solid #bbf7d0;
}

.policy-pill--restricted {
  background: #fffbeb;
  color: #92400e;
  border: 1px solid #fde68a;
}

.group-card-actions {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}

.empty-hint {
  text-align: center;
  padding: 36px 0;
  color: #64748b;
  font-size: 14px;
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
  width: min(520px, 100%);
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.15);
  overflow: hidden;
}

.admin-modal-card--wide {
  width: min(920px, 100%);
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
  padding: 20px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.admin-form-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.admin-form-group label {
  font-size: 13.5px;
  font-weight: 600;
  color: #334155;
}

.required {
  color: #dc2626;
}

.group-desc-input {
  resize: vertical;
}

.admin-modal-footer {
  padding: 14px 20px;
  border-top: 1px solid #e2e8f0;
  background: #f8fafc;
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

/* 管理成员双栏布局 */
.members-modal-layout {
  display: grid;
  grid-template-columns: 1fr 1.15fr;
  gap: 20px;
  max-height: 520px;
}

@media (max-width: 700px) {
  .members-modal-layout {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 640px) {
  .admin-modal-overlay {
    padding: 8px;
  }
  .admin-modal-card {
    max-height: 94vh;
    border-radius: 14px;
    width: 100%;
  }
  .admin-modal-header {
    padding: 12px 14px;
  }
  .admin-modal-body {
    padding: 14px;
    gap: 12px;
  }
  .admin-modal-footer {
    padding: 10px 14px;
  }
  .members-modal-layout {
    max-height: 70vh;
  }
}

.members-pane {
  display: flex;
  flex-direction: column;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 14px;
  background: #f8fafc;
  overflow: hidden;
}

.pane-header-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}

.pane-title {
  margin: 0;
  font-size: 13.5px;
  font-weight: 700;
  color: #1e293b;
}

.pane-badge {
  font-size: 11px;
  font-weight: 600;
  background: #fef3c7;
  color: #b45309;
  padding: 2px 7px;
  border-radius: 4px;
  border: 1px solid #fde68a;
}

/* 排序下拉条 */
.sort-selector {
  display: flex;
  align-items: center;
  gap: 4px;
  background: #ffffff;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  padding: 2px 6px;
}

.sort-icon {
  color: #64748b;
}

.sort-dropdown {
  border: none;
  background: transparent;
  font-size: 12px;
  color: #334155;
  outline: none;
  cursor: pointer;
  padding: 2px 0;
}

/* 搜索框包装 */
.search-box-wrapper {
  position: relative;
  margin-bottom: 8px;
}

.search-box-icon {
  position: absolute;
  left: 10px;
  top: 50%;
  transform: translateY(-50%);
  color: #94a3b8;
  pointer-events: none;
}

.pane-search-input {
  width: 100%;
  padding-left: 30px;
  font-size: 12.5px;
  height: 34px;
  background: #ffffff;
}

/* 分类筛选 Chips */
.filter-chips-row {
  display: flex;
  gap: 6px;
  margin-bottom: 8px;
  overflow-x: auto;
  padding-bottom: 2px;
}

.filter-chip {
  background: #ffffff;
  border: 1px solid #e2e8f0;
  color: #64748b;
  font-size: 11.5px;
  font-weight: 500;
  padding: 3px 9px;
  border-radius: 12px;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.15s ease;
}

.filter-chip:hover {
  border-color: #cbd5e1;
  color: #0f172a;
}

.filter-chip--active {
  background: #008069;
  border-color: #008069;
  color: #ffffff;
  font-weight: 600;
}

.filter-chip--active:hover {
  background: #00705c;
  color: #ffffff;
}

/* 批量控制条 */
.batch-control-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 4px 6px 8px;
  font-size: 12px;
}

.btn-select-all {
  display: flex;
  align-items: center;
  gap: 5px;
  background: transparent;
  border: none;
  color: #334155;
  font-size: 12px;
  cursor: pointer;
  padding: 2px 4px;
  border-radius: 4px;
  transition: all 0.15s ease;
}

.btn-select-all:hover:not(:disabled) {
  background: #e2e8f0;
  color: #008069;
}

.btn-select-all:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-clear-selection {
  background: transparent;
  border: none;
  color: #ef4444;
  font-size: 11.5px;
  cursor: pointer;
  padding: 2px 4px;
  border-radius: 4px;
}

.btn-clear-selection:hover {
  text-decoration: underline;
}

.members-scroll-list,
.available-users-list {
  flex: 1;
  overflow-y: auto;
  min-height: 220px;
  max-height: 310px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-right: 2px;
}

.member-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  transition: all 0.15s ease;
}

.member-row:hover {
  border-color: #cbd5e1;
}

.member-row--leader {
  background: #fffdf5;
  border-color: #fde68a;
}

.member-row-info {
  display: flex;
  flex-direction: column;
  flex: 1;
  overflow: hidden;
}

.member-name-line {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.member-name-line strong {
  color: #0f172a;
  font-size: 13px;
}

.user-handle {
  color: #94a3b8;
  font-size: 12px;
}

.member-row-actions {
  display: flex;
  align-items: center;
  gap: 5px;
}

.btn-icon-remove {
  background: transparent;
  border: none;
  color: #ef4444;
  cursor: pointer;
  padding: 4px;
  border-radius: 6px;
  display: inline-flex;
  transition: all 0.15s ease;
}

.btn-icon-remove:hover {
  background: #fee2e2;
}

.btn-icon-role {
  background: transparent;
  border: none;
  color: #94a3b8;
  cursor: pointer;
  padding: 4px;
  border-radius: 6px;
  display: inline-flex;
  transition: all 0.15s ease;
}

.btn-icon-role:hover,
.btn-icon-role--active {
  color: #b45309;
  background: #fef3c7;
}

.toggle-option {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 12px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  cursor: pointer;
}

.toggle-option-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.toggle-option-info strong {
  font-size: 13.5px;
  color: #0f172a;
}

.toggle-option-info small {
  font-size: 12px;
  color: #64748b;
  line-height: 1.35;
}

.member-search-input {
  margin-bottom: 10px;
  font-size: 13px;
}

.selectable-user-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.15s ease;
  user-select: none;
}

.selectable-user-item:hover {
  border-color: #008069;
  background: #f0fdf4;
}

.selectable-user-item--selected {
  border-color: #008069;
  background: rgba(0, 128, 105, 0.08);
}

.user-checkbox {
  width: 16px;
  height: 16px;
  accent-color: #008069;
  cursor: pointer;
  flex-shrink: 0;
}

.selectable-user-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  overflow: hidden;
}

.user-headline {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.user-display-name {
  color: #0f172a;
  font-size: 13px;
}

.user-admin-badge {
  font-size: 10.5px;
  padding: 1px 5px;
}

/* 分组归属 Chips */
.user-groups-chips {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
  margin-top: 1px;
}

.group-tag {
  font-size: 10.5px;
  padding: 1px 6px;
  border-radius: 4px;
  line-height: 1.3;
}

.group-tag--none {
  background: #f1f5f9;
  color: #64748b;
  border: 1px dashed #cbd5e1;
}

.group-tag--assigned {
  background: #eff6ff;
  color: #1d4ed8;
  border: 1px solid #bfdbfe;
}

.add-members-footer {
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid #e2e8f0;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.selected-count-label {
  font-size: 12.5px;
  color: #64748b;
}

.selected-count-label strong {
  color: #008069;
}
</style>
