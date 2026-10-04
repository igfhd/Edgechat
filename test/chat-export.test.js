import assert from "node:assert/strict";
import test from "node:test";
import {
  fetchAllDecryptedMessages,
  formatAsJson,
  formatAsMarkdown,
  formatAsPlainText,
  generateExportFileName,
} from "../frontend/src/chat-export.js";

test("消息导出保持严格的时间升序正序排列", async () => {
  const room = { id: 1, kind: "channel", name: "技术讨论", isPrivate: false };
  const session = { userId: 10 };

  const rawMessagesPage1 = [
    {
      id: 2,
      content: "第二条消息",
      createdAt: "2026-08-10 10:10:00",
      sender: { id: 1, displayName: "Alice", username: "alice" },
    },
    {
      id: 3,
      content: "第三条消息",
      createdAt: "2026-08-10 10:20:00",
      sender: { id: 2, displayName: "Bob", username: "bob" },
    },
  ];

  const rawMessagesPage2 = [
    {
      id: 1,
      content: "第一条消息",
      createdAt: "2026-08-10 10:00:00",
      sender: { id: 1, displayName: "Alice", username: "alice" },
    },
  ];

  const mockApi = {
    async getMessages(_kind, _id, before) {
      if (!before) {
        return { messages: rawMessagesPage1 };
      }
      if (before === 2) {
        return { messages: rawMessagesPage2 };
      }
      return { messages: [] };
    },
  };

  const progressLogs = [];
  const messages = await fetchAllDecryptedMessages({
    room,
    session,
    api: mockApi,
    onProgress(p) {
      progressLogs.push(p);
    },
  });

  assert.equal(messages.length, 3);
  // 严格正序：第 1 条 -> 第 2 条 -> 第 3 条
  assert.equal(messages[0].id, 1);
  assert.equal(messages[0].content, "第一条消息");
  assert.equal(messages[1].id, 2);
  assert.equal(messages[1].content, "第二条消息");
  assert.equal(messages[2].id, 3);
  assert.equal(messages[2].content, "第三条消息");
});

test("纯文本格式导出包含会话头信息与附件明细", () => {
  const room = { id: 2, kind: "channel", name: "产品组", isPrivate: true };
  const messages = [
    {
      id: 10,
      content: "大家好，这是最新需求文档：",
      createdAt: "2026-08-15 09:30:00",
      sender: { id: 1, displayName: "Alice", username: "alice" },
      attachment: {
        name: "spec.pdf",
        size: 1024 * 1024 * 2.5,
        url: "https://example.com/files/spec.pdf",
      },
    },
    {
      id: 11,
      content: "收到，马上看",
      createdAt: "2026-08-15 09:32:00",
      sender: { id: 2, displayName: "Bob", username: "bob" },
      editedAt: "2026-08-15 09:33:00",
    },
  ];

  const text = formatAsPlainText(room, messages);
  assert.match(text, /会话名称：产品组/);
  assert.match(text, /会话类型：私有群组/);
  assert.match(text, /Alice \(@alice\):/);
  assert.match(text, /大家好，这是最新需求文档：/);
  assert.match(text, /\[附件: spec\.pdf \(2\.5 MB\) - https:\/\/example\.com\/files\/spec\.pdf\]/);
  assert.match(text, /Bob \(@bob\) \[已编辑\]:/);
  assert.match(text, /收到，马上看/);
});

test("JSON 格式导出包含完整结构化字段", () => {
  const room = { id: 3, kind: "dm", displayName: "Charlie" };
  const messages = [
    {
      id: 20,
      content: "私聊明文消息",
      createdAt: "2026-08-16 14:00:00",
      sender: { id: 3, displayName: "Charlie", username: "charlie" },
    },
  ];

  const jsonStr = formatAsJson(room, messages);
  const parsed = JSON.parse(jsonStr);
  assert.equal(parsed.room.id, 3);
  assert.equal(parsed.room.kind, "dm");
  assert.equal(parsed.totalMessages, 1);
  assert.equal(parsed.messages[0].content, "私聊明文消息");
  assert.equal(parsed.messages[0].sender.displayName, "Charlie");
});

test("Markdown 格式导出生成标题与引用附件", () => {
  const room = { id: 4, kind: "channel", name: "公开频道", isPrivate: false };
  const messages = [
    {
      id: 30,
      content: "欢迎加入公开频道！",
      createdAt: "2026-08-17 08:00:00",
      sender: { id: 1, displayName: "Admin", username: "admin" },
    },
  ];

  const md = formatAsMarkdown(room, messages);
  assert.match(md, /# 📝 公开频道 - 聊天记录导出/);
  assert.match(md, /### \*\*Admin\*\* \(@admin\)/);
  assert.match(md, /欢迎加入公开频道！/);
});

test("导出文件名清洗特殊字符并包含时间戳", () => {
  const room = { name: "技术/讨论*组?<>|" };
  const txtName = generateExportFileName(room, "txt");
  assert.match(txtName, /^Edgechat_技术_讨论_组_+\d{8}_\d{4}\.txt$/);

  const jsonName = generateExportFileName(room, "json");
  assert.match(jsonName, /\.json$/);

  const mdName = generateExportFileName(room, "md");
  assert.match(mdName, /\.md$/);
});
