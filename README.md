# RC Limit

A receiver-to-ESC PWM limiter for **Raspberry Pi Pico (RP2040)** and **original ESP32 DevKit / ESP32-WROOM-32**. Configure **one to four pin mappings**, each taking a receiver PWM input and producing a constrained 50 Hz ESC signal. Bidirectional mode is the default.

Configure it with the local **web app**, the **Electron desktop app**, or the **native Android app** (Java, native views, no WebView). Configuration includes receiver and ESC GPIOs, calibrated pulse endpoints and neutral, independent forward/reverse limits, clamp/scaled mapping, direction inversion, deadband, and receiver timeout. Profiles are interchangeable JSON files.

This limits the ESC command, not measured motor speed, current, torque, or power. A 30% limit means 30% of the calibrated pulse excursion from stop. It is a bench prototype, with hardware commissioning still required.

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

| Mapping | Pico input → output | ESP32 input → output |
|---|---|---|
| 1 | GP4 → GP5 | GPIO27 → GPIO25 |
| 2 | GP6 → GP7 | GPIO26 → GPIO33 |
| 3 | GP8 → GP9 | GPIO32 → GPIO18 |
| 4 | GP10 → GP11 | GPIO19 → GPIO21 |

These are suggestions, not fixed assignments. A single receiver GPIO may feed multiple output mappings with different limits. Outputs must be unique and cannot also serve as receiver inputs. Pico outputs 16 GPIOs apart cannot be used independently because they alias one hardware PWM channel. The apps and firmware validate these conflicts.

All mapped inputs must be valid and held at stop for one second before **ARM ALL** succeeds. Losing any mapped input stops and disarms **every output**. Receiver restoration never rearms the board. Do not add an unused/unwired input mapping: it will prevent arming. To remove one, remove it from the draft and Apply all while disarmed.

Profiles now export as `{"version":2,"mappings":[...]}`. Old single-channel profile files and saved firmware configurations are read as one mapping; a subsequent save writes the new format. Upgrade firmware to use multiple mappings. Example profiles are in [examples/](examples/).

## USB and Bluetooth serial

USB serial remains available at **115200 baud on both boards**: Pico uses native USB CDC, while the original ESP32 DevKit uses its onboard USB-to-UART bridge. ESP32 **Bluetooth Classic SPP starts automatically** alongside USB as **RC-Limiter**. Both transports accept exactly the same mapping, limits, save, telemetry and arm/disarm commands. Pair with the OS first for Bluetooth; then select its serial service in the web/Electron chooser or tap Bluetooth in Android. The GUI reports USB availability and the actual Bluetooth startup result reported by the firmware.

The standard Pico has no onboard Bluetooth, and this firmware does not add a Bluetooth stack for Pico W. Pico configuration uses USB serial. BLE-only ESP32 variants require different firmware and are not covered by this Classic-SPP target. Use one controller at a time; simultaneous USB and Bluetooth clients can change the same board state.

## Web app

No frontend build or dependencies:

```sh
cd rc-limit
python3 -m http.server 8080 --bind 127.0.0.1 --directory web
```

Open **http://localhost:8080** in desktop Chrome or Edge. Choose **Connect serial / Bluetooth**, then your board. USB works with both boards. Pair `RC-Limiter` with the operating system first for ESP32 Bluetooth Classic SPP; the port picker must expose that serial service. Support depends on the browser/OS. Use Electron or Android when it does not. Web Bluetooth BLE is a different protocol.

The browser requires a secure context (localhost or HTTPS) and user selection of the device. There is no cloud service and no Wi-Fi access point on the firmware. Chrome on Android does not provide this desktop Web Serial workflow; use the native app.

## Electron desktop

Install Node.js/npm, then:

```sh
npm ci
npm start
# Create an unpacked app for the current OS:
npm run package
```

The same web UI runs inside Electron with a device chooser. Node integration is disabled in the renderer. Choose a specific USB or paired Bluetooth serial port; no device is selected automatically. Build outputs go under `build/desktop/`.

## Native Android

Open `android/` in Android Studio, allow Gradle sync, and run the app on an Android 8+ phone/tablet. Or use `cd android && ./gradlew assembleDebug` with Android SDK 35 installed. See [build instructions](docs/build.md).

- **USB OTG:** connect a data cable/OTG adapter, tap USB OTG, select the board and grant USB permission. Pico uses CDC ACM; ESP32 commonly uses CP210x, CH340, or FTDI USB UART. Supported by usb-serial-for-android.
- **Bluetooth:** pair `RC-Limiter` in Android settings, tap Bluetooth, grant Nearby devices permission on Android 12+, and choose the paired ESP32. It uses RFCOMM/SPP, not BLE. No location permission or device scan is needed.
- Read board → edit → **DISARM** → Apply RAM → Save flash. Hold the receiver at neutral for one second before **ARM**. Input/output pulses and signal status update live.
- Import/export profiles through the system document picker. Going to the background or leaving the app requests disarm and disconnects; delivery is not guaranteed if the connection fails. Reconnect explicitly after returning.

## Behavior

Power-up, reset and receiver loss leave the board **disarmed**. Each output keeps sending its configured stop pulse while disarmed. Every mapped receiver input must remain within its neutral deadband for one second before an explicit ARM command succeeds. Loss or invalid pulse width on any input disarms all outputs; restoring signal does not rearm. App disconnect is not itself a firmware failsafe trigger: receivers continue controlling an armed board if disarm was not delivered. Use transmitter stop and a physical power cutoff.

Configuration edits and flash writes are rejected while armed. Applying settings restarts receiver acquisition and neutral dwell. Flash saves include a schema marker and checksum; invalid saved data falls back to defaults. The protocol is shared by USB and Bluetooth; use **one controller at a time**. The firmware does not arbitrate exclusive control between clients.

ESP32 Classic Bluetooth is enabled for local configuration, without application authentication. Treat anyone who can connect as able to read/edit settings or arm/disarm. This prototype should be configured in a controlled bench environment.

Pico/Pico W uses USB only in this implementation. ESP32-S2/S3/C3/C6 and Pico 2 are not supported targets here. Only conventional individual-channel RC PWM is supported; no SBUS, iBUS, PPM sum, DShot, or OneShot.

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
