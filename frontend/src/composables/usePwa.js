import { ref } from 'vue';

const isInstallable = ref(false);
const isInstalled = ref(false);
const hasUpdate = ref(false);
let deferredPrompt = null;
let registrationInstance = null;

export function usePwa() {
  function checkInstalled() {
    if (typeof window === 'undefined') return;
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true ||
      document.referrer.includes('android-app://');
    isInstalled.value = isStandalone;
  }

  function initPwa() {
    if (typeof window === 'undefined') return;

    checkInstalled();

    window.addEventListener('beforeinstallprompt', (e) => {
      // Prevent default mini-infobar or browser banner
      e.preventDefault();
      deferredPrompt = e;
      isInstallable.value = true;
    });

    window.addEventListener('appinstalled', () => {
      deferredPrompt = null;
      isInstallable.value = false;
      isInstalled.value = true;
    });

    // Register Service Worker
    if ('serviceWorker' in navigator && (window.location.protocol === 'https:' || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
      window.addEventListener('load', () => {
        const swUrl = './sw.js';
        navigator.serviceWorker
          .register(swUrl)
          .then((reg) => {
            registrationInstance = reg;

            reg.addEventListener('updatefound', () => {
              const newWorker = reg.installing;
              if (newWorker) {
                newWorker.addEventListener('statechange', () => {
                  if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                    hasUpdate.value = true;
                  }
                });
              }
            });
          })
          .catch((err) => {
            console.warn('[PWA] Service Worker registration failed:', err);
          });
      });

      // Reload when controller changes after update
      let refreshing = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!refreshing) {
          refreshing = true;
          window.location.reload();
        }
      });
    }
  }

  async function promptInstall() {
    if (!deferredPrompt) return false;
    try {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      deferredPrompt = null;
      isInstallable.value = false;
      if (outcome === 'accepted') {
        isInstalled.value = true;
        return true;
      }
      return false;
    } catch (err) {
      console.warn('[PWA] Prompt install error:', err);
      return false;
    }
  }

  function applyUpdate() {
    if (registrationInstance?.waiting) {
      registrationInstance.waiting.postMessage({ type: 'SKIP_WAITING' });
    }
  }

  return {
    isInstallable,
    isInstalled,
    hasUpdate,
    initPwa,
    promptInstall,
    applyUpdate
  };
}
