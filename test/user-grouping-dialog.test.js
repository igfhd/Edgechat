import assert from 'node:assert/strict';
import test from 'node:test';
import {
  groupUsersByDepartment,
  groupDmsByDepartment,
  groupCandidatesForSharing
} from '../frontend/src/utils/userGrouping.js';

test('groupUsersByDepartment groups users with groups correctly and handles ungrouped users', () => {
  const users = [
    { id: 1, displayName: 'Alice', username: 'alice', groups: [{ id: 10, name: '研发部' }] },
    { id: 2, displayName: 'Bob', username: 'bob', groups: [{ id: 10, name: '研发部' }, { id: 20, name: '设计组' }] },
    { id: 3, displayName: 'Charlie', username: 'charlie', groups: [{ id: 20, name: '设计组' }] },
    { id: 4, displayName: 'David', username: 'david', groups: [] },
    { id: 5, displayName: 'Eva', username: 'eva', groups: null }
  ];

  const grouped = groupUsersByDepartment(users, '');

  assert.equal(grouped.length, 3);
  // Groups are sorted alphabetically by name
  assert.equal(grouped[0].name, '设计组');
  assert.equal(grouped[0].users.length, 2); // Bob, Charlie

  assert.equal(grouped[1].name, '研发部');
  assert.equal(grouped[1].users.length, 2); // Alice, Bob

  assert.equal(grouped[2].name, '未分组人员');
  assert.equal(grouped[2].users.length, 2); // David, Eva
});

test('groupUsersByDepartment filters users by search query matching name, username or group', () => {
  const users = [
    { id: 1, displayName: '张三', username: 'zhangsan', groups: [{ id: 10, name: '研发部' }] },
    { id: 2, displayName: '李四', username: 'lisi', groups: [{ id: 20, name: '市场部' }] },
    { id: 3, displayName: '王五', username: 'wangwu', groups: [] }
  ];

  // 1. 搜索姓名
  const byName = groupUsersByDepartment(users, '张三');
  assert.equal(byName.length, 1);
  assert.equal(byName[0].name, '研发部');
  assert.equal(byName[0].users[0].username, 'zhangsan');

  // 2. 搜索用户名
  const byUsername = groupUsersByDepartment(users, 'lisi');
  assert.equal(byUsername.length, 1);
  assert.equal(byUsername[0].name, '市场部');
  assert.equal(byUsername[0].users[0].displayName, '李四');

  // 3. 搜索部门分组名
  const byGroup = groupUsersByDepartment(users, '研发');
  assert.equal(byGroup.length, 1);
  assert.equal(byGroup[0].name, '研发部');

  // 4. 无匹配项
  const noMatch = groupUsersByDepartment(users, '不存在');
  assert.equal(noMatch.length, 0);
});

test('groupUsersByDepartment returns "全部联系人" when no users have assigned groups', () => {
  const users = [
    { id: 1, displayName: 'Alice', username: 'alice', groups: [] },
    { id: 2, displayName: 'Bob', username: 'bob', groups: [] }
  ];

  const grouped = groupUsersByDepartment(users, '');
  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].id, 'ungrouped');
  assert.equal(grouped[0].name, '全部联系人');
  assert.equal(grouped[0].users.length, 2);
});

test('groupDmsByDepartment groups direct message conversations by department and handles search', () => {
  const dms = [
    {
      key: 'dm:1',
      id: 1,
      title: '张三',
      unreadCount: 2,
      otherUser: { username: 'zhangsan', groups: [{ id: 10, name: '技术部' }] }
    },
    {
      key: 'dm:2',
      id: 2,
      title: '李四',
      unreadCount: 0,
      otherUser: { username: 'lisi', groups: [{ id: 10, name: '技术部' }, { id: 20, name: '运维部' }] }
    },
    {
      key: 'dm:3',
      id: 3,
      title: '王五',
      unreadCount: 1,
      otherUser: { username: 'wangwu', groups: [] }
    }
  ];

  // 1. 无搜索词：按部门归类，李四跨两个组
  const grouped = groupDmsByDepartment(dms, '');
  assert.equal(grouped.length, 3);
  assert.equal(grouped[0].name, '技术部');
  assert.equal(grouped[0].items.length, 2);
  assert.equal(grouped[1].name, '运维部');
  assert.equal(grouped[1].items.length, 1);
  assert.equal(grouped[2].name, '未分组人员');
  assert.equal(grouped[2].items.length, 1);

  // 2. 搜索姓名
  const searched = groupDmsByDepartment(dms, '张三');
  assert.equal(searched.length, 1);
  assert.equal(searched[0].name, '技术部');
  assert.equal(searched[0].items[0].title, '张三');

  // 3. 搜索部门名
  const searchedDept = groupDmsByDepartment(dms, '运维');
  assert.equal(searchedDept.length, 1);
  assert.equal(searchedDept[0].name, '运维部');
  assert.equal(searchedDept[0].items[0].title, '李四');
});

test('groupCandidatesForSharing groups users by department and includes rooms section', () => {
  const candidates = {
    users: [
      { id: 101, display_name: 'Alice', username: 'alice', groups: [{ id: 1, name: '研发组', isLeader: true }] },
      { id: 102, display_name: 'Bob', username: 'bob', groups: [{ id: 1, name: '研发组', isLeader: false }] },
      { id: 103, display_name: 'Carol', username: 'carol', groups: [] }
    ],
    rooms: [
      { id: 501, name: '综合交流大厅', kind: 'public' },
      { id: 502, name: '项目保密群', kind: 'private' }
    ]
  };

  const grouped = groupCandidatesForSharing(candidates, '');
  assert.equal(grouped.length, 3); // 研发组, 未分组人员, 我的群聊/房间

  // 研发组
  assert.equal(grouped[0].name, '研发组');
  assert.equal(grouped[0].items.length, 2);
  assert.equal(grouped[0].items[0].targetKey, 'user:101');
  assert.equal(grouped[0].items[0].isLeader, true);

  // 未分组人员
  assert.equal(grouped[1].name, '未分组人员');
  assert.equal(grouped[1].items.length, 1);
  assert.equal(grouped[1].items[0].targetKey, 'user:103');

  // 我的群聊/房间
  assert.equal(grouped[2].id, 'rooms');
  assert.equal(grouped[2].type, 'room');
  assert.equal(grouped[2].items.length, 2);
  assert.equal(grouped[2].items[0].targetKey, 'room:501');

  // 搜索群聊名称
  const searchRoom = groupCandidatesForSharing(candidates, '保密');
  assert.equal(searchRoom.length, 1);
  assert.equal(searchRoom[0].id, 'rooms');
  assert.equal(searchRoom[0].items.length, 1);
  assert.equal(searchRoom[0].items[0].name, '项目保密群');
});
