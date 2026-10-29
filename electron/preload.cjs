const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('desktopSerial', {
  choose: id => { if (typeof id === 'string') ipcRenderer.send('serial-choice', id); },
  onPorts: callback => ipcRenderer.on('serial-ports', (_event, ports) => callback(ports)),
  chooseBle: id => { if (typeof id === 'string') ipcRenderer.send('ble-choice', id); },
  onBleDevices: callback => ipcRenderer.on('ble-devices', (_event, devices) => callback(devices)),
});
