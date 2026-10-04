<script setup>
import { ArrowDown, ArrowUp, ChevronsUpDown, RefreshCw } from '@lucide/vue';
import { computed, ref } from 'vue';
import api from '../api.js';
import UiButton from '../components/ui/Button.vue';
import UiSurface from '../components/ui/Surface.vue';
import {
  buildStorageRows,
  formatByteSize,
  formatStorageDateTime,
  mergeStorageSummary,
  sortStorageRows
} from '../storage-statistics.js';

const loading = ref(false);
const error = ref('');
const hasResult = ref(false);
const users = ref([]);
const summaries = ref(new Map());
const refreshedAt = ref(null);
const sort = ref({ key: 'bytes', direction: 'desc' });

const rows = computed(() => buildStorageRows(users.value, summaries.value));
const sortedRows = computed(() => sortStorageRows(rows.value, sort.value));
const totalBytes = computed(() => rows.value.reduce((total, row) => total + row.bytes, 0));
const totalObjects = computed(() => rows.value.reduce((total, row) => total + row.objectCount, 0));
const occupiedUsers = computed(
  () => rows.value.filter((row) => row.ownerKey.startsWith('user:') && row.bytes > 0).length
);

const columns = [
  { key: 'objectCount', label: '文件数量' },
  { key: 'bytes', label: '实际占用' },
  { key: 'share', label: '占总量比例' },
  { key: 'latestUploadedAt', label: '最近上传' }
];

async function refreshStorage() {
  loading.value = true;
  error.value = '';
  const nextSummaries = new Map();
  const seenCursors = new Set();
  let cursor = '';
  let nextUsers = [];

  try {
    do {
      const payload = await api.adminStorageScan(cursor);
      if (!cursor) {
        nextUsers = payload.users || [];
      }
      mergeStorageSummary(nextSummaries, payload.items);

      if (!payload.truncated) {
        cursor = '';
        break;
      }
      if (!payload.cursor || seenCursors.has(payload.cursor)) {
        throw new Error('R2 分页游标异常，请重试');
      }
      seenCursors.add(payload.cursor);
      cursor = payload.cursor;
    } while (cursor);

    users.value = nextUsers;
    summaries.value = nextSummaries;
    refreshedAt.value = new Date();
    hasResult.value = true;
  } catch (currentError) {
    error.value = currentError.message;
  } finally {
    loading.value = false;
  }
}

function changeSort(key) {
  sort.value = {
    key,
    direction: sort.value.key === key && sort.value.direction === 'desc' ? 'asc' : 'desc'
  };
}

function sortIcon(key) {
  if (sort.value.key !== key) return ChevronsUpDown;
  return sort.value.direction === 'asc' ? ArrowUp : ArrowDown;
}

function ariaSort(key) {
  if (sort.value.key !== key) return 'none';
  return sort.value.direction === 'asc' ? 'ascending' : 'descending';
}

function formatShare(value) {
  return `${(Number(value || 0) * 100).toFixed(value > 0 && value < 0.001 ? 2 : 1)}%`;
}
</script>

<template>
  <div class="admin-section admin-storage-page">
    <header class="admin-section__header">
      <div class="admin-section__heading">
        <h2>存储统计</h2>
        <p>按用户统计 R2 中当前实际存在的文件与占用空间。</p>
      </div>
      <UiButton variant="secondary" :disabled="loading" @click="refreshStorage">
        <RefreshCw :size="17" aria-hidden="true" :class="{ 'admin-spin': loading }" />
        {{ loading ? '刷新中...' : '刷新' }}
      </UiButton>
    </header>

    <div class="admin-section__body">
      <p v-if="error" class="error-text">{{ error }}</p>

      <template v-if="hasResult">
        <section class="admin-metric-grid" aria-label="R2 存储汇总">
          <UiSurface class="admin-metric-card">
            <span>当前总占用</span>
            <strong>{{ formatByteSize(totalBytes) }}</strong>
          </UiSurface>
          <UiSurface class="admin-metric-card">
            <span>文件总数</span>
            <strong>{{ totalObjects }}</strong>
          </UiSurface>
          <UiSurface class="admin-metric-card">
            <span>有占用用户</span>
            <strong>{{ occupiedUsers }}</strong>
          </UiSurface>
          <UiSurface class="admin-metric-card">
            <span>最后刷新</span>
            <strong class="admin-storage-page__refresh-time">
              {{ formatStorageDateTime(refreshedAt) }}
            </strong>
          </UiSurface>
        </section>

        <UiSurface class="panel panel--table">
          <h3 class="panel-title">用户存储情况</h3>
          <div class="admin-table-wrap">
            <table class="list-table admin-storage-table">
              <thead>
                <tr>
                  <th>用户</th>
                  <th v-for="column in columns" :key="column.key" :aria-sort="ariaSort(column.key)">
                    <button type="button" class="admin-sort-button" @click="changeSort(column.key)">
                      {{ column.label }}
                      <component :is="sortIcon(column.key)" :size="15" aria-hidden="true" />
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in sortedRows" :key="row.ownerKey">
                  <td>
                    <strong>{{ row.displayName }}</strong>
                    <div v-if="row.username" class="muted">
                      @{{ row.username }}<span v-if="row.isDeleted"> · 已删除</span>
                    </div>
                  </td>
                  <td>{{ row.objectCount }}</td>
                  <td>{{ formatByteSize(row.bytes) }}</td>
                  <td>{{ formatShare(row.share) }}</td>
                  <td>{{ formatStorageDateTime(row.latestUploadedAt) || '-' }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </UiSurface>
      </template>
    </div>
  </div>
</template>
