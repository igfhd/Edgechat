<script setup>
defineProps({
  source: {
    type: String,
    default: ''
  }
});
</script>

<template>
  <span v-if="source === 'telegram'" class="sender-source-badge" title="Telegram" aria-label="Telegram 来源">
    TG
  </span>
</template>

<style scoped>
.sender-source-badge {
  min-width: 20px;
  height: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding-inline: 4px;
  border-radius: 4px;
  background: #229ed9;
  color: #ffffff;
  font-size: 9px;
  font-weight: 800;
  line-height: 1;
  letter-spacing: 0;
  vertical-align: 1px;
}
</style>
