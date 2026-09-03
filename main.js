const { app, BrowserWindow, ipcMain, net } = require('electron');
const path = require('path');
const { autoUpdater } = require('electron-updater');
const { createClient } = require('@supabase/supabase-js');
const AppDatabase = require('./database/db.js');
const { initDatabase } = require('./database/schema.js');
const SyncEngine = require('./database/sync-engine.js');

// Configure autoUpdater
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = false;
autoUpdater.allowPrerelease = false;

// Fix blurry font rendering on Windows
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('high-dpi-support', '1');

const WebSocket = require('ws');
if (typeof global.WebSocket === 'undefined') {
  global.WebSocket = WebSocket;
}

// Supabase Cloud Config
const SUPABASE_URL = 'https://llukvrfabdnvlbimvepb.supabase.co';
const SUPABASE_KEY = 'sb_publishable_TfYRzo9Gj85z7KByoPEZnA_RJvJCtw7';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false },
  realtime: {
    transport: WebSocket
  }
});

let mainWindow = null;
let db = null;
let syncEngine = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 640,
    title: 'ลานยางพาราชุมชน — ระบบรับซื้อยาง',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  const checkOnlineStatus = () => {
    const isOnline = net.isOnline();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('online-status', isOnline);
    }
  };

  setInterval(checkOnlineStatus, 10000);
}

async function initAppDatabase() {
  const fs = require('fs');
  const userDataDir = app.getPath('userData');
  const userDataDbPath = path.join(userDataDir, 'rubber-yard-data.db');

  const appDir = app.isPackaged ? path.dirname(app.getPath('exe')) : __dirname;
  const portableDataDir = path.join(appDir, 'data');
  if (!fs.existsSync(portableDataDir)) {
    try { fs.mkdirSync(portableDataDir, { recursive: true }); } catch (e) {}
  }
  const portableDbPath = path.join(portableDataDir, 'rubber-yard-data.db');

  const desktopBackupDir = path.join(app.getPath('desktop'), 'DB_BACKUP_TODAY');
  const desktopDbPath = path.join(desktopBackupDir, 'rubber-yard-data.db');

  // Find the newest/best existing database among candidates
  const candidates = [userDataDbPath, portableDbPath, desktopDbPath].filter(p => fs.existsSync(p));
  let bestDbPath = userDataDbPath;

  if (candidates.length > 0) {
    // Sort by file size descending, then by mtime descending
    candidates.sort((a, b) => {
      const statA = fs.statSync(a);
      const statB = fs.statSync(b);
      if (statA.size !== statB.size) return statB.size - statA.size;
      return statB.mtimeMs - statA.mtimeMs;
    });
    bestDbPath = candidates[0];
  }

  // Ensure both userData and portable copies exist and are up to date with best candidate
  if (fs.existsSync(bestDbPath)) {
    try {
      if (bestDbPath !== userDataDbPath) fs.copyFileSync(bestDbPath, userDataDbPath);
      if (bestDbPath !== portableDbPath && fs.existsSync(portableDataDir)) fs.copyFileSync(bestDbPath, portableDbPath);
    } catch (e) {
      console.warn('Sync database copies error:', e);
    }
  }

  // Use userDataDbPath as primary to guarantee safety across any installer updates
  const primaryDbPath = fs.existsSync(userDataDbPath) ? userDataDbPath : portableDbPath;
  db = new AppDatabase(primaryDbPath);
  await db.init();
  
  // Create tables & default data
  initDatabase(db);

  // Periodic backup & auto-mirror to portable and desktop
  const backupCopies = () => {
    try {
      if (fs.existsSync(primaryDbPath)) {
        if (fs.existsSync(portableDataDir)) fs.copyFileSync(primaryDbPath, portableDbPath);
        if (!fs.existsSync(desktopBackupDir)) fs.mkdirSync(desktopBackupDir, { recursive: true });
        fs.copyFileSync(primaryDbPath, desktopDbPath);
      }
    } catch (e) {}
  };
  setInterval(backupCopies, 30000);
  app.on('before-quit', backupCopies);
  
  syncEngine = new SyncEngine(db, supabase, () => mainWindow);
}

app.whenReady().then(async () => {
  await initAppDatabase();
  createWindow();

  // Automatically check for updates 4 seconds after app launch
  setTimeout(() => {
    if (app.isPackaged && net.isOnline()) {
      autoUpdater.checkForUpdates().catch(e => console.warn('[AutoUpdater] Startup check error:', e.message));
    }
  }, 4000);

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (db) db.save();
  if (process.platform !== 'darwin') app.quit();
});

// IPC Database Handlers
ipcMain.handle('db:select', async (_event, table, columns, filters) => {
  try {
    return db.select(table, columns, filters);
  } catch (err) {
    console.error('db:select error:', err);
    throw err;
  }
});

ipcMain.handle('db:insert', async (_event, table, data) => {
  try {
    const inserted = db.insert(table, data);
    return inserted;
  } catch (err) {
    console.error('db:insert error:', err);
    throw err;
  }
});

ipcMain.handle('db:update', async (_event, table, data, filters) => {
  try {
    return db.update(table, data, filters);
  } catch (err) {
    console.error('db:update error:', err);
    throw err;
  }
});

ipcMain.handle('db:delete', async (_event, table, filters) => {
  try {
    return db.delete(table, filters);
  } catch (err) {
    console.error('db:delete error:', err);
    throw err;
  }
});

ipcMain.handle('db:query', async (_event, sql, params = []) => {
  try {
    return db.query(sql, params);
  } catch (err) {
    console.error('db:query error:', err);
    throw err;
  }
});

ipcMain.handle('db:run', async (_event, sql, params = []) => {
  try {
    return db.run(sql, params);
  } catch (err) {
    console.error('db:run error:', err);
    throw err;
  }
});

ipcMain.handle('db:count', async (_event, table, filters) => {
  try {
    return db.count(table, filters);
  } catch (err) {
    console.error('db:count error:', err);
    throw err;
  }
});

ipcMain.handle('db:search', async (_event, table, queryStr, columns) => {
  try {
    return db.search(table, queryStr, columns);
  } catch (err) {
    console.error('db:search error:', err);
    throw err;
  }
});

// Sync Handlers
ipcMain.handle('sync:download', async () => {
  if (syncEngine) return await syncEngine.downloadAll();
  return { success: false, message: 'Sync engine not ready' };
});

ipcMain.handle('sync:upload', async () => {
  if (syncEngine) return await syncEngine.uploadPending(true);
  return { success: false, message: 'Sync engine not ready' };
});

ipcMain.handle('sync:status', async () => {
  if (syncEngine) return syncEngine.getPendingCount();
  return 0;
});

ipcMain.handle('app:is-online', () => {
  return net.isOnline();
});

// ==========================================
// AUTO-UPDATER EVENTS & IPC HANDLERS
// ==========================================
function sendUpdaterStatus(payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('updater:status', payload);
  }
}

autoUpdater.on('checking-for-update', () => {
  console.log('[AutoUpdater] Checking for update...');
  sendUpdaterStatus({ status: 'checking', message: 'กำลังตรวจสอบการอัปเดต...' });
});

autoUpdater.on('update-available', (info) => {
  console.log('[AutoUpdater] Update available:', info.version);
  sendUpdaterStatus({
    status: 'available',
    version: info.version,
    releaseDate: info.releaseDate,
    message: `พบเวอร์ชันใหม่ v${info.version} กำลังดาวน์โหลดในเบื้องหลัง...`
  });
});

autoUpdater.on('download-progress', (progressObj) => {
  const percent = Math.round(progressObj.percent);
  console.log(`[AutoUpdater] Download progress: ${percent}%`);
  sendUpdaterStatus({
    status: 'downloading',
    percent: percent,
    bytesPerSecond: progressObj.bytesPerSecond,
    transferred: progressObj.transferred,
    total: progressObj.total,
    message: `กำลังดาวน์โหลดอัปเดต: ${percent}%`
  });
});

autoUpdater.on('update-downloaded', (info) => {
  console.log('[AutoUpdater] Update downloaded:', info.version);
  sendUpdaterStatus({
    status: 'downloaded',
    version: info.version,
    message: `ดาวน์โหลดเวอร์ชันใหม่ v${info.version} เรียบร้อยแล้ว พร้อมติดตั้ง!`
  });
});

autoUpdater.on('update-not-available', (info) => {
  console.log('[AutoUpdater] Update not available. Current is latest:', info?.version);
  sendUpdaterStatus({
    status: 'not-available',
    version: info?.version || app.getVersion(),
    message: 'โปรแกรมเป็นเวอร์ชันล่าสุดแล้ว'
  });
});

autoUpdater.on('error', (err) => {
  console.warn('[AutoUpdater] Error:', err ? err.message : err);
  sendUpdaterStatus({
    status: 'error',
    message: err ? err.message : 'เกิดข้อผิดพลาดในการตรวจสอบอัปเดต'
  });
});

ipcMain.handle('updater:check', async () => {
  try {
    if (!net.isOnline()) {
      return { success: false, message: 'ไม่มีสัญญาณอินเทอร์เน็ต' };
    }
    const result = await autoUpdater.checkForUpdates();
    const ver = result && result.updateInfo ? result.updateInfo.version : '';
    return { success: true, version: ver };
  } catch (err) {
    console.warn('Manual update check error:', err.message);
    return { success: false, message: err.message };
  }
});

ipcMain.handle('updater:install', () => {
  try {
    if (db) db.save();
    autoUpdater.quitAndInstall(false, true);
  } catch (err) {
    console.error('quitAndInstall error:', err);
  }
});

ipcMain.handle('updater:get-version', () => {
  return app.getVersion();
});
