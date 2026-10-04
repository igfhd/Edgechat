<script setup>
import { computed, reactive, ref } from 'vue';
import api from '../../api.js';
import UiButton from '../ui/Button.vue';
import UiSurface from '../ui/Surface.vue';

const emit = defineEmits(['created']);
const submitting = ref(false);
const error = ref('');
const success = ref('');
const form = reactive({ username: '', displayName: '', password: '' });

const canSubmit = computed(() => Boolean(form.username && form.displayName && form.password));

async function submitUser() {
  submitting.value = true;
  error.value = '';
  success.value = '';
  try {
    const payload = await api.createUser(form);
    form.username = '';
    form.displayName = '';
    form.password = '';
    success.value = '用户创建成功';
    emit('created', payload.user);
  } catch (currentError) {
    error.value = currentError.message;
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <UiSurface class="panel admin-user-creator">
    <h3 class="panel-title">创建用户</h3>
    <p v-if="error" class="error-text">{{ error }}</p>
    <p v-else-if="success" class="success-text" role="status">{{ success }}</p>
    <form class="admin-user-creator__form" @submit.prevent="submitUser">
      <div class="admin-user-creator__identity-grid">
        <label class="field">
          <span>用户名</span>
          <input v-model.trim="form.username" autocomplete="off" />
        </label>
        <label class="field">
          <span>显示名称</span>
          <input v-model.trim="form.displayName" autocomplete="off" />
        </label>
      </div>
      <label class="field">
        <span>初始密码</span>
        <input v-model="form.password" type="password" autocomplete="new-password" />
      </label>
      <div class="admin-user-creator__actions">
        <UiButton type="submit" :disabled="submitting || !canSubmit">
          {{ submitting ? '创建中...' : '创建用户' }}
        </UiButton>
      </div>
    </form>
  </UiSurface>
</template>

<style scoped src="../../styles/admin/user-creator.css"></style>
