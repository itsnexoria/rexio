const { app, BrowserWindow, ipcMain, session, shell, Tray, Menu, Notification, nativeImage, dialog } = require('electron');
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const store = require('./accountStore');
const roblox = require('./roblox');
const backup = require('./backup');
const appSettings = require('./appSettings');
const logger = require('./logger');

const IS_WINDOWS = process.platform === 'win32';
const platformConfig = IS_WINDOWS ? require('./windowsConfig') : require('./soberConfig');

let mainWindow;
let tray;
let isQuitting = false;
let isLoggingIn = false;
let presenceTimer = null;

const iconPath = path.join(__dirname, '..', 'renderer', 'icon.png');

function notify(title, body) {
  if (!Notification.isSupported()) return;
  new Notification({ title, body }).show();
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 680,
    height: 720,
    title: 'Rexio',
    icon: iconPath,
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  mainWindow.on('close', (e) => {
    if (isLoggingIn) {
      e.preventDefault();
      const choice = dialog.showMessageBoxSync(mainWindow, {
        type: 'warning',
        buttons: ['Cancel', 'Close anyway'],
        defaultId: 0,
        cancelId: 0,
        message: 'A login is in progress',
        detail: 'Closing now will interrupt adding this account.',
      });
      if (choice !== 1) return;
      isLoggingIn = false;
    }
    if (!isQuitting && appSettings.get('minimizeToTray') && tray) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
}

function createTray() {
  if (tray) return;
  const image = nativeImage.createFromPath(iconPath).resize({ width: 20, height: 20 });
  tray = new Tray(image);
  tray.setToolTip('Rexio');
  tray.on('click', () => mainWindow.show());
  refreshTray();
}

function destroyTray() {
  if (!tray) return;
  tray.destroy();
  tray = null;
}

const PRESENCE_DOT = { 0: '⚪', 1: '🟢', 2: '🎮', 3: '🎮' };

// presenceByUserId is an optional cache from the background poller so the
// tray can show live status dots without a fresh fetch on every open.
function refreshTray(presenceByUserId = {}) {
  if (!tray) return;
  const accounts = store.listAccounts();
  const accountItems = accounts.length
    ? accounts.map((a) => {
        const p = presenceByUserId[a.userId];
        const dot = p ? PRESENCE_DOT[p.userPresenceType] || '' : '';
        return {
          label: `${dot ? dot + ' ' : ''}Launch ${a.displayName}`,
          click: () => launchAccount(a.userId).catch(() => {}),
        };
      })
    : [{ label: 'No accounts yet', enabled: false }];

  const menu = Menu.buildFromTemplate([
    { label: 'Open Rexio', click: () => mainWindow.show() },
    { type: 'separator' },
    ...accountItems,
    { type: 'separator' },
    { label: 'Quit', click: () => { isQuitting = true; app.quit(); } },
  ]);
  tray.setContextMenu(menu);
}

function openLoginWindow() {
  return new Promise((resolve, reject) => {
    const loginSession = session.fromPartition(`login-${Date.now()}`, { cache: false });
    const win = new BrowserWindow({
      width: 500,
      height: 700,
      webPreferences: { session: loginSession },
    });
    win.loadURL('https://www.roblox.com/login');

    const checkLoggedIn = async () => {
      const cookies = await loginSession.cookies.get({ name: '.ROBLOSECURITY' });
      if (cookies.length > 0) {
        win.close();
        resolve(cookies[0].value);
      }
    };

    win.webContents.on('did-navigate', checkLoggedIn);
    win.webContents.on('did-navigate-in-page', checkLoggedIn);
    win.on('closed', () => reject(new Error('Login window closed before completing login')));
  });
}

// Linux: spawn Sober directly (instead of xdg-open) so we can see its exit
// code and surface a notification if it crashes.
// Windows: the official Roblox installer registers roblox-player: as a
// protocol handler, so shell.openExternal is the standard, reliable path —
// there's no separate compatibility-layer process to monitor for crashes.
function launchRobloxClient(uri) {
  if (IS_WINDOWS) {
    shell.openExternal(uri);
    return;
  }

  let child;
  try {
    child = spawn('flatpak', ['run', 'org.vinegarhq.Sober', uri], { stdio: ['ignore', 'pipe', 'pipe'] });
  } catch {
    shell.openExternal(uri);
    return;
  }

  let stderr = '';
  child.stderr.on('data', (d) => { stderr += d.toString(); });
  child.on('error', () => shell.openExternal(uri)); // e.g. flatpak not on PATH
  child.on('exit', (code) => {
    if (code === 0 || code === null) return;
    if (stderr.includes('already running')) {
      notify('Sober', 'Sober is already running.');
      return;
    }
    const lastLine = stderr.trim().split('\n').filter(Boolean).slice(-1)[0];
    logger.error(`Sober exited ${code}: ${stderr.trim()}`);
    notify('Sober crashed', lastLine || `Exited with code ${code}`);
  });
}

async function launchAccount(userId, { joinLastGame = false } = {}) {
  const cookie = store.getCookie(userId);
  let ticket;
  try {
    ticket = await roblox.getAuthTicket(cookie);
  } catch (err) {
    if (err.code === 'COOKIE_EXPIRED') {
      notify('Rexio', 'Session expired for this account — please log in again.');
    } else {
      logger.error(`launchAccount(${userId}): ${err.message}`);
      notify('Rexio', 'Launch failed: ' + err.message);
    }
    throw err;
  }

  const accounts = store.listAccounts();
  const account = accounts.find((a) => a.userId === userId);

  if (joinLastGame && account?.lastPlace?.placeId) {
    launchRobloxClient(roblox.buildJoinPlaceUri(ticket, account.lastPlace.placeId));
  } else {
    launchRobloxClient(roblox.buildLaunchUri(ticket));
  }

  store.setLastLaunched(userId, Date.now());
  refreshTray();
}

// Shared by the accounts:list handler and the background presence poller.
async function getEnrichedAccounts() {
  const accounts = store.listAccounts();
  const ids = accounts.map((a) => a.userId);
  const showRobux = appSettings.get('showRobux');

  const [avatarMap, presenceMap, perAccountExtras] = await Promise.all([
    roblox.getAvatarHeadshots(ids).catch(() => ({})),
    accounts.length
      ? roblox.getPresence(store.getCookie(accounts[0].userId), ids).catch(() => ({}))
      : Promise.resolve({}),
    Promise.all(
      accounts.map(async (a) => {
        const cookie = store.getCookie(a.userId);
        const [cookieValid, robux] = await Promise.all([
          roblox.getUserInfo(cookie).then(() => true).catch(() => false),
          showRobux ? roblox.getRobuxBalance(cookie).catch(() => null) : Promise.resolve(null),
        ]);
        return { userId: a.userId, cookieValid, robux };
      })
    ),
  ]);
  const extrasByUserId = Object.fromEntries(perAccountExtras.map((e) => [e.userId, e]));

  // Remember whatever place each account is currently in, so "Join last
  // game" has something to aim at later (Roblox has no public "recently
  // played" endpoint we can rely on).
  const placeIdsToName = new Set();
  accounts.forEach((a) => {
    const p = presenceMap[a.userId];
    if (p && p.userPresenceType === 2 && (p.placeId || p.rootPlaceId)) {
      const placeId = p.placeId || p.rootPlaceId;
      store.setLastPlace(a.userId, { placeId, at: Date.now() });
      placeIdsToName.add(placeId);
    }
    if (a.lastPlace?.placeId) placeIdsToName.add(a.lastPlace.placeId);
  });
  const placeNames = await roblox.getPlaceNames([...placeIdsToName]).catch(() => ({}));

  const refreshed = store.listAccounts();
  return { accounts: refreshed.map((a) => ({
    ...a,
    avatarUrl: avatarMap[a.userId] || null,
    presence: presenceMap[a.userId] || null,
    lastPlaceName: a.lastPlace ? placeNames[a.lastPlace.placeId] || null : null,
    cookieValid: extrasByUserId[a.userId]?.cookieValid ?? null,
    robux: extrasByUserId[a.userId]?.robux ?? null,
  })), presenceMap };
}

// ---- Automatic local backups (no passphrase — just a copy of the already
// safeStorage-encrypted accounts file, rotated, never leaves this machine) ----
const BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
const MAX_BACKUPS = 5;

function backupsDir() {
  return path.join(app.getPath('userData'), 'backups');
}

function runAutoBackup() {
  try {
    const src = store.rawFilePath();
    if (!fs.existsSync(src)) return;
    const dir = backupsDir();
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(src, path.join(dir, `accounts-${Date.now()}.json`));
    const files = fs.readdirSync(dir).filter((f) => f.startsWith('accounts-')).sort();
    while (files.length > MAX_BACKUPS) {
      fs.unlinkSync(path.join(dir, files.shift()));
    }
    logger.info('auto-backup written');
  } catch (e) {
    logger.error('auto-backup: ' + e.message);
  }
}

function maybeRunAutoBackup() {
  const dir = backupsDir();
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.startsWith('accounts-')) : [];
  const latestTs = files.length
    ? Math.max(...files.map((f) => Number(f.match(/accounts-(\d+)\.json/)?.[1] || 0)))
    : 0;
  if (Date.now() - latestTs > BACKUP_INTERVAL_MS) runAutoBackup();
}

function getBackupInfo() {
  const dir = backupsDir();
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.startsWith('accounts-')) : [];
  const latestTs = files.length
    ? Math.max(...files.map((f) => Number(f.match(/accounts-(\d+)\.json/)?.[1] || 0)))
    : null;
  return { count: files.length, latest: latestTs, dir };
}

function startPresencePolling() {
  if (presenceTimer) return;
  presenceTimer = setInterval(async () => {
    if (!store.listAccounts().length) return;
    try {
      const { accounts, presenceMap } = await getEnrichedAccounts();
      refreshTray(presenceMap);
      if (mainWindow) mainWindow.webContents.send('presence:update', accounts);
    } catch (e) {
      logger.error('presence poll: ' + e.message);
    }
  }, 3 * 60 * 1000);
}

ipcMain.handle('accounts:list', async () => {
  const { accounts } = await getEnrichedAccounts();
  return accounts;
});

ipcMain.handle('accounts:add', async () => {
  isLoggingIn = true;
  try {
    const cookie = await openLoginWindow();
    const info = await roblox.getUserInfo(cookie);
    store.addAccount({
      userId: info.id,
      username: info.name,
      displayName: info.displayName,
      cookie,
    });
    return store.listAccounts();
  } finally {
    isLoggingIn = false;
    refreshTray();
  }
});

ipcMain.handle('accounts:delete', (_e, userId) => {
  store.deleteAccount(userId);
  refreshTray();
  return store.listAccounts();
});

ipcMain.handle('accounts:reorder', (_e, orderedUserIds) => {
  store.reorderAccounts(orderedUserIds);
  refreshTray();
  return store.listAccounts();
});

ipcMain.handle('accounts:setNote', (_e, userId, note) => {
  store.setNote(userId, note);
  return true;
});

ipcMain.handle('accounts:launch', async (_e, userId, options) => {
  await launchAccount(userId, options);
  return true;
});

ipcMain.handle('accounts:export', async (_e, passphrase) => {
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Export Rexio accounts',
    defaultPath: 'rexio-accounts-backup.json',
    filters: [{ name: 'Rexio Backup', extensions: ['json'] }],
  });
  if (canceled || !filePath) return { ok: false, canceled: true };
  try {
    const encrypted = backup.encrypt(passphrase, JSON.stringify(store.exportAll()));
    fs.writeFileSync(filePath, encrypted, 'utf8');
    return { ok: true, filePath };
  } catch (e) {
    logger.error('export: ' + e.message);
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('accounts:import', async (_e, passphrase) => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: 'Import Rexio accounts',
    filters: [{ name: 'Rexio Backup', extensions: ['json'] }],
    properties: ['openFile'],
  });
  if (canceled || !filePaths.length) return { ok: false, canceled: true };
  try {
    const raw = fs.readFileSync(filePaths[0], 'utf8');
    const records = JSON.parse(backup.decrypt(passphrase, raw));
    store.importAll(records);
    refreshTray();
    return { ok: true, count: records.length };
  } catch (e) {
    logger.error('import: ' + e.message);
    return { ok: false, error: 'Wrong passphrase, or the file is corrupted.' };
  }
});

ipcMain.handle('config:load', () => {
  try {
    return { ok: true, ...platformConfig.load() };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('config:save', (_e, config) => {
  try {
    platformConfig.save(config);
    return { ok: true };
  } catch (e) {
    logger.error('config save: ' + e.message);
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('app:getPlatform', () => (IS_WINDOWS ? 'win32' : 'linux'));

ipcMain.handle('app:checkClientInstalled', () => {
  if (IS_WINDOWS) {
    try {
      platformConfig.findVersionFolder();
      return { installed: true };
    } catch {
      return {
        installed: false,
        message: "Roblox doesn't seem to be installed (or hasn't been launched yet).",
        actionLabel: 'Download Roblox',
        actionUrl: 'https://www.roblox.com/download',
      };
    }
  }
  try {
    execSync('flatpak info org.vinegarhq.Sober', { stdio: 'ignore' });
    return { installed: true };
  } catch {
    return {
      installed: false,
      message: "Sober doesn't seem to be installed via Flatpak. Launches will fail until it is.",
      actionLabel: 'Install Sober',
      actionUrl: 'https://sober.vinegarhq.org',
    };
  }
});

ipcMain.handle('app:openExternal', (_e, url) => shell.openExternal(url));

ipcMain.handle('app:getAutoLaunch', () => app.getLoginItemSettings().openAtLogin);
ipcMain.handle('app:setAutoLaunch', (_e, enabled) => {
  app.setLoginItemSettings({ openAtLogin: enabled });
  return true;
});

ipcMain.handle('app:getPreference', (_e, key) => appSettings.get(key));
ipcMain.handle('app:setPreference', (_e, key, value) => {
  appSettings.set(key, value);
  if (key === 'showTrayIcon') {
    if (value) createTray();
    else destroyTray();
  }
  return true;
});

ipcMain.handle('app:getVersion', () => app.getVersion());

ipcMain.handle('app:checkForUpdates', async () => {
  if (!app.isPackaged) return { ok: false, error: 'Updates only run in packaged builds.' };
  try {
    const { autoUpdater } = require('electron-updater');
    const result = await autoUpdater.checkForUpdates();
    return { ok: true, version: result?.updateInfo?.version || null };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('app:getLogPath', () => logger.path());
ipcMain.handle('app:openLogFile', () => shell.openPath(logger.path()));

ipcMain.handle('backup:getInfo', () => getBackupInfo());
ipcMain.handle('backup:openFolder', () => shell.openPath(backupsDir()));

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    createMainWindow();
    if (appSettings.get('showTrayIcon')) createTray();
    startPresencePolling();
    maybeRunAutoBackup();
    setInterval(maybeRunAutoBackup, 60 * 60 * 1000);

    if (app.isPackaged) {
      const { autoUpdater } = require('electron-updater');
      autoUpdater.checkForUpdatesAndNotify().catch(() => {});
    }
  });

  app.on('before-quit', () => { isQuitting = true; });
  app.on('window-all-closed', () => {
    if (isQuitting) app.quit();
  });

  process.on('uncaughtException', (err) => {
    logger.error(err);
    notify('Rexio error', err.message || String(err));
  });
  process.on('unhandledRejection', (reason) => {
    logger.error(reason instanceof Error ? reason : String(reason));
  });
}
