<script setup>
import { Megaphone, Phone, PhoneOff, UsersRound, Volume2 } from '@lucide/vue';

const props = defineProps({
  isConnected: { type: Boolean, default: false },
  participantsCount: { type: Number, default: 1 },
  formattedDuration: { type: String, default: '00:00' },
  notifyGroupCooldown: { type: Boolean, default: false },
  notifyGroupSuccess: { type: Boolean, default: false }
});

const emit = defineEmits(['join', 'leave', 'notify-group']);
</script>

<template>
  <div class="group-audio-bar" role="region" aria-label="语音会议">
    <div class="group-audio-bar__left">
      <div class="group-audio-pulse-icon">
        <Volume2 :size="16" />
      </div>
      <div class="group-audio-info">
        <strong class="group-audio-title">群聊语音会议进行中</strong>
        <span class="group-audio-meta">
          <UsersRound :size="12" />
          <span>{{ participantsCount }} 人在线</span>
          <span v-if="isConnected" class="group-audio-timer">· {{ formattedDuration }}</span>
        </span>
      </div>
    </div>

    <div class="group-audio-bar__right">
      <button
        v-if="isConnected"
        type="button"
        class="group-audio-btn group-audio-btn--notify"
        :disabled="notifyGroupCooldown"
        :title="notifyGroupCooldown ? '已发送群通知（冷却中）' : '发送群聊消息，提醒群成员加入会议'"
        @click="emit('notify-group')"
      >
        <Megaphone :size="13" />
        <span>{{ notifyGroupSuccess ? '已通知！' : (notifyGroupCooldown ? '已通知' : '通知群成员') }}</span>
      </button>

      <button
        v-if="!isConnected"
        type="button"
        class="group-audio-btn group-audio-btn--join"
        @click="emit('join')"
      >
        <Phone :size="14" />
        <span>加入会议</span>
      </button>

      <button
        v-else
        type="button"
        class="group-audio-btn group-audio-btn--leave"
        @click="emit('leave')"
      >
        <PhoneOff :size="14" />
        <span>退出会议</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.group-audio-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 16px;
  background: linear-gradient(90deg, #065f46 0%, #047857 100%);
  color: #ffffff;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
  z-index: 10;
  user-select: none;
}

.group-audio-bar__left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.group-audio-pulse-icon {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.2);
  display: flex;
  align-items: center;
  justify-content: center;
  animation: pulseIcon 1.6s infinite ease-in-out;
}

.group-audio-info {
  display: flex;
  flex-direction: column;
}

.group-audio-title {
  font-size: 13px;
  font-weight: 600;
}

.group-audio-meta {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11.5px;
  color: #a7f3d0;
}

.group-audio-timer {
  font-family: monospace;
  font-weight: 600;
  color: #ffffff;
}

.group-audio-bar__right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.group-audio-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 12px;
  border-radius: 14px;
  border: none;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
}

.group-audio-btn--notify {
  background: rgba(255, 255, 255, 0.2);
  color: #ffffff;
  border: 1px solid rgba(255, 255, 255, 0.35);
}

.group-audio-btn--notify:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.32);
  transform: scale(1.03);
}

.group-audio-btn--notify:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.group-audio-btn--join {
  background: #ffffff;
  color: #065f46;
}

.group-audio-btn--join:hover {
  background: #f0fdf4;
  transform: scale(1.03);
}

.group-audio-btn--leave {
  background: #ef4444;
  color: #ffffff;
}

.group-audio-btn--leave:hover {
  background: #dc2626;
  transform: scale(1.03);
}

@keyframes pulseIcon {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.18); opacity: 0.7; }
}
</style>
