<script setup>
import { computed } from 'vue';
import { X } from '@lucide/vue';
import UiAvatar from '../ui/Avatar.vue';
import UiBadge from '../ui/Badge.vue';
import UiButton from '../ui/Button.vue';
import UiSurface from '../ui/Surface.vue';
import { formatUserPresenceStatus, isPresenceOnline } from '../../date.js';
import store from '../../store.js';

const props = defineProps({
  room: {
    type: Object,
    default: null
  },
  members: {
    type: Array,
    default: () => []
  },
  loading: {
    type: Boolean,
    default: false
  },
  canManage: {
    type: Boolean,
    default: false
  },
  inviteUserId: {
    type: String,
    default: ''
  },
  availableInviteUsers: {
    type: Array,
    default: () => []
  },
  inviteSubmitting: {
    type: Boolean,
    default: false
  }
});

const emit = defineEmits(['close', 'update:inviteUserId', 'invite', 'remove-member', 'transfer-owner', 'delete-group']);

function isMemberOnline(member) {
  const presence = store.getUserPresence(member.id);
  return isPresenceOnline(presence.lastActiveAt || member.lastActiveAt, presence.online);
}

function formatMemberPresence(member) {
  const presence = store.getUserPresence(member.id);
  const online = isMemberOnline(member);
  return formatUserPresenceStatus(presence.lastActiveAt || member.lastActiveAt, online);
}

const onlineCount = computed(() => {
  return props.members.filter((m) => isMemberOnline(m)).length;
});
</script>

<template>
  <UiSurface v-if="room && room.kind !== 'dm'" tone="soft" class="chat-member-panel">
    <div class="chat-member-panel__header">
      <div class="window-heading">
        <h1 style="font-size: 1.12rem">群组成员</h1>
        <p>{{ loading ? '同步中...' : `${members.length} 位成员 (${onlineCount} 人在线)` }}</p>
      </div>

      <div class="chat-member-panel__actions">
        <UiBadge variant="secondary">{{ room.myRole === 'owner' ? '群主' : '成员' }}</UiBadge>
        <UiButton v-if="canManage && !room.isGeneral" variant="destructive" size="sm" @click="emit('delete-group')">
          删除群组
        </UiButton>
        <button type="button" class="chat-member-panel__close" aria-label="关闭成员列表" @click="emit('close')">
          <X :size="20" aria-hidden="true" />
        </button>
      </div>
    </div>

    <div class="member-chip-list">
      <div v-if="loading && !members.length" class="member-empty-hint">
        正在加载成员...
      </div>
      <div v-else-if="!members.length" class="member-empty-hint">
        暂无群成员
      </div>
      <div v-for="member in members" :key="member.id" class="member-chip">
        <UiAvatar
          :src="member.avatarUrl"
          :fallback="member.displayName"
          size="sm"
          :show-presence="true"
          :is-online="isMemberOnline(member)"
        />
        <div class="member-chip__text">
          <div class="member-chip__name-row">
            <strong class="member-chip__display-name" :title="member.displayName">{{ member.displayName }}</strong>
            <span v-if="member.role === 'owner'" class="member-role-tag member-role-tag--owner">群主</span>
            <span v-if="member.isAdmin" class="member-role-tag member-role-tag--admin">管理员</span>
          </div>
          <span class="member-chip__sub">
            <span class="member-chip__username" :title="'@' + member.username">@{{ member.username }}</span>
            <span class="member-chip__dot-sep">·</span>
            <span
              class="member-presence-tag"
              :class="isMemberOnline(member) ? 'member-presence-tag--online' : 'member-presence-tag--offline'"
            >
              {{ formatMemberPresence(member) }}
            </span>
          </span>
        </div>
        <div v-if="canManage && !room.isGeneral && member.role !== 'owner'" class="member-chip__actions">
          <button
            type="button"
            class="member-btn member-btn--transfer"
            title="转让群主给该成员"
            aria-label="转让群主"
            @click="emit('transfer-owner', member)"
          >
            转让
          </button>
          <button
            type="button"
            class="member-btn member-btn--remove"
            title="将该成员移出群聊"
            aria-label="移出群聊"
            @click="emit('remove-member', member)"
          >
            移除
          </button>
        </div>
      </div>
    </div>

    <div v-if="canManage && !room.isGeneral" class="chat-member-panel__actions">
      <select
        class="ui-input"
        :value="inviteUserId"
        @change="emit('update:inviteUserId', $event.target.value)"
      >
        <option value="">选择要邀请的用户</option>
        <option v-for="user in availableInviteUsers" :key="`invite-${user.id}`" :value="user.id">
          {{ user.displayName }} @{{ user.username }}
        </option>
      </select>
      <UiButton :disabled="inviteSubmitting || !inviteUserId" @click="emit('invite')">
        {{ inviteSubmitting ? '邀请中...' : '邀请加入' }}
      </UiButton>
    </div>
  </UiSurface>
</template>

<style scoped>
.chat-member-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 16px;
  gap: 14px;
  box-sizing: border-box;
  background: #f8fafc;
}

.chat-member-panel__header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 8px;
  flex-shrink: 0;
}

.chat-member-panel__actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.chat-member-panel__close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: #64748b;
  cursor: pointer;
  transition: all 0.15s ease;
}

.chat-member-panel__close:hover {
  background: rgba(0, 0, 0, 0.06);
  color: #0f172a;
}

.member-chip-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: 1;
  overflow-y: auto;
  min-height: 0;
  padding-right: 2px;
}

.member-chip {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 10px;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03);
  transition: background-color 0.15s ease, border-color 0.15s ease;
}

.member-chip:hover {
  background: #f1f5f9;
  border-color: #cbd5e1;
}

.member-chip__text {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow: hidden;
}

.member-chip__name-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.member-chip__display-name {
  font-size: 13.5px;
  font-weight: 600;
  color: #0f172a;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.member-role-tag {
  display: inline-flex;
  align-items: center;
  padding: 1px 5px;
  font-size: 10.5px;
  font-weight: 700;
  border-radius: 4px;
  flex-shrink: 0;
  line-height: 1.2;
}

.member-role-tag--owner {
  background: #fef3c7;
  color: #92400e;
  border: 1px solid #fde68a;
}

.member-role-tag--admin {
  background: #e0f2fe;
  color: #0369a1;
  border: 1px solid #bae6fd;
}

.member-chip__sub {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11.5px;
  color: var(--text-muted, #64748b);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.member-chip__username {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 110px;
}

.member-chip__dot-sep {
  opacity: 0.6;
  flex-shrink: 0;
}

.member-presence-tag {
  white-space: nowrap;
  flex-shrink: 0;
}

.member-presence-tag--online {
  color: #10b981;
  font-weight: 600;
}

.member-presence-tag--offline {
  color: #94a3b8;
}

.member-chip__actions {
  display: flex;
  align-items: center;
  gap: 5px;
  flex-shrink: 0;
  margin-left: auto;
}

.member-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 3px 8px;
  font-size: 11.5px;
  font-weight: 500;
  border-radius: 6px;
  border: 1px solid transparent;
  cursor: pointer;
  transition: all 0.15s ease;
  line-height: 1.3;
  white-space: nowrap;
}

.member-btn--transfer {
  background: #fef3c7;
  color: #92400e;
  border-color: #fde68a;
}

.member-btn--transfer:hover {
  background: #fde68a;
  border-color: #f59e0b;
}

.member-btn--remove {
  background: #fee2e2;
  color: #b91c1c;
  border-color: #fecaca;
}

.member-btn--remove:hover {
  background: #fecaca;
  border-color: #ef4444;
}

.chat-member-panel__invite-footer {
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex-shrink: 0;
  padding-top: 8px;
  border-top: 1px solid #e2e8f0;
}

.invite-select {
  width: 100%;
  font-size: 13px;
  padding: 6px 10px;
  border-radius: 8px;
}

.member-empty-hint {
  padding: 24px 12px;
  text-align: center;
  color: #94a3b8;
  font-size: 13px;
}

@media (max-width: 480px) {
  .member-chip {
    padding: 7px 8px;
    gap: 8px;
  }
  .member-chip__username {
    max-width: 80px;
  }
  .member-btn {
    padding: 3px 6px;
    font-size: 11px;
  }
}
</style>
