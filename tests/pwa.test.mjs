import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { assets } from '../scripts/build-pwa.mjs';
const manifest = JSON.parse(await readFile(new URL('../web/manifest.webmanifest', import.meta.url)));
assert.equal(manifest.scope, './');assert.equal(manifest.start_url, './');assert.equal(manifest.display, 'standalone');
assert(manifest.icons.some(icon => icon.sizes === '192x192'));
assert(manifest.icons.some(icon => icon.sizes === '512x512' && icon.purpose === 'maskable'));
assert(assets.includes('dist/updater.mjs') && assets.includes('i18n/cs.json'));
assert(!assets.some(name => name.startsWith('firmware/')));
const source = (await readFile(new URL('../scripts/service-worker.js', import.meta.url), 'utf8'))
  .replace('__REVISION__', 'test-v2').replace('__ASSETS__', JSON.stringify(['index.html', 'app.mjs']));
const handlers = {}, entries = new Map(), deleted = [];
const scope = 'https://example.test/rc-limit/';
const cacheName = 'rc-limit-pwa:' + scope + ':test-v2';
const caches = {
  async open(name) {assert.equal(name, cacheName);return {
    async addAll(requests) {for (const r of requests) entries.set(r.url, new Response('cached:' + r.url));},
    async match(key) {return entries.get(key)?.clone();},
  };},
  async keys() {return [cacheName, 'rc-limit-pwa:' + scope + ':old', 'rc-limit-pwa:https://example.test/other/:old', 'unrelated'];},
  async delete(key) {deleted.push(key);},
};
let forcedActivation = false;
vm.runInNewContext(source, {URL, Request, caches, fetch: async () => new Response('network'),
  self: {registration: {scope}, skipWaiting() {forcedActivation = true;}, addEventListener(type, fn) {handlers[type] = fn;}}});
async function run(type) {let promise;handlers[type]({waitUntil(value) {promise = value;}});await promise;}
await run('install');assert.equal(entries.size, 2);assert.equal(forcedActivation, false);
await run('activate');assert.deepEqual(deleted, ['rc-limit-pwa:' + scope + ':old']);
async function request(path, mode = 'cors', method = 'GET') {
  let response;handlers.fetch({request: {url: new URL(path, scope).href, mode, method},respondWith(value) {response = value;}});
  return response ? (await response).text() : undefined;
}
assert.equal(await request('./?board=pico', 'navigate'), 'cached:' + scope + 'index.html');
assert.equal(await request('app.mjs'), 'cached:' + scope + 'app.mjs');
for (const path of ['firmware/catalog.json','firmware/stable/rc-limit-pico.zip','missing.js','https://other.test/app.mjs','../other/']) assert.equal(await request(path, 'navigate'), undefined, path);
assert.equal(await request('app.mjs','cors','POST'), undefined);
console.log('PWA manifest, offline shell, scoped cleanup, update lifecycle and fresh firmware routing passed.');
