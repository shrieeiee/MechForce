const { contextBridge, ipcRenderer } = require('electron');
const fs = require('node:fs');

let isDeck = false;
try {
  isDeck = process.platform === 'linux' && (process.env.SteamDeck === '1' || ['Jupiter', 'Galileo'].includes(fs.readFileSync('/sys/devices/virtual/dmi/id/board_name', 'utf8').trim()));
} catch {}

contextBridge.exposeInMainWorld('mfNative', {
  platform: process.platform,
  isDeck,
  hostStart: () => ipcRenderer.invoke('host:start'),
  hostStop: () => ipcRenderer.invoke('host:stop'),
  discover: () => ipcRenderer.invoke('discover'),
  quit: () => ipcRenderer.send('quit'),
  toggleFullscreen: () => ipcRenderer.send('fullscreen'),
});
