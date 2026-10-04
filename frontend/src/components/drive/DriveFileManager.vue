<script setup>
import { ref, onMounted, onBeforeUnmount, computed, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useCloudDrive, formatBytes, formatSpeed } from '../../composables/useCloudDrive.js';
import DriveUploadModal from './DriveUploadModal.vue';
import DriveShareDialog from './DriveShareDialog.vue';
import DriveFilePreviewModal from './DriveFilePreviewModal.vue';
import DriveFolderSelectorModal from './DriveFolderSelectorModal.vue';
import UiAvatar from '../ui/Avatar.vue';
import api, { apiFetch, getAuthToken } from '../../api.js';
import { getEdgeChatServerOrigin, isCapacitorAndroid } from '../../capacitor-platform.js';
import { registerBackHandler } from '../../back-navigation.js';
import { createZipArchive, downloadZipArchive } from '../../utils/archiveUtils.js';

const route = useRoute();

const {
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
  stats,
  uploadQueue,
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
  loadTrash,
  restoreTrashItem,
  purgeTrashItem,
  emptyTrash
} = useCloudDrive();

const activeTab = ref('files'); // 'files' | 'recent' | 'shared' | 'shares' | 'trash'
const fileInputRef = ref(null);
const folderInputRef = ref(null);
const isDragOver = ref(false);
const activeShareFile = ref(null);
const previewFile = ref(null);
const showUploadQueue = ref(true);
const copiedShareToken = ref('');

const showMoveModal = ref(false);
const moveTargetIds = ref([]);
const moveModalTitle = ref('移动文件到目标目录');

const openBatchMoveModal = () => {
  if (selectedFileIds.value.size === 0) return;
  moveTargetIds.value = Array.from(selectedFileIds.value);
  moveModalTitle.value = `移动 ${moveTargetIds.value.length} 个项目到目标目录`;
  showMoveModal.value = true;
};

const isBatchDownloading = ref(false);
const batchDownloadStatus = ref('downloading');
const batchDownloadCurrentName = ref('');
const batchDownloadIndex = ref(0);
const batchDownloadTotal = ref(0);
const batchDownloadSpeed = ref('');
const batchDownloadBytesLoaded = ref(0);
const batchDownloadPercent = computed(() => {
  if (batchDownloadTotal.value <= 0) return 0;
  return Math.min(100, Math.round((batchDownloadIndex.value / batchDownloadTotal.value) * 100));
});

const activeActionMenuFile = ref(null);
const actionMenuStyle = ref({});

const toggleActionMenu = (file, event) => {
  if (event) {
    if (typeof event.stopPropagation === 'function') event.stopPropagation();
    if (typeof event.preventDefault === 'function') event.preventDefault();
  }
  if (activeActionMenuFile.value?.id === file.id) {
    activeActionMenuFile.value = null;
    return;
  }
  const rect = event?.currentTarget?.getBoundingClientRect();
  const menuWidth = 180;
  const menuHeight = 290;

  let top = (rect ? rect.bottom : 0) + 4;
  if (top + menuHeight > window.innerHeight) {
    top = Math.max(10, (rect ? rect.top : 0) - menuHeight - 4);
  }

  let left = (rect ? rect.right : 0) - menuWidth;
  if (left < 10) {
    left = 10;
  } else if (left + menuWidth > window.innerWidth - 10) {
    left = window.innerWidth - menuWidth - 10;
  }

  actionMenuStyle.value = {
    top: `${top}px`,
    left: `${left}px`
  };
  activeActionMenuFile.value = file;
};

const closeActionMenu = () => {
  activeActionMenuFile.value = null;
};

const handleSortClick = (column) => {
  if (sortBy.value === column) {
    setSort(column, sortOrder.value === 'asc' ? 'desc' : 'asc');
  } else {
    setSort(column, column === 'name' ? 'asc' : 'desc');
  }
};

const handleMenuAction = (action, file) => {
  closeActionMenu();
  if (!file) return;
  if (action === 'preview') handlePreview(file);
  else if (action === 'download') handleDownload(file);
  else if (action === 'locate') handleLocateFile(file);
  else if (action === 'move') handleSingleMove(file);
  else if (action === 'share') activeShareFile.value = file;
  else if (action === 'copy') copyItem(file.id);
  else if (action === 'rename') handleRename(file);
  else if (action === 'delete') handleDelete(file);
};

const selectAllRecentFiles = () => {
  selectedFileIds.value = new Set(recentList.value.map((f) => f.id));
};

const lastSelectedFileId = ref(null);
const isScanningDownload = ref(false);
const showBatchDownloadModal = ref(false);
const batchDownloadStep = ref('confirm');
const batchDownloadManifest = ref({
  tasks: [],
  fileTasks: [],
  totalFiles: 0,
  totalFolders: 0,
  totalBytes: 0,
  zipName: ''
});

let downloadAbortController = null;

const handleRemoveManifestItem = (targetItem) => {
  const manifest = batchDownloadManifest.value;
  if (!manifest) return;

  const nextSelected = new Set(selectedFileIds.value);

  if (targetItem.isFolder) {
    const folderPrefix = targetItem.path;
    for (const t of manifest.tasks) {
      if (t.path === targetItem.path || t.path.startsWith(folderPrefix)) {
        if (t.id) nextSelected.delete(t.id);
      }
    }
    if (targetItem.id) nextSelected.delete(targetItem.id);
    manifest.tasks = manifest.tasks.filter((t) => t.path !== targetItem.path && !t.path.startsWith(folderPrefix));
  } else {
    if (targetItem.id) nextSelected.delete(targetItem.id);
    manifest.tasks = manifest.tasks.filter((t) => t.path !== targetItem.path);
  }

  selectedFileIds.value = nextSelected;

  const fileTasks = manifest.tasks.filter((t) => !t.isFolder);
  manifest.fileTasks = fileTasks;
  manifest.totalFiles = fileTasks.length;
  manifest.totalFolders = manifest.tasks.filter((t) => t.isFolder).length;
  manifest.totalBytes = fileTasks.reduce((acc, t) => acc + (t.size || 0), 0);
};

const cancelBatchDownload = () => {
  if (downloadAbortController) {
    downloadAbortController.abort();
    downloadAbortController = null;
  }
  isBatchDownloading.value = false;
  showBatchDownloadModal.value = false;
  batchDownloadStep.value = 'confirm';
};

const closeBatchDownloadModal = () => {
  if (isBatchDownloading.value) {
    if (!confirm('正在下载与打包中，确定要取消本次下载吗？')) return;
    cancelBatchDownload();
    return;
  }
  showBatchDownloadModal.value = false;
  batchDownloadStep.value = 'confirm';
};

const handleCheckboxToggle = (fileId, event) => {
  if (event) {
    event.stopPropagation();
    if (typeof window !== 'undefined') window.getSelection()?.removeAllRanges();
  }
  toggleSelectFile(fileId);
  lastSelectedFileId.value = fileId;
};

const handleItemClick = (file, event) => {
  if (!file) return;
  const currentList = activeTab.value === 'recent' ? recentList.value : sortedFiles.value;

  if (event.ctrlKey || event.metaKey) {
    event.preventDefault();
    if (typeof window !== 'undefined') window.getSelection()?.removeAllRanges();
    toggleSelectFile(file.id);
    lastSelectedFileId.value = file.id;
  } else if (event.shiftKey) {
    event.preventDefault();
    if (typeof window !== 'undefined') window.getSelection()?.removeAllRanges();
    if (lastSelectedFileId.value) {
      selectRangeFiles(lastSelectedFileId.value, file.id, currentList);
    } else {
      toggleSelectFile(file.id);
      lastSelectedFileId.value = file.id;
    }
  } else {
    lastSelectedFileId.value = file.id;
  }
};

const openBatchDownloadModal = async () => {
  if (selectedFileIds.value.size === 0) return;

  const currentList = activeTab.value === 'recent' ? recentList.value : files.value;
  const selectedItems = currentList.filter((f) => selectedFileIds.value.has(f.id));
  if (selectedItems.length === 0) return;

  isScanningDownload.value = true;
  batchDownloadStep.value = 'confirm';

  try {
    async function collectItems(folderId, currentRelPath) {
      const res = await apiFetch(`/api/drive/files?parentId=${encodeURIComponent(folderId)}`);
      const subItems = res.files || [];
      const tasks = [];
      if (subItems.length === 0) {
        tasks.push({ isFolder: true, name: currentRelPath.split('/').pop(), path: `${currentRelPath}/`, size: 0, is_folder: 1, status: 'pending', errorMsg: '' });
      }
      for (const sub of subItems) {
        const subPath = `${currentRelPath}/${sub.name}`;
        if (sub.is_folder) {
          const nested = await collectItems(sub.id, subPath);
          tasks.push(...nested);
        } else {
          tasks.push({ isFolder: false, id: sub.id, name: sub.name, path: subPath, size: Number(sub.size || 0), mime_type: sub.mime_type, is_folder: 0, status: 'pending', errorMsg: '' });
        }
      }
      return tasks;
    }

    const seenPaths = new Set();
    function getUniquePath(basePath) {
      let unique = basePath;
      let counter = 1;
      const extIdx = basePath.lastIndexOf('.');
      const base = extIdx > 0 ? basePath.slice(0, extIdx) : basePath;
      const ext = extIdx > 0 ? basePath.slice(extIdx) : '';
      while (seenPaths.has(unique)) {
        unique = `${base} (${counter})${ext}`;
        counter++;
      }
      seenPaths.add(unique);
      return unique;
    }

    const downloadTasks = [];
    for (const item of selectedItems) {
      const uniqueRootName = getUniquePath(item.name);
      if (item.is_folder) {
        const folderTasks = await collectItems(item.id, uniqueRootName);
        downloadTasks.push(...folderTasks);
      } else {
        downloadTasks.push({ isFolder: false, id: item.id, name: item.name, path: uniqueRootName, size: Number(item.size || 0), mime_type: item.mime_type, is_folder: 0, status: 'pending', errorMsg: '' });
      }
    }

    if (downloadTasks.length === 0) {
      alert('没有可供下载的文件内容');
      return;
    }

    const fileTasks = downloadTasks.filter((t) => !t.isFolder);
    const totalFiles = fileTasks.length;
    const totalFolders = downloadTasks.filter((t) => t.isFolder).length;
    const totalBytes = fileTasks.reduce((acc, t) => acc + (t.size || 0), 0);

    let zipName = '网盘批量下载.zip';
    if (selectedItems.length === 1) {
      const first = selectedItems[0];
      zipName = first.is_folder ? `${first.name}.zip` : `${first.name.replace(/\.[^/.]+$/, '')}.zip`;
    } else {
      const now = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      const timeStr = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
      zipName = `网盘下载_${selectedItems[0].name}_等${selectedItems.length}项_${timeStr}.zip`;
    }

    batchDownloadManifest.value = {
      tasks: downloadTasks,
      fileTasks,
      totalFiles,
      totalFolders,
      totalBytes,
      zipName
    };

    showBatchDownloadModal.value = true;
  } catch (err) {
    console.error('Scan download items error:', err);
    alert(`扫描文件清单失败: ${err.message || '未知错误'}`);
  } finally {
    isScanningDownload.value = false;
  }
};

const executeBatchDownload = async () => {
  const manifest = batchDownloadManifest.value;
  if (!manifest || manifest.fileTasks.length === 0) return;

  isBatchDownloading.value = true;
  batchDownloadStep.value = 'downloading';
  batchDownloadStatus.value = 'downloading';
  batchDownloadCurrentName.value = '正在启动多线程下载管道 (4并发)...';
  batchDownloadIndex.value = 0;
  batchDownloadTotal.value = manifest.fileTasks.length || 1;
  batchDownloadSpeed.value = '';
  batchDownloadBytesLoaded.value = 0;
  let lastSpeedTime = Date.now();
  let lastSpeedBytes = 0;

  downloadAbortController = new AbortController();

  for (const t of manifest.tasks) {
    t.status = t.isFolder ? 'success' : 'pending';
    t.errorMsg = '';
  }

  try {
    const zipFilesMap = {};
    for (const task of manifest.tasks) {
      if (task.isFolder) {
        zipFilesMap[task.path] = new Uint8Array(0);
      }
    }

    const CONCURRENCY = 4;
    let completedCount = 0;
    let currentIndex = 0;

    async function downloadWorker() {
      while (currentIndex < manifest.fileTasks.length) {
        if (downloadAbortController?.signal.aborted) return;
        const task = manifest.fileTasks[currentIndex++];
        task.status = 'downloading';
        batchDownloadCurrentName.value = `(${completedCount + 1}/${manifest.fileTasks.length}) 正在并发下载: ${task.name}`;

        try {
          const downloadUrl = api.getDriveFileUrl(task.id, false);
          const res = await fetch(downloadUrl, { signal: downloadAbortController?.signal });
          if (!res.ok) {
            throw new Error(`HTTP ${res.status}`);
          }
          const arrayBuf = await res.arrayBuffer();
          batchDownloadBytesLoaded.value += arrayBuf.byteLength;
          const now = Date.now();
          const timeDiff = (now - lastSpeedTime) / 1000;
          if (timeDiff >= 0.25) {
            const byteDiff = batchDownloadBytesLoaded.value - lastSpeedBytes;
            batchDownloadSpeed.value = formatSpeed(byteDiff / timeDiff);
            lastSpeedTime = now;
            lastSpeedBytes = batchDownloadBytesLoaded.value;
          }
          zipFilesMap[task.path] = new Uint8Array(arrayBuf);
          task.status = 'success';
          completedCount++;
          batchDownloadIndex.value = completedCount;
        } catch (taskErr) {
          if (downloadAbortController?.signal.aborted) return;
          task.status = 'error';
          task.errorMsg = taskErr.message || '下载中断';
          console.warn(`Download subfile ${task.name} error:`, taskErr);
        }
      }
    }

    const workerPromises = Array.from(
      { length: Math.min(CONCURRENCY, manifest.fileTasks.length) },
      () => downloadWorker()
    );
    await Promise.all(workerPromises);

    if (downloadAbortController?.signal.aborted) return;

    const successTasks = manifest.fileTasks.filter((t) => t.status === 'success');
    if (successTasks.length === 0) {
      batchDownloadStep.value = 'error';
      throw new Error('所有文件下载均失败，请检查网络后重试');
    }

    batchDownloadStatus.value = 'compressing';
    batchDownloadStep.value = 'compressing';
    batchDownloadCurrentName.value = '正在纯客户端极速压缩组装 ZIP 文件...';

    const zipBytes = await createZipArchive(zipFilesMap);

    if (downloadAbortController?.signal.aborted) return;

    downloadZipArchive(zipBytes, manifest.zipName || '网盘批量下载.zip');
    batchDownloadStep.value = 'completed';
  } catch (err) {
    if (downloadAbortController?.signal.aborted) return;
    batchDownloadStep.value = 'error';
    console.error('Batch download execution error:', err);
    alert(`批量下载失败: ${err.message || '未知错误'}`);
  } finally {
    isBatchDownloading.value = false;
  }
};

const handleBatchDownload = openBatchDownloadModal;

const handleSingleMove = (file) => {
  moveTargetIds.value = [file.id];
  moveModalTitle.value = `移动「${file.name}」到目标目录`;
  showMoveModal.value = true;
};

const handleMoveConfirm = async ({ folderId, folderName }) => {
  await batchMove(folderId, moveTargetIds.value);
  showMoveModal.value = false;
  alert(`已成功移动到「${folderName}」！`);
};

// Debounced search
let searchTimer = null;
watch(searchKeyword, (val) => {
  if (activeTab.value !== 'files') return;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    loadFiles(currentFolderId.value, val);
  }, 300);
});

const applyRouteQuery = async () => {
  const queryTab = String(route?.query?.tab || '').toLowerCase();
  const queryFolderId = route?.query?.folderId ? String(route.query.folderId) : null;
  const queryFileId = route?.query?.fileId ? String(route.query.fileId) : null;
  const queryFileName = route?.query?.name ? String(route.query.name) : '';
  const isManageShare = route?.query?.manageShare === '1';

  if (queryTab && ['files', 'recent', 'shared', 'shares', 'trash'].includes(queryTab)) {
    activeTab.value = queryTab;
  }

  if (queryFolderId) {
    activeTab.value = 'files';
    await loadFiles(queryFolderId);
  } else if (activeTab.value === 'files') {
    await loadFiles(currentFolderId.value);
  } else if (activeTab.value === 'recent') {
    await loadRecentFiles();
  } else if (activeTab.value === 'shared') {
    await loadSharedWithMe();
  }

  if (queryFileId) {
    if (isManageShare) {
      const target = files.value.find((f) => String(f.id) === queryFileId) || {
        id: queryFileId,
        name: queryFileName || '共享管理',
        is_folder: route?.query?.isFolder === '1'
      };
      activeShareFile.value = target;
    } else if (activeTab.value === 'shared') {
      const target = sharedWithMeList.value.find((f) => String(f.file_id) === queryFileId);
      if (target && !target.is_folder) {
        handlePreview({ id: target.file_id, name: target.file_name, mime_type: target.mime_type, size: target.size });
      } else if (!target) {
        handlePreview({ id: queryFileId, name: queryFileName || '文件预览', mime_type: '', size: 0 });
      }
    } else if (activeTab.value === 'files') {
      const target = files.value.find((f) => String(f.id) === queryFileId);
      if (target && !target.is_folder) {
        handlePreview(target);
      } else if (!target) {
        handlePreview({ id: queryFileId, name: queryFileName || '文件预览', mime_type: '', size: 0 });
      }
    }
  }
};

let unregisterDriveBackHandler = null;

onMounted(async () => {
  window.addEventListener('dragover', handleWindowDragOver);
  window.addEventListener('dragleave', handleWindowDragLeave);
  window.addEventListener('drop', handleWindowCancelDrag);
  window.addEventListener('dragend', handleWindowCancelDrag);
  window.addEventListener('keydown', handleWindowKeydown);
  window.addEventListener('click', closeActionMenu);
  window.addEventListener('scroll', closeActionMenu, true);
  window.addEventListener('resize', closeActionMenu);

  unregisterDriveBackHandler = registerBackHandler(40, () => {
    if (previewFile.value) {
      previewFile.value = null;
      return true;
    }
    if (activeTab.value !== 'files') {
      activeTab.value = 'files';
      return true;
    }
    if (currentFolderId.value) {
      const crumbs = breadcrumbs.value || [];
      const parentId = crumbs.length > 1 ? crumbs[crumbs.length - 2].id : null;
      handleNavigate(parentId);
      return true;
    }
    return false;
  });

  await Promise.all([loadStats(), loadShares(), loadTrash(), loadSharedWithMe()]);
  await applyRouteQuery();
});

onBeforeUnmount(() => {
  if (unregisterDriveBackHandler) {
    unregisterDriveBackHandler();
    unregisterDriveBackHandler = null;
  }
  window.removeEventListener('dragover', handleWindowDragOver);
  window.removeEventListener('dragleave', handleWindowDragLeave);
  window.removeEventListener('drop', handleWindowCancelDrag);
  window.removeEventListener('dragend', handleWindowCancelDrag);
  window.removeEventListener('keydown', handleWindowKeydown);
  window.removeEventListener('click', closeActionMenu);
  window.removeEventListener('scroll', closeActionMenu, true);
  window.removeEventListener('resize', closeActionMenu);
});

watch(
  () => route?.query,
  async () => {
    await applyRouteQuery();
  }
);

const handleSwitchTab = async (tab) => {
  activeTab.value = tab;
  if (tab === 'files') {
    searchKeyword.value = '';
    await loadFiles(null);
  } else if (tab === 'recent') {
    await loadRecentFiles();
  } else if (tab === 'shared') {
    await loadSharedWithMe();
  } else if (tab === 'shares') {
    await loadShares();
  } else if (tab === 'trash') {
    await loadTrash();
  }
};

const handleNavigate = (folderId) => {
  searchKeyword.value = '';
  loadFiles(folderId);
};

const handleOpenSharedFolder = (item) => {
  activeTab.value = 'files';
  handleNavigate(item.file_id);
};

const handleLocateFile = (file) => {
  activeTab.value = 'files';
  handleNavigate(file.parent_id || null);
};

const handleNewFolder = async () => {
  const name = prompt('请输入新建文件夹名称:');
  if (name) {
    await createFolder(name);
  }
};

const handleRename = async (file) => {
  const name = prompt('请输入新名称:', file.name);
  if (name && name !== file.name) {
    await renameItem(file.id, name);
  }
};

const handleDelete = async (file) => {
  const tip = file.is_folder
    ? `确定要将文件夹「${file.name}」及其内部所有文件放入回收站吗？`
    : `确定要将文件「${file.name}」放入回收站吗？`;
  if (confirm(tip)) {
    await deleteItem(file.id);
    await loadTrash();
  }
};

const handleRestore = async (item) => {
  try {
    await restoreTrashItem(item.id);
    alert(`已成功还原「${item.name}」`);
  } catch (err) {
    alert(`还原失败: ${err.message || '未知错误'}`);
  }
};

const handlePurge = async (item) => {
  if (confirm(`确定要彻底删除「${item.name}」吗？此操作无法撤销，物理存储将被永久清除！`)) {
    try {
      await purgeTrashItem(item.id);
    } catch (err) {
      alert(`删除失败: ${err.message || '未知错误'}`);
    }
  }
};

const handleEmptyTrash = async () => {
  if (trashList.value.length === 0) return;
  if (confirm('确定要清空回收站中所有文件吗？所有文件将被永久物理删除且无法恢复！')) {
    try {
      await emptyTrash();
      alert('回收站已清空');
    } catch (err) {
      alert(`清空失败: ${err.message || '未知错误'}`);
    }
  }
};

const handleCopyShareUrl = async (token) => {
  const origin = isCapacitorAndroid ? getEdgeChatServerOrigin() : window.location.origin;
  const prefix = api.getBasePrefix();
  const fullUrl = `${origin}${prefix}/s/${token}`;
  try {
    await navigator.clipboard.writeText(fullUrl);
    copiedShareToken.value = token;
    setTimeout(() => {
      copiedShareToken.value = '';
    }, 2000);
  } catch {
    alert('复制失败，请手动复制');
  }
};

const handleOpenShare = (token) => {
  const origin = isCapacitorAndroid ? getEdgeChatServerOrigin() : window.location.origin;
  const prefix = api.getBasePrefix();
  window.open(`${origin}${prefix}/s/${token}`, '_blank');
};

const handleRevokeShare = async (token) => {
  if (confirm('确定要撤销并废弃此分享链接吗？撤销后外部访问将立即失效。')) {
    try {
      await revokeShare(token);
    } catch (err) {
      alert(`撤销失败: ${err.message || '未知错误'}`);
    }
  }
};

const handleDownload = async (file) => {
  if (!file?.id) return;
  const downloadUrl = await api.ensureDriveFileUrl(file.id, false);
  const a = document.createElement('a');
  a.href = downloadUrl;
  a.download = file.name || 'download';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
};

const handlePreview = (file) => {
  previewFile.value = file;
};

const handleFileInputChange = (e) => {
  if (e.target.files?.length) {
    uploadFiles(e.target.files);
    e.target.value = '';
  }
};

const handleFolderInputChange = (e) => {
  if (e.target.files?.length) {
    uploadFiles(e.target.files);
    e.target.value = '';
  }
};

const handleFolderUploadClick = () => {
  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator?.userAgent || '')
    || (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(max-width: 768px)').matches && ('ontouchstart' in window || (navigator?.maxTouchPoints || 0) > 0));
  if (isMobile) {
    alert('移动端系统限制提示：\n\niOS 与 Android 移动系统不支持从网页直接选择文件夹上传。\n\n建议操作：\n1. 点击「新建文件夹」创建目标目录；\n2. 进入目录后，点击「上传文件」批量选取文件进行上传。');
    return;
  }
  folderInputRef.value?.click();
};

const extractDataTransferItems = async (e) => {
  const items = e.dataTransfer?.items;
  if (!items || items.length === 0) {
    return Array.from(e.dataTransfer?.files || []).map((f) => ({ file: f, relPath: f.name }));
  }

  const entries = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (typeof item.webkitGetAsEntry === 'function') {
      const entry = item.webkitGetAsEntry();
      if (entry) entries.push(entry);
    }
  }

  if (entries.length === 0) {
    return Array.from(e.dataTransfer?.files || []).map((f) => ({ file: f, relPath: f.name }));
  }

  async function readEntry(entry, path = '') {
    if (entry.isFile) {
      return new Promise((resolve) => {
        entry.file(
          (file) => {
            resolve([{ file, relPath: path ? `${path}/${file.name}` : file.name }]);
          },
          () => resolve([])
        );
      });
    } else if (entry.isDirectory) {
      const dirReader = entry.createReader();
      const subEntries = await new Promise((resolve) => {
        const acc = [];
        function readNext() {
          dirReader.readEntries(
            (batch) => {
              if (!batch || batch.length === 0) {
                resolve(acc);
              } else {
                acc.push(...batch);
                readNext();
              }
            },
            () => resolve(acc)
          );
        }
        readNext();
      });

      const currentPath = path ? `${path}/${entry.name}` : entry.name;
      const subTasks = [];
      if (subEntries.length === 0) {
        subTasks.push({ isEmptyFolder: true, relPath: `${currentPath}/` });
      }
      for (const child of subEntries) {
        const nested = await readEntry(child, currentPath);
        subTasks.push(...nested);
      }
      return subTasks;
    }
    return [];
  }

  const results = [];
  for (const entry of entries) {
    const res = await readEntry(entry, '');
    results.push(...res);
  }
  return results;
};

const dragOverFolderId = ref(null);
let dragCounter = 0;

const dragOverFolderItem = computed(() =>
  sortedFiles.value.find((f) => f.id === dragOverFolderId.value && f.is_folder)
);

const handleContainerDragEnter = (e) => {
  if (e.dataTransfer?.types?.includes('Files')) {
    dragCounter++;
    isDragOver.value = true;
  }
};

const handleContainerDragOver = (e) => {
  e.preventDefault();
  if (!isDragOver.value) {
    isDragOver.value = true;
  }
  const folderEl = e.target?.closest?.('[data-folder-id]');
  if (folderEl) {
    const fId = folderEl.getAttribute('data-folder-id');
    if (fId && dragOverFolderId.value !== fId) {
      dragOverFolderId.value = fId;
    }
  } else if (!e.target?.closest?.('.file-grid-card, .drive-table-row')) {
    if (dragOverFolderId.value !== null) {
      dragOverFolderId.value = null;
    }
  }
};

const handleContainerDragLeave = (e) => {
  if (e?.currentTarget && e.relatedTarget && e.currentTarget.contains(e.relatedTarget)) {
    return;
  }
  dragCounter--;
  if (dragCounter <= 0) {
    dragCounter = 0;
    isDragOver.value = false;
    dragOverFolderId.value = null;
  }
};

const handleFolderDragEnter = (folderId, e) => {
  if (e) {
    e.preventDefault?.();
    e.stopPropagation?.();
  }
  dragOverFolderId.value = folderId;
};

const handleFolderDragOver = (folderId, e) => {
  if (e) {
    e.preventDefault?.();
    e.stopPropagation?.();
  }
  dragOverFolderId.value = folderId;
};

const handleFolderDragLeave = (folderId, e) => {
  if (e?.currentTarget && e.relatedTarget && e.currentTarget.contains(e.relatedTarget)) {
    return;
  }
  if (dragOverFolderId.value === folderId) {
    dragOverFolderId.value = null;
  }
};

const handleFolderDrop = async (folderId, e) => {
  if (e) {
    e.preventDefault?.();
    e.stopPropagation?.();
  }
  isDragOver.value = false;
  dragCounter = 0;
  dragOverFolderId.value = null;
  const items = await extractDataTransferItems(e);
  if (items.length) {
    uploadFolderItems(items, folderId);
  }
};

const handleDrop = async (e) => {
  if (e) {
    e.preventDefault?.();
    e.stopPropagation?.();
  }
  isDragOver.value = false;
  dragCounter = 0;
  const targetId = dragOverFolderId.value;
  dragOverFolderId.value = null;
  const items = await extractDataTransferItems(e);
  if (items.length) {
    uploadFolderItems(items, targetId || null);
  }
};

const handleWindowDragOver = (e) => {
  e.preventDefault();
};

const handleWindowDragLeave = (e) => {
  if (
    !e.relatedTarget ||
    e.clientX <= 0 ||
    e.clientY <= 0 ||
    e.clientX >= window.innerWidth ||
    e.clientY >= window.innerHeight
  ) {
    isDragOver.value = false;
    dragCounter = 0;
    dragOverFolderId.value = null;
  }
};

const handleWindowCancelDrag = () => {
  isDragOver.value = false;
  dragCounter = 0;
  dragOverFolderId.value = null;
};

const handleWindowKeydown = (e) => {
  if (e.key === 'Escape') {
    handleWindowCancelDrag();
    closeActionMenu();
    if (isMultiSelectMode.value) {
      clearSelection();
    }
    return;
  }

  const activeEl = document.activeElement;
  const isInput = activeEl && ['INPUT', 'TEXTAREA', 'SELECT'].includes(activeEl.tagName);
  if (isInput || previewFile.value || showMoveModal.value || activeShareFile.value || isBatchDownloading.value) {
    return;
  }

  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
    if (activeTab.value === 'files' || activeTab.value === 'recent') {
      e.preventDefault();
      if (activeTab.value === 'recent') {
        selectAllRecentFiles();
      } else {
        selectAllFiles();
      }
    }
  } else if (e.key === 'Delete' || e.key === 'Backspace') {
    if (isMultiSelectMode.value && (activeTab.value === 'files' || activeTab.value === 'recent')) {
      e.preventDefault();
      void batchDelete();
    }
  }
};

const getFileIcon = (file) => {
  if (file.is_folder) return '📁';
  const mime = file.mime_type || '';
  const ext = (file.name?.split('.').pop() || '').toLowerCase();

  if (mime.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif'].includes(ext)) return '🖼️';
  if (mime.startsWith('video/') || ['mp4', 'mkv', 'webm', 'mov', 'avi'].includes(ext)) return '🎬';
  if (mime.startsWith('audio/') || ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac'].includes(ext)) return '🎵';
  if (ext === 'pdf' || mime.includes('pdf')) return '📕';
  if (['md', 'markdown'].includes(ext)) return '📖';
  if (['csv', 'tsv'].includes(ext)) return '📊';
  if (['docx', 'doc', 'xlsx', 'xls', 'pptx', 'ppt'].includes(ext)) return '📑';
  if (['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz'].includes(ext)) return '📦';
  if (['js', 'ts', 'jsx', 'tsx', 'vue', 'json', 'py', 'go', 'rs', 'java', 'c', 'cpp', 'h', 'hpp', 'cs', 'php', 'rb', 'html', 'htm', 'css', 'scss', 'sql', 'sh', 'bash', 'yaml', 'yml', 'toml', 'ini', 'env', 'log', 'txt'].includes(ext)) return '📝';
  return '📄';
};

const isPreviewable = (file) => {
  if (!file || file.is_folder) return false;
  return true;
};

const formatPermission = (p) => {
  if (p === 'upload') return '仅允许上传';
  if (p === 'view_upload') return '读写协同';
  return '仅查看与下载';
};
</script>

<template>
  <div
    class="drive-manager-container"
    :class="{ 'is-dragging': isDragOver }"
    @dragenter.prevent="handleContainerDragEnter"
    @dragover.prevent="handleContainerDragOver"
    @dragleave.prevent="handleContainerDragLeave"
    @drop.stop.prevent="handleDrop"
  >
    <!-- Hidden file input for uploads -->
    <input
      ref="fileInputRef"
      type="file"
      multiple
      class="hidden-file-input"
      @change="handleFileInputChange"
    />

    <!-- Hidden folder input for directory uploads -->
    <input
      ref="folderInputRef"
      type="file"
      webkitdirectory
      directory
      multiple
      class="hidden-file-input"
      @change="handleFolderInputChange"
    />

    <!-- Full-screen semi-transparent drag overlay -->
    <Transition name="drag-fade">
      <div
        v-if="isDragOver && (activeTab === 'files' || activeTab === 'recent')"
        class="drag-overlay"
      >
        <div class="drag-dropzone-box" :class="{ 'drag-dropzone-box--folder': dragOverFolderItem }">
          <div class="drag-dropzone-icon">
            <span>{{ dragOverFolderItem ? '📁' : '📤' }}</span>
          </div>
          <div class="drag-dropzone-text">
            <h3 class="drag-dropzone-title">
              {{ dragOverFolderItem ? `放入文件夹「${dragOverFolderItem.name}」` : '松开鼠标上传到当前网盘' }}
            </h3>
            <p class="drag-dropzone-subtitle">
              {{ dragOverFolderItem ? '松开鼠标即可直接保存至该子文件夹内部' : '可将文件直接拖入上方特定文件夹，或拖至空白处上传' }}
            </p>
          </div>
        </div>
      </div>
    </Transition>

    <!-- LEFT SIDEBAR -->
    <aside class="drive-sidebar">
      <!-- Quick Action Buttons -->
      <div class="sidebar-action-group">
        <button type="button" class="sidebar-upload-btn" title="批量多选上传文件" @click="fileInputRef?.click()">
          <span class="btn-icon">📤</span>
          <span>上传文件</span>
        </button>
        <button type="button" class="sidebar-folder-upload-btn" title="选择并上传整个文件夹" @click="handleFolderUploadClick">
          <span class="btn-icon">📂</span>
          <span>上传文件夹</span>
        </button>
        <button type="button" class="sidebar-new-folder-btn" title="新建空白文件夹" @click="handleNewFolder">
          <span class="btn-icon">📁</span>
          <span>新建文件夹</span>
        </button>
      </div>

      <!-- Navigation Menu -->
      <nav class="drive-nav-menu">
        <button type="button"
          class="nav-menu-item"
          :class="{ active: activeTab === 'files' }"
          @click="handleSwitchTab('files')"
        >
          <span class="menu-icon">📁</span>
          <span class="menu-label">我的文件</span>
        </button>
        <button type="button"
          class="nav-menu-item"
          :class="{ active: activeTab === 'recent' }"
          @click="handleSwitchTab('recent')"
        >
          <span class="menu-icon">🕒</span>
          <span class="menu-label">最近新增</span>
        </button>
        <button type="button"
          class="nav-menu-item"
          :class="{ active: activeTab === 'shared' }"
          @click="handleSwitchTab('shared')"
        >
          <span class="menu-icon">👥</span>
          <span class="menu-label">与我共享</span>
          <span v-if="sharedWithMeList.length > 0" class="menu-badge">{{ sharedWithMeList.length }}</span>
        </button>
        <button type="button"
          class="nav-menu-item"
          :class="{ active: activeTab === 'shares' }"
          @click="handleSwitchTab('shares')"
        >
          <span class="menu-icon">🔗</span>
          <span class="menu-label">我的分享</span>
          <span v-if="sharesList.length > 0" class="menu-badge">{{ sharesList.length }}</span>
        </button>
        <button type="button"
          class="nav-menu-item"
          :class="{ active: activeTab === 'trash' }"
          @click="handleSwitchTab('trash')"
        >
          <span class="menu-icon">🗑️</span>
          <span class="menu-label">回收站</span>
          <span v-if="trashList.length > 0" class="menu-badge">{{ trashList.length }}</span>
        </button>
      </nav>

      <!-- Bottom Quota Card -->
      <div class="sidebar-quota-card">
        <div class="quota-header">
          <span class="quota-title">存储空间</span>
          <span class="quota-percent">{{ quotaPercent }}%</span>
        </div>
        <div class="quota-progress-bar">
          <div class="quota-progress-fill" :style="{ width: `${quotaPercent}%` }"></div>
        </div>
        <div class="quota-detail">
          <span>{{ formatBytes(stats.usedBytes) }}</span>
          <span class="quota-sep">/</span>
          <span>{{ formatBytes(stats.quotaBytes) }}</span>
        </div>
      </div>
    </aside>

    <!-- RIGHT MAIN SECTION -->
    <section class="drive-main-section">
      <!-- TAB 1: FILES VIEW -->
      <template v-if="activeTab === 'files'">
        <!-- Top Action Toolbar -->
        <div class="drive-toolbar">
          <!-- Breadcrumbs -->
          <div class="drive-breadcrumbs">
            <button type="button" class="breadcrumb-item" :class="{ active: !currentFolderId }" @click="handleNavigate(null)">
              根目录
            </button>
            <template v-for="bc in breadcrumbs" :key="bc.id">
              <span class="breadcrumb-sep">/</span>
              <button type="button"
                class="breadcrumb-item"
                :class="{ active: bc.id === currentFolderId }"
                @click="handleNavigate(bc.id)"
              >
                {{ bc.name }}
              </button>
            </template>
          </div>

          <!-- Actions -->
          <div class="drive-toolbar-actions">
            <div class="search-box">
              <input
                v-model="searchKeyword"
                type="text"
                placeholder="搜索当前目录..."
                class="search-input"
              />
              <span v-if="searchKeyword" class="search-clear" @click="searchKeyword = ''">×</span>
            </div>

            <!-- Sort dropdown and direction -->
            <div class="sort-picker">
              <select
                :value="sortBy"
                class="sort-select"
                title="选择排序维度"
                @change="setSort($event.target.value, sortOrder)"
              >
                <option value="updated_at">⏱️ 修改时间</option>
                <option value="name">🔤 文件名</option>
                <option value="size">📦 文件大小</option>
                <option value="type">📑 文件类型</option>
              </select>
              <button type="button"
                class="sort-order-btn"
                :title="sortOrder === 'asc' ? '切换为降序 (最新/最大在前)' : '切换为升序 (最早/最小在前)'"
                @click="setSort(sortBy)"
              >
                {{ sortOrder === 'asc' ? '↑ 升序' : '↓ 降序' }}
              </button>
            </div>

            <button type="button" class="action-btn action-btn-secondary" title="刷新文件列表" @click="loadFiles(currentFolderId)">
              <span>🔄</span> 刷新
            </button>

            <div class="view-mode-toggle">
              <button type="button"
                class="toggle-btn"
                :class="{ active: viewMode === 'grid' }"
                title="网格视图"
                @click="setViewMode('grid')"
              >
                ⊞
              </button>
              <button type="button"
                class="toggle-btn"
                :class="{ active: viewMode === 'list' }"
                title="列表视图"
                @click="setViewMode('list')"
              >
                ☰
              </button>
            </div>
          </div>
        </div>

        <!-- Content Area -->
        <div class="drive-content-area" :class="{ 'has-batch-bar': isMultiSelectMode }">
        <!-- Loading state -->
        <div v-if="isLoading" class="drive-loading-state">
          <div class="spinner"></div>
          <span>正在加载文件列表...</span>
        </div>

        <!-- Empty state -->
        <div v-else-if="sortedFiles.length === 0" class="drive-empty-state">
          <span class="empty-icon">📁</span>
          <span class="empty-title">当前文件夹为空</span>
          <span class="empty-subtitle">点击上方「上传文件」或拖拽文件至此区域</span>
        </div>

        <!-- Grid View -->
        <div v-else-if="viewMode === 'grid'" class="drive-grid-view">
          <div
            v-for="file in sortedFiles"
            :key="file.id"
            :data-folder-id="file.is_folder ? file.id : undefined"
            class="file-grid-card"
            :class="{
              'is-selected': selectedFileIds.has(file.id),
              'is-folder-drop-target': file.is_folder && dragOverFolderId === file.id
            }"
            @click="handleItemClick(file, $event)"
            @dblclick="file.is_folder ? handleNavigate(file.id) : handlePreview(file)"
            @dragenter.stop.prevent="file.is_folder ? handleFolderDragEnter(file.id) : null"
            @dragover.stop.prevent="file.is_folder ? handleFolderDragOver(file.id) : null"
            @dragleave.stop.prevent="file.is_folder ? handleFolderDragLeave(file.id, $event) : null"
            @drop.stop.prevent="file.is_folder ? handleFolderDrop(file.id, $event) : null"
          >
            <!-- Checkbox -->
            <div
              class="card-select-checkbox"
              :class="{ 'is-visible': isMultiSelectMode || selectedFileIds.has(file.id) }"
              @click.stop="handleCheckboxToggle(file.id, $event)"
            >
              <input type="checkbox" :checked="selectedFileIds.has(file.id)" />
            </div>

            <div class="file-card-preview" @click="file.is_folder ? handleNavigate(file.id) : handlePreview(file)">
              <span class="file-type-icon">{{ getFileIcon(file) }}</span>
            </div>

            <div class="file-card-info" @click="file.is_folder ? handleNavigate(file.id) : handlePreview(file)">
              <span class="file-card-name" :title="file.name">{{ file.name }}</span>
              <span class="file-card-meta">
                {{ file.is_folder ? '文件夹' : formatBytes(file.size) }}
              </span>
            </div>

            <!-- Card Actions -->
            <div class="file-card-actions" @click.stop>
              <button type="button"
                v-if="!file.is_folder"
                class="card-act-btn"
                title="预览"
                @click="handlePreview(file)"
              >
                👁️
              </button>
              <button type="button"
                v-if="!file.is_folder"
                class="card-act-btn"
                title="下载"
                @click="handleDownload(file)"
              >
                ⬇️
              </button>
              <button type="button"
                class="card-act-btn"
                title="创建外链与站内分享"
                @click="activeShareFile = file"
              >
                🔗
              </button>
              <button type="button"
                class="card-act-btn card-act-more"
                title="更多操作"
                @click.stop="toggleActionMenu(file, $event)"
              >
                ⋮
              </button>
            </div>
          </div>
        </div>

        <!-- List View -->
        <div v-else class="drive-list-view">
          <table class="drive-table">
            <thead>
              <tr>
                <th style="width: 40px; text-align: center;">
                  <input
                    type="checkbox"
                    :checked="selectedFileIds.size === sortedFiles.length && sortedFiles.length > 0"
                    @change="selectedFileIds.size === sortedFiles.length ? clearSelection() : selectAllFiles()"
                  />
                </th>
                <th class="is-sortable" style="width: 45%;" title="点击按文件名排序" @click="handleSortClick('name')">
                  <span>名称</span>
                  <span class="sort-indicator" :class="{ active: sortBy === 'name' }">
                    {{ sortBy === 'name' ? (sortOrder === 'asc' ? '▲' : '▼') : '↕' }}
                  </span>
                </th>
                <th class="is-sortable" style="width: 15%;" title="点击按大小排序" @click="handleSortClick('size')">
                  <span>大小</span>
                  <span class="sort-indicator" :class="{ active: sortBy === 'size' }">
                    {{ sortBy === 'size' ? (sortOrder === 'asc' ? '▲' : '▼') : '↕' }}
                  </span>
                </th>
                <th class="is-sortable" style="width: 20%;" title="点击按修改时间排序" @click="handleSortClick('updated_at')">
                  <span>修改时间</span>
                  <span class="sort-indicator" :class="{ active: sortBy === 'updated_at' }">
                    {{ sortBy === 'updated_at' ? (sortOrder === 'asc' ? '▲' : '▼') : '↕' }}
                  </span>
                </th>
                <th style="width: 140px; min-width: 130px; text-align: right;">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="file in sortedFiles"
                :key="file.id"
                :data-folder-id="file.is_folder ? file.id : undefined"
                class="drive-table-row"
                :class="{
                  'is-selected': selectedFileIds.has(file.id),
                  'is-folder-drop-target': file.is_folder && dragOverFolderId === file.id
                }"
                @click="handleItemClick(file, $event)"
                @dblclick="file.is_folder ? handleNavigate(file.id) : handlePreview(file)"
                @dragenter.stop.prevent="file.is_folder ? handleFolderDragEnter(file.id) : null"
                @dragover.stop.prevent="file.is_folder ? handleFolderDragOver(file.id) : null"
                @dragleave.stop.prevent="file.is_folder ? handleFolderDragLeave(file.id, $event) : null"
                @drop.stop.prevent="file.is_folder ? handleFolderDrop(file.id, $event) : null"
              >
                <td style="text-align: center;" @click.stop>
                  <input
                    type="checkbox"
                    :checked="selectedFileIds.has(file.id)"
                    @change="handleCheckboxToggle(file.id, $event)"
                  />
                </td>
                <td>
                  <div class="col-name">
                    <span class="file-list-icon">{{ getFileIcon(file) }}</span>
                    <span
                      class="file-list-name is-link"
                      @click="file.is_folder ? handleNavigate(file.id) : handlePreview(file)"
                    >
                      {{ file.name }}
                    </span>
                  </div>
                </td>
                <td>{{ file.is_folder ? '-' : formatBytes(file.size) }}</td>
                <td>{{ file.updated_at ? new Date(file.updated_at).toLocaleDateString() : '-' }}</td>
                <td style="text-align: right;" @click.stop>
                  <div class="list-action-btns">
                    <button type="button"
                      v-if="!file.is_folder"
                      class="card-act-btn"
                      title="预览"
                      @click="handlePreview(file)"
                    >
                      👁️
                    </button>
                    <button type="button"
                      v-if="!file.is_folder"
                      class="card-act-btn"
                      title="下载"
                      @click="handleDownload(file)"
                    >
                      ⬇️
                    </button>
                    <button type="button"
                      class="card-act-btn"
                      title="创建外链与站内分享"
                      @click="activeShareFile = file"
                    >
                      🔗
                    </button>
                    <button type="button"
                      class="card-act-btn card-act-more"
                      title="更多操作"
                      @click.stop="toggleActionMenu(file, $event)"
                    >
                      ⋮
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>

    <!-- TAB: RECENT FILES VIEW -->
    <template v-else-if="activeTab === 'recent'">
      <div class="drive-toolbar">
        <div class="toolbar-title-box">
          <span class="toolbar-title">最近新增</span>
          <span class="toolbar-subtitle">按添加时间倒序展示您最近上传和保存的文件</span>
        </div>
        <div class="toolbar-right-group">
          <button type="button" class="action-btn action-btn-secondary" @click="loadRecentFiles">
            <span>🔄</span> 刷新列表
          </button>
          <div class="view-mode-toggle">
            <button type="button"
              class="toggle-btn"
              :class="{ active: viewMode === 'grid' }"
              title="网格视图"
              @click="setViewMode('grid')"
            >
              ⊞
            </button>
            <button type="button"
              class="toggle-btn"
              :class="{ active: viewMode === 'list' }"
              title="列表视图"
              @click="setViewMode('list')"
            >
              ☰
            </button>
          </div>
        </div>
      </div>

      <div class="drive-content-area" :class="{ 'has-batch-bar': isMultiSelectMode }">
        <!-- Loading state -->
        <div v-if="isLoadingRecent" class="drive-loading-state">
          <div class="spinner"></div>
          <span>正在加载最近新增文件...</span>
        </div>

        <!-- Empty state -->
        <div v-else-if="recentList.length === 0" class="drive-empty-state">
          <span class="empty-icon">🕒</span>
          <span class="empty-title">暂无最近新增文件</span>
          <span class="empty-subtitle">您上传或转存的文件将在此处按时间倒序聚合展示</span>
        </div>

        <!-- Grid View -->
        <div v-else-if="viewMode === 'grid'" class="drive-grid-view">
          <div
            v-for="file in recentList"
            :key="file.id"
            class="file-grid-card"
            :class="{ 'is-selected': selectedFileIds.has(file.id) }"
            @click="handleItemClick(file, $event)"
            @dblclick="handlePreview(file)"
          >
            <!-- Checkbox -->
            <div
              class="card-select-checkbox"
              :class="{ 'is-visible': isMultiSelectMode || selectedFileIds.has(file.id) }"
              @click.stop="handleCheckboxToggle(file.id, $event)"
            >
              <input type="checkbox" :checked="selectedFileIds.has(file.id)" />
            </div>

            <div class="file-card-preview" @click="handlePreview(file)">
              <span class="file-type-icon">{{ getFileIcon(file) }}</span>
            </div>

            <div class="file-card-info" @click="handlePreview(file)">
              <span class="file-card-name" :title="file.name">{{ file.name }}</span>
              <span class="file-card-meta">
                {{ formatBytes(file.size) }} · {{ file.created_at ? new Date(file.created_at).toLocaleDateString() : '' }}
              </span>
              <span
                class="file-card-folder-tag"
                :title="file.parent_name ? `所在目录: ${file.parent_name}` : '位于根目录'"
                @click.stop="handleLocateFile(file)"
              >
                📁 {{ file.parent_name || '根目录' }}
              </span>
            </div>

            <!-- Card Actions -->
            <div class="file-card-actions" @click.stop>
              <button type="button" class="card-act-btn" title="预览" @click="handlePreview(file)">
                👁️
              </button>
              <button type="button" class="card-act-btn" title="下载" @click="handleDownload(file)">
                ⬇️
              </button>
              <button type="button" class="card-act-btn" title="创建外链与站内分享" @click="activeShareFile = file">
                🔗
              </button>
              <button type="button" class="card-act-btn card-act-more" title="更多操作" @click.stop="toggleActionMenu(file, $event)">
                ⋮
              </button>
            </div>
          </div>
        </div>

        <!-- List View -->
        <div v-else class="drive-list-view">
          <table class="drive-table">
            <thead>
              <tr>
                <th style="width: 40px; text-align: center;">
                  <input
                    type="checkbox"
                    :checked="selectedFileIds.size === recentList.length && recentList.length > 0"
                    @change="selectedFileIds.size === recentList.length ? clearSelection() : selectAllRecentFiles()"
                  />
                </th>
                <th style="width: 40%;">名称</th>
                <th style="width: 20%;">所在目录</th>
                <th style="width: 14%;">大小</th>
                <th style="width: 16%;">上传时间</th>
                <th style="width: 140px; min-width: 130px; text-align: right;">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="file in recentList"
                :key="file.id"
                class="drive-table-row"
                :class="{ 'is-selected': selectedFileIds.has(file.id) }"
                @click="handleItemClick(file, $event)"
                @dblclick="handlePreview(file)"
              >
                <td style="text-align: center;" @click.stop>
                  <input
                    type="checkbox"
                    :checked="selectedFileIds.has(file.id)"
                    @change="handleCheckboxToggle(file.id, $event)"
                  />
                </td>
                <td>
                  <div class="col-name">
                    <span class="file-list-icon">{{ getFileIcon(file) }}</span>
                    <span class="file-list-name is-link" @click="handlePreview(file)">
                      {{ file.name }}
                    </span>
                  </div>
                </td>
                <td>
                  <span class="file-folder-link is-link" @click.stop="handleLocateFile(file)" title="点击跳转至该目录">
                    📁 {{ file.parent_name || '根目录' }}
                  </span>
                </td>
                <td>{{ formatBytes(file.size) }}</td>
                <td>{{ file.created_at ? new Date(file.created_at).toLocaleString() : '-' }}</td>
                <td style="text-align: right;" @click.stop>
                  <div class="list-action-btns">
                    <button type="button" class="card-act-btn" title="预览" @click="handlePreview(file)">
                      👁️
                    </button>
                    <button type="button" class="card-act-btn" title="下载" @click="handleDownload(file)">
                      ⬇️
                    </button>
                    <button type="button" class="card-act-btn" title="创建外链与站内分享" @click="activeShareFile = file">
                      🔗
                    </button>
                    <button type="button" class="card-act-btn card-act-more" title="更多操作" @click.stop="toggleActionMenu(file, $event)">
                      ⋮
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>

    <!-- TAB: SHARED WITH ME VIEW -->
    <template v-else-if="activeTab === 'shared'">
      <div class="drive-toolbar">
        <div class="toolbar-title-box">
          <span class="toolbar-title">与我共享</span>
          <span class="toolbar-subtitle">站内其他成员或群聊共享给您的文件与协作文件夹</span>
        </div>
        <button type="button" class="action-btn action-btn-secondary" @click="loadSharedWithMe">
          <span>🔄</span> 刷新列表
        </button>
      </div>

      <div class="drive-content-area">
        <div v-if="isLoadingShared" class="drive-loading-state">
          <div class="spinner"></div>
          <span>正在加载与我共享的文件...</span>
        </div>

        <div v-else-if="sharedWithMeList.length === 0" class="drive-empty-state">
          <span class="empty-icon">👥</span>
          <span class="empty-title">暂无与我共享的内容</span>
          <span class="empty-subtitle">当站内其他成员将文件或文件夹授权给您或您所在的群聊时，会在此处显示</span>
        </div>

        <div v-else class="drive-list-view">
          <table class="drive-table">
            <thead>
              <tr>
                <th style="width: 32%;">名称</th>
                <th style="width: 20%;">所有者 / 分享人</th>
                <th style="width: 14%;">我的权限</th>
                <th style="width: 10%;">大小</th>
                <th style="width: 12%;">修改日期</th>
                <th style="width: 12%; text-align: right;">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in sharedWithMeList" :key="item.share_id" class="drive-table-row">
                <td>
                  <div class="col-name">
                    <span class="file-list-icon">{{ item.is_folder ? '📁' : '📄' }}</span>
                    <span
                      class="file-list-name is-link"
                      :title="item.file_name"
                      @click="item.is_folder ? handleOpenSharedFolder(item) : handlePreview({ id: item.file_id, name: item.file_name, mime_type: item.mime_type, size: item.size })"
                    >
                      {{ item.file_name }}
                    </span>
                  </div>
                </td>
                <td>
                  <div class="shared-owner-cell">
                    <UiAvatar
                      :src="item.owner_avatar_url"
                      :fallback="(item.owner_name || 'U')[0]"
                      size="xs"
                    />
                    <span class="shared-owner-name" :title="`@${item.owner_username}`">
                      {{ item.owner_name }}
                    </span>
                  </div>
                </td>
                <td>
                  <span
                    class="badge"
                    :class="{
                      'badge-admin': item.permission === 'admin',
                      'badge-write': item.permission === 'write',
                      'badge-read': item.permission === 'read'
                    }"
                  >
                    {{ item.permission === 'admin' ? '完全管理' : item.permission === 'write' ? '读写协同' : '只读下载' }}
                  </span>
                </td>
                <td>{{ item.is_folder ? '文件夹' : formatBytes(item.size) }}</td>
                <td class="col-date">{{ item.updated_at ? new Date(item.updated_at).toLocaleDateString() : '-' }}</td>
                <td style="text-align: right;">
                  <div class="list-action-btns">
                    <button type="button"
                      v-if="item.is_folder"
                      class="card-act-btn"
                      title="打开文件夹浏览并协同"
                      @click="handleOpenSharedFolder(item)"
                    >
                      📂 打开
                    </button>
                    <button type="button"
                      v-else
                      class="card-act-btn"
                      title="下载"
                      @click="handleDownload({ id: item.file_id, name: item.file_name })"
                    >
                      ⬇️ 下载
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>

    <!-- TAB 2: SHARES MANAGEMENT VIEW -->
    <template v-else-if="activeTab === 'shares'">
      <div class="drive-toolbar">
        <div class="toolbar-title-box">
          <span class="toolbar-title">已创建的外链分享</span>
          <span class="toolbar-subtitle">支持随时复制外链、测试访问或撤销失效</span>
        </div>
        <button type="button" class="action-btn action-btn-secondary" @click="loadShares">
          <span>🔄</span> 刷新列表
        </button>
      </div>

      <div class="drive-content-area">
        <div v-if="isLoadingShares" class="drive-loading-state">
          <div class="spinner"></div>
          <span>正在加载分享列表...</span>
        </div>

        <div v-else-if="sharesList.length === 0" class="drive-empty-state">
          <span class="empty-icon">🔗</span>
          <span class="empty-title">暂无已创建的分享链接</span>
          <span class="empty-subtitle">在「我的文件」中点击文件或文件夹右侧的 🔗 图标即可生成外链分享</span>
        </div>

        <div v-else class="drive-list-view">
          <table class="drive-table">
            <thead>
              <tr>
                <th style="width: 24%;">分享目标</th>
                <th style="width: 10%;">大小</th>
                <th style="width: 12%;">修改日期</th>
                <th style="width: 12%;">访问权限</th>
                <th style="width: 12%;">密码保护</th>
                <th style="width: 10%;">有效期</th>
                <th style="width: 20%; min-width: 220px; text-align: right;">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="s in sharesList" :key="s.share_token" class="drive-table-row">
                <td>
                  <div class="col-name">
                    <span class="file-list-icon">{{ s.is_folder ? '📁' : '📄' }}</span>
                    <span class="file-list-name" :title="s.file_name">{{ s.file_name }}</span>
                  </div>
                </td>
                <td>{{ s.is_folder ? '文件夹' : formatBytes(s.size) }}</td>
                <td class="col-date">{{ s.updated_at ? new Date(s.updated_at).toLocaleDateString() : '-' }}</td>
                <td>
                  <span class="badge badge-perm">{{ formatPermission(s.permission) }}</span>
                </td>
                <td>
                  <span v-if="s.has_password" class="badge badge-lock">🔒 已设密码</span>
                  <span v-else class="badge badge-public">🌐 公开访问</span>
                </td>
                <td>
                  <span v-if="s.expires_at" class="text-expire">
                    {{ new Date(s.expires_at).toLocaleDateString() }}
                  </span>
                  <span v-else class="text-forever">永久有效</span>
                </td>
                <td style="text-align: right;">
                  <div class="list-action-btns">
                    <button type="button"
                      class="card-act-btn card-act-copy"
                      title="复制分享链接"
                      @click="handleCopyShareUrl(s.share_token)"
                    >
                      {{ copiedShareToken === s.share_token ? '已复制 ✓' : '📋 复制' }}
                    </button>
                    <button type="button"
                      class="card-act-btn"
                      title="打开外链访问页面"
                      @click="handleOpenShare(s.share_token)"
                    >
                      👁️ 查看
                    </button>
                    <button type="button"
                      class="card-act-btn card-act-danger"
                      title="撤销并废弃此分享链接"
                      @click="handleRevokeShare(s.share_token)"
                    >
                      🗑️ 撤销
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>

    <!-- TAB 3: TRASH RECYCLE BIN VIEW -->
    <template v-else-if="activeTab === 'trash'">
      <div class="drive-toolbar">
        <div class="toolbar-title-box">
          <span class="toolbar-title">回收站</span>
          <span class="toolbar-subtitle">已删除的文件与文件夹在此暂存，支持还原或彻底清除</span>
        </div>
        <div class="drive-toolbar-actions">
          <button type="button" class="action-btn action-btn-secondary" @click="loadTrash">
            <span>🔄</span> 刷新
          </button>
          <button type="button"
            class="action-btn action-btn-danger"
            :disabled="trashList.length === 0"
            @click="handleEmptyTrash"
          >
            <span>🧹</span> 清空回收站
          </button>
        </div>
      </div>

      <div class="drive-content-area">
        <div v-if="isLoadingTrash" class="drive-loading-state">
          <div class="spinner"></div>
          <span>正在加载回收站...</span>
        </div>

        <div v-else-if="trashList.length === 0" class="drive-empty-state">
          <span class="empty-icon">🗑️</span>
          <span class="empty-title">回收站为空</span>
          <span class="empty-subtitle">被删除的文件和文件夹将显示在这里</span>
        </div>

        <div v-else class="drive-list-view">
          <table class="drive-table">
            <thead>
              <tr>
                <th style="width: 30%;">名称</th>
                <th style="width: 22%;">原所在路径</th>
                <th style="width: 12%;">大小</th>
                <th style="width: 16%;">删除时间</th>
                <th style="width: 20%; min-width: 190px; text-align: right;">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in trashList" :key="item.id" class="drive-table-row">
                <td>
                  <div class="col-name">
                    <span class="file-list-icon">{{ item.is_folder ? '📁' : '📄' }}</span>
                    <span class="file-list-name">{{ item.name }}</span>
                  </div>
                </td>
                <td>
                  <span class="file-orig-path-tag" :title="`删除前原路径: ${item.original_path || item.parent_name || '根目录'}`">
                    📁 {{ item.original_path || item.parent_name || '根目录' }}
                  </span>
                </td>
                <td>{{ item.is_folder ? '-' : formatBytes(item.size) }}</td>
                <td>{{ item.deleted_at ? new Date(item.deleted_at).toLocaleString() : '-' }}</td>
                <td style="text-align: right;">
                  <div class="list-action-btns">
                    <button type="button"
                      class="card-act-btn card-act-restore"
                      title="还原到网盘"
                      @click="handleRestore(item)"
                    >
                      🔄 还原
                    </button>
                    <button type="button"
                      class="card-act-btn card-act-danger"
                      title="彻底删除此项目（不可恢复）"
                      @click="handlePurge(item)"
                    >
                      ❌ 彻底删除
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>
    </section>

    <!-- Upload Queue Floating Modal -->
    <DriveUploadModal
      v-if="uploadQueue.length > 0 && showUploadQueue"
      :queue="uploadQueue"
      :on-close="() => (showUploadQueue = false)"
    />

    <!-- Share Dialog -->
    <DriveShareDialog
      v-if="activeShareFile"
      :file="activeShareFile"
      :on-close="() => (activeShareFile = null)"
      :on-create-share="createShare"
    />

    <!-- Full-featured Drive File Preview Modal -->
    <DriveFilePreviewModal
      v-if="previewFile"
      :file="previewFile"
      :current-folder-id="currentFolderId"
      :on-close="() => { previewFile = null; loadFiles(currentFolderId); }"
      :on-share="(f) => { activeShareFile = f; }"
      @extract-done="() => { previewFile = null; loadFiles(currentFolderId); }"
    />

    <!-- Folder Move Selector Modal -->
    <DriveFolderSelectorModal
      v-if="showMoveModal"
      :show="showMoveModal"
      :title="moveModalTitle"
      confirm-text="移动到此处"
      :on-close="() => (showMoveModal = false)"
      :on-confirm="handleMoveConfirm"
    />

    <!-- Floating Batch Action Bar -->
    <Transition name="batch-bar-slide">
      <div v-if="isMultiSelectMode" class="drive-batch-bar" role="toolbar" aria-label="网盘批量操作">
        <div class="batch-bar-left">
          <span class="batch-count">已选 <strong>{{ selectedFileIds.size }}</strong> 项</span>
          <button type="button" class="batch-bar-btn is-ghost" @click="activeTab === 'recent' ? selectAllRecentFiles() : selectAllFiles()">全选</button>
          <button type="button" class="batch-bar-btn is-ghost" @click="clearSelection">清空</button>
          <button type="button" class="batch-bar-btn is-cancel mobile-only-btn" @click="clearSelection" title="退出多选">✖</button>
        </div>
        <div class="batch-bar-right">
          <button type="button" class="batch-bar-btn is-download" :disabled="isScanningDownload || isBatchDownloading" @click="openBatchDownloadModal">
            <span class="batch-btn-icon">⬇️</span>
            <span class="batch-btn-text">{{ isScanningDownload ? '正在检索...' : (isBatchDownloading ? `打包中 (${batchDownloadIndex}/${batchDownloadTotal})...` : `下载 (${selectedFileIds.size})`) }}</span>
          </button>
          <button type="button" class="batch-bar-btn is-move" :disabled="isBatchDownloading" @click="openBatchMoveModal">
            <span class="batch-btn-icon">📦</span>
            <span class="batch-btn-text">移动</span>
          </button>
          <button type="button" class="batch-bar-btn is-delete" :disabled="isBatchDownloading" @click="batchDelete()">
            <span class="batch-btn-icon">🗑️</span>
            <span class="batch-btn-text">删除</span>
          </button>
          <button type="button" class="batch-bar-btn is-cancel desktop-only-btn" @click="clearSelection">
            <span class="batch-btn-icon">✖</span>
            <span class="batch-btn-text">退出</span>
          </button>
        </div>
      </div>
    </Transition>

    <!-- Unified Batch Download Modal (Pre-flight Checklist & Real-time Progress Dashboard) -->
    <Transition name="fade">
      <div v-if="showBatchDownloadModal" class="batch-confirm-modal-backdrop" @click.self="closeBatchDownloadModal">
        <div class="batch-confirm-modal-card">
          <!-- Modal Header -->
          <div class="batch-confirm-header">
            <div class="header-title-box">
              <span class="header-icon">{{ batchDownloadStep === 'completed' ? '🎉' : (batchDownloadStep === 'confirm' ? '📦' : (batchDownloadStep === 'error' ? '⚠️' : '⚡')) }}</span>
              <h3 class="header-title">
                {{
                  batchDownloadStep === 'confirm'
                    ? '打包下载清单确认'
                    : batchDownloadStep === 'completed'
                    ? '打包下载已完成'
                    : batchDownloadStep === 'error'
                    ? '打包下载中断或异常'
                    : '正在并发打包下载 (4线程加速)'
                }}
              </h3>
            </div>
            <button type="button" class="modal-close-btn" @click="closeBatchDownloadModal" title="关闭">×</button>
          </div>

          <!-- Step 1: Pre-flight Confirmation Summary -->
          <div v-if="batchDownloadStep === 'confirm'" class="batch-confirm-summary">
            <div class="summary-stat-pill">
              <span>📄 <strong>{{ batchDownloadManifest.totalFiles }}</strong> 个文件</span>
            </div>
            <div v-if="batchDownloadManifest.totalFolders > 0" class="summary-stat-pill">
              <span>📁 <strong>{{ batchDownloadManifest.totalFolders }}</strong> 个文件夹</span>
            </div>
            <div class="summary-stat-pill is-size">
              <span>📦 预计总大小 <strong>{{ formatBytes(batchDownloadManifest.totalBytes) }}</strong></span>
            </div>
          </div>

          <!-- Step 2: Live Progress Bar during downloading/compressing/completed -->
          <div v-else class="batch-live-progress-bar-box">
            <div class="batch-progress-bar-bg">
              <div
                class="batch-progress-bar-fill"
                :class="{ 'is-completed': batchDownloadStep === 'completed', 'is-error': batchDownloadStep === 'error' }"
                :style="{ width: `${batchDownloadStep === 'completed' ? 100 : batchDownloadPercent}%` }"
              ></div>
            </div>
            <div class="batch-progress-info-row">
              <span class="progress-status-txt">
                {{
                  batchDownloadStep === 'compressing'
                    ? '📦 正在纯客户端极速压缩组装 ZIP 文件...'
                    : batchDownloadStep === 'completed'
                    ? '🎉 已成功打包并触发浏览器另存为下载！'
                    : batchDownloadStep === 'error'
                    ? '⚠️ 下载已中断或部分失败'
                    : `⚡ 正在多线程下载: ${batchDownloadIndex} / ${batchDownloadTotal} (${batchDownloadPercent}%) · 已接收 ${formatBytes(batchDownloadBytesLoaded)}`
                }}
              </span>
              <span v-if="batchDownloadStep === 'downloading' && batchDownloadSpeed" class="progress-speed-txt">
                ⚡ {{ batchDownloadSpeed }}
              </span>
              <span class="progress-percent-txt">{{ batchDownloadStep === 'completed' ? '100%' : `${batchDownloadPercent}%` }}</span>
            </div>
          </div>

          <!-- List Section Header -->
          <div class="batch-confirm-list-title">
            <span>{{ batchDownloadStep === 'confirm' ? '文件与目录层级清单 (可点击 ✕ 移除无需打包的项)：' : '任务实时状态明细：' }}</span>
            <span class="list-count-badge">{{ batchDownloadManifest.tasks.length }} 项</span>
          </div>

          <!-- Scrollable Task List -->
          <div class="batch-confirm-list-container">
            <div
              v-for="item in batchDownloadManifest.tasks"
              :key="item.path"
              class="batch-confirm-item"
              :class="{
                'is-active': item.status === 'downloading',
                'is-done': item.status === 'success',
                'is-fail': item.status === 'error'
              }"
            >
              <span class="item-icon">{{ getFileIcon(item) }}</span>
              <div class="item-info">
                <span class="item-path" :title="item.path">{{ item.path }}</span>
              </div>
              <span class="item-size">{{ item.isFolder ? '文件夹' : formatBytes(item.size) }}</span>

              <!-- In Confirm step: Remove button -->
              <button
                v-if="batchDownloadStep === 'confirm'"
                type="button"
                class="btn-remove-item"
                title="从本次打包清单中移除"
                @click="handleRemoveManifestItem(item)"
              >
                ✕
              </button>

              <!-- In Progress step: Task Status Badge -->
              <div v-else class="task-status-pill">
                <span v-if="item.status === 'downloading'" class="status-badge is-active">⚡ 下载中</span>
                <span v-else-if="item.status === 'success'" class="status-badge is-done">✅ 已完成</span>
                <span v-else-if="item.status === 'error'" class="status-badge is-fail" :title="item.errorMsg">❌ 失败</span>
                <span v-else class="status-badge is-pending">⏳ 排队中</span>
              </div>
            </div>
          </div>

          <!-- Filename Row (only in confirm step) -->
          <div v-if="batchDownloadStep === 'confirm'" class="batch-confirm-filename-row">
            <label class="filename-label">🏷️ 保存压缩包文件名：</label>
            <input
              v-model="batchDownloadManifest.zipName"
              type="text"
              class="filename-input"
              placeholder="请输入压缩包文件名"
            />
          </div>

          <!-- Actions Row -->
          <div class="batch-confirm-actions">
            <!-- Confirm step buttons -->
            <template v-if="batchDownloadStep === 'confirm'">
              <button type="button" class="btn-cancel" @click="closeBatchDownloadModal">
                取消
              </button>
              <button
                type="button"
                class="btn-confirm-download"
                :disabled="batchDownloadManifest.fileTasks.length === 0"
                @click="executeBatchDownload"
              >
                🚀 确认并开始打包下载 ({{ formatBytes(batchDownloadManifest.totalBytes) }})
              </button>
            </template>

            <!-- Downloading / Compressing step buttons -->
            <template v-else-if="batchDownloadStep === 'downloading' || batchDownloadStep === 'compressing'">
              <span class="download-worker-tip">💡 4 线程并发下载 · 纯客户端组装</span>
              <button type="button" class="btn-cancel btn-abort" @click="cancelBatchDownload">
                ⏹️ 取消下载
              </button>
            </template>

            <!-- Completed / Error step buttons -->
            <template v-else>
              <button
                v-if="batchDownloadStep === 'error'"
                type="button"
                class="btn-confirm-download"
                @click="executeBatchDownload"
              >
                🔄 重新下载
              </button>
              <button type="button" class="btn-confirm-download btn-done" @click="closeBatchDownloadModal">
                ✓ 完成并关闭
              </button>
            </template>
          </div>
        </div>
      </div>
    </Transition>

    <!-- Global Item Action Dropdown Menu -->
    <Teleport to="body">
      <Transition name="fade">
        <div
          v-if="activeActionMenuFile"
          class="drive-action-menu-backdrop"
          @click="closeActionMenu"
          @contextmenu.prevent="closeActionMenu"
        >
          <div
            class="drive-action-menu-dropdown"
            :style="actionMenuStyle"
            @click.stop
          >
            <div class="menu-header">
              <span class="menu-file-icon">{{ getFileIcon(activeActionMenuFile) }}</span>
              <span class="menu-file-title" :title="activeActionMenuFile.name">{{ activeActionMenuFile.name }}</span>
            </div>
            <div class="menu-divider"></div>
            <button
              v-if="!activeActionMenuFile.is_folder"
              type="button"
              class="action-menu-item"
              @click="handleMenuAction('preview', activeActionMenuFile)"
            >
              <span class="item-icon">👁️</span>
              <span>在线预览</span>
            </button>
            <button
              v-if="!activeActionMenuFile.is_folder"
              type="button"
              class="action-menu-item"
              @click="handleMenuAction('download', activeActionMenuFile)"
            >
              <span class="item-icon">⬇️</span>
              <span>下载文件</span>
            </button>
            <button
              v-if="activeTab === 'recent' || activeActionMenuFile.parent_name"
              type="button"
              class="action-menu-item"
              @click="handleMenuAction('locate', activeActionMenuFile)"
            >
              <span class="item-icon">📂</span>
              <span>定位所在目录</span>
            </button>
            <button
              type="button"
              class="action-menu-item"
              @click="handleMenuAction('move', activeActionMenuFile)"
            >
              <span class="item-icon">📦</span>
              <span>移动到...</span>
            </button>
            <button
              type="button"
              class="action-menu-item"
              @click="handleMenuAction('share', activeActionMenuFile)"
            >
              <span class="item-icon">🔗</span>
              <span>创建外链分享</span>
            </button>
            <button
              v-if="!activeActionMenuFile.is_folder"
              type="button"
              class="action-menu-item"
              @click="handleMenuAction('copy', activeActionMenuFile)"
            >
              <span class="item-icon">📋</span>
              <span>创建副本</span>
            </button>
            <button
              type="button"
              class="action-menu-item"
              @click="handleMenuAction('rename', activeActionMenuFile)"
            >
              <span class="item-icon">✏️</span>
              <span>重命名</span>
            </button>
            <div class="menu-divider"></div>
            <button
              type="button"
              class="action-menu-item is-danger"
              @click="handleMenuAction('delete', activeActionMenuFile)"
            >
              <span class="item-icon">🗑️</span>
              <span>删除到回收站</span>
            </button>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.drive-manager-container {
  display: flex;
  flex-direction: row;
  height: 100%;
  width: 100%;
  position: relative;
  background: var(--bg-body, #f8fafc);
  color: var(--text-primary, #0f172a);
  overflow: hidden;
}

.hidden-file-input {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
  opacity: 0;
  pointer-events: none;
}

.drag-overlay {
  position: absolute;
  inset: 0;
  background: rgba(0, 128, 105, 0.04);
  z-index: 500;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding: 32px;
  box-sizing: border-box;
  pointer-events: none;
}

.drag-dropzone-box {
  width: min(480px, 90%);
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 14px;
  padding: 14px 22px;
  border: 2px dashed #008069;
  border-radius: 30px;
  background: rgba(255, 255, 255, 0.95);
  box-shadow: 0 12px 36px rgba(0, 128, 105, 0.2), 0 4px 12px rgba(0, 0, 0, 0.08);
  text-align: left;
  pointer-events: none;
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  animation: dragPulse 1.6s ease-in-out infinite alternate;
}

.drag-dropzone-box--folder {
  background: rgba(240, 253, 244, 0.98);
  border-color: #008069;
  border-style: solid;
  box-shadow: 0 16px 44px rgba(0, 128, 105, 0.3);
  transform: scale(1.03);
}

.drag-dropzone-icon {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: #e7f4f1;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 22px;
  margin-bottom: 0;
  flex-shrink: 0;
}

.drag-dropzone-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.drag-dropzone-title {
  margin: 0;
  font-size: 0.94rem;
  font-weight: 600;
  color: var(--text, #0f172a);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.drag-dropzone-subtitle {
  margin: 0;
  font-size: 0.78rem;
  color: var(--text-secondary, #64748b);
  line-height: 1.4;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

@keyframes dragPulse {
  from { transform: scale(0.98); }
  to { transform: scale(1.01); }
}

.drive-manager-container.is-dragging {
  outline: 2px dashed #008069;
  outline-offset: -2px;
}

.drag-fade-enter-active,
.drag-fade-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.drag-fade-enter-from,
.drag-fade-leave-to {
  opacity: 0;
  transform: scale(0.98);
}

/* LEFT SIDEBAR */
.drive-sidebar {
  width: 230px;
  min-width: 230px;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--surface, #ffffff);
  border-right: 1px solid var(--border, #e2e8f0);
  padding: 16px 12px;
  gap: 16px;
  flex-shrink: 0;
  box-sizing: border-box;
}

.sidebar-action-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.sidebar-upload-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  padding: 11px 16px;
  background: #008069;
  border: none;
  border-radius: 10px;
  color: #ffffff;
  font-size: 0.95rem;
  font-weight: 600;
  cursor: pointer;
  box-shadow: 0 2px 6px rgba(0, 128, 105, 0.25);
  transition: all 0.18s ease;
}

.sidebar-upload-btn:hover {
  background: #006e5a;
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(0, 128, 105, 0.35);
}

.sidebar-folder-upload-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  padding: 9px 16px;
  background: var(--surface-1, #f1f5f9);
  border: 1px solid var(--border, #e2e8f0);
  border-radius: 10px;
  color: var(--text, #0f172a);
  font-size: 0.88rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.18s ease;
}

.sidebar-folder-upload-btn:hover {
  background: var(--surface-2, #e2e8f0);
}

.sidebar-new-folder-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  padding: 9px 16px;
  background: var(--surface-1, #f1f5f9);
  border: 1px solid var(--border, #e2e8f0);
  border-radius: 10px;
  color: var(--text, #0f172a);
  font-size: 0.88rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.18s ease;
}

.sidebar-new-folder-btn:hover {
  background: var(--surface-2, #e2e8f0);
}

.drive-nav-menu {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
  overflow-y: auto;
}

.nav-menu-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 10px;
  color: var(--text-secondary, #64748b);
  font-size: 0.92rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease;
  width: 100%;
  text-align: left;
}

.nav-menu-item:hover {
  background: var(--surface-1, #f1f5f9);
  color: var(--text, #0f172a);
}

.nav-menu-item.active {
  background: rgba(0, 128, 105, 0.12);
  color: #008069;
  font-weight: 600;
}

.menu-icon {
  font-size: 1.15rem;
}

.menu-label {
  flex: 1;
}

.menu-badge {
  background: #008069;
  color: #ffffff;
  font-size: 0.72rem;
  padding: 1px 7px;
  border-radius: 999px;
  font-weight: 700;
}

.sidebar-quota-card {
  background: var(--surface-1, #f8fafc);
  border: 1px solid var(--border, #e2e8f0);
  border-radius: 12px;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: auto;
}

.quota-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.quota-title {
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--text, #0f172a);
}

.quota-percent {
  font-size: 0.8rem;
  font-weight: 700;
  color: #008069;
}

.quota-progress-bar {
  width: 100%;
  height: 6px;
  background: var(--surface-2, #e2e8f0);
  border-radius: 3px;
  overflow: hidden;
}

.quota-progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #008069, #0284c7);
  border-radius: 3px;
  transition: width 0.3s ease;
}

.quota-detail {
  font-size: 0.72rem;
  color: var(--text-secondary, #64748b);
  display: flex;
  align-items: center;
  gap: 4px;
}

.quota-sep {
  opacity: 0.5;
}

/* RIGHT MAIN SECTION */
.drive-main-section {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  position: relative;
  background: var(--bg-body, #f8fafc);
}

/* Toolbar */
.drive-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 24px;
  background: #ffffff;
  border-bottom: 1px solid #e2e8f0;
  gap: 16px;
  flex-wrap: wrap;
}

.toolbar-title-box {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.toolbar-title {
  font-size: 0.95rem;
  font-weight: 600;
  color: #0f172a;
}

.toolbar-subtitle {
  font-size: 0.78rem;
  color: #64748b;
}

.drive-breadcrumbs {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.92rem;
}

.breadcrumb-item {
  background: transparent;
  border: none;
  color: #64748b;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 6px;
  transition: all 0.15s ease;
  font-weight: 500;
}

.breadcrumb-item:hover {
  color: #0f172a;
  background: #f1f5f9;
}

.breadcrumb-item.active {
  color: #008069;
  font-weight: 600;
}

.breadcrumb-sep {
  color: #cbd5e1;
}

.drive-toolbar-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.search-box {
  position: relative;
  width: 200px;
}

.search-input {
  width: 100%;
  padding: 7px 12px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  color: #0f172a;
  font-size: 0.88rem;
  outline: none;
  transition: border-color 0.15s ease;
}

.search-input:focus {
  border-color: #008069;
  background: #ffffff;
}

.search-clear {
  position: absolute;
  right: 10px;
  top: 50%;
  transform: translateY(-50%);
  color: #94a3b8;
  cursor: pointer;
}

.action-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 14px;
  border-radius: 8px;
  font-size: 0.88rem;
  font-weight: 500;
  cursor: pointer;
  border: none;
  transition: all 0.15s ease;
}

.action-btn-primary {
  background: #008069;
  color: #ffffff;
}

.action-btn-primary:hover {
  background: #006a57;
}

.action-btn-secondary {
  background: #f1f5f9;
  border: 1px solid #e2e8f0;
  color: #334155;
}

.action-btn-secondary:hover {
  background: #e2e8f0;
  color: #0f172a;
}

.action-btn-danger {
  background: #fee2e2;
  border: 1px solid #fca5a5;
  color: #dc2626;
}

.action-btn-danger:hover:not(:disabled) {
  background: #fecaca;
}

.action-btn-danger:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.view-mode-toggle {
  display: flex;
  background: #f1f5f9;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 2px;
}

.toggle-btn {
  background: transparent;
  border: none;
  color: #64748b;
  padding: 5px 9px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 1rem;
  transition: all 0.15s ease;
}

.toggle-btn.active {
  background: #ffffff;
  color: #008069;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
}

.drive-content-area {
  flex: 1;
  overflow-y: auto;
  padding: 24px;
  user-select: none;
  -webkit-user-select: none;
}

.drive-loading-state,
.drive-empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 300px;
  gap: 12px;
  color: #64748b;
}

.empty-icon {
  font-size: 3.5rem;
}

.empty-title {
  font-size: 1.1rem;
  color: #0f172a;
  font-weight: 600;
}

.empty-subtitle {
  font-size: 0.88rem;
  color: #64748b;
}

.spinner {
  width: 32px;
  height: 32px;
  border: 3px solid #e2e8f0;
  border-top-color: #008069;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* Grid View */
.drive-grid-view {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
  gap: 16px;
}

.file-grid-card {
  background: var(--surface, #ffffff);
  border: 1px solid var(--border, #e2e8f0);
  border-radius: 12px;
  padding: 14px 12px 12px;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  cursor: pointer;
  transition: all 0.2s ease;
  position: relative;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.02);
  user-select: none;
  -webkit-user-select: none;
}

.file-grid-card:hover {
  background: var(--surface, #ffffff);
  border-color: #0284c7;
  transform: translateY(-2px);
  box-shadow: 0 8px 16px rgba(0, 0, 0, 0.06);
}

.file-card-preview {
  margin-bottom: 10px;
}

.file-type-icon {
  font-size: 2.8rem;
}

.file-card-info {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.file-card-name {
  font-size: 0.88rem;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--text, #0f172a);
}

.file-card-meta {
  font-size: 0.75rem;
  color: var(--text-secondary, #64748b);
}

.file-card-folder-tag {
  margin-top: 4px;
  display: inline-block;
  max-width: 100%;
  font-size: 0.72rem;
  color: #0284c7;
  background: rgba(2, 132, 199, 0.08);
  padding: 1px 6px;
  border-radius: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
  transition: background-color 0.2s;
}

.file-card-folder-tag:hover {
  background: rgba(2, 132, 199, 0.16);
}

.file-folder-link {
  color: #0284c7;
  font-size: 0.85rem;
  cursor: pointer;
}

.file-folder-link:hover {
  text-decoration: underline;
}

.file-card-actions {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  margin-top: 10px;
  width: 100%;
  flex-wrap: wrap;
  opacity: 0.75;
  transition: opacity 0.2s;
}

.file-grid-card:hover .file-card-actions {
  opacity: 1;
}

.card-act-btn {
  background: var(--surface-2, #f1f5f9);
  border: 1px solid var(--border, #e2e8f0);
  border-radius: 6px;
  padding: 4px 8px;
  min-width: 28px;
  height: 28px;
  font-size: 0.82rem;
  color: var(--text, #475569);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s ease;
  line-height: 1;
  white-space: nowrap;
  flex-shrink: 0;
}

.card-act-btn:hover {
  background: var(--surface-3, #e2e8f0);
  color: var(--text, #0f172a);
  border-color: #cbd5e1;
  transform: scale(1.08);
}

.card-act-copy {
  color: #008069;
  font-weight: 500;
}

.card-act-restore {
  color: #0284c7;
  font-weight: 500;
}

.card-act-danger:hover {
  background: #fee2e2;
  border-color: #fca5a5;
  color: #dc2626;
}

/* List View */
.drive-list-view {
  width: 100%;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}

.drive-table {
  width: 100%;
  min-width: 680px;
  border-collapse: collapse;
  background: #ffffff;
  border-radius: 12px;
  overflow: hidden;
  border: 1px solid #e2e8f0;
}

.drive-table th {
  text-align: left;
  padding: 12px 16px;
  font-size: 0.82rem;
  font-weight: 600;
  color: #475569;
  background: #f8fafc;
  border-bottom: 1px solid #e2e8f0;
}

.drive-table th.is-sortable {
  cursor: pointer;
  user-select: none;
  transition: all 0.15s ease;
}

.drive-table th.is-sortable:hover {
  color: #008069;
  background: #f1f5f9;
}

.sort-indicator {
  font-size: 0.7rem;
  margin-left: 4px;
  opacity: 0.35;
  display: inline-block;
  vertical-align: middle;
}

.sort-indicator.active {
  opacity: 1;
  color: #008069;
  font-weight: 700;
}

.drive-table-row {
  border-bottom: 1px solid #f1f5f9;
  transition: background 0.15s ease;
  user-select: none;
  -webkit-user-select: none;
}

.drive-table-row:hover {
  background: #f8fafc;
}

.drive-table td {
  padding: 12px 16px;
  font-size: 0.88rem;
  color: #1e293b;
}

.col-name {
  display: flex;
  align-items: center;
  gap: 10px;
}

.file-list-icon {
  font-size: 1.4rem;
}

.file-list-name {
  font-weight: 500;
  color: #0f172a;
}

.file-list-name.is-link {
  cursor: pointer;
  color: #008069;
}

.file-list-name.is-link:hover {
  text-decoration: underline;
}

.list-action-btns {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 6px;
  flex-wrap: nowrap;
  white-space: nowrap;
}

.badge {
  display: inline-flex;
  align-items: center;
  padding: 3px 8px;
  border-radius: 6px;
  font-size: 0.76rem;
  font-weight: 500;
}

.badge-perm {
  background: #e0f2fe;
  color: #0369a1;
}

.badge-lock {
  background: #fef3c7;
  color: #b45309;
}

.badge-public {
  background: #dcfce7;
  color: #15803d;
}

.text-expire {
  font-size: 0.82rem;
  color: #dc2626;
}

.text-forever {
  font-size: 0.82rem;
  color: #16a34a;
}

/* Preview modal */
.preview-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(8px);
  z-index: 1100;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.preview-modal {
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 16px;
  width: 90vw;
  max-width: 960px;
  height: 80vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 24px 48px rgba(0, 0, 0, 0.2);
}

.preview-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 20px;
  background: #f8fafc;
  border-bottom: 1px solid #e2e8f0;
  color: #0f172a;
}

.preview-title {
  font-size: 1rem;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.preview-close-btn {
  background: transparent;
  border: none;
  color: #64748b;
  font-size: 1.5rem;
  cursor: pointer;
  line-height: 1;
}

.preview-close-btn:hover {
  color: #0f172a;
}

.preview-content {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background: #f1f5f9;
  padding: 16px;
}

.preview-img,
.preview-video {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}

.preview-iframe {
  width: 100%;
  height: 100%;
  border: none;
  background: #ffffff;
}

.shared-owner-cell {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  max-width: 100%;
}

.shared-owner-name {
  font-size: 0.85rem;
  color: var(--text, #0f172a);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 140px;
}

.badge-admin {
  background: #fef3c7;
  color: #b45309;
}

.badge-write {
  background: #dcfce7;
  color: #15803d;
}

.badge-read {
  background: #e0f2fe;
  color: #0369a1;
}

.file-list-name.is-link {
  cursor: pointer;
}

.file-list-name.is-link:hover {
  text-decoration: underline;
  color: #008069;
}

.file-orig-path-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 0.78rem;
  color: var(--text-secondary, #64748b);
  background: var(--surface-1, #f1f5f9);
  padding: 3px 8px;
  border-radius: 6px;
  border: 1px solid var(--border, #e2e8f0);
  max-width: 220px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ==========================================================================
   Sort picker & Order toggle
   ========================================================================== */
.sort-picker {
  display: flex;
  align-items: center;
  gap: 4px;
  background: var(--surface-1, #f1f5f9);
  border: 1px solid var(--border, #e2e8f0);
  border-radius: 8px;
  padding: 2px 4px;
}

.sort-select {
  background: transparent;
  border: none;
  font-size: 0.82rem;
  color: var(--text, #334155);
  outline: none;
  cursor: pointer;
  padding: 4px 6px;
  font-weight: 500;
}

.sort-order-btn {
  background: var(--surface-0, #ffffff);
  border: 1px solid var(--border, #e2e8f0);
  border-radius: 6px;
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--text, #334155);
  cursor: pointer;
  padding: 3px 8px;
  transition: all 0.15s ease;
}

.sort-order-btn:hover {
  background: var(--surface-2, #e2e8f0);
  color: var(--text, #0f172a);
}

.action-btn-active {
  background: rgba(0, 128, 105, 0.12) !important;
  color: #008069 !important;
  border-color: #008069 !important;
}

/* ==========================================================================
   Grid item checkbox & selected highlight
   ========================================================================== */
.file-grid-card {
  position: relative;
}

.card-select-checkbox {
  position: absolute;
  top: 8px;
  left: 8px;
  z-index: 10;
  opacity: 0;
  transition: opacity 0.15s ease;
  cursor: pointer;
  background: rgba(255, 255, 255, 0.85);
  backdrop-filter: blur(4px);
  border-radius: 4px;
  padding: 2px 4px;
}

.file-grid-card:hover .card-select-checkbox,
.card-select-checkbox.is-visible {
  opacity: 1;
}

.file-grid-card.is-selected {
  border-color: #008069;
  background: rgba(0, 128, 105, 0.05);
  box-shadow: 0 0 0 1px #008069;
}

.file-grid-card.is-folder-drop-target {
  border-color: #008069 !important;
  background: rgba(0, 128, 105, 0.12) !important;
  box-shadow: 0 0 0 2px #008069, 0 8px 20px rgba(0, 128, 105, 0.2) !important;
  transform: translateY(-4px) scale(1.03);
}

.drive-table-row.is-selected {
  background: rgba(0, 128, 105, 0.08) !important;
}

.drive-table-row.is-folder-drop-target {
  background: rgba(0, 128, 105, 0.12) !important;
  box-shadow: inset 4px 0 0 #008069, 0 2px 8px rgba(0, 128, 105, 0.15) !important;
  outline: 2px dashed #008069;
  outline-offset: -2px;
}

.drag-box--folder {
  border-color: #008069;
  background: rgba(0, 128, 105, 0.12);
}

.drive-content-area.has-batch-bar {
  padding-bottom: 72px;
}

/* ==========================================================================
   Floating Batch Action Bar
   ========================================================================== */
.drive-batch-bar {
  position: absolute;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  background: var(--surface-0, #ffffff);
  border: 1px solid var(--border, #cbd5e1);
  border-radius: 30px;
  padding: 8px 18px;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.18);
  z-index: 900;
  width: max-content;
  max-width: calc(100% - 32px);
  box-sizing: border-box;
}

.batch-bar-left {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
}

.batch-count {
  font-size: 0.88rem;
  color: var(--text, #1e293b);
  white-space: nowrap;
}

.batch-count strong {
  color: #008069;
  font-size: 1rem;
}

.batch-bar-right {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.batch-bar-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  border: 1px solid var(--border, #e2e8f0);
  background: var(--surface-1, #f8fafc);
  color: var(--text, #334155);
  padding: 6px 12px;
  border-radius: 20px;
  font-size: 0.82rem;
  font-weight: 500;
  white-space: nowrap;
  flex-shrink: 0;
  line-height: 1.2;
  cursor: pointer;
  transition: all 0.15s ease;
}

.batch-btn-icon {
  font-size: 0.88rem;
  line-height: 1;
  display: inline-flex;
  align-items: center;
}

.batch-btn-text {
  white-space: nowrap;
}

.batch-bar-btn:hover {
  background: var(--surface-2, #e2e8f0);
}

.batch-bar-btn.is-ghost {
  background: transparent;
  border-color: var(--border, #cbd5e1);
  color: var(--text-secondary, #64748b);
}

.batch-bar-btn.is-ghost:hover {
  background: var(--surface-2, #e2e8f0);
  color: var(--text, #0f172a);
}

.mobile-only-btn {
  display: none;
}

.desktop-only-btn {
  display: inline-flex;
}

.batch-bar-btn.is-download {
  background: #008069;
  color: #ffffff;
  border-color: #008069;
}

.batch-bar-btn.is-download:hover:not(:disabled) {
  background: #006c58;
}

.batch-bar-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.batch-bar-btn.is-move {
  background: #0284c7;
  color: #ffffff;
  border-color: #0284c7;
}

.batch-bar-btn.is-move:hover {
  background: #0369a1;
}

.batch-bar-btn.is-delete {
  background: rgba(239, 68, 68, 0.1);
  color: #ef4444;
  border-color: rgba(239, 68, 68, 0.3);
}

.batch-bar-btn.is-delete:hover {
  background: #ef4444;
  color: #ffffff;
}

.batch-bar-btn.is-cancel {
  background: transparent;
  border-color: transparent;
  color: var(--text-secondary, #64748b);
}

.batch-bar-btn.is-cancel:hover {
  background: var(--surface-2, #e2e8f0);
  color: var(--text, #0f172a);
}

.batch-bar-slide-enter-active,
.batch-bar-slide-leave-active {
  transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
}

.batch-bar-slide-enter-from,
.batch-bar-slide-leave-to {
  opacity: 0;
  transform: translate(-50%, 20px);
}

.batch-download-overlay {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.6);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.batch-download-card {
  background: var(--surface, #ffffff);
  border: 1px solid var(--border, #cbd5e1);
  border-radius: 16px;
  padding: 28px 32px;
  width: 90%;
  max-width: 440px;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  box-shadow: 0 20px 48px rgba(0, 0, 0, 0.22);
}

.batch-download-title {
  margin: 16px 0 6px;
  font-size: 1.1rem;
  font-weight: 600;
  color: var(--text, #0f172a);
}

.batch-download-subtitle {
  font-size: 0.86rem;
  color: var(--text-secondary, #64748b);
  margin: 0 0 16px;
  word-break: break-all;
  max-width: 100%;
}

.batch-progress-bar-bg {
  width: 100%;
  height: 8px;
  background: var(--surface-3, #e2e8f0);
  border-radius: 4px;
  overflow: hidden;
  margin-bottom: 8px;
}

.batch-progress-bar-fill {
  height: 100%;
  background: #008069;
  transition: width 0.2s ease;
}

.batch-progress-stats {
  width: 100%;
  display: flex;
  justify-content: space-between;
  font-size: 0.78rem;
  color: var(--text-secondary, #64748b);
  margin-bottom: 12px;
}

.batch-download-tip {
  font-size: 0.76rem;
  color: #008069;
  background: rgba(0, 128, 105, 0.08);
  padding: 4px 10px;
  border-radius: 6px;
}

/* ==========================================================================
   Batch Download Confirmation Modal
   ========================================================================== */
.batch-confirm-modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.6);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1050;
  padding: 16px;
  box-sizing: border-box;
}

.batch-confirm-modal-card {
  background: var(--surface-0, #ffffff);
  border: 1px solid var(--border, #cbd5e1);
  border-radius: 16px;
  width: 100%;
  max-width: 520px;
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 20px 48px rgba(0, 0, 0, 0.24);
  overflow: hidden;
  box-sizing: border-box;
}

.batch-confirm-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 20px;
  background: var(--surface-1, #f8fafc);
  border-bottom: 1px solid var(--border, #e2e8f0);
}

.header-title-box {
  display: flex;
  align-items: center;
  gap: 8px;
}

.header-title-box .header-icon {
  font-size: 1.25rem;
}

.header-title-box .header-title {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 600;
  color: var(--text, #0f172a);
}

.modal-close-btn {
  background: transparent;
  border: none;
  font-size: 1.4rem;
  color: var(--text-secondary, #64748b);
  cursor: pointer;
  line-height: 1;
  padding: 2px 6px;
  border-radius: 4px;
}

.modal-close-btn:hover {
  color: var(--text, #0f172a);
  background: var(--surface-2, #e2e8f0);
}

.batch-confirm-summary {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 20px;
  background: rgba(0, 128, 105, 0.06);
  border-bottom: 1px solid rgba(0, 128, 105, 0.15);
  flex-wrap: wrap;
}

.summary-stat-pill {
  font-size: 0.82rem;
  color: var(--text, #334155);
  background: var(--surface-0, #ffffff);
  padding: 3px 8px;
  border-radius: 6px;
  border: 1px solid var(--border, #cbd5e1);
}

.summary-stat-pill.is-size strong {
  color: #008069;
}

.batch-confirm-list-title {
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--text-secondary, #64748b);
  padding: 10px 20px 4px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.list-count-badge {
  font-size: 0.75rem;
  color: #008069;
  background: rgba(0, 128, 105, 0.1);
  padding: 1px 7px;
  border-radius: 999px;
  font-weight: 700;
}

.batch-confirm-list-container {
  flex: 1;
  overflow-y: auto;
  max-height: 240px;
  padding: 4px 16px 10px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.batch-confirm-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  background: var(--surface-1, #f8fafc);
  border: 1px solid var(--border, #f1f5f9);
  border-radius: 8px;
  font-size: 0.84rem;
  transition: all 0.15s ease;
}

.batch-confirm-item.is-active {
  background: rgba(0, 128, 105, 0.08);
  border-color: #008069;
  box-shadow: inset 3px 0 0 #008069;
}

.batch-confirm-item.is-done {
  background: rgba(16, 185, 129, 0.05);
  border-color: rgba(16, 185, 129, 0.2);
}

.batch-confirm-item.is-fail {
  background: rgba(239, 68, 68, 0.06);
  border-color: rgba(239, 68, 68, 0.25);
}

.batch-confirm-item .item-icon {
  font-size: 1.1rem;
  flex-shrink: 0;
}

.batch-confirm-item .item-info {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.batch-confirm-item .item-path {
  color: var(--text, #1e293b);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.82rem;
}

.batch-confirm-item .item-size {
  font-size: 0.76rem;
  color: var(--text-secondary, #64748b);
  flex-shrink: 0;
}

.btn-remove-item {
  background: transparent;
  border: none;
  color: var(--text-secondary, #94a3b8);
  cursor: pointer;
  font-size: 0.88rem;
  padding: 2px 6px;
  border-radius: 4px;
  line-height: 1;
  transition: all 0.15s ease;
  flex-shrink: 0;
}

.btn-remove-item:hover {
  color: #ef4444;
  background: rgba(239, 68, 68, 0.12);
}

.task-status-pill {
  flex-shrink: 0;
}

.status-badge {
  font-size: 0.72rem;
  padding: 2px 8px;
  border-radius: 6px;
  font-weight: 600;
  white-space: nowrap;
}

.status-badge.is-pending {
  color: var(--text-secondary, #64748b);
  background: var(--surface-2, #e2e8f0);
}

.status-badge.is-active {
  color: #008069;
  background: rgba(0, 128, 105, 0.15);
  animation: pulseBadge 1.2s infinite alternate;
}

.status-badge.is-done {
  color: #15803d;
  background: rgba(22, 163, 74, 0.12);
}

.status-badge.is-fail {
  color: #dc2626;
  background: rgba(220, 38, 38, 0.12);
}

@keyframes pulseBadge {
  from { opacity: 0.7; }
  to { opacity: 1; }
}

.batch-live-progress-bar-box {
  padding: 14px 20px 10px;
  background: var(--surface-1, #f8fafc);
  border-bottom: 1px solid var(--border, #e2e8f0);
}

.batch-progress-info-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 0.82rem;
  color: var(--text, #334155);
  margin-top: 6px;
}

.progress-status-txt {
  color: #008069;
  font-weight: 500;
}

.progress-speed-txt {
  font-size: 0.78rem;
  color: #0284c7;
  font-weight: 600;
  margin-left: auto;
  margin-right: 8px;
}

.progress-percent-txt {
  font-weight: 700;
  color: #008069;
}

.batch-confirm-filename-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 20px 14px;
  border-top: 1px solid var(--border, #e2e8f0);
  background: var(--surface-1, #f8fafc);
}

.filename-label {
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--text-secondary, #475569);
}

.filename-input {
  width: 100%;
  padding: 7px 10px;
  border: 1px solid var(--border, #cbd5e1);
  border-radius: 8px;
  font-size: 0.84rem;
  background: var(--surface-0, #ffffff);
  color: var(--text, #0f172a);
  outline: none;
  box-sizing: border-box;
}

.filename-input:focus {
  border-color: #008069;
}

.batch-confirm-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  padding: 12px 20px;
  background: var(--surface-0, #ffffff);
  border-top: 1px solid var(--border, #e2e8f0);
}

.download-worker-tip {
  font-size: 0.78rem;
  color: var(--text-secondary, #64748b);
  margin-right: auto;
}

.btn-cancel {
  padding: 8px 16px;
  border-radius: 8px;
  border: 1px solid var(--border, #cbd5e1);
  background: var(--surface-0, #ffffff);
  color: var(--text, #475569);
  font-size: 0.86rem;
  cursor: pointer;
  transition: all 0.15s ease;
}

.btn-cancel:hover {
  background: var(--surface-2, #f1f5f9);
}

.btn-cancel.btn-abort {
  color: #dc2626;
  border-color: rgba(239, 68, 68, 0.4);
  background: rgba(239, 68, 68, 0.05);
}

.btn-cancel.btn-abort:hover {
  background: #fee2e2;
}

.btn-confirm-download {
  padding: 8px 18px;
  border-radius: 8px;
  border: none;
  background: #008069;
  color: #ffffff;
  font-size: 0.88rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s ease;
}

.btn-confirm-download:hover:not(:disabled) {
  background: #006c58;
}

.btn-confirm-download:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-confirm-download.btn-done {
  background: #008069;
}
/* ==========================================================================
   Action Dropdown Menu
   ========================================================================== */
.card-act-btn.card-act-more {
  font-weight: 700;
  font-size: 1.15rem;
  line-height: 1;
  color: var(--text-secondary, #64748b);
  padding: 0 4px;
}

.card-act-btn.card-act-more:hover {
  background: var(--surface-2, #e2e8f0);
  color: #008069;
}

.drive-action-menu-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1050;
  background: transparent;
}

.drive-action-menu-dropdown {
  position: fixed;
  background: var(--surface-0, #ffffff);
  border: 1px solid var(--border, #cbd5e1);
  border-radius: 12px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.16), 0 2px 8px rgba(0, 0, 0, 0.08);
  padding: 6px;
  min-width: 170px;
  max-width: 250px;
  z-index: 1060;
  display: flex;
  flex-direction: column;
  gap: 2px;
  box-sizing: border-box;
}

.menu-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  font-size: 0.8rem;
  color: var(--text-secondary, #64748b);
  overflow: hidden;
}

.menu-file-icon {
  font-size: 1.1rem;
  flex-shrink: 0;
}

.menu-file-title {
  font-weight: 600;
  color: var(--text, #0f172a);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.menu-divider {
  height: 1px;
  background: var(--border, #e2e8f0);
  margin: 4px 0;
}

.action-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  background: transparent;
  border: none;
  border-radius: 8px;
  color: var(--text, #334155);
  font-size: 0.84rem;
  font-weight: 500;
  cursor: pointer;
  width: 100%;
  text-align: left;
  transition: all 0.12s ease;
}

.action-menu-item .item-icon {
  font-size: 0.95rem;
}

.action-menu-item:hover {
  background: var(--surface-1, #f1f5f9);
  color: #0f172a;
}

.action-menu-item.is-danger {
  color: #ef4444;
}

.action-menu-item.is-danger:hover {
  background: rgba(239, 68, 68, 0.1);
  color: #dc2626;
}

@media (max-width: 768px) {
  .drive-manager-container {
    flex-direction: column;
  }

  .drive-sidebar {
    width: 100%;
    min-width: 100%;
    height: auto;
    border-right: none;
    border-bottom: 1px solid var(--border, #e2e8f0);
    padding: 8px 12px;
    gap: 8px;
  }

  .sidebar-action-group {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 8px;
    width: 100%;
  }

  .sidebar-folder-upload-btn {
    display: none;
  }

  .sidebar-upload-btn,
  .sidebar-new-folder-btn {
    width: auto;
    padding: 9px 8px;
    font-size: 0.85rem;
    gap: 6px;
    border-radius: 8px;
    justify-content: center;
    white-space: nowrap;
  }

  .drive-nav-menu {
    flex-direction: row;
    overflow-x: auto;
    gap: 6px;
    padding: 2px 0;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
  }
  .drive-nav-menu::-webkit-scrollbar {
    display: none;
  }

  .nav-menu-item {
    flex-shrink: 0;
    padding: 5px 10px;
    font-size: 0.82rem;
    border-radius: 16px;
    background: var(--surface-1, #f1f5f9);
    border: 1px solid var(--border, #e2e8f0);
    white-space: nowrap;
    width: auto;
  }
  .nav-menu-item.active {
    background: #008069;
    color: #ffffff;
    border-color: #008069;
  }
  .nav-menu-item.active .menu-badge {
    background: rgba(255, 255, 255, 0.3);
    color: #ffffff;
  }

  .sidebar-quota-card {
    display: none;
  }

  .drive-toolbar {
    padding: 8px 12px;
    gap: 8px;
    flex-direction: column;
    align-items: stretch;
  }

  .drive-breadcrumbs {
    overflow-x: auto;
    white-space: nowrap;
    -webkit-overflow-scrolling: touch;
    padding-bottom: 2px;
    scrollbar-width: none;
    font-size: 0.85rem;
    max-width: 100%;
  }
  .drive-breadcrumbs::-webkit-scrollbar {
    display: none;
  }

  .drive-toolbar-actions {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
    width: 100%;
  }

  .search-box {
    flex: 1 1 120px;
    width: auto;
    min-width: 100px;
  }

  .search-input {
    padding: 5px 8px;
    font-size: 0.8rem;
  }

  .sort-picker {
    padding: 1px 3px;
    gap: 2px;
  }

  .sort-select {
    padding: 3px 4px;
    font-size: 0.76rem;
  }

  .sort-order-btn {
    padding: 2px 5px;
    font-size: 0.72rem;
  }

  .action-btn {
    padding: 5px 8px;
    font-size: 0.78rem;
  }

  .toggle-btn {
    padding: 3px 6px;
    font-size: 0.85rem;
  }

  .drive-content-area {
    padding: 10px;
  }

  .drive-content-area.has-batch-bar {
    padding-bottom: 90px;
  }

  .drive-grid-view {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
  }

  .file-grid-card {
    padding: 10px 8px 8px;
    border-radius: 10px;
  }

  .file-type-icon {
    font-size: 2.2rem;
  }

  .file-card-name {
    font-size: 0.82rem;
  }

  .file-card-meta {
    font-size: 0.72rem;
  }

  .file-card-actions {
    opacity: 1;
    gap: 3px;
    margin-top: 6px;
  }

  .card-act-btn {
    height: 28px;
    min-width: 28px;
    font-size: 0.78rem;
    padding: 2px 5px;
  }

  .drive-batch-bar {
    min-width: unset;
    width: calc(100% - 20px);
    max-width: calc(100% - 20px);
    left: 10px;
    right: 10px;
    transform: none;
    bottom: 10px;
    padding: 8px 12px;
    border-radius: 14px;
    flex-direction: column;
    gap: 8px;
    box-sizing: border-box;
  }

  .batch-bar-left {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
  }

  .batch-bar-right {
    width: 100%;
    display: grid;
    grid-template-columns: 1.3fr 1fr 1fr;
    gap: 6px;
  }

  .batch-bar-btn {
    width: 100%;
    justify-content: center;
    padding: 7px 4px;
    font-size: 0.78rem;
    white-space: nowrap;
    box-sizing: border-box;
  }
}

@media (max-width: 400px) {
  .drive-grid-view {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
