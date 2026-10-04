<script setup>
import { CheckSquare, Copy, Download, Folder, Forward, Pencil, Pin, Reply, Trash2 } from '@lucide/vue';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';

const props = defineProps({
  open: { type: Boolean, default: false },
  x: { type: Number, default: 0 },
  y: { type: Number, default: 0 },
  canReply: { type: Boolean, default: true },
  canForward: { type: Boolean, default: true },
  canDownload: { type: Boolean, default: false },
  canEdit: { type: Boolean, default: false },
  canDelete: { type: Boolean, default: false },
  canCopy: { type: Boolean, default: true },
  canPin: { type: Boolean, default: true },
  isPinned: { type: Boolean, default: false },
  isOwn: { type: Boolean, default: false }
});

const emit = defineEmits(['close', 'reply', 'forward', 'download', 'saveToDrive', 'copy', 'edit', 'delete', 'select', 'react', 'pin', 'unpin']);

const menuEl = ref(null);
const firstButtonEl = ref(null);
const quickEmojis = ['👍', '❤️', '😂', '🎉', '🚀', '👀'];

const menuWidth = ref(200);
const menuHeight = ref(380);
const adjustedPos = ref({ x: 0, y: 0 });

const updateMenuPosition = () => {
  if (typeof window === 'undefined') return;
  if (menuEl.value) {
    const rect = menuEl.value.getBoundingClientRect();
    if (rect.width > 0) menuWidth.value = rect.width;
    if (rect.height > 0) menuHeight.value = rect.height;
  }

  const margin = 12;
  const w = menuWidth.value || 200;
  const h = menuHeight.value || 380;

  // Horizontal bounds
  let posX = props.x;
  if (posX + w > window.innerWidth - margin) {
    posX = window.innerWidth - w - margin;
  }
  posX = Math.max(margin, posX);

  // Vertical bounds: if clicking near bottom, flip upwards or clamp within viewport
  let posY = props.y;
  if (posY + h > window.innerHeight - margin) {
    if (props.y - h >= margin) {
      posY = props.y - h;
    } else {
      posY = Math.max(margin, window.innerHeight - h - margin);
    }
  }
  posY = Math.max(margin, posY);

  adjustedPos.value = { x: Math.round(posX), y: Math.round(posY) };
};

const menuStyle = computed(() => {
  const w = menuWidth.value || 200;
  const h = menuHeight.value || 380;
  const x = adjustedPos.value.x || (typeof window !== 'undefined' ? Math.max(12, Math.min(props.x, window.innerWidth - w - 12)) : props.x);
  const y = adjustedPos.value.y || (typeof window !== 'undefined' ? Math.max(12, Math.min(props.y, window.innerHeight - h - 12)) : props.y);
  return {
    left: `${x}px`,
    top: `${y}px`
  };
});

function handleWindowPointerDown(event) {
  if (props.open && !menuEl.value?.contains(event.target)) {
    emit('close');
  }
}

function handleWindowContextMenu(event) {
  if (props.open && menuEl.value?.contains(event.target)) {
    event.preventDefault();
    event.stopPropagation();
  }
}

function handleWindowKeydown(event) {
  if (props.open && event.key === 'Escape') {
    emit('close');
  }
}

function closeOpenMenu() {
  if (props.open) {
    emit('close');
  }
}

function handleQuickReact(emoji) {
  emit('react', emoji);
  emit('close');
}

function handleTogglePin() {
  if (props.isPinned) {
    emit('unpin');
  } else {
    emit('pin');
  }
  emit('close');
}

watch(
  () => [props.open, props.x, props.y],
  async ([open]) => {
    if (open) {
      adjustedPos.value = { x: 0, y: 0 };
      await nextTick();
      updateMenuPosition();
      firstButtonEl.value?.focus();
    }
  },
  { immediate: true }
);

onMounted(() => {
  window.addEventListener('pointerdown', handleWindowPointerDown);
  window.addEventListener('contextmenu', handleWindowContextMenu);
  window.addEventListener('keydown', handleWindowKeydown);
  window.addEventListener('resize', closeOpenMenu);
  window.addEventListener('scroll', closeOpenMenu, true);
});

onBeforeUnmount(() => {
  window.removeEventListener('pointerdown', handleWindowPointerDown);
  window.removeEventListener('contextmenu', handleWindowContextMenu);
  window.removeEventListener('keydown', handleWindowKeydown);
  window.removeEventListener('resize', closeOpenMenu);
  window.removeEventListener('scroll', closeOpenMenu, true);
});
</script>

<template>
  <Teleport to="body">
    <Transition name="message-menu">
      <div
        v-if="open"
        ref="menuEl"
        class="message-context-menu"
        :style="menuStyle"
        role="menu"
        aria-label="消息操作"
        @contextmenu.prevent.stop
      >
        <!-- Quick Emoji Reaction Bar -->
        <div class="quick-reactions-bar">
          <button
            v-for="emoji in quickEmojis"
            :key="emoji"
            type="button"
            class="quick-emoji-btn"
            :title="`表态 ${emoji}`"
            @click="handleQuickReact(emoji)"
          >
            {{ emoji }}
          </button>
        </div>

        <div class="message-context-menu__divider" />

        <button
          v-if="canReply"
          ref="firstButtonEl"
          type="button"
          class="message-context-menu__item message-context-menu__item--reply"
          role="menuitem"
          @click="emit('reply')"
        >
          <Reply :size="16" :stroke-width="1.8" aria-hidden="true" />
          <span>回复 / 引用</span>
        </button>

        <button
          v-if="canForward"
          type="button"
          class="message-context-menu__item message-context-menu__item--forward"
          role="menuitem"
          @click="emit('forward')"
        >
          <Forward :size="16" :stroke-width="1.8" aria-hidden="true" />
          <span>转发消息</span>
        </button>

        <button
          v-if="canPin"
          type="button"
          class="message-context-menu__item"
          role="menuitem"
          @click="handleTogglePin"
        >
          <Pin :size="16" :stroke-width="1.8" aria-hidden="true" />
          <span>{{ isPinned ? '取消置顶' : '置顶消息' }}</span>
        </button>

        <button
          v-if="canDownload"
          type="button"
          class="message-context-menu__item message-context-menu__item--download"
          role="menuitem"
          @click="emit('download')"
        >
          <Download :size="16" :stroke-width="1.8" aria-hidden="true" />
          <span>下载附件</span>
        </button>

        <button
          v-if="canDownload"
          type="button"
          class="message-context-menu__item"
          role="menuitem"
          @click="emit('saveToDrive')"
        >
          <Folder :size="16" :stroke-width="1.8" aria-hidden="true" />
          <span>转存到云盘</span>
        </button>

        <button
          v-if="canCopy"
          type="button"
          class="message-context-menu__item"
          role="menuitem"
          @click="emit('copy')"
        >
          <Copy :size="16" :stroke-width="1.8" aria-hidden="true" />
          <span>复制文本</span>
        </button>

        <button
          v-if="canEdit"
          type="button"
          class="message-context-menu__item message-context-menu__item--edit"
          role="menuitem"
          @click="emit('edit')"
        >
          <Pencil :size="16" :stroke-width="1.8" aria-hidden="true" />
          <span>编辑消息</span>
        </button>

        <button
          type="button"
          class="message-context-menu__item message-context-menu__item--select"
          role="menuitem"
          @click="emit('select')"
        >
          <CheckSquare :size="16" :stroke-width="1.8" aria-hidden="true" />
          <span>多选消息</span>
        </button>

        <div class="message-context-menu__divider" />

        <button
          v-if="canDelete"
          type="button"
          class="message-context-menu__item message-context-menu__item--danger"
          role="menuitem"
          @click="emit('delete')"
        >
          <Trash2 :size="16" :stroke-width="1.8" aria-hidden="true" />
          <span>{{ isOwn ? '撤回 / 删除' : '删除消息' }}</span>
        </button>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.message-context-menu {
  position: fixed;
  z-index: 1000;
  min-width: 180px;
  max-height: calc(100vh - 24px);
  overflow-y: auto;
  padding: 6px;
  border: 1px solid rgba(11, 20, 26, 0.08);
  border-radius: 12px;
  background: var(--surface, #ffffff);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15), 0 2px 6px rgba(0, 0, 0, 0.06);
}

.quick-reactions-bar {
  display: flex;
  align-items: center;
  justify-content: space-around;
  padding: 4px 6px;
  gap: 4px;
}

.quick-emoji-btn {
  background: transparent;
  border: none;
  font-size: 1.25rem;
  cursor: pointer;
  padding: 4px;
  border-radius: 8px;
  transition: all 0.15s ease;
  line-height: 1;
}

.quick-emoji-btn:hover {
  background: var(--surface-2, #f1f5f9);
  transform: scale(1.25);
}

.message-context-menu__item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 7px 10px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text, #111b21);
  font-size: 0.84rem;
  font-family: inherit;
  cursor: pointer;
  text-align: left;
  transition: background-color 0.12s ease, color 0.12s ease;
}

.message-context-menu__item:hover,
.message-context-menu__item:focus-visible {
  background-color: var(--surface-2, #f0f2f5);
  outline: none;
}

.message-context-menu__item--danger {
  color: #ea0038;
}

.message-context-menu__item--danger:hover,
.message-context-menu__item--danger:focus-visible {
  background-color: rgba(234, 0, 56, 0.08);
}

.message-context-menu__divider {
  height: 1px;
  margin: 4px 0;
  background-color: var(--border, #e9edef);
}

.message-menu-enter-active,
.message-menu-leave-active {
  transition: opacity 0.12s ease, transform 0.12s ease;
}

.message-menu-enter-from,
.message-menu-leave-to {
  opacity: 0;
  transform: scale(0.95);
}
</style>

