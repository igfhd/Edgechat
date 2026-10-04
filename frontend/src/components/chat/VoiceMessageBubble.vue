<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import api from '../../api.js';

const props = defineProps({
  message: {
    type: Object,
    required: true
  },
  isOwn: {
    type: Boolean,
    default: false
  },
  isPlaying: {
    type: Boolean,
    default: false
  },
  isLoading: {
    type: Boolean,
    default: false
  },
  isUnread: {
    type: Boolean,
    default: false
  }
});

const emit = defineEmits(['play']);

const dynamicDuration = ref(null);
const durationCache = new Map();

const duration = computed(() => {
  if (props.message?.attachment?.duration) {
    return Math.max(1, Math.round(props.message.attachment.duration));
  }
  const name = props.message?.attachment?.name || '';
  const match = name.match(/^voice_(\d+)_/);
  if (match) {
    return Math.max(1, Math.round(Number(match[1])));
  }
  if (dynamicDuration.value) {
    return Math.max(1, Math.round(dynamicDuration.value));
  }
  return Math.max(1, Math.round(props.message?.attachment?.duration || 1));
});

// Dynamic width scaling based on duration (1s is ~80px, 60s is ~220px)
const bubbleWidth = computed(() => {
  const w = 78 + Math.min(duration.value, 60) * 2.36;
  return `${Math.round(w)}px`;
});

function loadAudioMetadata() {
  if (props.message?.attachment?.duration) return;
  const name = props.message?.attachment?.name || '';
  if (name.match(/^voice_(\d+)_/)) return;
  const msgId = props.message?.id;
  if (!msgId) return;
  if (durationCache.has(msgId)) {
    dynamicDuration.value = durationCache.get(msgId);
    return;
  }
  const rawUrl = api.getFileUrl(props.message?.attachment?.key || props.message?.attachment?.url);
  if (!rawUrl || props.message?.attachment?.isE2ee || typeof window === 'undefined') return;
  try {
    const audio = new Audio();
    audio.preload = 'metadata';
    audio.src = rawUrl;
    audio.onloadedmetadata = () => {
      if (audio.duration && Number.isFinite(audio.duration) && audio.duration > 0 && audio.duration !== Infinity) {
        const d = Math.max(1, Math.round(audio.duration));
        durationCache.set(msgId, d);
        dynamicDuration.value = d;
      }
    };
  } catch (_e) {}
}

onMounted(loadAudioMetadata);
watch(() => [props.message?.id, props.message?.attachment?.key, props.message?.attachment?.url], loadAudioMetadata);
</script>

<template>
  <div
    class="voice-bubble-container"
    :class="{
      'voice-bubble-container--own': isOwn,
      'voice-bubble-container--playing': isPlaying,
      'voice-bubble-container--unread': isUnread
    }"
  >
    <button
      type="button"
      class="voice-bubble"
      :style="{ width: bubbleWidth }"
      :title="isPlaying ? '暂停播放' : '点击播放语音'"
      :aria-label="`语音消息，时长 ${duration} 秒${isUnread ? '，未读' : ''}`"
      @click="emit('play')"
    >
      <!-- Play/Pause / Loading Icon -->
      <span v-if="isLoading" class="voice-bubble__spinner" aria-hidden="true"></span>
      <span v-else class="voice-bubble__icon" aria-hidden="true">
        <svg v-if="isPlaying" viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
          <rect x="6" y="4" width="4" height="16" rx="1.5" />
          <rect x="14" y="4" width="4" height="16" rx="1.5" />
        </svg>
        <svg v-else viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
          <path d="M8 5v14l11-7z" />
        </svg>
      </span>

      <!-- WeChat style sound waves -->
      <span class="voice-bubble__waves" :class="{ 'voice-bubble__waves--animated': isPlaying }" aria-hidden="true">
        <span class="voice-wave voice-wave--1"></span>
        <span class="voice-wave voice-wave--2"></span>
        <span class="voice-wave voice-wave--3"></span>
      </span>

      <!-- Duration -->
      <span class="voice-bubble__duration">{{ duration }}"</span>

      <!-- Lock icon for E2EE -->
      <span v-if="message.attachment?.isE2ee" class="voice-bubble__e2ee" title="端到端加密语音">🔒</span>
    </button>

    <!-- Unread Red Badge Dot (for incoming unread voice) -->
    <span v-if="!isOwn && isUnread" class="voice-unread-dot" title="未读语音"></span>
  </div>
</template>

<style scoped>
.voice-bubble-container {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin: 2px 0;
  user-select: none;
}

.voice-bubble-container--own {
  flex-direction: row-reverse;
}

.voice-bubble {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 78px;
  max-width: 220px;
  padding: 6px 12px;
  border-radius: 8px;
  background: rgba(0, 128, 105, 0.08);
  border: 1px solid rgba(0, 128, 105, 0.18);
  color: #008069;
  cursor: pointer;
  transition: all 0.15s ease;
  outline: none;
}

.voice-bubble-container--own .voice-bubble {
  background: rgba(0, 128, 105, 0.12);
  border-color: rgba(0, 128, 105, 0.25);
  color: #065f46;
}

.voice-bubble:hover {
  background: rgba(0, 128, 105, 0.16);
  border-color: rgba(0, 128, 105, 0.35);
  transform: translateY(-1px);
}

.voice-bubble:active {
  transform: translateY(0);
}

.voice-bubble__icon {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.voice-bubble__spinner {
  width: 14px;
  height: 14px;
  border: 2px solid rgba(0, 128, 105, 0.3);
  border-top-color: #008069;
  border-radius: 50%;
  animation: voiceSpin 0.7s linear infinite;
}

@keyframes voiceSpin {
  to { transform: rotate(360deg); }
}

/* Sound Wave Bars */
.voice-bubble__waves {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  height: 16px;
  flex: 1;
}

.voice-wave {
  display: inline-block;
  width: 3px;
  border-radius: 1.5px;
  background: currentColor;
  opacity: 0.6;
  transition: height 0.15s ease, opacity 0.15s ease;
}

.voice-wave--1 { height: 6px; }
.voice-wave--2 { height: 11px; }
.voice-wave--3 { height: 16px; }

.voice-bubble__waves--animated .voice-wave--1 {
  animation: waveAnim1 0.8s ease-in-out infinite alternate;
}
.voice-bubble__waves--animated .voice-wave--2 {
  animation: waveAnim2 0.8s ease-in-out 0.2s infinite alternate;
}
.voice-bubble__waves--animated .voice-wave--3 {
  animation: waveAnim3 0.8s ease-in-out 0.4s infinite alternate;
}

@keyframes waveAnim1 {
  0% { height: 4px; opacity: 0.4; }
  100% { height: 14px; opacity: 1; }
}
@keyframes waveAnim2 {
  0% { height: 7px; opacity: 0.5; }
  100% { height: 16px; opacity: 1; }
}
@keyframes waveAnim3 {
  0% { height: 5px; opacity: 0.4; }
  100% { height: 15px; opacity: 1; }
}

.voice-bubble__duration {
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  letter-spacing: 0.2px;
}

.voice-bubble__e2ee {
  font-size: 11px;
  opacity: 0.8;
}

/* Unread Red Dot */
.voice-unread-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #ef4444;
  flex-shrink: 0;
  box-shadow: 0 0 0 2px #ffffff;
  animation: redDotPulse 2s infinite ease-in-out;
}

@keyframes redDotPulse {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.15); opacity: 0.85; }
}
</style>
