<script setup>
import { onMounted, onUnmounted, ref } from 'vue';
import { KeyRound, MoreVertical, Shield, Trash2, UserCheck, UserX } from '@lucide/vue';
import api from '../api.js';
import { formatLocalDateTime, formatUserPresenceStatus, isPresenceOnline } from '../date.js';
import { formatShortDateTime } from '../admin/user-ban-duration.js';
import UiButton from '../components/ui/Button.vue';
import UiSurface from '../components/ui/Surface.vue';
import UserBanDialog from '../components/admin/UserBanDialog.vue';

const loading = ref(false);
const error = ref('');
const users = ref([]);
const activeMenuUserId = ref(null);

const banTargetUser = ref(null);
const banDialogVisible = ref(false);
const banDialogSaving = ref(false);
const banDialogError = ref('');

function toggleMenu(userId, event) {
  event?.stopPropagation();
  activeMenuUserId.value = activeMenuUserId.value === userId ? null : userId;
}

function closeMenu() {
  activeMenuUserId.value = null;
}

async function loadUsers() {
  loading.value = true;
  error.value = '';
  try {
    const usersPayload = await api.adminUsers();
    users.value = usersPayload.users;
  } catch (currentError) {
    error.value = currentError.message;
  } finally {
    loading.value = false;
  }
}

function openBanDialog(user) {
  closeMenu();
  banTargetUser.value = user;
  banDialogError.value = '';
  banDialogVisible.value = true;
}

function closeBanDialog() {
  banDialogVisible.value = false;
  banTargetUser.value = null;
  banDialogError.value = '';
}

async function confirmBanUser(durationMinutes) {
  if (!banTargetUser.value) return;
  banDialogSaving.value = true;
  banDialogError.value = '';
  try {
    await api.updateUser(banTargetUser.value.id, { isDisabled: true, banDurationMinutes: durationMinutes });
    closeBanDialog();
    await loadUsers();
  } catch (currentError) {
    banDialogError.value = currentError.message || '封禁用户失败';
  } finally {
    banDialogSaving.value = false;
  }
}

async function unbanUser(user) {
  closeMenu();
  error.value = '';
  try {
    await api.updateUser(user.id, { isDisabled: false });
    await loadUsers();
  } catch (currentError) {
    error.value = currentError.message || '解除封禁失败';
  }
}

async function toggleAdminRole(user) {
  closeMenu();
  const actionText = user.isAdmin ? '取消管理员权限' : '设为管理员';
  if (!window.confirm(`确认要将用户 ${user.displayName}（@${user.username}）${actionText} 吗？`)) return;
  error.value = '';
  try {
    await api.updateUser(user.id, { isAdmin: !user.isAdmin });
    await loadUsers();
  } catch (currentError) {
    error.value = currentError.message || '操作失败';
  }
}

async function resetPassword(user) {
  closeMenu();
  const password = window.prompt(`为 ${user.displayName} 设置新密码`);
  if (!password) return;
  error.value = '';
  try {
    await api.resetPassword(user.id, password);
  } catch (currentError) {
    error.value = currentError.message || '密码重置失败';
  }
}

async function removeUser(user) {
  closeMenu();
  if (!window.confirm(`确认删除用户 ${user.displayName} 吗？`)) return;
  error.value = '';
  try {
    await api.deleteUser(user.id);
    await loadUsers();
  } catch (currentError) {
    error.value = currentError.message || '删除用户失败';
  }
}

onMounted(() => {
  loadUsers();
  window.addEventListener('click', closeMenu);
});

onUnmounted(() => {
  window.removeEventListener('click', closeMenu);
});
</script>

<template>
  <div class="admin-section">
    <header class="admin-section__header">
      <div class="admin-section__heading">
        <h2>用户管理</h2>
        <p>查看现有账号，并处理管理员权限设置、账号禁用、密码重置与删除操作。</p>
      </div>
      <UiButton variant="secondary" :disabled="loading" @click="loadUsers">
        {{ loading ? '刷新中...' : '刷新用户' }}
      </UiButton>
    </header>

    <div class="admin-section__body">
      <p v-if="error" class="error-text">{{ error }}</p>

      <UiSurface class="panel panel--table">
        <h3 class="panel-title">用户列表</h3>
        <div class="admin-table-wrap">
          <table class="list-table">
            <thead>
              <tr>
                <th>用户</th>
                <th>角色</th>
                <th>所属分组</th>
                <th>账号状态</th>
                <th>在线状态</th>
                <th>注册时间</th>
                <th class="th-actions">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="loading && !users.length">
                <td colspan="7" class="muted">用户数据加载中...</td>
              </tr>
              <tr v-else-if="!users.length">
                <td colspan="7" class="muted">暂无用户</td>
              </tr>
              <tr v-for="user in users" :key="user.id">
                <td>
                  <strong>{{ user.displayName }}</strong>
                  <div class="muted">@{{ user.username }}</div>
                </td>
                <td>
                  <span v-if="user.isAdmin" class="role-badge role-badge--admin">👑 管理员</span>
                  <span v-else class="role-badge role-badge--user">普通用户</span>
                </td>
                <td>
                  <div v-if="user.groups?.length" class="user-group-tags">
                    <span v-for="g in user.groups" :key="g.id" class="user-group-badge">
                      {{ g.name }}
                    </span>
                  </div>
                  <span v-else class="muted" style="font-size: 12px;">未分组</span>
                </td>
                <td>
                  <span v-if="!user.isDisabled" class="user-status-badge user-status-badge--active">正常</span>
                  <span
                    v-else-if="user.disabledUntil"
                    class="user-status-badge user-status-badge--banned"
                    :title="`封禁至：${formatLocalDateTime(user.disabledUntil)}`"
                  >封禁至 {{ formatShortDateTime(user.disabledUntil) }}</span>
                  <span v-else class="user-status-badge user-status-badge--banned">永久封禁</span>
                </td>
                <td>
                  <span
                    class="user-presence-tag"
                    :class="isPresenceOnline(user.lastActiveAt) ? 'user-presence-tag--online' : 'user-presence-tag--offline'"
                  ><span class="presence-dot"></span>{{ formatUserPresenceStatus(user.lastActiveAt) }}</span>
                </td>
                <td>{{ formatLocalDateTime(user.createdAt) }}</td>
                <td class="td-actions">
                  <div class="action-dropdown-wrap">
                    <button
                      type="button"
                      class="action-menu-trigger"
                      title="更多操作"
                      aria-label="更多操作"
                      :aria-expanded="activeMenuUserId === user.id"
                      @click="toggleMenu(user.id, $event)"
                    ><MoreVertical :size="16" aria-hidden="true" /></button>
                    <div v-if="activeMenuUserId === user.id" class="action-menu-popover" @click.stop>
                      <button type="button" class="action-menu-btn" @click="toggleAdminRole(user)">
                        <Shield :size="14" aria-hidden="true" />
                        {{ user.isAdmin ? '取消管理员' : '设为管理员' }}
                      </button>
                      <button
                        type="button"
                        class="action-menu-btn"
                        @click="user.isDisabled ? unbanUser(user) : openBanDialog(user)"
                      >
                        <component :is="user.isDisabled ? UserCheck : UserX" :size="14" aria-hidden="true" />
                        {{ user.isDisabled ? '解除封禁' : '封禁账号' }}
                      </button>
                      <button type="button" class="action-menu-btn" @click="resetPassword(user)">
                        <KeyRound :size="14" aria-hidden="true" />
                        重置密码
                      </button>
                      <div class="action-menu-divider" role="separator" aria-orientation="horizontal"></div>
                      <button type="button" class="action-menu-btn action-menu-btn--danger" @click="removeUser(user)">
                        <Trash2 :size="14" aria-hidden="true" />
                        删除用户
                      </button>
                    </div>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </UiSurface>
    </div>

    <UserBanDialog
      :show="banDialogVisible"
      :user="banTargetUser"
      :saving="banDialogSaving"
      :error="banDialogError"
      @close="closeBanDialog"
      @confirm="confirmBanUser"
    />
  </div>
</template>

<style scoped src="../styles/admin/users.css"></style>
