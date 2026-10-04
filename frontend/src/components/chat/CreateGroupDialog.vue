<script setup>
import { ChevronDown, Folder, Globe2, LockKeyhole, Search, Users, X } from '@lucide/vue';
import { computed, ref, toRef, watch } from 'vue';
import { useOverlayLifecycle } from '../../composables/useOverlayLifecycle.js';
import UiAvatar from '../ui/Avatar.vue';
import { isPresenceOnline } from '../../date.js';
import { groupUsersByDepartment } from '../../utils/userGrouping.js';
import store from '../../store.js';

const props = defineProps({
  show: { type: Boolean, default: false },
  users: { type: Array, default: () => [] },
  form: { type: Object, required: true },
  submitting: { type: Boolean, default: false }
});

const emit = defineEmits(['close', 'toggle-member', 'submit']);
const nameInputEl = ref(null);
const searchQuery = ref('');
const collapsedGroupKeys = ref(new Set());

useOverlayLifecycle({
  open: toRef(props, 'show'),
  onClose: () => emit('close'),
  focusTarget: nameInputEl
});

watch(
  () => props.show,
  () => {
    searchQuery.value = '';
    collapsedGroupKeys.value = new Set();
  }
);

function isUserOnline(user) {
  const presence = store.getUserPresence(user.id);
  return isPresenceOnline(presence.lastActiveAt || user.lastActiveAt, presence.online);
}

const groupedUsers = computed(() => {
  return groupUsersByDepartment(props.users, searchQuery.value);
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

function expandAll() {
  collapsedGroupKeys.value = new Set();
}

function collapseAll() {
  collapsedGroupKeys.value = new Set(groupedUsers.value.map((g) => g.id));
}

function getGroupSelectedCount(group) {
  const selectedSet = new Set(props.form.memberUserIds || []);
  return group.users.filter((u) => selectedSet.has(u.id)).length;
}

function isGroupAllSelected(group) {
  if (!group.users.length) return false;
  const selectedSet = new Set(props.form.memberUserIds || []);
  return group.users.every((u) => selectedSet.has(u.id));
}

function toggleSelectEntireGroup(group, event) {
  event?.stopPropagation();
  const selectedSet = new Set(props.form.memberUserIds || []);
  const allSelected = group.users.every((u) => selectedSet.has(u.id));

  if (allSelected) {
    // 取消选中该组全部成员
    for (const u of group.users) {
      if (selectedSet.has(u.id)) {
        emit('toggle-member', u.id);
      }
    }
  } else {
    // 选中该组尚未选中的成员
    for (const u of group.users) {
      if (!selectedSet.has(u.id)) {
        emit('toggle-member', u.id);
      }
    }
  }
}
</script>

<template>
  <Transition name="modal-fade">
    <div v-if="show" class="room-dialog-overlay" @click.self="emit('close')">
      <section class="room-dialog" role="dialog" aria-modal="true" aria-labelledby="create-group-title">
        <h2 id="create-group-title">创建群聊</h2>
        <label class="room-dialog__field">
          <span>群聊名称</span>
          <input ref="nameInputEl" v-model="form.name" type="text" class="room-dialog__input" autocomplete="off" />
        </label>

		<div class="room-dialog__type-field">
		  <span>群组类型</span>
		  <div class="room-dialog__type-switch" role="radiogroup" aria-label="群组类型">
			<label
			  :class="{ 'room-dialog__type-option--active': form.kind === 'public' }"
			  class="room-dialog__type-option"
			>
			  <input v-model="form.kind" type="radio" name="group-kind" value="public" />
			  <Globe2 :size="17" aria-hidden="true" />
			  <span>公开群组</span>
			</label>
			<label
			  :class="{ 'room-dialog__type-option--active': form.kind === 'private' }"
			  class="room-dialog__type-option"
			>
			  <input v-model="form.kind" type="radio" name="group-kind" value="private" />
			  <LockKeyhole :size="17" aria-hidden="true" />
			  <span>私有群组</span>
			</label>
		  </div>
		</div>

        <div class="room-dialog__members">
		  <label>{{ form.kind === 'public' ? '邀请成员（可选）' : '选择成员' }}</label>

          <!-- 搜索过滤 -->
          <div class="member-search-box">
            <Search :size="15" class="member-search-icon" />
            <input
              v-model="searchQuery"
              type="search"
              class="member-search-input"
              placeholder="搜索成员姓名、用户名或部门分组..."
            />
            <button
              v-if="searchQuery"
              type="button"
              class="member-search-clear"
              title="清空搜索"
              @click="searchQuery = ''"
            >
              <X :size="14" />
            </button>
          </div>

          <!-- 选择统计与折叠操作条 -->
          <div class="member-tools-bar">
            <span class="member-selected-summary">
              已选择 <strong>{{ form.memberUserIds.length }}</strong> 位成员
            </span>
            <div class="member-accordion-actions">
              <button type="button" class="btn-text-action" @click="expandAll">全部展开</button>
              <span class="action-divider">|</span>
              <button type="button" class="btn-text-action" @click="collapseAll">全部折叠</button>
            </div>
          </div>

          <!-- 分组折叠人员选择列表 -->
          <div class="room-dialog__member-list">
            <div v-if="!groupedUsers.length" class="member-empty-hint">
              没有找到匹配的成员
            </div>

            <div
              v-for="group in groupedUsers"
              :key="group.id"
              class="member-group-accordion"
            >
              <!-- 分组标题栏 -->
              <div
                class="member-group-header"
                :class="{ 'member-group-header--collapsed': !isGroupExpanded(group.id) }"
                @click="toggleGroup(group.id)"
              >
                <div class="member-group-header__left">
                  <ChevronDown
                    :size="16"
                    class="group-chevron"
                    :class="{ 'group-chevron--collapsed': !isGroupExpanded(group.id) }"
                  />
                  <Folder v-if="group.groupId" :size="15" class="group-folder-icon" />
                  <Users v-else :size="15" class="group-folder-icon" />
                  <strong class="group-name-text">{{ group.name }}</strong>
                  <span class="group-selected-badge" :class="{ 'group-selected-badge--active': getGroupSelectedCount(group) > 0 }">
                    {{ getGroupSelectedCount(group) }}/{{ group.users.length }} 已选
                  </span>
                </div>

                <div class="member-group-header__right">
                  <button
                    type="button"
                    class="btn-group-select-all"
                    @click="toggleSelectEntireGroup(group, $event)"
                  >
                    {{ isGroupAllSelected(group) ? '取消全选' : '本组全选' }}
                  </button>
                </div>
              </div>

              <!-- 分组内成员卡片列表 -->
              <div v-show="isGroupExpanded(group.id)" class="member-group-body">
                <button
                  v-for="user in group.users"
                  :key="`create-${group.id}-${user.id}`"
                  type="button"
                  class="room-dialog__member"
                  :class="{ 'room-dialog__member--selected': form.memberUserIds.includes(user.id) }"
                  @click="emit('toggle-member', user.id)"
                >
                  <input
                    type="checkbox"
                    :checked="form.memberUserIds.includes(user.id)"
                    class="member-checkbox"
                    @click.stop="emit('toggle-member', user.id)"
                  />
                  <UiAvatar
                    :src="user.avatarUrl"
                    :fallback="user.displayName?.[0] || '?'"
                    size="sm"
                    :show-presence="true"
                    :is-online="isUserOnline(user)"
                  />
                  <div class="member-item-info">
                    <div class="member-item-name-row">
                      <strong>{{ user.displayName }}</strong>
                      <span v-if="user.groups?.some(ug => ug.id === group.groupId && ug.isLeader)" class="leader-tag">
                        组长
                      </span>
                    </div>
                    <small>@{{ user.username }}</small>
                  </div>
                </button>
              </div>
            </div>
          </div>
        </div>

        <div class="room-dialog__actions">
          <button type="button" class="room-dialog__secondary" @click="emit('close')">取消</button>
          <button
            type="button"
            class="room-dialog__primary"
            :disabled="!form.name.trim() || submitting"
            @click="emit('submit')"
          >
            {{ submitting ? '创建中...' : '创建' }}
          </button>
        </div>
      </section>
    </div>
  </Transition>
</template>

<style scoped>
.room-dialog-overlay {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  padding:
    max(16px, env(safe-area-inset-top))
    max(16px, env(safe-area-inset-right))
    max(16px, env(safe-area-inset-bottom))
    max(16px, env(safe-area-inset-left));
  background: rgba(0, 0, 0, 0.4);
}

.room-dialog {
  width: min(480px, 100%);
  height: min(660px, calc(100dvh - 32px));
  max-height: calc(100dvh - 32px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 22px 24px 20px;
  border-radius: 16px;
  background: #fff;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.15);
}

.room-dialog h2 { margin: 0 0 16px; font-size: 18px; color: #111b21; flex: 0 0 auto; }
.room-dialog__field { display: grid; gap: 8px; color: #6b7c93; font-size: 13px; flex: 0 0 auto; }
.room-dialog__input { width: 100%; min-height: 44px; padding: 10px 14px; border: 1px solid #e8ecf0; border-radius: 8px; background: #f9fafb; font-size: 16px; }
.room-dialog__type-field { display: grid; gap: 8px; margin-top: 14px; color: #6b7c93; font-size: 13px; flex: 0 0 auto; }
.room-dialog__type-switch { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 4px; padding: 4px; border: 1px solid #e1e7ea; border-radius: 8px; background: #f5f7f8; }
.room-dialog__type-option { display: inline-flex; align-items: center; justify-content: center; gap: 7px; min-width: 0; min-height: 40px; padding: 8px 10px; border: 0; border-radius: 6px; background: transparent; color: #667781; font-size: 13px; cursor: pointer; }
.room-dialog__type-option input { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); clip-path: inset(50%); white-space: nowrap; }
.room-dialog__type-option:focus-within { outline: 3px solid rgba(0, 128, 105, 0.24); outline-offset: 2px; }
.room-dialog__type-option--active { background: #ffffff; color: #008069; box-shadow: 0 1px 3px rgba(11, 20, 26, 0.12); }
.room-dialog__members {
  margin-top: 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
.room-dialog__members > label { display: block; font-size: 13px; color: #6b7c93; font-weight: 600; flex: 0 0 auto; }

/* 搜索框 */
.member-search-box {
  position: relative;
  display: flex;
  align-items: center;
  width: 100%;
  flex: 0 0 auto;
}

.member-search-icon {
  position: absolute;
  left: 10px;
  color: #94a3b8;
  pointer-events: none;
}

.member-search-input {
  width: 100%;
  min-height: 36px;
  padding: 8px 32px 8px 32px !important;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  font-size: 13px;
  background: #f8fafc;
  color: #0f172a;
  outline: none;
  transition: border-color 0.2s, background-color 0.2s;
}

.member-search-input:focus {
  background: #ffffff;
  border-color: #008069;
  box-shadow: 0 0 0 2px rgba(0, 128, 105, 0.12);
}

.member-search-clear {
  position: absolute;
  right: 8px;
  background: transparent;
  border: none;
  color: #94a3b8;
  cursor: pointer;
  padding: 2px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
}

.member-search-clear:hover {
  color: #0f172a;
}

/* 工具条 */
.member-tools-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 2px 2px;
  font-size: 12px;
  flex: 0 0 auto;
}

.member-selected-summary {
  color: #64748b;
}

.member-selected-summary strong {
  color: #008069;
}

.member-accordion-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.btn-text-action {
  background: transparent;
  border: none;
  color: #008069;
  font-size: 12px;
  cursor: pointer;
  padding: 2px 4px;
  border-radius: 4px;
  font-weight: 500;
}

.btn-text-action:hover {
  background: rgba(0, 128, 105, 0.08);
}

.action-divider {
  color: #cbd5e1;
  font-size: 11px;
}

/* 分组折叠选择容器 */
.room-dialog__member-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: 1;
  min-height: 0;
  overflow-y: auto !important;
  overflow-x: hidden;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior: contain;
  padding-right: 6px;
  scrollbar-width: thin;
  scrollbar-color: #94a3b8 #f1f5f9;
}

.room-dialog__member-list::-webkit-scrollbar {
  width: 8px;
}

.room-dialog__member-list::-webkit-scrollbar-track {
  background: #f1f5f9;
  border-radius: 4px;
}

.room-dialog__member-list::-webkit-scrollbar-thumb {
  background: #94a3b8;
  border-radius: 4px;
}

.room-dialog__member-list::-webkit-scrollbar-thumb:hover {
  background: #008069;
}

.member-group-accordion {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  background: #ffffff;
  overflow: hidden;
}

.member-group-header {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  background: #edf4f2;
  border-bottom: 1px solid #d8e8e4;
  cursor: pointer;
  transition: background-color 0.15s ease;
}

.member-group-header:hover {
  background: #e2edea;
}

.member-group-header__left {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  flex: 1;
}

.group-chevron {
  color: #64748b;
  transition: transform 0.2s ease;
  flex-shrink: 0;
}

.group-chevron--collapsed {
  transform: rotate(-90deg);
}

.group-folder-icon {
  color: #008069;
  flex-shrink: 0;
}

.group-name-text {
  font-size: 13px;
  color: #0f172a;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.group-selected-badge {
  font-size: 11px;
  color: #64748b;
  background: rgba(0, 0, 0, 0.05);
  padding: 1px 6px;
  border-radius: 4px;
  flex-shrink: 0;
}

.group-selected-badge--active {
  background: #dcfce7;
  color: #15803d;
  font-weight: 600;
}

.btn-group-select-all {
  background: transparent;
  border: 1px solid #cbd5e1;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 11.5px;
  color: #0f172a;
  cursor: pointer;
  transition: all 0.15s ease;
  white-space: nowrap;
}

.btn-group-select-all:hover {
  border-color: #008069;
  color: #008069;
  background: #f0fdf4;
}

.member-group-body {
  flex-shrink: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 6px;
  padding: 8px 10px 8px 20px;
  background: #ffffff;
}

.room-dialog__member {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border: 1px solid #e8ecf0;
  border-radius: 8px;
  background: #fafafa;
  cursor: pointer;
  touch-action: manipulation;
  transition: all 0.15s ease;
  text-align: left;
}

.room-dialog__member:hover {
  background: #f0fdf4;
  border-color: #86efac;
}

.room-dialog__member--selected {
  border-color: #008069;
  background: #f0fdf4;
}

.member-checkbox {
  width: 15px;
  height: 15px;
  accent-color: #008069;
  cursor: pointer;
  flex-shrink: 0;
}

.member-item-info {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
  overflow: hidden;
}

.member-item-name-row {
  display: flex;
  align-items: center;
  gap: 4px;
}

.member-item-info strong {
  font-size: 12.5px;
  color: #0f172a;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.member-item-info small {
  font-size: 11px;
  color: #64748b;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.leader-tag {
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

.member-empty-hint {
  flex-shrink: 0;
  text-align: center;
  padding: 20px 0;
  color: #94a3b8;
  font-size: 12.5px;
}
.room-dialog__actions { display: flex; justify-content: flex-end; gap: 12px; margin-top: 16px; flex: 0 0 auto; }
.room-dialog__secondary, .room-dialog__primary { min-height: 44px; padding: 10px 20px; border-radius: 8px; cursor: pointer; touch-action: manipulation; }
.room-dialog__secondary { border: 1px solid #e8ecf0; background: #fff; }
.room-dialog__primary { border: 0; background: #008069; color: #fff; }
.room-dialog__primary:disabled { cursor: not-allowed; opacity: 0.55; }
.room-dialog button:focus-visible { outline: 3px solid rgba(0, 128, 105, 0.24); outline-offset: 2px; }
.modal-fade-enter-active { transition: opacity 200ms; }
.modal-fade-leave-active { transition: opacity 150ms; }
.modal-fade-enter-from, .modal-fade-leave-to { opacity: 0; }

@media (max-width: 480px) {
  .room-dialog-overlay {
    align-items: flex-end;
    padding: env(safe-area-inset-top) 0 0;
  }

  .room-dialog {
    width: 100%;
    height: calc(100dvh - env(safe-area-inset-top));
    padding: 20px 16px max(16px, env(safe-area-inset-bottom));
    border-radius: 16px 16px 0 0;
  }

  .room-dialog__actions {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  }
}
</style>
