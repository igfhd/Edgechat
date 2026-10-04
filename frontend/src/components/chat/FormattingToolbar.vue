<script setup>
const emit = defineEmits(['format']);

function applyFormat(prefix, suffix = '', defaultText = '') {
  emit('format', { prefix, suffix, defaultText });
}
</script>

<template>
  <div class="formatting-toolbar" role="toolbar" aria-label="文字格式工具栏" @click.stop>
    <button
      type="button"
      class="fmt-btn"
      title="加粗 (**文字**)"
      aria-label="加粗"
      @pointerdown.prevent="applyFormat('**', '**', '加粗文字')"
    >
      <strong>B</strong>
    </button>
    <button
      type="button"
      class="fmt-btn"
      title="斜体 (*文字*)"
      aria-label="斜体"
      @pointerdown.prevent="applyFormat('*', '*', '斜体文字')"
    >
      <em>I</em>
    </button>
    <button
      type="button"
      class="fmt-btn"
      title="删除线 (~~文字~~)"
      aria-label="删除线"
      @pointerdown.prevent="applyFormat('~~', '~~', '删除线文字')"
    >
      <del>S</del>
    </button>
    <span class="fmt-divider"></span>
    <button
      type="button"
      class="fmt-btn fmt-btn--mono"
      title="行内代码 (`代码`)"
      aria-label="行内代码"
      @pointerdown.prevent="applyFormat('`', '`', 'code')"
    >
      &lt;/&gt;
    </button>
    <button
      type="button"
      class="fmt-btn"
      title="代码块 (```代码```)"
      aria-label="代码块"
      @pointerdown.prevent="applyFormat('```\n', '\n```', '代码内容')"
    >
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <polyline points="16 18 22 12 16 6"/>
        <polyline points="8 6 2 12 8 18"/>
      </svg>
    </button>
    <button
      type="button"
      class="fmt-btn"
      title="引用 (> 引用)"
      aria-label="引用"
      @pointerdown.prevent="applyFormat('> ', '', '引用内容')"
    >
      ❝
    </button>
    <span class="fmt-divider"></span>
    <button
      type="button"
      class="fmt-btn"
      title="无序列表 (- 列表项)"
      aria-label="无序列表"
      @pointerdown.prevent="applyFormat('- ', '', '列表项目')"
    >
      •≡
    </button>
    <button
      type="button"
      class="fmt-btn"
      title="有序列表 (1. 列表项)"
      aria-label="有序列表"
      @pointerdown.prevent="applyFormat('1. ', '', '列表项目')"
    >
      1.
    </button>
    <button
      type="button"
      class="fmt-btn"
      title="插入链接 ([标题](网址))"
      aria-label="插入链接"
      @pointerdown.prevent="applyFormat('[', '](https://)', '链接标题')"
    >
      🔗
    </button>
  </div>
</template>

<style scoped>
.formatting-toolbar {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 4px 8px;
  background: #1e293b;
  color: #f8fafc;
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 10px;
  box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.35), 0 8px 10px -6px rgba(0, 0, 0, 0.2);
  user-select: none;
  backdrop-filter: blur(12px);
  animation: popIn 0.15s cubic-bezier(0.16, 1, 0.3, 1);
}

.fmt-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 28px;
  height: 28px;
  padding: 0 6px;
  border: none;
  background: transparent;
  border-radius: 6px;
  font-size: 13px;
  color: #cbd5e1;
  cursor: pointer;
  transition: all 0.12s ease;
}

.fmt-btn:hover {
  background: rgba(255, 255, 255, 0.18);
  color: #ffffff;
  transform: translateY(-1px);
}

.fmt-btn strong { font-weight: 800; font-family: serif; font-size: 14px; }
.fmt-btn em { font-style: italic; font-family: serif; font-size: 14px; }
.fmt-btn del { font-size: 13px; }
.fmt-btn--mono { font-family: monospace; font-size: 12px; font-weight: bold; }

.fmt-divider {
  width: 1px;
  height: 16px;
  background: rgba(255, 255, 255, 0.2);
  margin: 0 3px;
}

@keyframes popIn {
  from {
    opacity: 0;
    transform: scale(0.95) translateY(4px);
  }
  to {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
}
</style>
