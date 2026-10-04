<script setup>
import { computed } from 'vue';
import api from '../../api.js';
import UiBadge from '../ui/Badge.vue';
import UiButton from '../ui/Button.vue';
import { isPreviewableImageAttachment } from './attachment-utils.js';
import { formatBytes } from '../../composables/useCloudDrive.js';

const props = defineProps({
  attachment: {
    type: Object,
    required: true
  }
});

const emit = defineEmits(['clear']);
const isImage = computed(() => isPreviewableImageAttachment(props.attachment));
const displayName = computed(() => props.attachment?.name || '附件');
const sizeDisplay = computed(() => {
  const size = props.attachment?.size;
  return Number.isFinite(size) && size > 0 ? ` (${formatBytes(size)})` : '';
});
const attachmentUrl = computed(() => api.getFileUrl(props.attachment?.key || props.attachment?.url));
</script>

<template>
  <div class="pending-attachment" :class="{ 'pending-attachment--image': isImage }">
    <img
      v-if="isImage"
      class="pending-attachment__thumb"
      :src="attachmentUrl"
      :alt="displayName"
      loading="lazy"
    />
    <UiBadge class="pending-attachment__name" variant="secondary">{{ displayName }}{{ sizeDisplay }}</UiBadge>
    <UiButton class="pending-attachment__clear" variant="ghost" size="sm" @click="emit('clear')">移除</UiButton>
  </div>
</template>
