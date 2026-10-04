<script setup>
import { Ban, CalendarClock, X } from '@lucide/vue';
import { computed, nextTick, ref, toRef, watch } from 'vue';
import {
  BAN_DURATION_PRESETS,
  banExpiryDate,
  resolveBanDurationMinutes
} from '../../admin/user-ban-duration.js';
import { useOverlayLifecycle } from '../../composables/useOverlayLifecycle.js';
import UiAvatar from '../ui/Avatar.vue';
import UiButton from '../ui/Button.vue';

const props = defineProps({
  show: { type: Boolean, default: false },
  user: { type: Object, default: null },
  saving: { type: Boolean, default: false },
  error: { type: String, default: '' }
});

const emit = defineEmits(['close', 'confirm']);
const selection = ref('one-day');
const customDuration = ref(1);
const customUnit = ref('days');
const localError = ref('');
const selectedOptionEl = ref(null);
const customDurationEl = ref(null);

const options = computed(() => [
  ...BAN_DURATION_PRESETS,
  { value: 'custom', label: '自定义' },
  { value: 'permanent', label: '永久封禁' }
]);

const durationMinutes = computed(() => {
  try {
    return resolveBanDurationMinutes({
      selection: selection.value,
      customDuration: customDuration.value,
      customUnit: customUnit.value
    });
  } catch {
    return undefined;
  }
});

function formatLocalDateTime(date) {
  if (!date) return '';
  const d = new Date(date);
  if (isNaN(d.getTime())) return '';
  const Y = d.getFullYear();
  const M = String(d.getMonth() + 1).padStart(2, '0');
  const D = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${Y}-${M}-${D} ${h}:${m}`;
}

const durationSummary = computed(() => {
  if (durationMinutes.value === null) return '永久封禁，账号将持续处于禁用状态直到手动解封';
  if (durationMinutes.value === undefined) return '封禁时长无效';
  return `预计解封时间：${formatLocalDateTime(banExpiryDate(durationMinutes.value))}`;
});

function requestClose() {
  if (!props.saving) emit('close');
}

function setSelectedOption(element) {
  selectedOptionEl.value = element;
}

useOverlayLifecycle({
  open: toRef(props, 'show'),
  onClose: requestClose,
  focusTarget: selectedOptionEl
});

watch(
  () => props.show,
  (show) => {
    if (!show) return;
    selection.value = 'one-day';
    customDuration.value = 1;
    customUnit.value = 'days';
    localError.value = '';
  }
);

async function selectDuration(value) {
  selection.value = value;
  localError.value = '';
  if (value === 'custom') {
    await nextTick();
    customDurationEl.value?.focus();
  }
}

function submitBan() {
  if (props.saving) return;
  try {
    const minutes = resolveBanDurationMinutes({
      selection: selection.value,
      customDuration: customDuration.value,
      customUnit: customUnit.value
    });
    localError.value = '';
    emit('confirm', minutes);
  } catch {
    localError.value = '请输入有效的正整数封禁时长';
  }
}
</script>

<template>
  <Teleport to="body">
    <Transition name="admin-ban-dialog">
      <div v-if="show" class="admin-ban-dialog__overlay" @click.self="requestClose">
        <form
          class="admin-ban-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="user-ban-dialog-title"
          @submit.prevent="submitBan"
        >
          <header class="admin-ban-dialog__header">
            <div class="admin-ban-dialog__title-row">
              <span class="admin-ban-dialog__title-icon" aria-hidden="true"><Ban /></span>
              <div>
                <h2 id="user-ban-dialog-title">封禁用户：{{ user?.displayName || '' }}</h2>
                <p>设置账号封禁期限，封禁期内用户无法登录或收发消息，到期后自动解封。</p>
              </div>
            </div>
            <button
              type="button"
              class="admin-ban-dialog__close"
              aria-label="关闭"
              title="关闭"
              :disabled="saving"
              @click="requestClose"
            >
              <X aria-hidden="true" />
            </button>
          </header>

          <div class="admin-ban-dialog__user">
            <UiAvatar
              :src="user?.avatarUrl"
              :alt="user?.displayName"
              :fallback="user?.displayName || user?.username || '?'"
            />
            <div>
              <strong>{{ user?.displayName }}</strong>
              <span>@{{ user?.username }}</span>
            </div>
          </div>

          <fieldset class="admin-ban-dialog__duration">
            <legend>选择封禁时长</legend>
            <div class="admin-ban-dialog__options">
              <button
                v-for="option in options"
                :key="option.value"
                :ref="option.value === selection ? setSelectedOption : undefined"
                type="button"
                class="admin-ban-dialog__option"
                :class="{ 'admin-ban-dialog__option--selected': selection === option.value }"
                :aria-pressed="selection === option.value"
                :disabled="saving"
                @click="selectDuration(option.value)"
              >
                {{ option.label }}
              </button>
            </div>
          </fieldset>

          <div v-if="selection === 'custom'" class="admin-ban-dialog__custom">
            <label class="field">
              <span>时长数值</span>
              <input ref="customDurationEl" v-model.number="customDuration" type="number" min="1" step="1" :disabled="saving">
            </label>
            <label class="field">
              <span>时长单位</span>
              <select v-model="customUnit" :disabled="saving">
                <option value="minutes">分钟</option>
                <option value="hours">小时</option>
                <option value="days">天</option>
              </select>
            </label>
          </div>

          <div class="admin-ban-dialog__summary" :class="{ 'admin-ban-dialog__summary--permanent': durationMinutes === null }">
            <CalendarClock aria-hidden="true" />
            <span>{{ durationSummary }}</span>
          </div>

          <p v-if="localError || error" class="admin-ban-dialog__error">{{ localError || error }}</p>

          <footer class="admin-ban-dialog__actions">
            <UiButton variant="secondary" :disabled="saving" @click="requestClose">取消</UiButton>
            <UiButton type="submit" variant="destructive" :disabled="saving">
              {{ saving ? '正在保存...' : '确认封禁' }}
            </UiButton>
          </footer>
        </form>
      </div>
    </Transition>
  </Teleport>
</template>
