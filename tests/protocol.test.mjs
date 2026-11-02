import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Protocol, calibrateRadio, RadioCalibrations, validateDeviceName, defaults, validate, validateMappings, profile, nextMapping } from '../web/protocol.mjs';

test('multiple mappings validate pins, fan-out, unique outputs and Pico PWM aliases', () => {
  const first = { ...defaults };
  const second = { ...defaults, input_pin: 6, output_pin: 7 };
  assert.equal(validateMappings([first, second], 'pico').length, 2);
  assert.equal(validateMappings([first, { ...second, input_pin: 4 }], 'pico').length, 2);
  assert.equal(validateMappings([{ ...first, input_pin: 6, output_pin: 4 }, { ...second, input_pin: 7, output_pin: 5 }], 'pico').length, 2);
  for (const invalid of [[], Array(5).fill(first), [first, { ...second, output_pin: 5 }],
    [first, { ...second, output_pin: 4 }], [first, { ...second, output_pin: 21 }]]) {
    assert.throws(() => validateMappings(invalid, 'pico'));
  }
  assert.throws(() => validateMappings([{ ...first, input_pin: 25 }], 'pico'));
  assert.throws(() => validateMappings([{ ...first, input_pin: 27, output_pin: 34 }], 'esp32'));
  assert.equal(validateMappings([{ ...first, input_pin: 34, output_pin: 25 }], 'esp32').length, 1);
  assert.deepEqual(nextMapping([first], 'pico'), second);
  assert.throws(() => nextMapping([first, second, { ...first, input_pin: 8, output_pin: 9 }, { ...first, input_pin: 10, output_pin: 11 }], 'pico'));
});
test('version 2 profiles round-trip and original single-channel profiles migrate', () => {
  assert.deepEqual(profile(defaults), { version: 2, mappings: [defaults] });
  const value = { version: 2, mappings: [defaults, { ...defaults, input_pin: 6, output_pin: 7 }] };
  assert.deepEqual(profile(JSON.parse(JSON.stringify(value)), 'pico'), value);
  assert.throws(() => profile({ ...value, extra: true }));
  assert.throws(() => profile({ version: 3, mappings: value.mappings }));
});

test('bidirectional defaults, calibration and profile validation', () => {
  assert.equal(defaults.bidirectional, 1);
  assert.equal(validate(defaults), defaults);
  for (const invalid of [{}, null, [], { ...defaults, input_min: 1500 },
    { ...defaults, forward_percent: 101 }, { ...defaults, timeout_ms: 0 },
    { ...defaults, invert: true }, { ...defaults, extra: 1 },
    { ...defaults, deadband: 500 }, { ...defaults, output_pin: defaults.input_pin }]) {
    assert.throws(() => validate(invalid));
  }
});
test('fragmented serial frames and boot banners', async () => {
  let sent;
  const p = new Protocol(text => { sent = JSON.parse(text); });
  const result = p.request('get');
  await Promise.resolve(); await Promise.resolve();
  assert.equal(sent.cmd, 'get');
  p.feed('booting\r\n{"ok":tr');
  p.feed(`ue,"id":${sent.id},"armed":false}\n`);
  assert.equal((await result).armed, false); p.close();
});
test('DISARM and telemetry responses are matched by ID, even out of order', async () => {
  const sent = [];
  const p = new Protocol(text => sent.push(JSON.parse(text)));
  const get = p.request('get'); const stop = p.request('disarm');
  await Promise.resolve(); await Promise.resolve();
  p.feed(JSON.stringify({ id: sent[1].id, ok: true, armed: false }) + '\n');
  assert.equal((await stop).armed, false);
  assert.equal(p.pending.size, 1);
  p.feed(JSON.stringify({ id: sent[0].id, ok: true, armed: true }) + '\n');
  assert.equal((await get).armed, true); p.close();
});
test('rejections, timeouts and transport failure reach callers', async () => {
  let sent; let fault;
  const p = new Protocol(text => { sent = JSON.parse(text); }, () => {}, error => { fault = error; }, 20);
  const refused = p.request('arm');
  const rejection = assert.rejects(refused, /hold_neutral_for_1s/);
  await Promise.resolve(); await Promise.resolve();
  p.feed(JSON.stringify({ id: sent.id, ok: false, error: 'hold_neutral_for_1s' }) + '\n');
  await rejection;
  await assert.rejects(p.request('get'), /did not respond/);
  assert.match(fault.message, /unknown/);
  const failed = new Protocol(() => { throw new Error('USB unplugged'); });
  await assert.rejects(failed.request('get'), /unplugged/);
  p.close(); failed.close();
});
test('disconnect rejects requests and oversize frames trigger fault', async () => {
  let fault;
  const p = new Protocol(() => {}, () => {}, error => { fault = error; });
  const request = p.request('get'); const rejected = assert.rejects(request, /Disconnected/);
  p.close(); await rejected;
  p.feed('x'.repeat(8193)); assert.match(fault.message, /Oversized/);
});

test('device names validate consistently without changing profile contents', () => {
  for(const name of ['Boat port ESC','Boat-starboard','A','A.B_C-1234567890']) assert.equal(validateDeviceName(name),name);
  for(const name of ['', ' leading','trailing ','12345678901234567','Boat\nESC','Boat/ESC','Böt', null]) assert.throws(()=>validateDeviceName(name));
  assert.deepEqual(Object.keys(profile({version:2,mappings:[defaults]})).sort(),['mappings','version']);
});

test('radio captures validate all three positions and detect reversed throttle', () => {
  for (const reversed of [false, true]) {
    const calibrated = calibrateRadio(defaults, { forward: reversed ? 1050 : 1950, backward: reversed ? 1950 : 1050, neutral: 1480 });
    assert.equal(calibrated.input_min, 1050);
    assert.equal(calibrated.input_max, 1950);
    assert.equal(calibrated.input_neutral, 1480);
    assert.equal(calibrated.invert, Number(reversed));
    assert.equal(calibrated.output_neutral, defaults.output_neutral);
  }
  for (const samples of [{ forward: 2000, backward: 1000 }, { forward: 2000, backward: 2000, neutral: 1500 },
    { forward: 2000, backward: 1000, neutral: 2100 }, { forward: 2300, backward: 1000, neutral: 1500 },
    { forward: 2000, backward: 1490, neutral: 1500 }]) assert.throws(() => calibrateRadio(defaults, samples));
});

test('calibration completion is persisted per board and receiver settings', () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  const records = new RadioCalibrations(storage);
  assert.equal(records.has('pico:one', defaults), false);
  records.set('pico:one', defaults);
  const restored = new RadioCalibrations(storage);
  assert.equal(restored.has('pico:one', defaults), true);
  assert.equal(restored.has('pico:two', defaults), false);
  for (const key of ['input_pin', 'input_min', 'input_neutral', 'input_max', 'invert', 'bidirectional', 'deadband'])
    assert.equal(restored.has('pico:one', { ...defaults, [key]: defaults[key] + 1 }), false);
  assert.equal(restored.has('pico:one', { ...defaults, output_pin: 7, forward_percent: 10 }), true);
  restored.set('pico:one', defaults, false);
  assert.equal(new RadioCalibrations(storage).has('pico:one', defaults), false);
  const unavailable = new RadioCalibrations({ getItem() { throw Error(); }, setItem() { throw Error(); } });
  unavailable.set('pico:one', defaults);
  assert.equal(unavailable.has('pico:one', defaults), true);
  assert.equal(new RadioCalibrations({ getItem: () => '{}' }).has('pico:one', defaults), false);
});

test('required capture supports a forward-only radio with endpoint stop', () => {
  const c = calibrateRadio({ ...defaults, bidirectional: 0 }, { forward: 2000, backward: 1000, neutral: 1010 });
  assert.equal(c.input_neutral, 1500);
  assert.equal(c.input_min, 1000);
  assert.throws(() => calibrateRadio({ ...defaults, bidirectional: 0 }, { forward: 2000, backward: 1000, neutral: 1500 }));
});
