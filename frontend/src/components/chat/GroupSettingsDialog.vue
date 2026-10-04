<script setup>
import { ref, toRef } from 'vue';
import { useOverlayLifecycle } from '../../composables/useOverlayLifecycle.js';
import UiAvatar from '../ui/Avatar.vue';
import { isCapacitorAndroid, pickNativeFile } from '../../capacitor-platform.js';

const props = defineProps({
  show: { type: Boolean, default: false },
  room: { type: Object, default: null },
  form: { type: Object, required: true },
  saving: { type: Boolean, default: false },
  avatarUploading: { type: Boolean, default: false },
  isAdmin: { type: Boolean, default: false }
});

const emit = defineEmits(['close', 'upload-avatar', 'save', 'toggle-mute']);
const avatarInput = ref(null);
const nameInputEl = ref(null);

useOverlayLifecycle({
  open: toRef(props, 'show'),
  onClose: () => emit('close'),
  focusTarget: nameInputEl
});

async function openAvatarPicker() {
  if (isCapacitorAndroid) {
    const file = await pickNativeFile('image/*');
    if (file) emit('upload-avatar', { target: { files: [file] } });
    return;
  }
  avatarInput.value?.click();
}
</script>

<template>
  <Transition name="modal-fade">
    <div v-if="show" class="room-dialog-overlay" @click.self="emit('close')">
      <section class="room-dialog" role="dialog" aria-modal="true" aria-labelledby="group-settings-title">
        <h2 id="group-settings-title">群组设置</h2>

        <div class="room-dialog__avatar-row">
          <UiAvatar :src="form.avatarUrl" :fallback="room?.name?.[0] || '?'" />
          <input ref="avatarInput" type="file" class="room-dialog__file" accept="image/*" @change="emit('upload-avatar', $event)" />
          <button type="button" class="room-dialog__secondary" :disabled="avatarUploading" @click="openAvatarPicker">
            {{ avatarUploading ? '上传中...' : '更换头像' }}
          </button>
        </div>

        <label class="room-dialog__field">
          <span>群组名称</span>
          <input ref="nameInputEl" v-model="form.name" type="text" class="room-dialog__input" :disabled="room?.isGeneral" />
        </label>

        <div v-if="room?.isGeneral && isAdmin" class="room-dialog__mute-card">
          <div class="room-dialog__mute-info">
            <strong>全员禁言（仅管理员可发言）</strong>
            <p>{{ room?.isMuted ? '当前处于全员禁言状态，普通用户无法发送消息' : '当前全员可发言，开启后普通用户将被禁言' }}</p>
          </div>
          <button
            type="button"
            class="ui-toggle-switch"
            :class="{ 'ui-toggle-switch--on': room?.isMuted }"
            :aria-checked="room?.isMuted"
            @click="emit('toggle-mute')"
          >
            <span class="toggle-handle"></span>
          </button>
        </div>

        <div class="room-dialog__actions">
          <button type="button" class="room-dialog__secondary" @click="emit('close')">取消</button>
          <button type="button" class="room-dialog__primary" :disabled="!form.name.trim() || saving" @click="emit('save')">
            {{ saving ? '保存中...' : '保存' }}
          </button>
        </div>
      </section>
    </div>
  </Transition>
</template>

<style scoped>
.room-dialog-overlay {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  padding:
    max(16px, env(safe-area-inset-top))
    max(16px, env(safe-area-inset-right))
    max(16px, env(safe-area-inset-bottom))
    max(16px, env(safe-area-inset-left));
  background: rgba(0, 0, 0, 0.4);
}
.room-dialog { width: min(420px, 100%); max-height: calc(100dvh - 32px); overflow-y: auto; padding: 24px; border-radius: 16px; background: #fff; box-shadow: 0 20px 60px rgba(0, 0, 0, 0.15); }
.room-dialog h2 { margin: 0 0 20px; font-size: 18px; color: #111b21; }
.room-dialog__avatar-row { display: flex; align-items: center; gap: 12px; margin-bottom: 20px; }
.room-dialog__file {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
  opacity: 0;
  pointer-events: none;
}
.room-dialog__field { display: grid; gap: 8px; color: #6b7c93; font-size: 13px; }
.room-dialog__input { width: 100%; min-height: 44px; padding: 10px 14px; border: 1px solid #e8ecf0; border-radius: 8px; background: #f9fafb; font-size: 16px; }
.room-dialog__mute-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 16px;
  padding: 12px 14px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
}
.room-dialog__mute-info strong {
  display: block;
  font-size: 13.5px;
  color: #0f172a;
}
.room-dialog__mute-info p {
  margin: 2px 0 0;
  font-size: 12px;
  color: #64748b;
}
.ui-toggle-switch {
  position: relative;
  width: 44px;
  height: 24px;
  border-radius: 999px;
  background: #cbd5e1;
  border: none;
  cursor: pointer;
  padding: 2px;
  transition: background-color 0.2s ease;
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
}
.ui-toggle-switch--on {
  background: #008069;
}
.toggle-handle {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #ffffff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
  transition: transform 0.2s ease;
  transform: translateX(0);
}
.ui-toggle-switch--on .toggle-handle {
  transform: translateX(20px);
}
.room-dialog__actions { display: flex; justify-content: flex-end; gap: 12px; margin-top: 24px; }
.room-dialog__secondary, .room-dialog__primary { min-height: 44px; padding: 10px 20px; border-radius: 8px; cursor: pointer; touch-action: manipulation; }
.room-dialog__secondary { border: 1px solid #e8ecf0; background: #fff; }
.room-dialog__primary { border: 0; background: #008069; color: #fff; }
.room-dialog__primary:disabled, .room-dialog__secondary:disabled { cursor: not-allowed; opacity: 0.55; }
.modal-fade-enter-active { transition: opacity 200ms; }
.modal-fade-leave-active { transition: opacity 150ms; }
.modal-fade-enter-from, .modal-fade-leave-to { opacity: 0; }

@media (max-width: 480px) {
  .room-dialog-overlay {
    align-items: flex-end;
    padding: env(safe-area-inset-top) 0 0;
  }

  .room-dialog {
    width: 100%;
    max-height: calc(100dvh - env(safe-area-inset-top));
    padding: 20px 16px max(16px, env(safe-area-inset-bottom));
    border-radius: 16px 16px 0 0;
  }

  .room-dialog__avatar-row {
    flex-wrap: wrap;
  }

  .room-dialog__actions {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  }
}
</style>
