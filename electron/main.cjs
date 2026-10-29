const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
// Chromium gates Web Bluetooth behind this switch on Linux. Device selection and
// the local-page permission handlers below remain mandatory; sandboxing stays on.
if (process.platform === 'linux') app.commandLine.appendSwitch('enable-experimental-web-platform-features');
let window, choose, ports = [], chooseBle, bleDevices = [];
const pagePath = path.join(__dirname, '../web/index.html');
const pageUrl = pathToFileURL(pagePath).href;
function trusted(sender) { return window && sender === window.webContents && sender.getURL().split('#')[0] === pageUrl; }
app.whenReady().then(() => {
  window = new BrowserWindow({ width: 1280, height: 920, backgroundColor: '#101413',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false } });
  const session = window.webContents.session;
  const allowedPermission = permission => ['serial', 'bluetooth', 'bluetooth-scanning'].includes(permission);
  session.setPermissionCheckHandler((contents, permission) => trusted(contents) && allowedPermission(permission));
  session.setPermissionRequestHandler((contents, permission, callback) => callback(trusted(contents) && allowedPermission(permission)));
  session.setDevicePermissionHandler(details => ['serial', 'bluetooth'].includes(details.deviceType) && details.origin === 'file://');
  window.webContents.on('select-bluetooth-device', (event, devices, callback) => {
    event.preventDefault();
    if (!trusted(window.webContents)) { callback(''); return; }
    chooseBle = callback; bleDevices = devices; window.webContents.send('ble-devices', devices);
  });
  ipcMain.on('ble-choice', (event, id) => {
    if (!trusted(event.sender) || !chooseBle) return;
    const callback = chooseBle; chooseBle = undefined;
    callback(bleDevices.some(d => d.deviceId === id) ? id : ''); bleDevices = [];
  });
  session.on('select-serial-port', (event, list, contents, callback) => {
    event.preventDefault();
    if (!trusted(contents)) { callback(''); return; }
    if (choose) choose('');
    choose = callback; ports = list; contents.send('serial-ports', ports);
  });
  session.on('serial-port-added', (_event, port) => {
    if (choose) { ports.push(port); window.webContents.send('serial-ports', ports); }
  });
  session.on('serial-port-removed', (_event, port) => {
    if (choose) { ports = ports.filter(p => p.portId !== port.portId); window.webContents.send('serial-ports', ports); }
  });
  ipcMain.on('serial-choice', (event, id) => {
    if (!trusted(event.sender) || !choose) return;
    const callback = choose; choose = undefined;
    callback(ports.some(p => p.portId === id) ? id : ''); ports = [];
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    const link = new URL(url);
    if (link.protocol === 'https:' && (['datasheets.raspberrypi.com', 'docs.espressif.com', 'smartstream-electronics.co.uk'].includes(link.hostname) || (link.hostname === 'github.com' && /^\/shadowroot\/rc-limit\/releases(?:\/|$)/.test(link.pathname)))) void shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => { if (url.split('#')[0] !== pageUrl) event.preventDefault(); });
  window.on('closed', () => { if (choose) choose(''); if (chooseBle) chooseBle(''); choose = chooseBle = undefined; window = undefined; });
  window.loadFile(pagePath);
});
app.on('window-all-closed', () => app.quit());
