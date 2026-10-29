# CI builds and releases

[GitHub Actions](https://github.com/shadowroot/rc-limit/actions) runs `.github/workflows/build.yml` for pushes to `main`/`feature/**`, pull requests, manual dispatch and `v*` tags. Checks must pass before builds start. Build jobs are independent, so a failure on one board does not hide diagnostics for another.

Downloads are available under a successful run's **Artifacts** section (GitHub login required). Artifacts are kept for 14 days, subject to repository retention policy:

| Artifact | Contents |
|---|---|
| `firmware-pico` | RP2040 UF2, instructions, wiring/commissioning docs and checksums |
| `firmware-esp32` | Native ESP-IDF original ESP32 application, bootloader and partition table |
| `firmware-esp32c3` | C3 Super Mini native USB + BLE firmware components |
| `firmware-esp32c3-devkit` | C3 DevKitM-1 USB-UART + BLE firmware components |
| `app-android` | Native Android **debug** APK for sideload testing |
| `app-desktop-web` | Linux x64 Electron directory archive and browser web ZIP |
| `app-windows-x64` | Windows x64 NSIS installer EXE and standalone portable EXE |

Firmware ZIPs contain the exact source commit and inner `SHA256SUMS`. Original ESP32 bootloader is flashed at `0x1000`; C3 at `0x0`. Both use partitions at `0x8000`, application at `0x10000`. Follow the included README using all components. Pico uses BOOTSEL copy. Motor power must be disconnected. A successful build is not physical commissioning.

Android APKs use disposable runner debug keys: different runs may require uninstalling the prior APK before installing (which clears its app data). These are not signed production Android releases. Electron is an unpacked Linux x64 app; extract the whole archive, preserve permissions and run `linux-unpacked/rc-limit-desktop`. Windows downloads are `rc-limit-desktop-VERSION-windows-x64-setup.exe` (per-user installer) and `rc-limit-desktop-VERSION-windows-x64-portable.exe` (no installation). They are not Authenticode-signed; GPG signatures apply to source commits/tags, not Windows executables. Desktop automatic application updates and Android release signing are not configured. Extract `rc-limit-web.zip` and serve its `web/` directory on localhost or HTTPS for browser device APIs.

## Android SDK setup

The Android job overrides `android-actions/setup-android`'s default `tools platform-tools` package list. The obsolete standalone `tools` package is not needed: pinned command-line tools `12266719` supply `sdkmanager`, and the action installs `platform-tools`, `platforms;android-35` and `build-tools;35.0.0` explicitly. A verification step checks the exported SDK location, platform JAR, adb and aapt2 before Gradle runs, so SDK setup errors appear at their source.

## Windows builds

The `windows` job runs on `windows-2022`, installs locked npm dependencies with Node 22, builds the firmware-updater bundle and runs `npm run package:win`. Only the two completed EXE files are uploaded as `app-windows-x64`; a missing installer or portable build fails the job. Version tags attach both EXEs to the same draft release/checksum list as the other artifacts. `--publish never` prevents electron-builder from independently publishing releases. No signing secrets are required for these unsigned builds.

To build locally on Windows, install Node 22.12+ and run `npm ci`, then `npm run package:win`. Outputs are under `build/desktop/`. The installer runs per-user without elevation and allows selecting an install directory. Both packages include the web UI, USB/Bluetooth configuration and USB firmware updater. Platform/browser-driver behavior still needs testing on Windows hardware.

## Versioned release

After reviewing a passing main build, create a new signed tag using your configured GPG key:

```sh
git tag -s v0.2.0 -m 'RC Limit v0.2.0'
git push origin v0.2.0
```

Choose an unused version. Pushing a `v*` tag rebuilds that exact commit. Once checks, all four board builds and Linux, Windows and Android app jobs pass, CI creates a **draft** [GitHub Release](https://github.com/shadowroot/rc-limit/releases) with firmware ZIPs, apps and outer `SHA256SUMS`. Review its assets/notes and publish it in GitHub. A pre-existing release is reused on reruns and matching asset names are replaced. No tag or public release is created by a regular main push or manual workflow run.

The release job alone has `contents: write`; checks/build jobs have read access. The built-in `GITHUB_TOKEN` is used; no personal token or signing secrets are required. Repository Actions policy must allow the referenced actions and workflow token write access. Pull requests never receive release credentials. GPG signatures belong to source commits/tags; SHA256 checksums are integrity checks, not GPG signatures on binaries.

Local firmware packaging after a successful build:

```sh
./scripts/deploy.sh pio esp32c3 --build-only
python3 scripts/package-firmware.py esp32c3
```

Output: `build/releases/rc-limit-esp32c3.zip`. No device is opened by packaging. CI downloads pinned toolchains on its first run and caches PlatformIO packages by board and configuration hash.

## GitHub Pages continuous deployment

`.github/workflows/pages.yml` validates and uploads only `web/`. Web-related changes on `main` deploy automatically; pull requests validate/upload a preview artifact without publishing. Manual runs on `main` deploy the current web UI. The deployment job uses the `github-pages` environment and limited `pages: write` / `id-token: write` permissions. No PAT or cloud service is needed.

One-time repository setup: open **Settings → Pages → Build and deployment → Source → GitHub Actions**. The connected GitHub app cannot access this repository's administration settings, so this setting must be enabled by a repository admin. Then run **Deploy web UI to GitHub Pages** from Actions on `main`, or merge a web change. See [GitHub's publishing-source instructions](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site).

Expected URL after a successful deployment: **https://shadowroot.github.io/rc-limit/**. The app uses relative module, stylesheet and board-data paths; browser integration checks serve it under `/rc-limit/` to exercise project-site hosting. HTTPS supplies a secure context; browser and OS support for Web Serial/Web Bluetooth and explicit device permission are still required. This is the static configuration app; board communication stays between the browser and the selected USB/Bluetooth device.

Feature branches do not deploy production. Merge the Pages feature branch into `main` to activate its trigger. Firmware and Android/Electron build failures do not gate Pages; its own application checks must pass. The release workflow remains separate.
