# CI builds and releases

[GitHub Actions](https://github.com/shadowroot/rc-limit/actions) runs `.github/workflows/build.yml` for pushes to `main`/`feature/**`, pull requests, manual dispatch and `v*` tags. Checks must pass before builds start. Build jobs are independent, so a failure on one board does not hide diagnostics for another.

Downloads are available under a successful run's **Artifacts** section (GitHub login required). Artifacts are kept for 14 days, subject to repository retention policy:

| Artifact | Contents |
|---|---|
| `firmware-pico` | RP2040 UF2, instructions, wiring/commissioning docs and checksums |
| `firmware-esp32` | Native ESP-IDF original ESP32 application, bootloader and partition table |
| `firmware-esp32c3` | C3 Super Mini native USB + BLE firmware components |
| `firmware-esp32c3-devkit` | C3 DevKitM-1 USB-UART + BLE firmware components |
| `app-desktop-linux-x64` | Linux x64 Electron directory archive |
| `app-web` | Ready-to-serve static web ZIP, identical to the README download |
| `app-windows-x64` | Windows x64 NSIS installer EXE and standalone portable EXE |

Firmware ZIPs contain the exact source commit and inner `SHA256SUMS`. Original ESP32 bootloader is flashed at `0x1000`; C3 at `0x0`. Both use partitions at `0x8000`, application at `0x10000`. Follow the included README using all components. Pico uses BOOTSEL copy. Motor power must be disconnected. A successful build is not physical commissioning.

Electron is an unpacked Linux x64 app; extract the whole archive, preserve permissions and run `linux-unpacked/rc-limit-desktop`. Windows downloads are `rc-limit-desktop-VERSION-windows-x64-setup.exe` (per-user installer) and `rc-limit-desktop-VERSION-windows-x64-portable.exe` (no installation). They are not Authenticode-signed; GPG signatures apply to source commits/tags, not Windows executables. Desktop automatic application updates are not configured. The web artifact is an installable PWA; no Android APK is produced. Extract `rc-limit-web.zip` and serve its `web/` directory on localhost or HTTPS for browser device APIs.


## Windows builds

The `windows` job runs on `windows-2022`, installs locked npm dependencies with Node 22, builds the firmware-updater bundle and runs `npm run package:win`. Only the two completed EXE files are uploaded as `app-windows-x64`; a missing installer or portable build fails the job. Version tags attach both EXEs to the same draft release/checksum list as the other artifacts. `--publish never` prevents electron-builder from independently publishing releases. No signing secrets are required for these unsigned builds.

To build locally on Windows, install Node 22.12+ and run `npm ci`, then `npm run package:win`. Outputs are under `build/desktop/`. The installer runs per-user without elevation and allows selecting an install directory. Both packages include the web UI, USB/Bluetooth configuration and USB firmware updater. Platform/browser-driver behavior still needs testing on Windows hardware.

## Versioned release

After reviewing a passing main build, create a new signed tag using your configured GPG key:

```sh
git tag -s v0.2.0 -m 'RC Limit v0.2.0'
git push origin v0.2.0
```

Choose an unused version. Pushing a `v*` tag rebuilds that exact commit. Once checks, all four board builds and Linux, Windows and web app jobs pass, CI creates a **draft** [GitHub Release](https://github.com/shadowroot/rc-limit/releases) with firmware ZIPs, apps and outer `SHA256SUMS`. Review its assets/notes and publish it in GitHub. A pre-existing release is reused on reruns and matching asset names are replaced. No tag or public release is created by a regular main push or manual workflow run.

The release job alone has `contents: write`; checks/build jobs have read access. The built-in `GITHUB_TOKEN` is used; no personal token or signing secrets are required. Repository Actions policy must allow the referenced actions and workflow token write access. Pull requests never receive release credentials. GPG signatures belong to source commits/tags; SHA256 checksums are integrity checks, not GPG signatures on binaries.

Local firmware packaging after a successful build:

```sh
./scripts/deploy.sh pio esp32c3 --build-only
python3 scripts/package-firmware.py esp32c3
```

Output: `build/releases/rc-limit-esp32c3.zip`. No device is opened by packaging. CI downloads pinned toolchains on its first run and caches PlatformIO packages by board and configuration hash.

## Static web download

The README links to the Pages-hosted `rc-limit-web.zip`, which includes the latest published stable firmware for all four boards. The tracked `downloads/rc-limit-web.zip` remains a UI-only development snapshot for source verification; it does not label development firmware as stable. Extract the whole archive and follow its `README.txt` to serve `web/` on localhost using Python, or upload `web/` to a static HTTPS host. The archive includes the bundled firmware updater and third-party licenses. It needs neither Node.js nor a build step to use. The same assets are also deployed to GitHub Pages as described below.

The independent `web` CI job installs locked npm dependencies without lifecycle scripts, builds the updater and verifies the UI snapshot. It then downloads the latest published non-prerelease firmware and includes all four ZIPs in the `app-web` artifact, independently of Linux Electron packaging. Versioned releases include it alongside other artifacts. Before committing web changes, run `npm ci --ignore-scripts` and `npm run package:web`, then commit the updated ZIP. `web/BUILD.json` inside the archive lists the asset SHA-256 values; comparison uses file contents to tolerate zlib compression differences between machines.

## GitHub Pages

`.github/workflows/pages.yml` builds and validates the web UI and checked-in download. Pushes to `main` affecting web assets/build inputs deploy `web/` to **https://shadowroot.github.io/rc-limit/**. Pull requests validate without publishing; manual runs deploy only when targeting `main`. The separate ZIP download and `app-web` artifact remain available.

If Pages is not already enabled, select **Settings → Pages → Build and deployment → Source → GitHub Actions**, then run **Deploy web UI to GitHub Pages** on `main`. The deployment uses the `github-pages` environment with `pages: write` and `id-token: write`. No personal token is needed. The connected GitHub app cannot manage this repository's administration settings, so initial activation must be done by an admin.

The site needs a browser/OS with Web Serial or Web Bluetooth support and explicit device permission. Device communication stays local to your browser and selected board. Both the hosted site and the downloaded archive use the same relative asset paths, tested under `/rc-limit/`.

## Bundled stable firmware

Stable means the release returned by GitHub's `/releases/latest` API: published and not a prerelease. Both Pages and the standalone distribution include `firmware/catalog.json` and all four per-board packages under `firmware/stable/`. The updater shows the release tag, offers a download for the selected board and **Use bundled stable firmware**, then applies the existing board/chip/hash validation and power acknowledgement before any USB flashing. Pico exports UF2 for BOOTSEL. Old releases without update manifests remain download-only.

`fetch-stable-firmware.py` requires all four packages and matching entries in the release's `SHA256SUMS`. Missing or corrupt assets fail the build, leaving the previous deployed site intact. It never substitutes main/nightly builds. If no stable release exists, the catalog is empty and the UI explains that condition; publish a complete stable release to supply the firmware. Repository access errors can also cause a 404, so CI uses its repository-scoped token.

Pages rebuilds on stable release publication, relevant main changes, manual dispatch and a daily 04:23 UTC schedule. It serves the standalone ZIP at `https://shadowroot.github.io/rc-limit/rc-limit-web.zip`. A separate job refreshes `rc-limit-web.zip` and its checksum on the latest stable release when that release is mutable, preserving all firmware checksums. Immutable releases are left intact; Pages and `app-web` still provide the current standalone distribution. No tags are created or moved. GitHub API downloads occur in CI, so the browser needs no token, GitHub API access or cross-origin firmware downloads; the extracted ZIP also works offline on localhost.

To create a distribution manually: `npm run build:web`, then `GITHUB_TOKEN=... python3 scripts/fetch-stable-firmware.py`, then `python3 scripts/package-web.py`. Keep tokens in the environment; do not commit them or generated stable firmware. The download script supports `--repo owner/repo`. Source UI snapshot checks run before CI overlays stable assets.
