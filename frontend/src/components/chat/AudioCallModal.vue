<script setup>
import { computed, ref } from 'vue';
import { Check, Crown, Hand, Headphones, Megaphone, Mic, MicOff, Minimize2, Maximize2, Phone, PhoneOff, Shield, UsersRound, UserX, Volume2, VolumeX, Wand2, X } from '@lucide/vue';
import UiAvatar from '../ui/Avatar.vue';

const props = defineProps({
  callStatus: { type: String, required: true }, // 'idle' | 'calling' | 'ringing' | 'connected' | 'ended'
  callType: { type: String, default: 'dm' }, // 'dm' | 'group'
  targetUser: { type: Object, default: null },
  currentRoom: { type: Object, default: null },
  isMuted: { type: Boolean, default: false },
  isMinimized: { type: Boolean, default: false },
  isLocalSpeaking: { type: Boolean, default: false },
  isRemoteSpeaking: { type: Boolean, default: false },
  isHandRaised: { type: Boolean, default: false },
  canManage: { type: Boolean, default: false },
  isOwner: { type: Boolean, default: false },
  currentVoiceEffect: { type: String, default: 'original' },
  availableVoiceEffects: { type: Array, default: () => [] },
  formattedDuration: { type: String, default: '00:00' },
  groupParticipants: { type: Array, default: () => [] },
  errorMessage: { type: String, default: '' },
  notifyGroupCooldown: { type: Boolean, default: false },
  notifyGroupSuccess: { type: Boolean, default: false }
});

const emit = defineEmits([
  'accept',
  'reject',
  'end',
  'toggle-mute',
  'toggle-minimize',
  'leave-group',
  'notify-group',
  'set-voice-effect',
  'raise-hand',
  'lower-hand',
  'toggle-hand',
  'mute-participant',
  'mute-all',
  'kick-participant',
  'approve-hand',
  'reject-hand'
]);

const showVoiceMenu = ref(false);

const activeEffect = computed(() => {
  return props.availableVoiceEffects.find((e) => e.id === props.currentVoiceEffect) || { id: 'original', name: '原声', icon: '🎙️' };
});

const myRole = computed(() => {
  if (props.isOwner) return 'owner';
  if (props.canManage) return 'admin';
  return 'member';
});
</script>

<template>
  <!-- 1. Minimized Floating Widget -->
  <Transition name="mini-fade">
    <div
      v-if="isMinimized && ['calling', 'connected'].includes(callStatus)"
      class="audio-call-minimized"
      role="region"
      aria-label="通话悬浮窗"
      @click="emit('toggle-minimize')"
    >
      <div
        class="mini-pulse-dot"
        :class="{
          'mini-pulse-dot--calling': callStatus === 'calling',
          'mini-pulse-dot--speaking': (isLocalSpeaking || isRemoteSpeaking)
        }"
      ></div>
      <span class="mini-title">{{ callType === 'group' ? (currentRoom?.name || '群语音会议') : (targetUser?.displayName || '语音通话') }}</span>
      <span v-if="currentVoiceEffect !== 'original'" class="mini-effect-badge" :title="`${activeEffect.name}变音中`">{{ activeEffect.icon }}</span>
      <span v-if="isHandRaised" class="mini-hand-badge" title="举手申请中">✋</span>
      <span class="mini-time">{{ callStatus === 'calling' ? '正在呼叫...' : formattedDuration }}</span>
      <button
        type="button"
        class="mini-action-btn mini-action-btn--mute"
        :title="isMuted ? '取消静音' : '静音'"
        @click.stop="emit('toggle-mute')"
      >
        <MicOff v-if="isMuted" :size="14" />
        <Mic v-else :size="14" />
      </button>
      <button
        type="button"
        class="mini-action-btn mini-action-btn--end"
        title="挂断"
        @click.stop="callType === 'group' ? emit('leave-group') : emit('end')"
      >
        <PhoneOff :size="14" />
      </button>
      <button
        type="button"
        class="mini-action-btn mini-action-btn--restore"
        title="还原大窗口"
        @click.stop="emit('toggle-minimize')"
      >
        <Maximize2 :size="14" />
      </button>
    </div>
  </Transition>

  <!-- 2. Full Call Modal Overlay -->
  <Transition name="modal-fade">
    <div
      v-if="!isMinimized && ['calling', 'ringing', 'connected'].includes(callStatus)"
      class="audio-call-overlay"
      role="dialog"
      aria-modal="true"
    >
      <div class="audio-call-card">
        <!-- Top window controls -->
        <div class="audio-call-card__header">
          <span class="call-type-badge">
            <UsersRound v-if="callType === 'group'" :size="14" />
            <Phone v-else :size="14" />
            <span>{{ callType === 'group' ? '群聊语音会议' : '加密语音电话' }}</span>
          </span>
          <button
            v-if="callStatus !== 'ringing'"
            type="button"
            class="call-minimize-btn"
            title="最小化为悬浮窗"
            @click="emit('toggle-minimize')"
          >
            <Minimize2 :size="17" />
          </button>
        </div>

        <!-- Center Avatar & Pulse Animation -->
        <div class="audio-call-card__center">
          <div
            class="call-avatar-wrapper"
            :class="{
              'call-avatar-wrapper--pulse': ['calling', 'ringing'].includes(callStatus),
              'call-avatar-wrapper--speaking': (callType === 'dm' && isRemoteSpeaking) || (callType === 'group' && isLocalSpeaking)
            }"
          >
            <UiAvatar
              v-if="callType === 'dm'"
              :src="targetUser?.avatarUrl"
              :fallback="targetUser?.displayName?.[0] || '友'"
              size="lg"
              class="call-avatar"
            />
            <div v-else class="call-group-icon">
              <UsersRound :size="48" />
            </div>
            <!-- Soundwave ring effect -->
            <div v-if="callStatus === 'connected'" class="call-soundwave-ring"></div>
          </div>

          <h3 class="call-peer-name">
            {{ callType === 'group' ? (currentRoom?.name || '语音会议') : (targetUser?.displayName || '未知用户') }}
          </h3>

          <p class="call-status-text">
            <span v-if="callStatus === 'calling'">正在呼叫对方...</span>
            <span v-else-if="callStatus === 'ringing'">邀请你进行语音通话</span>
            <span v-else-if="callStatus === 'connected'" class="call-duration-text">
              <Volume2 :size="16" class="volume-icon" :class="{ 'volume-icon--speaking': (callType === 'dm' && isRemoteSpeaking) || isLocalSpeaking }" />
              <span>{{ formattedDuration }}</span>
            </span>
          </p>

          <!-- Voice effect active badge -->
          <div v-if="currentVoiceEffect !== 'original' && callStatus !== 'ringing'" class="call-voice-effect-tag">
            <span class="effect-tag-dot"></span>
            <span>{{ activeEffect.icon }} {{ activeEffect.name }}变音中</span>
          </div>

          <!-- DM remote speaking badge -->
          <div v-if="callType === 'dm' && callStatus === 'connected' && isRemoteSpeaking" class="call-speaking-badge">
            <span class="speaking-wave-bar bar-1"></span>
            <span class="speaking-wave-bar bar-2"></span>
            <span class="speaking-wave-bar bar-3"></span>
            <span>正在说话...</span>
          </div>

          <!-- Audio Device Hint -->
          <div v-if="callStatus !== 'ended'" class="call-audio-device-hint" role="note">
            <Headphones :size="12" class="hint-icon" />
            <span>移动端建议佩戴耳机使用</span>
          </div>

          <!-- Group participants list & Stage Controls (if in group meeting) -->
          <div v-if="callType === 'group' && callStatus === 'connected'" class="group-meeting-members">
            <!-- Stage Moderation Action Bar -->
            <div class="group-meeting-notify-row">
              <button
                type="button"
                class="group-notify-btn"
                :class="{ 'group-notify-btn--success': notifyGroupSuccess }"
                :disabled="notifyGroupCooldown"
                :title="notifyGroupCooldown ? '已发送群通知（冷却中）' : '发送群聊消息，提醒群成员加入会议'"
                @click="emit('notify-group')"
              >
                <Megaphone :size="14" />
                <span>{{ notifyGroupSuccess ? '已发送群通知！' : (notifyGroupCooldown ? '已通知群成员' : '通知群成员入会') }}</span>
              </button>

              <!-- Moderator Mute All Button -->
              <button
                v-if="canManage"
                type="button"
                class="group-mute-all-btn"
                title="一键静音除自己外的所有参会成员"
                @click="emit('mute-all')"
              >
                <VolumeX :size="14" />
                <span>全员静音</span>
              </button>
            </div>

            <div class="meeting-members-title">
              <span>在线参会者 ({{ groupParticipants.length + 1 }})</span>
            </div>

            <div class="meeting-members-grid">
              <!-- "我" Member Pill -->
              <div
                class="meeting-member-pill meeting-member-pill--self"
                :class="{
                  'meeting-member-pill--speaking': isLocalSpeaking && !isMuted,
                  'meeting-member-pill--hand': isHandRaised
                }"
              >
                <span class="member-speaking-dot" v-if="isLocalSpeaking && !isMuted"></span>
                <Crown v-if="isOwner" :size="12" class="member-role-icon member-role-icon--owner" title="群主" />
                <Shield v-else-if="canManage" :size="12" class="member-role-icon member-role-icon--admin" title="管理员" />
                <span class="member-name">我 {{ isMuted ? '(静音)' : (isLocalSpeaking ? '(说话中)' : '') }}</span>
                <span v-if="isHandRaised" class="member-hand-tag">✋ 举手中</span>
              </div>

              <!-- Other Participants -->
              <div
                v-for="p in groupParticipants"
                :key="p.userId"
                class="meeting-member-pill"
                :class="{
                  'meeting-member-pill--speaking': p.isSpeaking && !p.isMuted,
                  'meeting-member-pill--hand': p.isHandRaised
                }"
              >
                <span class="member-speaking-dot" v-if="p.isSpeaking && !p.isMuted"></span>
                <Crown v-if="p.role === 'owner'" :size="12" class="member-role-icon member-role-icon--owner" title="群主" />
                <Shield v-else-if="p.role === 'admin'" :size="12" class="member-role-icon member-role-icon--admin" title="管理员" />
                <span class="member-name">{{ p.displayName }} {{ p.isMuted ? '(静音)' : (p.isSpeaking ? '(说话中)' : '') }}</span>

                <!-- Hand Raised Status & Approval Controls for Admins -->
                <template v-if="p.isHandRaised">
                  <span class="member-hand-tag">✋ 举手</span>
                  <div v-if="canManage" class="hand-approve-actions">
                    <button
                      type="button"
                      class="mini-btn mini-btn--approve"
                      title="同意发言并解除静音"
                      @click.stop="emit('approve-hand', p.userId)"
                    >
                      <Check :size="11" />
                    </button>
                    <button
                      type="button"
                      class="mini-btn mini-btn--reject"
                      title="忽略举手申请"
                      @click.stop="emit('reject-hand', p.userId)"
                    >
                      <X :size="11" />
                    </button>
                  </div>
                </template>

                <!-- Admin Moderation Controls for ordinary members -->
                <div v-if="canManage && (isOwner || p.role !== 'owner')" class="member-mod-actions">
                  <button
                    v-if="!p.isMuted"
                    type="button"
                    class="mini-mod-btn mini-mod-btn--mute"
                    title="静音该成员"
                    @click.stop="emit('mute-participant', p.userId)"
                  >
                    <VolumeX :size="11" />
                  </button>
                  <button
                    type="button"
                    class="mini-mod-btn mini-mod-btn--kick"
                    title="移出语音会议"
                    @click.stop="emit('kick-participant', p.userId)"
                  >
                    <UserX :size="11" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Voice Effects Selection Drawer -->
        <Transition name="effect-popover">
          <div v-if="showVoiceMenu && callStatus !== 'ringing'" class="call-voice-effects-menu" role="menu">
            <div class="call-voice-effects-menu__header">
              <span class="effects-menu-title">🎭 实时变音特效</span>
              <span class="effects-menu-tip">实时生效</span>
            </div>
            <div class="call-voice-effects-menu__list">
              <button
                v-for="eff in availableVoiceEffects"
                :key="eff.id"
                type="button"
                class="voice-effect-chip"
                :class="{ 'voice-effect-chip--active': currentVoiceEffect === eff.id }"
                @click="emit('set-voice-effect', eff.id)"
              >
                <span class="voice-effect-chip__icon">{{ eff.icon }}</span>
                <span class="voice-effect-chip__name">{{ eff.name }}</span>
              </button>
            </div>
          </div>
        </Transition>

        <!-- Bottom Action Controls -->
        <div class="audio-call-card__footer">
          <!-- A. Incoming Call (Ringing): Accept or Reject -->
          <template v-if="callStatus === 'ringing'">
            <button
              type="button"
              class="call-btn call-btn--reject"
              title="拒绝"
              @click="emit('reject')"
            >
              <PhoneOff :size="24" />
              <span>拒绝</span>
            </button>
            <button
              type="button"
              class="call-btn call-btn--accept"
              title="接听"
              @click="emit('accept')"
            >
              <Phone :size="24" />
              <span>接听</span>
            </button>
          </template>

          <!-- B. Connected or Outgoing Calling: Mute, Voice Effects, Hand Raise & Hangup -->
          <template v-else>
            <button
              type="button"
              class="call-btn call-btn--secondary"
              :class="{
                'call-btn--active': isMuted,
                'call-btn--speaking': isLocalSpeaking && !isMuted
              }"
              :title="isMuted ? '取消静音' : '静音'"
              @click="emit('toggle-mute')"
            >
              <MicOff v-if="isMuted" :size="22" />
              <Mic v-else :size="22" />
              <span>{{ isMuted ? '已静音' : (isLocalSpeaking ? '正在说话' : '麦克风') }}</span>
            </button>

            <!-- Raise Hand button for members in group calls -->
            <button
              v-if="callType === 'group'"
              type="button"
              class="call-btn call-btn--secondary"
              :class="{ 'call-btn--hand-active': isHandRaised }"
              :title="isHandRaised ? '点击取消举手' : '申请发言'"
              @click="emit('toggle-hand')"
            >
              <Hand :size="22" />
              <span>{{ isHandRaised ? '举手中' : '申请发言' }}</span>
            </button>

            <!-- Real-time Voice Changer Button -->
            <button
              type="button"
              class="call-btn call-btn--effect"
              :class="{
                'call-btn--effect-active': currentVoiceEffect !== 'original',
                'call-btn--open': showVoiceMenu
              }"
              :title="`实时变音 (当前: ${activeEffect.name})`"
              @click="showVoiceMenu = !showVoiceMenu"
            >
              <span class="effect-btn-icon-wrapper">
                <Wand2 v-if="currentVoiceEffect === 'original'" :size="22" />
                <span v-else class="call-btn__effect-icon">{{ activeEffect.icon }}</span>
              </span>
              <span>{{ currentVoiceEffect === 'original' ? '变音' : activeEffect.name }}</span>
            </button>

            <button
              type="button"
              class="call-btn call-btn--danger"
              title="挂断通话"
              @click="callType === 'group' ? emit('leave-group') : emit('end')"
            >
              <PhoneOff :size="24" />
              <span>{{ callType === 'group' ? '退出会议' : '挂断' }}</span>
            </button>
          </template>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
/* Minimized Floating Bar */
.audio-call-minimized {
  position: fixed;
  bottom: 24px;
  right: 24px;
  z-index: 999;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 16px;
  background: rgba(17, 27, 33, 0.95);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 30px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.28);
  color: #ffffff;
  cursor: pointer;
  user-select: none;
}

.mini-pulse-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #10b981;
  box-shadow: 0 0 8px #10b981;
  animation: pulseGreen 1.5s infinite;
}

.mini-pulse-dot--calling {
  background: #f59e0b;
  box-shadow: 0 0 8px #f59e0b;
}

.mini-title {
  font-size: 13px;
  font-weight: 600;
  max-width: 110px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mini-time {
  font-size: 12px;
  color: #94a3b8;
  font-family: monospace;
}

.mini-action-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  border: none;
  background: rgba(255, 255, 255, 0.15);
  color: #ffffff;
  cursor: pointer;
  transition: all 0.15s;
}

.mini-action-btn:hover {
  background: rgba(255, 255, 255, 0.28);
}

.mini-action-btn--end {
  background: #ef4444;
}

.mini-action-btn--end:hover {
  background: #dc2626;
}

/* Fullscreen Modal Overlay */
.audio-call-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(11, 20, 26, 0.75);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  padding: 16px;
}

.audio-call-card {
  width: 100%;
  max-width: 360px;
  background: #111b21;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 24px;
  box-shadow: 0 20px 48px rgba(0, 0, 0, 0.45);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  color: #ffffff;
}

.audio-call-card__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
}

.call-type-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #94a3b8;
  background: rgba(255, 255, 255, 0.08);
  padding: 4px 10px;
  border-radius: 12px;
}

.call-minimize-btn {
  background: transparent;
  border: none;
  color: #94a3b8;
  cursor: pointer;
  padding: 4px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.call-minimize-btn:hover {
  color: #ffffff;
  background: rgba(255, 255, 255, 0.1);
}

.audio-call-card__center {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 16px 24px 28px;
  text-align: center;
}

.call-avatar-wrapper {
  position: relative;
  margin-bottom: 18px;
  border-radius: 50%;
  padding: 4px;
}

.call-avatar-wrapper--pulse {
  animation: avatarPulse 2s infinite ease-in-out;
}

.call-avatar :deep(.ui-avatar) {
  width: 96px;
  height: 96px;
  font-size: 32px;
}

.call-group-icon {
  width: 96px;
  height: 96px;
  border-radius: 50%;
  background: #008069;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #ffffff;
}

.call-peer-name {
  margin: 0 0 6px;
  font-size: 20px;
  font-weight: 600;
  color: #f1f5f9;
}

.call-status-text {
  margin: 0;
  font-size: 13.5px;
  color: #94a3b8;
  display: flex;
  align-items: center;
  gap: 6px;
}

.call-duration-text {
  color: #10b981;
  font-family: monospace;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.volume-icon {
  animation: volumeWave 1.2s infinite ease-in-out;
}

.group-meeting-members {
  width: 100%;
  margin-top: 18px;
  padding-top: 14px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}

.meeting-members-title {
  font-size: 11px;
  text-transform: uppercase;
  color: #64748b;
  margin-bottom: 8px;
  text-align: left;
}

.meeting-members-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.meeting-member-pill {
  font-size: 12px;
  padding: 3px 8px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.08);
  color: #cbd5e1;
}

.meeting-member-pill--self {
  background: rgba(0, 128, 105, 0.25);
  color: #34d399;
}

.audio-call-card__footer {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 28px;
  padding: 20px 24px 32px;
  background: rgba(0, 0, 0, 0.2);
}

.call-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  border: none;
  background: transparent;
  color: #ffffff;
  cursor: pointer;
  transition: transform 0.15s;
}

.call-btn:hover {
  transform: scale(1.06);
}

.call-btn span {
  font-size: 12px;
  font-weight: 500;
}

.call-btn--accept {
  width: 60px;
  height: 60px;
  border-radius: 50%;
  background: #10b981;
  justify-content: center;
  box-shadow: 0 4px 16px rgba(16, 185, 129, 0.4);
}

.call-btn--reject,
.call-btn--danger {
  width: 60px;
  height: 60px;
  border-radius: 50%;
  background: #ef4444;
  justify-content: center;
  box-shadow: 0 4px 16px rgba(239, 68, 68, 0.4);
}

.call-btn--secondary {
  width: 60px;
  height: 60px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.12);
  justify-content: center;
}

.call-btn--active {
  background: #f59e0b;
}

.mini-pulse-dot--speaking {
  background: #10b981;
  box-shadow: 0 0 12px #10b981;
  animation: pulseGreen 0.8s infinite;
}

.call-avatar-wrapper--speaking {
  box-shadow: 0 0 0 4px #10b981, 0 0 28px rgba(16, 185, 129, 0.8);
  animation: speakingRingPulse 1.2s infinite ease-in-out;
}

.volume-icon--speaking {
  color: #34d399;
}

.call-audio-device-hint {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin-top: 12px;
  padding: 3px 10px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  font-size: 11px;
  color: #94a3b8;
}

.call-audio-device-hint .hint-icon {
  color: #38bdf8;
}

.call-speaking-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 12px;
  background: rgba(16, 185, 129, 0.18);
  border: 1px solid rgba(16, 185, 129, 0.45);
  border-radius: 14px;
  font-size: 12px;
  color: #34d399;
  margin-top: 10px;
  animation: badgeFadeIn 0.2s ease;
}

.speaking-wave-bar {
  display: inline-block;
  width: 2.5px;
  background: #34d399;
  border-radius: 2px;
  animation: waveBar 0.8s infinite ease-in-out;
}

.speaking-wave-bar.bar-1 { height: 6px; animation-delay: 0s; }
.speaking-wave-bar.bar-2 { height: 12px; animation-delay: 0.2s; }
.speaking-wave-bar.bar-3 { height: 8px; animation-delay: 0.4s; }

.group-meeting-notify-row {
  display: flex;
  justify-content: center;
  margin-bottom: 12px;
}

.group-notify-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  border-radius: 18px;
  border: 1px solid rgba(52, 211, 153, 0.4);
  background: rgba(16, 185, 129, 0.15);
  color: #34d399;
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.group-notify-btn:hover:not(:disabled) {
  background: rgba(16, 185, 129, 0.28);
  transform: scale(1.03);
}

.group-notify-btn:disabled {
  opacity: 0.65;
  cursor: not-allowed;
}

.group-notify-btn--success {
  background: #10b981;
  color: #ffffff;
  border-color: #10b981;
}

.meeting-member-pill--speaking {
  background: rgba(16, 185, 129, 0.35);
  color: #34d399;
  border: 1px solid #10b981;
  box-shadow: 0 0 10px rgba(16, 185, 129, 0.5);
}

.member-speaking-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #10b981;
  margin-right: 4px;
  vertical-align: middle;
  animation: pulseGreen 0.8s infinite;
}

.call-btn--speaking {
  box-shadow: 0 0 0 3px #10b981, 0 0 16px rgba(16, 185, 129, 0.6);
  background: rgba(16, 185, 129, 0.3);
}

@keyframes speakingRingPulse {
  0%, 100% { box-shadow: 0 0 0 4px #10b981, 0 0 20px rgba(16, 185, 129, 0.6); }
  50% { box-shadow: 0 0 0 7px #34d399, 0 0 32px rgba(52, 211, 153, 0.9); }
}

@keyframes waveBar {
  0%, 100% { transform: scaleY(0.4); }
  50% { transform: scaleY(1.3); }
}

@keyframes badgeFadeIn {
  from { opacity: 0; transform: translateY(-4px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes pulseGreen {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.6; transform: scale(1.15); }
}

@keyframes avatarPulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(0, 128, 105, 0.5); }
  50% { box-shadow: 0 0 0 16px rgba(0, 128, 105, 0); }
}

@keyframes volumeWave {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.25); }
}

.mini-effect-badge {
  font-size: 13px;
  background: rgba(255, 255, 255, 0.15);
  padding: 1px 5px;
  border-radius: 6px;
}

.call-voice-effect-tag {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
  padding: 3px 10px;
  border-radius: 12px;
  background: rgba(99, 102, 241, 0.18);
  border: 1px solid rgba(99, 102, 241, 0.4);
  color: #a5b4fc;
  font-size: 12px;
  font-weight: 500;
}

.effect-tag-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #818cf8;
  animation: pulseGreen 1s infinite;
}

.call-btn--effect {
  width: 60px;
  height: 60px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.12);
  justify-content: center;
  position: relative;
}

.call-btn--effect-active {
  background: rgba(99, 102, 241, 0.28);
  border: 1px solid #818cf8;
  color: #c7d2fe;
}

.call-btn--open {
  background: rgba(99, 102, 241, 0.45);
  border: 1px solid #a5b4fc;
}

.effect-btn-icon-wrapper {
  display: flex;
  align-items: center;
  justify-content: center;
}

.call-btn__effect-icon {
  font-size: 20px;
  line-height: 1;
}

.call-voice-effects-menu {
  margin: 0 16px 12px;
  padding: 12px;
  background: #1f2c34;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 16px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
}

.call-voice-effects-menu__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
  padding: 0 4px;
}

.effects-menu-title {
  font-size: 12px;
  font-weight: 600;
  color: #e2e8f0;
}

.effects-menu-tip {
  font-size: 11px;
  color: #94a3b8;
}

.call-voice-effects-menu__list {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}

.voice-effect-chip {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 8px 4px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid transparent;
  border-radius: 12px;
  color: #cbd5e1;
  cursor: pointer;
  transition: all 0.15s ease;
}

.voice-effect-chip:hover {
  background: rgba(255, 255, 255, 0.14);
  transform: translateY(-2px);
}

.voice-effect-chip--active {
  background: rgba(99, 102, 241, 0.25);
  border-color: #818cf8;
  color: #ffffff;
  font-weight: 600;
  box-shadow: 0 0 12px rgba(99, 102, 241, 0.4);
}

.voice-effect-chip__icon {
  font-size: 18px;
}

.voice-effect-chip__name {
  font-size: 11px;
}

.effect-popover-enter-active,
.effect-popover-leave-active {
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}

.effect-popover-enter-from,
.effect-popover-leave-to {
  opacity: 0;
  transform: translateY(8px) scale(0.96);
}

.mini-hand-badge {
  font-size: 13px;
  margin-right: 2px;
  animation: pulseGreen 1s infinite;
}

.group-mute-all-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 6px 12px;
  border-radius: 18px;
  border: 1px solid rgba(239, 68, 68, 0.45);
  background: rgba(239, 68, 68, 0.18);
  color: #fca5a5;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.group-mute-all-btn:hover {
  background: rgba(239, 68, 68, 0.3);
  transform: scale(1.03);
}

.member-role-icon {
  margin-right: 3px;
  vertical-align: -1px;
}

.member-role-icon--owner {
  color: #f59e0b;
}

.member-role-icon--admin {
  color: #38bdf8;
}

.meeting-member-pill--hand {
  border: 1px solid #f59e0b;
  background: rgba(245, 158, 11, 0.22);
  color: #fde68a;
  box-shadow: 0 0 12px rgba(245, 158, 11, 0.45);
  animation: pulseGreen 1.2s infinite;
}

.member-hand-tag {
  font-size: 10.5px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 6px;
  background: rgba(245, 158, 11, 0.35);
  color: #fef08a;
  margin-left: 4px;
}

.hand-approve-actions {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  margin-left: 6px;
}

.mini-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: none;
  cursor: pointer;
  transition: transform 0.15s;
}

.mini-btn:hover {
  transform: scale(1.15);
}

.mini-btn--approve {
  background: #10b981;
  color: #ffffff;
}

.mini-btn--reject {
  background: #ef4444;
  color: #ffffff;
}

.member-mod-actions {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  margin-left: 6px;
  opacity: 0.8;
  transition: opacity 0.15s;
}

.member-mod-actions:hover {
  opacity: 1;
}

.mini-mod-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 4px;
  border: none;
  background: rgba(255, 255, 255, 0.15);
  color: #e2e8f0;
  cursor: pointer;
  transition: all 0.15s;
}

.mini-mod-btn--mute:hover {
  background: #f59e0b;
  color: #ffffff;
}

.mini-mod-btn--kick:hover {
  background: #ef4444;
  color: #ffffff;
}

.call-btn--hand-active {
  background: rgba(245, 158, 11, 0.3) !important;
  border: 1px solid #f59e0b;
  color: #fde68a !important;
  box-shadow: 0 0 14px rgba(245, 158, 11, 0.5);
}

.mini-fade-enter-active, .mini-fade-leave-active,
.modal-fade-enter-active, .modal-fade-leave-active {
  transition: all 0.22s cubic-bezier(0.16, 1, 0.3, 1);
}

.mini-fade-enter-from, .mini-fade-leave-to {
  opacity: 0;
  transform: translateY(12px) scale(0.95);
}

.modal-fade-enter-from, .modal-fade-leave-to {
  opacity: 0;
  transform: scale(0.96);
}
</style>
