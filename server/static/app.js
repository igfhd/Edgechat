document.addEventListener('DOMContentLoaded', () => {
  // 视图元素
  const formView = document.getElementById('formView');
  const deployView = document.getElementById('deployView');
  const successView = document.getElementById('successView');

  // 表单与输入元素
  const _deployForm = document.getElementById('deployForm');
  const apiTokenInput = document.getElementById('apiToken');
  const toggleTokenEye = document.getElementById('toggleTokenEye');
  const probeBtn = document.getElementById('probeBtn');
  const probeSpinner = document.getElementById('probeSpinner');
  const probeBtnText = document.getElementById('probeBtnText');
  const probeResultBox = document.getElementById('probeResultBox');
  const probeStatusBadge = document.getElementById('probeStatusBadge');
  const probeSummaryText = document.getElementById('probeSummaryText');
  const permTags = document.getElementById('permTags');
  const accountSelectRow = document.getElementById('accountSelectRow');
  const accountSelect = document.getElementById('accountSelect');

  const routePrefixInput = document.getElementById('routePrefix');
  const randPrefixBtn = document.getElementById('randPrefixBtn');
  const disguiseSelect = document.getElementById('disguiseSelect');
  const disguiseHostInput = document.getElementById('disguiseHost');

  const storageRadios = document.querySelectorAll('input[name="storage_type"]');
  const storageCardR2 = document.getElementById('storageCardR2');
  const storageCardGDrive = document.getElementById('storageCardGDrive');
  const _r2ConfigBlock = document.getElementById('r2ConfigBlock') || document.getElementById('r2BucketGroup');
  const _gdriveConfigBlock = document.getElementById('gdriveConfigBlock') || document.getElementById('gdriveConfigSection');
  const gdriveClientIdInput = document.getElementById('gdriveClientId');
  const gdriveClientSecretInput = document.getElementById('gdriveClientSecret');
  const gdriveRefreshTokenInput = document.getElementById('gdriveRefreshToken');
  const gdriveFolderIdInput = document.getElementById('gdriveFolderId');
  const r2BucketInput = document.getElementById('r2Bucket');
  const r2AccessKeyIdInput = document.getElementById('r2AccessKeyId');
  const r2SecretAccessKeyInput = document.getElementById('r2SecretAccessKey');
  const workerNameInput = document.getElementById('workerName');
  const d1NameInput = document.getElementById('d1Name');
  const kvNamespaceInput = document.getElementById('kvNamespace');

  const modeRadios = document.querySelectorAll('input[name="deploy_mode"]');
  const modeCardFresh = document.getElementById('modeCardFresh');
  const modeCardUpdate = document.getElementById('modeCardUpdate');
  const modeCardResetAdmin = document.getElementById('modeCardResetAdmin');
  const modeCardUninstall = document.getElementById('modeCardUninstall');
  const detectedNotice = document.getElementById('detectedNotice');

  const updateSection = document.getElementById('updateSection');
  const freshSection = document.getElementById('freshSection');
  const resetAdminSection = document.getElementById('resetAdminSection');
  const uninstallSection = document.getElementById('uninstallSection');

  const updateWorkerNameInput = document.getElementById('updateWorkerName');
  const updateD1NameInput = document.getElementById('updateD1Name');
  const updateKvNamespaceInput = document.getElementById('updateKvNamespace');
  const updateR2BucketInput = document.getElementById('updateR2Bucket');
  const btnDetectWorker = document.getElementById('btnDetectWorker');
  const workerDetectBadge = document.getElementById('workerDetectBadge');
  const updateRoutePrefixInput = document.getElementById('updateRoutePrefix');
  const updateClearPrefixCheckbox = document.getElementById('updateClearPrefix');
  const updateDisguiseHostInput = document.getElementById('updateDisguiseHost');
  const updateAdminUsernameInput = document.getElementById('updateAdminUsername');
  const updateAdminPasswordInput = document.getElementById('updateAdminPassword');
  const updateOverrideToggle = document.getElementById('updateOverrideToggle');
  const updateOverrideBody = document.getElementById('updateOverrideBody');
  const updateOverrideArrow = document.getElementById('updateOverrideArrow');

  // 重置管理员密码表单元素
  const resetAdminWorkerNameInput = document.getElementById('resetAdminWorkerName');
  const resetAdminD1NameInput = document.getElementById('resetAdminD1Name');
  const resetAdminUsernameInput = document.getElementById('resetAdminUsername');
  const resetAdminPasswordInput = document.getElementById('resetAdminPassword');
  const btnDetectResetAdmin = document.getElementById('btnDetectResetAdmin');
  const randResetAdminPassBtn = document.getElementById('randResetAdminPassBtn');
  const toggleResetAdminPassEye = document.getElementById('toggleResetAdminPassEye');

  // 卸载与资源清理表单元素
  const uninstallWorkerNameInput = document.getElementById('uninstallWorkerName');
  const uninstallD1NameInput = document.getElementById('uninstallD1Name');
  const uninstallKvNamespaceInput = document.getElementById('uninstallKvNamespace');
  const uninstallR2BucketInput = document.getElementById('uninstallR2Bucket');
  const btnDetectUninstall = document.getElementById('btnDetectUninstall');
  const delWorkerCheck = document.getElementById('delWorkerCheck');
  const delD1Check = document.getElementById('delD1Check');
  const delKvCheck = document.getElementById('delKvCheck');
  const delR2Check = document.getElementById('delR2Check');
  const uninstallConfirmInput = document.getElementById('uninstallConfirmInput');

  if (updateOverrideToggle) {
    updateOverrideToggle.addEventListener('click', () => {
      const isHidden = updateOverrideBody.classList.contains('hidden');
      if (isHidden) {
        updateOverrideBody.classList.remove('hidden');
        updateOverrideArrow.classList.add('open');
      } else {
        updateOverrideBody.classList.add('hidden');
        updateOverrideArrow.classList.remove('open');
      }
    });
  }

  if (updateWorkerNameInput && workerNameInput) {
    updateWorkerNameInput.addEventListener('input', () => { workerNameInput.value = updateWorkerNameInput.value; });
    workerNameInput.addEventListener('input', () => { updateWorkerNameInput.value = workerNameInput.value; });
  }
  if (updateD1NameInput && d1NameInput) {
    updateD1NameInput.addEventListener('input', () => { d1NameInput.value = updateD1NameInput.value; });
    d1NameInput.addEventListener('input', () => { updateD1NameInput.value = d1NameInput.value; });
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function generateSecurePassword(length = 16) {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%&*';
    const maxUnbiasedValue = 256 - (256 % chars.length);
    let password = '';
    const randomBytes = new Uint8Array(length);

    while (password.length < length) {
      crypto.getRandomValues(randomBytes);
      for (const value of randomBytes) {
        if (value < maxUnbiasedValue) password += chars[value % chars.length];
        if (password.length === length) break;
      }
    }
    return password;
  }

  function updateModeSection() {
    const checkedMode = document.querySelector('input[name="deploy_mode"]:checked');
    const mode = checkedMode ? checkedMode.value : 'fresh';

    if (modeCardFresh) modeCardFresh.classList.toggle('active', mode === 'fresh');
    if (modeCardUpdate) modeCardUpdate.classList.toggle('active', mode === 'update');
    if (modeCardResetAdmin) modeCardResetAdmin.classList.toggle('active', mode === 'reset_admin');
    if (modeCardUninstall) modeCardUninstall.classList.toggle('active', mode === 'uninstall');

    if (freshSection) freshSection.classList.toggle('hidden', mode !== 'fresh');
    if (updateSection) updateSection.classList.toggle('hidden', mode !== 'update');
    if (resetAdminSection) resetAdminSection.classList.toggle('hidden', mode !== 'reset_admin');
    if (uninstallSection) uninstallSection.classList.toggle('hidden', mode !== 'uninstall');

    const startBtn = document.getElementById('startDeployBtn');
    if (startBtn && !startBtn.disabled) {
      if (mode === 'fresh') {
        startBtn.className = 'btn btn-primary btn-lg';
        startBtn.innerHTML = '<span>🚀 开始一键全新部署到 Cloudflare</span>';
      } else if (mode === 'update') {
        startBtn.className = 'btn btn-primary btn-lg';
        startBtn.innerHTML = '<span>⚡ 立即执行增量升级 (代码与数据库迁移)</span>';
      } else if (mode === 'reset_admin') {
        startBtn.className = 'btn btn-primary btn-lg';
        startBtn.innerHTML = '<span>👤 立即重置系统管理员密码</span>';
      } else if (mode === 'uninstall') {
        startBtn.className = 'btn btn-danger btn-lg';
        startBtn.innerHTML = '<span>⚠️ 确认执行云端资源卸载与销毁</span>';
      }
    }
  }

  modeRadios.forEach((radio) => {
    radio.addEventListener('change', updateModeSection);
  });

  if (modeCardFresh) {
    modeCardFresh.addEventListener('click', () => {
      const radio = document.getElementById('deployModeFresh');
      if (radio && !radio.checked) {
        radio.checked = true;
        updateModeSection();
      }
    });
  }

  if (modeCardUpdate) {
    modeCardUpdate.addEventListener('click', () => {
      const radio = document.getElementById('deployModeUpdate');
      if (radio && !radio.checked) {
        radio.checked = true;
        updateModeSection();
      }
    });
  }

  if (modeCardResetAdmin) {
    modeCardResetAdmin.addEventListener('click', () => {
      const radio = document.getElementById('deployModeResetAdmin');
      if (radio && !radio.checked) {
        radio.checked = true;
        updateModeSection();
      }
    });
  }

  if (modeCardUninstall) {
    modeCardUninstall.addEventListener('click', () => {
      const radio = document.getElementById('deployModeUninstall');
      if (radio && !radio.checked) {
        radio.checked = true;
        updateModeSection();
      }
    });
  }
  updateModeSection();

  // 针对特定 Worker 重新检测绑定的资源
  async function detectWorkerBindings(workerName, showToast = true) {
    const token = apiTokenInput ? apiTokenInput.value.trim() : '';
    if (!token) {
      if (showToast) alert('请先在上方填写 Cloudflare API Token');
      return;
    }
    const name = (workerName || (updateWorkerNameInput ? updateWorkerNameInput.value.trim() : '')).trim();
    if (!name) {
      if (showToast) alert('请输入要检测的 Worker 服务名称');
      return;
    }

    if (btnDetectWorker) {
      btnDetectWorker.disabled = true;
      btnDetectWorker.textContent = '⏳ 检测中...';
    }

    try {
      const res = await fetch('/api/probe/worker', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_token: token,
          account_id: (accountSelect && accountSelect.value) ? accountSelect.value : null,
          worker_name: name
        })
      });
      const data = await res.json();
      if (res.ok && data.found) {
        if (updateD1NameInput && data.d1_name) updateD1NameInput.value = data.d1_name;
        if (updateKvNamespaceInput && data.kv_namespace) updateKvNamespaceInput.value = data.kv_namespace;
        if (updateR2BucketInput) updateR2BucketInput.value = data.r2_bucket || '';
        if (updateRoutePrefixInput && data.route_prefix !== undefined) {
          if (updateClearPrefixCheckbox) updateClearPrefixCheckbox.checked = false;
          updateRoutePrefixInput.disabled = false;
          updateRoutePrefixInput.placeholder = '自动继承现有路径，如需变更可直接修改 (例如：chat,secret88)';
          updateRoutePrefixInput.value = data.route_prefix;
        }
        if (updateDisguiseHostInput && data.disguise_host) updateDisguiseHostInput.value = data.disguise_host || 'nginx';
        if (workerDetectBadge) {
          workerDetectBadge.textContent = '✨ 已同步云端绑定';
          workerDetectBadge.style.display = 'inline-block';
          workerDetectBadge.classList.remove('hidden');
        }
      } else {
        if (workerDetectBadge) {
          workerDetectBadge.textContent = '⚠️ 未找到绑定 (可手动填写)';
          workerDetectBadge.style.display = 'inline-block';
          workerDetectBadge.classList.remove('hidden');
        }
        if (showToast) {
          alert(`未能在当前账号中查询到 Worker [${name}] 的绑定配置或该 Worker 尚未创建，您可以手动确认下方各项资源配置。`);
        }
      }
    } catch (err) {
      console.warn('Worker 绑定检测请求异常:', err);
    } finally {
      if (btnDetectWorker) {
        btnDetectWorker.disabled = false;
        btnDetectWorker.textContent = '🔄 重新检测';
      }
    }
  }

  if (btnDetectWorker) {
    btnDetectWorker.addEventListener('click', () => {
      detectWorkerBindings(updateWorkerNameInput ? updateWorkerNameInput.value.trim() : '', true);
    });
  }

  if (updateClearPrefixCheckbox) {
    updateClearPrefixCheckbox.addEventListener('change', () => {
      if (updateClearPrefixCheckbox.checked) {
        if (updateRoutePrefixInput) {
          updateRoutePrefixInput.disabled = true;
          updateRoutePrefixInput.value = '';
          updateRoutePrefixInput.placeholder = '已勾选恢复根目录直接访问（将清空隐藏入口路径）';
        }
      } else {
        if (updateRoutePrefixInput) {
          updateRoutePrefixInput.disabled = false;
          updateRoutePrefixInput.placeholder = '自动继承现有路径，如需变更可直接修改 (例如：chat,secret88)';
        }
      }
    });
  }

  // 针对重置管理员密码界面的 Worker 探测
  if (btnDetectResetAdmin && resetAdminWorkerNameInput) {
    btnDetectResetAdmin.addEventListener('click', async () => {
      const wName = resetAdminWorkerNameInput.value.trim();
      if (!wName) {
        alert('请输入要检测的 Worker 服务名称');
        return;
      }
      btnDetectResetAdmin.disabled = true;
      btnDetectResetAdmin.textContent = '⏳ 检测中...';
      try {
        const token = apiTokenInput.value.trim();
        const res = await fetch('/api/probe/worker', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            api_token: token,
            account_id: (accountSelect && accountSelect.value) ? accountSelect.value : null,
            worker_name: wName
          })
        });
        const data = await res.json();
        if (res.ok && data.found && data.d1_name) {
          if (resetAdminD1NameInput) resetAdminD1NameInput.value = data.d1_name;
          alert(`已成功自动匹配到 Worker [${wName}] 绑定的 D1 数据库: ${data.d1_name}`);
        } else {
          alert(`未能查询到 Worker [${wName}] 绑定的 D1 数据库，您可以手动输入目标 D1 数据库名称。`);
        }
      } catch (e) {
        console.warn('检测异常:', e);
      } finally {
        btnDetectResetAdmin.disabled = false;
        btnDetectResetAdmin.textContent = '🔄 检测';
      }
    });
  }

  // 针对卸载界面的关联资源自动探测
  if (btnDetectUninstall && uninstallWorkerNameInput) {
    btnDetectUninstall.addEventListener('click', async () => {
      const wName = uninstallWorkerNameInput.value.trim();
      if (!wName) {
        alert('请输入要检测的 Worker 服务名称');
        return;
      }
      btnDetectUninstall.disabled = true;
      btnDetectUninstall.textContent = '⏳ 检测中...';
      try {
        const token = apiTokenInput.value.trim();
        const res = await fetch('/api/probe/worker', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            api_token: token,
            account_id: (accountSelect && accountSelect.value) ? accountSelect.value : null,
            worker_name: wName
          })
        });
        const data = await res.json();
        if (res.ok && data.found) {
          if (uninstallD1NameInput && data.d1_name) uninstallD1NameInput.value = data.d1_name;
          if (uninstallKvNamespaceInput && data.kv_namespace) uninstallKvNamespaceInput.value = data.kv_namespace;
          if (uninstallR2BucketInput && data.r2_bucket) uninstallR2BucketInput.value = data.r2_bucket;
          alert(`已自动读取 Worker [${wName}] 关联的资源：\nD1 数据库: ${data.d1_name || '未绑定'}\nKV 空间: ${data.kv_namespace || '未绑定'}\nR2 存储桶: ${data.r2_bucket || '未绑定'}`);
        } else {
          alert(`未能查询到 Worker [${wName}] 的绑定配置，您可以手动填写需清理的资源名称。`);
        }
      } catch (e) {
        console.warn('检测异常:', e);
      } finally {
        btnDetectUninstall.disabled = false;
        btnDetectUninstall.textContent = '🔄 检测关联';
      }
    });
  }

  // 重置管理员界面的随机密码生成
  if (randResetAdminPassBtn && resetAdminPasswordInput) {
    randResetAdminPassBtn.addEventListener('click', () => {
      resetAdminPasswordInput.value = generateSecurePassword();
      resetAdminPasswordInput.type = 'text';
      if (toggleResetAdminPassEye) toggleResetAdminPassEye.textContent = '🙈';
    });
  }

  // 重置管理员界面的密码显隐切换
  if (toggleResetAdminPassEye && resetAdminPasswordInput) {
    toggleResetAdminPassEye.addEventListener('click', () => {
      if (resetAdminPasswordInput.type === 'password') {
        resetAdminPasswordInput.type = 'text';
        toggleResetAdminPassEye.textContent = '🙈';
      } else {
        resetAdminPasswordInput.type = 'password';
        toggleResetAdminPassEye.textContent = '👁️';
      }
    });
  }

  if (updateWorkerNameInput) {
    let workerChangeTimer = null;
    updateWorkerNameInput.addEventListener('input', () => {
      clearTimeout(workerChangeTimer);
      workerChangeTimer = setTimeout(() => {
        const val = updateWorkerNameInput.value.trim();
        if (val && apiTokenInput && apiTokenInput.value.trim()) {
          detectWorkerBindings(val, false);
        }
      }, 600);
    });
  }

  function updateStorageSection() {
    const checkedRadio = document.querySelector('input[name="storage_type"]:checked');
    const isGDrive = checkedRadio ? checkedRadio.value === 'gdrive' : false;

    const cR2 = document.getElementById('storageCardR2');
    const cGD = document.getElementById('storageCardGDrive');
    const r2B = document.getElementById('r2ConfigBlock') || document.getElementById('r2BucketGroup');
    const gdB = document.getElementById('gdriveConfigBlock') || document.getElementById('gdriveConfigSection');

    if (cR2) cR2.classList.toggle('active', !isGDrive);
    if (cGD) cGD.classList.toggle('active', isGDrive);
    if (r2B) r2B.classList.toggle('hidden', isGDrive);
    if (gdB) gdB.classList.toggle('hidden', !isGDrive);
  }

  storageRadios.forEach((radio) => {
    radio.addEventListener('change', updateStorageSection);
  });

  document.addEventListener('change', (e) => {
    if (e.target && e.target.name === 'storage_type') {
      updateStorageSection();
    }
  });

  if (storageCardR2) {
    storageCardR2.addEventListener('click', () => {
      const radio = document.getElementById('storageTypeR2');
      if (radio && !radio.checked) {
        radio.checked = true;
        updateStorageSection();
      }
    });
  }

  if (storageCardGDrive) {
    storageCardGDrive.addEventListener('click', () => {
      const radio = document.getElementById('storageTypeGDrive');
      if (radio && !radio.checked) {
        radio.checked = true;
        updateStorageSection();
      }
    });
  }
  updateStorageSection();

  const adminPassInput = document.getElementById('adminPassword');
  const toggleAdminPassEye = document.getElementById('toggleAdminPassEye');
  const randPassBtn = document.getElementById('randPassBtn');

  const advancedToggle = document.getElementById('advancedToggle');
  const advancedBody = document.getElementById('advancedBody');
  const advancedArrow = document.getElementById('advancedArrow');
  const startDeployBtn = document.getElementById('startDeployBtn');

  // 控制台与日志元素
  const progressBar = document.getElementById('progressBar');
  const progressPercent = document.getElementById('progressPercent');
  const deployStatusTitle = document.getElementById('deployStatusTitle');
  const currentStepText = document.getElementById('currentStepText');
  const terminalLogs = document.getElementById('terminalLogs');
  const copyLogsBtn = document.getElementById('copyLogsBtn');
  const autoScrollToggle = document.getElementById('autoScrollToggle');
  const deployErrorBox = document.getElementById('deployErrorBox');
  const deployErrorMessage = document.getElementById('deployErrorMessage');
  const retryConfigBtn = document.getElementById('retryConfigBtn');

  // 成功页面元素
  const resSuccessIcon = document.getElementById('resSuccessIcon');
  const resSuccessTitle = document.getElementById('resSuccessTitle');
  const resSuccessSubtitle = document.getElementById('resSuccessSubtitle');
  const resAccessSection = document.getElementById('resAccessSection');
  const resUninstallSection = document.getElementById('resUninstallSection');
  const resUninstallSummary = document.getElementById('resUninstallSummary');
  const resCredSection = document.getElementById('resCredSection');
  const resCredTitle = document.getElementById('resCredTitle');
  const resResourceSection = document.getElementById('resResourceSection');
  const resRealUrl = document.getElementById('resRealUrl');
  const resRealLink = document.getElementById('resRealLink');
  const resAdminUrl = document.getElementById('resAdminUrl');
  const resAdminLink = document.getElementById('resAdminLink');
  const resDisguiseUrl = document.getElementById('resDisguiseUrl');
  const resDisguiseLink = document.getElementById('resDisguiseLink');
  const resDisguiseHost = document.getElementById('resDisguiseHost');
  const resAdminUser = document.getElementById('resAdminUser');
  const resAdminPass = document.getElementById('resAdminPass');
  const toggleResPassEye = document.getElementById('toggleResPassEye');
  const resResourceToggle = document.getElementById('resResourceToggle');
  const resResourceTable = document.getElementById('resResourceTable');
  const resResourceArrow = document.getElementById('resResourceArrow');
  const resWorkerName = document.getElementById('resWorkerName');
  const resAccountId = document.getElementById('resAccountId');
  const resD1Id = document.getElementById('resD1Id');
  const resKvId = document.getElementById('resKvId');
  const resStorageStatus = document.getElementById('resStorageStatus');
  const resR2Status = document.getElementById('resR2Status');
  const resCallsStatus = document.getElementById('resCallsStatus');
  const resDeployedAt = document.getElementById('resDeployedAt');
  const resVersion = document.getElementById('resVersion');
  const appVersionBadge = document.getElementById('appVersionBadge');
  const footerVersion = document.getElementById('footerVersion');
  const downloadBackupBtn = document.getElementById('downloadBackupBtn');
  const destroyJobBtn = document.getElementById('destroyJobBtn');
  const destroyedNotice = document.getElementById('destroyedNotice');

  // 状态变量
  let currentJobId = null;
  let sseEventSource = null;
  let autoScroll = true;
  let lastDeployedResult = null;
  let realAdminPassValue = '';

  // 动态同步项目版本号
  async function syncAppVersion() {
    try {
      const resp = await fetch('/api/health');
      if (resp.ok) {
        const data = await resp.json();
        if (data.version) {
          const verStr = `v${data.version}`;
          if (appVersionBadge) appVersionBadge.textContent = verStr;
          if (footerVersion) footerVersion.textContent = verStr;
          if (resVersion) resVersion.textContent = verStr;
        }
      }
    } catch {
      // 忽略静态预览或离线异常
    }
  }
  syncAppVersion();

  // 视图切换辅助函数
  function showView(view) {
    formView.classList.remove('active');
    deployView.classList.remove('active');
    successView.classList.remove('active');
    view.classList.add('active');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // 1. 切换 Token 密码查看
  toggleTokenEye.addEventListener('click', () => {
    if (apiTokenInput.type === 'password') {
      apiTokenInput.type = 'text';
      toggleTokenEye.textContent = '🙈';
    } else {
      apiTokenInput.type = 'password';
      toggleTokenEye.textContent = '👁️';
    }
  });

  // 2. 切换管理员密码查看
  toggleAdminPassEye.addEventListener('click', () => {
    if (adminPassInput.type === 'password') {
      adminPassInput.type = 'text';
      toggleAdminPassEye.textContent = '🙈';
    } else {
      adminPassInput.type = 'password';
      toggleAdminPassEye.textContent = '👁️';
    }
  });

  // 3. 伪装选择联动
  disguiseSelect.addEventListener('change', () => {
    if (disguiseSelect.value === 'custom') {
      disguiseHostInput.classList.remove('hidden');
      disguiseHostInput.focus();
    } else {
      disguiseHostInput.classList.add('hidden');
      disguiseHostInput.value = disguiseSelect.value;
    }
  });

  // 4. 随机前缀生成
  randPrefixBtn.addEventListener('click', () => {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let prefix = 'chat_';
    for (let i = 0; i < 6; i++) {
      prefix += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    routePrefixInput.value = prefix;
  });

  // 5. 随机强密码生成
  randPassBtn.addEventListener('click', () => {
    adminPassInput.value = generateSecurePassword();
    adminPassInput.type = 'text';
    toggleAdminPassEye.textContent = '🙈';
  });

  // 6. 高级选项折叠切换
  advancedToggle.addEventListener('click', () => {
    const isHidden = advancedBody.classList.contains('hidden');
    if (isHidden) {
      advancedBody.classList.remove('hidden');
      advancedArrow.classList.add('open');
    } else {
      advancedBody.classList.add('hidden');
      advancedArrow.classList.remove('open');
    }
  });

  // 7. 探测 API Token
  probeBtn.addEventListener('click', async () => {
    const token = apiTokenInput.value.trim();
    if (!token) {
      alert('请先输入 Cloudflare API Token');
      apiTokenInput.focus();
      return;
    }

    probeSpinner.classList.remove('hidden');
    probeBtnText.textContent = '探测中...';
    probeBtn.disabled = true;

    try {
      const res = await fetch('/api/probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_token: token })
      });
      const data = await res.json();

      probeResultBox.classList.remove('hidden');
      if (data.valid) {
        probeStatusBadge.className = 'badge badge-success';
        probeStatusBadge.textContent = '✅ Token 验证通过';
        probeSummaryText.textContent = `检测到 ${data.accounts.length} 个关联账户`;

        // 渲染权限徽章
        let permHtml = '';
        const perms = data.permissions || {};
        permHtml += perms.workers ? '<span class="badge badge-success">✓ Workers</span>' : '<span class="badge badge-error">✗ 缺少 Workers</span>';
        permHtml += perms.d1 ? '<span class="badge badge-success">✓ D1 数据库</span>' : '<span class="badge badge-error">✗ 缺少 D1</span>';
        permHtml += perms.kv ? '<span class="badge badge-success">✓ KV 命名空间</span>' : '<span class="badge badge-error">✗ 缺少 KV</span>';
        if (perms.calls) {
          permHtml += '<span class="badge badge-success">✓ Cloudflare Calls (音视频可用)</span>';
        } else {
          permHtml += '<span class="badge badge-outline" title="若 Token 已添加 Cloudflare Calls 权限，请确认是否已在 Cloudflare 控制台左侧「Calls」菜单点击「Get Started」开启服务；未开启完全不影响文字与文件聊天">ℹ️ Calls (未激活/可后台配置)</span>';
        }
        if (data.r2_enabled) {
          permHtml += '<span class="badge badge-success">✓ R2 (已激活)</span>';
        } else {
          permHtml += '<span class="badge badge-warning" title="账号未绑卡，建议使用 Google Drive 方案">⚠️ R2 (未绑卡/推荐 Google Drive)</span>';
          // 自动平滑切换至 Google Drive 免绑卡模式
          const gdRadio = document.getElementById('storageTypeGDrive');
          if (gdRadio && !gdRadio.checked) {
            gdRadio.checked = true;
            updateStorageSection();
          }
        }
        permTags.innerHTML = permHtml;

        // 渲染账号下拉
        if (data.accounts && data.accounts.length > 0) {
          accountSelectRow.classList.remove('hidden');
          accountSelect.innerHTML = data.accounts.map(a => 
            `<option value="${a.id}">${a.name} (${a.id})</option>`
          ).join('');
          if (data.selected_account_id) {
            accountSelect.value = data.selected_account_id;
          }
        }

       // 智能匹配已有的 Edgechat 历史部署
       if (data.existing_deployment?.detected) {
         const ex = data.existing_deployment;
         if (detectedNotice) {
            let noticeHtml = `✨ <strong>智能检测：</strong>检测到当前账号已部署过 Edgechat（Worker: <code>${escapeHtml(ex.worker_name)}</code>，D1: <code>${escapeHtml(ex.d1_name)}</code>）`;
            if (ex.route_prefix) {
              noticeHtml += `，检测到现有隐藏入口为 <code>/${escapeHtml(ex.route_prefix)}/</code>`;
            }
            noticeHtml += `，已自动为你切换至「⚡ 增量更新」模式并填入已有配置！`;
            detectedNotice.innerHTML = noticeHtml;
           detectedNotice.classList.remove('hidden');
         }
         const updateRadio = document.getElementById('deployModeUpdate');
         if (updateRadio) {
           updateRadio.checked = true;
           updateModeSection();
         }
         if (workerNameInput && ex.worker_name) workerNameInput.value = ex.worker_name;
         if (updateWorkerNameInput && ex.worker_name) updateWorkerNameInput.value = ex.worker_name;
         if (d1NameInput && ex.d1_name) d1NameInput.value = ex.d1_name;
         if (updateD1NameInput && ex.d1_name) updateD1NameInput.value = ex.d1_name;
         if (kvNamespaceInput && ex.kv_namespace) kvNamespaceInput.value = ex.kv_namespace;
         if (updateKvNamespaceInput && ex.kv_namespace) updateKvNamespaceInput.value = ex.kv_namespace;
         if (r2BucketInput && ex.r2_bucket) r2BucketInput.value = ex.r2_bucket;
         if (updateR2BucketInput && ex.r2_bucket) updateR2BucketInput.value = ex.r2_bucket;
          if (updateRoutePrefixInput && ex.route_prefix !== undefined) {
            if (updateClearPrefixCheckbox) updateClearPrefixCheckbox.checked = false;
            updateRoutePrefixInput.disabled = false;
            updateRoutePrefixInput.placeholder = '自动继承现有路径，如需变更可直接修改 (例如：chat,secret88)';
            updateRoutePrefixInput.value = ex.route_prefix;
          }
          if (updateDisguiseHostInput && ex.disguise_host) updateDisguiseHostInput.value = ex.disguise_host || 'nginx';
          if (workerDetectBadge) {
            workerDetectBadge.textContent = '✨ 已同步云端绑定';
            workerDetectBadge.style.display = 'inline-block';
            workerDetectBadge.classList.remove('hidden');
          }
       }
      } else {
        probeStatusBadge.className = 'badge badge-error';
        probeStatusBadge.textContent = '❌ 验证失败';
        probeSummaryText.textContent = data.error || 'Token 权限不足或格式有误';
        permTags.innerHTML = '<span class="badge badge-error">请检查 Token 是否包含 Workers/D1/KV 编辑权限</span>';
        accountSelectRow.classList.add('hidden');
      }
    } catch (err) {
      probeResultBox.classList.remove('hidden');
      probeStatusBadge.className = 'badge badge-error';
      probeStatusBadge.textContent = '❌ 网络异常';
      probeSummaryText.textContent = `无法连接部署后端服务: ${err.message}`;
    } finally {
      probeSpinner.classList.add('hidden');
      probeBtnText.textContent = '🔍 验证并拉取账号';
      probeBtn.disabled = false;
    }
  });

  // 8. 提交表单开始部署
  startDeployBtn.addEventListener('click', async (e) => {
    e.preventDefault();
    const token = apiTokenInput.value.trim();
    if (!token) {
      alert('请填写 Cloudflare API Token');
      apiTokenInput.focus();
      return;
    }

    const checkedStorage = document.querySelector('input[name="storage_type"]:checked');
    const storageType = checkedStorage ? checkedStorage.value : 'r2';

    const gdriveClientIdVal = gdriveClientIdInput ? gdriveClientIdInput.value.trim() : '';
    const gdriveClientSecretVal = gdriveClientSecretInput ? gdriveClientSecretInput.value.trim() : '';
    const gdriveRefreshTokenVal = gdriveRefreshTokenInput ? gdriveRefreshTokenInput.value.trim() : '';
    const gdriveFolderIdVal = gdriveFolderIdInput ? gdriveFolderIdInput.value.trim() : '';

    const checkedMode = document.querySelector('input[name="deploy_mode"]:checked');
    const deployMode = checkedMode ? checkedMode.value : 'fresh';

    // 模式 A：重置管理员密码
    if (deployMode === 'reset_admin') {
      const d1Val = resetAdminD1NameInput ? resetAdminD1NameInput.value.trim() : '';
      if (!d1Val) {
        alert('请填写目标 D1 数据库名称');
        if (resetAdminD1NameInput) resetAdminD1NameInput.focus();
        return;
      }
      const adminUserVal = resetAdminUsernameInput ? resetAdminUsernameInput.value.trim() : 'admin';
      const adminPassVal = resetAdminPasswordInput ? resetAdminPasswordInput.value.trim() : null;
      const workerNameVal = resetAdminWorkerNameInput ? resetAdminWorkerNameInput.value.trim() : 'cfchat';

      const payload = {
        deploy_mode: 'reset_admin',
        api_token: token,
        account_id: accountSelect.value || null,
        worker_name: workerNameVal,
        d1_name: d1Val,
        admin_username: adminUserVal,
        admin_password: adminPassVal,
      };

      startDeployBtn.disabled = true;
      startDeployBtn.textContent = '正在发起密码重置任务...';

      try {
        const res = await fetch('/api/deploy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.detail || '密码重置任务创建失败');
        }
        currentJobId = data.job_id;
        showView(deployView);
        startJobMonitoring(currentJobId);
      } catch (err) {
        alert(`任务发起失败: ${err.message}`);
      } finally {
        startDeployBtn.disabled = false;
        updateModeSection();
      }
      return;
    }

    // 模式 B：卸载下线与资源清理
    if (deployMode === 'uninstall') {
      const workerNameVal = uninstallWorkerNameInput ? uninstallWorkerNameInput.value.trim() : '';
      if (!workerNameVal) {
        alert('请填写目标 Worker 服务名称');
        if (uninstallWorkerNameInput) uninstallWorkerNameInput.focus();
        return;
      }
      const delWorker = delWorkerCheck ? delWorkerCheck.checked : false;
      const delD1 = delD1Check ? delD1Check.checked : false;
      const delKv = delKvCheck ? delKvCheck.checked : false;
      const delR2 = delR2Check ? delR2Check.checked : false;

      if (!delWorker && !delD1 && !delKv && !delR2) {
        alert('请至少勾选一项需要清理或删除的云端资源！');
        return;
      }

      const confirmVal = uninstallConfirmInput ? uninstallConfirmInput.value.trim() : '';
      if (confirmVal !== 'DELETE' && confirmVal !== workerNameVal) {
        alert(`安全防误触确认未通过：\n请输入 "DELETE" 或目标 Worker 服务名 "${workerNameVal}" 以确认执行。`);
        if (uninstallConfirmInput) uninstallConfirmInput.focus();
        return;
      }

      if (!confirm(`⚠️ 高危操作警告：\n您即将对 Cloudflare 账户中的选定资源执行永久销毁（D1 数据库与消息将彻底抹除，不可撤销）！\n\n确定要立即执行卸载清理吗？`)) {
        return;
      }

      const payload = {
        deploy_mode: 'uninstall',
        api_token: token,
        account_id: accountSelect.value || null,
        worker_name: workerNameVal,
        d1_name: uninstallD1NameInput ? uninstallD1NameInput.value.trim() : 'cfchat-db',
        kv_namespace: uninstallKvNamespaceInput ? uninstallKvNamespaceInput.value.trim() : 'SESSIONS',
        r2_bucket: uninstallR2BucketInput ? uninstallR2BucketInput.value.trim() : 'cfchat-files',
        delete_worker: delWorker,
        delete_d1: delD1,
        delete_kv: delKv,
        delete_r2: delR2,
        confirm_text: confirmVal
      };

      startDeployBtn.disabled = true;
      startDeployBtn.textContent = '正在发起卸载清理任务...';

      try {
        const res = await fetch('/api/deploy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.detail || '卸载清理任务创建失败');
        }
        currentJobId = data.job_id;
        showView(deployView);
        startJobMonitoring(currentJobId);
      } catch (err) {
        alert(`任务发起失败: ${err.message}`);
      } finally {
        startDeployBtn.disabled = false;
        updateModeSection();
      }
      return;
    }

    const isUpdate = (deployMode === 'update');

    if (!isUpdate && storageType === 'gdrive') {
      if (!gdriveClientIdVal || !gdriveClientSecretVal || !gdriveRefreshTokenVal) {
        alert('请完整填写 Google Drive OAuth 凭据（Client ID、Client Secret、Refresh Token 均为必填项）');
        if (!gdriveClientIdVal && gdriveClientIdInput) gdriveClientIdInput.focus();
        else if (!gdriveClientSecretVal && gdriveClientSecretInput) gdriveClientSecretInput.focus();
        else if (gdriveRefreshTokenInput) gdriveRefreshTokenInput.focus();
        return;
      }
    }

    const workerNameVal = isUpdate
      ? (updateWorkerNameInput ? updateWorkerNameInput.value.trim() : workerNameInput.value.trim()) || 'cfchat'
      : (workerNameInput.value.trim() || 'cfchat');

    const d1NameVal = isUpdate
      ? (updateD1NameInput ? updateD1NameInput.value.trim() : d1NameInput.value.trim()) || 'cfchat-db'
      : (d1NameInput.value.trim() || 'cfchat-db');

    const adminPassVal = isUpdate
      ? (updateAdminPasswordInput ? updateAdminPasswordInput.value.trim() : '') || null
      : (adminPassInput.value.trim() || null);

    const clearPrefixVal = isUpdate
      ? Boolean(updateClearPrefixCheckbox && updateClearPrefixCheckbox.checked)
      : false;

    const routePrefixVal = isUpdate
      ? (clearPrefixVal ? '' : (updateRoutePrefixInput ? updateRoutePrefixInput.value.trim() : ''))
      : routePrefixInput.value.trim();

    const disguiseHostVal = isUpdate
      ? ((updateDisguiseHostInput ? updateDisguiseHostInput.value.trim() : '') || 'nginx')
      : ((disguiseSelect.value === 'custom' ? disguiseHostInput.value.trim() : disguiseSelect.value) || 'nginx');

    const payload = {
      deploy_mode: deployMode,
      api_token: token,
      account_id: accountSelect.value || null,
      worker_name: workerNameVal,
      route_prefix: routePrefixVal,
      clear_route_prefix: clearPrefixVal,
      disguise_host: disguiseHostVal,
      admin_username: isUpdate
        ? ((updateAdminUsernameInput ? updateAdminUsernameInput.value.trim() : '') || 'admin')
        : (document.getElementById('adminUsername').value.trim() || 'admin'),
      admin_password: adminPassVal,
      admin_display_name: document.getElementById('adminDisplayName').value.trim() || 'Administrator',
      d1_name: d1NameVal,
      kv_namespace: isUpdate
        ? (updateKvNamespaceInput ? updateKvNamespaceInput.value.trim() : '') || (document.getElementById('kvNamespace').value.trim() || 'SESSIONS')
        : (document.getElementById('kvNamespace').value.trim() || 'SESSIONS'),
      storage_type: storageType,
      enable_r2: isUpdate
        ? (updateR2BucketInput ? Boolean(updateR2BucketInput.value.trim()) : true)
        : (storageType === 'r2'),
      r2_bucket: isUpdate
        ? (updateR2BucketInput ? updateR2BucketInput.value.trim() || 'cfchat-files' : 'cfchat-files')
        : (r2BucketInput ? r2BucketInput.value.trim() || 'cfchat-files' : 'cfchat-files'),
      r2_access_key_id: r2AccessKeyIdInput ? r2AccessKeyIdInput.value.trim() || null : null,
      r2_secret_access_key: r2SecretAccessKeyInput ? r2SecretAccessKeyInput.value.trim() || null : null,
      gdrive_client_id: gdriveClientIdVal || null,
      gdrive_client_secret: gdriveClientSecretVal || null,
      gdrive_refresh_token: gdriveRefreshTokenVal || null,
      gdrive_folder_id: gdriveFolderIdVal || null,
      calls_app_id: document.getElementById('callsAppId') ? document.getElementById('callsAppId').value.trim() || null : null,
      calls_app_secret: document.getElementById('callsAppSecret') ? document.getElementById('callsAppSecret').value.trim() || null : null,
    };

    startDeployBtn.disabled = true;
    startDeployBtn.textContent = '正在发起部署任务...';

    try {
      const res = await fetch('/api/deploy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.detail || '提交部署失败');
      }

      currentJobId = data.job_id;
      showView(deployView);
      startJobMonitoring(currentJobId);
    } catch (err) {
      alert(`部署发起失败: ${err.message}`);
    } finally {
      startDeployBtn.disabled = false;
      updateModeSection();
    }
  });

  // 9. 监控部署任务 (SSE + Polling)
  function startJobMonitoring(jobId) {
    terminalLogs.textContent = '';
    progressBar.style.width = '0%';
    progressPercent.textContent = '0%';
    deployStatusTitle.textContent = '正在部署 Edgechat...';
    currentStepText.textContent = '正在连接部署控制台...';
    deployErrorBox.classList.add('hidden');

    if (sseEventSource) {
      sseEventSource.close();
    }

    sseEventSource = new EventSource(`/api/jobs/${jobId}/stream`);

    sseEventSource.onmessage = (event) => {
      if (!event.data) return;
      try {
        const msg = JSON.parse(event.data);
        handleStreamMessage(msg);
      } catch (err) {
        console.error('SSE JSON 解析错误:', err);
      }
    };

    sseEventSource.onerror = () => {
      // 若 SSE 连接中断，回退到轮询
      console.warn('SSE 连接断开，切换为 HTTP 轮询模式');
      sseEventSource.close();
      pollJobStatus(jobId);
    };
  }

  function handleStreamMessage(msg) {
    if (msg.type === 'init') {
      updateProgressUI(msg.progress, msg.step);
      if (msg.logs && Array.isArray(msg.logs)) {
        msg.logs.forEach((l) => { appendTerminalLog(l); });
      }
      if (msg.status === 'success' && msg.result) {
        onDeploySuccess(msg.result);
      } else if (msg.status === 'failed') {
        onDeployFailed(msg.error);
      }
    } else if (msg.type === 'progress') {
      updateProgressUI(msg.progress, msg.step);
    } else if (msg.type === 'log') {
      appendTerminalLog(msg.data);
    } else if (msg.type === 'finish') {
      if (msg.status === 'success') {
        onDeploySuccess(msg.result);
      } else {
        onDeployFailed(msg.error);
      }
      if (sseEventSource) sseEventSource.close();
    }
  }

  function updateProgressUI(percent, step) {
    const p = Math.max(0, Math.min(100, percent || 0));
    progressBar.style.width = `${p}%`;
    progressPercent.textContent = `${p}%`;
    if (step) {
      currentStepText.textContent = step;
      deployStatusTitle.textContent = step;
    }
  }

  function appendTerminalLog(text) {
    const line = document.createElement('div');
    line.textContent = text;
    terminalLogs.appendChild(line);
    if (autoScroll) {
      terminalLogs.scrollTop = terminalLogs.scrollHeight;
    }
  }

  // HTTP 轮询回退机制
  let pollInterval = null;
  function pollJobStatus(jobId) {
    if (pollInterval) clearInterval(pollInterval);
    pollInterval = setInterval(async () => {
      try {
        const res = await fetch(`/api/jobs/${jobId}`);
        if (!res.ok) return;
        const job = await res.json();
        updateProgressUI(job.progress, job.current_step);
        if (job.logs) {
          terminalLogs.textContent = '';
          job.logs.forEach((l) => { appendTerminalLog(l); });
        }
        if (job.status === 'success') {
          clearInterval(pollInterval);
          onDeploySuccess(job.result);
        } else if (job.status === 'failed') {
          clearInterval(pollInterval);
          onDeployFailed(job.error);
        }
      } catch (err) {
        console.error('轮询异常:', err);
      }
    }, 1500);
  }

  // 部署成功处理
  function onDeploySuccess(res) {
    lastDeployedResult = res;

    if (res.mode === 'uninstall') {
      updateProgressUI(100, '🗑️ 卸载与资源清理已完成！');
      if (resSuccessIcon) resSuccessIcon.textContent = '🗑️';
      if (resSuccessTitle) resSuccessTitle.textContent = 'Edgechat 云端资源清理完成';
      if (resSuccessSubtitle) resSuccessSubtitle.textContent = res.summary || '已安全清理并释放选定的 Cloudflare 资源';

      if (resAccessSection) resAccessSection.classList.add('hidden');
      if (resCredSection) resCredSection.classList.add('hidden');
      if (resResourceSection) resResourceSection.classList.add('hidden');
      if (resUninstallSection) {
        resUninstallSection.classList.remove('hidden');
        const items = (res.deleted_items?.length)
          ? res.deleted_items.map((item) => `<li>✅ ${escapeHtml(item)}</li>`).join('')
          : '<li>ℹ️ 未检测到需要清理的资源或已被释放</li>';
        resUninstallSummary.innerHTML = `
          <p><strong>目标 Worker：</strong><code>${escapeHtml(res.worker_name || 'cfchat')}</code></p>
          <p><strong>Cloudflare Account ID：</strong><code>${escapeHtml(res.account_id || '-')}</code></p>
          <p><strong>清理完成时间：</strong><span>${escapeHtml(res.deployed_at || '-')}</span></p>
          <p style="margin-top: 8px;"><strong>已成功清理的项目：</strong></p>
          <ul style="margin: 6px 0 0 18px; padding: 0;">${items}</ul>
        `;
      }
      if (downloadBackupBtn) downloadBackupBtn.textContent = '📥 导出清理报告 (.txt)';

    } else if (res.mode === 'reset_admin') {
      updateProgressUI(100, '👤 管理员密码重置成功！');
      if (resSuccessIcon) resSuccessIcon.textContent = '🔑';
      if (resSuccessTitle) resSuccessTitle.textContent = '管理员密码重置成功！';
      if (resSuccessSubtitle) resSuccessSubtitle.textContent = `目标 Worker [${res.worker_name || 'cfchat'}] 关联 D1 数据库中管理员密码已更新，历史会话已全部强制注销`;

      if (resAccessSection) resAccessSection.classList.add('hidden');
      if (resUninstallSection) resUninstallSection.classList.add('hidden');
      if (resCredSection) {
        resCredSection.classList.remove('hidden');
        if (resCredTitle) resCredTitle.textContent = '👤 最新管理员凭据';
        resAdminUser.textContent = res.admin_username || 'admin';
        realAdminPassValue = res.admin_password || '';
        resAdminPass.textContent = '••••••••••••••••';
      }
      if (resResourceSection) {
        resResourceSection.classList.remove('hidden');
        resWorkerName.textContent = res.worker_name || '-';
        resAccountId.textContent = res.account_id || '-';
        resD1Id.textContent = res.d1_database_id || res.d1_name || '-';
        resKvId.textContent = '- (保持原有)';
        if (resStorageStatus) {
          resStorageStatus.className = 'badge badge-outline badge-sm';
          resStorageStatus.textContent = '保持不变';
        }
        if (resR2Status) {
          resR2Status.className = 'badge badge-outline badge-sm';
          resR2Status.textContent = '保持不变';
        }
        if (resCallsStatus) {
          resCallsStatus.className = 'badge badge-outline badge-sm';
          resCallsStatus.textContent = '保持不变';
        }
        resDeployedAt.textContent = res.deployed_at || '-';
        if (resVersion) {
          resVersion.textContent = res.version ? `v${res.version}` : (appVersionBadge?.textContent || 'v1.0.0');
        }
      }
      if (downloadBackupBtn) downloadBackupBtn.textContent = '📥 导出密码备忘 (.txt)';

    } else {
      // fresh or update
      const isUp = res.mode === 'update';
      updateProgressUI(100, isUp ? '⚡ 增量更新成功！' : '🎉 部署成功！');
      if (resSuccessIcon) resSuccessIcon.textContent = isUp ? '⚡' : '🎉';
      if (resSuccessTitle) resSuccessTitle.textContent = isUp ? 'Edgechat 增量更新已完成！' : 'Edgechat 已成功部署至 Cloudflare！';
      if (resSuccessSubtitle) resSuccessSubtitle.textContent = '您的端到端加密即时通讯服务已在全球边缘节点上线运行';

      if (resUninstallSection) resUninstallSection.classList.add('hidden');
      if (resAccessSection) resAccessSection.classList.remove('hidden');
      if (resCredSection) resCredSection.classList.remove('hidden');
      if (resResourceSection) resResourceSection.classList.remove('hidden');
      if (resCredTitle) resCredTitle.textContent = isUp ? '👤 系统管理员凭据' : '👤 初始管理员凭据';

      // 填充交付卡片数据
      const realUrl = res.real_entry_urls?.[0] || res.worker_url;
      resRealUrl.textContent = realUrl;
      resRealLink.href = realUrl;

      const adminUrl = res.admin_urls?.[0] || `${res.worker_url}/admin`;
      resAdminUrl.textContent = adminUrl;
      resAdminLink.href = adminUrl;

      resDisguiseUrl.textContent = res.disguise_url || res.worker_url;
      resDisguiseLink.href = res.disguise_url || res.worker_url;
      resDisguiseHost.textContent = res.disguise_host;

      resAdminUser.textContent = res.admin_username;
      realAdminPassValue = res.admin_password;
      resAdminPass.textContent = '••••••••••••••••';

      resWorkerName.textContent = res.worker_name;
      resAccountId.textContent = res.account_id;
      resD1Id.textContent = res.d1_database_id;
      resKvId.textContent = res.kv_namespace_id;
      if (resStorageStatus) {
        if (res.storage_type === 'gdrive') {
          resStorageStatus.className = 'badge badge-success badge-sm';
          resStorageStatus.textContent = 'Google Drive 云端硬盘 (免绑卡 · 15GB 免费)';
        } else if (res.r2_available) {
          resStorageStatus.className = 'badge badge-success badge-sm';
          resStorageStatus.textContent = `Cloudflare R2 (${res.r2_bucket || 'cfchat-files'})`;
        } else {
          resStorageStatus.className = 'badge badge-warning badge-sm';
          resStorageStatus.textContent = '已平滑降级 (基础模式)';
        }
      }
      if (res.r2_available) {
        resR2Status.className = 'badge badge-success badge-sm';
        resR2Status.textContent = '已启用 (R2 存储可用)';
      } else {
        resR2Status.className = 'badge badge-warning badge-sm';
        resR2Status.textContent = '已平滑降级 (基础模式)';
      }
      if (res.calls_enabled) {
        resCallsStatus.className = 'badge badge-success badge-sm';
        resCallsStatus.textContent = '已自动开通并绑定';
      } else {
        resCallsStatus.className = 'badge badge-outline badge-sm';
        resCallsStatus.textContent = '未启用 (可后台随时配置)';
      }
      resDeployedAt.textContent = res.deployed_at;
      if (resVersion) {
        resVersion.textContent = res.version ? `v${res.version}` : (appVersionBadge?.textContent || 'v1.0.0');
      }
      if (downloadBackupBtn) downloadBackupBtn.textContent = '📥 导出部署凭证 (.txt)';
    }

    // 延迟 1 秒后展示交付面板
    setTimeout(() => {
      showView(successView);
    }, 1200);
  }

  // 部署失败处理
  function onDeployFailed(errorMsg) {
    updateProgressUI(100, '❌ 部署失败');
    deployErrorBox.classList.remove('hidden');
    deployErrorMessage.textContent = errorMsg || '部署过程中遇到错误，请查看上方控制台日志定位原因。';
  }

  retryConfigBtn.addEventListener('click', () => {
    showView(formView);
  });

  // 控制台自动滚屏切换
  autoScrollToggle.addEventListener('click', () => {
    autoScroll = !autoScroll;
    if (autoScroll) {
      autoScrollToggle.textContent = '自动滚屏: 开';
      autoScrollToggle.classList.add('active');
    } else {
      autoScrollToggle.textContent = '自动滚屏: 关';
      autoScrollToggle.classList.remove('active');
    }
  });

  // 复制日志
  copyLogsBtn.addEventListener('click', () => {
    const text = terminalLogs.innerText;
    navigator.clipboard.writeText(text).then(() => {
      const orig = copyLogsBtn.textContent;
      copyLogsBtn.textContent = '已复制！';
      setTimeout(() => copyLogsBtn.textContent = orig, 1500);
    });
  });

  // 交付页密码明文切换
  toggleResPassEye.addEventListener('click', () => {
    if (resAdminPass.textContent.includes('•')) {
      resAdminPass.textContent = realAdminPassValue;
      toggleResPassEye.textContent = '隐藏密码';
    } else {
      resAdminPass.textContent = '••••••••••••••••';
      toggleResPassEye.textContent = '显示明文';
    }
  });

  // 查看资源清单折叠
  resResourceToggle.addEventListener('click', () => {
    const isHidden = resResourceTable.classList.contains('hidden');
    if (isHidden) {
      resResourceTable.classList.remove('hidden');
      resResourceArrow.classList.add('open');
    } else {
      resResourceTable.classList.add('hidden');
      resResourceArrow.classList.remove('open');
    }
  });

  // 统一复制按钮处理
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.copy-btn');
    if (btn) {
      const targetId = btn.getAttribute('data-target');
      let text = '';
      if (targetId === 'resAdminPass') {
        text = realAdminPassValue;
      } else {
        const el = document.getElementById(targetId);
        text = el ? el.textContent.trim() : '';
      }
      if (text) {
        navigator.clipboard.writeText(text).then(() => {
          const orig = btn.textContent;
          btn.textContent = '已复制！';
          setTimeout(() => btn.textContent = orig, 1500);
        });
      }
    }
  });

  // 导出部署配置备忘文件
  downloadBackupBtn.addEventListener('click', () => {
    if (!lastDeployedResult) return;
    const res = lastDeployedResult;
    const verText = res.version ? `v${res.version}` : (appVersionBadge?.textContent || 'v1.0.0');
    let content = '';
    let filename = '';

    if (res.mode === 'uninstall') {
      content = `==================================================
Edgechat Cloudflare 资源清理与卸载报告
==================================================
执行时间: ${res.deployed_at || '-'}
目标 Worker: ${res.worker_name || '-'}
Cloudflare Account ID: ${res.account_id || '-'}

---------------- 清理结果 ----------------
${res.summary || '卸载完成'}
已成功清理的项目:
${(res.deleted_items?.length) ? res.deleted_items.map((i) => ` - ${i}`).join('\n') : ' (未检测到或无项目)'}

==================================================`;
      filename = `edgechat-uninstall-${res.worker_name || 'cfchat'}-${Date.now()}.txt`;
    } else if (res.mode === 'reset_admin') {
      content = `==================================================
Edgechat 管理员密码重置凭据备忘
==================================================
执行时间: ${res.deployed_at || '-'}
目标 Worker: ${res.worker_name || '-'}
Cloudflare Account ID: ${res.account_id || '-'}
D1 数据库: ${res.d1_database_id || res.d1_name || '-'}

---------------- 最新管理员凭据 ----------------
管理员账号: ${res.admin_username || 'admin'}
管理员密码: ${res.admin_password || ''}

提示：历史会话已全部注销失效，请使用上述新密码登录系统后台。
==================================================`;
      filename = `edgechat-reset-admin-${res.worker_name || 'cfchat'}-${Date.now()}.txt`;
    } else {
      content = `==================================================
Edgechat Cloudflare 部署凭证备忘
==================================================
部署版本: ${verText}
部署时间: ${res.deployed_at}
Worker 服务名: ${res.worker_name}
Cloudflare Account ID: ${res.account_id}

---------------- 访问入口 ----------------
🔒 真实聊天入口: ${res.real_entry_urls?.[0] || res.worker_url}
🔑 系统管理后台: ${res.admin_urls?.[0] || `${res.worker_url}/admin`}
🎭 伪装访问地址: ${res.disguise_url} (反代: ${res.disguise_host})
隐藏入口前缀: ${res.route_prefix || '未设置 (根路径)'}

---------------- 管理员凭据 ----------------
管理员账号: ${res.admin_username}
管理员密码: ${res.admin_password}

---------------- 资源绑定 ----------------
D1 Database ID: ${res.d1_database_id}
KV Namespace ID: ${res.kv_namespace_id}
存储方案: ${res.storage_type === 'gdrive' ? 'Google Drive 云端硬盘 (免绑卡 · 15GB 免费)' : `Cloudflare R2 (${res.r2_bucket || 'cfchat-files'})`}
R2 存储状态: ${res.storage_type === 'gdrive' ? '免绑卡 (已使用 Google Drive)' : (res.r2_available ? '已启用' : '已平滑降级 (无 R2)')}
Calls 音视频 SFU: ${res.calls_enabled ? '已启用' : '未配置'}

提示：请妥善保存此文件，建议将真实聊天入口加入浏览器书签。
==================================================`;
      filename = `edgechat-deploy-${res.worker_name}-${Date.now()}.txt`;
    }

    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  });

  // 核心特性：立即物理销毁部署数据与日志
  destroyJobBtn.addEventListener('click', async () => {
    if (!currentJobId) return;
    const confirmDestroy = confirm('⚠️ 确定要立即销毁本次部署在服务器上的所有临时数据与日志吗？\n\n销毁后：\n1. 服务器上的临时工作目录与日志将彻底物理删除\n2. 不会影响您已成功部署在 Cloudflare 上的服务\n3. 请确保您已记录好上方的访问链接与管理员密码');
    if (!confirmDestroy) return;

    destroyJobBtn.disabled = true;
    destroyJobBtn.textContent = '正在物理销毁中...';

    try {
      const res = await fetch(`/api/jobs/${currentJobId}/destroy`, {
        method: 'POST'
      });
      const data = await res.json();
      if (res.ok) {
        destroyedNotice.classList.remove('hidden');
        destroyJobBtn.textContent = '✅ 本次部署数据已彻底销毁';
        destroyJobBtn.classList.remove('btn-danger');
        destroyJobBtn.classList.add('btn-secondary');
      } else {
        alert(`销毁失败: ${data.detail || '未知错误'}`);
        destroyJobBtn.disabled = false;
        destroyJobBtn.textContent = '🗑️ 立即销毁本次部署数据与日志';
      }
    } catch (err) {
      alert(`请求销毁失败: ${err.message}`);
      destroyJobBtn.disabled = false;
      destroyJobBtn.textContent = '🗑️ 立即销毁本次部署数据与日志';
    }
  });

});
