<script setup>
import { useRouter } from 'vue-router';
import { getQuickReplies } from '../../quick-replies.js';

const emit = defineEmits(['select', 'close']);
const router = useRouter();

const replies = getQuickReplies();

function handleSelect(text) {
  emit('select', text);
}

function goToSettings() {
  emit('close');
  void router.push('/settings#quick-replies');
}
</script>

<template>
  <div class="quick-reply-picker" @click.stop>
    <div class="quick-reply-picker__header">
      <span>⚡ 快捷回复</span>
      <button type="button" class="quick-reply-manage-link" @click="goToSettings">
        自定义管理
      </button>
    </div>

    <div class="quick-reply-list">
      <button
        v-for="item in replies"
        :key="item.id"
        type="button"
        class="quick-reply-item"
        @click="handleSelect(item.text)"
      >
        <span>{{ item.text }}</span>
      </button>
      <p v-if="!replies.length" class="quick-reply-empty">暂无快捷回复，可前往设置添加</p>
    </div>
  </div>
</template>

<style scoped>
.quick-reply-picker {
  width: 280px;
  max-width: 90vw;
  background: #ffffff;
  border-radius: 12px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.15), 0 1px 3px rgba(0, 0, 0, 0.08);
  border: 1px solid #e2e8f0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  user-select: none;
  z-index: 100;
}

.quick-reply-picker__header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  background: #f8fafc;
  border-bottom: 1px solid #f1f5f9;
  font-size: 12.5px;
  font-weight: 600;
  color: #1e293b;
}

.quick-reply-manage-link {
  border: none;
  background: transparent;
  color: #0284c7;
  font-size: 11.5px;
  cursor: pointer;
  padding: 2px 4px;
}

.quick-reply-manage-link:hover {
  text-decoration: underline;
}

.quick-reply-list {
  max-height: 240px;
  overflow-y: auto;
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.quick-reply-item {
  display: flex;
  align-items: center;
  width: 100%;
  padding: 8px 10px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  text-align: left;
  font-size: 13px;
  color: #334155;
  cursor: pointer;
  transition: all 0.15s ease;
}

.quick-reply-item:hover {
  background: #f0fdf4;
  border-color: #bbf7d0;
  color: #008069;
}

.quick-reply-empty {
  margin: 16px;
  text-align: center;
  font-size: 12px;
  color: #94a3b8;
}
</style>
