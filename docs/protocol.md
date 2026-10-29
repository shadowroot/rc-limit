# Serial protocol and mappings

USB serial on both Pico and original ESP32 DevKit, and ESP32 Bluetooth Classic SPP, use the same version 2 newline-delimited JSON commands. Use **115200, 8N1** for the ESP32 USB-to-UART bridge; USB CDC and Bluetooth baud are abstractions. Pico uses native USB CDC. ESP32 Bluetooth starts automatically as **RC-Limiter**, alongside USB.

Use one JSON object per line, maximum **3071 bytes** excluding the newline. Overlong lines are discarded through their newline and an error response follows. Each transport has an independent line buffer. Replies go to the transport carrying the command. There is no unsolicited telemetry; poll `get` at 2–4 Hz, waiting for the preceding reply. Four-channel replies are larger and can reduce achievable polling rate over USB UART. Use one controller at a time.

```json
{"cmd":"get","id":1}
{"cmd":"disarm","id":2}
{"cmd":"arm","id":3}
{"cmd":"save","id":4}
```

Every reply includes `ok`, echoed integer `id` (0 when omitted/unparseable), `board`, `protocol_version: 2`, `max_mappings: 4`, `armed`, `signal_ok`, `revision`, `saved`, `mappings`, `channel_states`, and `transports`. Errors add `error`. Match replies by ID.

- `mappings`: one to four complete channel configurations.
- `channel_states`: matching entries containing `input_us`, `output_us`, `signal_ok` and `armed` for each mapping.
- Top-level `armed` describes all outputs; top-level `signal_ok` is true only when all mapped inputs are healthy.
- For legacy inspection, top-level `input_us`, `output_us` and `config` describe mapping 1 only.
- `transports`: `usb_serial: true`, plus `bluetooth_serial` equal to the actual SPP startup result. If enabled, `bluetooth_name` is `RC-Limiter`. Pico reports Bluetooth false. A false result on ESP32 indicates Bluetooth initialization failed; USB remains available. These fields describe capabilities, not which connection carried the command.

`get` reads state. `disarm` clears all arming and neutral dwell and requests each stop pulse. `arm` succeeds atomically only when **every input** is healthy and all inputs have remained at their own neutral for one second. Losing any mapped input stops and disarms all outputs; restoration never rearms. `save` writes all active mappings to flash, not edits still in a GUI form.

`set_mappings` replaces the complete array while disarmed. All fields and cross-mapping pin constraints are validated before hardware changes. This valid example configures one Pico mapping; include additional full objects to configure more:

```json
{"cmd":"set_mappings","id":5,"mappings":[{"input_pin":4,"output_pin":5,"input_min":1000,"input_neutral":1500,"input_max":2000,"output_min":1000,"output_neutral":1500,"output_max":2000,"forward_percent":30,"reverse_percent":30,"bidirectional":1,"scale":1,"invert":0,"deadband":30,"timeout_ms":100}]}
```

Profiles export as `{"version":2,"mappings":[...]}` with exactly those two root fields. Each mapping has exactly the following 15 integer fields. [Example profiles](../examples/) include two-channel Pico, two-channel ESP32, and shared-input fan-out configurations. Review GPIOs when moving profiles between boards.

## Compatibility and saved settings

The apps import an original bare 15-field channel profile as a one-entry array. Firmware reads legacy magic/checksum records as one mapping and writes the new versioned format on the next explicit Save. Verify the recovered pins, calibration and limits after upgrading before connecting motor power.

Legacy `{"cmd":"set","config":{...}}` is accepted only when the live board has exactly one mapping. With multiple mappings it returns `use_set_mappings`, preserving the other channels. Old clients can inspect mapping 1 and issue board-wide arm/disarm/save, but cannot edit multiple mappings. New apps can read old firmware and edit one channel with legacy `set`; firmware version 2 is required to apply multiple mappings.

## Channel fields

| Field | Meaning / accepted values |
|---|---|
| `input_pin`, `output_pin` | Distinct GPIOs from the board allowlist below |
| `input_min`, `input_neutral`, `input_max` | Receiver pulse calibration in µs, strictly increasing, within 800–2200 |
| `output_min`, `output_neutral`, `output_max` | ESC pulse calibration in µs, same ordering/range |
| `forward_percent`, `reverse_percent` | Independent 0–100 command limits; reverse used only in bidirectional mode |
| `bidirectional` | 1: stop at output neutral, 0: forward-only stop at output minimum |
| `scale` | 1: scale each side's entire travel into the limited excursion, 0: clamp the calibrated command at that excursion |
| `invert` | 1: reverse input direction, 0: normal. Does not change the ESC's configured stop pulse |
| `deadband` | 0–100 µs around receiver neutral, smaller than either receiver calibration half-span |
| `timeout_ms` | 40–250 ms since the last completed receiver pulse; default 100 |

Pico input/output allowlist: **GP0–GP22, GP26–GP28**. ESP32 output/input allowlist: **18,19,21,22,23,25,26,27,32,33**; extra input-only pins: **34,35,36,39**. ESP32 flash, UART programming, boot strapping and unavailable GPIOs are deliberately excluded. Both assigned pins must support their assigned direction; they cannot be the same GPIO. Match your module schematic even when a GPIO is allowlisted.

Inputs may repeat across mappings for fan-out. Outputs must be unique across the array, and no output may also occur as any mapping's input. On Pico, output GPIOs whose numbers differ by 16 share a physical PWM slice/channel and are rejected. Different channels on the same slice are supported and initialized together at 50 Hz. ESP32 uses separate LEDC channels for the mappings.

## Mapping

For bidirectional mode, the receiver calibration defines normalized demand from −1 through 0 to +1, using separate spans on either side of input neutral. Inversion negates that demand, preserving the calibrated neutral even when endpoints are asymmetric. Within the deadband the output is exactly stop. The deadband is not rescaled out of the remaining travel, so a small step may occur at its edge.

Let `d = abs(normalized demand)`, `p = limit/100`, and `span` be the ESC pulse distance from neutral to the endpoint on the requested side:

- Scale: output excursion = `d × span × p`.
- Clamp: output excursion = `min(d × span, span × p)`.

The result is added to or subtracted from output neutral. Integer arithmetic rounds toward stop. At defaults, reverse endpoint is `1500 − 500 × 0.30 = 1350 µs`; forward endpoint is `1500 + 500 × 0.30 = 1650 µs`.

Forward-only mode uses input minimum as stop (input maximum when inverted), and maps to output minimum through output maximum. Reverse percentage and output neutral do not affect the command in this mode, although ordered calibration fields are still required.

Only completed pulses **800–2200 µs** count as valid. Pulses outside the calibrated input endpoints but inside that absolute interval are clamped to calibrated endpoints. Invalid widths or stale input on any mapping clear all arming; every output becomes its configured stop. A high or low stuck signal times out because no new falling edge completes a valid pulse. The firmware does not decode receiver RF-link state, validate pulse repetition rate, or authenticate the transmitter.

## Timing and failure limits

Hardware PWM repeats at 50 Hz. Normal receiver timeout is evaluated in the main loop, usually every few milliseconds, with the updated pulse taking effect by a subsequent 20 ms frame. This is a command processor, not a certified timing/safety controller. Blocking transport writes and firmware faults may delay the main loop. A 2-second watchdog is configured after startup; in a stalled-loop case the previous hardware PWM may persist until watchdog reset. Test this separately from normal receiver timeout. An external hardware cutoff is necessary when that delay is unacceptable.

Each ESC sees no pulses during some boot/remap/reset intervals, then its configured stop pulse. Pin changes can truncate one frame. Perform them only with motor power removed. Flash writes happen only while disarmed. Saved data uses a magic/schema value, a version 2 profile and FNV-1a checksum, with 4096 bytes of EEPROM emulation. Saving is not power-failure atomic. An interrupted/corrupt save or unavailable storage may cause fallback to one default mapping on next boot. Confirm `saved`, mapping count, pins and every limit after reboot. On ESP32, expanding old EEPROM emulation from 1024 to 4096 bytes may itself perform an NVS write during startup.

Common errors: `invalid_json`, `invalid_config` (legacy set), `invalid_mappings`, `use_set_mappings`, `disarm_first`, `hold_all_neutral_for_1s`, `save_failed`, `unknown_command`, `line_too_long`. Receiver restoration never rearms automatically.
