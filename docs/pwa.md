# Install and use the web PWA

Open [RC Limit](https://shadowroot.github.io/rc-limit/) over HTTPS in a compatible browser. Choose **Install app** in the interface, or the browser's **Install app / Add to Home screen** menu. Start the installed RC Limit icon to use a separate app window. On desktop, Chrome/Edge can install it; on Android, use Chrome. A first successful online load prepares the offline interface. English/Czech selection is remembered.

The native Android implementation has been removed. New CI/release builds contain the web PWA instead of an APK. Electron remains available for desktop use. Existing APKs in historical releases are not updated by installing the PWA.

## Device connections

Installation preserves the browser's capabilities; it does not add USB drivers or bypass device permissions. Always select a specific board from its chooser. There is no cloud relay or Wi-Fi service on the firmware.

| Connection | How to use it |
|---|---|
| C3 BLE UART | **Connect C3 BLE serial**. Chrome on Android supports Web Bluetooth; choose the board advertising its saved `RC-` name. Bluetooth and browser permissions must be enabled. |
| Original ESP32 Classic SPP | Pair in the OS, then **Connect USB / Classic serial** in a browser providing Web Serial Bluetooth RFCOMM, or use Electron. |
| Pico / ESP32 / C3 USB serial | Use **Connect USB / Classic serial** where Web Serial exposes the board. Desktop Chrome/Edge and Electron are the established path. Android wired support depends on the phone's OS/system serial API and browser; do not assume that a USB OTG cable alone is sufficient. |
| ESP firmware USB update | Requires Web Serial access to the bootloader, separately from the configuration connection. Use a desktop browser/Electron if the phone cannot expose it. |
| Pico UF2 update | Export the verified UF2, hold BOOTSEL while reconnecting USB, and copy it to the `RPI-RP2` volume on a host that can access that drive. |

Chrome documents [Web Bluetooth availability](https://developer.chrome.com/docs/capabilities/bluetooth) and [Web Serial](https://developer.chrome.com/docs/capabilities/serial). Its [Android serial platform announcement](https://groups.google.com/a/chromium.org/g/blink-dev/c/yGhvQ6mEmcY) distinguishes existing Bluetooth RFCOMM from wired support requiring a system serial API on compatible devices. Test your exact browser/phone/board. An installable app can still lack a required hardware API.

## Offline use and updates

The service worker caches a versioned copy of the interface, all configuration code, board diagrams, Czech catalog, icons and the lazy firmware validator/updater. Profiles still import/export as ordinary JSON files. A firmware ZIP already saved on the device can be loaded and verified offline.

Stable and development firmware catalogs and bundled firmware ZIP requests always use the network. They are not served from the interface cache, so offline mode cannot silently replace a newly published release with an old cached one. Download a matching ZIP while online if you will need it later.

App updates install in the background and wait while any tab/window using the app remains open. When **App update ready** appears, finish configuration/flashing, then close **all** RC Limit browser tabs and installed windows before reopening. There is no forced reload, activation button or automatic reconnection to hardware. The current page and its cached assets keep the same version throughout a session.

App closure/disconnection does not stop receiver control. Return transmitter inputs to neutral and use the physical cutoff as needed. Backgrounding a mobile browser may suspend a connection; reopen and reconnect explicitly. Firmware's receiver failsafe runs independently.

## Build and host

```sh
npm ci --ignore-scripts
npm run package:web
python3 -m http.server 8080 --bind 127.0.0.1 --directory web
```

Open `http://localhost:8080`. For a phone, use the HTTPS Pages site or your own HTTPS host; another machine's plain HTTP LAN address is not a secure localhost context. `web/manifest.webmanifest`, icons, and generated `web/sw.js` must be deployed together. All URLs and scope are relative, supporting `/rc-limit/` and other subpaths. Serve `.mjs`/`.js` as JavaScript and the manifest as JSON/`application/manifest+json`.

`npm run build:web` generates the service worker version from the complete application shell and worker source. Run it after any web source change. `npm run package:web` also refreshes the README ZIP; CI verifies its contents. Firmware, Electron and Pages release paths are preserved. For browser verification, run `npx playwright install --with-deps chromium`, then `CHROMIUM_PATH="$(node -p "require('playwright').chromium.executablePath()")" npm run test:pwa` after packaging. CI runs this check in the web job. No hardware is selected by that test.
