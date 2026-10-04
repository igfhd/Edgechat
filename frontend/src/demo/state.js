import { createDemoFixtures } from './fixtures.js';

export let demoState = createDemoFixtures();

export function resetDemoState() {
  for (const url of demoState.files.values()) {
    URL.revokeObjectURL?.(url);
  }
  demoState = createDemoFixtures();
}

export function cloneDemo(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

export function roomKey(kind, roomId) {
  return `${kind}:${Number(roomId)}`;
}

export function findDemoUser(userId) {
  return demoState.users.find((user) => Number(user.id) === Number(userId));
}

export function findDemoChannel(channelId) {
  return demoState.channels.find((channel) => Number(channel.id) === Number(channelId));
}

export function projectDemoUser(user) {
  if (!user) return null;
  const { id, username, displayName, avatarUrl, isDisabled, createdAt, lastActiveAt } = user;
  return {
    id,
    username,
    displayName,
    avatarUrl,
    isDisabled,
    createdAt,
    lastActiveAt: lastActiveAt || createdAt
  };
}

export function projectDemoChannel(channel) {
  if (!channel) return null;
  const {
    memberIds: _memberIds,
    ownerId: _ownerId,
    createdAt: _createdAt,
    ...projection
  } = channel;
  return cloneDemo(projection);
}

export function projectDemoDm(dm) {
  if (!dm) return null;
  return {
    id: dm.id,
    kind: 'dm',
    otherUser: projectDemoUser(dm.otherUser),
    lastMessageAt: dm.lastMessageAt,
    unreadCount: dm.unreadCount
  };
}

export function getDemoMembers(channel) {
  return channel.memberIds
    .map((userId) => findDemoUser(userId))
    .filter(Boolean)
    .map((user) => ({
      ...projectDemoUser(user),
      role: Number(user.id) === Number(channel.ownerId) ? 'owner' : 'member',
      joinedAt: channel.createdAt
    }));
}

export function createDemoMessage({ kind, roomId, content, attachment, sender }) {
  const message = {
    id: demoState.nextMessageId++,
    content: String(content || ''),
    createdAt: new Date().toISOString(),
    sender: cloneDemo(sender),
    attachment: attachment ? cloneDemo(attachment) : null
  };
  const key = roomKey(kind, roomId);
  demoState.messages[key] ||= [];
  demoState.messages[key].push(message);

  const room = kind === 'dm'
    ? demoState.dms.find((dm) => Number(dm.id) === Number(roomId))
    : findDemoChannel(roomId);
  if (room) {
    room.lastMessageAt = message.createdAt;
  }
  return message;
}

export function getDemoFileUrl(keyOrUrl) {
  const raw = String(keyOrUrl || '');
  if (!raw) return '';
  return demoState.files.get(raw) || raw;
}

export function storeDemoFile(file) {
  const key = `demo/${Date.now()}-${encodeURIComponent(file.name || 'file')}`;
  const url = URL.createObjectURL(file);
  demoState.files.set(key, url);
  return {
    key,
    url,
    name: file.name || 'file',
    type: file.type || 'application/octet-stream',
    size: Number(file.size || 0)
  };
}
