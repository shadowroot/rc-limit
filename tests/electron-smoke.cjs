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
    assert.equal(await page.locator('#config-form input, #config-form select').count(), 15);
    assert.equal(await page.evaluate(() => !!navigator.serial && !!window.desktopSerial), true);
    await page.locator('a[href="#pins"]').click();
    await page.locator('#connect').click();
    await page.locator('#port-dialog').waitFor({ state: 'visible' });
    await page.locator('#cancel-port').click();
    await page.waitForFunction(() => !document.getElementById('port-dialog').open);
    assert.deepEqual(errors, []);
    console.log('Electron integration passed: page load, 15 fields, Web Serial, preload bridge, chooser after anchor navigation, cancel. No hardware port was opened.');
  } finally { await app.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
