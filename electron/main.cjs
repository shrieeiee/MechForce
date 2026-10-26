// Desktop shell for Windows, Steam Deck and Linux.
const { app, BrowserWindow, ipcMain, Menu } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

function detectDeck() {
  if (process.platform !== 'linux') return false;
  if (process.env.SteamDeck === '1') return true;
  try {
    const board = fs.readFileSync('/sys/devices/virtual/dmi/id/board_name', 'utf8').trim();
    if (['Jupiter', 'Galileo'].includes(board)) return true;
  } catch {}
  try { return /steamos/i.test(fs.readFileSync('/etc/os-release', 'utf8')); } catch { return false; }
}
const isDeck = detectDeck();

if (process.platform === 'linux') {
  app.commandLine.appendSwitch('no-sandbox');
  app.commandLine.appendSwitch('enable-features', 'VaapiVideoDecoder');
}
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('ignore-gpu-blocklist');

const root = path.join(__dirname, '..');
const webRoot = path.join(root, 'dist', 'web');
let win = null;
let host = null;
let stopBeacons = null;
const seen = new Map();

function serverMod() { return require(path.join(root, 'dist', 'server.cjs')); }

function createWindow() {
  Menu.setApplicationMenu(null);
  win = new BrowserWindow({
    width: 1280, height: 800, minWidth: 800, minHeight: 500,
    backgroundColor: '#0b0f13', show: false, autoHideMenuBar: true,
    fullscreen: isDeck || process.argv.includes('--fullscreen'),
    title: 'MechForce',
    icon: path.join(root, 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: false, backgroundThrottling: false },
  });
  win.once('ready-to-show', () => win.show());
  win.loadFile(path.join(webRoot, 'index.html'));
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && (input.key === 'F11' || (input.alt && input.key === 'Enter'))) { win.setFullScreen(!win.isFullScreen()); e.preventDefault(); }
  });
}

ipcMain.handle('host:start', async () => {
  if (host) return { port: host.port, addresses: host.addresses };
  const { startServer } = serverMod();
  let lastErr = null;
  for (const port of [7373, 7375, 7377]) {
    try {
      host = await startServer({ port, webRoot, name: os.hostname() + (isDeck ? ' (Steam Deck)' : '') });
      return { port: host.port, addresses: host.addresses };
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
});
ipcMain.handle('host:stop', async () => { if (host) { await host.close(); host = null; } });
ipcMain.handle('discover', async () => {
  if (!stopBeacons) {
    const { listenBeacons } = serverMod();
    stopBeacons = listenBeacons((h) => seen.set(h.address + ':' + h.port, { ...h, at: Date.now() }));
  }
  const now = Date.now();
  return [...seen.values()].filter((h) => now - h.at < 5000).map(({ at, ...h }) => h);
});
ipcMain.on('quit', () => app.quit());
ipcMain.on('fullscreen', () => win && win.setFullScreen(!win.isFullScreen()));

app.whenReady().then(createWindow);
app.on('window-all-closed', async () => { if (host) await host.close(); app.quit(); });
