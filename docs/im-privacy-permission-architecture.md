# 企业级即时通讯 (IM) 隐私隔离与分层私聊权限控制架构规范
> Enterprise IM Privacy Isolation & Hierarchical DM Permission Engine Architecture

---

## 1. 架构定位与设计哲学

在现代企业协作与即时通讯系统（IM）中，传统的**完全开放模式**（任何人可随意私聊任何人）极易导致：
1. **跨部门私信骚扰**与无意义摸鱼；
2. **商业数据与客户飞单泄露**（基层员工私下联络甚至绕过管理流程）；
3. **组织层级被击穿**（员工随意越级甚至群发推销）。

本架构设计了一种**支持多租户、多部门、多负责人（Multi-Leader）与动态私聊管制策略（DM Policy）**的轻量级零信任通讯权限模型。该模型**完全脱离底层特定运行时**，可无缝套用至任何 IM 系统（如 Slack 类应用、Mattermost、Rocket.Chat、Matrix、基于 WebSocket/gRPC/Socket.io 的自研聊天系统）。

---

## 2. 核心角色与四级权限拓扑

$$\text{系统超级管理员 (System Admin)} \;\longrightarrow\; \text{多组总负责人 (General Manager)} \;\longrightarrow\; \text{部门主管 (Group Leader)} \;\longrightarrow\; \text{基层员工 (Member)}$$

```
                   ┌──────────────────────────────────┐
                   │    系统超级管理员 (System Admin)    │ (全站全域双向穿透)
                   └────────────────┬─────────────────┘
                                    │
                   ┌────────────────┴─────────────────┐
                   │   多部门总负责人 (General Manager)  │ (身兼多组 Leader 角色)
                   └────────┬───────────────┬─────────┘
                            │               │
            ┌───────────────┴──────┐ ┌──────┴──────────────┐
            ▼                      ▼ ▼                     ▼
     ┌──────────────┐       ┌──────────────┐        ┌──────────────┐
     │  分组 A (研发) │       │  分组 B (市场) │        │  分组 C (客服) │
     └──────┬───────┘       └──────┬───────┘        └──────┬───────┘
            │                      │                       │
      【研发部组长】          【市场部组长】           【客服部组长】
     (部门直接上级Leader)    (部门直接上级Leader)     (部门直接上级Leader)
            │                      │                       │
     ┌──────┴──────┐        ┌──────┴──────┐         ┌──────┴──────┐
   组员A1        组员A2    组员B1        组员B2     组员C1        组员C2
  (受控基层员工) (受控基层员工)
```

---

## 3. 核心权限矩阵与多组策略叠加算法

### 3.1 单组通信权限矩阵

| 发起方 -> 接收方 | 管制模式 (allow_member_dm = 0) | 开放模式 (allow_member_dm = 1) |
| :--- | :--- | :--- |
| **组长 -> 普通组员** | 允许 (下发工作安排) | 允许 |
| **普通组员 -> 组长** | 允许 (向上级直接汇报) | 允许 |
| **普通组员 -> 普通组员** | 禁止 (入口隐藏 + 发信拦截) | 允许 |
| **普通组员 -> 系统管理员** | 允许 (全局穿透) | 允许 (全局穿透) |
| **跨组无交集普通组员** | 禁止 (物理隔离) | 禁止 (物理隔离) |

### 3.2 多组归属时的权限裁决算法 (Policy Intersection Engine)

当用户 X 尝试向用户 Y 发起私聊或发送消息时，按以下优先级执行判定：

```typescript
function canDirectMessage(actor: User, target: User, groups: Group[]): boolean {
  // 1. 自聊拦截
  if (actor.id === target.id) return false;

  // 2. 全局管理员双向穿透
  if (actor.isAdmin || target.isAdmin) return true;

  // 3. 全局开放模式兜底（系统未配置任何企业分组时）
  if (groups.length === 0) return true;

  // 4. 计算双方共同加入的活跃分组列表
  const commonGroups = findCommonActiveGroups(actor.id, target.id);
  if (commonGroups.length === 0) {
    return false; // 没有任何共同分组 -> 物理隔离禁止私聊
  }

  // 5. 遍历所有共同分组，命中任意一条放行规则即判定允许通信
  for (const group of commonGroups) {
    // 规则 A：发起方在该组是组长 (Leader -> Member 派发任务)
    if (group.actorRole === 'leader') return true;

    // 规则 B：接收方在该组是组长 (Member -> Leader 汇报工作)
    if (group.targetRole === 'leader') return true;

    // 规则 C：该组开启了组员互发私聊策略 (Member <-> Member 协同)
    if (group.allowMemberDm === true) return true;
  }

  // 6. 所有共同分组均关闭了组员私聊且双方均非组长 -> 严格禁止
  return false;
}
```

---

## 4. 四层递进防御架构 (Defense-in-Depth)

1. **通讯录可见性过滤层**：仅渲染允许联络的联系人列表，消除视觉入口。
2. **密钥交换与预热层**：阻止非授权人员获取端到端加密公钥 (E2EE Public Key)。
3. **房间长连接握手层**：WebSocket/gRPC 握手时实时鉴权，受限会话直接 403 切断。
4. **消息提交执行底线**：发信前实时执行策略判定，历史残留会话发信即刻拒绝。

---

## 5. 通用数据库 Schema 参考 (SQL-Agnostic)

```sql
-- 1. 用户分组定义表
CREATE TABLE user_groups (
  id BIGINT PRIMARY KEY AUTOINCREMENT,
  name VARCHAR(100) NOT NULL UNIQUE,
  description TEXT DEFAULT '',
  allow_member_dm INT NOT NULL DEFAULT 1 CHECK (allow_member_dm IN (0, 1)),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL
);

-- 2. 分组与成员关联关系表
CREATE TABLE user_group_members (
  group_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  role VARCHAR(20) NOT NULL DEFAULT 'member' CHECK (role IN ('leader', 'member')),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (group_id, user_id),
  FOREIGN KEY (group_id) REFERENCES user_groups(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_user_group_members_user ON user_group_members(user_id);
CREATE INDEX idx_user_group_members_group ON user_group_members(group_id);
```

---

## 6. 跨项目复用与实施清单

1. **建立多负责人模型**：在分组关系中引入 `role IN ('leader', 'member')`，在分组表中引入 `allow_member_dm`；
2. **接入三级判定引擎**：在全局鉴权中间件或微服务拦截器中实现 `canDirectMessage`；
3. **移除公开大群的私聊快捷入口**：大群仅保留公开业务沟通，避免大群成员列表成为私信骚扰温床；
4. **前端组长面板下放**：在前台为具备 `leader` 角色的账号提供自管理开关，减轻超级管理员运维负担。
