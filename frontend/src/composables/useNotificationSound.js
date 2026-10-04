import { ref } from 'vue';

const STORAGE_KEY = 'edgechat:notification-sound';

function loadSoundEnabled() {
  try {
    const v = globalThis.localStorage?.getItem(STORAGE_KEY);
    return v === null ? true : v === 'true'; // 默认开启提示音
  } catch {
    return true;
  }
}

function saveSoundEnabled(val) {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, String(val));
  } catch {}
}

let _ctx = null;
function getAudioContext() {
  if (typeof window === 'undefined') return null;
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return null;
  if (!_ctx || _ctx.state === 'closed') {
    _ctx = new AudioCtx();
  }
  return _ctx;
}

// 自动在用户首次交互（点击或按键）时唤醒 AudioContext
if (typeof window !== 'undefined') {
  const unlockAudio = () => {
    const ctx = getAudioContext();
    if (ctx && ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
  };
  window.addEventListener('pointerdown', unlockAudio, { passive: true, capture: true });
  window.addEventListener('keydown', unlockAudio, { passive: true, capture: true });
}

/**
 * 播放由音符组成的合成音效
 * @param {Array<{freq: number, start: number, duration: number, gain?: number, type?: OscillatorType}>} notes
 */
function playSynthTones(notes, ctxGetter = getAudioContext) {
  try {
    const ctx = ctxGetter();
    if (!ctx) return;

    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }

    const now = ctx.currentTime;
    notes.forEach(({ freq, start, duration, gain = 0.15, type = 'sine' }) => {
      const osc = ctx.createOscillator();
      const gainNode = ctx.createGain();

      osc.type = type;
      osc.frequency.setValueAtTime(freq, now + start);

      // 平滑淡入淡出，消除爆音
      gainNode.gain.setValueAtTime(0, now + start);
      gainNode.gain.linearRampToValueAtTime(gain, now + start + 0.012);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, now + start + duration);

      osc.connect(gainNode);
      gainNode.connect(ctx.destination);

      osc.start(now + start);
      osc.stop(now + start + duration + 0.03);
    });
  } catch {
    // 忽略音频环境异常
  }
}

export function isMessageMention(message, session) {
  if (!message || !session) return false;
  const uid = Number(session.userId || session.id);
  const username = session.username;
  const displayName = session.displayName;

  if (Array.isArray(message.mentions) && message.mentions.some((m) => Number(m?.id) === uid)) {
    return true;
  }

  const content = typeof message.content === 'string' ? message.content : '';
  if (!content) return false;

  if (username && content.includes(`@${username}`)) return true;
  if (displayName && content.includes(`@${displayName}`)) return true;
  return false;
}

export function useNotificationSound(options = {}) {
  const _loadEnabled = options._loadEnabled ?? loadSoundEnabled;
  const _saveEnabled = options._saveEnabled ?? saveSoundEnabled;
  const _playTones = options._playTones ?? playSynthTones;

  const soundEnabled = ref(_loadEnabled());

  function setSoundEnabled(val) {
    soundEnabled.value = Boolean(val);
    _saveEnabled(soundEnabled.value);
  }

  function toggleSound() {
    setSoundEnabled(!soundEnabled.value);
    if (soundEnabled.value) {
      playMessageSound();
    }
    return soundEnabled.value;
  }

  /** 普通消息提示音：清脆双音（880Hz -> 1046Hz，高品味柔和气泡/提醒音） */
  function playMessageSound() {
    if (!soundEnabled.value) return;
    _playTones([
      { freq: 880, start: 0, duration: 0.08, gain: 0.14 },
      { freq: 1046.5, start: 0.09, duration: 0.12, gain: 0.12 }
    ]);
  }

  /** @提及 / 私聊提示音：明亮三音节（659.25Hz -> 880Hz -> 1174.66Hz，向上和弦） */
  function playMentionSound() {
    if (!soundEnabled.value) return;
    _playTones([
      { freq: 659.25, start: 0, duration: 0.08, gain: 0.16 },
      { freq: 880, start: 0.09, duration: 0.09, gain: 0.16 },
      { freq: 1174.66, start: 0.19, duration: 0.15, gain: 0.18 }
    ]);
  }

  /**
   * 自动根据消息内容与会话状态播放对应的提示音
   * @param {Object} message
   * @param {Object} room
   * @param {Object} [ctx]
   * @param {Object} [ctx.session]
   * @param {boolean} [ctx.isMuted]
   */
  function handleIncomingMessageSound(message, room, { session = null, isMuted = false } = {}) {
    if (!soundEnabled.value || !message) return false;

    // 排除自己发出的消息
    const currentUid = Number(session?.userId || session?.id);
    const senderId = Number(message.sender?.id || message.senderId || message.userId);
    if (currentUid && senderId && currentUid === senderId) {
      return false;
    }

    const isMention = isMessageMention(message, session);
    const isDm = room?.kind === 'dm';

    // 如果会话开启了免打扰，仅在被 @ 提及或直接私信时播放提示音
    if (isMuted && !isMention && !isDm) {
      return false;
    }

    if (isMention || isDm) {
      playMentionSound();
    } else {
      playMessageSound();
    }
    return true;
  }

  return {
    soundEnabled,
    setSoundEnabled,
    toggleSound,
    playMessageSound,
    playMentionSound,
    handleIncomingMessageSound
  };
}
