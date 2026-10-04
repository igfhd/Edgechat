import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { Hono } from "hono";

import { registerChannelRoutes } from "../worker/src/api/channels.js";
import { listVisibleChannels, listAdminChannels } from "../worker/src/data/channels.js";
import { getSiteSettings, updateSiteSettings } from "../worker/src/data/site-settings.js";
import { createMessageSubmission, MessageSubmissionError } from "../worker/src/message-submission.js";

function createMockDb({ settings = {}, channels = [], users = [] } = {}) {
  const siteSettingsStore = new Map(Object.entries(settings));
  const channelStore = [...channels];

  return {
    prepare(sql) {
      return {
        bind(...binds) {
          return {
            async all() {
              if (sql.includes("FROM site_settings")) {
                const results = Array.from(siteSettingsStore.entries()).map(([k, v]) => ({
                  setting_key: k,
                  setting_value: v
                }));
                return { results };
              }
              if (sql.includes("FROM channels c")) {
                return { results: channelStore };
              }
              return { results: [] };
            },
            async first() {
              if (sql.includes("FROM site_settings") && binds[0]) {
                const val = siteSettingsStore.get(binds[0]);
                return val !== undefined ? { setting_value: val } : null;
              }
              if (sql.includes("SELECT setting_value FROM site_settings WHERE setting_key = 'general_channel_muted'")) {
                const val = siteSettingsStore.get("general_channel_muted");
                return val !== undefined ? { setting_value: val } : null;
              }
              if (sql.includes("FROM channels WHERE id = ?")) {
                const found = channelStore.find(c => c.id === binds[0]);
                return found || null;
              }
              return null;
            },
            async run() {
              return { meta: { last_row_id: 1 } };
            }
          };
        },
        async all() {
          if (sql.includes("FROM site_settings")) {
            const results = Array.from(siteSettingsStore.entries()).map(([k, v]) => ({
              setting_key: k,
              setting_value: v
            }));
            return { results };
          }
          if (sql.includes("FROM channels c")) {
            return { results: channelStore };
          }
          return { results: [] };
        },
        async first() {
          if (sql.includes("SELECT setting_value FROM site_settings WHERE setting_key = 'general_channel_muted'")) {
            const val = siteSettingsStore.get("general_channel_muted");
            return val !== undefined ? { setting_value: val } : null;
          }
          return null;
        }
      };
    },
    async batch(statements) {
      return [];
    }
  };
}

test("Site settings 支持 generalChannelHidden 与 generalChannelMuted 读取与持久化", async () => {
  const db = createMockDb({
    settings: {
      general_channel_hidden: "1",
      general_channel_muted: "1"
    }
  });

  const settings = await getSiteSettings(db);
  assert.equal(settings.generalChannelHidden, true);
  assert.equal(settings.generalChannelMuted, true);
});

test("当 generalChannelHidden 为 true 时，普通用户无法看到 general，管理员依然可见", async () => {
  const mockChannels = [
    {
      id: 1,
      name: "general",
      description: "系统大厅",
      avatar_key: null,
      kind: "public",
      is_general: 1,
      owner_display_name: "Admin",
      is_member: 1,
      my_role: "member",
      can_manage: 0,
      member_count: 5,
      last_message_at: null,
      unread_count: 0
    },
    {
      id: 2,
      name: "dev-team",
      description: "开发私有群",
      avatar_key: null,
      kind: "private",
      is_general: 0,
      owner_display_name: "Alice",
      is_member: 1,
      my_role: "member",
      can_manage: 0,
      member_count: 2,
      last_message_at: null,
      unread_count: 0
    }
  ];

  const db = createMockDb({ channels: mockChannels });

  // 普通用户查询：隐藏 general
  const userVisible = await listVisibleChannels(db, 2, {
    isAdmin: false,
    generalHidden: true,
    generalMuted: false
  });
  assert.equal(userVisible.length, 1);
  assert.equal(userVisible[0].name, "dev-team");

  // 管理员查询：保留 general
  const adminVisible = await listVisibleChannels(db, 1, {
    isAdmin: true,
    generalHidden: true,
    generalMuted: false
  });
  assert.equal(adminVisible.length, 2);
  assert.equal(adminVisible[0].name, "general");
});

test("当 generalChannelMuted 为 true 时，普通用户无法在 general 发言，管理员可发言", async () => {
  const db = createMockDb({
    settings: {
      general_channel_muted: "1"
    }
  });

  const dummyPersist = async (env, data) => ({
    id: 101,
    channelId: data.channelId,
    content: data.content,
    createdAt: new Date().toISOString()
  });

  const submit = createMessageSubmission({ persistMessage: dummyPersist });

  // 普通用户尝试发言 -> 抛出全员禁言错误
  await assert.rejects(
    () =>
      submit(
        { DB: db },
        { room: { id: 1, name: "general", kind: "public" }, principal: { userId: 2, isAdmin: false } },
        { content: "Hello world" }
      ),
    /当前群聊已开启全员禁言，仅管理员可以发言/
  );

  // 管理员发言 -> 成功发送
  const adminResult = await submit(
    { DB: db },
    { room: { id: 1, name: "general", kind: "public" }, principal: { userId: 1, isAdmin: true } },
    { content: "系统通知：服务器正常运行" }
  );
  assert.ok(adminResult.message);
  assert.equal(adminResult.message.content, "系统通知：服务器正常运行");
});

test("管理后台路由与前端导航已包含群聊管理选项卡", () => {
  const routerSource = readFileSync(new URL("../frontend/src/router.js", import.meta.url), "utf8");
  const navigationSource = readFileSync(new URL("../frontend/src/admin/navigation.js", import.meta.url), "utf8");
  const adminChannelsPageSource = readFileSync(new URL("../frontend/src/pages/AdminChannelsPage.vue", import.meta.url), "utf8");

  assert.match(routerSource, /import AdminChannelsPage/);
  assert.match(routerSource, /path: 'channels'/);
  assert.match(routerSource, /adminTitle: '群聊管理'/);

  assert.match(navigationSource, /id: 'channels'/);
  assert.match(navigationSource, /label: '群聊管理'/);

  assert.match(adminChannelsPageSource, /默认公开群组设置（#general）/);
  assert.match(adminChannelsPageSource, /群聊可见性（隐藏模式）/);
  assert.match(adminChannelsPageSource, /发言权限（全员禁言）/);
  assert.match(adminChannelsPageSource, /全站群聊列表/);
});

test("useChatSidebar 与 useActiveRoom 在切换会话时能保持 isMuted 禁言状态", async () => {
  const { useActiveRoom } = await import("../frontend/src/composables/useActiveRoom.js");
  const { useChatSidebar } = await import("../frontend/src/composables/useChatSidebar.js");
  const { ref } = await import("vue");

  const activeRoom = ref(null);
  const { applyActiveChannel, selectDm } = useActiveRoom({ activeRoom });

  const mockApi = {
    async bootstrap() {
      return {
        channels: [
          { id: 1, name: "general", kind: "public", isGeneral: true, isMuted: true, isMember: true },
          { id: 2, name: "team", kind: "public", isGeneral: false, isMuted: false, isMember: true }
        ],
        dms: [
          { id: 10, kind: "dm", otherUser: { id: 5, displayName: "Bob", username: "bob" } }
        ]
      };
    },
    async markRoomRead() {}
  };

  const sidebar = useChatSidebar({ applyActiveChannel, selectDm, sidebarApi: mockApi });
  await sidebar.refreshSidebar();

  // 1. 打开已禁言的 general 群聊
  const generalItem = sidebar.conversationItems.value.find((c) => c.isGeneral);
  assert.ok(generalItem);
  await sidebar.openConversation(generalItem);
  assert.equal(activeRoom.value.isMuted, true);
  assert.equal(activeRoom.value.name, "general");

  // 2. 切换至 DM 私聊
  const dmItem = sidebar.conversationItems.value.find((c) => c.kind === "dm");
  assert.ok(dmItem);
  await sidebar.openConversation(dmItem);
  assert.equal(activeRoom.value.kind, "dm");

  // 3. 再次切换回 general 群聊，禁言状态必须依然为 true
  await sidebar.openConversation(generalItem);
  assert.equal(activeRoom.value.name, "general");
  assert.equal(activeRoom.value.isMuted, true);
});
