<script setup>
import { computed } from 'vue';
import { renderMarkdown } from '../../markdown.js';

const props = defineProps({
  content: {
    type: String,
    default: ''
  }
});

const emit = defineEmits(['jump-to-message']);

const renderedHtml = computed(() => renderMarkdown(props.content));

async function handleContentClick(event) {
  const target = event.target;
  if (!target) return;

  const replyLink = target.closest('.md-reply-link') || target.closest('[data-msg-id]');
  if (replyLink) {
    const msgId = replyLink.getAttribute('data-msg-id');
    if (msgId) {
      event.preventDefault();
      event.stopPropagation();
      emit('jump-to-message', Number(msgId));
      return;
    }
  }

  const replyBlock = target.closest('.md-blockquote--reply');
  if (replyBlock) {
    const link = replyBlock.querySelector('.md-reply-link') || replyBlock.querySelector('[data-msg-id]');
    const msgId = link?.getAttribute('data-msg-id');
    if (msgId) {
      event.preventDefault();
      event.stopPropagation();
      emit('jump-to-message', Number(msgId));
      return;
    }
  }

  if (target.classList.contains('md-copy-btn')) {
    const encoded = target.getAttribute('data-code');
    if (encoded) {
      try {
        const rawCode = decodeURIComponent(encoded);
        await navigator.clipboard.writeText(rawCode);
        const originalText = target.innerText;
        target.innerText = '已复制 ✓';
        target.classList.add('md-copy-btn--copied');
        setTimeout(() => {
          target.innerText = originalText;
          target.classList.remove('md-copy-btn--copied');
        }, 2000);
      } catch (err) {
        console.warn('Failed to copy code:', err);
      }
    }
  }
}
</script>

<template>
  <div class="markdown-body" v-html="renderedHtml" @click="handleContentClick"></div>
</template>

<style>
/* Markdown styles inside message bubble */
.markdown-body {
  font-size: var(--chat-font-size, 15px);
  line-height: var(--chat-line-height, 1.45);
  color: inherit;
  word-break: break-word;
}

.markdown-body p {
  margin: 0 0 4px;
}

.markdown-body p:last-child {
  margin-bottom: 0;
}

.markdown-body strong {
  font-weight: 700;
}

.markdown-body em {
  font-style: italic;
}

.markdown-body del {
  text-decoration: line-through;
  opacity: 0.75;
}

.markdown-body .md-inline-code {
  padding: 2px 5px;
  margin: 0 2px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: calc(var(--chat-font-size, 15px) * 0.86);
  background: rgba(0, 0, 0, 0.08);
  border-radius: 4px;
  color: #c2410c;
}

.message-row--own .markdown-body .md-inline-code {
  background: rgba(0, 0, 0, 0.12);
  color: #9a3412;
}

.markdown-body .md-code-block {
  margin: 8px 0;
  padding: 0;
  background: #1e293b;
  color: #f8fafc;
  border-radius: 8px;
  overflow: hidden;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: calc(var(--chat-font-size, 15px) * 0.88);
  line-height: 1.45;
}

.markdown-body .md-code-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 5px 10px;
  background: #0f172a;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  font-size: 11px;
  color: #94a3b8;
  text-transform: uppercase;
}

.markdown-body .md-copy-btn {
  padding: 2px 8px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  background: rgba(255, 255, 255, 0.1);
  color: #cbd5e1;
  border-radius: 4px;
  font-size: 11px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.markdown-body .md-copy-btn:hover {
  background: rgba(255, 255, 255, 0.2);
  color: #ffffff;
}

.markdown-body .md-copy-btn--copied {
  background: #059669 !important;
  color: #ffffff !important;
  border-color: #059669 !important;
}

.markdown-body .md-code-block code {
  display: block;
  padding: 10px 12px;
  overflow-x: auto;
  white-space: pre;
}

.markdown-body .md-blockquote {
  margin: 3px 0;
  padding: 2px 8px;
  border-left: 3px solid #008069;
  background: rgba(0, 128, 105, 0.06);
  border-radius: 0 4px 4px 0;
  color: #475569;
  font-style: normal;
}

.markdown-body .md-blockquote--reply {
  margin: 1px 0 3px;
  padding: 3px 8px;
  border-left: 3px solid #008069;
  border-radius: 4px;
  background: rgba(0, 128, 105, 0.08);
  font-size: calc(var(--chat-font-size, 15px) * 0.88);
  line-height: 1.35;
  cursor: pointer;
  transition: all 0.15s ease;
}

.markdown-body .md-blockquote--reply:hover {
  background: rgba(0, 128, 105, 0.15);
}

.markdown-body .md-reply-link {
  color: #008069;
  font-weight: 600;
  text-decoration: none;
  border-bottom: 1px dashed rgba(0, 128, 105, 0.4);
  cursor: pointer;
}

.markdown-body .md-reply-link:hover {
  color: #065f46;
  border-bottom-style: solid;
}

.markdown-body .md-list {
  margin: 4px 0;
  padding-left: 20px;
}

.markdown-body .md-list li {
  margin-bottom: 2px;
}

.markdown-body .md-task-item {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 3px 0;
}

.markdown-body .md-checkbox {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  border: 1.5px solid #64748b;
  border-radius: 3px;
  font-size: 10px;
}

.markdown-body .md-checkbox--checked {
  background: #008069;
  border-color: #008069;
  color: #fff;
}

.markdown-body .md-task-done {
  text-decoration: line-through;
  opacity: 0.7;
}

.markdown-body .md-heading {
  margin: 8px 0 4px;
  font-weight: 700;
  color: #0f172a;
}

.markdown-body h3.md-heading { font-size: calc(var(--chat-font-size, 15px) * 1.15); }
.markdown-body h4.md-heading { font-size: calc(var(--chat-font-size, 15px) * 1.05); }
.markdown-body h5.md-heading { font-size: var(--chat-font-size, 15px); }
.markdown-body h6.md-heading { font-size: calc(var(--chat-font-size, 15px) * 0.9); }

.markdown-body .md-table-wrap {
  margin: 8px 0;
  overflow-x: auto;
  max-width: 100%;
}

.markdown-body .md-table {
  border-collapse: collapse;
  width: 100%;
  font-size: 13px;
}

.markdown-body .md-table th,
.markdown-body .md-table td {
  padding: 6px 10px;
  border: 1px solid rgba(0, 0, 0, 0.12);
  text-align: left;
}

.markdown-body .md-table th {
  background: rgba(0, 0, 0, 0.05);
  font-weight: 600;
}

.markdown-body .md-link {
  color: #0284c7;
  text-decoration: underline;
  word-break: break-all;
}

.markdown-body .md-link:hover {
  color: #0369a1;
}

.markdown-body .md-hr {
  margin: 8px 0;
  border: 0;
  border-top: 1px dashed rgba(0, 0, 0, 0.2);
}

.markdown-body .mention-pill {
  display: inline-flex;
  align-items: center;
  padding: 0px 6px;
  margin: 0 2px;
  border-radius: 999px;
  background: rgba(0, 128, 105, 0.12);
  color: #008069;
  font-weight: 600;
  font-size: 13px;
  line-height: 1.4;
  vertical-align: baseline;
  user-select: all;
  transition: background 0.15s ease;
}

.markdown-body .mention-pill:hover {
  background: rgba(0, 128, 105, 0.22);
}

.markdown-body .mention-pill--all {
  background: rgba(234, 88, 12, 0.14);
  color: #c2410c;
}

.markdown-body .mention-pill--all:hover {
  background: rgba(234, 88, 12, 0.24);
}

.message-row--own .markdown-body .mention-pill {
  background: rgba(0, 128, 105, 0.2);
  color: #065f46;
}

.message-row--own .markdown-body .mention-pill--all {
  background: rgba(194, 65, 12, 0.2);
  color: #7c2d12;
}
</style>
