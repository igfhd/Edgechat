<script setup>
import { RotateCcw } from '@lucide/vue';
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { resetRuntime } from '../../runtime.js';

const route = useRoute();
const router = useRouter();

const pages = [
  { label: '聊天前台', value: '/' },
  { label: '个人设置', value: '/settings' },
  { label: '后台仪表盘', value: '/admin/dashboard' },
  { label: '用户管理', value: '/admin/users' },
  { label: '注册邀请', value: '/admin/invites' },
  { label: 'Telegram 互通', value: '/admin/telegram' },
  { label: '网站设置', value: '/admin/site' },
  { label: '登录页面', value: '/login' },
  { label: '邀请注册', value: '/register/demo-invite' }
];

const currentPage = computed(() => {
  const match = pages.find((page) => page.value === route.path);
  return match?.value || '/';
});

function navigate(event) {
  void router.push(event.target.value);
}

function resetDemo() {
  resetRuntime();
  localStorage.removeItem('customBackground');
  window.location.assign(router.resolve('/').href);
}
</script>

<template>
  <aside class="demo-navigator" aria-label="演示页面导航">
    <span class="demo-navigator__badge">本地演示</span>
    <select :value="currentPage" aria-label="选择演示页面" @change="navigate">
      <option v-for="page in pages" :key="page.value" :value="page.value">
        {{ page.label }}
      </option>
    </select>
    <button type="button" title="重置演示数据" aria-label="重置演示数据" @click="resetDemo">
      <RotateCcw :size="16" aria-hidden="true" />
    </button>
  </aside>
</template>

<style scoped>
.demo-navigator {
  position: fixed;
  top: 12px;
  right: 12px;
  z-index: 10000;
  display: flex;
  align-items: center;
  gap: 7px;
  min-height: 38px;
  padding: 5px 6px 5px 10px;
  border: 1px solid rgba(255, 255, 255, 0.78);
  border-radius: 8px;
  background: rgba(248, 251, 254, 0.88);
  box-shadow: 0 8px 24px rgba(35, 54, 76, 0.16);
  backdrop-filter: blur(18px) saturate(150%);
  color: #23405f;
}

.demo-navigator__badge {
  font-size: 12px;
  font-weight: 700;
  white-space: nowrap;
}

.demo-navigator select {
  width: 138px;
  height: 28px;
  border: 1px solid rgba(70, 105, 139, 0.22);
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.82);
  color: #203b57;
  font: inherit;
  font-size: 12px;
  padding: 0 24px 0 8px;
}

.demo-navigator button {
  display: grid;
  width: 28px;
  height: 28px;
  place-items: center;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: #426584;
  cursor: pointer;
}

.demo-navigator button:hover,
.demo-navigator button:focus-visible {
  background: rgba(80, 126, 167, 0.12);
  outline: none;
}

@media (max-width: 640px) {
  .demo-navigator {
    top: 8px;
    right: 8px;
  }

  .demo-navigator__badge {
    display: none;
  }

  .demo-navigator select {
    width: 124px;
  }
}
</style>
