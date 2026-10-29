# USB firmware updates

Open **Update firmware over USB** below the configuration controls in the web/Electron app. Download the firmware ZIP for your exact board from [RC Limit releases](https://github.com/shadowroot/rc-limit/releases), or from a successful Actions run. Extract the Actions artifact's outer ZIP to get the inner `rc-limit-BOARD.zip`; select that inner ZIP in the updater. Packages created before the update manifest was added are rejected; build/package a fresh bundle instead.

1. Export your configuration profile, disarm, and disconnect the configuration session. Close other serial monitors/controllers.
2. Disconnect motor power. Select the physical board model and its matching firmware ZIP.
3. Click **Verify release ZIP**. Confirm the board/source commit and acknowledge the power/backup checkbox.
4. For ESP32/C3, click **Choose USB port & flash**, select the actual USB device, and keep USB connected until verification completes. If automatic bootloader entry fails, hold BOOT and tap RESET; native USB may re-enumerate and need port selection again.
5. For Pico RP2040, click **Export Pico UF2**, hold BOOTSEL while reconnecting USB, then copy the exported file to the **RPI-RP2** volume. The browser export itself does not flash a Pico. Pico 2 and Pico W wireless updates are not supported.
6. After reboot, reconnect the configuration app, read settings and check pins, neutral, limits and all failsafes before restoring motor power. Import the backed-up profile if necessary; save explicitly. Follow commissioning instructions.

USB flashing uses Espressif's [esptool-js](https://github.com/espressif/esptool-js) **0.7.0**, bundled locally. It requires desktop Chrome/Edge Web Serial or Electron with its explicit port chooser. Native Android remains a configuration app; this feature does not add Android firmware flashing. The [CLI deployment scripts](deploy.md) remain available for all four boards.

## Validation and persistence

Firmware packages contain `update-manifest.json` with project/format version, exact board variant, source commit, chip, and each image's size, offset and SHA-256. The browser rejects missing components, mismatched board, altered image contents, unsupported partition layouts, wrong image chip IDs and non-RP2040 UF2 blocks. ZIP input and extracted firmware sizes are bounded. It never runs scripts from a ZIP or accepts arbitrary user-entered flash offsets.

ESP bootloader writes start at `0x1000` on original ESP32 or `0x0` on C3; partitions at `0x8000`; app at `0x10000`. The detected chip and 4 MB flash size must match before writing. C3 Super Mini and DevKitM-1 share the chip ID, so physical board selection remains necessary to choose native USB versus UART firmware. ESP image headers are retained. esptool verifies flash contents using MD5 after each component write.

No full-chip erase is requested. The NVS region at `0x9000` is excluded from writes; images are separate to avoid erasing settings through a merged image's padding. Native firmware's existing legacy EEPROM-to-NVS migration still applies. Backups remain necessary for upgrades and failed/interrupted writes. If a transfer fails, keep motor power disconnected, enter the USB bootloader and retry the complete bundle or use the CLI. A disconnected cable can leave partial firmware; failure must not be treated as a successful update.

SHA-256/MD5 detect corruption; these do not authenticate a release author. Select bundles from this project's trusted release/source. Source commits/tags use GPG; the updater does not verify GPG signatures on binaries. No OTA partition, Wi-Fi update server, Bluetooth flashing or automatic firmware installation is added.

## Building and testing

```sh
npm ci --ignore-scripts
npm run build:web
./scripts/deploy.sh web
# After building firmware:
python3 scripts/package-firmware.py esp32c3
bash scripts/check.sh
```

Only the updater requires the bundle; the configuration modules remain usable directly. `npm start` and `npm run package` build the bundle automatically. Electron's packaging hook prepares the desktop bundle; the independent web job creates the static ZIP. Static web CI builds and verifies the downloadable ZIP with `python3 scripts/package-web.py --check`; use `npm run package:web` to regenerate the README download. No CDN script or cross-origin firmware fetch is needed. Third-party licenses are included under `web/dist/third-party-licenses.txt`.

The optional `tests/firmware-ui-smoke.cjs` needs Playwright/Chromium and real ZIPs in `build/releases/`. It validates loading under `/rc-limit/`, wrong-board rejection, power acknowledgement, simulated USB chooser cancellation/recovery and Pico download. Flash planning tests use mocked loaders; physical bootloader, flash verification, reset, reconnect and settings retention still require testing on each actual board. No hardware is flashed by the tests.

## Naming boards after an update

After reboot, connect the updated board, find **Device identity**, enter e.g. `Boat port ESC`, and click **Save device name** while disarmed. Native Android has the same name field/button. The name is saved immediately on the board, independently of throttle settings. Names remain through later updates that preserve the settings area. New/unnamed boards show a unique hardware-derived default and every reply also includes the stable hardware ID.

Restart a Bluetooth board with motor power disconnected to advertise `RC-` plus its new name. USB port-picker labels may remain generic; the app shows the custom name/ID after connecting. See [device identity protocol](protocol.md#device-identity-and-naming) for allowed characters and storage/downgrade details.
