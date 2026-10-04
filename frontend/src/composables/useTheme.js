import { ref, computed } from 'vue';

// Available modes: 'light' | 'dark' | 'system'
const THEME_KEY = 'edgechat_theme_preference';

const themePreference = ref(
  typeof localStorage !== 'undefined'
    ? (localStorage.getItem(THEME_KEY) || 'system')
    : 'system'
);

const systemIsDark = ref(
  typeof window !== 'undefined' && window.matchMedia
    ? window.matchMedia('(prefers-color-scheme: dark)').matches
    : false
);

// Listen to OS system theme changes
if (typeof window !== 'undefined' && window.matchMedia) {
  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  mediaQuery.addEventListener('change', (e) => {
    systemIsDark.value = e.matches;
    if (themePreference.value === 'system') {
      applyTheme();
    }
  });
}

const isDark = computed(() => {
  if (themePreference.value === 'dark') return true;
  if (themePreference.value === 'light') return false;
  return systemIsDark.value;
});

export function applyTheme() {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const dark = isDark.value;
  if (dark) {
    root.setAttribute('data-theme', 'dark');
    root.classList.add('dark');
  } else {
    root.setAttribute('data-theme', 'light');
    root.classList.remove('dark');
  }
}

export function useTheme() {
  const setTheme = (mode) => {
    if (!['light', 'dark', 'system'].includes(mode)) mode = 'system';
    themePreference.value = mode;
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(THEME_KEY, mode);
    }
    applyTheme();
  };

  const toggleTheme = () => {
    // If current is dark -> switch to light, else dark
    setTheme(isDark.value ? 'light' : 'dark');
  };

  return {
    themePreference,
    isDark,
    setTheme,
    toggleTheme,
    applyTheme
  };
}
