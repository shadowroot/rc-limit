# Verification record

Verified in this workspace on **2026-10-29**. No physical board, receiver, ESC, motor, or Android device was connected for testing.

| Check | Result |
|---|---|
| Portable C++ limiter with address/undefined-behavior sanitizers | Passed |
| Input/mode/mapping/direction/percentage sweep and output bounds | Passed |
| Neutral dwell, invalid pulses, receiver timeout, disarming, timer rollover | Passed |
| Bidirectional failsafe uses configured neutral; 0% stops both directions | Passed |
| Multi-mapping pin validation: shared inputs, distinct outputs, input/output conflicts and Pico PWM aliases | Passed in C++ and JavaScript |
| Atomic arming of all mappings, independent limits and stop-all behavior on one stale/invalid input | Passed in portable C++ logic tests |
| JavaScript profile validation and serial protocol tests (7 tests) | Passed, including version 2 profiles and legacy profile migration |
| Fragmented replies, request IDs, concurrent disarm/telemetry, timeout and transport errors | Passed |
| Pico Arduino firmware compile (Arduino-Pico 4.4.3, ArduinoJson 7.4.2) | Passed: 78,184 bytes flash, 16,668 bytes global RAM |
| Original ESP32 firmware compile (ESP32 core 2.0.17, ArduinoJson 7.4.2) | Passed: 1,116,821 bytes flash, 46,932 bytes global RAM; Bluetooth Classic SPP included |
| Native Android Gradle debug build (SDK 35, AGP 8.7.3, Gradle 8.9, JDK 21) | Passed; debug APK produced |
| Browser integration in headless Chromium, simulated Pico and ESP32 serial boards | Passed: 1–4 mappings, draft switching, pin conflicts, per-channel limits/telemetry, all-channel arm/disarm UI, apply/save, legacy/v2 profile import/export, USB/SPP chooser capability reporting, disconnect, narrow viewport |
| Electron headless startup | Passed: UI, Web Serial API and sandboxed preload bridge loaded |
| Electron actual serial chooser after section navigation | Passed: chooser opens and cancels without opening hardware |
| Electron Linux x64 packaging | Passed: unpacked executable and application archive produced |
| npm dependency audit after installing Electron 43.8.4 / electron-builder 26.18.0 | 0 vulnerabilities reported at verification time |
| Deployment script tests with mocked Arduino CLI / adb | Passed: explicit target selection, build/upload ordering, failed-build stop, dry run, option/mount checks, APK selection, isolated pinned setup |
| Pico build through `scripts/deploy.sh pico --build-only` using the installed toolchain | Passed; no board flashed |

The browser test uses simulated responses to verify UI and transport integration; it is not an electrical or motor test. The actual shared limiter logic is exercised separately in C++. Electron startup testing uses headless test flags; production renderer sandboxing remains enabled. Android compile verification does not establish device-driver compatibility, runtime permission behavior on a particular phone, mapping-selector behavior on a physical device, or Bluetooth pairing success. Legacy flash migration is implemented and compiled but still needs an upgrade/reboot test on physical boards; successful JSON profile import is not evidence of physical flash migration.

## Local artifacts

- `build/pico/rc_limiter.uf2`: compiled standard Pico firmware.
- `build/esp32/`: application, bootloader, partition table and `boot_app0` components for the original ESP32 build. Use the Arduino CLI upload workflow in [build.md](build.md); the application `.bin` alone is not a complete fresh-device image.
- `build/android/rc-limit-debug.apk`: native Android debug APK, suitable for local sideload testing.
- `build/desktop/linux-unpacked/rc-limit-desktop`: unpacked Linux x64 Electron executable; keep the entire directory together.
- `build/web-preview.png`: browser screenshot with simulated board telemetry.

Build outputs and downloaded dependencies are ignored by Git. Toolchains were installed in an isolated `/tmp` environment; project source contains pinned versions, npm lockfile, and Gradle wrapper for reproducibility.

## Still requires hardware verification

Flash/upload, GPIO assignments on the exact board, simultaneous waveforms for multiple outputs and shared Pico slices, shared-input fan-out timing, level conversion and power sequencing, waveform frequency/width/jitter, ESC neutral and braking/reverse semantics, receiver RF failsafe, stop-all on signal unplug/stuck lines, watchdog stalls, MCU brownouts/reset, legacy flash migration and multi-mapping persistence, USB OTG permissions/drivers on a phone, real USB/SPP sessions, app backgrounding and a physical emergency stop. Follow [commissioning.md](commissioning.md).

The documented normal receiver timeout is not a hard bound for every fault: blocked firmware can leave hardware PWM running until watchdog reset. An orderly app disconnect attempts disarm; app/link loss has no guaranteed stop delivery. This limiter does not implement an independent hardware interlock or measured speed regulation.

## Re-running checks

```sh
bash scripts/check.sh
```

Optional browser/Electron integration checks need Playwright installed separately and Chromium available. For example, install Playwright in a temporary tools folder, then run:

```sh
NODE_PATH=/path/to/tools/node_modules node tests/web-smoke.cjs
NODE_PATH=/path/to/tools/node_modules node tests/electron-smoke.cjs
```

The browser test starts and stops its own loopback HTTP server; it does not publish a service. Override `CHROMIUM_PATH` for a different Chromium executable. The Electron test opens the device chooser and cancels; it never selects or opens a hardware port.
