<script setup>
import { computed, ref, watch } from 'vue';
import api from '../../api.js';

const props = defineProps({
  src: {
    type: String,
    default: ''
  },
  alt: {
    type: String,
    default: ''
  },
  fallback: {
    type: String,
    default: '?'
  },
  size: {
    type: String,
    default: 'default'
  },
  showPresence: {
    type: Boolean,
    default: false
  },
  isOnline: {
    type: Boolean,
    default: false
  }
});

const initials = computed(() => String(props.fallback || '?').slice(0, 2).toUpperCase());
const failedSrc = ref('');

watch(
  () => props.src,
  () => {
    failedSrc.value = '';
  }
);

const resolvedSrc = computed(() => {
  if (!props.src) return '';
  if (typeof api.getFileUrl === 'function') {
    return api.getFileUrl(props.src);
  }
  if (typeof api.fileUrl === 'function') {
    return api.fileUrl(props.src);
  }
  return props.src;
});
const showImage = computed(() => Boolean(props.src) && failedSrc.value !== props.src);

function handleImageError() {
  failedSrc.value = props.src;
}
</script>

<template>
  <div class="ui-avatar" :class="`ui-avatar--${size}`">
    <div class="ui-avatar__inner">
      <img v-if="showImage" :src="resolvedSrc" :alt="alt" @error="handleImageError" />
      <span v-else>{{ initials }}</span>
    </div>
    <span
      v-if="showPresence"
      class="ui-avatar__presence"
      :class="isOnline ? 'ui-avatar__presence--online' : 'ui-avatar__presence--offline'"
      :title="isOnline ? '在线' : '离线'"
    />
  </div>
</template>
