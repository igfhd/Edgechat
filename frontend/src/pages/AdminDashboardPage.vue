<script setup>
import {
  Activity,
  ArrowRight,
  Database,
  Folder,
  Globe2,
  Home,
  Link,
  MessageSquare,
  MessagesSquare,
  RefreshCw,
  Settings,
  UserCog,
  UserPlus,
  Users
} from '@lucide/vue';
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import api from '../api.js';
import { formatBytes } from '../composables/useCloudDrive.js';

const router = useRouter();
const loading = ref(false);
const error = ref('');
const refreshedAt = ref(null);
const overview = ref({ site: null, users: [], channels: [], dms: [], driveSummary: { totalFiles: 0, totalBytes: 0 } });

const activeUserCount = computed(
  () => overview.value.users.filter((user) => !user.isDisabled).length
);
const publicChannelCount = computed(
  () => overview.value.channels.filter((channel) => channel.kind === 'public').length
);
const privateChannelCount = computed(
  () => overview.value.channels.filter((channel) => channel.kind === 'private').length
);
const totalMessageCount = computed(() => {
  const channelMessages = overview.value.channels.reduce(
    (total, channel) => total + Number(channel.messageCount || 0),
    0
  );
  const dmMessages = overview.value.dms.reduce(
    (total, dm) => total + Number(dm.messageCount || 0),
    0
  );
  return channelMessages + dmMessages;
});

const metrics = computed(() => [
  { label: '用户', value: overview.value.users.length, icon: Users },
  { label: '群组', value: overview.value.channels.length, icon: MessagesSquare },
  { label: '私信会话', value: overview.value.dms.length, icon: MessageSquare },
  { label: '消息', value: totalMessageCount.value, icon: Activity },
  { label: '云盘文件', value: overview.value.driveSummary?.totalFiles || 0, icon: Folder },
  { label: '云盘总占用', value: formatBytes(overview.value.driveSummary?.totalBytes || 0), icon: Database }
]);

const quickLinks = [
  { label: '用户管理', to: '/admin/users', icon: UserCog },
  { label: '存储统计', to: '/admin/storage', icon: Database },
  { label: '我的云盘', to: '/drive', icon: Folder },
  { label: '创建用户', to: '/admin/invites#create-user', icon: UserPlus },
  { label: '注册链接', to: '/admin/invites#registration-links', icon: Link },
  { label: '网站设置', to: '/admin/site#site-appearance', icon: Settings },
  { label: '返回聊天', to: '/', icon: Home }
];

const refreshedTime = computed(() => {
  if (!refreshedAt.value) {
    return '尚未刷新';
  }
  return refreshedAt.value.toLocaleTimeString('zh-CN', { hour12: false });
});

async function loadOverview() {
  loading.value = true;
  error.value = '';
  try {
    const payload = await api.adminOverview();
    overview.value = {
      site: payload.site || null,
      users: payload.users || [],
      channels: payload.channels || [],
      dms: payload.dms || []
    };
    refreshedAt.value = new Date();
  } catch (currentError) {
    error.value = currentError.message;
  } finally {
    loading.value = false;
  }
}

function navigate(path) {
  void router.push(path);
}

onMounted(loadOverview);
</script>

<template>
  <div class="admin-dashboard">
    <section class="admin-dashboard__metrics" aria-label="站点统计">
      <article v-for="metric in metrics" :key="metric.label" class="admin-dashboard-metric">
        <span class="admin-icon-tile admin-icon-tile--neutral">
          <component :is="metric.icon" :size="21" aria-hidden="true" />
        </span>
        <div>
          <span>{{ metric.label }}</span>
          <strong>{{ loading ? '—' : metric.value }}</strong>
        </div>
      </article>
    </section>

    <section class="admin-dashboard__body">
      <article class="admin-panel admin-quick-panel">
        <header class="admin-panel__header">
          <h2>快捷访问</h2>
        </header>
        <div class="admin-quick-grid">
          <button
            v-for="link in quickLinks"
            :key="`${link.to}-${link.label}`"
            type="button"
            class="admin-quick-link"
            @click="navigate(link.to)"
          >
            <span class="admin-icon-tile">
              <component :is="link.icon" :size="21" aria-hidden="true" />
            </span>
            <span class="admin-quick-link__copy">
              <strong>{{ link.label }}</strong>
            </span>
            <ArrowRight :size="17" aria-hidden="true" />
          </button>
        </div>
      </article>

      <article class="admin-panel admin-status-panel">
        <header class="admin-panel__header admin-panel__header--actions">
          <div>
            <h2>运行概况</h2>
            <p>最近刷新：{{ refreshedTime }}</p>
          </div>
          <button
            type="button"
            class="admin-icon-button"
            :disabled="loading"
            title="刷新数据"
            aria-label="刷新数据"
            @click="loadOverview"
          >
            <RefreshCw :size="18" aria-hidden="true" :class="{ 'admin-spin': loading }" />
          </button>
        </header>

        <div v-if="error" class="admin-dashboard-state admin-dashboard-state--error">
          <Activity :size="28" aria-hidden="true" />
          <strong>概况读取失败</strong>
          <span>{{ error }}</span>
          <button type="button" class="admin-secondary-command" @click="loadOverview">重新加载</button>
        </div>

        <div v-else class="admin-status-list">
          <div class="admin-status-list__item">
            <span class="admin-icon-tile"><Globe2 :size="20" aria-hidden="true" /></span>
            <div>
              <span>站点</span>
              <strong>{{ overview.site?.siteName || 'Edgechat' }}</strong>
            </div>
          </div>
          <div class="admin-status-list__item">
            <span class="admin-icon-tile"><Users :size="20" aria-hidden="true" /></span>
            <div>
              <span>可用账号</span>
              <strong>{{ loading ? '读取中' : `${activeUserCount} / ${overview.users.length}` }}</strong>
            </div>
          </div>
          <div class="admin-status-list__item">
            <span class="admin-icon-tile"><MessagesSquare :size="20" aria-hidden="true" /></span>
            <div>
              <span>群组分布</span>
              <strong>{{ loading ? '读取中' : `公开 ${publicChannelCount} · 私有 ${privateChannelCount}` }}</strong>
            </div>
          </div>
          <div class="admin-status-list__item">
            <span class="admin-icon-tile"><MessageSquare :size="20" aria-hidden="true" /></span>
            <div>
              <span>累计消息</span>
              <strong>{{ loading ? '读取中' : totalMessageCount }}</strong>
            </div>
          </div>
        </div>
      </article>
    </section>
  </div>
</template>

<style scoped src="../styles/admin/dashboard.css"></style>
