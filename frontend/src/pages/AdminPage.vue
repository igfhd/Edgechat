<script setup>
import { ref } from 'vue';
import { RouterView } from 'vue-router';
import AdminSidebar from '../components/admin/AdminSidebar.vue';
import AdminTopbar from '../components/admin/AdminTopbar.vue';
import { useAdminAnchorScroll } from '../composables/useAdminAnchorScroll.js';

useAdminAnchorScroll();

const sidebarOpen = ref(false);
</script>

<template>
  <div class="admin-page">
    <AdminSidebar :open="sidebarOpen" @close="sidebarOpen = false" />
    <section class="admin-workspace">
      <AdminTopbar @toggle-sidebar="sidebarOpen = !sidebarOpen" />
      <main class="admin-content">
        <RouterView />
      </main>
    </section>
  </div>
</template>
