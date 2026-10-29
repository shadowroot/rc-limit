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
| `app-desktop-linux-x64` | Linux x64 Electron directory archive |
| `app-web` | Ready-to-serve static web ZIP, identical to the README download |
| `app-windows-x64` | Windows x64 NSIS installer EXE and standalone portable EXE |

Firmware ZIPs contain the exact source commit and inner `SHA256SUMS`. Original ESP32 bootloader is flashed at `0x1000`; C3 at `0x0`. Both use partitions at `0x8000`, application at `0x10000`. Follow the included README using all components. Pico uses BOOTSEL copy. Motor power must be disconnected. A successful build is not physical commissioning.

Android APKs use disposable runner debug keys: different runs may require uninstalling the prior APK before installing (which clears its app data). These are not signed production Android releases. Electron is an unpacked Linux x64 app; extract the whole archive, preserve permissions and run `linux-unpacked/rc-limit-desktop`. Windows downloads are `rc-limit-desktop-VERSION-windows-x64-setup.exe` (per-user installer) and `rc-limit-desktop-VERSION-windows-x64-portable.exe` (no installation). They are not Authenticode-signed; GPG signatures apply to source commits/tags, not Windows executables. Desktop automatic application updates and Android release signing are not configured. Extract `rc-limit-web.zip` and serve its `web/` directory on localhost or HTTPS for browser device APIs.

## Android SDK setup

The Android job overrides `android-actions/setup-android`'s default `tools platform-tools` package list. The obsolete standalone `tools` package is not needed: pinned command-line tools `12266719` supply `sdkmanager`, and the action installs `platform-tools`, `platforms;android-35` and `build-tools;35.0.0` explicitly. A verification step checks the exported SDK location, platform JAR, adb and aapt2 before Gradle runs, so SDK setup errors appear at their source.

`gradle/actions/setup-gradle@v4` caches dependencies, wrapper distributions and Gradle task outputs. `org.gradle.caching=true` enables reuse of cacheable Android tasks after restoring that cache. Push builds can save cache entries; pull requests restore them read-only. A separate cache retains command-line tools 16.0 (build 12266719), avoiding the repeated command-line tools ZIP download. The job reuses the runner’s SDK root and preinstalled platform/build tools. Keep the cached directory version and key aligned with the pinned setup version when upgrading. The first run fills caches; later builds benefit.

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

## Static web download

The README links directly to tracked `downloads/rc-limit-web.zip`. Extract the whole archive and follow its `README.txt` to serve `web/` on localhost using Python, or upload `web/` to a static HTTPS host. The archive includes the bundled firmware updater and third-party licenses. It needs neither Node.js nor a build step to use. GitHub Pages deployment and its permissions/environment are no longer configured by this project.

The independent `web` CI job installs locked npm dependencies without lifecycle scripts, builds the updater, and verifies that the checked-in download matches every generated/static file. It uploads the same ZIP as `app-web`, independently of Linux Electron packaging. Versioned releases include it alongside other artifacts. Before committing web changes, run `npm ci --ignore-scripts` and `npm run package:web`, then commit the updated ZIP. `web/BUILD.json` inside the archive lists the asset SHA-256 values; comparison uses file contents to tolerate zlib compression differences between machines.

The obsolete `Deploy web UI to GitHub Pages` workflow is deleted. If a site was already published, an administrator can unpublish it under repository Settings → Pages; removing a workflow alone does not unpublish a previously deployed site. The connected GitHub app cannot manage this repository's Pages settings.
