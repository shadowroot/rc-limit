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
    const filename = pathname === '/' ? 'index.html' : pathname.slice(1);
    if (!['index.html', 'app.mjs', 'protocol.mjs', 'style.css'].includes(filename)) { res.writeHead(404).end(); return; }
    res.setHeader('Content-Type', filename.endsWith('.mjs') ? 'text/javascript' : filename.endsWith('.css') ? 'text/css' : 'text/html');
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
      let controller; let armed = false, saved = false, revision = 0;
      const board = new URL(location.href).searchParams.get('board') || 'pico';
      let mappings = [{ ...config, input_pin: board === 'esp32' ? 27 : 4, output_pin: board === 'esp32' ? 25 : 5 }];
      const port = {
        async open() {}, async setSignals() {}, async close() {},
        readable: new ReadableStream({ start(value) { controller = value; } }),
        writable: new WritableStream({ write(bytes) {
          const request = JSON.parse(new TextDecoder().decode(bytes));
          let error;
          if (request.cmd === 'set_mappings') { if (armed) error = 'disarm_first'; else { mappings = request.mappings; revision++; saved = false; } }
          window.simulatedMappings = mappings;
          if (request.cmd === 'save') saved = true;
          if (request.cmd === 'arm') armed = true;
          if (request.cmd === 'disarm') armed = false;
          const response = { id: request.id, ok: !error, error, board, armed, saved, revision,
            signal_ok: true, input_us: 1500, output_us: 1500, config: mappings[0], protocol_version: 2,
            max_mappings: 4, mappings, channel_states: mappings.map(() => ({ input_us: 1500, output_us: 1500, signal_ok: true, armed })),
            transports: { usb_serial: true, bluetooth_serial: board === 'esp32', bluetooth_name: board === 'esp32' ? 'RC-Limiter' : undefined } };
          controller.enqueue(new TextEncoder().encode(JSON.stringify(response) + '\n'));
        } }),
      };
      Object.defineProperty(navigator, 'serial', { configurable: true, value: { async requestPort(options) { window.serialRequestOptions = options; return port; } } });
    }, defaults);
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    assert.equal(await page.locator('#config-form input, #config-form select').count(), 15);
    assert.equal(await page.locator('#bidirectional').inputValue(), '1');
    assert.equal(await page.locator('#arm').isDisabled(), true);
    await page.locator('#connect').click();
    await page.waitForFunction(() => document.getElementById('connection').textContent === 'CONNECTED');
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
    await page.goto(`http://127.0.0.1:${server.address().port}/?board=esp32`);
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
    assert.deepEqual(errors, []);
    console.log('Browser integration passed: Pico/ESP32 USB serial, Bluetooth SPP picker/capabilities, 1–4 mapping editor, pin conflicts, independent limits/telemetry, apply/save, all-channel arming UI, legacy/v2 profiles, disconnect and mobile width. Serial devices were simulated.');
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
