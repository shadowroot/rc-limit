// Optional: NODE_PATH=<playwright installation>/node_modules node tests/electron-smoke.cjs
const { _electron } = require('playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
async function main() {
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  // Headless test flags only. Production BrowserWindow retains its normal sandbox.
  const app = await _electron.launch({ executablePath: require('electron'), env,
    args: [path.resolve(__dirname, '..'), '--no-sandbox', '--ozone-platform=headless', '--disable-gpu'] });
  try {
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1280, height: 920 });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.waitForSelector('#bidirectional');
    assert.equal(await page.locator('#config-form input[name], #config-form select[name]').count(), 15);
    await page.waitForFunction(() => document.getElementById('board-layout').options.length === 4);
    assert.equal(await page.evaluate(() => !!navigator.serial && !!window.desktopSerial), true);
    assert.equal(await page.evaluate(() => !!navigator.bluetooth), true);
    await page.locator('a[href="#pins"]').click();
    await page.locator('#connect').click();
    await page.locator('#port-dialog').waitFor({ state: 'visible' });
    await page.locator('#cancel-port').click();
    await page.waitForFunction(() => !document.getElementById('port-dialog').open);
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      window.webContents.emit('select-bluetooth-device', { preventDefault() {} },
        [{ deviceId: 'test-c3', deviceName: 'RC-Limiter-C3' }], id => { global.testBleChoice = id; });
    });
    await page.locator('#ble-dialog').waitFor({ state: 'visible' });
    await page.locator('#ble-list button').click();
    assert.equal(await app.evaluate(() => global.testBleChoice), 'test-c3');
    await page.locator('#firmware-update summary').click();
    await page.waitForFunction(() => !document.getElementById('update-check').disabled);
    assert.equal(await page.locator('#update-flash').isDisabled(), true);
    assert.deepEqual(errors, []);
    console.log('Electron integration passed: board layouts, 15 config fields, Web Serial, serial chooser, BLE device chooser/preload callback and bundled updater initialization. BLE event was simulated; no hardware port or radio connection opened.');
  } finally { await app.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
