import { t } from './i18n.mjs';
import { ESPLoader, Transport } from 'esptool-js';
import { unzipSync } from 'fflate';
import SparkMD5 from 'spark-md5';
import { validateBundle, flashBundle } from './firmware.mjs';
import { validateCatalog, fetchStablePackage } from './stable.mjs';
const $ = id => document.getElementById(id);
export function initUpdater({ canUpdate, setBusy }) {
  let bundle, busy = false;
  const catalogs = { stable: undefined, development: undefined };
  const catalogUrl = new URL('./firmware/catalog.json', document.baseURI);
  const controls = ['update-board', 'update-file', 'update-ack', 'update-check'];
  let lastMessage = '';
  const message = text => { lastMessage = text; $('update-status').textContent = t(text); };
  function catalogSelection(channel) {
    const catalog = catalogs[channel];
    const item = catalog?.boards.find(item => item.board === $('update-board').value);
    const link = $(`${channel}-firmware-download`);
    link.hidden = !item;
    if (item) { const url = new URL(item.file, catalogUrl);url.searchParams.set('sha256', item.sha256);link.href = url.href; link.download = `rc-limit-${item.board}.zip`; }
    $(`${channel}-firmware-use`).disabled = busy || !item || !item.updater_supported;
    if (!catalog) return;
    if (channel === 'stable') {
      if (!item) $('stable-firmware-status').textContent = t(catalog.release ? `Bundled stable release: ${catalog.release.tag}. Choose your exact board to download or load its firmware.` : 'No published stable firmware is bundled. You can still select a release ZIP manually.');
      else $('stable-firmware-status').textContent = t(`Bundled stable release: ${catalog.release.tag}. `) + t(item.updater_supported ? 'Download or load the selected board firmware.' : 'This older package is download-only; use its CLI flashing instructions.');
    } else {
      if (!item) $('development-firmware-status').textContent = t(catalog.release ? `Bundled development prerelease: ${catalog.release.tag}. Choose your exact board.` : 'No published development firmware is bundled.');
      else $('development-firmware-status').textContent = t(`Bundled development prerelease: ${catalog.release.tag}. `) + t(item.updater_supported ? 'Download or load the selected board firmware.' : 'This older package is download-only; use its CLI flashing instructions.');
    }
  }
  function catalogSelections() { for (const channel of ['stable', 'development']) catalogSelection(channel); }
  function buttons() {
    controls.forEach(id => { $(id).disabled = busy; });
    $('update-flash').disabled = busy || !bundle || bundle.board === 'pico' || !$('update-ack').checked || !navigator.serial;
    catalogSelections();
    $('update-uf2').disabled = busy || !bundle || bundle.board !== 'pico' || !$('update-ack').checked;
  }
  function invalidate() { bundle = undefined; $('update-progress').value = 0; buttons(); message('Select the matching release ZIP, then verify it.'); }
  $('update-board').onchange = invalidate; $('update-file').onchange = invalidate; $('update-ack').onchange = buttons;
  async function verifyFile(file) {
    bundle = undefined; busy = true; buttons();
    try {
      if (!file || file.size > 6 * 1024 * 1024) throw new Error('Select an RC Limit firmware ZIP no larger than 6 MiB.');
      let total = 0; const seen = new Set();
      const allowed = ['update-manifest.json', 'firmware.uf2', 'bootloader.bin', 'partitions.bin', 'firmware.bin'];
      const entries = unzipSync(new Uint8Array(await file.arrayBuffer()), { filter: entry => {
        if (!allowed.includes(entry.name)) return false;
        if (seen.has(entry.name)) throw new Error('Duplicate firmware ZIP entry.');
        seen.add(entry.name);
        total += entry.originalSize;
        if (total > 6 * 1024 * 1024 || entry.originalSize > 4 * 1024 * 1024) throw new Error('Oversized firmware ZIP contents.');
        return true;
      } });
      bundle = await validateBundle(entries, $('update-board').value);
      message(`Verified ${bundle.board} · source ${bundle.commit.slice(0, 12)}. ${t(bundle.board === 'pico' ? 'Export the UF2 and copy it to the BOOTSEL volume.' : 'Ready to choose a USB port and flash.')}`);
    } catch (error) { message(error.message); }
    finally { busy = false; buttons(); }
  }
  $('update-check').onclick = () => verifyFile($('update-file').files[0]);
  for (const channel of ['stable', 'development']) {
    $(`${channel}-firmware-use`).onclick = async () => {
      const item = catalogs[channel]?.boards.find(item => item.board === $('update-board').value);
      if (!item || !item.updater_supported || busy) return;
      busy = true; buttons();
      try {
        const bytes = await fetchStablePackage(item, catalogUrl);
        await verifyFile(new File([bytes], `rc-limit-${item.board}.zip`, { type: 'application/zip' }));
      } catch (error) { bundle = undefined; message(error.message); }
      finally { busy = false; buttons(); }
    };
    const url = channel === 'stable' ? catalogUrl : new URL('./firmware/development-catalog.json', document.baseURI);
    fetch(url, { cache: 'no-store' }).then(response => {
      if (!response.ok) throw new Error(channel === 'stable' ? 'Stable catalog unavailable.' : 'Development catalog unavailable.');
      return response.json();
    }).then(value => { catalogs[channel] = validateCatalog(value, channel);catalogSelection(channel); })
      .catch(error => { $(`${channel}-firmware-status`).textContent = t(error.message) + t(' You can select a release ZIP manually.'); });
  }
  $('update-uf2').onclick = () => {
    if (!bundle || bundle.board !== 'pico' || !$('update-ack').checked || !canUpdate()) { message('Disconnect the configuration session before updating.'); return; }
    const url = URL.createObjectURL(new Blob([bundle.images[0].data]));
    const link = document.createElement('a'); link.href = url; link.download = 'rc-limit-pico.uf2';link.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    message('Hold BOOTSEL while reconnecting Pico USB, then copy the downloaded UF2 to RPI-RP2. Reconnect and read settings after reboot.');
  };
  $('update-flash').onclick = async () => {
    if (!bundle || bundle.board === 'pico' || !$('update-ack').checked || busy) return;
    if (!canUpdate()) { message('Stop the transmitter and disconnect the configuration session before updating.'); return; }
    let transport;
    busy = true; setBusy(true);buttons();$('update-log').textContent = '';$('update-progress').value = 0;
    let log = '';
    function append(text) { log = (log + text).slice(-12000);$('update-log').textContent = log; }
    try {
      // Request a port directly from this click; never reuse the configuration handle.
      const port = await navigator.serial.requestPort();
      transport = new Transport(port, true);
      const loader = new ESPLoader({ transport, baudrate: 115200, terminal: { clean() {}, write: append, writeLine: text => append(text + '\n') } });
      message('Connecting to the USB bootloader. If needed, hold BOOT and tap RESET.');
      await loader.main();
      await flashBundle(loader, bundle, {
        reportProgress: (index, written, total) => { $('update-progress').value = (index + written / total) / bundle.images.length; },
        calculateMD5Hash: bytes => SparkMD5.ArrayBuffer.hash(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)),
      });
      $('update-progress').value = 1;
      // USB reset/re-enumeration can fail after a successful verified write.
      try { await loader.after('hard_reset'); message('Flash verified. Reconnect and read settings before restoring motor power.'); }
      catch { message('Flash verified. Unplug/reconnect USB, then read settings before restoring motor power.'); }
    } catch (error) { message(`Update stopped: ${error.message}. Keep motor power disconnected; retry USB bootloader flashing if needed.`); }
    finally {
      try { await transport?.disconnect(); } catch { /* Device may have re-enumerated. */ }
      busy = false;setBusy(false);buttons();
    }
  };
  window.addEventListener('rc-language-change', () => { message(lastMessage);catalogSelections(); });
  buttons();
  message(navigator.serial ? 'Select the matching release ZIP, then verify it.' : 'USB flashing needs desktop Chrome/Edge or Electron. Pico UF2 export remains available.');
}
