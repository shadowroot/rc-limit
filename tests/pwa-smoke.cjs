// Optional: NODE_PATH=<playwright>/node_modules node tests/pwa-smoke.cjs
// Uses the actual packaged ZIP, a local HTTPS-equivalent origin, and no hardware.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
async function main() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'rc-limit-pwa-'));
  execFileSync('python3', ['-m','zipfile','-e',path.join(root,'downloads/rc-limit-web.zip'),directory]);
  let revision = 1;
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/probe.html') {res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Probe</title>');return;}
    if (!url.pathname.startsWith('/rc-limit/')) {res.writeHead(404).end();return;}
    const name = url.pathname.slice('/rc-limit/'.length) || 'index.html';
    if (name.includes('..')) {res.writeHead(404).end();return;}
    try {
      let data = await fs.readFile(path.join(directory, 'web', name));
      if (revision === 2 && name === 'sw.js') data = Buffer.from(data.toString().replace(/PREFIX \+ '[a-f0-9]+'/, "PREFIX + 'test-v2'"));
      if (revision === 2 && name === 'index.html') data = Buffer.from(data.toString().replace('<body>', '<body data-version="2">'));
      res.setHeader('Cache-Control','no-store');
      res.setHeader('Content-Type', /\.(m?js)$/.test(name) ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : name.endsWith('.png') ? 'image/png' : name.endsWith('.svg') ? 'image/svg+xml' : /\.(json|webmanifest)$/.test(name) ? 'application/json' : 'text/html');
      res.end(data);
    } catch {res.writeHead(404).end();}
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  let browser;
  try {
    browser = await chromium.launchPersistentContext(path.join(directory,'profile'), {executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium',headless:true,args:['--no-sandbox']});
    const context = browser;await Promise.all(context.pages().map(page=>page.close()));const page = await context.newPage();const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    const address = `http://127.0.0.1:${server.address().port}/rc-limit/`;
    await page.goto(address);await page.waitForSelector('#bidirectional');
    await page.evaluate(()=>navigator.serviceWorker.ready);
    const client = await context.newCDPSession(page);
    const {manifest,errors:manifestErrors} = await client.send('Page.getAppManifest');
    assert.deepEqual(manifestErrors,[]);assert.equal(manifest.scope,address);
    const installability = await client.send('Page.getInstallabilityErrors');
    assert.deepEqual(installability.installabilityErrors,[]);
    await page.reload();await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
    await page.locator('#language-select').selectOption('cs');
    // The packaged source and built lazy updater must both work without networking.
    await context.setOffline(true);await page.reload();await page.waitForSelector('#bidirectional');
    assert.equal(await page.locator('#language-select').inputValue(),'cs');
    assert.equal(await page.locator('#install-app').textContent(),'Nainstalovat aplikaci');
    assert.equal(await page.locator('#board-layout option').count(),4);
    await page.locator('#firmware-update summary').click();
    await page.waitForFunction(()=>!document.getElementById('update-check').disabled);
    assert.equal(await page.evaluate(()=>fetch('firmware/catalog.json').then(()=>true,()=>false)),false);
    await page.locator('#language-select').selectOption('en');
    await context.setOffline(false);revision=2;
    await page.evaluate(async()=>{await (await navigator.serviceWorker.getRegistration()).update();});
    await page.waitForFunction(async()=>!!(await navigator.serviceWorker.getRegistration()).waiting);
    await page.waitForFunction(()=>document.getElementById('pwa-status').textContent.includes('close all app windows'));
    assert.match(await page.locator('#pwa-status').textContent(),/close all app windows/i);
    assert.equal(await page.evaluate(()=>document.body.dataset.version),undefined);
    await page.reload();await page.waitForSelector('#bidirectional');
    assert.equal(await page.evaluate(()=>document.body.dataset.version),undefined); // waiting worker cannot mix app versions
    await page.close();
    // With all clients closed, the default worker lifecycle can activate the update.
    const next = await context.newPage();
    await next.goto(new URL('/probe.html',address).href);
    await next.waitForFunction(async address=>{
      const registration = await navigator.serviceWorker.getRegistration(address);
      return registration && !registration.waiting && !registration.installing && registration.active?.state === 'activated';
    },address);
    await next.goto(address);await next.waitForSelector('#bidirectional');
    assert.equal(await next.evaluate(()=>document.body.dataset.version),'2');
    assert.deepEqual(errors,[]);
    console.log('PWA ZIP passed: Chromium installability, /rc-limit/ scope, offline Czech UI/boards/updater, uncached firmware, waiting updates and activation after closing clients. No hardware accessed.');
  } finally {await browser?.close();await new Promise(resolve=>server.close(resolve));await fs.rm(directory,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
