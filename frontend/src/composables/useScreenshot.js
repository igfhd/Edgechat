import { ref } from 'vue';

export function useScreenshot() {
  const isCapturing = ref(false);
  const screenshotImage = ref(null);
  const showModal = ref(false);
  const error = ref('');

  async function captureScreen() {
    error.value = '';
    if (!navigator.mediaDevices?.getDisplayMedia) {
      const msg = '当前环境不支持屏幕捕获，您可使用系统截图快捷键后在输入框 Ctrl+V 粘贴';
      error.value = msg;
      throw new Error(msg);
    }

    isCapturing.value = true;
    let stream = null;
    try {
      // preferCurrentTab: true —— Chrome 107+ 让浏览器默认预选当前标签页
      // 用户只需在系统弹窗点一次"分享"，无需手动挑选来源
      const constraints = {
        video: true,
        audio: false,
        // 标准草案属性，Chrome 107+ 支持
        preferCurrentTab: true,
        // 将当前页面自身纳入可选范围（Chrome 94+）
        selfBrowserSurface: 'include',
        // 不显示系统音频选项，保持对话框简洁
        systemAudio: 'exclude'
      };

      stream = await navigator.mediaDevices.getDisplayMedia(constraints);

      const video = document.createElement('video');
      video.srcObject = stream;
      video.muted = true;
      video.playsInline = true;

      await new Promise((resolve, reject) => {
        video.onloadedmetadata = () => video.play().then(resolve).catch(reject);
        video.onerror = reject;
      });

      // 等待一帧确保视频帧完整渲染
      await new Promise((resolve) => setTimeout(resolve, 80));

      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth || 1920;
      canvas.height = video.videoHeight || 1080;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      // 立即停止屏幕共享，关闭系统共享指示图标
stream.getTracks().forEach((track) => { track.stop(); });
      stream = null;

      const dataUrl = canvas.toDataURL('image/png');
      screenshotImage.value = dataUrl;
      showModal.value = true;
      return dataUrl;
    } catch (err) {
      if (stream) stream.getTracks().forEach((track) => { track.stop(); });
      if (err.name !== 'NotAllowedError' && err.name !== 'AbortError') {
        const msg = err.message || '屏幕截图获取失败';
        error.value = msg;
        throw err;
      }
      return null;
    } finally {
      isCapturing.value = false;
    }
  }

  function closeScreenshotModal() {
    showModal.value = false;
    screenshotImage.value = null;
  }

  return {
    isCapturing,
    screenshotImage,
    showModal,
    error,
    captureScreen,
    closeScreenshotModal
  };
}
