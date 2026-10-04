/**
 * 将用户列表按照组织架构分组（user.groups）进行归类
 * 支持按姓名、用户名、分组名进行实时搜索筛选
 */
export function groupUsersByDepartment(userList = [], searchQuery = '') {
  const q = String(searchQuery || '').trim().toLowerCase();

  // 1. 过滤匹配的用户
  const matchedUsers = q
    ? userList.filter((u) => {
        const nameMatch = (u.displayName || '').toLowerCase().includes(q);
        const usernameMatch = (u.username || '').toLowerCase().includes(q);
        const groupMatch = Array.isArray(u.groups) && u.groups.some((g) => (g.name || '').toLowerCase().includes(q));
        return nameMatch || usernameMatch || groupMatch;
      })
    : userList;

  // 2. 按分组归类
  const groupsMap = new Map();
  const ungroupedUsers = [];

  for (const user of matchedUsers) {
    const userGroups = Array.isArray(user.groups) && user.groups.length > 0 ? user.groups : null;
    if (!userGroups) {
      ungroupedUsers.push(user);
    } else {
      for (const g of userGroups) {
        if (q) {
          const userMatchedDirectly = (user.displayName || '').toLowerCase().includes(q) ||
            (user.username || '').toLowerCase().includes(q);
          const groupMatchedDirectly = (g.name || '').toLowerCase().includes(q);
          if (!userMatchedDirectly && !groupMatchedDirectly) {
            continue;
          }
        }
        const key = `group-${g.id}`;
        if (!groupsMap.has(key)) {
          groupsMap.set(key, {
            id: key,
            groupId: g.id,
            name: g.name,
            users: []
          });
        }
        groupsMap.get(key).users.push(user);
      }
    }
  }

  const result = [];
  // 已命名的组织架构分组按名称排序
  const sortedGroups = Array.from(groupsMap.values()).sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  result.push(...sortedGroups);

  // 未分组用户
  if (ungroupedUsers.length > 0) {
    result.push({
      id: 'ungrouped',
      groupId: null,
      name: groupsMap.size > 0 ? '未分组人员' : '全部联系人',
      users: ungroupedUsers
    });
  }

  return result;
}

/**
 * 将私聊会话列表（dmConversations）按照对方所在组织架构分组归类
 * 支持按联系人姓名、用户名、分组名进行实时搜索筛选
 */
export function groupDmsByDepartment(dmList = [], searchQuery = '') {
  const q = String(searchQuery || '').trim().toLowerCase();

  // 1. 过滤匹配的私聊会话
  const matchedDms = q
    ? dmList.filter((item) => {
        const user = item.otherUser || item.source?.otherUser || {};
        const titleMatch = (item.title || '').toLowerCase().includes(q);
        const usernameMatch = (user.username || '').toLowerCase().includes(q);
        const groupMatch = Array.isArray(user.groups) && user.groups.some((g) => (g.name || '').toLowerCase().includes(q));
        return titleMatch || usernameMatch || groupMatch;
      })
    : dmList;

  // 2. 按对方所属部门分组归类
  const groupsMap = new Map();
  const ungroupedDms = [];

  for (const item of matchedDms) {
    const user = item.otherUser || item.source?.otherUser || {};
    const userGroups = Array.isArray(user.groups) && user.groups.length > 0 ? user.groups : null;

    if (!userGroups) {
      ungroupedDms.push(item);
    } else {
      for (const g of userGroups) {
        if (q) {
          const dmMatchedDirectly = (item.title || '').toLowerCase().includes(q) ||
            (user.username || '').toLowerCase().includes(q);
          const groupMatchedDirectly = (g.name || '').toLowerCase().includes(q);
          if (!dmMatchedDirectly && !groupMatchedDirectly) {
            continue;
          }
        }
        const key = `group-${g.id}`;
        if (!groupsMap.has(key)) {
          groupsMap.set(key, {
            id: key,
            groupId: g.id,
            name: g.name,
            items: []
          });
        }
        groupsMap.get(key).items.push(item);
      }
    }
  }

  const result = [];
  // 已命名组织架构分组按名称拼音字母排序
  const sortedGroups = Array.from(groupsMap.values()).sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  result.push(...sortedGroups);

  // 未分组或无所属部门的私聊会话
  if (ungroupedDms.length > 0) {
    result.push({
      id: 'ungrouped',
      groupId: null,
      name: groupsMap.size > 0 ? '未分组人员' : '全部私聊',
      items: ungroupedDms
    });
  }

  return result;
}

/**
 * 将云盘站内协同分享的候选对象（成员 + 群聊）按部门分组与类型归类
 * 方便在分享弹窗中按分组折叠展开、搜索与选中
 */
export function groupCandidatesForSharing(candidates = { users: [], rooms: [] }, searchQuery = '') {
  const q = String(searchQuery || '').trim().toLowerCase();
  const rawUsers = Array.isArray(candidates?.users) ? candidates.users : [];
  const rawRooms = Array.isArray(candidates?.rooms) ? candidates.rooms : [];

  // 1. 过滤成员
  const matchedUsers = q
    ? rawUsers.filter((u) => {
        const name = u.displayName || u.display_name || '';
        const uname = u.username || '';
        const nameMatch = name.toLowerCase().includes(q);
        const unameMatch = uname.toLowerCase().includes(q);
        const groupMatch = Array.isArray(u.groups) && u.groups.some((g) => (g.name || '').toLowerCase().includes(q));
        return nameMatch || unameMatch || groupMatch;
      })
    : rawUsers;

  // 2. 成员按部门归类
  const groupsMap = new Map();
  const ungroupedUsers = [];

  for (const u of matchedUsers) {
    const targetKey = `user:${u.id}`;
    const item = {
      targetKey,
      targetType: 'user',
      id: u.id,
      displayName: u.displayName || u.display_name || u.username,
      username: u.username,
      avatarUrl: u.avatarUrl || u.avatar_url,
      groups: u.groups || [],
      isLeader: Array.isArray(u.groups) && u.groups.some((g) => g.isLeader)
    };

    const userGroups = Array.isArray(u.groups) && u.groups.length > 0 ? u.groups : null;
    if (!userGroups) {
      ungroupedUsers.push(item);
    } else {
      for (const g of userGroups) {
        if (q) {
          const userMatchedDirectly = (u.displayName || u.display_name || '').toLowerCase().includes(q) ||
            (u.username || '').toLowerCase().includes(q);
          const groupMatchedDirectly = (g.name || '').toLowerCase().includes(q);
          if (!userMatchedDirectly && !groupMatchedDirectly) {
            continue;
          }
        }
        const key = `group-${g.id}`;
        if (!groupsMap.has(key)) {
          groupsMap.set(key, {
            id: key,
            groupId: g.id,
            name: g.name,
            type: 'user',
            items: []
          });
        }
        groupsMap.get(key).items.push(item);
      }
    }
  }

  const result = [];
  const sortedGroups = Array.from(groupsMap.values()).sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  result.push(...sortedGroups);

  if (ungroupedUsers.length > 0) {
    result.push({
      id: 'ungrouped',
      groupId: null,
      name: groupsMap.size > 0 ? '未分组人员' : '全部站内成员',
      type: 'user',
      items: ungroupedUsers
    });
  }

  // 3. 过滤并添加群聊分组
  const matchedRooms = q
    ? rawRooms.filter((r) => (r.name || '').toLowerCase().includes(q))
    : rawRooms;

  if (matchedRooms.length > 0) {
    result.push({
      id: 'rooms',
      groupId: null,
      name: '我的群聊/房间',
      type: 'room',
      items: matchedRooms.map((r) => ({
        targetKey: `room:${r.id}`,
        targetType: 'room',
        id: r.id,
        name: r.name,
        displayName: r.name,
        kind: r.kind
      }))
    });
  }

  return result;
}
