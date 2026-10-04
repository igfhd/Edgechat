import assert from "node:assert/strict";
import test from "node:test";
import {
  createTrafficObfuscationManager,
  padObjectToBucket,
} from "../frontend/src/traffic-obfuscation.js";
import { padObjectToBucket as serverPadObjectToBucket } from "../worker/src/traffic-obfuscation.js";

test("分组数据桶填充能将不同大小的数据对齐到 256B / 1024B / 4096B", () => {
  // 小数据对齐至 256B 桶
  const small = { type: "typing", displayName: "张三" };
  const paddedSmall = padObjectToBucket(small, null, true);
  const smallBytes = new TextEncoder().encode(paddedSmall).length;
  assert.equal(smallBytes, 256);
  const parsedSmall = JSON.parse(paddedSmall);
  assert.equal(parsedSmall.type, "typing");
  assert.equal(parsedSmall.displayName, "张三");
  assert.ok(parsedSmall.pad.length > 0);

  // 中等数据对齐至 1024B 桶
  const medium = {
    type: "send",
    content: "这是一条稍微长一点的消息，用于测试中等大小桶的填充能力。".repeat(5),
  };
  const paddedMedium = padObjectToBucket(medium, null, true);
  const mediumBytes = new TextEncoder().encode(paddedMedium).length;
  assert.equal(mediumBytes, 1024);
  const parsedMedium = JSON.parse(paddedMedium);
  assert.equal(parsedMedium.type, "send");
  assert.equal(parsedMedium.content, medium.content);

  // 较大数据对齐至 4096B 桶
  const large = {
    type: "send",
    content: "长文本".repeat(400),
  };
  const paddedLarge = padObjectToBucket(large, null, true);
  const largeBytes = new TextEncoder().encode(paddedLarge).length;
  assert.equal(largeBytes, 4096);
  const parsedLarge = JSON.parse(paddedLarge);
  assert.equal(parsedLarge.type, "send");
});

test("服务端数据桶填充同样保证尺寸对齐且 JSON 解析无损", () => {
  const dummy = { type: "cover_traffic" };
  const padded = serverPadObjectToBucket(dummy, 256);
  const bytes = new TextEncoder().encode(padded).length;
  assert.equal(bytes, 256);
  const parsed = JSON.parse(padded);
  assert.equal(parsed.type, "cover_traffic");
  assert.ok(parsed.pad.length > 0);
});

test("发送窗口整流与键盘输入状态 (typing) 队列调度", () => {
  const sentFrames = [];
  let simulatedTime = 100000;
  const socketOpen = true;

  const manager = createTrafficObfuscationManager({
    sendSocketMessage(frame, key) {
      sentFrames.push({ frame, key, time: simulatedTime });
      return true;
    },
    isSocketOpen() {
      return socketOpen;
    },
    getActiveRoomKey() {
      return "channel:1";
    },
    randomFn: () => 0.5, // 稳定随机数：槽位 3500ms，活跃诱饵 7000ms
    nowFn: () => simulatedTime,
  });

  // 1. 用户输入状态被加入队列，而不是直接发送
  manager.enqueue(
    { type: "typing", displayName: "李四" },
    "channel:1",
    { isTyping: true }
  );
  assert.equal(sentFrames.length, 0);
  assert.equal(manager.getQueueLength(), 1);

  // 2. 紧接着用户又触发了 typing，队列去重合并
  manager.enqueue(
    { type: "typing", displayName: "李四 (已更新)" },
    "channel:1",
    { isTyping: true }
  );
  assert.equal(manager.getQueueLength(), 1);

  // 3. 用户发送一条真实消息，进入队列第 2 项
  manager.enqueue(
    { type: "send", content: "你好世界" },
    "channel:1",
    { isTyping: false }
  );
  assert.equal(manager.getQueueLength(), 2);

  // 4. 模拟时间推进到下一个整流发送槽位 (3500ms)
  simulatedTime += 3500;
  manager.triggerTick();
  // 执行一次 tick 发送出第一项 (typing)
  // 注意：typing 同样被桶对齐填充 (256B)
  assert.equal(sentFrames.length, 1);
  assert.equal(sentFrames[0].key, "channel:1");
  const parsedTyping = JSON.parse(sentFrames[0].frame);
  assert.equal(parsedTyping.type, "typing");
  assert.equal(parsedTyping.displayName, "李四 (已更新)");
  assert.equal(new TextEncoder().encode(sentFrames[0].frame).length, 256);

  // 再触发一次 tick 发送出第二项 (send)
  simulatedTime += 3500;
  manager.triggerTick();
  assert.equal(sentFrames.length, 2);
  const parsedSend = JSON.parse(sentFrames[1].frame);
  assert.equal(parsedSend.type, "send");
  assert.equal(parsedSend.content, "你好世界");
});

test("空闲期触发双向诱饵流量 (Cover Traffic)", () => {
  const sentFrames = [];
  let simulatedTime = 100000;

  const manager = createTrafficObfuscationManager({
    sendSocketMessage(frame, key) {
      sentFrames.push({ frame, key, time: simulatedTime });
      return true;
    },
    isSocketOpen() {
      return true;
    },
    getActiveRoomKey() {
      return "dm:2";
    },
    randomFn: () => 0.1, // 槽位 ~2940ms，活跃诱饵 ~4600ms
    nowFn: () => simulatedTime,
  });

  // 活跃状态下，推进时间超过诱饵阈值
  manager.markUserActivity();
  simulatedTime += 5000;

  manager.triggerTick();
  // 触发 tick 发送 cover_traffic
  assert.equal(sentFrames.length, 1);
  assert.equal(sentFrames[0].key, "dm:2");
  const parsedCover = JSON.parse(sentFrames[0].frame);
  assert.equal(parsedCover.type, "cover_traffic");
  assert.equal(new TextEncoder().encode(sentFrames[0].frame).length, 256);
});
