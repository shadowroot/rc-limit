import { fields, defaults, validateDeviceName, validate, validateMappings, profile, nextMapping, Protocol } from './protocol.mjs';
import { openBle } from './ble.mjs';
import { loadBoardProfiles, drawBoard, boardForFirmware } from './boards.mjs';
const $ = id => document.getElementById(id);
const controls = {};
const selects = { bidirectional: ['Forward only', 'Bidirectional'], scale: ['Clamp at limit', 'Scale full stick travel'], invert: ['Normal', 'Inverted'] };
for (const [key, label, group] of fields) {
  const wrapper = document.createElement('label'); wrapper.textContent = label;
  const input = document.createElement(selects[key] ? 'select' : 'input');
  if (selects[key]) selects[key].forEach((text, value) => input.add(new Option(text, value)));
  else { input.type = 'number'; input.step = '1'; input.required = true; }
  input.name = key; input.id = key;
  wrapper.append(input); document.querySelector(`[data-group="${group}"]`).append(wrapper); controls[key] = input;
}
function fill(config) {
  for (const [key, value] of Object.entries(config)) if (controls[key]) controls[key].value = value;
  queueMicrotask(renderBoardGuide);
}
function form() {
  const config = {};
  for (const [key, input] of Object.entries(controls)) {
    if (input.value.trim() === '') throw new Error('Complete every field.');
    config[key] = Number(input.value);
  }
  return validate(config);
}
fill(defaults);
let lastDeviceName, lastDeviceId;
let draftMappings = [{ ...defaults }], selectedMapping = 0, boardName, latestData, protocolVersion = 1;
function stashMapping() { draftMappings[selectedMapping] = form(); }
function renderMappings() {
  $('mapping-select').replaceChildren(...draftMappings.map((c, i) => new Option(`${i + 1}: GPIO${c.input_pin} → GPIO${c.output_pin}`, i)));
  $('mapping-select').value = selectedMapping;
  $('add-mapping').disabled = draftMappings.length >= 4 || !!latestData?.armed;
  $('remove-mapping').disabled = draftMappings.length <= 1 || !!latestData?.armed;
  fill(draftMappings[selectedMapping]);
}
function loadMappings(data) {
  draftMappings = profile(data.mappings ? { version: 2, mappings: data.mappings } : data.config, data.board).mappings.map(c => ({ ...c }));
  selectedMapping = Math.min(selectedMapping, draftMappings.length - 1); renderMappings();
}
function currentProfile() {
  stashMapping(); return { version: 2, mappings: validateMappings(draftMappings, boardName) };
}
renderMappings();
let port, reader, writer, protocol, polling, readTask, bleLink, connecting = false, closing = false, updatingFirmware = false;
let boardProfiles = [], selectedBoard;
function renderBoardGuide() {
  const board = boardProfiles.find(p => p.id === $('board-layout').value); if (!board) return;
  selectedBoard = board;
  $('board-notes').textContent = board.notes;
  $('board-source').href = board.source;
  drawBoard(board, $('board-drawing'), Number(controls.input_pin.value), Number(controls.output_pin.value));
  const suggestions = $('pin-suggestions'); suggestions.replaceChildren();
  board.pairs.forEach(([input, output], i) => {
    const button = document.createElement('button'); button.type = 'button';
    button.textContent = `${i + 1}: GPIO${input} → GPIO${output}`;
    button.disabled = !!latestData?.armed || (!!boardName && !!protocol && board.firmware !== boardName);
    button.onclick = () => {
      controls.input_pin.value = input; controls.output_pin.value = output; renderBoardGuide();
      message('Suggested GPIOs filled into the selected draft mapping. Check all mapping conflicts, then Apply all.');
    }; suggestions.append(button);
  });
}
loadBoardProfiles().then(profiles => {
  boardProfiles = profiles;
  $('board-layout').replaceChildren(...profiles.map(p => new Option(p.name, p.id)));
  const board = latestData ? boardForFirmware(latestData.board, latestData.transports?.usb_interface) : profiles[0];
  $('board-layout').value = board.id; renderBoardGuide();
}).catch(error => { $('board-notes').textContent = error.message; });
$('board-layout').onchange = renderBoardGuide;
for (const key of ['input_pin', 'output_pin']) controls[key].addEventListener('input', renderBoardGuide);
function message(text) { $('message').textContent = text; }
function deviceButtons(connected) {
  document.querySelectorAll('[data-device]').forEach(b => b.disabled = !connected);
  $('connect').disabled = connected || connecting || updatingFirmware; $('disconnect').disabled = !connected;
  $('connect-ble').disabled = connected || connecting || updatingFirmware;
}
deviceButtons(false);
function status(data) {
  const previousBoard = boardName;
  const supportsNames = typeof data.device_name === 'string' && typeof data.device_id === 'string';
  $('rename-device').disabled = !supportsNames || !!data.armed;
  if (supportsNames) {
    if (lastDeviceId !== data.device_id || $('device-name').value === lastDeviceName || $('device-name').value === data.device_name) $('device-name').value = data.device_name;
    lastDeviceName = data.device_name; lastDeviceId = data.device_id;
    $('device-identity').textContent = `${data.device_name} · ${data.board} · ID ${data.device_id}`;
    $('name-note').textContent = data.name_pending_restart ? 'Name saved. Restart the board with motor power disconnected to update Bluetooth discovery.' : 'Name is stored on this board and retained by settings-preserving firmware updates.';
  } else { $('device-identity').textContent = 'Upgrade firmware to name this board.'; }
  latestData = data; boardName = data.board; protocolVersion = data.protocol_version || 1;
  $('board').textContent = data.board === 'esp32c3' ? 'ESP32-C3 · USB / BLE serial' : data.board === 'esp32' ? 'ESP32 · USB / Bluetooth SPP' : 'Raspberry Pi Pico · USB serial';
  if (boardProfiles.length && previousBoard !== boardName) $('board-layout').value = boardForFirmware(data.board, data.transports?.usb_interface).id;
  renderBoardGuide();
  $('armed').textContent = data.armed ? 'ARMED' : 'DISARMED';
  $('signal').textContent = data.signal_ok ? 'Receiver signal valid' : 'Receiver lost / invalid';
  const state = data.channel_states ? data.channel_states[selectedMapping] : selectedMapping === 0 ? data : undefined;
  for (const key of ['input', 'output']) {
    $(key).textContent = state ? `${state[`${key}_us`]} µs` : 'Not applied'; $(`${key}-meter`).value = state?.[`${key}_us`] || 800;
  }
  $('saved').textContent = data.saved ? 'SAVED' : 'RAM ONLY';
  $('revision').textContent = `Revision ${data.revision} · viewing mapping ${selectedMapping + 1}`;
  $('apply').disabled = $('save').disabled = !!data.armed;
  $('arm').disabled = !!data.armed || !data.signal_ok;
  $('add-mapping').disabled = draftMappings.length >= 4 || !!data.armed;
  $('remove-mapping').disabled = draftMappings.length <= 1 || !!data.armed;
  $('transports').textContent = data.transports ? `USB serial: enabled · Bluetooth serial: ${data.transports.bluetooth_serial ? `${data.transports.bluetooth_name} (enabled${data.transports.bluetooth_type === 'ble' ? ', BLE' : ''})` : 'unavailable'}`
    : data.board === 'esp32' ? 'USB serial + Bluetooth SPP: RC-Limiter' : 'USB serial enabled · no onboard Bluetooth';
  const summary = $('mapping-summary'); summary.replaceChildren();
  (data.mappings || [data.config]).forEach((c, i) => {
    const s = data.channel_states?.[i] || (i === 0 ? data : {});
    const row = document.createElement('p');
    row.textContent = `Live ${i + 1}: GPIO${c.input_pin} → GPIO${c.output_pin} · ${s.input_us} → ${s.output_us} µs · ${s.signal_ok ? 'signal OK' : 'signal lost'} · forward ${c.forward_percent}% / reverse ${c.reverse_percent}%`;
    summary.append(row);
  });
  $('pin-hint').textContent = data.board === 'esp32c3' ? 'C3 input/output: 0, 1, 3, 4, 5, 6, 7, 10. Keep boot straps, native USB and UART pins free. Default GPIO3 → GPIO4.' : data.board === 'esp32'
    ? 'ESP32 output/input: 18, 19, 21, 22, 23, 25, 26, 27, 32, 33. Extra input-only: 34, 35, 36, 39.'
    : 'Pico input/output: GP0–GP22 and GP26–GP28. GP4 → GP5 by default.';
}
async function activateConnection(current) {
  const data = await current.request('get'); loadMappings(data);
  $('connection').textContent = 'CONNECTED'; $('dot').classList.add('online');
  connecting = false; deviceButtons(true); status(data);
  message('Board mappings loaded. Disarm before applying changes. Hold every input at neutral for one second before ARM ALL.');
  polling = setInterval(() => {
    if (protocol && protocol.pending.size === 0) protocol.request('get').catch(error => message(error.message));
  }, bleLink ? 500 : 250);
}
async function connect() {
  if (updatingFirmware) return;
  if (!navigator.serial) { message('Web Serial is unavailable. Use desktop Chrome/Edge, Electron, or the native Android app.'); return; }
  connecting = true; deviceButtons(false);
  try {
    port = await navigator.serial.requestPort({ allowedBluetoothServiceClassIds: ['00001101-0000-1000-8000-00805f9b34fb'] });
    await port.open({ baudRate: 115200, bufferSize: 8192 });
    const vid = port.getInfo?.().usbVendorId;
    const nativeUsb = vid === 0x2e8a || vid === 0x303a;
    try { await port.setSignals({ dataTerminalReady: nativeUsb, requestToSend: false }); } catch { /* Some SPP drivers lack modem signals. */ }
    reader = port.readable.getReader(); writer = port.writable.getWriter();
    protocol = new Protocol(text => writer.write(new TextEncoder().encode(text)), status, error => {
      message(error.message + ' Use transmitter stop or the physical cutoff.'); void disconnect(false);
    });
    const current = protocol;
    readTask = (async () => {
      const decoder = new TextDecoder();
      try {
        while (reader) {
          const { value, done } = await reader.read(); if (done) break;
          current.feed(decoder.decode(value, { stream: true }));
        }
      } catch (error) { if (!closing) message(`Serial connection lost: ${error.message}`); }
      finally { if (!closing && protocol === current) void disconnect(false); }
    })();
    message('Connected. Waiting for board startup…');
    await new Promise(resolve => setTimeout(resolve, 2500));
    if (protocol !== current) return;
    await activateConnection(current);
  } catch (error) {
    message(`Connection failed: ${error.message}`); await disconnect(false);
  } finally { connecting = false; $('connect').disabled = $('connect-ble').disabled = !!protocol; }
}
async function connectBle() {
  if (updatingFirmware) return;
  connecting = true; deviceButtons(false);
  try {
    const link = await openBle(text => protocol?.feed(text), error => { message(error.message); void disconnect(false); });
    bleLink = link;
    writer = { write: bytes => link.write(bytes), releaseLock() {} };
    protocol = new Protocol(text => writer.write(new TextEncoder().encode(text)), status, error => {
      message(error.message + ' Use transmitter stop or physical cutoff.'); void disconnect(false);
    }, 15000);
    await activateConnection(protocol);
  } catch (error) { message(`BLE connection failed: ${error.message}`); await disconnect(false); }
  finally { connecting = false; $('connect').disabled = $('connect-ble').disabled = !!protocol; }
}
async function disconnect(requestStop = true) {
  if (closing) return;
  closing = true; clearInterval(polling);
  const current = protocol;
  if (requestStop && current) {
    try { await current.request('disarm'); message('Board confirmed DISARM before disconnect.'); }
    catch { message('Disarm not confirmed. Use transmitter stop or physical cutoff.'); }
  }
  protocol = undefined; current?.close();
  bleLink?.close(); bleLink = undefined;
  try { await reader?.cancel(); await readTask; } catch { /* Device may already be removed. */ }
  reader?.releaseLock(); reader = undefined;
  try { writer?.releaseLock(); await port?.close(); } catch { /* Device may already be removed. */ }
  writer = port = undefined; readTask = undefined;
  $('connection').textContent = 'OFFLINE'; $('dot').classList.remove('online');
  $('armed').textContent = 'UNKNOWN'; $('signal').textContent = 'No live telemetry';
  $('input').textContent = $('output').textContent = '—';
  $('mapping-summary').textContent = 'Disconnected; read the board to view live mappings.';
  latestData = undefined; lastDeviceName = lastDeviceId = undefined;
  $('device-identity').textContent = 'Disconnected; reconnect to identify the board.';
  $('add-mapping').disabled = draftMappings.length >= 4;
  $('remove-mapping').disabled = draftMappings.length <= 1;
  connecting = closing = false; deviceButtons(false);
}
async function action(cmd, extra = {}, load = false) {
  try {
    if (!protocol) throw new Error('Connect a board first.');
    const data = await protocol.request(cmd, extra);
    if (load) loadMappings(data);
    message(({ set_name: data.name_pending_restart ? 'Device name saved. Bluetooth discovery changes after restarting the board.' : 'Device name saved.', set: 'Settings applied to RAM. Save to flash to retain them after power-off.', set_mappings: 'Settings applied to RAM. Save to flash to retain all mappings after power-off.', save: 'Settings saved to board flash.',
      arm: 'Board armed. Transmitter controls throttle within the configured limits.', disarm: 'Board confirmed DISARM. Stop pulse is active.',
      get: 'Board settings loaded into the form.' })[cmd]);
  } catch (error) { message(error.message); }
}
$('config-form').addEventListener('submit', e => e.preventDefault());
$('connect').onclick = connect;
$('connect-ble').onclick = connectBle;
$('disconnect').onclick = () => disconnect();
$('rename-device').onclick = () => {
  try { void action('set_name', { name: validateDeviceName($('device-name').value) }); } catch (error) { message(error.message); }
};
$('read').onclick = () => action('get', {}, true);
$('apply').onclick = () => {
  try {
    const value = currentProfile();
    if (protocolVersion < 2) {
      if (value.mappings.length !== 1) throw new Error('Upgrade board firmware to use multiple mappings.');
      void action('set', { config: value.mappings[0] }, true);
    } else void action('set_mappings', { mappings: value.mappings }, true);
  } catch (error) { message(error.message); }
};
$('mapping-select').onchange = event => {
  try { stashMapping(); selectedMapping = Number(event.target.value); renderMappings(); if (latestData) status(latestData); }
  catch (error) { event.target.value = selectedMapping; message(error.message); }
};
$('add-mapping').onclick = () => {
  try {
    stashMapping(); draftMappings.push(nextMapping(draftMappings, boardName)); selectedMapping = draftMappings.length - 1;
    renderMappings(); if (latestData) status(latestData); message('Mapping added to draft. Configure it, then Apply all mappings.');
  } catch (error) { message(error.message); }
};
$('remove-mapping').onclick = () => {
  if (draftMappings.length <= 1) return;
  draftMappings.splice(selectedMapping, 1); selectedMapping = Math.min(selectedMapping, draftMappings.length - 1);
  renderMappings(); if (latestData) status(latestData); message('Mapping removed from draft. Apply all mappings to change the board.');
};
for (const cmd of ['save', 'arm', 'disarm']) $(cmd).onclick = () => action(cmd);
$('export').onclick = () => {
  try {
    const blob = new Blob([JSON.stringify(currentProfile(), null, 2) + '\n'], { type: 'application/json' });
    const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = 'rc-limit-profile.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  } catch (error) { message(error.message); }
};
$('import').onchange = async event => {
  try {
    const file = event.target.files[0]; if (!file) return;
    if (file.size > 8192) throw new Error('Profile is too large.');
    draftMappings = profile(JSON.parse(await file.text()), boardName).mappings.map(c => ({ ...c }));
    selectedMapping = 0; renderMappings(); if (latestData) status(latestData);
    message('Profile imported into form. Apply all mappings to send it to the board.');
  } catch (error) { message(error.message); }
  event.target.value = '';
};
// Closing a page cannot await serial IO. The board remains autonomous; docs explain this limitation.
window.addEventListener('beforeunload', () => { if (writer) void writer.write(new TextEncoder().encode('{"cmd":"disarm","id":0}\n')).catch(() => {}); });
if (window.desktopSerial) {
  window.desktopSerial.onBleDevices(devices => {
    const list = $('ble-list'); list.replaceChildren();
    for (const device of devices) {
      const button = document.createElement('button'); button.textContent = device.deviceName || device.deviceId;
      button.onclick = () => { window.desktopSerial.chooseBle(device.deviceId); $('ble-dialog').close(); }; list.append(button);
    }
    if (!devices.length) list.textContent = 'Scanning for RC-Limiter-C3. Power the board and enable Bluetooth.';
    if (!$('ble-dialog').open) $('ble-dialog').showModal();
  });
  $('cancel-ble').onclick = () => { window.desktopSerial.chooseBle(''); $('ble-dialog').close(); };
  $('ble-dialog').addEventListener('cancel', () => window.desktopSerial.chooseBle(''));
  window.desktopSerial.onPorts(ports => {
    const list = $('port-list'); list.replaceChildren();
    for (const port of ports) {
      const button = document.createElement('button'); button.textContent = `${port.displayName || port.portName} (${port.portName})`;
      button.onclick = () => { window.desktopSerial.choose(port.portId); $('port-dialog').close(); }; list.append(button);
    }
    if (!ports.length) list.textContent = 'No ports found. Attach a USB board or pair a Bluetooth serial device.';
    if (!$('port-dialog').open) $('port-dialog').showModal();
  });
  $('cancel-port').onclick = () => { window.desktopSerial.choose(''); $('port-dialog').close(); };
  $('port-dialog').addEventListener('cancel', () => window.desktopSerial.choose(''));
}

let updaterReady = false, updaterLoading = false;
$('firmware-update').addEventListener('toggle', async () => {
  if (!$('firmware-update').open || updaterReady || updaterLoading) return;
  updaterLoading = true;
  try {
    const { initUpdater } = await import('./dist/updater.mjs');
    initUpdater({ canUpdate: () => !protocol && !connecting && !closing,
      setBusy: busy => { updatingFirmware = busy; deviceButtons(!!protocol); } });
    updaterReady = true;
  } catch (error) {
    $('update-status').textContent = 'Updater could not load. For local source checkouts, run npm ci --ignore-scripts and npm run build:web, then reopen this panel. ' + error.message;
  } finally { updaterLoading = false; }
});
