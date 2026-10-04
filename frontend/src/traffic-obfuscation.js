const BUCKET_SIZES = [256, 1024, 4096, 16384];
const STORAGE_KEY = 'traffic_obfuscation_enabled';

export function isTrafficObfuscationEnabled() {
  try {
    const val = localStorage.getItem(STORAGE_KEY);
    return val !== 'false'; // 默认开启 (true)
  } catch {
    return true;
  }
}

export function setTrafficObfuscationEnabled(enabled) {
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? 'true' : 'false');
  } catch {
    // ignore
  }
}

export function randomAsciiString(length) {
  if (length <= 0) return '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let res = '';
  for (let i = 0; i < length; i++) {
    res += chars[Math.floor(Math.random() * chars.length)];
  }
  return res;
}

export function padObjectToBucket(obj, targetBucket = null, force = false) {
  if (!force && !isTrafficObfuscationEnabled()) {
    return JSON.stringify(obj);
  }

  const clone = { ...obj, pad: '' };
  const baseJsonWithPad = JSON.stringify(clone);
  const baseLength = new TextEncoder().encode(baseJsonWithPad).length;

  let bucket = targetBucket;
  if (!bucket) {
    bucket = BUCKET_SIZES.find((size) => size >= baseLength);
    if (!bucket) {
      bucket = Math.ceil(baseLength / 4096) * 4096;
    }
  }

  const padLength = Math.max(0, bucket - baseLength);
  clone.pad = randomAsciiString(padLength);
  return JSON.stringify(clone);
}

export function createTrafficObfuscationManager({
  sendSocketMessage = () => false,
  isSocketOpen = () => false,
  getActiveRoomKey = () => '',
  randomFn = Math.random,
  nowFn = Date.now
} = {}) {
  const outboxQueue = [];
  let slotTimer = null;
  let running = false;
  let lastTrafficAt = nowFn();
  let userActiveUntil = 0;

  function isUserActive() {
    return nowFn() < userActiveUntil;
  }

  function nextSlotDelay() {
    // 2.8s 至 4.2s 随机槽位 (2800ms ~ 4200ms)
    return 2800 + Math.floor(randomFn() * 1400);
  }

  function nextCoverInterval() {
    if (isUserActive()) {
      // 活跃期：4 ~ 10 秒
      return 4000 + Math.floor(randomFn() * 6000);
    }
    // 空闲期：45 ~ 180 秒
    return 45000 + Math.floor(randomFn() * 135000);
  }

  let currentCoverThreshold = nextCoverInterval();

  function markUserActivity() {
    userActiveUntil = nowFn() + 10000; // 10 秒活跃期
    lastTrafficAt = nowFn();
    currentCoverThreshold = nextCoverInterval();
  }

  function enqueue(payload, key, options = {}) {
    const isObfuscationActive = isTrafficObfuscationEnabled();

    // 如果用户关闭了混淆，或显式要求立即发送
    if (!isObfuscationActive || options.immediate) {
      markUserActivity();
      const frame = isObfuscationActive
        ? padObjectToBucket(payload, null, true)
        : JSON.stringify(payload);
      return sendSocketMessage(frame, key);
    }

    markUserActivity();

    // 如果是输入中 (typing)，若队列中已有待发的 typing，则合并更新
    if (options.isTyping) {
      const existingIndex = outboxQueue.findIndex(
        (item) => item.key === key && item.isTyping
      );
      if (existingIndex !== -1) {
        outboxQueue[existingIndex].payload = payload;
      } else {
        outboxQueue.push({ payload, key, isTyping: true });
      }
      return true;
    }

    outboxQueue.push({ payload, key, isTyping: false });
    return true;
  }

  function triggerTick() {
    const isObfuscationActive = isTrafficObfuscationEnabled();

    if (!isObfuscationActive) {
      // 如果已关闭混淆，清空待发队列
      while (outboxQueue.length > 0) {
        const item = outboxQueue.shift();
        if (isSocketOpen(item.key)) {
          sendSocketMessage(JSON.stringify(item.payload), item.key);
        }
      }
      return;
    }

    // 1. 如果队列中有消息需要发出
    if (outboxQueue.length > 0) {
      const item = outboxQueue.shift();
      if (isSocketOpen(item.key)) {
        const padded = padObjectToBucket(item.payload, null, true);
        sendSocketMessage(padded, item.key);
        lastTrafficAt = nowFn();
        currentCoverThreshold = nextCoverInterval();
      }
    } else {
      // 2. 队列为空，检查是否满足发送双向诱饵流量 (Cover Traffic)
      const now = nowFn();
      if (now - lastTrafficAt >= currentCoverThreshold) {
        const key = getActiveRoomKey();
        if (key && isSocketOpen(key)) {
          const coverPayload = { type: 'cover_traffic' };
          const paddedCover = padObjectToBucket(coverPayload, 256, true);
          sendSocketMessage(paddedCover, key);
          lastTrafficAt = now;
          currentCoverThreshold = nextCoverInterval();
        }
      }
    }
  }

  function tick() {
    if (!running) return;
    triggerTick();
    scheduleNextTick();
  }

  function scheduleNextTick() {
    if (!running) return;
    if (slotTimer) clearTimeout(slotTimer);
    slotTimer = setTimeout(tick, nextSlotDelay());
    if (slotTimer && typeof slotTimer.unref === 'function') {
      slotTimer.unref();
    }
  }

  function start() {
    if (running) return;
    running = true;
    scheduleNextTick();
  }

  function stop() {
    running = false;
    if (slotTimer) {
      clearTimeout(slotTimer);
      slotTimer = null;
    }
  }

  function flush() {
    while (outboxQueue.length > 0) {
      const item = outboxQueue.shift();
      if (isSocketOpen(item.key)) {
        const isObfuscationActive = isTrafficObfuscationEnabled();
        const frame = isObfuscationActive
          ? padObjectToBucket(item.payload, null, true)
          : JSON.stringify(item.payload);
        sendSocketMessage(frame, item.key);
      }
    }
  }

  return {
    enqueue,
    markUserActivity,
    start,
    stop,
    flush,
    triggerTick,
    getQueueLength: () => outboxQueue.length,
    isRunning: () => running
  };
}
