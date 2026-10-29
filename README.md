# RC Limit

A receiver-to-ESC PWM limiter for **Raspberry Pi Pico (RP2040)** and **original ESP32 DevKit / ESP32-WROOM-32**, and **ESP32-C3 Super Mini / DevKitM-1**. Configure **one to four pin mappings**, each taking a receiver PWM input and producing a constrained 50 Hz ESC signal. Bidirectional mode is the default.

Configure it with the local **web app**, the **Electron desktop app**, or the **native Android app** (Java, native views, no WebView). Configuration includes receiver and ESC GPIOs, calibrated pulse endpoints and neutral, independent forward/reverse limits, clamp/scaled mapping, direction inversion, deadband, and receiver timeout. Profiles are interchangeable JSON files.

This limits the ESC command, not measured motor speed, current, torque, or power. A 30% limit means 30% of the calibrated pulse excursion from stop. It is a bench prototype, with hardware commissioning still required.

Firmware uses **PlatformIO**, with **native ESP-IDF** on ESP32/C3 and Arduino-Pico on Pico. [CI and releases](docs/releases.md) provide firmware, Android debug, Linux desktop and web downloads.

## Start here

Use the [deployment scripts](docs/deploy.md) for setup, board flashing, Android installation, and starting the web/Electron app. Run `./scripts/deploy.sh --help` for all targets; every command supports `--dry-run`.

1. Read [wiring and voltage conversion](docs/wiring.md) before connecting the receiver signal. GPIOs are 3.3 V.
2. Build and flash [the firmware](docs/build.md). Defaults: Pico GP4 input → GP5 output; ESP32 GPIO27 input → GPIO25 output. These are GPIO numbers.
3. Run one of the configuration apps below.
4. Follow the [commissioning procedure](docs/commissioning.md) with motor power disconnected, then the propeller removed / drivetrain unloaded.

The default bidirectional output is 1000 / **1500 stop** / 2000 µs, with 30% in each direction: **1350–1650 µs** at full stick. Verify your ESC uses 1500 µs as stop. Car ESC reverse/brake sequencing varies; the limiter only transforms pulses.

## Multiple pin mappings

Use **+ Add mapping** in the web/Electron GUI or **+ Mapping** in Android. Select a mapping to edit its GPIOs, pulse calibration, forward/reverse limits and timeout. Edits remain in the form until **Apply all mappings / Apply all**, followed by **Save to flash / Save flash** for persistence. Each mapping has independent limits and live telemetry; arming/disarming applies to the whole board.

Suggested conflict-free pairs (GPIO numbers):

| Mapping | Pico input → output | ESP32 input → output | C3 input → output |
|---|---|---|---|
| 1 | GP4 → GP5 | GPIO27 → GPIO25 | GPIO3 → GPIO4 |
| 2 | GP6 → GP7 | GPIO26 → GPIO33 | GPIO5 → GPIO6 |
| 3 | GP8 → GP9 | GPIO32 → GPIO18 | GPIO0 → GPIO1 |
| 4 | GP10 → GP11 | GPIO19 → GPIO21 | GPIO7 → GPIO10 |

These are suggestions, not fixed assignments. A single receiver GPIO may feed multiple output mappings with different limits. Outputs must be unique and cannot also serve as receiver inputs. Pico outputs 16 GPIOs apart cannot be used independently because they alias one hardware PWM channel. The apps and firmware validate these conflicts.

All mapped inputs must be valid and held at stop for one second before **ARM ALL** succeeds. Losing any mapped input stops and disarms **every output**. Receiver restoration never rearms the board. Do not add an unused/unwired input mapping: it will prevent arming. To remove one, remove it from the draft and Apply all while disarmed.

Profiles now export as `{"version":2,"mappings":[...]}`. Old single-channel profile files and saved firmware configurations are read as one mapping; a subsequent save writes the new format. Upgrade firmware to use multiple mappings. Example profiles are in [examples/](examples/).

## USB and Bluetooth serial

USB serial is available on every target. Pico and the C3 Super Mini use native USB CDC; the original ESP32 DevKit and C3 DevKitM-1 use their USB-to-UART bridges. Use 115200 baud for UART bridges. Native CDC clients assert DTR for recognized Pico/Espressif USB interfaces.

- **Original ESP32:** Bluetooth Classic SPP starts as **RC-Limiter** alongside USB. Pair with the OS, then use the USB / Classic serial chooser, or Android's Bluetooth button.
- **ESP32-C3:** BLE UART starts as **RC-Limiter-C3** alongside USB. Use **Connect C3 BLE serial** in web/Electron or **BLE C3** in Android. No prior OS pairing is required. It uses the Nordic UART Service (GATT), not a virtual COM port.
- **Pico:** USB only; no onboard Bluetooth on a standard Pico, and no Pico W Bluetooth stack is implemented here.

The same JSON commands, four mappings and arming rules work over each transport. Use one controller at a time. Bluetooth transports have no application authentication in this prototype; use a controlled bench environment. A link loss does not guarantee delivery of disarm.

## Board layouts and 5 V receiver signals

Expand **Board layouts, suggested pins & 5 V input resistors** under Pin mapping. Choose Pico, official ESP32-DevKitC V4, C3 Super Mini or C3 DevKitM-1. The diagrams show header positions, selected GPIOs, reserved pins and suggested pin-pair buttons. The native Android app has the same reference data in its board-guide dialog. Clone layouts vary: match printed GPIO labels and the USB orientation.

All these GPIOs use **3.3 V logic**. For a confirmed 5 V receiver PWM signal, use **4.7 kΩ in series and 6.8 kΩ from the GPIO junction to ground**, both 1%, giving about **2.96 V** at a 5 V high. An already 3.3 V signal would fall to about 1.95 V and may not register. Prefer the powered-down-tolerant input buffer when power sequencing varies. See [board layouts](docs/board-layouts.md) and [wiring circuits](docs/wiring.md).

C3 build/flash examples:

```sh
./scripts/setup-pio.sh esp32c3
./scripts/deploy.sh esp32c3 --port /dev/ttyACM0
# Official C3 DevKitM-1 onboard USB-to-UART connector:
./scripts/deploy.sh esp32c3-devkit --port /dev/ttyUSB0
```

## Web app

The GitHub Pages deployment target is [shadowroot.github.io/rc-limit](https://shadowroot.github.io/rc-limit/). See [Pages setup](docs/releases.md#github-pages-continuous-deployment) for first-time activation.

No frontend build or dependencies:

```sh
cd rc-limit
python3 -m http.server 8080 --bind 127.0.0.1 --directory web
```

Open **http://localhost:8080** in desktop Chrome or Edge. Choose **Connect USB / Classic serial**, then your board. USB works on all targets. Pair `RC-Limiter` with the operating system first for ESP32 Bluetooth Classic SPP; the port picker must expose that serial service. Support depends on the browser/OS. Use Electron or Android when it does not. Use the separate **Connect C3 BLE serial** button for the C3 GATT UART service; browser/OS Web Bluetooth availability varies.

The browser requires a secure context (localhost or HTTPS) and user selection of the device. There is no cloud service and no Wi-Fi access point on the firmware. Chrome on Android does not provide this desktop Web Serial workflow; use the native app.

## Electron desktop

Install Node.js/npm, then:

```sh
npm ci
npm start
# Create an unpacked app for the current OS:
npm run package
```

The same web UI runs inside Electron with a device chooser. Node integration is disabled in the renderer. Choose a specific USB/Classic serial port or C3 BLE device; no device is selected automatically. Build outputs go under `build/desktop/`.

## Native Android

Open `android/` in Android Studio, allow Gradle sync, and run the app on an Android 8+ phone/tablet. Or use `cd android && ./gradlew assembleDebug` with Android SDK 35 installed. See [build instructions](docs/build.md).

- **USB OTG:** connect a data cable/OTG adapter, tap USB OTG, select the board and grant USB permission. Pico uses CDC ACM; ESP32 commonly uses CP210x, CH340, or FTDI USB UART. Supported by usb-serial-for-android.
- **Bluetooth:** pair `RC-Limiter` in Android settings, tap Bluetooth, grant Nearby devices permission on Android 12+, and choose the paired ESP32. It uses RFCOMM/SPP; no scan or location permission is needed for this path.
- **BLE C3:** tap BLE C3, grant Bluetooth scan/connect permissions on Android 12+, and choose the advertising RC-Limiter-C3 UART device. Android 8–11 requires Location permission and system Location enabled for BLE scanning. USB remains available if wireless permission is denied.
- Read board → edit → **DISARM** → Apply RAM → Save flash. Hold the receiver at neutral for one second before **ARM**. Input/output pulses and signal status update live.
- Import/export profiles through the system document picker. Going to the background or leaving the app requests disarm and disconnects; delivery is not guaranteed if the connection fails. Reconnect explicitly after returning.

## Behavior

Power-up, reset and receiver loss leave the board **disarmed**. Each output keeps sending its configured stop pulse while disarmed. Every mapped receiver input must remain within its neutral deadband for one second before an explicit ARM command succeeds. Loss or invalid pulse width on any input disarms all outputs; restoring signal does not rearm. App disconnect is not itself a firmware failsafe trigger: receivers continue controlling an armed board if disarm was not delivered. Use transmitter stop and a physical power cutoff.

Configuration edits and flash writes are rejected while armed. Applying settings restarts receiver acquisition and neutral dwell. Flash saves include a schema marker and checksum; invalid saved data falls back to defaults. The protocol is shared by USB and Bluetooth; use **one controller at a time**. The firmware does not arbitrate exclusive control between clients.

ESP32 Classic and C3 BLE are enabled for local configuration, without application authentication. Treat anyone who can connect as able to read/edit settings or arm/disarm. This prototype should be configured in a controlled bench environment.

Pico/Pico W uses USB only in this implementation. ESP32-S2/S3/C6 and Pico 2 are not supported targets here. Only conventional individual-channel RC PWM is supported; no SBUS, iBUS, PPM sum, DShot, or OneShot.

## Development

```sh
bash scripts/check.sh
```

This runs the C++ limiter tests with address/undefined-behavior sanitizers, JavaScript transport/profile tests, and JavaScript syntax checks. Board compilation commands and dependencies are in [build.md](docs/build.md). [protocol.md](docs/protocol.md) describes commands, all configuration fields, and mapping formulas. [validation.md](docs/validation.md) records verification and remaining physical tests.

```
firmware/rc_limiter/  Shared logic + Pico/ESP32 Arduino sketch
web/                 Browser/Electron configuration UI
electron/            Sandboxed desktop shell and serial port chooser
android/             Native Android app, USB and Bluetooth transports
docs/                Wiring, setup, protocol, commissioning and verification
tests/               Mapping, failsafe and command transport tests
```
