<script setup>
import { Bell, BellOff, Folder, LayoutDashboard, LogOut, Settings, Volume2, VolumeX, X } from '@lucide/vue';
import { ref, toRef } from 'vue';
import { useOverlayLifecycle } from '../../composables/useOverlayLifecycle.js';
import UiAvatar from '../ui/Avatar.vue';

const props = defineProps({
  show: { type: Boolean, default: false },
  session: { type: Object, default: null },
  showAdmin: { type: Boolean, default: false },
  notificationsEnabled: { type: Boolean, default: false },
  notificationLabel: { type: String, default: '开启通知' },
  notificationDisabled: { type: Boolean, default: false },
  soundEnabled: { type: Boolean, default: true }
});

const emit = defineEmits(['close', 'drive', 'settings', 'admin', 'notification', 'sound', 'logout']);
const drawerEl = ref(null);

useOverlayLifecycle({
  open: toRef(props, 'show'),
  onClose: () => emit('close'),
  focusTarget: drawerEl
});
</script>

<template>
  <Teleport to="body">
    <Transition name="mobile-drawer">
      <div v-if="show" class="mobile-navigation-overlay" @click.self="emit('close')">
        <aside
          ref="drawerEl"
          class="mobile-navigation-drawer"
          role="dialog"
          aria-modal="true"
          aria-label="导航菜单"
          tabindex="-1"
        >
          <header class="mobile-navigation-drawer__header">
            <UiAvatar :src="session?.avatarUrl" :fallback="session?.displayName?.[0] || 'U'" />
            <div class="mobile-navigation-drawer__identity">
              <strong>{{ session?.displayName || 'EdgeChat 用户' }}</strong>
              <span v-if="session?.username">@{{ session.username }}</span>
            </div>
            <button type="button" class="mobile-navigation-drawer__close" aria-label="关闭导航" @click="emit('close')">
              <X :size="22" aria-hidden="true" />
            </button>
          </header>

          <nav class="mobile-navigation-drawer__actions" aria-label="应用导航">
            <button type="button" @click="emit('drive')">
              <Folder :size="21" aria-hidden="true" />
              <span>我的云盘</span>
            </button>
            <button type="button" @click="emit('settings')">
              <Settings :size="21" aria-hidden="true" />
              <span>个人设置</span>
            </button>
            <button
              type="button"
              :disabled="notificationDisabled"
              :aria-pressed="notificationsEnabled"
              @click="emit('notification')"
            >
              <Bell v-if="notificationsEnabled" :size="21" aria-hidden="true" />
              <BellOff v-else :size="21" aria-hidden="true" />
              <span>{{ notificationLabel }}</span>
            </button>
            <button
              type="button"
              :aria-pressed="soundEnabled"
              @click="emit('sound')"
            >
              <Volume2 v-if="soundEnabled" :size="21" aria-hidden="true" />
              <VolumeX v-else :size="21" aria-hidden="true" />
              <span>{{ soundEnabled ? '提示音开启' : '提示音关闭' }}</span>
            </button>
            <button v-if="showAdmin" type="button" @click="emit('admin')">
              <LayoutDashboard :size="21" aria-hidden="true" />
              <span>管理后台</span>
            </button>
            <button type="button" class="mobile-navigation-drawer__danger" @click="emit('logout')">
              <LogOut :size="21" aria-hidden="true" />
              <span>退出登录</span>
            </button>
          </nav>
        </aside>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.mobile-navigation-overlay {
  position: fixed;
  inset: 0;
  z-index: 120;
  background: rgba(11, 20, 26, 0.42);
}

.mobile-navigation-drawer {
  width: min(84vw, 320px);
  height: 100%;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: max(18px, env(safe-area-inset-top)) 12px max(18px, env(safe-area-inset-bottom));
  background: #ffffff;
  box-shadow: 12px 0 32px rgba(11, 20, 26, 0.2);
  outline: none;
  touch-action: pan-y;
}

.mobile-navigation-drawer__header {
  display: grid;
  grid-template-columns: 48px minmax(0, 1fr) 44px;
  align-items: center;
  gap: 12px;
  padding: 4px 4px 18px;
  border-bottom: 1px solid #e9edef;
}

.mobile-navigation-drawer__identity {
  display: grid;
  gap: 3px;
  min-width: 0;
}

.mobile-navigation-drawer__identity strong,
.mobile-navigation-drawer__identity span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mobile-navigation-drawer__identity strong {
  color: #111b21;
  font-size: 15px;
}

.mobile-navigation-drawer__identity span {
  color: #667781;
  font-size: 13px;
}

.mobile-navigation-drawer__close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: #54656f;
}

.mobile-navigation-drawer__actions {
  display: grid;
  gap: 4px;
  padding-top: 12px;
}

.mobile-navigation-drawer__actions button,
.mobile-navigation-drawer__actions a {
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr);
  align-items: center;
  gap: 12px;
  min-height: 52px;
  padding: 0 14px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: #111b21;
  text-align: left;
  text-decoration: none;
  touch-action: manipulation;
}

.mobile-navigation-drawer__actions button:active,
.mobile-navigation-drawer__actions a:active,
.mobile-navigation-drawer__close:active {
  background: #f0f2f5;
}

.mobile-navigation-drawer__actions button:disabled {
  color: #8696a0;
  cursor: not-allowed;
  opacity: 0.72;
}

.mobile-navigation-drawer__actions .mobile-navigation-drawer__danger {
  color: #c62828;
}

.mobile-drawer-enter-active,
.mobile-drawer-leave-active {
  transition: opacity 180ms ease;
}

.mobile-drawer-enter-active .mobile-navigation-drawer,
.mobile-drawer-leave-active .mobile-navigation-drawer {
  transition: transform 220ms ease;
}

.mobile-drawer-enter-from,
.mobile-drawer-leave-to {
  opacity: 0;
}

.mobile-drawer-enter-from .mobile-navigation-drawer,
.mobile-drawer-leave-to .mobile-navigation-drawer {
  transform: translateX(-100%);
}

@media (prefers-reduced-motion: reduce) {
  .mobile-drawer-enter-active,
  .mobile-drawer-leave-active,
  .mobile-drawer-enter-active .mobile-navigation-drawer,
  .mobile-drawer-leave-active .mobile-navigation-drawer {
    transition: none;
  }
}
</style>
