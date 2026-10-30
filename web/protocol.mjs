export const fields = [
  ['input_pin', 'Receiver input GPIO', 'pins'], ['output_pin', 'ESC output GPIO', 'pins'],
  ['input_min', 'Receiver minimum', 'receiver'], ['input_neutral', 'Receiver neutral', 'receiver'],
  ['input_max', 'Receiver maximum', 'receiver'], ['deadband', 'Neutral deadband', 'receiver'],
  ['output_min', 'ESC minimum', 'esc'], ['output_neutral', 'ESC neutral / stop', 'esc'],
  ['output_max', 'ESC maximum', 'esc'], ['timeout_ms', 'Signal loss timeout (ms)', 'esc'],
  ['forward_percent', 'Forward limit (%)', 'limits'], ['reverse_percent', 'Reverse limit (%)', 'limits'],
  ['bidirectional', 'Throttle mode', 'limits'], ['scale', 'Mapping style', 'limits'],
  ['invert', 'Reverse receiver direction', 'limits'],
];
export const defaults = {
  input_pin: 4, output_pin: 5, input_min: 1000, input_neutral: 1500, input_max: 2000,
  output_min: 1000, output_neutral: 1500, output_max: 2000, forward_percent: 30,
  reverse_percent: 30, bidirectional: 1, scale: 1, invert: 0, deadband: 30, timeout_ms: 100,
};
export function validate(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config) ||
      Object.keys(config).length !== fields.length || fields.some(([k]) => !Number.isInteger(config[k]))) {
    throw new Error('Profile must contain all 15 fields as integers.');
  }
  const c = config;
  for (const prefix of ['input', 'output']) {
    if (!(c[`${prefix}_min`] >= 800 && c[`${prefix}_max`] <= 2200 &&
        c[`${prefix}_min`] < c[`${prefix}_neutral`] && c[`${prefix}_neutral`] < c[`${prefix}_max`])) {
      throw new Error(`${prefix}: minimum < neutral < maximum, within 800–2200 µs.`);
    }
  }
  if (c.input_pin === c.output_pin || c.input_pin < 0 || c.output_pin < 0) throw new Error('Choose two different valid GPIOs.');
  for (const key of ['forward_percent', 'reverse_percent']) {
    if (c[key] < 0 || c[key] > 100) throw new Error('Limits must be 0–100%.');
  }
  if (['bidirectional', 'scale', 'invert'].some(k => c[k] !== 0 && c[k] !== 1)) throw new Error('Mode values must be 0 or 1.');
  if (c.timeout_ms < 40 || c.timeout_ms > 250) throw new Error('Timeout must be 40–250 ms.');
  if (c.deadband < 0 || c.deadband > 100 || c.deadband >= c.input_neutral - c.input_min ||
      c.deadband >= c.input_max - c.input_neutral) throw new Error('Deadband must be 0–100 µs and smaller than both input spans.');
  return c;
}

export const maxMappings = 4;
export function validateMappings(mappings, board) {
  if (!Array.isArray(mappings) || mappings.length < 1 || mappings.length > maxMappings) throw new Error('Use 1–4 pin mappings.');
  const espOutputs = [18, 19, 21, 22, 23, 25, 26, 27, 32, 33];
  const allowed = (pin, output) => board === 'pico' ? (pin >= 0 && pin <= 22) || (pin >= 26 && pin <= 28)
    : board === 'esp32c3' ? [0, 1, 3, 4, 5, 6, 7, 10].includes(pin)
    : board === 'esp32' ? espOutputs.includes(pin) || (!output && [34, 35, 36, 39].includes(pin)) : true;
  mappings.forEach((config, index) => {
    validate(config);
    if (!allowed(config.input_pin, false) || !allowed(config.output_pin, true)) throw new Error(`Mapping ${index + 1}: GPIO is unavailable on ${board}.`);
    mappings.forEach((other, j) => {
      if (config.output_pin === other.input_pin) throw new Error('An output GPIO cannot also be a receiver input.');
      if (index !== j && config.output_pin === other.output_pin) throw new Error('Each mapping needs a unique output GPIO.');
      if (board === 'pico' && index !== j && config.output_pin % 16 === other.output_pin % 16) throw new Error('Pico outputs 16 GPIOs apart share a PWM channel. Choose different outputs.');
    });
  });
  return mappings;
}
export function profile(value, board) {
  if (value?.version === 2 && Object.keys(value).length === 2 && Array.isArray(value.mappings)) {
    return { version: 2, mappings: validateMappings(value.mappings, board) };
  }
  // Upgrade the original single-channel JSON profile without discarding its settings.
  return { version: 2, mappings: validateMappings([validate(value)], board) };
}
export function nextMapping(mappings, board) {
  const pairs = board === 'esp32c3' ? [[3, 4], [5, 6], [0, 1], [7, 10]] : board === 'esp32' ? [[27, 25], [26, 33], [32, 18], [19, 21]] : [[4, 5], [6, 7], [8, 9], [10, 11]];
  for (const [input_pin, output_pin] of pairs) {
    const candidate = { ...defaults, input_pin, output_pin };
    try { validateMappings([...mappings, candidate], board); return candidate; } catch { /* Try the next unused pair. */ }
  }
  throw new Error('No unused suggested pin pair. Adjust existing pins or remove a mapping first.');
}

// Request IDs keep a command response separate from an in-flight telemetry response.
export class Protocol {
  constructor(write, onStatus = () => {}, onFault = () => {}, timeout = 2500) {
    this.write = write; this.onStatus = onStatus; this.onFault = onFault;
    this.timeout = timeout; this.id = 0; this.pending = new Map(); this.buffer = '';
  }
  request(cmd, extra = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        const error = new Error('Board did not respond. Output state is unknown.');
        reject(error); this.onFault(error);
      }, this.timeout);
      this.pending.set(id, { resolve, reject, timer });
      Promise.resolve().then(() => this.write(JSON.stringify({ ...extra, cmd, id }) + '\n')).catch(error => {
        const entry = this.pending.get(id);
        if (entry) { clearTimeout(timer); this.pending.delete(id); reject(error); this.onFault(error); }
      });
    });
  }
  feed(chunk) {
    this.buffer += chunk;
    if (this.buffer.length > 8192) { this.buffer = ''; this.onFault(new Error('Oversized board response')); return; }
    let index;
    while ((index = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, index); this.buffer = this.buffer.slice(index + 1);
      let data;
      try { data = JSON.parse(line); } catch { continue; }
      if (!data || typeof data.ok !== 'boolean') continue;
      this.onStatus(data);
      const entry = this.pending.get(data.id);
      if (entry) {
        clearTimeout(entry.timer); this.pending.delete(data.id);
        if (data.ok) entry.resolve(data);
        else entry.reject(new Error(data.error || 'Board rejected command'));
      }
    }
  }
  close() {
    for (const { reject, timer } of this.pending.values()) { clearTimeout(timer); reject(new Error('Disconnected')); }
    this.pending.clear();
  }
}

export function validateDeviceName(name) {
  if (typeof name !== 'string' || !/^[A-Za-z0-9 ._-]{1,16}$/.test(name) || name.startsWith(' ') || name.endsWith(' '))
    throw new Error('Use 1–16 letters, numbers, spaces, dots, underscores or hyphens, without outer spaces.');
  return name;
}
