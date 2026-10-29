import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { defaults, validateMappings } from '../web/protocol.mjs';
import { dividerVoltage } from '../web/boards.mjs';
import { nus, openBle } from '../web/ble.mjs';

test('all board layouts have complete header rows and conflict-free suggested GPIO pairs', async () => {
  const profiles = JSON.parse(await readFile(new URL('../web/hardware/boards.json', import.meta.url)));
  assert.equal(profiles.length, 4);
  for (const board of profiles) {
    assert.equal(board.left.length, board.right.length);
    assert.equal(board.left.length, board.left_positions.length);
    assert.equal(board.right.length, board.right_positions.length);
    const mappings = board.pairs.map(([input_pin, output_pin]) => ({ ...defaults, input_pin, output_pin }));
    assert.equal(validateMappings(mappings, board.firmware).length, 4);
    for (const [input, output] of board.pairs) {
      assert.equal(board.avoid.includes(input) || board.avoid.includes(output), false);
      const pins = [...board.left, ...board.right];
      assert(pins.includes(`GPIO${input}`) || pins.includes(`GP${input}`));
      assert(pins.includes(`GPIO${output}`) || pins.includes(`GP${output}`));
    }
  }
  for (const pin of [2, 8, 9, 18, 19, 20, 21, 25, 27, 34]) {
    assert.throws(() => validateMappings([{ ...defaults, input_pin: pin, output_pin: 4 }], 'esp32c3'));
  }
});
test('4.7k/6.8k divider margins for a confirmed 4.5–5.5V pulse and 1% resistors', () => {
  assert(Math.abs(dividerVoltage(5) - 2.956521739) < 0.000001);
  const worstLow = dividerVoltage(4.5, 4700 * 1.01, 6800 * 0.99);
  const worstHigh = dividerVoltage(5.5, 4700 * 0.99, 6800 * 1.01);
  assert(worstLow > 0.75 * 3.3); // C3 guaranteed VIH at nominal 3.3V supply.
  assert(worstHigh < 3.3);
  assert(dividerVoltage(3.3) < 0.75 * 3.3); // Do not divide an already 3.3V signal.
});
test('BLE UART serializes concurrent writes into acknowledged 20-byte chunks and forwards fragments', async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const chunks = []; const incoming = []; let lost = 0;
  const tx = new EventTarget(); tx.startNotifications = async () => tx;
  const rx = { async writeValueWithResponse(bytes) { chunks.push(new Uint8Array(bytes)); await Promise.resolve(); } };
  const device = new EventTarget(); device.name = 'RC-Limiter-C3';
  device.gatt = { connected: true,
    async connect() { return this; },
    async getPrimaryService(uuid) { assert.equal(uuid, nus.service); return { async getCharacteristic(id) { return id === nus.rx ? rx : tx; } }; },
    disconnect() { this.connected = false; device.dispatchEvent(new Event('gattserverdisconnected')); },
  };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { bluetooth: {
    async requestDevice(options) { assert.deepEqual(options, { filters: [{ services: [nus.service] }] }); return device; },
  } } });
  try {
    const link = await openBle(text => incoming.push(text), () => lost++);
    const first = new TextEncoder().encode(JSON.stringify({ cmd: 'set_mappings', mappings: Array(4).fill(defaults) }) + '\n');
    const second = new TextEncoder().encode('{"cmd":"disarm"}\n');
    await Promise.all([link.write(first), link.write(second)]);
    assert(chunks.every(chunk => chunk.length <= 20));
    assert.equal(new TextDecoder().decode(Buffer.concat(chunks)), new TextDecoder().decode(first) + new TextDecoder().decode(second));
    for (const part of ['{"ok":', 'true}\n']) {
      const bytes = new TextEncoder().encode(part); tx.value = new DataView(bytes.buffer); tx.dispatchEvent(new Event('characteristicvaluechanged'));
    }
    assert.equal(incoming.join(''), '{"ok":true}\n');
    link.close(); assert.equal(lost, 0);
  } finally {
    if (original) Object.defineProperty(globalThis, 'navigator', original); else delete globalThis.navigator;
  }
});
