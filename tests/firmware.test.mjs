import test from 'node:test';
import assert from 'node:assert/strict';
import { boards, sha256, validateBundle, flashBundle } from '../web/firmware.mjs';
function dataFor(board) {
  const entries = {};
  for (const [name] of boards[board].images) {
    let data;
    if (board === 'pico') {
      data = new Uint8Array(512); const block = new DataView(data.buffer);
      [0x0a324655, 0x9e5d5157, 0x2000, 0x10000000, 256, 0, 1, 0xe48bff56].forEach((n, i) => block.setUint32(i * 4, n, true));
      block.setUint32(508, 0x0ab16f30, true);
    } else if (name === 'partitions.bin') {
      data = new Uint8Array(3 * 32); const view = new DataView(data.buffer);
      [[1, 2, 0x9000, 0x5000], [1, 1, 0xf000, 0x1000], [0, 0, 0x10000, 0x300000]].forEach(([type, subtype, offset, size], i) => {
        const p = i * 32;view.setUint16(p, 0x50aa, true);view.setUint8(p + 2, type);view.setUint8(p + 3, subtype);view.setUint32(p + 4, offset, true);view.setUint32(p + 8, size, true);
      });
    } else { data = new Uint8Array(32);data[0] = 0xe9;data[12] = board === 'esp32' ? 0 : 5; }
    entries[name] = data;
  }
  return entries;
}
async function manifestFor(entries, board) {
  entries['update-manifest.json'] = new TextEncoder().encode(JSON.stringify({ project: 'rc-limit', version: 1, board,
    chip: boards[board].chip, commit: 'a'.repeat(40), images: await Promise.all(boards[board].images.map(async ([file, address]) => ({ file, address, size: entries[file].length, sha256: await sha256(entries[file]) }))) }));
  return entries;
}
test('release bundle validation handles all four boards and rejects a wrong selected variant', async () => {
  for (const board of Object.keys(boards)) {
    const entries = await manifestFor(dataFor(board), board);
    const bundle = await validateBundle(entries, board);assert.equal(bundle.board, board);
    await assert.rejects(validateBundle(entries, board === 'pico' ? 'esp32' : 'pico'), /match/);
  }
});
test('rejects corrupted, missing or misaddressed images before any flash operation', async () => {
  let entries = await manifestFor(dataFor('esp32'), 'esp32');entries['firmware.bin'][1]++;
  await assert.rejects(validateBundle(entries, 'esp32'), /SHA-256/);
  entries = await manifestFor(dataFor('esp32'), 'esp32');delete entries['bootloader.bin'];
  await assert.rejects(validateBundle(entries, 'esp32'), /bootloader/);
  entries = await manifestFor(dataFor('esp32'), 'esp32');const manifest = JSON.parse(new TextDecoder().decode(entries['update-manifest.json']));
  manifest.images[2].address = 0x9000;entries['update-manifest.json'] = new TextEncoder().encode(JSON.stringify(manifest));
  await assert.rejects(validateBundle(entries, 'esp32'), /offset/);
});
test('rejects image-chip mismatch, changed partition map and wrong UF2 family even with matching checksums', async () => {
  let entries = dataFor('esp32c3');entries['firmware.bin'][12] = 0;await manifestFor(entries, 'esp32c3');
  await assert.rejects(validateBundle(entries, 'esp32c3'), /chip header/);
  entries = dataFor('esp32');entries['partitions.bin'][4] = 1;await manifestFor(entries, 'esp32');
  await assert.rejects(validateBundle(entries, 'esp32'), /partition/);
  entries = dataFor('pico');entries['firmware.uf2'][28] = 0;await manifestFor(entries, 'pico');
  await assert.rejects(validateBundle(entries, 'pico'), /RP2040/);
});
test('chip and flash-size checks precede writes; flash writes only listed regions and preserves NVS', async () => {
  const bundle = await validateBundle(await manifestFor(dataFor('esp32c3'), 'esp32c3'), 'esp32c3');
  let written;
  const loader = { chip: { CHIP_NAME: 'ESP32' }, detectFlashSize: async () => '4MB', writeFlash: async options => { written = options; } };
  await assert.rejects(flashBundle(loader, bundle, {}), /Detected/);assert.equal(written, undefined);
  loader.chip.CHIP_NAME = 'ESP32-C3';loader.detectFlashSize = async () => '2MB';
  await assert.rejects(flashBundle(loader, bundle, {}), /4 MB/);assert.equal(written, undefined);
  loader.detectFlashSize = async () => '4MB';
  await assert.rejects(flashBundle(loader, bundle, {}), /verification callback/);assert.equal(written, undefined);
  const md5 = () => 'digest';
  await flashBundle(loader, bundle, { calculateMD5Hash: md5 });
  assert.equal(written.eraseAll, false);assert.equal(written.calculateMD5Hash, md5);
  assert.deepEqual(written.fileArray.map(f => f.address), [0, 0x8000, 0x10000]);
  assert.equal(written.flashMode, 'keep');
  loader.writeFlash = async () => { throw new Error('USB unplugged'); };
  await assert.rejects(flashBundle(loader, bundle, { calculateMD5Hash: md5 }), /USB unplugged/);
});
