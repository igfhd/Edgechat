<script setup>
import { ChevronDown, CircleUserRound, Home, Menu, Search, Settings, X } from '@lucide/vue';
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { adminNavigation } from '../../admin/navigation.js';
import store from '../../store.js';

const props = defineProps({
  open: {
    type: Boolean,
    default: undefined
  }
});

const emit = defineEmits(['close', 'toggle']);

const route = useRoute();
const router = useRouter();
const query = ref('');
const internalOpen = ref(false);
const openGroups = ref(new Set());

const mobileOpen = computed({
  get: () => (props.open !== undefined ? props.open : internalOpen.value),
  set: (val) => {
    internalOpen.value = val;
    if (!val) emit('close');
    else emit('toggle');
  }
});

const filteredNavigation = computed(() => {
  const keyword = query.value.trim().toLocaleLowerCase('zh-CN');
  if (!keyword) {
    return adminNavigation;
  }

  return adminNavigation
    .map((item) => {
      const parentMatches = `${item.label} ${item.description}`.toLocaleLowerCase('zh-CN').includes(keyword);
      if (!item.children) {
        return parentMatches ? item : null;
      }

      const children = parentMatches
        ? item.children
        : item.children.filter((child) => child.label.toLocaleLowerCase('zh-CN').includes(keyword));
      return children.length ? { ...item, children } : null;
    })
    .filter(Boolean);
});

const adminName = computed(() => store.session?.displayName || store.session?.username || 'Administrator');

function isPrimaryActive(item) {
  return route.path === item.to || route.path.startsWith(`${item.to}/`);
}

function isChildActive(item, child) {
  return route.path === item.to && route.hash === child.hash;
}

function isGroupOpen(item) {
  return Boolean(query.value.trim()) || openGroups.value.has(item.id);
}

function toggleGroup(groupId) {
  const next = new Set(openGroups.value);
  if (next.has(groupId)) {
    next.delete(groupId);
  } else {
    next.add(groupId);
  }
  openGroups.value = next;
}

function closeMobile() {
  mobileOpen.value = false;
}

function navigate(location) {
  closeMobile();
  void router.push(location);
}
</script>

<template>
  <div
    class="admin-sidebar-backdrop"
    :class="{ 'admin-sidebar-backdrop--visible': mobileOpen }"
    @click="closeMobile"
  ></div>
  <aside class="admin-sidebar" :class="{ 'admin-sidebar--open': mobileOpen }">
    <div class="admin-sidebar__brand-row">
      <button type="button" class="admin-brand" aria-label="打开仪表盘" @click="navigate('/admin/dashboard')">
        Edgecht 管理后台
      </button>
      <button
        type="button"
        class="admin-mobile-toggle"
        :aria-expanded="mobileOpen"
        aria-controls="admin-sidebar-body"
        :aria-label="mobileOpen ? '收起后台导航' : '展开后台导航'"
        @click="mobileOpen = !mobileOpen"
      >
        <X v-if="mobileOpen" :size="20" aria-hidden="true" />
        <Menu v-else :size="20" aria-hidden="true" />
      </button>
    </div>

    <div id="admin-sidebar-body" class="admin-sidebar__body">
      <label class="admin-nav-search">
        <Search :size="18" aria-hidden="true" />
        <span class="sr-only">搜索后台导航</span>
        <input v-model="query" type="search" placeholder="搜索" />
      </label>

      <nav class="admin-nav" aria-label="后台导航">
        <template v-for="item in filteredNavigation" :key="item.id">
          <button
            v-if="!item.children"
            type="button"
            class="admin-nav-item"
            :class="{ 'admin-nav-item--active': isPrimaryActive(item), 'admin-nav-item--separated': item.separated }"
            :aria-current="isPrimaryActive(item) ? 'page' : undefined"
            @click="navigate(item.to)"
          >
            <component :is="item.icon" :size="19" aria-hidden="true" />
            <span>{{ item.label }}</span>
          </button>

          <section v-else class="admin-nav-group">
            <div class="admin-nav-group__header">
              <button
                type="button"
                class="admin-nav-item admin-nav-item--group"
                :class="{ 'admin-nav-item--active': isPrimaryActive(item) }"
                :aria-current="isPrimaryActive(item) ? 'page' : undefined"
                @click="navigate(item.to)"
              >
                <component :is="item.icon" :size="19" aria-hidden="true" />
                <span>{{ item.label }}</span>
              </button>
              <button
                type="button"
                class="admin-nav-group__toggle"
                :aria-expanded="isGroupOpen(item)"
                :aria-controls="`admin-nav-children-${item.id}`"
                :aria-label="isGroupOpen(item) ? `收起${item.label}子菜单` : `展开${item.label}子菜单`"
                @click="toggleGroup(item.id)"
              >
                <ChevronDown
                  :size="16"
                  aria-hidden="true"
                  :class="{ 'admin-nav-group__chevron--open': isGroupOpen(item) }"
                />
              </button>
            </div>

            <div v-show="isGroupOpen(item)" :id="`admin-nav-children-${item.id}`" class="admin-nav-group__items">
              <button
                v-for="child in item.children"
                :key="child.id"
                type="button"
                class="admin-nav-subitem"
                :class="{ 'admin-nav-subitem--active': isChildActive(item, child) }"
                @click="navigate({ path: item.to, hash: child.hash })"
              >
                {{ child.label }}
              </button>
            </div>
          </section>
        </template>

        <p v-if="!filteredNavigation.length" class="admin-nav-empty">没有匹配的后台页面</p>
      </nav>

      <div class="admin-sidebar__footer">
        <div class="admin-identity">
          <CircleUserRound :size="20" aria-hidden="true" />
          <div>
            <strong>{{ adminName }}</strong>
            <span>超级管理员</span>
          </div>
        </div>
        <div class="admin-sidebar__shortcuts">
          <button type="button" title="返回聊天" aria-label="返回聊天" @click="navigate('/')">
            <Home :size="19" aria-hidden="true" />
          </button>
          <button type="button" title="个人设置" aria-label="个人设置" @click="navigate('/settings')">
            <Settings :size="19" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  </aside>
</template>

<style scoped src="../../styles/admin/sidebar.css"></style>
