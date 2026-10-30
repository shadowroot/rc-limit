import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
// Keep the application shell available offline, including the lazy updater.
// Stable firmware is deliberately excluded: releases must be fetched fresh.
export const assets = ['index.html', 'style.css', 'app.mjs', 'pwa.mjs', 'protocol.mjs',
  'ble.mjs', 'boards.mjs', 'hardware/boards.json', 'i18n.mjs', 'i18n/cs.json',
  'firmware.mjs', 'stable.mjs', 'dist/updater.mjs', 'dist/updater.mjs.LEGAL.txt',
  'dist/third-party-licenses.txt', 'manifest.webmanifest', 'icons/icon.svg',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png'];
export async function buildPwa() {
  const template = await readFile(new URL('./service-worker.js', import.meta.url), 'utf8');
  const hash = createHash('sha256').update(template);
  for (const name of assets) hash.update(name).update(await readFile(new URL('../web/' + name, import.meta.url)));
  const revision = hash.digest('hex').slice(0, 24);
  const worker = template.replace('__REVISION__', revision).replace('__ASSETS__', JSON.stringify(assets));
  await writeFile(new URL('../web/sw.js', import.meta.url), worker);
  console.log('Built offline PWA shell ' + revision + '.');
}
