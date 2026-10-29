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
| Pico Arduino firmware compile (Arduino-Pico 4.4.3, ArduinoJson 7.4.2) | Passed: 78,320 bytes flash, 16,668 bytes global RAM |
| Original ESP32 firmware compile (ESP32 core 2.0.17, ArduinoJson 7.4.2) | Passed: 1,116,973 bytes flash, 46,932 bytes global RAM; Bluetooth Classic SPP included |
| Board-layout pin-pair validation, 1% divider margin calculations and BLE 20-byte fragment/serialization tests (3 tests) | Passed |
| C3 native USB firmware compile (ESP32 core 2.0.17, BLE UART included) | Passed: 1,004,002 bytes flash, 57,796 bytes global RAM |
| C3 DevKitM-1 UART firmware compile (same core, CDC disabled) | Passed: 1,015,482 bytes flash, 57,900 bytes global RAM |
| Pico PlatformIO build (Arduino-Pico 4.4.3, pinned compatible platform/toolchain) | Passed: 83,336 bytes flash, 16,476 bytes RAM; UF2 copied through deploy script |
| Native ESP-IDF 5.5.0 original ESP32 PlatformIO build (Classic SPP) | Passed: 683,869 bytes application flash, 49,856 bytes RAM; 4 MB flash configuration |
| Native ESP-IDF C3 Super Mini PlatformIO build (USB Serial/JTAG + BLE) | Passed: 750,422 bytes application flash, 31,500 bytes RAM |
| Native ESP-IDF C3 DevKitM-1 PlatformIO build (UART + BLE) | Passed: 762,080 bytes application flash, 31,596 bytes RAM |
| Native cJSON profile codec with address/undefined-behavior sanitizers | Passed: round-trip, legacy single mapping, transactional rejection, integer validation, pin conflicts and shared inputs |
| GitHub Actions workflow actionlint 1.7.7 validation | Passed locally; hosted execution has not been observed |
| Firmware release packaging checks | Passed for four boards using fixture binaries: matching board identity, source commit, all binary components, correct flash offsets, checksums and missing-file rejection |
| Native Android Gradle debug build (SDK 35, AGP 8.7.3, Gradle 8.9, JDK 21) | Passed; debug APK produced with native BLE GATT and shared board-layout JSON assets |
| Browser integration in headless Chromium, simulated Pico/ESP32/C3 serial and C3 BLE peripherals | Passed: 1–4 mappings, draft switching, pin conflicts, per-channel limits/telemetry, all-channel arm/disarm UI, apply/save, legacy/v2 profile import/export, USB/SPP chooser capability reporting, disconnect, narrow viewport; board layouts and simulated C3 BLE UART path |
| Electron headless startup | Passed: UI, Web Serial/Web Bluetooth APIs and sandboxed preload bridge loaded; Linux Web Bluetooth flag enabled |
| Electron serial and BLE choosers | Passed: serial chooser opens/cancels; simulated BLE selection reaches the validated preload callback; no hardware connection |
| Electron Linux x64 packaging | Passed: unpacked executable and application archive produced |
| npm dependency audit after installing Electron 43.8.4 / electron-builder 26.18.0 | 0 vulnerabilities reported at verification time |
| Deployment script tests with mocked Arduino CLI / PlatformIO / adb | Passed: explicit target selection, build/upload ordering, failed-build stop, dry run, option/mount checks, APK selection, isolated pinned setup |
| Pico build through `scripts/deploy.sh pico --build-only` using the installed toolchain | Passed; no board flashed |

The browser test uses simulated responses to verify UI and transport integration; it is not an electrical or motor test. The actual shared limiter logic is exercised separately in C++. Electron startup testing uses headless test flags; production renderer sandboxing remains enabled. Android compile verification does not establish device-driver compatibility, runtime permission behavior on a particular phone, mapping-selector behavior on a physical device, or physical Bluetooth pairing/BLE scanning, GATT subscription or radio reliability. Shared `boards.json` inclusion in the Android APK was checked against the web source. Legacy flash migration is implemented and compiled but still needs an upgrade/reboot test on physical boards; successful JSON profile import is not evidence of physical flash migration.

Native ESP-IDF compilation does not validate GPIO timing, USB/Bluetooth runtime behavior, stack margins or real Arduino-to-NVS migration. CI app jobs reuse the existing Android/Electron packaging paths; hosted execution requires a GitHub run. Release workflow configuration is not evidence of a published release.

## Firmware update feature checks

The firmware-update branch adds USB ROM-bootloader flashing in the web/Electron app, with Pico UF2 export. Four hardware-free update tests passed: per-board manifests, SHA-256, fixed offsets, image chip IDs, partition layout, UF2 family, detected-chip/flash-size gating, no full erase, separate NVS-preserving write ranges, MD5 verification wiring and propagation of failed writes. All four actual previously compiled firmware bundles were repackaged and accepted by the validator.

Playwright/Chromium updater integration passed under `/rc-limit/` with actual ZIPs: lazy bundle loading, board selection, checksum validation, acknowledgement gating, a cancelled simulated USB chooser and recovery, and Pico UF2 download. No device was selected or flashed. Electron initialization, existing device choosers and Linux packaging passed with the updater bundle. Physical ROM handshake, flash verification, interrupted-update recovery, native USB re-enumeration and settings preservation remain unverified. No wireless or Android firmware flashing is implemented.

## Local artifacts

- `build/pio/{pico,esp32,esp32c3,esp32c3-devkit}/`: preferred PlatformIO outputs; all four build-only deploy paths passed without flashing hardware.

- `build/pico/rc_limiter.uf2`: compiled standard Pico firmware.
- `build/esp32c3/` and `build/esp32c3-devkit/`: C3 USB-native and UART connector builds. Use the matching CLI upload target; C3 bootloader offsets differ from original ESP32.
- `build/esp32/`: application, bootloader, partition table and `boot_app0` components for the original ESP32 build. Use the Arduino CLI upload workflow in [build.md](build.md); the application `.bin` alone is not a complete fresh-device image.
- `build/android/rc-limit-debug.apk`: native Android debug APK, suitable for local sideload testing.
- `build/desktop/linux-unpacked/rc-limit-desktop`: unpacked Linux x64 Electron executable; keep the entire directory together.
- `build/web-preview.png`: browser screenshot with simulated board telemetry.

Build outputs and downloaded dependencies are ignored by Git. Arduino toolchains were installed in an isolated `/tmp` environment; PlatformIO packages use ignored project-local `.tools/platformio/`. Project source contains pinned versions, npm lockfile, and Gradle wrapper for reproducibility.

## Still requires hardware verification

Flash/upload, GPIO assignments on the exact board, simultaneous waveforms for multiple outputs and shared Pico slices, shared-input fan-out timing, level conversion and power sequencing, waveform frequency/width/jitter, ESC neutral and braking/reverse semantics, receiver RF failsafe, stop-all on signal unplug/stuck lines, watchdog stalls, MCU brownouts/reset, legacy flash migration and multi-mapping persistence, USB OTG permissions/drivers on a phone, real USB/SPP/BLE sessions, C3 pulse timing during BLE traffic, BLE congestion/overflow/reconnects, native Android BLE permission/scanning behavior, app backgrounding and a physical emergency stop. Follow [commissioning.md](commissioning.md).

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

## Device naming feature

All four PlatformIO targets compiled after adding identity storage, `set_name`, hardware IDs and boot-time Bluetooth names. The C3 Arduino fallback also compiled. Native Android debug assembly passed. Portable sanitizer tests cover name length/characters, checksummed record round-trip, corruption, unterminated records and rejection without modifying the destination. JavaScript tests cover the same allowed names and unchanged mapping-profile shape. Simulated browser integration passed rename/display, reboot-pending feedback and preservation of an edited name across telemetry polls; Electron initialization also passed.

No physical rename/reboot, persistence across a real flash update, Bluetooth advertisement/cache refresh, NVS/EEPROM name migration, USB identity readback or Android runtime rename was tested. User names are application metadata over USB, not custom USB product descriptors. Names are separate from mapping profiles and mapping saves.

## Windows packaging and CI checks

On the CI/Windows feature branch, both Windows x64 targets were cross-built successfully on Linux with electron-builder 26.18.0: NSIS per-user installer and portable self-extracting EXE. The embedded application is a PE32+ x86-64 executable; the NSIS launchers are PE32 wrappers containing that x64 payload. The pinned electron-builder schema and workflow actionlint checks passed. Windows installation/runtime and physical USB/Bluetooth operation were not tested.

Source checks passed in a clean Ubuntu 24.04 container with Node 22.23.4/Python 3.12, and with Node 22 locally. Thirty Ubuntu sanitizer runs completed without failure. Android debug assembly passed after explicitly selecting Build Tools 35.0.0 to match the SDK installed in CI. The local web archive step exposed a missing external `zip` executable. CI now uses Python’s standard-library ZIP writer with an explicit Python 3.12 setup step; the archive includes the built updater and license files. The four firmware setup/build/package paths, native codec checks, Linux Electron/web packaging and Windows installer/portable packaging also passed locally. Hosted CI logs remain inaccessible through the connected GitHub app (repository API returns 404); the hosted result is unconfirmed.

Android missing-tools follow-up: command-line tools 16.0 (build 12266719, matching CI) successfully installed/verified `platform-tools`, API 35 and Build Tools 35.0.0 locally. Its official SDK package listing contains no standalone `tools` package; the setup action's default package list requested that missing package. CI now overrides the list and verifies SDK paths/executables before Gradle. adb/aapt2/platform JAR checks, debug APK assembly and actionlint passed. Hosted execution remains unobserved.

## Android build speed

Enabled Gradle task caching and added CI caches for Gradle dependencies/task state and pinned Android command-line tools. Local deployment now uses Gradle's default daemon instead of `--no-daemon`; CI retains single-use daemon behavior because each runner builds once.

Measured locally with the existing dependency cache, JDK 21 and unchanged sources: the old repeat command took 6.80 seconds; the daemon's first build took 6.60 seconds; a repeat using the warm daemon took 0.79 seconds. A correctly ordered `clean assembleDebug` completed in 7.07 seconds, with 19 tasks restored from cache (14 executed). These are local elapsed times, not hosted CI timings. First-run network/tool installation costs and CI cache-hit performance remain unmeasured. All APK builds, deployment tests and workflow actionlint passed.
