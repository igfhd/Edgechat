<script setup>
import { nextTick, onMounted, ref, useAttrs, watch } from 'vue';

const props = defineProps({
  modelValue: {
    type: String,
    default: ''
  },
  autoGrow: {
    type: Boolean,
    default: false
  },
  maxHeight: {
    type: Number,
    default: 0
  }
});

const emit = defineEmits(['update:modelValue']);
const attrs = useAttrs();
const textareaEl = ref(null);

function syncHeight() {
  if (!props.autoGrow || !textareaEl.value) return;
  const el = textareaEl.value;
  if (!el.value) {
    el.style.height = '';
    el.style.overflowY = 'hidden';
    return;
  }
  textareaEl.value.style.height = 'auto';
  const nextHeight = props.maxHeight > 0 ? Math.min(textareaEl.value.scrollHeight, props.maxHeight) : textareaEl.value.scrollHeight;
  textareaEl.value.style.height = `${nextHeight}px`;
  textareaEl.value.style.overflowY = props.maxHeight > 0 && textareaEl.value.scrollHeight > props.maxHeight ? 'auto' : 'hidden';
}

function handleInput(event) {
  emit('update:modelValue', event.target.value);
  syncHeight();
}

watch(() => props.modelValue, () => nextTick(syncHeight));
onMounted(syncHeight);

function insertTextAtCursor(prefix, suffix = '', defaultText = '') {
  const el = textareaEl.value;
  if (!el) return;
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? el.value.length;
  const original = el.value || '';
  const selected = original.substring(start, end) || defaultText;
  const replacement = prefix + selected + suffix;
  const nextValue = original.substring(0, start) + replacement + original.substring(end);
  emit('update:modelValue', nextValue);
  nextTick(() => {
    el.focus();
    const newCursorStart = start + prefix.length;
    const newCursorEnd = newCursorStart + selected.length;
    el.setSelectionRange(newCursorStart, newCursorEnd);
    syncHeight();
  });
}

function insertEmoji(emoji) {
  insertTextAtCursor(emoji, '', '');
}

function replaceMentionAtCursor(insertText) {
  const el = textareaEl.value;
  if (!el) return;
  const cursor = el.selectionStart ?? el.value.length;
  const textBefore = (el.value || '').substring(0, cursor);
  const textAfter = (el.value || '').substring(cursor);

  const lastAtIndex = textBefore.lastIndexOf('@');
  if (lastAtIndex === -1) {
    insertTextAtCursor(insertText, '', '');
    return;
  }

  const prefix = textBefore.substring(0, lastAtIndex);
  const nextValue = prefix + insertText + textAfter;
  emit('update:modelValue', nextValue);
  nextTick(() => {
    el.focus();
    const newCursor = prefix.length + insertText.length;
    el.setSelectionRange(newCursor, newCursor);
    syncHeight();
  });
}

defineExpose({
  textareaEl,
  focus: () => textareaEl.value?.focus(),
  insertTextAtCursor,
  insertEmoji,
  replaceMentionAtCursor,
  syncHeight
});
</script>

<template>
  <textarea
    ref="textareaEl"
    class="ui-textarea"
    v-bind="attrs"
    :value="modelValue"
    @input="handleInput"
  ></textarea>
</template>
