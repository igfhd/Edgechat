<script setup>
import AdminSiteAppearance from '../components/admin/AdminSiteAppearance.vue';
import AdminStorageEngine from '../components/admin/AdminStorageEngine.vue';
import AdminCallsSettings from '../components/admin/AdminCallsSettings.vue';
import AdminUploadSettings from '../components/admin/AdminUploadSettings.vue';
import AdminMessageRetention from '../components/admin/AdminMessageRetention.vue';
import AdminUpdateStatus from '../components/admin/AdminUpdateStatus.vue';
import AdminBackupRestore from '../components/admin/AdminBackupRestore.vue';
</script>

<template>
  <div class="admin-section">
    <header class="admin-section__header">
      <div class="admin-section__heading">
        <h2>网站设置</h2>
        <p>维护站点外观、R2/S3对象存储引擎、语音通话与 SFU 服务器、文件上传限制、历史消息自动清理与版本更新状态。</p>
      </div>
    </header>

    <div class="admin-section__body">
      <section id="site-appearance" class="admin-anchor-section">
        <AdminSiteAppearance />
      </section>
      <section id="storage-engine" class="admin-anchor-section">
        <AdminStorageEngine />
      </section>
      <section id="calls-settings" class="admin-anchor-section">
        <AdminCallsSettings />
      </section>
      <section id="upload-settings" class="admin-anchor-section">
        <AdminUploadSettings />
      </section>
      <section id="message-retention" class="admin-anchor-section">
        <AdminMessageRetention />
      </section>
      <section id="backup-restore" class="admin-anchor-section">
        <AdminBackupRestore />
      </section>
      <section id="version-update" class="admin-anchor-section">
        <AdminUpdateStatus />
      </section>
    </div>
  </div>
</template>

