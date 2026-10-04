import { ref, computed } from 'vue';
import api, { apiFetch, getAuthToken } from '../api.js';

export function formatBytes(bytes, decimals = 1) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / k ** i).toFixed(dm))} ${sizes[i]}`;
}

export function formatSpeed(bytesPerSec) {
  if (!bytesPerSec || bytesPerSec <= 0) return '0 KB/s';
  if (bytesPerSec >= 1024 * 1024) {
    return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`;
  }
  return `${(bytesPerSec / 1024).toFixed(0)} KB/s`;
}

export function useCloudDrive() {
  const files = ref([]);
  const breadcrumbs = ref([]);
  const currentFolderId = ref(null);
  const isLoading = ref(false);
  const searchKeyword = ref('');
  const viewMode = ref(typeof localStorage !== 'undefined' ? (localStorage.getItem('edgechat_drive_view_mode') || 'grid') : 'grid');
  const stats = ref({ usedBytes: 0, quotaBytes: 10737418240, fileCount: 0, folderCount: 0 });
  const uploadQueue = ref([]);
  const error = ref('');

  // Multi-select state
  const selectedFileIds = ref(new Set());

  // Sorting state
  const sortBy = ref(typeof localStorage !== 'undefined' ? (localStorage.getItem('edgechat_drive_sort_by') || 'updated_at') : 'updated_at');
  const sortOrder = ref(typeof localStorage !== 'undefined' ? (localStorage.getItem('edgechat_drive_sort_order') || 'desc') : 'desc');

  // Trash & Shares state
  const trashList = ref([]);
  const isLoadingTrash = ref(false);
  const sharesList = ref([]);
  const isLoadingShares = ref(false);
  const sharedWithMeList = ref([]);
  const isLoadingShared = ref(false);
  const recentList = ref([]);
  const isLoadingRecent = ref(false);

  const quotaPercent = computed(() => {
    if (!stats.value.quotaBytes) return 0;
    return Math.min(100, Math.round((stats.value.usedBytes / stats.value.quotaBytes) * 100));
  });

  const setViewMode = (mode) => {
    viewMode.value = mode;
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('edgechat_drive_view_mode', mode);
    }
  };

  const setSort = (by, order = null) => {
    sortBy.value = by;
    if (order) {
      sortOrder.value = order;
    } else if (sortBy.value === by) {
      sortOrder.value = sortOrder.value === 'asc' ? 'desc' : 'asc';
    }
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('edgechat_drive_sort_by', sortBy.value);
      localStorage.setItem('edgechat_drive_sort_order', sortOrder.value);
    }
  };

  const sortedFiles = computed(() => {
    const list = [...files.value];
    const factor = sortOrder.value === 'desc' ? -1 : 1;

    return list.sort((a, b) => {
      // Folders always first unless sorting explicitly by type
      if (a.is_folder !== b.is_folder && sortBy.value !== 'type') {
        return a.is_folder ? -1 : 1;
      }

      if (sortBy.value === 'name') {
        return factor * (a.name || '').localeCompare(b.name || '', 'zh-CN');
      }

      if (sortBy.value === 'size') {
        return factor * ((a.size || 0) - (b.size || 0));
      }

      if (sortBy.value === 'type') {
        if (a.is_folder !== b.is_folder) {
          return a.is_folder ? -1 : 1;
        }
        const extA = (a.name?.split('.').pop() || '').toLowerCase();
        const extB = (b.name?.split('.').pop() || '').toLowerCase();
        return factor * extA.localeCompare(extB);
      }

      // Default: updated_at
      const timeA = a.updated_at ? new Date(a.updated_at).getTime() : 0;
      const timeB = b.updated_at ? new Date(b.updated_at).getTime() : 0;
      return factor * (timeA - timeB);
    });
  });

  // Multi-select methods
  const isMultiSelectMode = computed(() => selectedFileIds.value.size > 0);

  const toggleSelectFile = (fileId) => {
    const next = new Set(selectedFileIds.value);
    if (next.has(fileId)) {
      next.delete(fileId);
    } else {
      next.add(fileId);
    }
    selectedFileIds.value = next;
  };

  const selectAllFiles = () => {
    selectedFileIds.value = new Set(files.value.map(f => f.id));
  };

  const clearSelection = () => {
    selectedFileIds.value = new Set();
  };

  const selectRangeFiles = (startId, endId, fileList = sortedFiles.value) => {
    const list = Array.from(fileList || []);
    if (list.length === 0) return;
    const startIdx = list.findIndex((f) => f.id === startId);
    const endIdx = list.findIndex((f) => f.id === endId);
    if (startIdx === -1 || endIdx === -1) return;
    const min = Math.min(startIdx, endIdx);
    const max = Math.max(startIdx, endIdx);
    const next = new Set(selectedFileIds.value);
    for (let i = min; i <= max; i++) {
      if (list[i]?.id) {
        next.add(list[i].id);
      }
    }
    selectedFileIds.value = next;
  };

  const loadStats = async () => {
    try {
      const data = await apiFetch('/api/drive/stats');
      stats.value = data;
    } catch (err) {
      console.warn('Failed to load drive stats:', err);
    }
  };

  const loadFiles = async (folderId = currentFolderId.value, search = searchKeyword.value) => {
    isLoading.value = true;
    error.value = '';
    clearSelection();
    try {
      currentFolderId.value = folderId;
      const params = new URLSearchParams();
      if (folderId) params.set('parentId', folderId);
      if (search) params.set('search', search);

      const data = await apiFetch(`/api/drive/files?${params.toString()}`);
      files.value = data.files || [];
      breadcrumbs.value = data.breadcrumbs || [];
      return data;
    } catch (err) {
      error.value = err.message || '加载文件失败';
    } finally {
      isLoading.value = false;
    }
  };

  const loadRecentFiles = async (limit = 50) => {
    isLoadingRecent.value = true;
    try {
      const res = await apiFetch(`/api/drive/files/recent?limit=${limit}`);
      recentList.value = res.files || [];
      return recentList.value;
    } finally {
      isLoadingRecent.value = false;
    }
  };

  const createFolder = async (name) => {
    if (!name?.trim()) return false;
    try {
      await apiFetch('/api/drive/files/folder', {
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), parentId: currentFolderId.value })
      });
      await loadFiles();
      await loadStats();
      return true;
    } catch (err) {
      alert(err.message || '创建文件夹失败');
      return false;
    }
  };

  const renameItem = async (fileId, newName) => {
    if (!newName?.trim()) return false;
    try {
      await apiFetch(`/api/drive/files/${encodeURIComponent(fileId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: newName.trim() })
      });
      await loadFiles();
      return true;
    } catch (err) {
      alert(err.message || '重命名失败');
      return false;
    }
  };

  const moveItem = async (fileId, targetParentId) => {
    try {
      await apiFetch(`/api/drive/files/${encodeURIComponent(fileId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ parentId: targetParentId || null })
      });
      await loadFiles();
      return true;
    } catch (err) {
      alert(err.message || '移动失败');
      return false;
    }
  };

  const copyItem = async (fileId, targetParentId = currentFolderId.value) => {
    try {
      await apiFetch(`/api/drive/files/${encodeURIComponent(fileId)}/copy`, {
        method: 'POST',
        body: JSON.stringify({ targetParentId })
      });
      await loadFiles();
      await loadStats();
      return true;
    } catch (err) {
      alert(err.message || '创建副本失败');
      return false;
    }
  };

  const deleteItem = async (fileId) => {
    try {
      await apiFetch(`/api/drive/files/${encodeURIComponent(fileId)}`, {
        method: 'DELETE'
      });
      await loadFiles();
      await loadStats();
      return true;
    } catch (err) {
      alert(err.message || '删除失败');
      return false;
    }
  };

  // Batch actions
  const batchDelete = async (fileIds = Array.from(selectedFileIds.value)) => {
    if (!fileIds || fileIds.length === 0) return;
    if (!confirm(`确定要将选中的 ${fileIds.length} 个项目移入回收站吗？`)) return;

    try {
      for (const id of fileIds) {
        await apiFetch(`/api/drive/files/${encodeURIComponent(id)}`, {
          method: 'DELETE'
        });
      }
      clearSelection();
      await loadFiles();
      await loadStats();
    } catch (err) {
      alert(err.message || '批量删除失败');
    }
  };

  const batchMove = async (targetParentId, fileIds = Array.from(selectedFileIds.value)) => {
    if (!fileIds || fileIds.length === 0) return;

    try {
      for (const id of fileIds) {
        await apiFetch(`/api/drive/files/${encodeURIComponent(id)}`, {
          method: 'PATCH',
          body: JSON.stringify({ parentId: targetParentId || null })
        });
      }
      clearSelection();
      await loadFiles();
    } catch (err) {
      alert(err.message || '批量移动失败');
    }
  };

  // Text/Markdown File Content Updates
  const updateFileContent = async (fileId, content) => {
    return apiFetch(`/api/drive/files/${encodeURIComponent(fileId)}/content`, {
      method: 'PUT',
      body: JSON.stringify({ content })
    });
  };

  const uploadFileTask = async (file, targetParentId = null) => {
    const task = {
      id: crypto.randomUUID(),
      name: file.name,
      size: file.size,
      loaded: 0,
      progress: 0,
      speed: '',
      status: 'uploading',
      error: ''
    };
    uploadQueue.value.unshift(task);

    try {
      const parentId = targetParentId !== null && targetParentId !== undefined
        ? targetParentId
        : currentFolderId.value;

      const ticket = await apiFetch('/api/drive/files/upload-ticket', {
        method: 'POST',
        body: JSON.stringify({
          name: file.name,
          size: file.size,
          mimeType: file.type || 'application/octet-stream',
          parentId
        })
      });

      let gdriveFileId = null;
      await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        const uploadTargetUrl = ticket.directWorkerUpload && ticket.uploadUrl.startsWith('/api')
          ? `${api.getBasePrefix()}${ticket.uploadUrl}`
          : ticket.uploadUrl;
        xhr.open(ticket.method || 'PUT', uploadTargetUrl);

        if (ticket.headers) {
          Object.entries(ticket.headers).forEach(([k, v]) => {
            xhr.setRequestHeader(k, v);
          });
        }

        if (ticket.directWorkerUpload) {
          const token = getAuthToken();
          if (token) {
            xhr.setRequestHeader('Authorization', `Bearer ${token}`);
          }
        }

        let lastTime = Date.now();
        let lastLoaded = 0;

        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            task.loaded = e.loaded;
            task.progress = Math.round((e.loaded / e.total) * 100);

            const now = Date.now();
            const timeDiff = (now - lastTime) / 1000;
            if (timeDiff >= 0.25) {
              const loadedDiff = e.loaded - lastLoaded;
              const speedBytes = loadedDiff / timeDiff;
              task.speed = formatSpeed(speedBytes);
              lastTime = now;
              lastLoaded = e.loaded;
            }
          }
        };

        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            if (xhr.responseText) {
              try {
                const parsed = JSON.parse(xhr.responseText);
                if (parsed?.id) {
                  gdriveFileId = String(parsed.id);
                }
              } catch (_) {}
            }
            task.loaded = file.size;
            task.progress = 100;
            task.speed = '';
            resolve();
          } else {
            reject(new Error(`上传失败 (${xhr.status}): ${xhr.responseText || xhr.statusText}`));
          }
        };

        xhr.onerror = () => reject(new Error('网络传输中断'));
        xhr.send(file);
      });

      await apiFetch('/api/drive/files/confirm', {
        method: 'POST',
        body: JSON.stringify({
          fileId: ticket.fileId,
          actualSize: file.size,
          gdriveFileId
        })
      });

      task.progress = 100;
      task.status = 'success';
      task.speed = '';
      await loadFiles();
      await loadStats();
    } catch (err) {
      task.status = 'error';
      task.speed = '';
      task.error = err.message || '上传失败';
    }
  };

  const uploadFolderItems = async (items, targetParentId = null) => {
    const arr = Array.from(items || []);
    if (arr.length === 0) return;

    const dirSet = new Set();
    const fileItems = [];

    for (const item of arr) {
      const rel = (item.relPath || item.file?.webkitRelativePath || item.file?.name || item.name || '').replace(/\\/g, '/').replace(/^\/+/, '');
      if (!rel) continue;

      if (item.isEmptyFolder || rel.endsWith('/')) {
        const folderPath = rel.replace(/\/+$/, '');
        if (folderPath) {
          const segs = folderPath.split('/').filter(Boolean);
          let acc = '';
          for (const s of segs) {
            acc = acc ? `${acc}/${s}` : s;
            dirSet.add(acc);
          }
        }
      } else {
        const fileObj = item.file || item;
        const segs = rel.split('/').filter(Boolean);
        segs.pop();
        let acc = '';
        for (const s of segs) {
          acc = acc ? `${acc}/${s}` : s;
          dirSet.add(acc);
        }
        fileItems.push({ file: fileObj, dirPath: segs.join('/') });
      }
    }

    const sortedDirs = Array.from(dirSet).sort((a, b) => a.split('/').length - b.split('/').length);
    const createdFolderIds = new Map();
    const baseParentId = targetParentId !== null && targetParentId !== undefined ? targetParentId : currentFolderId.value;
    createdFolderIds.set('', baseParentId);

    for (const dirPath of sortedDirs) {
      const segments = dirPath.split('/').filter(Boolean);
      let parentId = baseParentId;
      let acc = '';
      for (const seg of segments) {
        acc = acc ? `${acc}/${seg}` : seg;
        if (createdFolderIds.has(acc)) {
          parentId = createdFolderIds.get(acc);
        } else {
          try {
            const folderRes = await apiFetch('/api/drive/files/folder', {
              method: 'POST',
              body: JSON.stringify({ name: seg, parentId, getOrCreate: true })
            });
            if (folderRes?.folder?.id) {
              parentId = folderRes.folder.id;
              createdFolderIds.set(acc, parentId);
            }
          } catch {
            try {
              const listRes = await apiFetch(`/api/drive/files?parentId=${encodeURIComponent(parentId || '')}`);
              const existing = (listRes.files || []).find((f) => f.is_folder && f.name === seg);
              if (existing?.id) {
                parentId = existing.id;
                createdFolderIds.set(acc, parentId);
              }
            } catch (_) {}
          }
        }
      }
    }

    for (const item of fileItems) {
      const folderId = createdFolderIds.get(item.dirPath) ?? baseParentId;
      void uploadFileTask(item.file, folderId);
    }

    await loadFiles();
  };

  const uploadFiles = (fileList, targetParentId = null) => {
    const arr = Array.from(fileList || []);
    const hasFolderRelPath = arr.some((f) => f?.webkitRelativePath?.includes('/'));
    if (hasFolderRelPath) {
      const items = arr.map((f) => ({ file: f, relPath: f.webkitRelativePath }));
      void uploadFolderItems(items, targetParentId);
      return;
    }
    for (const file of arr) {
      void uploadFileTask(file, targetParentId);
    }
  };

  const createShare = async (fileId, options = {}) => {
    return apiFetch('/api/drive/shares', {
      method: 'POST',
      body: JSON.stringify({
        fileId,
        permission: options.permission || 'view',
        expiresDays: options.expiresDays || 0,
        password: options.password || null
      })
    });
  };

  const loadShares = async () => {
    isLoadingShares.value = true;
    try {
      const res = await apiFetch('/api/drive/shares');
      sharesList.value = res.shares || [];
      return sharesList.value;
    } finally {
      isLoadingShares.value = false;
    }
  };

  const revokeShare = async (token) => {
    await apiFetch(`/api/drive/shares/${encodeURIComponent(token)}`, {
      method: 'DELETE'
    });
    await loadShares();
  };

  // Member Shares (站内协同分享)
  const loadSharedWithMe = async () => {
    isLoadingShared.value = true;
    try {
      const res = await apiFetch('/api/drive/member-shares/shared-with-me');
      sharedWithMeList.value = res.sharedFiles || [];
      return sharedWithMeList.value;
    } finally {
      isLoadingShared.value = false;
    }
  };

  const loadShareCandidates = async () => {
    return apiFetch('/api/drive/member-shares/candidates');
  };

  const loadMemberShares = async (fileId) => {
    const res = await apiFetch(`/api/drive/member-shares/file/${encodeURIComponent(fileId)}`);
    return res.shares || [];
  };

  const createMemberShare = async (fileId, targetTypeOrTargets, targetIdOrPermission, maybePermission = 'read') => {
    let payload;
    if (Array.isArray(targetTypeOrTargets)) {
      const perm = (typeof targetIdOrPermission === 'string' && targetIdOrPermission)
        ? targetIdOrPermission
        : (maybePermission || 'read');
      payload = {
        fileId,
        targets: targetTypeOrTargets,
        permission: perm
      };
    } else {
      payload = {
        fileId,
        targetType: targetTypeOrTargets,
        targetId: targetIdOrPermission,
        permission: maybePermission || 'read'
      };
    }
    return apiFetch('/api/drive/member-shares', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  };

  const revokeMemberShare = async (shareId) => {
    return apiFetch(`/api/drive/member-shares/${encodeURIComponent(shareId)}`, {
      method: 'DELETE'
    });
  };

  // Trash actions
  const loadTrash = async () => {
    isLoadingTrash.value = true;
    try {
      const res = await apiFetch('/api/drive/trash');
      trashList.value = res.trash || [];
      return trashList.value;
    } finally {
      isLoadingTrash.value = false;
    }
  };

  const restoreTrashItem = async (fileId) => {
    await apiFetch(`/api/drive/trash/${encodeURIComponent(fileId)}/restore`, {
      method: 'POST'
    });
    await loadTrash();
    await loadFiles();
    await loadStats();
  };

  const purgeTrashItem = async (fileId) => {
    await apiFetch(`/api/drive/trash/${encodeURIComponent(fileId)}`, {
      method: 'DELETE'
    });
    await loadTrash();
    await loadStats();
  };

  const emptyTrash = async () => {
    await apiFetch('/api/drive/trash', {
      method: 'DELETE'
    });
    await loadTrash();
    await loadStats();
  };

  const loadAppPasswords = async () => {
    const res = await apiFetch('/api/drive/app-passwords');
    return res.appPasswords || [];
  };

  const createAppPassword = async (name) => {
    return apiFetch('/api/drive/app-passwords', {
      method: 'POST',
      body: JSON.stringify({ name })
    });
  };

  const deleteAppPassword = async (id) => {
    return apiFetch(`/api/drive/app-passwords/${encodeURIComponent(id)}`, {
      method: 'DELETE'
    });
  };

  return {
    files,
    sortedFiles,
    breadcrumbs,
    currentFolderId,
    isLoading,
    searchKeyword,
    viewMode,
    sortBy,
    sortOrder,
    setSort,
    selectedFileIds,
    isMultiSelectMode,
    toggleSelectFile,
    selectAllFiles,
    clearSelection,
    selectRangeFiles,
    batchDelete,
    batchMove,
    moveItem,
    updateFileContent,
    stats,
    uploadQueue,
    error,
    quotaPercent,
    trashList,
    isLoadingTrash,
    sharesList,
    isLoadingShares,
    sharedWithMeList,
    isLoadingShared,
    recentList,
    isLoadingRecent,
    loadRecentFiles,
    setViewMode,
    loadStats,
    loadFiles,
    createFolder,
    renameItem,
    copyItem,
    deleteItem,
    uploadFiles,
    uploadFolderItems,
    createShare,
    loadShares,
    revokeShare,
    loadSharedWithMe,
    loadShareCandidates,
    loadMemberShares,
    createMemberShare,
    revokeMemberShare,
    loadTrash,
    restoreTrashItem,
    purgeTrashItem,
    emptyTrash,
    loadAppPasswords,
    createAppPassword,
    deleteAppPassword
  };
}
