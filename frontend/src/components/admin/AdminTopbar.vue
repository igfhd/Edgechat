<script setup>
import { Gauge, Menu, Settings, Sun, Moon } from '@lucide/vue';
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { adminRouteIcons } from '../../admin/navigation.js';
import { useTheme } from '../../composables/useTheme.js';

const emit = defineEmits(['toggleSidebar']);

const route = useRoute();
const router = useRouter();
const { isDark, toggleTheme } = useTheme();

const currentIcon = computed(() => adminRouteIcons[route.meta.adminIcon] || Gauge);
const currentTitle = computed(() => route.meta.adminTitle || '管理后台');
</script>

<template>
  <header class="admin-topbar">
    <div class="admin-topbar__left">
      <button
        type="button"
        class="admin-topbar__menu-toggle"
        aria-label="切换侧栏导航"
        @click="emit('toggleSidebar')"
      >
        <Menu :size="20" aria-hidden="true" />
      </button>
      <div class="admin-topbar__title">
        <component :is="currentIcon" :size="23" aria-hidden="true" />
        <h1>{{ currentTitle }}</h1>
      </div>
    </div>
    <div class="admin-topbar__actions">
      <button
        type="button"
        class="admin-topbar__icon-btn"
        :title="isDark ? '切换至浅色模式' : '切换至深色暗黑模式'"
        @click="toggleTheme"
      >
        <Sun v-if="isDark" :size="19" aria-hidden="true" />
        <Moon v-else :size="19" aria-hidden="true" />
      </button>
      <button type="button" class="admin-topbar__settings" @click="router.push('/admin/site')">
        <Settings :size="19" aria-hidden="true" />
        <span>设置</span>
      </button>
    </div>
  </header>
</template>

<style scoped src="../../styles/admin/topbar.css"></style>
