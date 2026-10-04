import assert from 'node:assert/strict';
import test from 'node:test';
import { formatBytes, formatSpeed, useCloudDrive } from '../frontend/src/composables/useCloudDrive.js';

test('formatBytes formats bytes into human-readable string', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(1024), '1 KB');
  assert.equal(formatBytes(1024 * 1024), '1 MB');
  assert.equal(formatBytes(1.5 * 1024 * 1024 * 1024), '1.5 GB');
});

test('formatSpeed formats transfer rate into KB/s and MB/s', () => {
  assert.equal(formatSpeed(0), '0 KB/s');
  assert.equal(formatSpeed(512 * 1024), '512 KB/s');
  assert.equal(formatSpeed(2.5 * 1024 * 1024), '2.5 MB/s');
  assert.equal(formatSpeed(10.8 * 1024 * 1024), '10.8 MB/s');
});

test('useCloudDrive exports reactive state and drive methods', () => {
  const drive = useCloudDrive();

  assert.equal(Array.isArray(drive.files.value), true);
  assert.equal(Array.isArray(drive.breadcrumbs.value), true);
  assert.equal(Array.isArray(drive.sharedWithMeList.value), true);
  assert.equal(drive.currentFolderId.value, null);
  assert.equal(drive.isLoading.value, false);
  assert.equal(drive.isLoadingShared.value, false);
  assert.equal(typeof drive.loadFiles, 'function');
  assert.equal(typeof drive.loadSharedWithMe, 'function');
  assert.equal(typeof drive.createMemberShare, 'function');
  assert.equal(typeof drive.loadMemberShares, 'function');
  assert.equal(typeof drive.revokeMemberShare, 'function');
  assert.equal(typeof drive.loadShareCandidates, 'function');
  assert.equal(typeof drive.createFolder, 'function');
  assert.equal(typeof drive.uploadFiles, 'function');
  assert.equal(typeof drive.loadRecentFiles, 'function');
  assert.equal(Array.isArray(drive.recentList.value), true);
  assert.equal(typeof drive.deleteItem, 'function');
  assert.equal(typeof drive.renameItem, 'function');
  assert.equal(typeof drive.copyItem, 'function');
  assert.equal(typeof drive.createShare, 'function');
  assert.equal(typeof drive.createAppPassword, 'function');
});

test('useCloudDrive computed quota percent calculation', () => {
  const drive = useCloudDrive();

  drive.stats.value = {
    usedBytes: 2.5 * 1024 * 1024 * 1024,
    quotaBytes: 10 * 1024 * 1024 * 1024
  };

  assert.equal(drive.quotaPercent.value, 25);
});

test('DriveFileManager CSS prevents button text wrapping in trash and shares lists', async () => {
  const fs = await import('node:fs');
  const content = fs.readFileSync('frontend/src/components/drive/DriveFileManager.vue', 'utf-8');

  // Check nowrap on buttons and action container
  assert.match(content, /\.card-act-btn\s*\{[^}]*white-space:\s*nowrap/);
  assert.match(content, /\.list-action-btns\s*\{[^}]*white-space:\s*nowrap/);
  assert.match(content, /min-width:\s*220px/);
  assert.match(content, /min-width:\s*190px/);
});

test('DriveFileManager 支持在网格与列表视图下向指定文件夹拖放上传', async () => {
  const fs = await import('node:fs');
  const content = fs.readFileSync('frontend/src/components/drive/DriveFileManager.vue', 'utf-8');

  // 验证网格与列表视图均绑定了文件夹拖放事件与高亮样式类
  assert.match(content, /is-folder-drop-target/);
  assert.match(content, /handleFolderDragEnter/);
  assert.match(content, /handleFolderDragOver/);
  assert.match(content, /handleFolderDrop/);
  assert.match(content, /\.file-grid-card\.is-folder-drop-target/);
  assert.match(content, /\.drive-table-row\.is-folder-drop-target/);
});

test('DriveFileManager 包含「最近新增」导航选项卡与专属视图布局', async () => {
  const fs = await import('node:fs');
  const content = fs.readFileSync('frontend/src/components/drive/DriveFileManager.vue', 'utf-8');

  assert.match(content, /最近新增/);
  assert.match(content, /activeTab === 'recent'/);
  assert.match(content, /loadRecentFiles/);
  assert.match(content, /handleLocateFile/);
  assert.match(content, /\.file-card-folder-tag/);
  assert.match(content, /\.file-folder-link/);
});

test('DriveFileManager 支持多选批量打包下载 ZIP 文件', async () => {
  const fs = await import('node:fs');
  const content = fs.readFileSync('frontend/src/components/drive/DriveFileManager.vue', 'utf-8');

  assert.match(content, /handleBatchDownload/);
  assert.match(content, /isBatchDownloading/);
  assert.match(content, /is-download/);
  assert.match(content, /createZipArchive/);
  assert.match(content, /downloadZipArchive/);
});

test('DriveFileManager 支持批量文件上传与文件夹目录树上传', async () => {
  const fs = await import('node:fs');
  const content = fs.readFileSync('frontend/src/components/drive/DriveFileManager.vue', 'utf-8');

  assert.match(content, /folderInputRef/);
  assert.match(content, /webkitdirectory/);
  assert.match(content, /extractDataTransferItems/);
  assert.match(content, /uploadFolderItems/);
  assert.match(content, /sidebar-folder-upload-btn/);
});

test('DriveFileManager 在「最近新增」视图下支持多选与批量操作', async () => {
  const fs = await import('node:fs');
  const content = fs.readFileSync('frontend/src/components/drive/DriveFileManager.vue', 'utf-8');

  assert.match(content, /selectAllRecentFiles/);
});

test('DriveFileManager 支持列表模式与网格模式下的自适应 ⋮ 更多操作下拉菜单', async () => {
  const fs = await import('node:fs');
  const content = fs.readFileSync('frontend/src/components/drive/DriveFileManager.vue', 'utf-8');

  assert.match(content, /toggleActionMenu/);
  assert.match(content, /activeActionMenuFile/);
  assert.match(content, /card-act-more/);
  assert.match(content, /drive-action-menu-dropdown/);
});

test('DriveFileManager 拖拽文件时显示全屏半透明遮罩与居中拖放引导卡片', async () => {
  const fs = await import('node:fs');
  const content = fs.readFileSync('frontend/src/components/drive/DriveFileManager.vue', 'utf-8');

  assert.match(content, /drag-overlay/);
  assert.match(content, /drag-dropzone-box/);
  assert.match(content, /drag-dropzone-title/);
  assert.match(content, /backdrop-filter/);
});

test('useCloudDrive 支持 Shift 区间连续选择 selectRangeFiles', () => {
  const drive = useCloudDrive();
  const mockFiles = [
    { id: '1', name: 'a.txt' },
    { id: '2', name: 'b.txt' },
    { id: '3', name: 'c.txt' },
    { id: '4', name: 'd.txt' },
    { id: '5', name: 'e.txt' }
  ];

  drive.selectRangeFiles('2', '4', mockFiles);
  assert.equal(drive.selectedFileIds.value.size, 3);
  assert.ok(drive.selectedFileIds.value.has('2'));
  assert.ok(drive.selectedFileIds.value.has('3'));
  assert.ok(drive.selectedFileIds.value.has('4'));
  assert.ok(!drive.selectedFileIds.value.has('1'));
  assert.ok(!drive.selectedFileIds.value.has('5'));
});

test('DriveFileManager 支持 Ctrl/Shift 鼠标快捷多选与 Ctrl+A 全选快捷键', async () => {
  const fs = await import('node:fs');
  const content = fs.readFileSync('frontend/src/components/drive/DriveFileManager.vue', 'utf-8');

  assert.match(content, /handleItemClick/);
  assert.match(content, /selectRangeFiles/);
  assert.match(content, /ctrlKey/);
  assert.match(content, /shiftKey/);
});

test('DriveFileManager 支持打包下载前清单预览与确认弹窗', async () => {
  const fs = await import('node:fs');
  const content = fs.readFileSync('frontend/src/components/drive/DriveFileManager.vue', 'utf-8');

  assert.match(content, /openBatchDownloadModal/);
  assert.match(content, /executeBatchDownload/);
  assert.match(content, /showBatchDownloadModal/);
  assert.match(content, /batch-confirm-modal-card/);
  assert.match(content, /打包下载清单确认/);
});

test('DriveFileManager 打包下载支持清单行级移除与实时下载状态看板', async () => {
  const fs = await import('node:fs');
  const content = fs.readFileSync('frontend/src/components/drive/DriveFileManager.vue', 'utf-8');

  assert.match(content, /handleRemoveManifestItem/);
  assert.match(content, /btn-remove-item/);
  assert.match(content, /batchDownloadStep/);
  assert.match(content, /task-status-pill/);
  assert.match(content, /cancelBatchDownload/);
  assert.match(content, /AbortController/);
});

test('DriveFileManager 回收站表格包含「原所在路径」列与路径标签', async () => {
  const fs = await import('node:fs');
  const content = fs.readFileSync('frontend/src/components/drive/DriveFileManager.vue', 'utf-8');

  assert.match(content, /原所在路径/);
  assert.match(content, /file-orig-path-tag/);
  assert.match(content, /item.original_path/);
});

test('DriveFileManager 打包清单移除项与页面勾选状态实时双向同步且下载后保持选中', async () => {
  const fs = await import('node:fs');
  const content = fs.readFileSync('frontend/src/components/drive/DriveFileManager.vue', 'utf-8');

  assert.match(content, /nextSelected\.delete/);
  assert.match(content, /selectedFileIds\.value = nextSelected/);
});

test('DriveShareDialog 支持站内成员多选授权、分组一键全选与移动端自适应适配', async () => {
  const fs = await import('node:fs');
  const content = fs.readFileSync('frontend/src/components/drive/DriveShareDialog.vue', 'utf-8');

  // 1. 多选状态与交互方法
  assert.match(content, /selectedTargetKeys\s*=\s*ref\(new Set\(\)\)/);
  assert.match(content, /toggleTarget/);
  assert.match(content, /isTargetSelected/);
  assert.match(content, /toggleGroupSelection/);
  assert.match(content, /selectAllVisible/);
  assert.match(content, /clearAllSelection/);
  assert.match(content, /selectedTargetsList/);

  // 2. 界面元素与样式类
  assert.match(content, /share-select-checkbox/);
  assert.match(content, /btn-group-select-all/);
  assert.match(content, /全选本组/);
  assert.match(content, /取消全选/);
  assert.match(content, /selected-target-pills-wrap/);
  assert.match(content, /批量添加授权/);

  // 3. 移动端专属适配 (小屏响应式、触控热区与安全区域)
  assert.match(content, /@media\s*\(max-width:\s*640px\)/);
  assert.match(content, /env\(safe-area-inset-bottom/);
  assert.match(content, /\.share-candidate-card\s*\{[^}]*min-height:\s*44px/);
});

test('useCloudDrive.createMemberShare 既支持单目标又支持批量 targets 数组传参', async () => {
  const fs = await import('node:fs');
  const content = fs.readFileSync('frontend/src/composables/useCloudDrive.js', 'utf-8');

  assert.match(content, /createMemberShare\s*=\s*async\s*\(fileId,\s*targetTypeOrTargets/);
  assert.match(content, /Array\.isArray\(targetTypeOrTargets\)/);
  assert.match(content, /targets:\s*targetTypeOrTargets/);
});


