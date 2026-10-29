// Release-bundle validation is shared by the UI and hardware-free tests.
export const boards = Object.freeze({
  pico: { chip: 'rp2040', images: [['firmware.uf2', null, 2 * 1024 * 1024]] },
  esp32: { chip: 'ESP32', images: [['bootloader.bin', 0x1000, 0x7000], ['partitions.bin', 0x8000, 0x1000], ['firmware.bin', 0x10000, 0x300000]] },
  esp32c3: { chip: 'ESP32-C3', images: [['bootloader.bin', 0, 0x8000], ['partitions.bin', 0x8000, 0x1000], ['firmware.bin', 0x10000, 0x300000]] },
  'esp32c3-devkit': { chip: 'ESP32-C3', images: [['bootloader.bin', 0, 0x8000], ['partitions.bin', 0x8000, 0x1000], ['firmware.bin', 0x10000, 0x300000]] },
});
export async function sha256(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join('');
}
export function validateUf2(bytes) {
  if (!bytes.length || bytes.length % 512) throw new Error('Invalid UF2 block length.');
  const count = bytes.length / 512;
  for (let i = 0; i < count; i++) {
    const block = new DataView(bytes.buffer, bytes.byteOffset + i * 512, 512);
    const address = block.getUint32(12, true), size = block.getUint32(16, true);
    if (block.getUint32(0, true) !== 0x0a324655 || block.getUint32(4, true) !== 0x9e5d5157 ||
        block.getUint32(508, true) !== 0x0ab16f30 || block.getUint32(8, true) !== 0x2000 ||
        block.getUint32(28, true) !== 0xe48bff56 || block.getUint32(20, true) !== i ||
        block.getUint32(24, true) !== count || size !== 256 ||
        address !== 0x10000000 + i * 256 || address + size > 0x10200000)
      throw new Error('Expected sequential RP2040 flash UF2 blocks.');
  }
}
function validatePartitions(bytes) {
  const expected = [[1, 2, 0x9000, 0x5000], [1, 1, 0xf000, 0x1000], [0, 0, 0x10000, 0x300000]];
  const found = [];
  for (let pos = 0; pos + 32 <= bytes.length; pos += 32) {
    const entry = new DataView(bytes.buffer, bytes.byteOffset + pos, 32);
    if (entry.getUint16(0, true) !== 0x50aa) break;
    found.push([entry.getUint8(2), entry.getUint8(3), entry.getUint32(4, true), entry.getUint32(8, true)]);
  }
  if (JSON.stringify(found) !== JSON.stringify(expected)) throw new Error('Unsupported partition layout; use the CLI migration instructions.');
}
export async function validateBundle(entries, board) {
  const target = boards[board];
  if (!target) throw new Error('Choose a supported board.');
  const raw = entries['update-manifest.json'];
  if (!raw || raw.length > 65536) throw new Error('Update manifest missing. Use a new RC Limit release ZIP.');
  const manifest = JSON.parse(new TextDecoder().decode(raw));
  if (manifest.project !== 'rc-limit' || manifest.version !== 1 || manifest.board !== board ||
      manifest.chip !== target.chip || !/^[a-f0-9]{40}$/.test(manifest.commit) ||
      !Array.isArray(manifest.images) || manifest.images.length !== target.images.length)
    throw new Error('Bundle does not match the selected board or update format.');
  const images = [];
  for (let i = 0; i < target.images.length; i++) {
    const [file, address, maxSize] = target.images[i], image = manifest.images[i], bytes = entries[file];
    if (!image || image.file !== file || image.address !== address || !bytes?.length || bytes.length > maxSize ||
        image.size !== bytes.length || !/^[a-f0-9]{64}$/.test(image.sha256) || await sha256(bytes) !== image.sha256)
      throw new Error(`Invalid size, offset or SHA-256 for ${file}.`);
    if (board === 'pico') validateUf2(bytes);
    else if (file === 'partitions.bin') validatePartitions(bytes);
    else {
      const chipId = target.chip === 'ESP32' ? 0 : 5;
      if (bytes.length < 24 || bytes[0] !== 0xe9 || bytes[12] !== chipId || bytes[13] !== 0)
        throw new Error(`Wrong Espressif image/chip header in ${file}.`);
    }
    images.push({ data: bytes, address, file });
  }
  return { board, chip: target.chip, commit: manifest.commit, images };
}
export async function flashBundle(loader, bundle, { reportProgress, calculateMD5Hash }) {
  if (bundle.board === 'pico') throw new Error('Pico uses BOOTSEL UF2 copy.');
  if (loader.chip.CHIP_NAME !== bundle.chip) throw new Error(`Detected ${loader.chip.CHIP_NAME}; expected ${bundle.chip}. Nothing written.`);
  const flashSize = await loader.detectFlashSize();
  if (flashSize !== '4MB') throw new Error(`Expected a 4 MB board; detected ${flashSize}. Nothing written.`);
  if (typeof calculateMD5Hash !== 'function') throw new Error('Flash verification callback is required.');
  await loader.writeFlash({ fileArray: bundle.images.map(({ data, address }) => ({ data, address })),
    flashMode: 'keep', flashFreq: 'keep', flashSize: 'keep', eraseAll: false, compress: true,
    reportProgress, calculateMD5Hash });
}
