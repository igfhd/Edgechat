<script setup>
import AdminUserCreator from '../components/admin/AdminUserCreator.vue';
import RegistrationInviteManager from '../components/admin/RegistrationInviteManager.vue';
</script>

<template>
  <div class="admin-section admin-invites-page">
    <p class="admin-invites-page__intro">创建用户或生成注册链接</p>

    <div class="admin-section__body">
      <section id="create-user" class="admin-anchor-section">
        <AdminUserCreator />
      </section>
      <section id="registration-links" class="admin-anchor-section">
        <RegistrationInviteManager />
      </section>
    </div>
  </div>
</template>

<style scoped src="../styles/admin/invites-page.css"></style>
