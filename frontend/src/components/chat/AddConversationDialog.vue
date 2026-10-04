<script setup>
import { computed, ref, toRef, watch } from 'vue';
import { ChevronDown, Folder, Search, Users, X } from '@lucide/vue';
import { useOverlayLifecycle } from '../../composables/useOverlayLifecycle.js';
import UiAvatar from '../ui/Avatar.vue';
import { formatUserPresenceStatus, isPresenceOnline } from '../../date.js';
import { groupUsersByDepartment } from '../../utils/userGrouping.js';
import store from '../../store.js';

const props = defineProps({
  show: { type: Boolean, default: false },
  users: { type: Array, default: () => [] },
  openingDmUserId: { type: Number, default: null },
  error: { type: String, default: '' }
});

const emit = defineEmits(['close', 'create-group', 'open-dm']);
const step = ref('choose');
const firstActionEl = ref(null);
const searchQuery = ref('');
const collapsedGroupKeys = ref(new Set());

useOverlayLifecycle({
  open: toRef(props, 'show'),
  onClose: () => emit('close'),
  focusTarget: firstActionEl
});

watch(
  () => props.show,
  () => {
    step.value = 'choose';
    searchQuery.value = '';
    collapsedGroupKeys.value = new Set();
  }
);

function isUserOnline(user) {
  const presence = store.getUserPresence(user.id);
  return isPresenceOnline(presence.lastActiveAt || user.lastActiveAt, presence.online);
}

function formatPresence(user) {
  const presence = store.getUserPresence(user.id);
  const online = isUserOnline(user);
  return formatUserPresenceStatus(presence.lastActiveAt || user.lastActiveAt, online);
}

const groupedUsers = computed(() => {
  return groupUsersByDepartment(props.users, searchQuery.value);
});

const totalMatchedUsers = computed(() => {
  return groupedUsers.value.reduce((sum, g) => sum + g.users.length, 0);
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

function getGroupOnlineCount(group) {
  return group.users.filter((u) => isUserOnline(u)).length;
}
</script>

<template>
  <Transition name="add-conversation-fade">
    <div
      v-if="show"
      class="add-conversation-overlay"
      @click.self="emit('close')"
    >
      <section
        class="add-conversation-dialog"
        :class="{ 'add-conversation-dialog--dm': step === 'dm' }"
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-conversation-title"
      >
        <header class="add-conversation-dialog__header">
          <div>
            <h2 id="add-conversation-title">添加人员</h2>
            <p>{{ step === 'dm' ? '选择一位尚未聊天的联系人' : '选择要创建的会话类型' }}</p>
          </div>
          <button type="button" class="add-conversation-dialog__close" aria-label="关闭" @click="emit('close')">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
              <title>关闭</title>
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </header>

        <div v-if="step === 'choose'" class="add-conversation-dialog__choices">
          <button ref="firstActionEl" type="button" class="add-conversation-choice" @click="step = 'dm'">
            <span class="add-conversation-choice__icon">
              <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8">
                <title>发起新对话</title>
                <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" />
              </svg>
            </span>
            <span>
              <strong>发起新对话</strong>
              <small>与尚未聊天的用户开始私聊</small>
            </span>
            <svg class="add-conversation-choice__arrow" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
              <title>进入联系人选择</title>
              <path d="m9 18 6-6-6-6" />
            </svg>
          </button>

          <button type="button" class="add-conversation-choice" @click="emit('create-group')">
            <span class="add-conversation-choice__icon">
              <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8">
                <title>创建群聊</title>
                <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="8.5" cy="7" r="4" />
                <path d="M20 8v6M23 11h-6" />
              </svg>
            </span>
            <span>
              <strong>创建群聊</strong>
              <small>选择多位成员开始群组会话</small>
            </span>
            <svg class="add-conversation-choice__arrow" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
              <title>进入群聊创建</title>
              <path d="m9 18 6-6-6-6" />
            </svg>
          </button>
        </div>

        <div v-else class="add-conversation-dialog__people">
          <button type="button" class="add-conversation-dialog__back" @click="step = 'choose'">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
              <title>返回</title>
              <path d="m15 18-6-6 6-6" />
            </svg>
            返回
          </button>

          <p v-if="error" class="add-conversation-dialog__error" role="alert">{{ error }}</p>
          <p v-if="!users.length" class="add-conversation-dialog__empty">
            所有站内用户都已经有私聊会话了。
          </p>

          <div v-else class="add-conversation-dialog__content">
            <div class="add-conversation-scope-hint">💡 仅展示允许私聊的同组成员、组长与管理员</div>

            <!-- 搜索框 -->
            <div class="contact-search-box">
              <Search :size="15" class="contact-search-icon" />
              <input
                v-model="searchQuery"
                type="search"
                class="contact-search-input"
                placeholder="搜索姓名、用户名或部门分组..."
              />
              <button
                v-if="searchQuery"
                type="button"
                class="contact-search-clear"
                title="清空搜索"
                @click="searchQuery = ''"
              >
                <X :size="14" />
              </button>
            </div>

            <!-- 工具栏：分组折叠展开控制 -->
            <div v-if="groupedUsers.length > 0" class="contact-tools-bar">
              <span class="contact-count-label">
                共 <strong>{{ totalMatchedUsers }}</strong> 位联系人 · <strong>{{ groupedUsers.length }}</strong> 个分组
              </span>
              <div class="contact-accordion-actions">
                <button type="button" class="btn-text-action" @click="expandAll">全部展开</button>
                <span class="action-divider">|</span>
                <button type="button" class="btn-text-action" @click="collapseAll">全部折叠</button>
              </div>
            </div>

            <!-- 分组折叠列表 -->
            <div class="add-conversation-dialog__list">
              <div v-if="!groupedUsers.length" class="add-conversation-dialog__empty">
                没有找到匹配的联系人
              </div>

              <div
                v-for="group in groupedUsers"
                :key="group.id"
                class="contact-group-accordion"
              >
                <!-- 分组头部折叠/展开栏 -->
                <button
                  type="button"
                  class="contact-group-header"
                  :aria-expanded="isGroupExpanded(group.id)"
                  @click="toggleGroup(group.id)"
                >
                  <div class="contact-group-header__left">
                    <ChevronDown
                      :size="16"
                      class="group-chevron"
                      :class="{ 'group-chevron--collapsed': !isGroupExpanded(group.id) }"
                    />
                    <Folder v-if="group.groupId" :size="15" class="group-folder-icon" />
                    <Users v-else :size="15" class="group-folder-icon" />
                    <strong class="group-name-text">{{ group.name }}</strong>
                    <span class="group-count-tag">{{ group.users.length }} 人</span>
                    <span v-if="getGroupOnlineCount(group) > 0" class="group-online-tag">
                      {{ getGroupOnlineCount(group) }} 在线
                    </span>
                  </div>
                  <span class="contact-group-header__hint">
                    {{ isGroupExpanded(group.id) ? '折叠' : '展开' }}
                  </span>
                </button>

                <!-- 分组内成员列表 -->
                <div v-show="isGroupExpanded(group.id)" class="contact-group-body">
                  <button
                    v-for="user in group.users"
                    :key="`${group.id}-${user.id}`"
                    type="button"
                    class="add-conversation-person"
                    :disabled="openingDmUserId !== null"
                    @click="emit('open-dm', user)"
                  >
                    <UiAvatar
                      :src="user.avatarUrl"
                      :fallback="user.displayName?.[0] || '?'"
                      size="sm"
                      :show-presence="true"
                      :is-online="isUserOnline(user)"
                    />
                    <span class="add-conversation-person__identity">
                      <span class="add-conversation-person__title-row">
                        <strong>{{ user.displayName }}</strong>
                        <span v-if="user.groups?.some(ug => ug.id === group.groupId && ug.isLeader)" class="leader-badge">
                          组长
                        </span>
                      </span>
                      <small>
                        @{{ user.username }} ·
                        <span :class="isUserOnline(user) ? 'presence-text--online' : 'presence-text--offline'">
                          {{ formatPresence(user) }}
                        </span>
                      </small>
                    </span>
                    <span class="add-conversation-person__status" aria-live="polite">
                      {{ openingDmUserId === Number(user.id) ? '正在打开...' : '发消息' }}
                    </span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  </Transition>
</template>

<style scoped>
.add-conversation-overlay {
  position: fixed;
  inset: 0;
  z-index: 110;
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

.add-conversation-dialog {
  width: min(480px, 100%);
  max-height: min(720px, calc(100dvh - 32px));
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-radius: 16px;
  background: #fff;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.15);
}

.add-conversation-dialog--dm {
  height: min(680px, calc(100dvh - 32px));
  max-height: calc(100dvh - 32px);
}

.add-conversation-dialog__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 20px 24px 12px;
  flex: 0 0 auto;
}

.add-conversation-dialog__header h2 {
  margin: 0;
  color: #111b21;
  font-size: 18px;
}

.add-conversation-dialog__header p {
  margin: 6px 0 0;
  color: #667781;
  font-size: 13px;
}

.add-conversation-dialog__close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 44px;
  width: 44px;
  height: 44px;
  margin: -10px -10px 0 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: #54656f;
  cursor: pointer;
  transition: background 150ms, color 150ms;
}

.add-conversation-dialog__close:hover {
  background: #f0f2f5;
  color: #111b21;
}

.add-conversation-dialog__choices {
  display: grid; 
  gap: 12px;
  padding: 8px 24px 24px;
}

.add-conversation-dialog__people {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden; 
  padding: 4px 20px 20px;
  gap: 8px;
}

.add-conversation-choice,
.add-conversation-person {
  width: 100%;
  min-height: 64px;
  border: 1px solid #e8ecf0;
  border-radius: 12px;
  background: #fff;
  color: #111b21;
  cursor: pointer;
  transition: background 150ms, border-color 150ms, box-shadow 150ms;
}

.add-conversation-choice {
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr) 20px;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  text-align: left;
}

.add-conversation-choice:hover,
.add-conversation-person:hover:not(:disabled) {
  border-color: #b7d8d2;
  background: #f5fbf9;
  box-shadow: 0 4px 14px rgba(0, 128, 105, 0.08);
}

.add-conversation-choice__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: #e7f4f1;
  color: #008069;
}

.add-conversation-choice span:nth-child(2) {
  display: grid;
  gap: 4px;
}

.add-conversation-choice strong,
.add-conversation-person strong {
  font-size: 14px;
  font-weight: 600;
}

.add-conversation-choice small,
.add-conversation-person small {
  color: #667781;
  font-size: 12px;
}

.add-conversation-choice__arrow {
  color: #8696a0;
}

.add-conversation-dialog__back {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  width: fit-content;
  min-height: 44px;
  padding: 0 10px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: #008069;
  cursor: pointer;
}

.add-conversation-dialog__back:hover {
  background: #f0f2f5;
}

.add-conversation-dialog__back {
  flex: 0 0 auto;
}

.add-conversation-scope-hint {
  flex: 0 0 auto;
}

.add-conversation-dialog__list {
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

.add-conversation-dialog__list::-webkit-scrollbar {
  width: 8px;
}

.add-conversation-dialog__list::-webkit-scrollbar-track {
  background: #f1f5f9;
  border-radius: 4px;
}

.add-conversation-dialog__list::-webkit-scrollbar-thumb {
  background: #94a3b8;
  border-radius: 4px;
}

.add-conversation-dialog__list::-webkit-scrollbar-thumb:hover {
  background: #008069;
}

.add-conversation-dialog__content {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden; 
  gap: 8px;
}

/* 搜索栏样式 */
.contact-search-box {
  position: relative;
  display: flex;
  align-items: center;
  width: 100%;
  flex: 0 0 auto;
}

.contact-search-icon {
  position: absolute;
  left: 10px;
  color: #94a3b8;
  pointer-events: none;
}

.contact-search-input {
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

.contact-search-input:focus {
  background: #ffffff;
  border-color: #008069;
  box-shadow: 0 0 0 2px rgba(0, 128, 105, 0.12);
}

.contact-search-clear {
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

.contact-search-clear:hover {
  color: #0f172a;
}

/* 工具条 */
.contact-tools-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 2px 2px;
  font-size: 12px;
  flex: 0 0 auto;
}

.contact-count-label {
  color: #64748b;
}

.contact-count-label strong {
  color: #0f172a;
}

.contact-accordion-actions {
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

/* 分组手风琴 */
.contact-group-accordion {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  background: #ffffff;
  overflow: hidden;
  margin-bottom: 4px;
}

.contact-group-header {
  flex-shrink: 0;
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  background: #edf4f2;
  border: none;
  border-bottom: 1px solid #d8e8e4;
  cursor: pointer;
  transition: background-color 0.15s ease;
  text-align: left;
}

.contact-group-header:hover {
  background: #e2edea;
}

.contact-group-header__left {
  display: flex;
  align-items: center;
  gap: 8px;
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
  font-size: 13.5px;
  color: #0f172a;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.group-count-tag {
  font-size: 11.5px;
  color: #64748b;
  background: rgba(0, 0, 0, 0.05);
  padding: 1px 6px;
  border-radius: 4px;
  flex-shrink: 0;
}

.group-online-tag {
  font-size: 11px;
  color: #059669;
  background: rgba(16, 185, 129, 0.12);
  padding: 1px 6px;
  border-radius: 4px;
  font-weight: 600;
  flex-shrink: 0;
}

.contact-group-header__hint {
  font-size: 11.5px;
  color: #94a3b8;
  margin-left: 8px;
  flex-shrink: 0;
}

.contact-group-body {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  gap: 6px;
  padding: 8px 10px 8px 20px;
  background: #ffffff;
}

.add-conversation-person {
  flex-shrink: 0;
  display: grid;
  grid-template-columns: 36px minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  padding: 8px 10px;
  text-align: left;
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;
  border: 1px solid #f1f5f9;
  border-radius: 8px;
  background: #fafafa;
  min-height: 52px;
}

.add-conversation-person:hover:not(:disabled) {
  background: #f0fdf4;
  border-color: #86efac;
}

.add-conversation-person:disabled {
  cursor: wait;
  opacity: 0.58;
}

.add-conversation-person__identity {
  display: grid;
  gap: 3px;
  min-width: 0;
}

.add-conversation-person__title-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.leader-badge {
  font-size: 10.5px;
  font-weight: 700;
  color: #b45309;
  background: #fef3c7;
  border: 1px solid #fde68a;
  padding: 0 4px;
  border-radius: 4px;
  line-height: 1.3;
}

.add-conversation-person__identity strong,
.add-conversation-person__identity small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.add-conversation-person__status {
  color: #008069;
  font-size: 12px;
  font-weight: 600;
}

.add-conversation-dialog__empty,
.add-conversation-dialog__error {
  flex-shrink: 0;
  margin: 0;
  padding: 14px 16px;
  border-radius: 10px;
  font-size: 13px;
}

.add-conversation-dialog__empty {
  background: #f5f7fa;
  color: #667781;
}

.add-conversation-scope-hint {
  font-size: 12px;
  color: #64748b;
  background: #f8fafc;
  padding: 6px 10px;
  border-radius: 6px;
  border: 1px solid #e2e8f0;
  margin-bottom: 4px;
}

.add-conversation-dialog__error {
  background: #fef2f2;
  color: #b91c1c;
}

.add-conversation-dialog button:focus-visible {
  outline: 3px solid rgba(0, 128, 105, 0.24);
  outline-offset: 2px;
}

.add-conversation-fade-enter-active {
  transition: opacity 200ms ease-out;
}

.add-conversation-fade-leave-active {
  transition: opacity 150ms ease-in;
}

.add-conversation-fade-enter-from,
.add-conversation-fade-leave-to {
  opacity: 0;
}

.presence-text--online {
  color: #10b981;
  font-weight: 600;
}

.presence-text--offline {
  color: var(--text-muted, #64748b);
}

@media (max-width: 480px) {
  .add-conversation-overlay {
    align-items: flex-end;
    padding: 0;
  }

  .add-conversation-dialog {
    width: 100%;
    max-height: calc(100dvh - env(safe-area-inset-top));
    height: calc(100dvh - env(safe-area-inset-top));
    border-radius: 16px 16px 0 0;
  }

  .add-conversation-dialog__header,
  .add-conversation-dialog__choices,
  .add-conversation-dialog__people {
    padding-left: 16px;
    padding-right: 16px;
  }

  .add-conversation-dialog__people {
    min-height: 0;
  }

  .add-conversation-dialog__list {
    flex: 1;
    min-height: 0;
    max-height: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .add-conversation-fade-enter-active,
  .add-conversation-fade-leave-active {
    transition: none;
  }
}
</style>
