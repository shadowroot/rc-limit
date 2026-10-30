import { readFile, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';
await build({ entryPoints: ['web/updater.mjs'], outfile: 'web/dist/updater.mjs', bundle: true,
  format: 'esm', platform: 'browser', target: 'es2022', minify: true, legalComments: 'external' });
console.log('Built local firmware updater bundle.');

const licenses = [];
for (const [name, file] of [['esptool-js', 'LICENSE'], ['pako', 'LICENSE'], ['atob-lite', 'LICENSE.md'], ['fflate', 'LICENSE'], ['spark-md5', 'LICENSE']]) {
  const metadata = JSON.parse(await readFile(`node_modules/${name}/package.json`, 'utf8'));
  licenses.push(`${name} ${metadata.version}\n${await readFile(`node_modules/${name}/${file}`, 'utf8')}`);
}
await writeFile('web/dist/third-party-licenses.txt', licenses.join('\n\n'));

const { buildPwa } = await import('./build-pwa.mjs');
await buildPwa();
