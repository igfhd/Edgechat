<script setup>
import { Ban, Copy, Ellipsis } from '@lucide/vue';
import { computed, onMounted, reactive, ref } from 'vue';
import api, { getBasePrefix } from '../../api.js';
import { formatLocalDateTime, parseUtcDate } from '../../date.js';
import { getEdgeChatServerOrigin, isCapacitorAndroid } from '../../capacitor-platform.js';
import UiButton from '../ui/Button.vue';
import UiSurface from '../ui/Surface.vue';

const loading = ref(false);
const error = ref('');
const inviteSubmitting = ref(false);
const invites = ref([]);
const groups = ref([]);
const copiedInviteId = ref(0);
const inviteForm = reactive({
  note: '',
  maxUses: 1,
  groupId: null
});
const inviteDateFormatter = new Intl.DateTimeFormat('zh-CN', {
  month: 'short',
  day: 'numeric'
});

const inviteMaxUsesValid = computed(
  () => Number.isInteger(inviteForm.maxUses) && inviteForm.maxUses >= 1 && inviteForm.maxUses <= 1000
);

function inviteLinkUrl(token) {
  const prefix = getBasePrefix();
  const base = isCapacitorAndroid ? getEdgeChatServerOrigin() : window.location.origin;
  return new URL(`${prefix}/register/${token}`, base).toString();
}

function inviteStatusLabel(invite) {
  if (invite.isAvailable) {
    return '可用';
  }
  return invite.deletedAt ? '已停用' : '已用完';
}

function inviteStatusClass(invite) {
  if (invite.isAvailable) {
    return 'admin-invite-card__status--available';
  }
  return invite.deletedAt
    ? 'admin-invite-card__status--disabled'
    : 'admin-invite-card__status--exhausted';
}

function formatInviteDate(value) {
  const date = parseUtcDate(value);
  return date ? inviteDateFormatter.format(date) : '';
}

async function loadInvites() {
  loading.value = true;
  error.value = '';
  try {
    const [payload, groupPayload] = await Promise.all([
      api.listAdminRegisterLinks(),
      api.adminGroups().catch(() => ({ groups: [] }))
    ]);
    invites.value = payload.invites || [];
    groups.value = groupPayload?.groups || [];
  } catch (currentError) {
    error.value = currentError.message;
  } finally {
    loading.value = false;
  }
}

async function createInvite() {
  inviteSubmitting.value = true;
  error.value = '';
  try {
    const payload = await api.createAdminRegisterLink(inviteForm);
    invites.value = [payload.invite, ...invites.value];
    inviteForm.note = '';
    inviteForm.maxUses = 1;
    inviteForm.groupId = null;
  } catch (currentError) {
    error.value = currentError.message;
  } finally {
    inviteSubmitting.value = false;
  }
}

async function copyInvite(invite) {
  try {
    await navigator.clipboard.writeText(inviteLinkUrl(invite.token));
    copiedInviteId.value = invite.id;
    window.setTimeout(() => {
      if (copiedInviteId.value === invite.id) {
        copiedInviteId.value = 0;
      }
    }, 1600);
  } catch {
    error.value = '复制失败，请手动复制链接';
  }
}

async function revokeInvite(invite, event) {
  event?.currentTarget.closest('details')?.removeAttribute('open');
  if (!window.confirm('确认停用这个注册链接吗？')) {
    return;
  }

  try {
    await api.revokeAdminRegisterLink(invite.id);
    invites.value = invites.value.filter((item) => item.id !== invite.id);
  } catch (currentError) {
    error.value = currentError.message;
  }
}

onMounted(loadInvites);
</script>

<template>
  <section class="registration-invite-manager">
    <header class="registration-invite-manager__heading">
      <h3>注册链接</h3>
    </header>
    <p v-if="error" class="error-text">{{ error }}</p>

    <UiSurface class="invite-create-panel">
      <form class="invite-create-form" @submit.prevent="createInvite">
        <label class="field invite-create-form__note">
          <span class="sr-only">链接备注</span>
          <input v-model.trim="inviteForm.note" placeholder="备注（可选）" />
        </label>
        <label class="field invite-create-form__group">
          <span class="sr-only">自动加入分组</span>
          <select v-model="inviteForm.groupId" aria-label="自动加入分组">
            <option :value="null">默认（不绑定分组）</option>
            <option v-for="g in groups" :key="g.id" :value="g.id">👥 {{ g.name }}</option>
          </select>
        </label>
        <label class="field invite-create-form__uses">
          <span class="sr-only">可使用次数</span>
          <input
            v-model.number="inviteForm.maxUses"
            type="number"
            min="1"
            max="1000"
            step="1"
            aria-label="可使用次数"
          />
        </label>
        <UiButton type="submit" :disabled="inviteSubmitting || !inviteMaxUsesValid">
          {{ inviteSubmitting ? '创建中...' : '创建' }}
        </UiButton>
      </form>
    </UiSurface>

    <header class="invite-list-heading">
      <h3>已创建链接 <span>{{ invites.length }}</span></h3>
    </header>
    <p v-if="loading" class="muted">注册链接加载中...</p>

    <div class="invite-list">
      <div v-if="!loading && !invites.length" class="muted">还没有注册链接。</div>
      <UiSurface
        v-for="invite in invites"
        :key="invite.id"
        tone="soft"
        class="admin-invite-card"
      >
        <div class="admin-invite-card__head">
          <div class="admin-invite-card__title-group">
            <strong>{{ invite.note || '未命名注册链接' }}</strong>
            <span v-if="invite.groupName" class="admin-invite-card__group-badge">
              👥 {{ invite.groupName }}
            </span>
          </div>
          <span class="admin-invite-card__status" :class="inviteStatusClass(invite)">
            {{ inviteStatusLabel(invite) }}
          </span>
        </div>
        <div class="admin-invite-card__url">{{ inviteLinkUrl(invite.token) }}</div>
        <p class="admin-invite-card__usage">
          {{ `已使用 ${invite.usedCount} / ${invite.maxUses} 次` }}
          <span class="admin-invite-card__remaining">剩余 {{ invite.remainingUses }} 次</span>
        </p>
        <p v-if="invite.consumerDisplayName" class="admin-invite-card__consumer">
          最近使用者：{{ invite.consumerDisplayName }}
        </p>
        <footer class="admin-invite-card__footer">
          <div class="admin-invite-card__provenance">
            <span>{{ invite.creatorDisplayName }}</span>
            <span aria-hidden="true">·</span>
            <time
              :datetime="invite.createdAt"
              :title="formatLocalDateTime(invite.createdAt)"
            >
              {{ formatInviteDate(invite.createdAt) }}
            </time>
          </div>
          <div class="admin-invite-card__actions">
            <UiButton
              variant="secondary"
              size="sm"
              :title="copiedInviteId === invite.id ? '已复制链接' : '复制链接'"
              @click="copyInvite(invite)"
            >
              <Copy :size="15" aria-hidden="true" />
              {{ copiedInviteId === invite.id ? '已复制' : '复制' }}
            </UiButton>
            <details v-if="invite.isAvailable" class="admin-invite-menu">
              <summary class="admin-invite-menu__trigger" title="更多操作" aria-label="更多操作">
                <Ellipsis :size="18" aria-hidden="true" />
              </summary>
              <div class="admin-invite-menu__popover">
                <button type="button" @click="revokeInvite(invite, $event)">
                  <Ban :size="15" aria-hidden="true" />
                  停用链接
                </button>
              </div>
            </details>
          </div>
        </footer>
      </UiSurface>
    </div>
  </section>
</template>

<style scoped src="../../styles/admin/invite-manager.css"></style>
