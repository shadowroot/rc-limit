const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
let window, choose, ports = [];
const pagePath = path.join(__dirname, '../web/index.html');
const pageUrl = pathToFileURL(pagePath).href;
function trusted(sender) { return window && sender === window.webContents && sender.getURL().split('#')[0] === pageUrl; }
app.whenReady().then(() => {
  window = new BrowserWindow({ width: 1280, height: 920, backgroundColor: '#101413',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false } });
  const session = window.webContents.session;
  session.setPermissionCheckHandler((contents, permission) => trusted(contents) && permission === 'serial');
  session.setPermissionRequestHandler((contents, permission, callback) => callback(trusted(contents) && permission === 'serial'));
  session.setDevicePermissionHandler(details => details.deviceType === 'serial' && details.origin === 'file://');
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
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => { if (url.split('#')[0] !== pageUrl) event.preventDefault(); });
  window.on('closed', () => { if (choose) choose(''); choose = undefined; window = undefined; });
  window.loadFile(pagePath);
});
app.on('window-all-closed', () => app.quit());
