import { Database, Gauge, Megaphone, MessagesSquare, Send, Settings, UserCog, UserPlus, Users } from '@lucide/vue';

export const adminNavigation = [
  {
    id: 'dashboard',
    label: '仪表盘',
    description: '查看站点运行概况',
    to: '/admin/dashboard',
    icon: Gauge
  },
  {
    id: 'channels',
    label: '群聊管理',
    description: '查看所有群聊，加入、删除及默认群策略',
    to: '/admin/channels',
    icon: MessagesSquare
  },
  {
    id: 'announcements',
    label: '系统公告',
    description: '发布与管理全站公告与通知',
    to: '/admin/announcements',
    icon: Megaphone
  },
  {
    id: 'groups',
    label: '用户分组',
    description: '管理组织架构与用户分组隔离',
    to: '/admin/groups',
    icon: Users
  },
  {
    id: 'users',
    label: '用户管理',
    description: '维护现有账号与权限',
    to: '/admin/users',
    icon: UserCog
  },
  {
    id: 'storage',
    label: '存储统计',
    description: '查看每个用户的 R2 存储占用',
    to: '/admin/storage',
    icon: Database
  },
  {
    id: 'invites',
    label: '注册邀请',
    description: '创建账号与管理注册链接',
    to: '/admin/invites',
    icon: UserPlus,
    children: [
      { id: 'create-user', label: '创建用户', hash: '#create-user' },
      { id: 'registration-links', label: '注册链接', hash: '#registration-links' }
    ]
  },
  {
    id: 'telegram',
    label: 'Telegram 互通',
    description: '管理 Bot 与公开群组映射',
    to: '/admin/telegram',
    icon: Send
  },
  {
    id: 'site',
    label: '网站设置',
    description: '维护站点外观与版本状态',
    to: '/admin/site',
    icon: Settings,
    children: [
      { id: 'site-appearance', label: '站点外观', hash: '#site-appearance' },
      { id: 'storage-engine', label: '存储引擎', hash: '#storage-engine' },
      { id: 'upload-settings', label: '文件上传', hash: '#upload-settings' },
      { id: 'message-retention', label: '定期清理', hash: '#message-retention' },
      { id: 'backup-restore', label: '备份恢复', hash: '#backup-restore' },
      { id: 'version-update', label: '版本更新', hash: '#version-update' }
    ]
  }
];

export const adminRouteIcons = {
  dashboard: Gauge,
  channels: MessagesSquare,
  announcements: Megaphone,
  groups: Users,
  users: UserCog,
  storage: Database,
  invites: UserPlus,
  telegram: Send,
  site: Settings
};
