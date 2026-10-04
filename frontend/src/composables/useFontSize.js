import { ref } from 'vue';

const FONT_SIZE_KEY = 'edgechat_message_font_size';
export const DEFAULT_FONT_SIZE = 15; // 15px

// Range: 12px to 24px
export const FONT_SIZE_PRESETS = [
  { label: '小号', size: 13, desc: '紧凑 (13px)' },
  { label: '标准', size: 15, desc: '默认 (15px)' },
  { label: '大号', size: 17, desc: '清晰 (17px)' },
  { label: '特大', size: 19, desc: '醒目 (19px)' },
  { label: '巨大', size: 21, desc: '关怀 (21px)' }
];

const messageFontSize = ref(
  typeof localStorage !== 'undefined'
    ? (Number(localStorage.getItem(FONT_SIZE_KEY)) || DEFAULT_FONT_SIZE)
    : DEFAULT_FONT_SIZE
);

export function applyFontSize(size) {
  if (typeof document === 'undefined') return;
  const s = Number(size) || messageFontSize.value || DEFAULT_FONT_SIZE;
  const clamped = Math.min(Math.max(s, 12), 26);
  const root = document.documentElement;
  root.style.setProperty('--chat-font-size', `${clamped}px`);
  root.style.setProperty('--chat-line-height', (1.45 + (clamped - 15) * 0.012).toFixed(3));
}

export function useFontSize() {
  const setFontSize = (size) => {
    const s = Math.min(Math.max(Number(size) || DEFAULT_FONT_SIZE, 12), 26);
    messageFontSize.value = s;
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(FONT_SIZE_KEY, String(s));
    }
    applyFontSize(s);
  };

  const resetFontSize = () => {
    setFontSize(DEFAULT_FONT_SIZE);
  };

  return {
    messageFontSize,
    setFontSize,
    resetFontSize,
    applyFontSize,
    FONT_SIZE_PRESETS,
    DEFAULT_FONT_SIZE
  };
}
