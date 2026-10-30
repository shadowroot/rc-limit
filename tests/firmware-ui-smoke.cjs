// Optional browser integration. Uses real build ZIPs and a cancelled mock USB chooser.
const { chromium } = require('playwright');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const webRoot = process.env.RC_LIMIT_WEB_ROOT || path.join(root, 'web');
async function main() {
  const server = http.createServer(async (req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (!pathname.startsWith('/rc-limit/')) { res.writeHead(404).end();return; }
    const name = pathname.slice('/rc-limit/'.length) || 'index.html';
    if (!/^(?:[\w-]+\.(?:html|css|mjs)|dist\/[\w.-]+|hardware\/boards.json|i18n\/cs.json|firmware\/catalog.json|firmware\/stable\/rc-limit-[\w-]+\.zip)$/.test(name)) { res.writeHead(404).end();return; }
    try {
      res.setHeader('Content-Type', name.endsWith('.zip') ? 'application/zip' : name.endsWith('.mjs') ? 'text/javascript' : name.endsWith('.json') ? 'application/json' : name.endsWith('.css') ? 'text/css' : 'text/html');
      res.end(await fs.readFile(path.join(webRoot, name)));
    } catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage();page.setDefaultTimeout(15000); const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      window.updatePortRequests = 0;
      Object.defineProperty(navigator, 'serial', { configurable: true, value: { async requestPort() {
        window.updatePortRequests++;throw new DOMException('USB chooser cancelled', 'NotFoundError');
      } } });
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/rc-limit/`);
    await page.locator('#firmware-update summary').click();
    await page.waitForFunction(() => !document.getElementById('update-check').disabled);
    await page.locator('#update-board').selectOption('esp32c3');
    if (process.env.RC_LIMIT_EXPECT_STABLE === '1') {
      await page.waitForFunction(() => document.getElementById('stable-firmware-status').textContent.includes('test-stable-fixture'));
      await page.locator('#stable-firmware-use').click();
      await page.waitForFunction(() => document.getElementById('update-status').textContent.includes('Verified esp32c3'));
      const [stableDownload] = await Promise.all([page.waitForEvent('download'), page.locator('#stable-firmware-download').click()]);
      assert.equal(stableDownload.suggestedFilename(), 'rc-limit-esp32c3.zip');
      assert.equal(await page.locator('#update-flash').isDisabled(), true);
    }
    await page.locator('#update-file').setInputFiles(path.join(root, 'build/releases/rc-limit-esp32c3.zip'));
    await page.locator('#update-check').click();
    await page.waitForFunction(() => document.getElementById('update-status').textContent.includes('Verified esp32c3'));
    assert.equal(await page.locator('#update-flash').isDisabled(), true);
    await page.locator('#update-ack').check();assert.equal(await page.locator('#update-flash').isEnabled(), true);
    await page.locator('#update-flash').click();
    await page.waitForFunction(() => document.getElementById('update-status').textContent.includes('USB chooser cancelled'));
    assert.equal(await page.evaluate(() => window.updatePortRequests), 1);
    assert.equal(await page.locator('#connect').isEnabled(), true);
    await page.locator('#update-board').selectOption('pico');await page.locator('#update-check').click();
    await page.waitForFunction(() => document.getElementById('update-status').textContent.includes('does not match'));
    assert.equal(await page.locator('#update-flash').isDisabled(), true);
    await page.locator('#update-file').setInputFiles(path.join(root, 'build/releases/rc-limit-pico.zip'));
    await page.locator('#update-check').click();
    await page.waitForFunction(() => document.getElementById('update-status').textContent.includes('Verified pico'));
    assert.equal(await page.locator('#update-uf2').isEnabled(), true);
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#update-uf2').click()]);
    assert.equal(download.suggestedFilename(), 'rc-limit-pico.uf2');
    assert.equal(await page.evaluate(() => window.updatePortRequests), 1);
    assert.deepEqual(errors, []);
    await page.locator('#firmware-update').screenshot({ path: path.join(root, 'build/firmware-update-preview.png') });
    console.log('Updater UI passed under /rc-limit/: real ZIP validation, consent gate, cancelled mock USB chooser, recovery and Pico UF2 export. No hardware accessed.');
  } finally { await browser?.close();await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error);process.exitCode = 1; });
