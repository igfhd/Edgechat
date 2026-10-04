import {
  cloneDemo,
  demoState,
  findDemoChannel,
  findDemoUser,
  getDemoMembers,
  projectDemoChannel,
  projectDemoDm,
  projectDemoUser,
  roomKey,
  storeDemoFile
} from './state.js';

const DEMO_DELAY_MS = 90;

function fail(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  error.payload = { error: message };
  throw error;
}

function parseBody(options) {
  if (!options.body) return {};
  if (typeof FormData !== 'undefined' && options.body instanceof FormData) {
    return options.body;
  }
  if (typeof options.body === 'string') {
    return JSON.parse(options.body);
  }
  return options.body;
}

function delay() {
  return new Promise((resolve) => globalThis.setTimeout(resolve, DEMO_DELAY_MS));
}

function sessionForUser(user) {
  return {
    token: 'edgechat-demo-session',
    userId: user.id,
    username: user.username,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    isAdmin: Boolean(user.isAdmin),
    sessionVersion: 1
  };
}

function bootstrapPayload() {
  return {
    channels: demoState.channels.map(projectDemoChannel),
    dms: demoState.dms.map(projectDemoDm),
    users: demoState.users
      .filter((user) => Number(user.id) !== Number(demoState.session.userId) && !user.isDisabled)
      .map(projectDemoUser)
  };
}

function telegramPayload() {
  return cloneDemo({
    config: demoState.telegram.config,
    channels: demoState.channels
      .filter((channel) => channel.kind === 'public')
      .map(({ id, name }) => ({ id, name })),
    mappings: demoState.telegram.mappings
  });
}

function adminOverviewPayload() {
  const channels = demoState.channels.map((channel) => ({
    id: channel.id,
    name: channel.name,
    description: channel.description,
    kind: channel.kind,
    isGeneral: channel.isGeneral,
    ownerDisplayName: channel.ownerDisplayName,
    memberCount: channel.memberCount,
    messageCount: (demoState.messages[roomKey(channel.kind, channel.id)] || []).length,
    createdAt: channel.createdAt
  }));
  const dms = demoState.dms.map((dm) => ({
    id: dm.id,
    name: dm.participantIds.join(':'),
    participants: `演示管理员 / ${dm.otherUser.displayName}`,
    messageCount: (demoState.messages[roomKey('dm', dm.id)] || []).length,
    createdAt: dm.createdAt
  }));
  return {
    site: cloneDemo(demoState.site),
    users: demoState.users.map(projectDemoUser),
    channels,
    dms
  };
}

function adminStoragePayload() {
  return {
    users: demoState.users.map((user) => ({
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      isDeleted: false
    })),
    items: [
      {
        ownerKey: 'user:1',
        ownerType: 'user',
        ownerId: 1,
        objectCount: 2,
        bytes: 2734080,
        latestUploadedAt: '2026-08-14T09:58:00.000Z'
      },
      {
        ownerKey: 'user:3',
        ownerType: 'user',
        ownerId: 3,
        objectCount: 1,
        bytes: 8420,
        latestUploadedAt: '2026-08-14T09:36:00.000Z'
      },
      {
        ownerKey: 'system:telegram',
        ownerType: 'telegram',
        ownerId: null,
        objectCount: 1,
        bytes: 524288,
        latestUploadedAt: '2026-08-14T09:50:00.000Z'
      }
    ],
    scannedObjects: 4,
    truncated: false,
    cursor: null
  };
}

function createInvite(body) {
  const maxUses = Number(body.maxUses || 1);
  const groupId = body.groupId ? Number(body.groupId) : null;
  let groupName = '';
  if (groupId && Array.isArray(demoState.groups)) {
    const g = demoState.groups.find((item) => Number(item.id) === groupId);
    if (g) groupName = g.name;
  }

  const invite = {
    id: demoState.nextInviteId++,
    token: `demo-${Math.random().toString(36).slice(2, 10)}`,
    note: String(body.note || ''),
    maxUses,
    usedCount: 0,
    remainingUses: maxUses,
    groupId,
    groupName,
    isAvailable: true,
    deletedAt: null,
    consumerDisplayName: '',
    creatorDisplayName: demoState.session.displayName,
    createdAt: new Date().toISOString()
  };
  demoState.invites.unshift(invite);
  return cloneDemo(invite);
}

function getChannelRoom(channel) {
  return {
    id: channel.id,
    kind: channel.kind,
    name: channel.name,
    isGeneral: channel.isGeneral,
    canManage: channel.canManage,
    myRole: channel.myRole,
    avatarKey: channel.avatarKey,
    avatarUrl: channel.avatarUrl
  };
}

function createGroup(body) {
  const id = demoState.nextChannelId++;
  const ownerId = Number(demoState.session.userId);
  const kind = String(body.kind || 'public').trim();
  const memberIds = [ownerId, ...(body.memberUserIds || []).map(Number)].filter(
    (userId, index, values) => values.indexOf(userId) === index
  );
  const channel = {
    id,
    kind,
    name: String(body.name || '').trim(),
    description: '',
    avatarKey: '',
    avatarUrl: '',
    isGeneral: false,
    ownerId,
    ownerDisplayName: demoState.session.displayName,
    isMember: true,
    myRole: 'owner',
    canManage: true,
    memberCount: memberIds.length,
    memberIds,
    lastMessageAt: new Date().toISOString(),
    unreadCount: 0,
    createdAt: new Date().toISOString()
  };
  demoState.channels.push(channel);
  demoState.messages[roomKey(channel.kind, channel.id)] = [];
  return projectDemoChannel(channel);
}

function createAdminUser(body) {
  const username = String(body.username || '').trim();
  const displayName = String(body.displayName || username).trim();
  if (!username || !body.password) fail('请填写用户名和密码');
  const user = {
    id: demoState.nextUserId++,
    username,
    displayName,
    avatarUrl: '',
    isAdmin: false,
    isDisabled: false,
    createdAt: new Date().toISOString()
  };
  demoState.users.push(user);
  return projectDemoUser(user);
}

export async function requestDemo(path, options = {}) {
  await delay();
  const method = String(options.method || 'GET').toUpperCase();
  const url = new URL(path, 'https://edgechat.demo');
  const pathname = url.pathname;
  const body = parseBody(options);

  if (method === 'GET' && pathname === '/site') {
    return { site: cloneDemo(demoState.site) };
  }
  if (method === 'GET' && pathname === '/auth/session') {
    return { session: cloneDemo(demoState.session) };
  }
  if (method === 'POST' && pathname === '/auth/login') {
    if (!String(body.username || '').trim() || !String(body.password || '')) {
      fail('请输入账号和密码');
    }
    const user = demoState.users.find((item) => item.username === body.username) || demoState.users[0];
    demoState.session = sessionForUser(user);
    return { token: demoState.session.token, session: cloneDemo(demoState.session) };
  }
  if (method === 'POST' && pathname === '/auth/logout') {
    return { ok: true };
  }
  if (method === 'POST' && pathname === '/auth/change-password') {
    if (!body.currentPassword || !body.newPassword) fail('请填写完整密码');
    return { ok: true };
  }
  if (method === 'PATCH' && pathname === '/me/profile') {
    const user = findDemoUser(demoState.session.userId);
    if (body.displayName) {
      user.displayName = String(body.displayName).trim();
      demoState.session.displayName = user.displayName;
    }
    if (body.avatarKey) {
      user.avatarUrl = demoState.files.get(body.avatarKey) || '';
      demoState.session.avatarUrl = user.avatarUrl;
    }
    return { session: cloneDemo(demoState.session) };
  }
  if (method === 'GET' && pathname === '/users') {
    return { users: bootstrapPayload().users };
  }
  if (method === 'GET' && pathname === '/bootstrap') {
    return bootstrapPayload();
  }
  if (method === 'GET' && pathname === '/channels') {
    return { channels: demoState.channels.map(projectDemoChannel) };
  }
  if (method === 'POST' && pathname === '/channels') {
    if (!String(body.name || '').trim()) fail('请输入群组名称');
    if (!['public', 'private'].includes(String(body.kind || 'public').trim())) fail('群组类型无效');
    return { channel: createGroup(body) };
  }

  let match = pathname.match(/^\/channels\/(\d+)\/join$/);
  if (method === 'POST' && match) {
    const channel = findDemoChannel(match[1]);
    if (!channel || channel.kind !== 'public') fail('公开群组不存在', 404);
    if (!channel.memberIds.includes(demoState.session.userId)) {
      channel.memberIds.push(demoState.session.userId);
      channel.memberCount = channel.memberIds.length;
    }
    channel.isMember = true;
    return { channel: projectDemoChannel(channel) };
  }

  match = pathname.match(/^\/channels\/(\d+)\/members$/);
  if (method === 'GET' && match) {
    const channel = findDemoChannel(match[1]);
    if (!channel) fail('群组不存在', 404);
    return { members: getDemoMembers(channel), room: getChannelRoom(channel) };
  }

  match = pathname.match(/^\/channels\/(\d+)\/invite$/);
  if (method === 'POST' && match) {
    const channel = findDemoChannel(match[1]);
    for (const userId of body.userIds || []) {
      if (!channel.memberIds.includes(Number(userId))) channel.memberIds.push(Number(userId));
    }
    channel.memberCount = channel.memberIds.length;
    return { members: getDemoMembers(channel), room: getChannelRoom(channel) };
  }

  match = pathname.match(/^\/channels\/(\d+)\/transfer-owner$/);
  if (method === 'POST' && match) {
    const channel = findDemoChannel(match[1]);
    const newOwnerId = Number(body.newOwnerId || body.userId);
    if (channel) channel.createdBy = newOwnerId;
    return { ok: true, channelId: Number(match[1]), newOwnerId, members: getDemoMembers(channel) };
  }

  match = pathname.match(/^\/channels\/(\d+)\/members\/(\d+)$/);
  if (method === 'DELETE' && match) {
    const channel = findDemoChannel(match[1]);
    channel.memberIds = channel.memberIds.filter((userId) => Number(userId) !== Number(match[2]));
    channel.memberCount = channel.memberIds.length;
    return { members: getDemoMembers(channel), room: getChannelRoom(channel) };
  }

  match = pathname.match(/^\/channels\/(\d+)$/);
  if (method === 'PATCH' && match) {
    const channel = findDemoChannel(match[1]);
    if (!channel) fail('群组不存在', 404);
    channel.name = String(body.name || channel.name).trim();
    channel.avatarKey = body.avatarKey || '';
    channel.avatarUrl = channel.avatarKey ? demoState.files.get(channel.avatarKey) || '' : '';
    return { channel: projectDemoChannel(channel) };
  }
  if (method === 'DELETE' && match) {
    const channelId = Number(match[1]);
    const index = demoState.channels.findIndex((channel) => Number(channel.id) === channelId);
    if (index >= 0) {
      const [channel] = demoState.channels.splice(index, 1);
      delete demoState.messages[roomKey(channel.kind, channel.id)];
    }
    return { ok: true };
  }

  if (method === 'GET' && pathname === '/messages') {
    const kind = url.searchParams.get('kind');
    const roomId = url.searchParams.get('roomId');
    const before = Number(url.searchParams.get('before') || 0);
    const allMessages = demoState.messages[roomKey(kind, roomId)] || [];
    const filtered = before ? allMessages.filter((message) => Number(message.id) < before) : allMessages;
    return { messages: cloneDemo(filtered.slice(-30)) };
  }
  if (method === 'POST' && pathname === '/messages/read') {
    const room = body.kind === 'dm'
      ? demoState.dms.find((dm) => Number(dm.id) === Number(body.roomId))
      : findDemoChannel(body.roomId);
    if (room) room.unreadCount = 0;
    return { ok: true };
  }
  if (method === 'POST' && pathname === '/dm/open') {
    const user = findDemoUser(body.userId);
    if (!user) fail('用户不存在', 404);
    let dm = demoState.dms.find((item) => Number(item.otherUser.id) === Number(user.id));
    if (!dm) {
      dm = {
        id: demoState.nextDmId++,
        kind: 'dm',
        otherUser: user,
        participantIds: [demoState.session.userId, user.id],
        lastMessageAt: new Date().toISOString(),
        unreadCount: 0,
        createdAt: new Date().toISOString()
      };
      demoState.dms.push(dm);
      demoState.messages[roomKey('dm', dm.id)] = [];
    }
    return { dm: projectDemoDm(dm) };
  }
  match = pathname.match(/^\/dm\/(\d+)$/);
  if (method === 'DELETE' && match) {
    const id = Number(match[1]);
    const idx = demoState.dms.findIndex((d) => Number(d.id) === id);
    if (idx !== -1) {
      demoState.dms.splice(idx, 1);
    }
    delete demoState.messages[roomKey('dm', id)];
    return { ok: true };
  }
  if (method === 'GET' && pathname === '/dm') {
    return { dms: demoState.dms.map(projectDemoDm) };
  }
  if (method === 'POST' && pathname === '/upload') {
    const file = body.get('file');
    if (!file) fail('请选择文件');
    return { file: storeDemoFile(file) };
  }

  if (method === 'POST' && pathname === '/keys/identity') {
    demoState.identityKeys = demoState.identityKeys || {};
    const existing = demoState.identityKeys[demoState.session.userId];
    if (existing?.publicKey && existing.publicKey !== body.publicKey && !body.resetConfirmed) {
      fail('该账户已存在绑定的端到端加密公钥，如需更换/重置公钥请显式确认');
    }
    demoState.identityKeys[demoState.session.userId] = {
      userId: demoState.session.userId,
      publicKey: body.publicKey,
      keyVersion: body.keyVersion || 1
    };
    return { ok: true, key: demoState.identityKeys[demoState.session.userId] };
  }
  match = pathname.match(/^\/keys\/identity\/(\d+)$/);
  if (method === 'GET' && match) {
    demoState.identityKeys = demoState.identityKeys || {};
    const userId = Number(match[1]);
    const key = demoState.identityKeys[userId] || null;
    return { ok: true, key };
  }
  if (method === 'POST' && pathname === '/keys/identity/batch') {
    demoState.identityKeys = demoState.identityKeys || {};
    const userIds = Array.isArray(body.userIds) ? body.userIds : [];
    const keys = {};
    for (const id of userIds) {
      if (demoState.identityKeys[id]) {
        keys[id] = demoState.identityKeys[id];
      }
    }
    return { ok: true, keys };
  }
  if (method === 'POST' && pathname === '/keys/backup') {
    demoState.keyBackups = demoState.keyBackups || {};
    demoState.keyBackups[demoState.session.userId] = {
      userId: demoState.session.userId,
      encryptedPrivateKey: body.encryptedPrivateKey,
      backupSalt: body.backupSalt,
      backupIv: body.backupIv,
      keyVersion: body.keyVersion || 1
    };
    return { ok: true, backup: demoState.keyBackups[demoState.session.userId] };
  }
  if (method === 'GET' && pathname === '/keys/backup') {
    demoState.keyBackups = demoState.keyBackups || {};
    return { ok: true, backup: demoState.keyBackups[demoState.session.userId] || null };
  }

  if (method === 'GET' && pathname === '/admin/overview') {
    return cloneDemo(adminOverviewPayload());
  }
  if (method === 'GET' && pathname === '/admin/storage/scan') {
    return cloneDemo(adminStoragePayload());
  }
  if (method === 'GET' && pathname === '/admin/users') {
    return { users: cloneDemo(demoState.users.map(projectDemoUser)) };
  }
  if (method === 'POST' && pathname === '/admin/users') {
    return { user: createAdminUser(body) };
  }

  match = pathname.match(/^\/admin\/users\/(\d+)\/reset-password$/);
  if (method === 'POST' && match) {
    if (!body.password) fail('请输入新密码');
    return { ok: true };
  }

  match = pathname.match(/^\/admin\/users\/(\d+)$/);
  if (method === 'PATCH' && match) {
    const user = findDemoUser(match[1]);
    if (!user) fail('用户不存在', 404);
    user.displayName = String(body.displayName || user.displayName);
    if (body.isDisabled !== undefined) {
      user.isDisabled = Boolean(body.isDisabled);
    }
    if (body.isAdmin !== undefined) {
      user.isAdmin = Boolean(body.isAdmin);
    }
    return { user: projectDemoUser(user) };
  }
  if (method === 'DELETE' && match) {
    demoState.users = demoState.users.filter((user) => Number(user.id) !== Number(match[1]));
    return { ok: true };
  }

  if (method === 'GET' && pathname === '/admin/register-links') {
    return { invites: cloneDemo(demoState.invites) };
  }
  if (method === 'POST' && pathname === '/admin/register-links') {
    return { invite: createInvite(body) };
  }

  match = pathname.match(/^\/admin\/register-links\/(\d+)$/);
  if (method === 'DELETE' && match) {
    demoState.invites = demoState.invites.filter((invite) => Number(invite.id) !== Number(match[1]));
    return { ok: true };
  }

  if (method === 'GET' && pathname === '/admin/telegram') {
    return telegramPayload();
  }
  if (method === 'PUT' && pathname === '/admin/telegram/config') {
    if (!body.botToken) fail('请输入 Bot Token');
    demoState.telegram.config = {
      configured: true,
      botUsername: 'edgechat_demo_bot',
      webhookUrl: 'https://edgechat-demo.workers.dev/api/telegram/webhook'
    };
    return telegramPayload();
  }
  if (method === 'POST' && pathname === '/admin/telegram/mappings') {
    const channel = findDemoChannel(body.channelId);
    if (!channel) fail('请选择公开群组');
    demoState.telegram.mappings.push({
      id: demoState.nextMappingId++,
      channelId: channel.id,
      channelName: channel.name,
      telegramChatTitle: 'Telegram 演示群',
      telegramChatId: String(body.telegramChatId || ''),
      syncMode: body.syncMode || 'both',
      enabled: true
    });
    return telegramPayload();
  }

  match = pathname.match(/^\/admin\/telegram\/mappings\/(\d+)$/);
  if (method === 'PATCH' && match) {
    const mapping = demoState.telegram.mappings.find((item) => Number(item.id) === Number(match[1]));
    if (typeof body.enabled === 'boolean') {
      mapping.enabled = body.enabled;
    }
    if (body.syncMode) {
      mapping.syncMode = body.syncMode;
    }
    return telegramPayload();
  }
  if (method === 'DELETE' && match) {
    demoState.telegram.mappings = demoState.telegram.mappings.filter(
      (item) => Number(item.id) !== Number(match[1])
    );
    return telegramPayload();
  }

  if (method === 'GET' && pathname === '/admin/site-settings') {
    return { site: cloneDemo(demoState.site) };
  }
  if (method === 'PATCH' && pathname === '/admin/site-settings') {
    demoState.site = {
      siteName: body.siteName !== undefined ? String(body.siteName || 'EdgeChat Demo').trim() : (demoState.site.siteName || 'EdgeChat Demo'),
      siteIconUrl: body.siteIconUrl !== undefined ? String(body.siteIconUrl || '').trim() : (demoState.site.siteIconUrl || ''),
      messageRetentionDays: body.messageRetentionDays !== undefined ? Number(body.messageRetentionDays) : (demoState.site.messageRetentionDays || 7),
      autoCleanupEnabled: body.autoCleanupEnabled !== undefined ? Boolean(body.autoCleanupEnabled) : (demoState.site.autoCleanupEnabled ?? true)
    };
    return { site: cloneDemo(demoState.site) };
  }
  if (method === 'POST' && pathname === '/admin/run-gc') {
    return {
      ok: true,
      summary: {
        expiredMessagesDeleted: 0,
        r2Deleted: 0,
      }
    };
  }
  if (method === 'GET' && pathname === '/admin/channels') {
    return { channels: adminOverviewPayload().channels };
  }
  if (method === 'GET' && pathname === '/admin/dms') {
    return { dms: adminOverviewPayload().dms };
  }
  if (method === 'GET' && pathname === '/admin/groups') {
    demoState.groups = demoState.groups || [
      { id: 1, name: '研发组', description: '负责系统开发与架构', memberCount: 2, createdAt: new Date().toISOString() },
      { id: 2, name: '运营组', description: '负责社群与日常运营', memberCount: 1, createdAt: new Date().toISOString() }
    ];
    return { groups: cloneDemo(demoState.groups) };
  }
  if (method === 'POST' && pathname === '/admin/groups') {
    demoState.groups = demoState.groups || [];
    const newGroup = {
      id: demoState.groups.length + 1,
      name: body.name,
      description: body.description || '',
      memberCount: 0,
      createdAt: new Date().toISOString()
    };
    demoState.groups.push(newGroup);
    return { group: cloneDemo(newGroup) };
  }
  match = pathname.match(/^\/admin\/groups\/(\d+)$/);
  if (method === 'PUT' && match) {
    demoState.groups = demoState.groups || [];
    const g = demoState.groups.find((item) => Number(item.id) === Number(match[1]));
    if (g) {
      if (body.name) g.name = body.name;
      if (body.description !== undefined) g.description = body.description;
    }
    return { group: cloneDemo(g) };
  }
  if (method === 'DELETE' && match) {
    demoState.groups = (demoState.groups || []).filter((item) => Number(item.id) !== Number(match[1]));
    return { ok: true };
  }
  match = pathname.match(/^\/admin\/groups\/(\d+)\/members$/);
  if (method === 'GET' && match) {
    return { members: cloneDemo(demoState.users.slice(0, 2)) };
  }
  if (method === 'POST' && match) {
    return { ok: true, addedCount: 1 };
  }
  match = pathname.match(/^\/admin\/groups\/(\d+)\/members\/(\d+)$/);
  if (method === 'DELETE' && match) {
    return { ok: true };
  }
  match = pathname.match(/^\/admin\/groups\/(\d+)\/members\/(\d+)\/role$/);
  if (method === 'PUT' && match) {
    return { ok: true, groupId: Number(match[1]), userId: Number(match[2]), role: body.role };
  }
  if (method === 'GET' && pathname === '/me/managed-groups') {
    return { groups: cloneDemo(demoState.groups || []) };
  }
  match = pathname.match(/^\/me\/managed-groups\/(\d+)\/policy$/);
  if (method === 'PATCH' && match) {
    const g = (demoState.groups || []).find((item) => Number(item.id) === Number(match[1]));
    if (g) g.allowMemberDm = Boolean(body.allowMemberDm);
    return { ok: true, group: cloneDemo(g) };
  }

  match = pathname.match(/^\/register-links\/([^/]+)$/);
  if (method === 'GET' && match) {
    const invite = demoState.invites.find((item) => item.token === decodeURIComponent(match[1]));
    if (!invite?.isAvailable) fail('注册链接已失效', 404);
    return {
      site: cloneDemo(demoState.site),
      invite: {
        note: invite.note,
        createdAt: invite.createdAt,
        remainingUses: invite.remainingUses,
        groupId: invite.groupId,
        groupName: invite.groupName
      }
    };
  }

  match = pathname.match(/^\/register-links\/([^/]+)\/register$/);
  if (method === 'POST' && match) {
    const invite = demoState.invites.find((item) => item.token === decodeURIComponent(match[1]));
    if (!invite?.isAvailable) fail('注册链接已失效', 404);
    createAdminUser(body);
    invite.usedCount += 1;
    invite.remainingUses = Math.max(0, invite.maxUses - invite.usedCount);
    invite.isAvailable = invite.remainingUses > 0;
    invite.consumerDisplayName = body.displayName || body.username;
    return { ok: true };
  }

  fail(`演示接口未实现：${method} ${pathname}`, 404);
}
