/* Generated into web/sw.js by build-web.mjs. Never activate a new shell mid-session. */
const PREFIX = 'rc-limit-pwa:' + self.registration.scope + ':';
const CACHE = PREFIX + '__REVISION__';
const ASSETS = __ASSETS__;
const absolute = name => new URL(name, self.registration.scope).href;
const shell = new Set(ASSETS.map(absolute));
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(ASSETS.map(name => new Request(absolute(name), {cache: 'reload'})));
    // The default waiting lifecycle keeps existing serial/flash sessions intact.
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith(PREFIX) && key !== CACHE).map(key => caches.delete(key)));
  })());
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  const root = new URL(self.registration.scope);
  if (url.origin !== root.origin) return;
  let key = url.href;
  if (event.request.mode === 'navigate' && (url.pathname === root.pathname || url.pathname === root.pathname + 'index.html')) key = absolute('index.html');
  // Firmware catalogs/ZIPs and external requests always use the network. Never
  // replace a newly published firmware with an old cached release or HTML shell.
  if (!shell.has(key)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    return (await cache.match(key)) || fetch(event.request);
  })());
});
