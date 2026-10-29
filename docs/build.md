# Build and run

For automated setup and deployment, use [the deployment scripts](deploy.md). The commands below describe the underlying tools.

## Firmware

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

Both firmware targets retain USB serial; original ESP32 additionally starts Bluetooth Classic SPP as `RC-Limiter`. No separate Bluetooth build or upload is needed. Web/Electron and native Android use the same mapping protocol over either transport. Pair the ESP32 through the operating system before selecting its SPP service. The standard Pico uses USB CDC; the original ESP32 DevKit USB connector uses an onboard USB-to-UART bridge.

The web app is buildless. Serve `web/` on localhost as described in the README. Web Serial is permission gated; Chrome's [official serial guide](https://developer.chrome.com/docs/capabilities/serial) covers browser requirements. Bluetooth SPP availability is OS/browser dependent.

For Electron, use Node **22.12+**, npm and an OS supported by Electron 43:

```sh
npm ci
npm start
npm run package
```

`npm ci` downloads the Electron executable through the project's postinstall script. If lifecycle scripts were disabled, run `node node_modules/electron/install.js` explicitly. A first package run may download packaging tools. Packaging produces an unpacked application for the build host's OS, not a signed installer. Native serial permissions remain OS controlled. See [Electron's serial device guide](https://www.electronjs.org/docs/latest/tutorial/devices#web-serial-api).

## Native Android

The project uses native Java views, Android's Bluetooth RFCOMM API, and [usb-serial-for-android 3.9.0](https://github.com/mik3y/usb-serial-for-android/tree/3.9.0). There is no WebView or Electron dependency in the APK. Native source is `android/app/src/main/java/dev/rclimit/MainActivity.java`.

Install Android Studio with SDK Platform 35 and Build Tools 35.0.0. Open the `android/` folder and use a Gradle JDK of **17 or 21**. The wrapper uses Gradle 8.9 and Android Gradle Plugin 8.7.3. The first sync requires access to Google Maven, Maven Central, Gradle's distribution service and JitPack.

```sh
cd android
./gradlew assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

Use `gradlew.bat` on Windows. Set the SDK location in Android Studio or untracked `local.properties` (`sdk.dir=/your/sdk/path`), or supply `ANDROID_HOME`.

The debug APK is for local testing and is debug signed. Release distribution requires your own signing configuration and physical testing. Minimum Android is API 26 (Android 8), target/compile API 35. USB OTG host hardware and a data cable are required for USB. Bluetooth works only with a Classic-SPP-capable ESP32 and a phone that supports Classic Bluetooth.

Pair in Android system settings before connecting. Android 12+ requests `BLUETOOTH_CONNECT` through Nearby devices. The app lists bonded devices rather than scanning and requests no location or Internet permission. See [Android's permission documentation](https://developer.android.com/develop/connectivity/bluetooth/bt-permissions).

## Tests

`bash scripts/check.sh` needs g++ and Node. It compiles the real portable mapping/arming code and exercises all pulse inputs across both modes, both mapping styles, both directions and percentage limits. JavaScript tests cover validation, fragmented serial replies, concurrent disarm/telemetry IDs, errors, timeouts and disconnects. It also syntax checks the browser and Electron scripts.

No firmware is flashed automatically by these build/test commands. See [validation.md](validation.md) for the checks actually performed in this workspace and [commissioning.md](commissioning.md) for hardware tests.
