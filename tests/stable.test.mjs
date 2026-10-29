import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCatalog, fetchStablePackage } from '../web/stable.mjs';
import { sha256 } from '../web/firmware.mjs';
test('stable catalog handles no release and rejects missing boards/unsafe paths', () => {
  assert.equal(validateCatalog({version:1,release:null,boards:[]}).release,null);
  const boards = ['pico','esp32','esp32c3','esp32c3-devkit'].map(board=>({board,file:`stable/rc-limit-${board}.zip`,size:1,sha256:'a'.repeat(64)}));
  const catalog = {version:1,release:{tag:'v1.0.0'},boards};
  assert.equal(validateCatalog(catalog).release.tag,'v1.0.0');
  assert.throws(()=>validateCatalog({...catalog,boards:boards.slice(1)}));
  assert.throws(()=>validateCatalog({...catalog,boards:[{...boards[0],file:'../../bad.zip'},...boards.slice(1)]}));
});
test('bundled downloads resolve under the static subpath and verify checksums', async () => {
  const bytes = new Uint8Array([1,2,3]);
  const item = {file:'stable/rc-limit-pico.zip',size:3,sha256:await sha256(bytes)};
  let requested;
  const request = async url=>{requested=url.href;return {ok:true,arrayBuffer:async()=>bytes.buffer};};
  await fetchStablePackage(item,'https://example.test/rc-limit/firmware/catalog.json',request);
  assert.equal(requested,'https://example.test/rc-limit/firmware/stable/rc-limit-pico.zip');
  await assert.rejects(fetchStablePackage({...item,sha256:'0'.repeat(64)},'https://example.test/',request),/checksum/);
});
