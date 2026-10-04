<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { Check, Download, Maximize, X } from '@lucide/vue';

const props = defineProps({
  imageSrc: { type: String, required: true }
});

const emit = defineEmits(['confirm', 'cancel']);

const containerRef = ref(null);
const imgElement = ref(null);

const isImageLoaded = ref(false);
const imageNaturalWidth = ref(0);
const imageNaturalHeight = ref(0);

// Selection rectangle in natural image coordinates
const selection = ref({
  x: 0,
  y: 0,
  width: 0,
  height: 0,
  active: false
});

const isDragging = ref(false);
const dragStart = { x: 0, y: 0 };
const displayScale = ref(1);

function formatDimensions() {
  const w = Math.round(selection.value.width);
  const h = Math.round(selection.value.height);
  return `${w} × ${h} px`;
}

function handleImageLoad(e) {
  const img = e.target;
  imageNaturalWidth.value = img.naturalWidth;
  imageNaturalHeight.value = img.naturalHeight;
  isImageLoaded.value = true;
  nextTick(() => {
    updateScale();
    // Start with blank selection so user can immediately click & drag to crop!
    selection.value.active = false;
  });
}

function updateScale() {
  if (!containerRef.value || !imageNaturalWidth.value) return;
  const container = containerRef.value;
  const scaleX = container.clientWidth / imageNaturalWidth.value;
  const scaleY = container.clientHeight / imageNaturalHeight.value;
  displayScale.value = Math.min(scaleX, scaleY, 1);
}

function selectAll() {
  selection.value = {
    x: 0,
    y: 0,
    width: imageNaturalWidth.value,
    height: imageNaturalHeight.value,
    active: true
  };
}

function onPointerDown(e) {
  if (e.target.closest('.snipper-toolbar')) return;
  const rect = containerRef.value.getBoundingClientRect();
  const clickX = (e.clientX - rect.left) / displayScale.value;
  const clickY = (e.clientY - rect.top) / displayScale.value;

  dragStart.x = Math.max(0, Math.min(imageNaturalWidth.value, clickX));
  dragStart.y = Math.max(0, Math.min(imageNaturalHeight.value, clickY));

  selection.value = {
    x: dragStart.x,
    y: dragStart.y,
    width: 0,
    height: 0,
    active: true
  };
  isDragging.value = true;
}

function onPointerMove(e) {
  if (!isDragging.value) return;
  const rect = containerRef.value.getBoundingClientRect();
  const currentX = Math.max(0, Math.min(imageNaturalWidth.value, (e.clientX - rect.left) / displayScale.value));
  const currentY = Math.max(0, Math.min(imageNaturalHeight.value, (e.clientY - rect.top) / displayScale.value));

  const minX = Math.min(dragStart.x, currentX);
  const minY = Math.min(dragStart.y, currentY);
  const width = Math.abs(currentX - dragStart.x);
  const height = Math.abs(currentY - dragStart.y);

  selection.value = {
    x: minX,
    y: minY,
    width,
    height,
    active: true
  };
}

function onPointerUp() {
  if (!isDragging.value) return;
  isDragging.value = false;
  // If clicked without dragging, leave selection active or clear
  if (selection.value.width < 10 || selection.value.height < 10) {
    selection.value.active = false;
  }
}

function getCroppedCanvas() {
  const sel = selection.value.active && selection.value.width >= 5 && selection.value.height >= 5
    ? selection.value
    : { x: 0, y: 0, width: imageNaturalWidth.value, height: imageNaturalHeight.value };

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(sel.width);
  canvas.height = Math.round(sel.height);
  const ctx = canvas.getContext('2d');

  if (imgElement.value) {
    ctx.drawImage(
      imgElement.value,
      sel.x,
      sel.y,
      sel.width,
      sel.height,
      0,
      0,
      canvas.width,
      canvas.height
    );
  }
  return canvas;
}

function handleConfirm(autoSend = true) {
  const canvas = getCroppedCanvas();
  canvas.toBlob((blob) => {
    if (!blob) return;
    const now = new Date();
    const timestamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
    const file = new File([blob], `screenshot_${timestamp}.png`, { type: 'image/png' });
    emit('confirm', { file, autoSend });
  }, 'image/png', 0.95);
}

function handleDownload() {
  const canvas = getCroppedCanvas();
  const a = document.createElement('a');
  a.href = canvas.toDataURL('image/png');
  a.download = `screenshot_${Date.now()}.png`;
  a.click();
}

function handleKeydown(e) {
  if (e.key === 'Escape') {
    emit('cancel');
  } else if (e.key === 'Enter') {
    handleConfirm(true);
  } else if (e.key === 'f' || e.key === 'F') {
    selectAll();
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleKeydown);
  window.addEventListener('resize', updateScale);
  if (imgElement.value?.complete && imgElement.value.naturalWidth) {
    imageNaturalWidth.value = imgElement.value.naturalWidth;
    imageNaturalHeight.value = imgElement.value.naturalHeight;
    isImageLoaded.value = true;
    nextTick(() => {
      updateScale();
      selection.value.active = false;
    });
  }
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKeydown);
  window.removeEventListener('resize', updateScale);
});

const selectionStyle = computed(() => {
  const s = displayScale.value;
  return {
    left: `${selection.value.x * s}px`,
    top: `${selection.value.y * s}px`,
    width: `${selection.value.width * s}px`,
    height: `${selection.value.height * s}px`
  };
});
</script>

<template>
  <div class="snipper-overlay" role="dialog" aria-modal="true" aria-label="屏幕截图编辑">
    <!-- Top Hint Bar -->
    <div class="snipper-topbar">
      <div class="snipper-tip-group">
        <span class="snipper-icon">✂️</span>
        <span class="snipper-tip">拖拽鼠标直接框选区域 · <strong>双击选区</strong>或按 <strong>Enter</strong> 立即发送 · Esc 取消</span>
      </div>
      <div class="snipper-top-actions">
        <button type="button" class="snipper-top-btn" title="全屏截图 (按 F)" @click="selectAll">
          <Maximize :size="15" />
          <span>全屏截取</span>
        </button>
        <button type="button" class="snipper-close-btn" title="取消截图 (Esc)" @click="emit('cancel')">
          <X :size="18" />
        </button>
      </div>
    </div>

    <!-- Main Image Canvas Container -->
    <div
      ref="containerRef"
      class="snipper-stage"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
    >
      <img
        ref="imgElement"
        :src="imageSrc"
        class="snipper-source-img"
        alt="截图预览"
        draggable="false"
        @load="handleImageLoad"
      />

      <!-- Full-screen dim mask when no selection is active yet -->
      <div v-if="isImageLoaded && !selection.active" class="snipper-initial-hint">
        <div class="snipper-crosshair-pill">
          <span>🎯 按住鼠标左键并拖动以框选区域</span>
        </div>
      </div>

      <!-- Selection box with illuminated crop area -->
      <div
        v-if="isImageLoaded && selection.active"
        class="snipper-box"
        :style="selectionStyle"
        @dblclick.stop="handleConfirm(true)"
      >
        <!-- Size dimension badge -->
        <div class="snipper-dim-badge">
          {{ formatDimensions() }} (双击发送)
        </div>

        <!-- Floating action buttons below the selection box -->
        <div class="snipper-toolbar" @pointerdown.stop>
          <button type="button" class="tool-btn" title="全屏选取" @click.stop="selectAll">
            <Maximize :size="14" />
            <span>全屏</span>
          </button>
          <button type="button" class="tool-btn" title="保存到本地电脑" @click.stop="handleDownload">
            <Download :size="14" />
            <span>保存</span>
          </button>
          <button type="button" class="tool-btn" title="放入输入框附件（可继续输入文字）" @click.stop="handleConfirm(false)">
            <span>📎 放入输入框</span>
          </button>
          <button type="button" class="tool-btn tool-btn--cancel" title="取消" @click.stop="emit('cancel')">
            <X :size="14" />
            <span>取消</span>
          </button>
          <button type="button" class="tool-btn tool-btn--confirm" title="立即发送截图 (Enter / 双击选区)" @click.stop="handleConfirm(true)">
            <Check :size="14" />
            <span>发送</span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.snipper-overlay {
  position: fixed;
  inset: 0;
  z-index: 10000;
  background: rgba(10, 15, 20, 0.94);
  display: flex;
  flex-direction: column;
  user-select: none;
  touch-action: none;
  animation: fadeIn 0.12s ease-out;
}

.snipper-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 18px;
  background: rgba(15, 23, 42, 0.85);
  backdrop-filter: blur(12px);
  color: #f1f5f9;
  font-size: 13px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.12);
  z-index: 10;
}

.snipper-tip-group {
  display: flex;
  align-items: center;
  gap: 8px;
}

.snipper-icon {
  font-size: 16px;
}

.snipper-tip {
  color: #e2e8f0;
}

.snipper-tip strong {
  color: #34d399;
}

.snipper-top-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.snipper-top-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 10px;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.18);
  background: rgba(255, 255, 255, 0.08);
  color: #e2e8f0;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s;
}

.snipper-top-btn:hover {
  background: rgba(255, 255, 255, 0.18);
  color: #ffffff;
}

.snipper-close-btn {
  background: transparent;
  border: none;
  color: #94a3b8;
  cursor: pointer;
  padding: 4px;
  border-radius: 6px;
  transition: all 0.15s;
}

.snipper-close-btn:hover {
  background: rgba(239, 68, 68, 0.25);
  color: #fca5a5;
}

.snipper-stage {
  flex: 1;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  cursor: crosshair;
}

.snipper-source-img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  pointer-events: none;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
}

.snipper-initial-hint {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.35);
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}

.snipper-crosshair-pill {
  background: rgba(15, 23, 42, 0.85);
  backdrop-filter: blur(8px);
  color: #38bdf8;
  font-size: 13px;
  font-weight: 500;
  padding: 8px 16px;
  border-radius: 20px;
  border: 1px solid rgba(56, 189, 248, 0.3);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
}

.snipper-box {
  position: absolute;
  border: 2px solid #00a884;
  box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.65), 0 0 16px rgba(0, 168, 132, 0.4);
  pointer-events: auto;
  cursor: pointer;
}

.snipper-dim-badge {
  position: absolute;
  top: -26px;
  left: 0;
  background: rgba(0, 0, 0, 0.88);
  color: #34d399;
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 4px;
  white-space: nowrap;
  pointer-events: none;
}

.snipper-toolbar {
  position: absolute;
  bottom: -46px;
  right: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  background: #1e293b;
  border: 1px solid rgba(255, 255, 255, 0.18);
  padding: 5px 8px;
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.55);
  z-index: 100;
  cursor: default;
}

.tool-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 5px 10px;
  border-radius: 6px;
  border: none;
  background: rgba(255, 255, 255, 0.08);
  color: #e2e8f0;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s;
  white-space: nowrap;
}

.tool-btn:hover {
  background: rgba(255, 255, 255, 0.18);
  color: #ffffff;
  transform: translateY(-1px);
}

.tool-btn--cancel:hover {
  background: rgba(239, 68, 68, 0.25);
  color: #fca5a5;
}

.tool-btn--confirm {
  background: #008069;
  color: #ffffff;
  font-weight: 600;
  box-shadow: 0 2px 8px rgba(0, 128, 105, 0.4);
}

.tool-btn--confirm:hover {
  background: #00a884;
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}
</style>
