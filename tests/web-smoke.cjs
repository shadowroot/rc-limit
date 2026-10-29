// Optional integration check: install playwright separately, then set NODE_PATH to its node_modules.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const project = path.resolve(__dirname, '..');
async function main() {
  const { defaults } = await import('../web/protocol.mjs');
  const server = http.createServer(async (req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const base = '/rc-limit/';
    if (!pathname.startsWith(base)) { res.writeHead(404).end(); return; }
    const filename = pathname === base ? 'index.html' : pathname.slice(base.length);
    if (!['index.html', 'app.mjs', 'protocol.mjs', 'ble.mjs', 'boards.mjs', 'hardware/boards.json', 'style.css'].includes(filename)) { res.writeHead(404).end(); return; }
    res.setHeader('Content-Type', filename.endsWith('.mjs') ? 'text/javascript' : filename.endsWith('.json') ? 'application/json' : filename.endsWith('.css') ? 'text/css' : 'text/html');
    res.end(await fs.readFile(path.join(project, 'web', filename)));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
      headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(config => {
      let controller; let armed = false, saved = false, revision = 0, deviceName = 'Pico-ABC123';
      const board = new URL(location.href).searchParams.get('board') || 'pico';
      let mappings = [{ ...config, input_pin: board === 'esp32c3' ? 3 : board === 'esp32' ? 27 : 4, output_pin: board === 'esp32c3' ? 4 : board === 'esp32' ? 25 : 5 }];
      function reply(line, emit) {
        const request = JSON.parse(line); let error;
        if (request.cmd === 'set_mappings') { if (armed) error = 'disarm_first'; else { mappings = request.mappings; revision++; saved = false; } }
        window.simulatedMappings = mappings;
        if (request.cmd === 'set_name') { if (armed) error = 'disarm_first'; else deviceName = request.name; }
        if (request.cmd === 'save') saved = true;
        if (request.cmd === 'arm') armed = true;
        if (request.cmd === 'disarm') armed = false;
        const response = { device_name: deviceName, device_id: '001122ABC123', name_pending_restart: deviceName !== 'Pico-ABC123', id: request.id, ok: !error, error, board, armed, saved, revision,
          signal_ok: true, input_us: 1500, output_us: 1500, config: mappings[0], protocol_version: 2,
          max_mappings: 4, mappings, channel_states: mappings.map(() => ({ input_us: 1500, output_us: 1500, signal_ok: true, armed })),
          transports: { usb_serial: true, bluetooth_serial: board !== 'pico', bluetooth_type: board === 'esp32c3' ? 'ble' : 'classic_spp', usb_interface: 'native_cdc', bluetooth_name: board === 'esp32c3' ? 'RC-Limiter-C3' : 'RC-Limiter' } };
        emit(new TextEncoder().encode(JSON.stringify(response) + '\n'));
      }
      const port = {
        async open() {}, async setSignals(signals) { window.serialSignals = signals; }, async close() {},
        getInfo() { return { usbVendorId: board === 'pico' ? 0x2e8a : board === 'esp32c3' ? 0x303a : 0x10c4 }; },
        readable: new ReadableStream({ start(value) { controller = value; } }),
        writable: new WritableStream({ write(bytes) { reply(new TextDecoder().decode(bytes), result => controller.enqueue(result)); } }),
      };
      Object.defineProperty(navigator, 'serial', { configurable: true, value: { async requestPort(options) { window.serialRequestOptions = options; return port; } } });
      const tx = new EventTarget(); tx.startNotifications = async () => tx;
      let bleInput = ''; window.bleChunks = [];
      const rx = { async writeValueWithResponse(bytes) {
        window.bleChunks.push(bytes.length); bleInput += new TextDecoder().decode(bytes);
        while (bleInput.includes('\n')) {
          const index = bleInput.indexOf('\n'); const line = bleInput.slice(0, index); bleInput = bleInput.slice(index + 1);
          reply(line, result => {
            for (let offset = 0; offset < result.length; offset += 20) {
              const part = result.slice(offset, offset + 20); tx.value = new DataView(part.buffer);
              tx.dispatchEvent(new Event('characteristicvaluechanged'));
            }
          });
        }
      } };
      const device = new EventTarget(); device.name = 'RC-Limiter-C3';
      device.gatt = { connected: true, async connect() { return this; }, async getPrimaryService() {
        return { async getCharacteristic(uuid) { return uuid.startsWith('6e400002') ? rx : tx; } };
      }, disconnect() { this.connected = false; device.dispatchEvent(new Event('gattserverdisconnected')); } };
      Object.defineProperty(navigator, 'bluetooth', { configurable: true, value: { async requestDevice(options) { window.bleRequestOptions = options; return device; } } });
    }, defaults);
    await page.goto(`http://127.0.0.1:${server.address().port}/rc-limit/`);
    assert.equal(await page.locator('#config-form input[name], #config-form select[name]').count(), 15);
    await page.locator('#board-layout option').last().waitFor({ state: 'attached' });
    assert.equal(await page.locator('#board-layout option').count(), 4);
    await page.locator('#board-guide summary').click();
    await page.locator('#board-layout').selectOption('esp32c3-supermini');
    assert.match(await page.locator('#board-notes').textContent(), /GPIO18\/19/);
    assert.equal(await page.locator('#board-drawing .pin-row').count(), 8);
    await page.locator('#pin-suggestions button').first().click();
    assert.equal(await page.locator('#input_pin').inputValue(), '3');
    assert.equal(await page.locator('#output_pin').inputValue(), '4');
    await page.locator('#board-layout').selectOption('pico');
    await page.locator('#pin-suggestions button').first().click();
    assert.equal(await page.locator('#board-drawing .pin-row').count(), 20);
    await page.locator('#board-guide summary').click();
    assert.equal(await page.locator('#bidirectional').inputValue(), '1');
    assert.equal(await page.locator('#arm').isDisabled(), true);
    await page.locator('#connect').click();
    await page.waitForFunction(() => document.getElementById('connection').textContent === 'CONNECTED');
    await page.locator('#device-name').fill('Boat port ESC');
    await page.waitForTimeout(600); // Telemetry must preserve the unsaved name draft.
    assert.equal(await page.locator('#device-name').inputValue(), 'Boat port ESC');
    await page.locator('#rename-device').click();
    await page.waitForFunction(() => document.getElementById('device-identity').textContent.includes('Boat port ESC'));
    assert.match(await page.locator('#name-note').textContent(), /restart/i);

    assert.equal(await page.evaluate(() => window.serialSignals.dataTerminalReady), true);
    await page.locator('#forward_percent').fill('20');
    await page.locator('#apply').click();
    await page.waitForFunction(() => document.getElementById('message').textContent.startsWith('Settings applied'));
    assert.equal(await page.locator('#saved').textContent(), 'RAM ONLY');
    await page.locator('#save').click();
    await page.waitForFunction(() => document.getElementById('saved').textContent === 'SAVED');
    assert.match(await page.locator('#transports').textContent(), /USB serial: enabled/);
    await page.locator('#add-mapping').click();
    assert.equal(await page.locator('#mapping-select option').count(), 2);
    assert.equal(await page.locator('#input_pin').inputValue(), '6');
    await page.locator('#reverse_percent').fill('12');
    await page.locator('#output_pin').fill('5'); await page.locator('#apply').click();
    assert.match(await page.locator('#message').textContent(), /unique output/);
    await page.locator('#output_pin').fill('7');
    await page.locator('#mapping-select').selectOption('0');
    assert.equal(await page.locator('#forward_percent').inputValue(), '20');
    await page.locator('#apply').click();
    await page.waitForFunction(() => window.simulatedMappings.length === 2);
    assert.equal(await page.evaluate(() => window.simulatedMappings[1].reverse_percent), 12);
    await page.locator('#mapping-select').selectOption('1');
    assert.equal(await page.locator('#reverse_percent').inputValue(), '12');
    assert.equal(await page.locator('#mapping-summary p').count(), 2);
    await page.locator('#arm').click();
    await page.waitForFunction(() => document.getElementById('armed').textContent === 'ARMED');
    assert.equal(await page.locator('#rename-device').isDisabled(), true);
    assert.equal(await page.locator('#apply').isDisabled(), true);
    assert.equal(await page.locator('#add-mapping').isDisabled(), true);
    await page.locator('#disarm').click();
    await page.waitForFunction(() => document.getElementById('armed').textContent === 'DISARMED');
    await page.locator('#forward_percent').fill('101'); await page.locator('#apply').click();
    assert.match(await page.locator('#message').textContent(), /0–100/);
    const profile = { ...defaults, forward_percent: 18, reverse_percent: 22 };
    await page.locator('#import').setInputFiles({ name: 'profile.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(profile)) });
    await page.waitForFunction(() => document.getElementById('forward_percent').value === '18');
    const downloadReady = page.waitForEvent('download'); await page.locator('#export').click();
    const download = await downloadReady; assert.equal(download.suggestedFilename(), 'rc-limit-profile.json');
    assert.deepEqual(JSON.parse(await fs.readFile(await download.path(), 'utf8')), { version: 2, mappings: [profile] });
    assert.equal(await page.locator('#mapping-select option').count(), 1);
    await page.locator('#add-mapping').click(); await page.locator('#add-mapping').click(); await page.locator('#add-mapping').click();
    assert.equal(await page.locator('#mapping-select option').count(), 4);
    assert.equal(await page.locator('#add-mapping').isDisabled(), true);
    await page.locator('#apply').click();
    await page.waitForFunction(() => window.simulatedMappings.length === 4);
    await page.locator('#save').click();
    await page.waitForFunction(() => document.getElementById('saved').textContent === 'SAVED');
    assert.equal(await page.locator('#mapping-summary p').count(), 4);
    await page.locator('#remove-mapping').click();
    assert.equal(await page.locator('#mapping-select option').count(), 3);
    const multi = { version: 2, mappings: [profile, { ...profile, input_pin: 6, output_pin: 7, reverse_percent: 9 }] };
    await page.locator('#import').setInputFiles({ name: 'multi.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(multi)) });
    await page.waitForFunction(() => document.getElementById('mapping-select').options.length === 2);
    await page.locator('#apply').click();
    await page.waitForFunction(() => window.simulatedMappings.length === 2);
    await fs.mkdir(path.join(project, 'build'), { recursive: true });
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: path.join(project, 'build/web-preview.png'), fullPage: true });
    await page.locator('#disconnect').click();
    await page.waitForFunction(() => document.getElementById('connection').textContent === 'OFFLINE');
    assert.equal(await page.locator('#armed').textContent(), 'UNKNOWN');
    assert.match(await page.locator('#message').textContent(), /confirmed DISARM/);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.goto(`http://127.0.0.1:${server.address().port}/rc-limit/?board=esp32`);
    await page.locator('#connect').click();
    await page.waitForFunction(() => document.getElementById('connection').textContent === 'CONNECTED');
    assert.equal(await page.locator('#input_pin').inputValue(), '27');
    assert.match(await page.locator('#transports').textContent(), /Bluetooth serial: RC-Limiter \(enabled\)/);
    assert.deepEqual(await page.evaluate(() => window.serialRequestOptions.allowedBluetoothServiceClassIds), ['00001101-0000-1000-8000-00805f9b34fb']);
    await page.locator('#add-mapping').click();
    assert.equal(await page.locator('#input_pin').inputValue(), '26');
    assert.equal(await page.locator('#output_pin').inputValue(), '33');
    await page.locator('#apply').click();
    await page.waitForFunction(() => window.simulatedMappings.length === 2);
    await page.locator('#disconnect').click();
    await page.waitForFunction(() => document.getElementById('connection').textContent === 'OFFLINE');
    await page.goto(`http://127.0.0.1:${server.address().port}/rc-limit/?board=esp32c3`);
    await page.locator('#connect').click();
    await page.waitForFunction(() => document.getElementById('connection').textContent === 'CONNECTED');
    assert.equal(await page.evaluate(() => window.serialSignals.dataTerminalReady), true);
    assert.equal(await page.locator('#input_pin').inputValue(), '3');
    await page.locator('#disconnect').click();
    await page.waitForFunction(() => document.getElementById('connection').textContent === 'OFFLINE');
    await page.locator('#connect-ble').click();
    await page.waitForFunction(() => document.getElementById('connection').textContent === 'CONNECTED');
    assert.equal(await page.locator('#input_pin').inputValue(), '3');
    assert.equal(await page.locator('#output_pin').inputValue(), '4');
    assert.equal(await page.locator('#board-layout').inputValue(), 'esp32c3-supermini');
    assert.match(await page.locator('#transports').textContent(), /RC-Limiter-C3.*BLE/);
    await page.locator('#add-mapping').click(); await page.locator('#apply').click();
    await page.waitForFunction(() => window.simulatedMappings.length === 2);
    assert.equal(await page.evaluate(() => window.simulatedMappings[1].input_pin), 5);
    assert.equal(await page.evaluate(() => window.bleChunks.every(n => n <= 20)), true);
    await page.locator('#save').click(); await page.waitForFunction(() => document.getElementById('saved').textContent === 'SAVED');
    await page.locator('#board-guide summary').click();
    assert.equal(await page.locator('#board-drawing .pin-row').count(), 8);
    await page.setViewportSize({ width: 1280, height: 920 });
    await page.screenshot({ path: path.join(project, 'build/c3-ble-preview.png'), fullPage: true });
    await page.locator('#pins').screenshot({ path: path.join(project, 'build/board-guide-preview.png') });
    await page.locator('#disconnect').click();
    await page.waitForFunction(() => document.getElementById('connection').textContent === 'OFFLINE');
    assert.deepEqual(errors, []);
    console.log('Browser integration passed: Pico/ESP32/C3 USB, C3 BLE UART fragmentation and apply/save, SPP picker, board diagrams/suggested pins, 1–4 mappings, validation, arming UI, profiles and responsive layout. Radio and serial devices were simulated.');
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
