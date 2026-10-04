const STORAGE_KEY = 'edgechat_quick_replies';

export const DEFAULT_QUICK_REPLIES = [
  { id: '1', text: '好的，收到！' },
  { id: '2', text: '正在处理中，稍后回复你。' },
  { id: '3', text: '辛苦了，非常感谢！' },
  { id: '4', text: '已确认，可以按此方案进行。' },
  { id: '5', text: '现在有点忙，晚点联系你。' },
  { id: '6', text: '文件已发送，请查收。' },
  { id: '7', text: '没问题，赞成！👍' }
];

export function getQuickReplies() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [...DEFAULT_QUICK_REPLIES];
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length ? parsed : [...DEFAULT_QUICK_REPLIES];
  } catch {
    return [...DEFAULT_QUICK_REPLIES];
  }
}

export function saveQuickReplies(list) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch (err) {
    console.warn('Failed to save quick replies to localStorage:', err);
  }
}

export function addQuickReply(text) {
  const cleanText = String(text || '').trim();
  if (!cleanText) return getQuickReplies();

  const list = getQuickReplies();
  const newItem = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    text: cleanText
  };
  const nextList = [newItem, ...list];
  saveQuickReplies(nextList);
  return nextList;
}

export function deleteQuickReply(id) {
  const list = getQuickReplies();
  const nextList = list.filter((item) => item.id !== id);
  saveQuickReplies(nextList);
  return nextList;
}

export function updateQuickReply(id, text) {
  const cleanText = String(text || '').trim();
  if (!cleanText) return getQuickReplies();

  const list = getQuickReplies();
  const nextList = list.map((item) => (item.id === id ? { ...item, text: cleanText } : item));
  saveQuickReplies(nextList);
  return nextList;
}

export function resetQuickRepliesToDefault() {
  saveQuickReplies(DEFAULT_QUICK_REPLIES);
  return [...DEFAULT_QUICK_REPLIES];
}
