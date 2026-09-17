const { app, BrowserWindow, ipcMain, session, shell, Tray, Menu, Notification, nativeImage, dialog, screen, globalShortcut } = require('electron');
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const store = require('./accountStore');
const roblox = require('./roblox');
const backup = require('./backup');
const appSettings = require('./appSettings');
const logger = require('./logger');
const macroStore = require('./macro/macroStore');
const macroRecorder = require('./macro/recorder');
const macroPlayer = require('./macro/player');
const macroHotkeys = require('./macro/hotkeys');
const macroPixelTrigger = require('./macro/pixelTrigger');
const macroScheduler = require('./macro/scheduler');
const keymap = require('./macro/keymap');

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

function buildAppMenu() {
  const devItems = app.isPackaged
    ? []
    : [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
      ];

  const template = [
    {
      label: 'Rexio',
      submenu: [
        {
          label: 'About Rexio',
          click: () => {
            showMainWindow();
            dialog.showMessageBox(safeWindow(), {
              type: 'info',
              title: 'About Rexio',
              message: 'Rexio',
              detail: `Version ${app.getVersion()}\n\nA Roblox account manager for Linux and Windows.`,
            });
          },
        },
        {
          label: 'Check for Updates…',
          click: async () => {
            showMainWindow();
            if (!app.isPackaged) {
              dialog.showMessageBox(safeWindow(), { message: 'Updates only run in packaged builds.' });
              return;
            }
            try {
              const { autoUpdater } = require('electron-updater');
              const result = await autoUpdater.checkForUpdates();
              const v = result?.updateInfo?.version;
              dialog.showMessageBox(safeWindow(), {
                message: v && v !== app.getVersion() ? `Update available: v${v}` : "You're up to date.",
              });
            } catch (e) {
              dialog.showMessageBox(safeWindow(), { type: 'error', message: 'Check failed: ' + e.message });
            }
          },
        },
        { type: 'separator' },
        { label: 'Settings', click: () => safeWindow()?.webContents.send('menu:goto-settings') },
        { type: 'separator' },
        { label: 'Quit', accelerator: 'CmdOrCtrl+Q', click: () => { isQuitting = true; app.quit(); } },
      ],
    },
    {
      label: 'Accounts',
      submenu: [
        { label: 'Add Account…', accelerator: 'CmdOrCtrl+N', click: () => safeWindow()?.webContents.send('menu:add-account') },
        { label: 'Refresh', accelerator: 'CmdOrCtrl+R', click: () => safeWindow()?.webContents.send('menu:refresh') },
        { type: 'separator' },
        { label: 'List View', click: () => safeWindow()?.webContents.send('menu:view-mode', 'list') },
        { label: 'Grid View', click: () => safeWindow()?.webContents.send('menu:view-mode', 'grid') },
      ],
    },
    {
      label: 'View',
      submenu: [
        ...devItems,
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { role: 'resetZoom' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [{ role: 'minimize' }, { role: 'close' }],
    },
    {
      label: 'Help',
      submenu: [
        { label: 'Open Log File', click: () => shell.openPath(logger.path()) },
        { label: 'GitHub Repository', click: () => shell.openExternal('https://github.com/itsnexoria/rexio') },
        { label: 'Report an Issue', click: () => shell.openExternal('https://github.com/itsnexoria/rexio/issues') },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 680,
    height: 720,
    minWidth: 480,
    minHeight: 480,
    title: 'Rexio',
    icon: iconPath,
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  mainWindow.setMenuBarVisibility(false);
  mainWindow.on('closed', () => { mainWindow = null; });

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

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createMainWindow();
  } else {
    mainWindow.show();
  }
}

// Returns mainWindow only if it's safe to use as a dialog parent / message
// target, else undefined — never hand a destroyed BrowserWindow to Electron.
function safeWindow() {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
}

function createTray() {
  if (tray) return;
  try {
    const image = nativeImage.createFromPath(iconPath).resize({ width: 20, height: 20 });
    tray = new Tray(image);
    tray.setToolTip('Rexio');
    tray.on('click', () => showMainWindow());
    tray.on('destroyed', () => { tray = null; });
    refreshTray();
  } catch (e) {
    logger.error('createTray: ' + e.message);
    tray = null;
  }
}

function refreshTrayMacroToggle() {
  refreshTray();
}

function destroyTray() {
  if (!tray) return;
  try {
    tray.destroy();
  } catch (e) {
    logger.error('destroyTray: ' + e.message);
  }
  tray = null;
}

const PRESENCE_DOT = { 0: '⚪', 1: '🟢', 2: '🎮', 3: '🎮' };

// presenceByUserId is an optional cache from the background poller so the
// tray can show live status dots without a fresh fetch on every open.
// The native tray icon can become invalid outside our control (desktop
// panel/applet restarts on some Linux setups) — self-heal instead of
// letting that surface as an uncaught exception.
function refreshTray(presenceByUserId = {}) {
  if (!tray) return;
  try {
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
      { label: 'Open Rexio', click: () => showMainWindow() },
      { type: 'separator' },
      ...accountItems,
      { type: 'separator' },
      {
        label: 'Disable macro triggers',
        type: 'checkbox',
        checked: Boolean(appSettings.get('macrosDisabled')),
        click: (item) => {
          appSettings.set('macrosDisabled', item.checked);
          syncMacroTriggers();
          const w = safeWindow();
          if (w) w.webContents.send('macro:killSwitchChanged', item.checked);
        },
      },
      { type: 'separator' },
      { label: 'Quit', click: () => { isQuitting = true; app.quit(); } },
    ]);
    tray.setContextMenu(menu);
  } catch (e) {
    logger.error('refreshTray: ' + e.message);
    tray = null;
    if (appSettings.get('showTrayIcon')) createTray();
  }
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
  try { refreshTray(); } catch (e) { logger.error('refreshTray after launch: ' + e.message); }

  if (account?.launchMacroId) {
    const macro = macroStore.getMacro(account.launchMacroId);
    if (macro) waitForInGameThenRun(userId, cookie, macro.id);
  }
}

// Waits for presence to report this account as actually in-game (type 2)
// before firing its auto-run macro, polling every 5s for up to 90s. This is
// far more reliable than a fixed delay, but Roblox's presence API is the
// only signal we have — if it never confirms (rate limit, API hiccup), we
// fall back to the old fixed-delay behavior rather than never running at all.
function waitForInGameThenRun(userId, cookie, macroId) {
  const deadline = Date.now() + 90000;
  const poll = async () => {
    if (Date.now() > deadline) {
      runMacroById(macroId).catch((e) => logger.error('auto-run macro (fallback delay): ' + e.message));
      return;
    }
    try {
      const presenceMap = await roblox.getPresence(cookie, [userId]);
      if (presenceMap[userId]?.userPresenceType === 2) {
        runMacroById(macroId).catch((e) => logger.error('auto-run macro: ' + e.message));
        return;
      }
    } catch (e) {
      logger.error('auto-run presence poll: ' + e.message);
    }
    setTimeout(poll, 5000);
  };
  setTimeout(poll, 15000); // give the client a head start before the first check
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
      if (safeWindow()) mainWindow.webContents.send('presence:update', accounts);
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

ipcMain.handle('accounts:setLaunchMacro', (_e, userId, macroId) => {
  store.setLaunchMacro(userId, macroId);
  return true;
});

ipcMain.handle('accounts:launch', async (_e, userId, options) => {
  await launchAccount(userId, options);
  return true;
});

ipcMain.handle('accounts:export', async (_e, passphrase) => {
  const { canceled, filePath } = await dialog.showSaveDialog(safeWindow(), {
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
  const { canceled, filePaths } = await dialog.showOpenDialog(safeWindow(), {
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

function sendMacroProgress(macroId, index) {
  const w = safeWindow();
  if (w) w.webContents.send('macro:progress', { macroId, index });
}

// Resolves which display's current bounds a macro should scale against:
// the one the user explicitly pinned, else whichever one it was recorded
// on (matched by id), else the primary display as a last resort.
function resolveCurrentBounds(macro) {
  const displays = screen.getAllDisplays();
  const wantId = macro.targetDisplayId ?? macro.screenSize?.displayId;
  const match = wantId != null ? displays.find((d) => d.id === wantId) : null;
  return (match || screen.getPrimaryDisplay()).bounds;
}

function buildMacroOpts(macro) {
  return {
    scaleToScreen: macro.scaleToScreen,
    screenSize: macro.screenSize,
    jitter: macro.jitter,
  };
}

async function runMacroById(macroId) {
  if (appSettings.get('macrosDisabled')) return; // master kill switch
  if (macroPlayer.isPlaying()) {
    macroPlayer.stop();
    return;
  }
  const macro = macroStore.getMacro(macroId);
  if (!macro) return;
  const startedAt = Date.now();
  try {
    await macroPlayer.play(macro.actions, {
      loops: macro.loopForever ? Infinity : (macro.loops || 1),
      speed: macro.speed || 1,
      macroOpts: buildMacroOpts(macro),
      currentBounds: resolveCurrentBounds(macro),
      onStep: (index) => sendMacroProgress(macroId, index),
    });
    macroStore.setLastRun(macroId, { ok: true, durationMs: Date.now() - startedAt });
  } catch (e) {
    logger.error('macro trigger playback: ' + e.message);
    macroStore.setLastRun(macroId, { ok: false, error: e.message, durationMs: Date.now() - startedAt });
    notify('Rexio', `Macro "${macro.name}" failed: ${e.message}`);
  }
}

function syncMacroTriggers() {
  const macros = macroStore.listMacros();
  const disabled = appSettings.get('macrosDisabled');
  // Fully unregistering (rather than just checking the flag inside the
  // callback) means a disabled hotkey doesn't even get claimed from the OS,
  // and pixel polling doesn't burn CPU while switched off.
  macroHotkeys.syncAll(disabled ? [] : macros, runMacroById);
  macroPixelTrigger.syncAll(disabled ? [] : macros, runMacroById);
  macroScheduler.syncAll(disabled ? [] : macros, runMacroById);
}

ipcMain.handle('macros:list', () => macroStore.listMacros());

ipcMain.handle('macros:save', (_e, macro) => {
  const saved = macroStore.saveMacro(macro);
  syncMacroTriggers();
  return saved;
});

ipcMain.handle('macros:delete', (_e, id) => {
  macroStore.deleteMacro(id);
  syncMacroTriggers();
  return macroStore.listMacros();
});

ipcMain.handle('macros:setHotkey', (_e, id, hotkey) => {
  if (hotkey === macroHotkeys.RESERVED_ACCELERATOR) {
    return null; // reserved for the panic release shortcut — refuse silently, renderer already warns
  }
  const updated = macroStore.setHotkey(id, hotkey);
  syncMacroTriggers();
  return updated;
});

ipcMain.handle('macros:recordStart', () => {
  macroRecorder.start();
  const cursor = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursor);
  return { displayId: display.id, bounds: display.bounds, width: display.bounds.width, height: display.bounds.height };
});

ipcMain.handle('macros:recordStop', () => macroRecorder.stop());

ipcMain.handle('macros:play', async (_e, id) => {
  const macro = macroStore.getMacro(id);
  if (!macro) return { ok: false, error: 'Macro not found' };
  const startedAt = Date.now();
  try {
    await macroPlayer.play(macro.actions, {
      loops: macro.loopForever ? Infinity : (macro.loops || 1),
      speed: macro.speed || 1,
      macroOpts: buildMacroOpts(macro),
      currentBounds: resolveCurrentBounds(macro),
      onStep: (index) => sendMacroProgress(id, index),
    });
    macroStore.setLastRun(id, { ok: true, durationMs: Date.now() - startedAt });
    return { ok: true };
  } catch (e) {
    macroStore.setLastRun(id, { ok: false, error: e.message, durationMs: Date.now() - startedAt });
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('macros:playFrom', async (_e, id, startIndex) => {
  const macro = macroStore.getMacro(id);
  if (!macro) return { ok: false, error: 'Macro not found' };
  try {
    await macroPlayer.play(macro.actions, {
      loops: 1, // debugging aid — always a single pass regardless of the macro's own loop settings
      speed: macro.speed || 1,
      macroOpts: buildMacroOpts(macro),
      currentBounds: resolveCurrentBounds(macro),
      startIndex,
      onStep: (index) => sendMacroProgress(id, index),
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('macros:validate', (_e, macro) => macroStore.validateMacro(macro));

ipcMain.handle('macros:bulkDelete', (_e, ids) => {
  macroStore.bulkDelete(ids);
  syncMacroTriggers();
  return macroStore.listMacros();
});

ipcMain.handle('macros:bulkAddTag', (_e, ids, tag) => macroStore.bulkAddTag(ids, tag));

ipcMain.handle('macros:testAction', async (_e, action) => {
  try {
    await macroPlayer.runSingle(action);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('macros:getScreenSize', () => {
  const cursor = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursor);
  return { displayId: display.id, bounds: display.bounds, width: display.bounds.width, height: display.bounds.height };
});

ipcMain.handle('macros:getDisplays', () => screen.getAllDisplays().map((d, i) => ({
  id: d.id,
  label: `Display ${i + 1} (${d.bounds.width}x${d.bounds.height}${d.internal ? ', built-in' : ''})`,
  bounds: d.bounds,
})));

ipcMain.handle('macros:pickPixel', () => macroPlayer.pickPixelUnderCursor());

ipcMain.handle('macros:stopPlaying', () => {
  macroPlayer.stop();
  return true;
});

ipcMain.handle('macros:isPlaying', () => macroPlayer.isPlaying());

ipcMain.handle('macros:getCursorPos', () => screen.getCursorScreenPoint());

ipcMain.handle('macros:getKeyNames', () => keymap.KEY_NAMES);

ipcMain.handle('macros:panicRelease', async () => {
  await macroPlayer.panicReleaseAll();
  return true;
});

ipcMain.handle('macros:getKillSwitch', () => Boolean(appSettings.get('macrosDisabled')));

ipcMain.handle('macros:setKillSwitch', (_e, disabled) => {
  appSettings.set('macrosDisabled', Boolean(disabled));
  syncMacroTriggers();
  refreshTrayMacroToggle();
  return Boolean(disabled);
});

ipcMain.handle('macros:getVersions', (_e, id) => macroStore.getVersions(id));

ipcMain.handle('macros:restoreVersion', (_e, id, versionAt) => {
  const restored = macroStore.restoreVersion(id, versionAt);
  syncMacroTriggers();
  return restored;
});

ipcMain.handle('macros:export', async (_e, id) => {
  const macro = macroStore.getMacro(id);
  if (!macro) return { ok: false, error: 'Macro not found' };
  const { canceled, filePath } = await dialog.showSaveDialog(safeWindow(), {
    title: 'Export macro',
    defaultPath: `${macro.name.replace(/[^\w\- ]/g, '')}.rexiomacro.json`,
    filters: [{ name: 'Rexio Macro', extensions: ['json'] }],
  });
  if (canceled || !filePath) return { ok: false, canceled: true };
  try {
    fs.writeFileSync(filePath, JSON.stringify(macro, null, 2), 'utf8');
    return { ok: true, filePath };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('macros:import', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(safeWindow(), {
    title: 'Import macro',
    filters: [{ name: 'Rexio Macro', extensions: ['json'] }],
    properties: ['openFile', 'multiSelections'],
  });
  if (canceled || !filePaths.length) return { ok: false, canceled: true };
  const imported = [];
  const errors = [];
  for (const fp of filePaths) {
    try {
      const data = JSON.parse(fs.readFileSync(fp, 'utf8'));
      if (!Array.isArray(data.actions)) throw new Error('Not a valid macro file');
      imported.push(macroStore.importMacro(data));
    } catch (e) {
      errors.push(`${path.basename(fp)}: ${e.message}`);
    }
  }
  syncMacroTriggers();
  return { ok: errors.length === 0, imported, errors };
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

ipcMain.handle('app:getSessionInfo', () => ({
  isWayland: !IS_WINDOWS && process.env.XDG_SESSION_TYPE === 'wayland',
}));

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

ipcMain.handle('window:minimize', () => safeWindow()?.minimize());
ipcMain.handle('window:close', () => safeWindow()?.close());
ipcMain.handle('window:zoomIn', () => {
  const w = safeWindow();
  if (w) w.webContents.zoomLevel += 0.5;
});
ipcMain.handle('window:zoomOut', () => {
  const w = safeWindow();
  if (w) w.webContents.zoomLevel -= 0.5;
});
ipcMain.handle('window:resetZoom', () => {
  const w = safeWindow();
  if (w) w.webContents.zoomLevel = 0;
});
ipcMain.handle('window:toggleFullscreen', () => {
  const w = safeWindow();
  if (w) w.setFullScreen(!w.isFullScreen());
});
ipcMain.handle('app:quit', () => { isQuitting = true; app.quit(); });
ipcMain.handle('app:showAbout', () => ({
  version: app.getVersion(),
}));

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!safeWindow()) {
      showMainWindow();
      return;
    }
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    createMainWindow();
    buildAppMenu();
    if (appSettings.get('showTrayIcon')) createTray();
    startPresencePolling();
    syncMacroTriggers();
    globalShortcut.register(macroHotkeys.RESERVED_ACCELERATOR, () => {
      macroPlayer.panicReleaseAll();
      logger.error('Panic release triggered');
      notify('Rexio', 'Panic release: all macro-held keys and mouse buttons were released.');
      const w = safeWindow();
      if (w) w.webContents.send('macro:panicked');
    });
    maybeRunAutoBackup();
    setInterval(maybeRunAutoBackup, 60 * 60 * 1000);

    if (app.isPackaged) {
      const { autoUpdater } = require('electron-updater');
      autoUpdater.checkForUpdatesAndNotify().catch(() => {});
    }
  });

  app.on('before-quit', () => {
    isQuitting = true;
    macroHotkeys.unregisterAll();
    macroPixelTrigger.unregisterAll();
    macroScheduler.unregisterAll();
    if (macroRecorder.isRecording()) macroRecorder.stop();
    if (macroPlayer.isPlaying()) macroPlayer.stop();
  });
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
