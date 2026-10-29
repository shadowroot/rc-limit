import { ESPLoader, Transport } from 'esptool-js';
import { unzipSync } from 'fflate';
import SparkMD5 from 'spark-md5';
import { validateBundle, flashBundle } from './firmware.mjs';
const $ = id => document.getElementById(id);
export function initUpdater({ canUpdate, setBusy }) {
  let bundle, busy = false;
  const controls = ['update-board', 'update-file', 'update-ack', 'update-check'];
  const message = text => { $('update-status').textContent = text; };
  function buttons() {
    controls.forEach(id => { $(id).disabled = busy; });
    $('update-flash').disabled = busy || !bundle || bundle.board === 'pico' || !$('update-ack').checked || !navigator.serial;
    $('update-uf2').disabled = busy || !bundle || bundle.board !== 'pico' || !$('update-ack').checked;
  }
  function invalidate() { bundle = undefined; $('update-progress').value = 0; buttons(); message('Select the matching release ZIP, then verify it.'); }
  $('update-board').onchange = invalidate; $('update-file').onchange = invalidate; $('update-ack').onchange = buttons;
  $('update-check').onclick = async () => {
    bundle = undefined; busy = true; buttons();
    try {
      const file = $('update-file').files[0];
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
      message(`Verified ${bundle.board} · source ${bundle.commit.slice(0, 12)}. ${bundle.board === 'pico' ? 'Export the UF2 and copy it to the BOOTSEL volume.' : 'Ready to choose a USB port and flash.'}`);
    } catch (error) { message(error.message); }
    finally { busy = false; buttons(); }
  };
  $('update-uf2').onclick = () => {
    if (!bundle || bundle.board !== 'pico' || !$('update-ack').checked || !canUpdate()) { message('Disconnect the configuration session before updating.'); return; }
    const url = URL.createObjectURL(new Blob([bundle.images[0].data]));
    const link = document.createElement('a'); link.href = url; link.download = 'rc-limit-pico.uf2';link.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    message('Hold BOOTSEL while reconnecting Pico USB, then copy the downloaded UF2 to RPI-RP2. Reconnect and read settings after reboot.');
  };
  $('update-flash').onclick = async () => {
    if (!bundle || bundle.board === 'pico' || !$('update-ack').checked || busy) return;
    if (!canUpdate()) { message('Disarm and disconnect the configuration session before updating.'); return; }
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
  buttons();
  message(navigator.serial ? 'Select the matching release ZIP, then verify it.' : 'USB flashing needs desktop Chrome/Edge or Electron. Pico UF2 export remains available.');
}
