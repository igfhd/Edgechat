import { computed, ref } from 'vue';
import api from '../api.js';

const STORAGE_KEY = 'edgechat_dismissed_announcements';

function loadDismissedStorage() {
  if (typeof window === 'undefined' || !window.localStorage) return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveDismissedStorage(record) {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
  } catch {}
}

export function useAnnouncements() {
  const announcements = ref([]);
  const loading = ref(false);
  const showModal = ref(false);
  const selectedId = ref(null);
  const dismissedMap = ref(loadDismissedStorage());

  const activeUndismissedAnnouncements = computed(() => {
    return announcements.value.filter((a) => {
      if (!a.isPinned) return false;
      const dismissedUpdatedAt = dismissedMap.value[a.id];
      // 如果未关闭过，或者关闭后公告又有内容更新(updatedAt变了)，则展示
      return !dismissedUpdatedAt || dismissedUpdatedAt !== a.updatedAt;
    });
  });

  async function loadAnnouncements() {
    loading.value = true;
    try {
      const payload = await api.getAnnouncements();
      announcements.value = payload.announcements || [];
    } catch {
      // 忽略加载异常，不阻塞主聊天
    } finally {
      loading.value = false;
    }
  }

  function dismissAnnouncement(item) {
    if (!item?.id) return;
    const next = { ...dismissedMap.value, [item.id]: item.updatedAt || item.createdAt };
    dismissedMap.value = next;
    saveDismissedStorage(next);
  }

  function openAnnouncementDetail(item) {
    selectedId.value = item?.id || null;
    showModal.value = true;
  }

  function openAllAnnouncements() {
    selectedId.value = announcements.value[0]?.id || null;
    showModal.value = true;
  }

  function closeModal() {
    showModal.value = false;
  }

  return {
    announcements,
    loading,
    showModal,
    selectedId,
    activeUndismissedAnnouncements,
    loadAnnouncements,
    dismissAnnouncement,
    openAnnouncementDetail,
    openAllAnnouncements,
    closeModal
  };
}
