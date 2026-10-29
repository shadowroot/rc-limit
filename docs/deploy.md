# Deployment scripts

## Preferred PlatformIO setup

ESP32 and C3 deployment now defaults to native ESP-IDF. Install Python 3 with venv/pip, Git and build tools, then:

```sh
./scripts/setup-pio.sh all
./scripts/deploy.sh ports
./scripts/deploy.sh esp32 --port /dev/ttyUSB0
./scripts/deploy.sh esp32c3 --port /dev/ttyACM0
./scripts/deploy.sh esp32c3-devkit --port /dev/ttyUSB0
./scripts/deploy.sh pio pico --mount /media/USER/RPI-RP2
# Build without selecting hardware:
./scripts/deploy.sh pio pico --build-only
```

Setup creates `.tools/pio-venv` and `.tools/platformio`; versions are pinned in `scripts/requirements-pio.txt` and `platformio.ini`. Override `RC_LIMIT_PIO` with an existing `pio` executable, `PLATFORMIO_CORE_DIR` with a package/cache directory, and `RC_LIMIT_PIO_TMP` with a temporary directory. `--dry-run` executes no commands or filesystem changes. Firmware outputs are copied to `build/pio/TARGET`.

The Arduino commands below remain an optional fallback: add `--arduino` to ESP32/C3 `deploy.sh` invocations after `setup-firmware.sh`. Pico's direct `deploy.sh pico` command still uses Arduino CLI; `deploy.sh pio pico` uses PlatformIO. `ports --arduino` lists devices through Arduino CLI. Do not erase flash on upgrade; export profiles first and read [native migration details](build.md).

See [CI and release downloads](releases.md) for prebuilt firmware and app artifacts.

The scripts run on Linux/macOS with Bash. Windows users can use Git Bash with the Windows versions of Arduino CLI, Java, adb, Node and npm. Device names must be visible to those tools; Windows USB devices are not automatically available inside WSL.

Run these commands from the project root. The scripts also work when invoked by absolute path from another directory. File arguments such as `--apk` resolve relative to the project root.

## Optional Arduino CLI setup (once per checkout)

Install Arduino CLI and Python 3, then:

```sh
./scripts/setup-firmware.sh all
# Or install just the target you need:
./scripts/setup-firmware.sh pico
./scripts/setup-firmware.sh esp32
./scripts/setup-firmware.sh esp32c3
```

This downloads pinned cores and ArduinoJson into ignored `.tools/arduino/`. It does not change your global Arduino configuration. It reuses an existing project configuration and can be rerun after a failed download.

## Build and flash

Disconnect motor power, close serial monitors and configuration apps, and identify your board:

```sh
./scripts/deploy.sh ports
./scripts/deploy.sh pico --port /dev/ttyACM0
./scripts/deploy.sh esp32 --port /dev/ttyUSB0
# C3 Super Mini native USB:
./scripts/deploy.sh esp32c3 --port /dev/ttyACM0
# C3 DevKitM-1 onboard USB-to-UART:
./scripts/deploy.sh esp32c3-devkit --port /dev/ttyUSB0
# Windows example:
./scripts/deploy.sh esp32 --port COM5
```

Each flash command first compiles the current source, stops on build failure, and uploads those newly generated artifacts to the selected port. No port is selected automatically. Pico, original ESP32, C3 Super Mini and official C3 DevKitM-1 targets are configured. The two C3 native targets select USB Serial/JTAG versus UART0 so the configuration stream uses the selected board connector. The Arduino fallback uses the equivalent USB CDC On Boot option. After upload, read back the settings before restoring motor power; arming remains an explicit app action.

For a fresh Pico, hold BOOTSEL while connecting USB, then release it. Pass the mounted **RPI-RP2 volume**, not a raw block device:

```sh
./scripts/deploy.sh pico --mount /media/your-name/RPI-RP2
# macOS:
./scripts/deploy.sh pico --mount /Volumes/RPI-RP2
```

The script checks `INFO_UF2.TXT` for the RP2040 board identifier and copies the freshly compiled UF2. It does not format or mount a disk. A copy finishing means the UF2 was handed to the bootloader; verify the board reconnects and reports the expected settings. If the Pico is already running USB serial firmware, use `--port` instead.

To compile without touching hardware:

```sh
./scripts/deploy.sh pico --build-only
./scripts/deploy.sh esp32 --build-only
./scripts/deploy.sh esp32c3 --build-only
./scripts/deploy.sh esp32c3-devkit --build-only
```

Native/PlatformIO artifacts go to `build/pio/TARGET/`, with compiler files in `.pio/build/TARGET/`. Arduino CLI artifacts go to `build/TARGET/`, with compiler files in `build/work-TARGET/`.

## Install the native Android app

Install Java 17/21, Android SDK 35, Build Tools 35.0.0, and platform-tools (`adb`). Configure the SDK through Android Studio, `ANDROID_HOME`, or `android/local.properties`. Enable USB debugging on the phone and approve its debugging prompt. List device IDs:

```sh
adb devices
./scripts/deploy.sh android --serial YOUR_DEVICE_ID --launch
```

This checks the specified device, builds a debug APK with the Gradle wrapper, copies it to `build/android/rc-limit-debug.apk`, installs it with `adb install -r`, and launches it when `--launch` is supplied. Without `--launch`, it installs only. A device ID is mandatory even when only one phone is connected. The scripts never select an arbitrary phone or emulator.

Build an APK without connecting a device, or install an already built APK:

```sh
./scripts/deploy.sh android --build-only
./scripts/deploy.sh android --serial YOUR_DEVICE_ID --apk build/android/rc-limit-debug.apk --launch
```

These are debug builds for local sideloading, not signed release/store deployments. `install -r` preserves existing app data when the signing identity is compatible. An incompatible signature causes installation to fail; the script does not uninstall the existing app or delete its data.

## Start the configuration interface

```sh
./scripts/deploy.sh web
./scripts/deploy.sh web --port 8090
```

Open the printed localhost URL in desktop Chrome/Edge. The server binds to `127.0.0.1`; use Ctrl+C to stop it. This serves the UI on your computer; it does not upload a website to the Pico/ESP32 or publish it remotely.

For Electron, install Node 22.12+ and npm:

```sh
./scripts/deploy.sh desktop
# Reinstall dependencies from the lockfile before launching:
./scripts/deploy.sh desktop --install
# Install locked dependencies and build an unpacked app for this computer's OS:
./scripts/deploy.sh desktop --package
```

The first desktop launch installs dependencies if Electron is missing. Use `--install` after pulling dependency changes. Packaging always runs `npm ci` first and writes to `build/desktop/`. Launching clears the inherited `ELECTRON_RUN_AS_NODE` variable in the child process, so a Codex/IDE environment does not force Electron into Node-only mode. It does not disable Electron's sandbox.

## Inspect commands without deploying

Append `--dry-run` anywhere:

```sh
./scripts/setup-firmware.sh all --dry-run
./scripts/deploy.sh esp32 --port /dev/ttyUSB0 --dry-run
./scripts/deploy.sh android --serial YOUR_DEVICE_ID --launch --dry-run
```

A dry run prints shell-quoted commands and does not run tools, create configuration, write artifacts, flash, install, or start servers. It does not prove that a port, SDK, mounted volume or toolchain is available. Syntax and option conflicts are still checked.

## Tool overrides

| Environment variable | Default | Purpose |
|---|---|---|
| `RC_LIMIT_ARDUINO_CLI` | `arduino-cli` | Arduino CLI executable path |
| `RC_LIMIT_ARDUINO_CONFIG` | Project `.tools/arduino/arduino-cli.yaml` | Use a different Arduino configuration; absolute path recommended |
| `RC_LIMIT_ADB` | `adb` | Android platform-tools executable path |
| `RC_LIMIT_NPM` | `npm` | npm executable path |

For example:

```sh
RC_LIMIT_ARDUINO_CLI=/opt/arduino-cli ./scripts/setup-firmware.sh pico
RC_LIMIT_ADB="$ANDROID_HOME/platform-tools/adb" ./scripts/deploy.sh android --serial YOUR_DEVICE_ID --apk build/android/rc-limit-debug.apk
```

An existing overridden Arduino configuration is preserved. If you supply one, ensure it already includes the board index URLs shown in [build.md](build.md). The scripts do not use sudo, change device permissions, automatically install OS packages, arm the limiter, or select a Bluetooth connection. Pair Classic SPP through the OS; connect C3 BLE directly through the app's BLE chooser after deployment.
