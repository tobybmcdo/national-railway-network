const { app, BrowserWindow, ipcMain } = require('electron');
const { join } = require('node:path');

let window;

async function start() {
  const { createSaveStore } = await import('./saves.js');
  const store = createSaveStore(join(app.getPath('userData'), 'saves'));
  ipcMain.handle('save:load', (_event, slot, kind) => store.load(slot, kind));
  ipcMain.handle('save:write', (_event, slot, world, kind) => store.save(slot, world, kind));

  function openWindow() {
    window = new BrowserWindow({
      title: 'National Railway Network',
      width: 1440,
      height: 900,
      minWidth: 800,
      minHeight: 560,
      autoHideMenuBar: true,
      webPreferences: {
        preload: join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', event => event.preventDefault());
    window.on('closed', () => { window = null; });
    window.loadFile(join(__dirname, 'index.html'));
  }

  openWindow();
  app.on('activate', () => { if (!window) openWindow(); });
}

app.whenReady().then(start).catch(error => {
  console.error(error);
  app.exit(1);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
