# Build and run

For automated setup and deployment, use [the deployment scripts](deploy.md). The commands below describe the underlying tools.

## PlatformIO and native ESP-IDF

The preferred build is defined in `platformio.ini`: PlatformIO **6.1.18**, Espressif platform **6.12.0**, native **ESP-IDF 5.5.0** for all ESP32/C3 targets. ESP builds use Espressif GPIO, LEDC, USB Serial/JTAG or UART, Bluedroid SPP/GATT and NVS APIs directly. They do not link Arduino. Pico retains Arduino-Pico **4.4.3** and ArduinoJson **7.4.2**, using community Raspberry Pi platform revision `c7502925e3b08af70e9f924d54ab9d00a7e64781` and its compatible 4.0.1 toolchain. `firmware/pico/main.cpp` includes the same sketch used by Arduino CLI.

```sh
./scripts/setup-pio.sh all
./scripts/deploy.sh pio pico --build-only
./scripts/deploy.sh esp32 --build-only
./scripts/deploy.sh esp32c3 --build-only
./scripts/deploy.sh esp32c3-devkit --build-only
bash scripts/check-idf.sh
```

Outputs are copied to `build/pio/TARGET/`. `esp32c3` selects the Super Mini native USB Serial/JTAG CDC interface; `esp32c3-devkit` selects UART0 through the DevKitM-1 USB bridge. Both use BLE NUS. Original ESP32 uses UART0 and Bluetooth Classic SPP. USB UART remains 115200 baud. Protocol version 2, apps and pin restrictions are shared with the Arduino implementation.

Native sources live in `firmware/espidf/`. Standalone ESP-IDF 5.5.0 users may also build there: run `idf.py set-target esp32` or `idf.py set-target esp32c3`, then `idf.py -DRC_USB_NATIVE=0 build` (UART) or `idf.py -DRC_USB_NATIVE=1 build` (C3 native USB). PlatformIO is the reproducible CI entry point. Each target needs its own build/config directory when switching SDK targets.

The native partition table provides one 3 MiB factory application and preserves the old Arduino NVS offset/size. There is no OTA update implementation. Native settings use NVS namespace `rc_limit`, key `mappings`; if absent, valid legacy Arduino EEPROM data is imported without erasing its blob. Export profiles before upgrading. After native saves, downgrading to Arduino reads its older copy; import the desired profile explicitly. Physical flash migration remains unverified.

Native serial/radio transmit workers use bounded queues so link congestion does not block the control task. Overflow can discard commands/replies; clients must handle timeouts. The control task uses a two-second task watchdog; this is not an independent output interlock. Hardware waveform and Bluetooth tests remain necessary.

## Arduino fallback


Use Arduino CLI or Arduino IDE. This sketch is compiled against these pinned versions:

| Dependency | Version |
|---|---|
| Espressif Arduino ESP32 core | 2.0.17 |
| Earle Philhower Arduino-Pico core | 4.4.3 |
| ArduinoJson | 7.4.2 |

The ESP32 implementation uses the Arduino 2.x LEDC and watchdog APIs. Arduino ESP32 3.x/4.x is not a drop-in replacement for this sketch. The Pico implementation uses Pico SDK hardware PWM through Arduino-Pico, not the Arduino Mbed core. Hardware PWM produces 50 Hz pulses independently of UI/serial scheduling.

Install [Arduino CLI](https://arduino.github.io/arduino-cli/), then from the project root:

```sh
arduino-cli config add board_manager.additional_urls https://espressif.github.io/arduino-esp32/package_esp32_index.json
arduino-cli config add board_manager.additional_urls https://github.com/earlephilhower/arduino-pico/releases/download/global/package_rp2040_index.json
arduino-cli core update-index
arduino-cli core install esp32:esp32@2.0.17
arduino-cli core install rp2040:rp2040@4.4.3
arduino-cli lib install ArduinoJson@7.4.2

arduino-cli compile --fqbn rp2040:rp2040:rpipico --output-dir build/pico firmware/rc_limiter
arduino-cli compile --fqbn esp32:esp32:esp32 --output-dir build/esp32 firmware/rc_limiter
arduino-cli compile --fqbn esp32:esp32:esp32c3:CDCOnBoot=cdc --output-dir build/esp32c3 firmware/rc_limiter
arduino-cli compile --fqbn esp32:esp32:esp32c3:CDCOnBoot=default --output-dir build/esp32c3-devkit firmware/rc_limiter
arduino-cli board list
```

Upload, replacing the port with the one shown for your board:

```sh
arduino-cli upload --fqbn rp2040:rp2040:rpipico --port /dev/ttyACM0 firmware/rc_limiter
# Or the original ESP32:
arduino-cli upload --fqbn esp32:esp32:esp32 --port /dev/ttyUSB0 firmware/rc_limiter
```

On a fresh Pico, hold BOOTSEL while plugging in USB. Release after it appears as a USB drive and copy the compiled `.uf2` onto it. On some ESP32 boards, hold BOOT when uploading. Disconnect motor power during flashing; output can be absent or change during reset. Close all serial monitors before launching a configuration app. On Linux, grant your account the appropriate device access (often the `dialout` or `uucp` group); log out/in after changing groups.

For Arduino IDE, add the same board URLs to Preferences, install the pinned board packages and ArduinoJson via their managers, open `firmware/rc_limiter/rc_limiter.ino`, choose Raspberry Pi Pico from Arduino-Pico or ESP32 Dev Module from Espressif, then upload. See the [Arduino-Pico installation guide](https://arduino-pico.readthedocs.io/en/latest/install.html) and [Espressif Bluetooth documentation](https://docs.espressif.com/projects/arduino-esp32/en/latest/api/bluetooth.html).

## Browser and Electron

All firmware targets retain USB serial; original ESP32 additionally starts Bluetooth Classic SPP as `RC-<device name>`. C3 starts Nordic UART Service BLE as `RC-<device name>`; use the C3 BLE button rather than the serial port picker. No separate wireless upload is needed. Web/Electron and native Android use the same mapping protocol over either transport. Pair the ESP32 through the operating system before selecting its SPP service. The standard Pico uses USB CDC; the original ESP32 DevKit USB connector uses an onboard USB-to-UART bridge.

Configuration uses unbundled modules. The optional firmware updater needs `npm ci --ignore-scripts` and `npm run build:web`; this bundles esptool-js, ZIP and hash dependencies locally into ignored `web/dist/`. Electron prestart/prepackage hooks build it automatically. For a ready-to-serve ZIP, use the README download or run `npm run package:web`. Source-based static deployments must build before uploading `web/`. See [firmware updates](firmware-updates.md). Serve `web/` on localhost as described in the README. Web Serial is permission gated; Chrome's [official serial guide](https://developer.chrome.com/docs/capabilities/serial) covers browser requirements. Bluetooth SPP availability is OS/browser dependent.

C3 BLE uses Web Bluetooth, which needs a secure context and an explicit click on the BLE connection button. Chrome on Linux may require its experimental web platform features flag; browser/OS radio support varies. See [Chrome's Web Bluetooth platform guidance](https://developer.chrome.com/docs/capabilities/bluetooth). The native Android app provides a separate GATT client when the browser path is unavailable. USB does not require Web Bluetooth support.

The Electron shell enables Chromium's experimental web platform switch on Linux to expose Web Bluetooth. The renderer sandbox, explicit device chooser and local-page permission checks remain enabled. A working Bluetooth adapter/OS stack is still required; exposing the API alone does not verify a physical GATT connection.

For Electron, use Node **22.12+**, npm and an OS supported by Electron 43:

```sh
npm ci
npm start
npm run package
# Windows installer and portable EXE:
npm run package:win
```

`npm ci` downloads the Electron executable through the project's postinstall script. If lifecycle scripts were disabled, run `node node_modules/electron/install.js` explicitly. A first package run may download packaging tools. Packaging produces an unpacked application for the build host's OS, not a signed installer. Native serial permissions remain OS controlled. See [Electron's serial device guide](https://www.electronjs.org/docs/latest/tutorial/devices#web-serial-api).

## Native Android

The project uses native Java views, Android's Bluetooth RFCOMM and BLE GATT APIs, and [usb-serial-for-android 3.9.0](https://github.com/mik3y/usb-serial-for-android/tree/3.9.0). There is no WebView or Electron dependency in the APK. Native source is `android/app/src/main/java/dev/rclimit/MainActivity.java`.

Install Android Studio with SDK Platform 35 and Build Tools 35.0.0. Open the `android/` folder and use a Gradle JDK of **17 or 21**. The wrapper uses Gradle 8.9 and Android Gradle Plugin 8.7.3. The first sync requires access to Google Maven, Maven Central, Gradle's distribution service and JitPack.

```sh
cd android
./gradlew assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

Gradle’s build cache is enabled. Prefer the normal incremental command above; use `clean` or `--rerun-tasks` only when needed for diagnosis. CI restores dependencies/task caches and pinned SDK command-line tools.

Use `gradlew.bat` on Windows. Set the SDK location in Android Studio or untracked `local.properties` (`sdk.dir=/your/sdk/path`), or supply `ANDROID_HOME`.

The debug APK is for local testing and is debug signed. Release distribution requires your own signing configuration and physical testing. Minimum Android is API 26 (Android 8), target/compile API 35. USB OTG host hardware and a data cable are required for USB. Classic SPP works with the original ESP32; BLE UART works with ESP32-C3 on a BLE-capable phone.

Pair Classic devices in Android settings first. BLE scans directly for the UART service. Android 12+ requests Nearby devices (`BLUETOOTH_CONNECT` and `BLUETOOTH_SCAN` for BLE). Android 8–11 BLE scanning requires Location permission and system Location enabled. The app requests no Internet permission. See [Android's permission documentation](https://developer.android.com/develop/connectivity/bluetooth/bt-permissions).

## Tests

`bash scripts/check.sh` needs g++ and Node. It compiles the real portable mapping/neutral-gating code and exercises all pulse inputs across both modes, both mapping styles, both directions and percentage limits. JavaScript tests cover validation, fragmented serial replies, concurrent command/telemetry IDs, errors, timeouts and disconnects. It also syntax checks the browser and Electron scripts.

No firmware is flashed automatically by these build/test commands. See [validation.md](validation.md) for the checks actually performed in this workspace and [commissioning.md](commissioning.md) for hardware tests.

## C3-specific build settings

Use `esp32c3` for the Super Mini's native USB connector (`CDCOnBoot=cdc`), and `esp32c3-devkit` for the official DevKitM-1 onboard USB-to-UART connector (`CDCOnBoot=default`). In Arduino IDE choose ESP32C3 Dev Module and match the USB CDC On Boot option to the connector. If a Super Mini needs recovery, hold BOOT, press/release RESET, release BOOT and retry the upload on the enumerated port. Native USB may reconnect under a different device name; explicitly select that port. No external programmer GPIO pins are used by the scripts.

C3 uses 14-bit LEDC at 50 Hz, roughly 1.22 µs duty quantization; original ESP32 retains 16-bit LEDC, and Pico uses 1 µs PWM ticks. All C3 mapping pins, layouts and resistor guidance are in [board-layouts.md](board-layouts.md). C3 is BLE-only for wireless control; no Classic SPP library is compiled into that target.
