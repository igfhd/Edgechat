<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { Megaphone, Pin, Plus, RefreshCw, Trash2, Edit3, Eye, EyeOff, Check, X } from '@lucide/vue';
import api from '../api.js';
import { formatLocalDateTime } from '../date.js';
import { renderMarkdown } from '../markdown.js';
import UiButton from '../components/ui/Button.vue';
import UiSurface from '../components/ui/Surface.vue';
import UiBadge from '../components/ui/Badge.vue';

const loading = ref(false);
const submitting = ref(false);
const error = ref('');
const success = ref('');
const announcements = ref([]);

// Modal Editor State
const showEditor = ref(false);
const editingId = ref(null);
const previewTab = ref('edit'); // 'edit' | 'preview' | 'split'
const form = reactive({
  title: '',
  content: '',
  isPinned: true,
  isActive: true,
  priority: 0
});

const previewHtml = computed(() => renderMarkdown(form.content || '*（预览区：暂无内容）*'));

async function loadAnnouncements() {
  loading.value = true;
  error.value = '';
  try {
    const payload = await api.adminAnnouncements();
    announcements.value = payload.announcements || [];
  } catch (err) {
    error.value = err.message;
  } finally {
    loading.value = false;
  }
}

function openCreateModal() {
  editingId.value = null;
  form.title = '';
  form.content = '';
  form.isPinned = true;
  form.isActive = true;
  form.priority = 0;
  previewTab.value = 'edit';
  error.value = '';
  success.value = '';
  showEditor.value = true;
}

function openEditModal(item) {
  editingId.value = item.id;
  form.title = item.title;
  form.content = item.content;
  form.isPinned = item.isPinned;
  form.isActive = item.isActive;
  form.priority = item.priority || 0;
  previewTab.value = 'edit';
  error.value = '';
  success.value = '';
  showEditor.value = true;
}

function closeEditor() {
  showEditor.value = false;
  editingId.value = null;
}

async function saveAnnouncement() {
  if (!form.title.trim()) {
    error.value = '请填写公告标题';
    return;
  }
  if (!form.content.trim()) {
    error.value = '请填写公告内容';
    return;
  }

  submitting.value = true;
  error.value = '';
  success.value = '';
  try {
    if (editingId.value) {
      await api.updateAnnouncement(editingId.value, {
        title: form.title,
        content: form.content,
        isPinned: form.isPinned,
        isActive: form.isActive,
        priority: Number(form.priority || 0)
      });
      success.value = '公告已成功更新';
    } else {
      await api.createAnnouncement({
        title: form.title,
        content: form.content,
        isPinned: form.isPinned,
        isActive: form.isActive,
        priority: Number(form.priority || 0)
      });
      success.value = '新公告已发布';
    }
    closeEditor();
    await loadAnnouncements();
  } catch (err) {
    error.value = err.message;
  } finally {
    submitting.value = false;
  }
}

async function toggleActive(item) {
  error.value = '';
  try {
    await api.updateAnnouncement(item.id, {
      isActive: !item.isActive
    });
    await loadAnnouncements();
  } catch (err) {
    error.value = err.message;
  }
}

async function togglePinned(item) {
  error.value = '';
  try {
    await api.updateAnnouncement(item.id, {
      isPinned: !item.isPinned
    });
    await loadAnnouncements();
  } catch (err) {
    error.value = err.message;
  }
}

async function removeAnnouncement(item) {
  if (!window.confirm(`确认删除公告「${item.title}」吗？此操作无法撤销。`)) {
    return;
  }
  error.value = '';
  try {
    await api.deleteAnnouncement(item.id);
    await loadAnnouncements();
  } catch (err) {
    error.value = err.message;
  }
}

onMounted(loadAnnouncements);
</script>

<template>
  <div class="admin-section admin-announcements-page">
    <header class="admin-section__header">
      <div class="admin-section__heading">
        <h2>系统公告管理</h2>
        <p>向全站发布重要通知、系统更新或活动公告，支持置顶与 Markdown 格式。</p>
      </div>
      <div class="admin-header-actions">
        <UiButton variant="secondary" :disabled="loading" @click="loadAnnouncements">
          <RefreshCw :size="16" :class="{ 'admin-spin': loading }" />
          刷新
        </UiButton>
        <UiButton variant="primary" @click="openCreateModal">
          <Plus :size="16" />
          发布新公告
        </UiButton>
      </div>
    </header>

    <div class="admin-section__body">
      <p v-if="error" class="error-text">{{ error }}</p>
      <p v-if="success" class="success-text">{{ success }}</p>

      <UiSurface class="panel panel--table">
        <div class="panel-header-row">
          <h3 class="panel-title">公告列表 ({{ announcements.length }})</h3>
        </div>

        <div class="admin-table-wrap">
          <table class="list-table">
            <thead>
              <tr>
                <th>标题与内容摘要</th>
                <th style="width: 115px; min-width: 105px;">置顶状态</th>
                <th style="width: 115px; min-width: 105px;">展示状态</th>
                <th style="width: 80px;">优先级</th>
                <th style="width: 160px;">发布时间</th>
                <th style="width: 140px;">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="loading && !announcements.length">
                <td colspan="6" class="muted">正在加载公告列表...</td>
              </tr>
              <tr v-else-if="!announcements.length">
                <td colspan="6" class="muted">暂无系统公告，点击右上角“发布新公告”开始添加。</td>
              </tr>
              <tr v-for="item in announcements" :key="item.id">
                <td>
                  <div class="announcement-cell-title">
                    <Pin v-if="item.isPinned" :size="14" class="pinned-icon-accent" />
                    <strong>{{ item.title }}</strong>
                  </div>
                  <div class="announcement-cell-preview muted">
                    {{ item.content.slice(0, 80) }}{{ item.content.length > 80 ? '...' : '' }}
                  </div>
                </td>
                <td>
                  <button
                    type="button"
                    class="status-toggle-btn"
                    :class="{ 'status-toggle-btn--active': item.isPinned }"
                    :title="item.isPinned ? '点击取消置顶' : '点击设为置顶'"
                    @click="togglePinned(item)"
                  >
                    <Pin :size="13" />
                    <span>{{ item.isPinned ? '已置顶' : '普通' }}</span>
                  </button>
                </td>
                <td>
                  <button
                    type="button"
                    class="status-toggle-btn"
                    :class="item.isActive ? 'status-toggle-btn--success' : 'status-toggle-btn--disabled'"
                    :title="item.isActive ? '点击禁用' : '点击启用'"
                    @click="toggleActive(item)"
                  >
                    <Eye v-if="item.isActive" :size="13" />
                    <EyeOff v-else :size="13" />
                    <span>{{ item.isActive ? '展示中' : '已隐藏' }}</span>
                  </button>
                </td>
                <td>
                  <span class="priority-badge">{{ item.priority }}</span>
                </td>
                <td>
                  <div class="date-cell">
                    <span>{{ formatLocalDateTime(item.createdAt) }}</span>
                    <small class="muted">由 {{ item.creatorName }}</small>
                  </div>
                </td>
                <td>
                  <div class="table-actions">
                    <UiButton size="sm" variant="secondary" title="编辑公告" @click="openEditModal(item)">
                      <Edit3 :size="14" />
                      编辑
                    </UiButton>
                    <UiButton size="sm" variant="danger" title="删除公告" @click="removeAnnouncement(item)">
                      <Trash2 :size="14" />
                    </UiButton>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </UiSurface>
    </div>

    <!-- Announcement Editor Modal -->
    <Teleport to="body">
      <div v-if="showEditor" class="admin-modal-overlay" @click.self="closeEditor">
        <div class="admin-modal-container admin-announcement-modal">
          <header class="admin-modal-header">
            <div class="admin-modal-title">
              <Megaphone :size="20" class="modal-icon" />
              <h3>{{ editingId ? '编辑系统公告' : '发布新系统公告' }}</h3>
            </div>
            <button type="button" class="admin-modal-close" aria-label="关闭" @click="closeEditor">
              <X :size="20" />
            </button>
          </header>

          <form class="admin-modal-body" @submit.prevent="saveAnnouncement">
            <div class="admin-form-group">
              <label for="announcement-title">公告标题 <span class="required">*</span></label>
              <input
                id="announcement-title"
                v-model="form.title"
                type="text"
                class="ui-input"
                placeholder="例如：系统维护通知 / 全站新功能上线"
                required
                maxlength="100"
              />
            </div>

            <div class="admin-form-group">
              <div class="editor-header-row">
                <label for="announcement-content">公告正文 (支持 Markdown) <span class="required">*</span></label>
                <div class="editor-tab-switch">
                  <button
                    type="button"
                    class="editor-tab-btn"
                    :class="{ 'editor-tab-btn--active': previewTab === 'edit' }"
                    @click="previewTab = 'edit'"
                  >
                    编辑
                  </button>
                  <button
                    type="button"
                    class="editor-tab-btn"
                    :class="{ 'editor-tab-btn--active': previewTab === 'preview' }"
                    @click="previewTab = 'preview'"
                  >
                    预览
                  </button>
                  <button
                    type="button"
                    class="editor-tab-btn"
                    :class="{ 'editor-tab-btn--active': previewTab === 'split' }"
                    @click="previewTab = 'split'"
                  >
                    分栏
                  </button>
                </div>
              </div>

              <div class="editor-main-area" :class="`editor-main-area--${previewTab}`">
                <textarea
                  v-if="previewTab === 'edit' || previewTab === 'split'"
                  id="announcement-content"
                  v-model="form.content"
                  class="ui-textarea editor-textarea"
                  placeholder="输入公告 Markdown 内容，支持列表、粗体、链接与代码块等..."
                  rows="10"
                  required
                ></textarea>
                <div
                  v-if="previewTab === 'preview' || previewTab === 'split'"
                  class="editor-preview-pane markdown-body"
                  v-html="previewHtml"
                ></div>
              </div>
            </div>

            <div class="admin-form-row">
              <div class="admin-form-group checkbox-group">
                <label class="admin-checkbox-label">
                  <input v-model="form.isPinned" type="checkbox" />
                  <span>置顶显示（聊天顶部醒目横幅）</span>
                </label>
              </div>

              <div class="admin-form-group checkbox-group">
                <label class="admin-checkbox-label">
                  <input v-model="form.isActive" type="checkbox" />
                  <span>立即启用（对外可见）</span>
                </label>
              </div>

              <div class="admin-form-group priority-group">
                <label for="announcement-priority">显示优先级</label>
                <input
                  id="announcement-priority"
                  v-model.number="form.priority"
                  type="number"
                  class="ui-input priority-input"
                  placeholder="0"
                />
              </div>
            </div>

            <footer class="admin-modal-footer">
              <UiButton type="button" variant="secondary" :disabled="submitting" @click="closeEditor">
                取消
              </UiButton>
              <UiButton type="submit" variant="primary" :disabled="submitting">
                <Check v-if="!submitting" :size="16" />
                {{ submitting ? '保存中...' : (editingId ? '保存更改' : '立即发布') }}
              </UiButton>
            </footer>
          </form>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.admin-announcements-page {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.admin-header-actions {
  display: flex;
  gap: 10px;
  align-items: center;
}

.panel-header-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.announcement-cell-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14.5px;
  color: #111b21;
}

.pinned-icon-accent {
  color: #008069;
  flex-shrink: 0;
}

.announcement-cell-preview {
  margin-top: 4px;
  font-size: 13px;
  color: #667781;
  max-width: 420px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.status-toggle-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 4px 10px;
  min-width: 82px;
  white-space: nowrap;
  flex-shrink: 0;
  border-radius: 6px;
  font-size: 12.5px;
  font-weight: 500;
  border: 1px solid #d1d7db;
  background: #ffffff;
  color: #667781;
  cursor: pointer;
  transition: all 0.15s ease;
  user-select: none;
}

.status-toggle-btn--active {
  background: #e8f5e9;
  border-color: #a5d6a7;
  color: #2e7d32;
}

.status-toggle-btn--success {
  background: #e0f2fe;
  border-color: #bae6fd;
  color: #0284c7;
}

.status-toggle-btn--disabled {
  background: #f1f5f9;
  border-color: #cbd5e1;
  color: #94a3b8;
}

.priority-badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 10px;
  background: #f0f2f5;
  color: #54656f;
  font-size: 12px;
  font-weight: 600;
}

.date-cell {
  display: flex;
  flex-direction: column;
  font-size: 12.5px;
  color: #54656f;
}

.table-actions {
  display: flex;
  gap: 6px;
  align-items: center;
}

/* Modal styles */
.admin-modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: rgba(11, 20, 26, 0.45);
  backdrop-filter: blur(2px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}

.admin-modal-container {
  background: #ffffff;
  border-radius: 12px;
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.18);
  width: 100%;
  max-width: 720px;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.admin-modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid #e9edef;
}

.admin-modal-title {
  display: flex;
  align-items: center;
  gap: 8px;
}

.admin-modal-title h3 {
  margin: 0;
  font-size: 17px;
  color: #111b21;
}

.modal-icon {
  color: #008069;
}

.admin-modal-close {
  border: none;
  background: transparent;
  color: #667781;
  cursor: pointer;
  padding: 4px;
  border-radius: 4px;
}

.admin-modal-close:hover {
  background: #f0f2f5;
  color: #111b21;
}

.admin-modal-body {
  padding: 20px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.admin-form-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.admin-form-group label {
  font-size: 13.5px;
  font-weight: 600;
  color: #111b21;
}

.required {
  color: #ea0038;
}

.editor-header-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.editor-tab-switch {
  display: flex;
  border: 1px solid #d1d7db;
  border-radius: 6px;
  overflow: hidden;
}

.editor-tab-btn {
  padding: 3px 10px;
  border: none;
  background: #f8fafc;
  font-size: 12.5px;
  color: #64748b;
  cursor: pointer;
}

.editor-tab-btn--active {
  background: #008069;
  color: #ffffff;
  font-weight: 600;
}

.editor-main-area--split {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.editor-textarea {
  width: 100%;
  min-height: 180px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 13.5px;
  line-height: 1.5;
}

.editor-preview-pane {
  min-height: 180px;
  max-height: 280px;
  overflow-y: auto;
  padding: 12px 14px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #fafafa;
}

.admin-form-row {
  display: flex;
  gap: 20px;
  align-items: center;
  flex-wrap: wrap;
}

.admin-checkbox-label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13.5px;
  color: #334155;
  cursor: pointer;
  user-select: none;
}

.admin-checkbox-label input[type="checkbox"] {
  width: 16px;
  height: 16px;
  accent-color: #008069;
  cursor: pointer;
}

.priority-group {
  margin-left: auto;
  flex-direction: row;
  align-items: center;
  gap: 8px;
}

.priority-input {
  width: 70px;
  padding: 4px 8px;
}

.admin-modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 10px;
  padding-top: 14px;
  border-top: 1px solid #e9edef;
}

@media (max-width: 640px) {
  .admin-modal-overlay {
    padding: 8px;
  }
  .admin-modal-container {
    max-height: 94vh;
    border-radius: 12px;
  }
  .admin-modal-header {
    padding: 12px 14px;
  }
  .admin-modal-body {
    padding: 14px;
    gap: 12px;
  }
  .editor-main-area--split {
    grid-template-columns: minmax(0, 1fr);
  }
  .admin-form-row {
    flex-direction: column;
    align-items: flex-start;
    gap: 10px;
  }
  .priority-group {
    margin-left: 0;
  }
}
</style>
