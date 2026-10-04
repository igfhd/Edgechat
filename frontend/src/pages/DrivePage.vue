<script setup>
import { onMounted, onBeforeUnmount } from 'vue';
import { useRouter } from 'vue-router';
import DriveFileManager from '../components/drive/DriveFileManager.vue';
import UiAvatar from '../components/ui/Avatar.vue';
import store from '../store.js';
import { useTheme } from '../composables/useTheme.js';
import { registerBackHandler } from '../back-navigation.js';

const router = useRouter();
const { isDark, toggleTheme } = useTheme();

const goBackToChat = () => {
  router.push('/');
};

const goToSettings = () => {
  router.push('/settings');
};

let unregisterBack = null;
onMounted(() => {
  unregisterBack = registerBackHandler(30, () => {
    goBackToChat();
    return true;
  });
});

onBeforeUnmount(() => {
  if (unregisterBack) {
    unregisterBack();
    unregisterBack = null;
  }
});
</script>

<template>
  <div class="drive-page-layout">
    <!-- Header -->
    <header class="drive-page-header">
      <div class="header-left">
        <button type="button" class="nav-back-btn" @click="goBackToChat" title="返回聊天">
          <span class="btn-icon">💬</span>
          <span class="btn-text">返回聊天</span>
        </button>
        <div class="header-brand">
          <span class="brand-icon">📁</span>
          <h1 class="brand-title">我的云盘</h1>
        </div>
      </div>

      <div class="header-right">
        <button type="button"
          class="header-action-btn"
          :title="isDark ? '切换至浅色模式' : '切换至深色暗黑模式'"
          @click="toggleTheme"
        >
          {{ isDark ? '☀️' : '🌙' }}
        </button>
        <button type="button"
          class="header-avatar-btn"
          :title="store.session?.displayName || store.session?.username || '个人设置'"
          @click="goToSettings"
        >
          <UiAvatar
            :src="store.session?.avatarUrl"
            :fallback="(store.session?.displayName || store.session?.username || 'U')[0]"
            size="sm"
          />
          <span class="avatar-username">{{ store.session?.displayName || store.session?.username }}</span>
        </button>
      </div>
    </header>

    <!-- Main File Manager Content -->
    <main class="drive-page-main">
      <DriveFileManager />
    </main>
  </div>
</template>

<style scoped>
.drive-page-layout {
  display: flex;
  flex-direction: column;
  height: 100vh;
  width: 100vw;
  background: var(--bg-body, #f8fafc);
  color: var(--text-primary, #0f172a);
  overflow: hidden;
}

.drive-page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 24px;
  background: var(--surface, #ffffff);
  border-bottom: 1px solid var(--border, #e2e8f0);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
  z-index: 10;
}

.header-left,
.header-right {
  display: flex;
  align-items: center;
  gap: 16px;
}

.nav-back-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  background: #f1f5f9;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  color: #334155;
  font-size: 0.88rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.nav-back-btn:hover {
  background: #e2e8f0;
  color: #0f172a;
}

.header-brand {
  display: flex;
  align-items: center;
  gap: 8px;
}

.brand-icon {
  font-size: 1.3rem;
}

.brand-title {
  margin: 0;
  font-size: 1.15rem;
  font-weight: 600;
  color: var(--text, #0f172a);
}

.user-greeting {
  font-size: 0.88rem;
  color: #64748b;
  font-weight: 500;
}

.header-avatar-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 10px 4px 4px;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 24px;
  cursor: pointer;
  transition: all 0.2s ease;
  color: var(--text-secondary, #64748b);
}

.header-avatar-btn:hover {
  background: var(--surface-1, #f1f5f9);
  border-color: var(--border, #e2e8f0);
  color: var(--text, #0f172a);
}

.avatar-username {
  font-size: 0.88rem;
  font-weight: 500;
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.header-action-btn {
  background: var(--surface-1, #f1f5f9);
  border: 1px solid var(--border, #e2e8f0);
  border-radius: 8px;
  padding: 6px 10px;
  font-size: 1rem;
  cursor: pointer;
  transition: all 0.2s ease;
  color: var(--text, #0f172a);
}

.header-action-btn:hover {
  background: var(--surface-2, #e2e8f0);
}

.drive-page-main {
  flex: 1;
  overflow: hidden;
  position: relative;
}

@media (max-width: 640px) {
  .drive-page-header {
    padding: 8px 12px;
    gap: 8px;
  }
  .header-left,
  .header-right {
    gap: 8px;
  }
  .nav-back-btn {
    padding: 5px 8px;
    font-size: 0.82rem;
    gap: 4px;
  }
  .brand-icon {
    font-size: 1.15rem;
  }
  .brand-title {
    font-size: 1rem;
  }
  .header-avatar-btn {
    padding: 2px;
  }
}

@media (max-width: 480px) {
  .nav-back-btn .btn-text {
    display: none;
  }
  .avatar-username {
    display: none;
  }
}
</style>
