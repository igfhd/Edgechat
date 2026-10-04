<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import api from '../api.js';
import store from '../store.js';
import { useCursor } from '../composables/useCursor.js';

const route = useRoute();
const router = useRouter();
const loading = ref(false);
const validating = ref(false);
const error = ref('');
const invite = ref(null);

const form = reactive({
  username: '',
  displayName: '',
  password: '',
  confirmPassword: ''
});

const token = computed(() => String(route.params.token || '').trim());

const usernameInput = ref(null);
const displayNameInput = ref(null);
const passwordInput = ref(null);
const confirmPasswordInput = ref(null);
const usernameCursor = ref(null);
const displayNameCursor = ref(null);
const passwordCursor = ref(null);
const confirmPasswordCursor = ref(null);

useCursor([
  [usernameInput, usernameCursor],
  [displayNameInput, displayNameCursor],
  [passwordInput, passwordCursor],
  [confirmPasswordInput, confirmPasswordCursor]
], invite);

async function loadInvite() {
  validating.value = true;
  error.value = '';
  try {
    const payload = await api.getRegisterInvite(token.value);
    invite.value = payload.invite;
    if (payload.site) {
      store.setSite(payload.site);
    }
  } catch (currentError) {
    error.value = currentError.message;
  } finally {
    validating.value = false;
  }
}

async function submit() {
  if (form.password !== form.confirmPassword) {
    error.value = '两次输入的密码不一致';
    return;
  }

  loading.value = true;
  error.value = '';
  try {
    await api.registerWithInvite(token.value, form);
    router.push({ name: 'login', query: { registered: '1' } });
  } catch (currentError) {
    error.value = currentError.message;
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  loadInvite();
});
</script>

<template>
  <div class="login-page">
    <div class="login-container">
      <div class="title-group">
        <h1 class="welcome-text">Welcome Back</h1>
        <h2 class="brand-name">{{ store.site.siteName }}</h2>
      </div>

      <p v-if="validating" class="info-text">正在验证注册链接...</p>
      <p v-else-if="invite?.note" class="info-text">邀请说明：{{ invite.note }}</p>
      <div v-if="invite?.groupName" class="group-invite-badge">
        <span>👥 注册后将自动加入「{{ invite.groupName }}」分组</span>
      </div>
      <p v-if="error" class="error-text">{{ error }}</p>

      <form v-if="invite && !error" class="login-form" @submit.prevent="submit">
        <div class="input-wrapper">
          <span ref="usernameCursor" class="custom-cursor"></span>
          <input
            ref="usernameInput"
            v-model.trim="form.username"
            class="login-input"
            placeholder="用户名"
            autocomplete="username"
            type="text"
          />
        </div>
        <div class="input-wrapper">
          <span ref="displayNameCursor" class="custom-cursor"></span>
          <input
            ref="displayNameInput"
            v-model.trim="form.displayName"
            class="login-input"
            placeholder="显示名称"
            autocomplete="nickname"
            type="text"
          />
        </div>
        <div class="input-wrapper">
          <span ref="passwordCursor" class="custom-cursor"></span>
          <input
            ref="passwordInput"
            v-model="form.password"
            class="login-input"
            placeholder="密码"
            autocomplete="new-password"
            type="password"
          />
        </div>
        <div class="input-wrapper">
          <span ref="confirmPasswordCursor" class="custom-cursor"></span>
          <input
            ref="confirmPasswordInput"
            v-model="form.confirmPassword"
            class="login-input"
            placeholder="确认密码"
            autocomplete="new-password"
            type="password"
          />
        </div>

        <button class="login-btn" :disabled="loading" type="submit">
          {{ loading ? '注册中...' : '完成注册' }}
        </button>
      </form>
    </div>
  </div>
</template>

<style scoped>
@import url('https://fonts.googleapis.com/css2?family=Great+Vibes&family=Dancing+Script:wght@500;700&display=swap');

.login-page {
  position: fixed;
  inset: 0;
  width: 100%;
  height: 100dvh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background-color: #f5f5f5;
  overflow-y: auto;
  overflow-x: hidden;
  overscroll-behavior: contain;
  box-sizing: border-box;
  scrollbar-width: thin;
  scrollbar-color: #94a3b8 #f1f5f9;
}

.login-page::-webkit-scrollbar {
  width: 10px;
  display: block;
}

.login-page::-webkit-scrollbar-track {
  background: #f1f5f9;
  border-radius: 8px;
}

.login-page::-webkit-scrollbar-thumb {
  background: #94a3b8;
  border-radius: 8px;
  border: 2px solid #f1f5f9;
}

.login-page::-webkit-scrollbar-thumb:hover {
  background: #64748b;
}

.login-page::before {
  content: '';
  position: fixed;
  inset: 0;
  z-index: 0;
  background: linear-gradient(to bottom, transparent 0%, #e1ecf5 25%, #e6eff6 100%);
  transform: translateY(100%);
  animation: tideRise 1.2s cubic-bezier(0.16, 1, 0.3, 1) forwards;
  pointer-events: none;
}

@keyframes tideRise {
  to { transform: translateY(0); }
}

.login-container {
  width: 100%;
  max-width: 420px;
  margin: auto 0;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  position: relative;
  z-index: 1;
}

.title-group {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.welcome-text {
  font-family: 'Dancing Script', cursive;
  font-size: 56px;
  font-weight: 700;
  color: #2c4a6e;
  margin: 0 0 10px;
  letter-spacing: 1px;
  opacity: 0;
  animation: fadeUp 0.7s ease-out 0.8s forwards;
}

.brand-name {
  font-family: 'Great Vibes', cursive;
  font-size: 52px;
  font-weight: 400;
  color: #5b8dbf;
  margin: -8px 0 48px;
  letter-spacing: 2px;
  opacity: 0;
  animation: fadeUp 0.7s ease-out 1s forwards;
  text-shadow: 0 2px 8px rgba(91, 141, 191, 0.15);
}

@keyframes fadeUp {
  0% { opacity: 0; transform: translateY(18px); }
  100% { opacity: 1; transform: translateY(0); }
}

.info-text {
  font-size: 13px;
  color: #6b8aab;
  margin: -32px 0 28px;
  text-align: center;
}

.group-invite-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin: -18px 0 20px;
  padding: 4px 12px;
  border-radius: 20px;
  background-color: rgba(91, 141, 191, 0.15);
  color: #2c4a6e;
  font-size: 12px;
  font-weight: 600;
  text-align: center;
}

.login-form {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.input-wrapper {
  position: relative;
  width: 100%;
  background: rgba(255, 255, 255, 0.75);
  border: 1.5px solid rgba(91, 141, 191, 0.4);
  border-radius: 12px;
  box-shadow: 0 2px 8px rgba(44, 74, 110, 0.04);
  box-sizing: border-box;
  transition: border-color 0.2s ease, box-shadow 0.2s ease, background-color 0.2s ease;
  opacity: 0;
  animation: slideInRight 0.6s cubic-bezier(0.22, 1, 0.36, 1) forwards;
}

.input-wrapper:hover {
  border-color: rgba(91, 141, 191, 0.65);
  background: rgba(255, 255, 255, 0.9);
}

.input-wrapper:focus-within {
  border-color: #2c4a6e;
  background: #ffffff;
  box-shadow: 0 4px 14px rgba(44, 74, 110, 0.12);
}

.input-wrapper:nth-child(1) { animation-delay: 1.2s; }
.input-wrapper:nth-child(2) { animation-delay: 1.3s; }
.input-wrapper:nth-child(3) { animation-delay: 1.4s; }
.input-wrapper:nth-child(4) { animation-delay: 1.5s; }

@keyframes slideInRight {
  0% { opacity: 0; transform: translateX(32px); }
  100% { opacity: 1; transform: translateX(0); }
}

.custom-cursor {
  position: absolute;
  width: 3px;
  background-color: #2c4a6e;
  border-radius: 2px;
  opacity: 0;
  pointer-events: none;
  z-index: 2;
}

.custom-cursor.visible {
  animation: blink 1s infinite;
}

@keyframes blink {
  0%, 50% { opacity: 1; }
  51%, 100% { opacity: 0; }
}

.login-input {
  width: 100%;
  height: 52px;
  padding: 0 16px;
  border: none;
  background: transparent;
  font-size: 16px;
  font-weight: 500;
  color: #2c4a6e;
  outline: none;
  caret-color: transparent;
  box-sizing: border-box;
}

.login-input::placeholder {
  color: rgba(44, 74, 110, 0.45);
  font-weight: 400;
}

.login-btn {
  width: fit-content;
  height: auto;
  border: none;
  border-bottom: 3px solid #5b8dbf;
  background: transparent;
  color: #2c4a6e;
  font-size: 24px;
  font-weight: 700;
  cursor: pointer;
  transition: border-color 0.2s, transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
  margin: 8px auto 0;
  letter-spacing: 2px;
  padding: 0 4px 8px;
  opacity: 0;
  animation: riseUp 0.6s cubic-bezier(0.22, 1, 0.36, 1) 1.7s forwards;
}

@keyframes riseUp {
  0% { opacity: 0; transform: translateY(24px); }
  100% { opacity: 1; transform: translateY(0); }
}

.login-btn:hover:not(:disabled) {
  border-bottom-color: #2c4a6e;
  transform: scale(1.04);
}

.login-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  animation: none;
}

.error-text {
  font-size: 13px;
  color: #d9534f;
  margin: 0;
  text-align: center;
}
</style>
