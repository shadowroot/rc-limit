import { sha256 } from './firmware.mjs';
export function validateCatalog(catalog, channel = 'stable') {
  if (!['stable', 'development'].includes(channel)) throw new Error('Invalid firmware channel.');
  if (catalog?.version !== 1 || !Array.isArray(catalog.boards)) throw new Error('Invalid firmware catalog.');
  if (catalog.release === null && catalog.boards.length === 0) return catalog;
  if (!catalog.release || typeof catalog.release.tag !== 'string' || catalog.boards.length !== 4) throw new Error('Incomplete firmware catalog.');
  const expected = new Set(['pico', 'esp32', 'esp32c3', 'esp32c3-devkit']);
  for (const item of catalog.boards) {
    if (!expected.delete(item.board) || item.file !== `${channel}/rc-limit-${item.board}.zip` ||
        !/^[a-f0-9]{64}$/.test(item.sha256) || !Number.isSafeInteger(item.size) || item.size < 1 || item.size > 6 * 1024 * 1024)
      throw new Error('Invalid firmware package.');
  }
  return catalog;
}
export async function fetchStablePackage(item, base, request = fetch) {
  const response = await request(new URL(item.file, base), { cache: 'no-store' });
  if (!response.ok) throw new Error('Bundled firmware could not be loaded.');
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length !== item.size || await sha256(bytes) !== item.sha256) throw new Error('Bundled firmware checksum mismatch.');
  return bytes;
}
