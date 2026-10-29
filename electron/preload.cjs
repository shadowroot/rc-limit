const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('desktopSerial', {
  choose: id => { if (typeof id === 'string') ipcRenderer.send('serial-choice', id); },
  onPorts: callback => ipcRenderer.on('serial-ports', (_event, ports) => callback(ports)),
});
