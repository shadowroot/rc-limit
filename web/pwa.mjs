import { t } from './i18n.mjs';
export function initPwa() {
  const button = document.getElementById('install-app');
  const status = document.getElementById('pwa-status');
  let prompt, installed = matchMedia('(display-mode: standalone)').matches, notice;
  function render() {
    button.hidden = installed;
    status.textContent = t(installed ? 'Installed app. Device access depends on your browser and OS.' : notice || 'Install from your browser menu for an app window and offline settings.');
  }
  button.onclick = async () => {
    if (!prompt) {
      notice = 'Use your browser menu: Install app or Add to Home screen. Installation needs HTTPS or localhost.';
      render();return;
    }
    const current = prompt;prompt = undefined;
    try { await current.prompt();await current.userChoice; }
    catch { notice = 'Installation was unavailable. Try Install app in your browser menu.'; }
    render();
  };
  window.addEventListener('beforeinstallprompt', event => {event.preventDefault();prompt = event;render();});
  window.addEventListener('appinstalled', () => {installed = true;prompt = undefined;render();});
  window.addEventListener('rc-language-change', render);
  if (location.protocol === 'https:' || location.protocol === 'http:') {
    if ('serviceWorker' in navigator && window.isSecureContext) {
      navigator.serviceWorker.register(new URL('./sw.js', import.meta.url), {updateViaCache: 'none'}).then(registration => {
        function waiting(installedUpdate = false) {
          if (registration.waiting || installedUpdate) {notice = 'App update ready. Finish configuration or flashing, then close all app windows and reopen to update.';render();}
        }
        waiting();registration.addEventListener('updatefound', () => {
          const worker = registration.installing;
          worker?.addEventListener('statechange', () => {if (worker.state === 'installed') waiting(!!registration.active);});
        });
        navigator.serviceWorker.ready.then(() => {
          if (!notice) {notice = 'Interface ready offline. Firmware downloads need an internet connection.';render();}
        });
      }).catch(() => {notice = 'Offline setup unavailable. The app can still run online; build web assets and reload to retry.';render();});
    }
  } else {button.hidden = true;status.hidden = true;return;}
  render();
}
