import { app, BrowserWindow } from 'electron';
import * as path from 'path';
import { registerAllIPC, shutdownAllRuns, recoverStaleWorks, syncAllProjects } from './ipc/register';
import { logInfo } from './utils/logger';

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Register IPC handlers once window is ready
  registerAllIPC(mainWindow);

  // Recover any works left in a stale state from previous run
  recoverStaleWorks();

  // Refresh generated .claude config for every project (templates evolve)
  syncAllProjects();

  logInfo('Application started');
}

app.whenReady().then(createWindow);

app.on('before-quit', () => {
  logInfo('before-quit: stopping all runs');
  shutdownAllRuns();
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});
