<script setup>
import { computed, ref } from 'vue';

const emit = defineEmits(['select', 'close']);

const searchQuery = ref('');
const activeCategoryIndex = ref(0);

const emojiCategories = [
  {
    name: '表情',
    icon: '😃',
    emojis: [
      '😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '🙃',
      '😉', '😊', '😇', '🥰', '😍', '🤩', '😘', '😗', '😚', '😙',
      '😋', '😛', '😜', '🤪', '😝', '🤑', '🤗', '🤭', '🤫', '🤔',
      '🤐', '🤨', '😐', '😑', '😶', '😏', '😒', '🙄', '😬', '🤥',
      '😌', '😔', '😪', '🤤', '😴', '😷', '🤒', '🤕', '🤢', '🤮',
      '🤧', '🥵', '🥶', '🥴', '😵', '🤯', '🤠', '🥳', '😎', '🤓',
      '🧐', '😕', '😟', '🙁', '😮', '😯', '😲', '😳', '🥺', '😦',
      '😧', '😨', '😰', '😥', '😢', '😭', '😱', '😖', '😣', '😞',
      '😓', '😩', '😫', '🥱', '😤', '😡', '😠', '🤬', '😈', '👿'
    ]
  },
  {
    name: '手势',
    icon: '🖐️',
    emojis: [
      '👋', '🤚', '🖐️', '✋', '🖖', '👌', '🤌', '🤏', '✌️', '🤞',
      '🤟', '🤘', '🤙', '👈', '👉', '👆', '🖕', '👇', '☝️', '👍',
      '👎', '✊', '👊', '🤛', '🤜', '👏', '🙌', '👐', '🤲', '🤝',
      '🙏', '✍️', '💅', '🤳', '💪', '🦾', '🦿', '🦵', '🦶', '👂',
      '🦻', '👃', '🧠', '🫀', '🫁', '🦷', '🦴', '👀', '👁️', '👅'
    ]
  },
  {
    name: '爱心与符号',
    icon: '❤️',
    emojis: [
      '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔',
      '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '💟', '☮️',
      '✝️', '☪️', '🕉️', '☸️', '✡️', '🔯', '🕎', '☯️', '☦️', '🛐',
      '⭐', '🌟', '✨', '⚡', '💥', '🔥', '🎉', '🎊', '🎈', '🎁',
      '🏆', '🥇', '🥈', '🥉', '💯', '💢', '💬', '💭', '💤', '🔔'
    ]
  },
  {
    name: '动植物',
    icon: '🐶',
    emojis: [
      '🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐨', '🐯',
      '🦁', '🐮', '🐷', '🐸', '🐵', '🐔', '🐧', '🐦', '🐤', '🦆',
      '🦅', '🦉', '🦇', '🐺', '🐗', '🐴', '🦄', '🐝', '🐛', '🦋',
      '🐌', '🐞', '🐜', '🦟', '🐢', '🐍', '🦎', '🐙', '🦑', '🦐',
      '🦞', '🦀', '🐡', '🐠', '🐟', '🐬', '🐳', '🦈', '🐊', '🐅'
    ]
  },
  {
    name: '食物',
    icon: '🍕',
    emojis: [
      '🍏', '🍎', '🍐', '🍊', '🍋', '🍌', '🍉', '🍇', '🍓', '🫐',
      '🍈', '🍒', '🍑', '🥭', '🍍', '🥥', '🥝', '🍅', '🥑', '🍆',
      '🥦', '🌽', '🌶️', '🍔', '🍟', '🍕', '🌭', '🥪', '🌮', '🌯',
      '🍜', '🍲', '🍣', '🍱', '🥟', '🍤', '🍙', '🍚', '🍘', '🍦',
      '🍧', '🍨', '🍩', '🍪', '🎂', '🍰', '🧁', '🍫', '🍬', '☕'
    ]
  },
  {
    name: '物品活动',
    icon: '🚀',
    emojis: [
      '⚽', '🏀', '🏈', '⚾', '🎾', '🏐', '🏉', '🎱', '🏓', '🏸',
      '🥊', '🥋', '🎯', '🎮', '🎲', '🧩', '🚗', '🚕', '🚙', '🚌',
      '🏎️', '🚓', '🚑', '🚒', '🚲', '🛴', '🛵', '🏍️', '✈️', '🚀',
      '🛸', '🚁', '🛶', '⛵', '🚤', '🛳️', '⚓', '📱', '💻', '⌨️',
      '🖥️', '🖨️', '📷', '📹', '🔍', '💡', '🔦', '📖', '💰', '🔒'
    ]
  }
];

const filteredEmojis = computed(() => {
  const q = searchQuery.value.trim();
  if (!q) {
    return emojiCategories[activeCategoryIndex.value].emojis;
  }
  // Search across all categories
  const all = emojiCategories.flatMap((c) => c.emojis);
  return all.filter((e) => e.includes(q));
});

function handleSelect(emoji) {
  emit('select', emoji);
}
</script>

<template>
  <div class="emoji-picker" @click.stop>
    <div class="emoji-picker__header">
      <input
        v-model="searchQuery"
        type="search"
        class="emoji-search-input"
        placeholder="搜索表情..."
      />
    </div>

    <div v-if="!searchQuery" class="emoji-category-tabs">
      <button
        v-for="(cat, idx) in emojiCategories"
        :key="cat.name"
        type="button"
        class="emoji-cat-btn"
        :class="{ 'emoji-cat-btn--active': activeCategoryIndex === idx }"
        :title="cat.name"
        @click="activeCategoryIndex = idx"
      >
        {{ cat.icon }}
      </button>
    </div>

    <div class="emoji-grid-scroll">
      <div class="emoji-grid">
        <button
          v-for="emoji in filteredEmojis"
          :key="emoji"
          type="button"
          class="emoji-item"
          @click="handleSelect(emoji)"
        >
          {{ emoji }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.emoji-picker {
  width: 320px;
  max-width: 90vw;
  background: #ffffff;
  border-radius: 12px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.15), 0 1px 3px rgba(0, 0, 0, 0.08);
  border: 1px solid #e2e8f0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  user-select: none;
  z-index: 100;
}

.emoji-picker__header {
  padding: 8px 10px 6px;
  border-bottom: 1px solid #f1f5f9;
}

.emoji-search-input {
  width: 100%;
  padding: 6px 10px;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  background: #f8fafc;
  font-size: 13px;
  box-sizing: border-box;
}

.emoji-search-input:focus {
  outline: none;
  border-color: #008069;
  background: #ffffff;
}

.emoji-category-tabs {
  display: flex;
  justify-content: space-around;
  padding: 4px 6px;
  background: #f8fafc;
  border-bottom: 1px solid #f1f5f9;
}

.emoji-cat-btn {
  border: none;
  background: transparent;
  padding: 4px 6px;
  border-radius: 6px;
  font-size: 16px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.emoji-cat-btn:hover {
  background: rgba(0, 0, 0, 0.06);
}

.emoji-cat-btn--active {
  background: #ffffff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  transform: scale(1.1);
}

.emoji-grid-scroll {
  max-height: 220px;
  overflow-y: auto;
  padding: 8px;
}

.emoji-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 4px;
}

.emoji-item {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border: none;
  background: transparent;
  border-radius: 6px;
  font-size: 20px;
  cursor: pointer;
  transition: all 0.12s ease;
}

.emoji-item:hover {
  background: #f0fdf4;
  transform: scale(1.2);
}
</style>
