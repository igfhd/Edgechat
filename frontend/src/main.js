import { createApp } from 'vue';
import App from './App.vue';
import router from './router.js';
import store from './store.js';
import { installCapacitorIntegration } from './capacitor-platform.js';
import './styles/base.css';
import './styles.css';
import './styles-liquid.css';
import './styles/tokens.css';
import './styles/layout.css';
import './styles/ui.css';
import './styles/admin.css';
import './styles/chat.css';
import './styles/chat-messages.css';
import './styles/chat-attachments.css';
import './styles/dark.css';
import { initLiquidGlass } from './liquid-glass.js';
import { usePwa } from './composables/usePwa.js';
import { applyTheme } from './composables/useTheme.js';
import { applyFontSize } from './composables/useFontSize.js';

// 初始化主题 (浅色 / 深色 / 跟随系统)
applyTheme();

// 初始化聊天字体大小
applyFontSize();

// 应用自定义背景
const customBg = localStorage.getItem('customBackground');
if (customBg) {
  document.body.style.background = customBg;
}

// 初始化 PWA 支持
const { initPwa } = usePwa();
initPwa();

store.initialize().finally(() => {
  const app = createApp(App);
  app.use(router);
  app.mount('#app');
  void installCapacitorIntegration({
    onOpenRoom() {
      void router.push('/');
    }
  });

  // 初始化 Liquid Glass 效果
  setTimeout(initLiquidGlass, 100);
});
