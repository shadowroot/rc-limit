# RC Limit project instructions

These instructions apply to this project and its subdirectories. Preserve the original requirements below when extending or refactoring it. Later explicit user instructions take precedence.

## Original product requirements

- Build an inline RC receiver-to-ESC limiter for Raspberry Pi Pico and ESP32.
- Support **bidirectional ESCs**, with configurable limits in both directions.
- Make the receiver input pin, ESC output pin, pulse calibration and limits configurable.
- Support multiple receiver-to-ESC pin mappings, with independent calibration and limits. The current maximum is four mappings; one input may fan out to several unique outputs.
- Provide USB serial configuration on Pico and ESP32, plus Bluetooth configuration on ESP32. Support C3 Super Mini and C3 DevKit boards with USB and BLE serial (the user accepted BLE instead of Classic for C3).
- Provide board layouts and suggested pins for Pico, original ESP32 DevKit, C3 Super Mini and C3 DevKitM-1, and resistor/buffer guidance for non-5-V-tolerant GPIOs.
- Provide a **web configuration GUI that can run in Electron**.
- Provide a **separate native Android implementation** with USB serial and Bluetooth support. Keep it native; the requested Android implementation is not a WebView wrapper.
- Document how to connect a receiver to the limiter and the limiter to an ESC, including handling a receiver signal that actually reaches 5 V, signal level conversion, common ground and power connections.
- Provide scripts for setup, building, flashing, installing Android, and launching the configuration apps.

The initial Python desktop GUI was replaced by the web/Electron and native Android requirements. `app/controller.py` is not part of the current implementation, even if an IDE still has an old tab open.

## Current implementation scope and defaults

These are implementation choices, not additional original user requirements. Document changes to them explicitly.

- One to four conventional RC PWM input-to-output mappings, with 50 Hz ESC outputs. Bus protocols such as SBUS, iBUS and DShot are outside the current implementation.
- Firmware targets: RP2040 Pico, original ESP32 DevKit / WROOM-32, C3 Super Mini (native USB CDC) and official C3 DevKitM-1 (USB-to-UART). Other variants and Pico 2 need explicit implementation and validation.
- Original ESP32 uses Classic SPP/RFCOMM as RC-Limiter. C3 uses Nordic UART Service BLE GATT as RC-Limiter-C3. Pico uses USB only. Keep Classic and BLE chooser paths distinct, serialize/chunk BLE writes and assemble notification fragments before parsing JSON.
- Default GPIO mapping: Pico GP4 input → GP5 output; ESP32 GPIO27 input → GPIO25 output; C3 GPIO3 input → GPIO4 output. GPIO numbers are not physical header positions.
- Bidirectional pulse defaults: 1000 / 1500 neutral / 2000 µs, with 30% forward and reverse limits. Confirm the actual ESC neutral before motor operation.
- Both apps share the firmware's version 2 newline-delimited JSON protocol and profiles containing a `mappings` array of 15-field channel configurations. Import legacy single-channel profiles and saved configurations; preserve compatibility or document a coordinated migration.
- The limiter constrains the ESC command. It does not measure or guarantee motor speed, current, torque or power.

## Development prerequisites

Install only the tools needed for the work being done. Use the pinned versions in the repository rather than silently upgrading the toolchains.

| Area | Prerequisites |
|---|---|
| Checks and scripts | Bash, Python 3, g++ with C++11 and address/undefined-behavior sanitizer support, Node.js |
| Preferred firmware | Python 3 with venv/pip, Git, PlatformIO **6.1.18**, Espressif platform **6.12.0**, native ESP-IDF **5.5.0**; pinned Pico community platform with Arduino-Pico **4.4.3** and ArduinoJson **7.4.2** |
| Arduino fallback | Arduino CLI; Arduino-Pico **4.4.3** (Earle Philhower core, not Arduino Mbed); Espressif ESP32 core **2.0.17**; ArduinoJson **7.4.2** |
| Web GUI | Node.js **22.12+**, npm for the firmware updater bundle; Python 3 for local serving; desktop browser supporting Web Serial, such as Chrome/Edge; localhost or HTTPS |
| Electron | Node.js **22.12+**, npm; Electron **43.8.4** and electron-builder **26.18.0** from `package-lock.json` |
| Native Android | JDK **17 or 21**; Android SDK Platform **35**, Build Tools **35.0.0**, platform-tools/adb; Gradle wrapper **8.9**, Android Gradle Plugin **8.7.3** |
| Android USB driver | usb-serial-for-android **3.9.0**, resolved by Gradle |
| Optional UI integration tests | Playwright and a compatible Chromium installation; Electron dependencies for the Electron test |

The Android application supports API 26+ and currently targets/compiles API 35. Firmware setup and first npm/Gradle builds require network access. Android dependencies resolve through Google Maven, Maven Central and JitPack.

For physical testing, have the exact board, receiver and ESC manuals; data-capable USB cables; a USB OTG adapter for Android USB; appropriate signal conversion and regulated supplies; and an oscilloscope to verify signal voltage and pulse timing. Original ESP32 Classic requires OS pairing; C3 BLE requires service discovery and notifications. BLE scan permissions differ between Android 8–11 and Android 12+. USB deployment requires device access; Android installation requires USB debugging authorization.

## Source layout

- `firmware/rc_limiter/limiter.h`: portable mapping and arming/failsafe logic.
- `firmware/espidf/`: native Espressif GPIO/LEDC, UART/USB, Bluedroid SPP/BLE, cJSON and NVS implementation.
- `platformio.ini`: pinned builds for all four boards; ESP targets use `framework = espidf`.
- `firmware/rc_limiter/rc_limiter.ino`: Arduino fallback/Pico hardware capture/output, persistence and serial/Bluetooth commands.
- `web/`: shared browser/Electron GUI, BLE transport and protocol client. `firmware.mjs` validates release manifests; `updater.mjs` uses pinned esptool-js for USB bootloader flashing. Build its ignored `web/dist/` bundle via `npm run build:web`; include third-party licenses. `web/hardware/boards.json` is shared with Android assets; keep pin layouts and guidance consistent.
- `electron/`: sandboxed desktop shell, preload bridge and device chooser.
- `android/`: native Java Android app, USB serial and Bluetooth transports.
- `scripts/`: checks, isolated firmware setup and deployment entry points.
- `tests/`: limiter, protocol, deployment and optional UI integration tests.
- `docs/`: build/deployment, wiring, protocol, commissioning and verification records.

Keep generated artifacts in ignored `build/` directories and project-local firmware tools under ignored `.tools/`. Do not rely on temporary `/tmp` toolchain installations from a previous session. Use environment overrides documented in `docs/deploy.md` when needed.

## Build and deployment entry points

Run from the project root:

```sh
bash scripts/check.sh
./scripts/setup-pio.sh all
./scripts/deploy.sh pio pico --build-only
bash scripts/check-idf.sh
# Optional Arduino CLI fallback:
./scripts/setup-firmware.sh pico
./scripts/deploy.sh pico --build-only
./scripts/deploy.sh esp32 --build-only
./scripts/deploy.sh esp32c3 --build-only
./scripts/deploy.sh esp32c3-devkit --build-only
./scripts/deploy.sh android --build-only
./scripts/deploy.sh desktop --package
./scripts/deploy.sh web
```

For hardware deployment, require explicit selection via `--port`, Pico `--mount`, or Android `--serial`; do not introduce automatic selection of an arbitrary device. Preserve `--dry-run` behavior: no commands executed, files written, server started, or hardware changed. See `./scripts/deploy.sh --help` and `docs/deploy.md` for examples. Do not flash hardware or install onto a phone merely to validate a documentation or source-only change.

## Runtime behavior to preserve

- Boot/reset starts disarmed. Arming all outputs is explicit and requires every mapped receiver input to be healthy and held at neutral for one second.
- Invalid or stale pulses on any mapped input disarm all outputs and request each configured stop pulse. Restoring signal does not automatically rearm.
- Permit shared receiver inputs, reject duplicate outputs, reject input/output pin overlap across mappings, and reject Pico PWM channel aliases (output GPIOs 16 apart). Initialize each Pico PWM slice once so two outputs using its different channels retain independent pulse widths.
- Bidirectional stop is the configured output neutral. Forward-only stop is output minimum.
- Configuration changes and flash saves are rejected while armed. Applying settings and saving to flash remain separate actions.
- Keep clamp and scaled mappings, independent forward/reverse limits, inversion, deadband, pin validation and calibrated endpoints consistent across firmware, GUI and documentation.
- An app disconnect is not an independent firmware failsafe trigger. Do not promise that a dropped USB/Bluetooth connection stops an armed board.
- Receiver RF loss can leave valid pulses present. Document and test the receiver's own failsafe; pulse validity alone does not establish a healthy radio link.
- Hardware PWM can retain its last command during a stalled main loop until watchdog recovery. Do not describe the normal receiver timeout as a guaranteed bound for every fault.
- C3 RC pins are only 0, 1, 3, 4, 5, 6, 7, 10; exclude straps 2/8/9, native USB 18/19 and UART 20/21. C3 uses 14-bit LEDC, original ESP32 16-bit. Keep GPIO4–7 free when external JTAG is needed.
- Treat GPIOs as 3.3 V interfaces. Distinguish receiver supply voltage from measured signal-high voltage, and preserve the level-conversion/power-sequencing guidance in `docs/wiring.md`.

## Validation and documentation

- For code changes, run checks appropriate to the affected behavior. `bash scripts/check.sh` covers the portable limiter, JavaScript protocol/profile handling, script syntax and mocked deployment tests.
- Compile affected firmware targets after hardware API or firmware changes. Build Android after native source/build changes and verify Electron packaging after desktop packaging changes.
- Use the optional browser/Electron integration checks described in `docs/validation.md` for relevant UI/transport changes. Clearly label simulated serial devices.
- Distinguish compilation, mocked tests and real hardware verification in reports. Follow `docs/commissioning.md` for actual waveform, ESC, receiver failsafe, power-loss and transport tests.
- Firmware updates use USB bootloaders: ESP32/C3 via Web Serial, Pico via RP2040 UF2 BOOTSEL copy. No BLE/Wi-Fi OTA is implemented. Verify manifest board, chip, offsets, hashes and partition layout before any flash write; preserve NVS and require an explicit port and disconnected motor power.
- Update `docs/protocol.md` when commands, fields or mappings change; update `docs/build.md` and `docs/deploy.md` when prerequisites or deployment change.
- Keep `docs/validation.md` factual: record checks actually completed and physical tests still outstanding. Do not claim physical validation based on a successful build.
- For this documentation-only file, review consistency with source/manifests; no firmware rebuild or device deployment is needed.

## CI and releases

`.github/workflows/build.yml` runs checks and all four PlatformIO builds, Android debug assembly, Linux Electron packaging and web archiving. `v*` tag pushes create draft releases only after all jobs succeed. Packages must contain board identity, source commit, checksums and flashing instructions; never publish an application-only ESP binary as a complete fresh-device image. No hardware is flashed by CI. See `docs/releases.md`.
