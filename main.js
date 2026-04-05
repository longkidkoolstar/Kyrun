const { app, BrowserWindow, ipcMain, globalShortcut, Tray, Menu, nativeImage, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

// ── App Configuration ──────────────────────────────────────────────
const APP_NAME = 'Kyrun';
const PROFILES_DIR = path.join(app.getPath('userData'), 'profiles');
const SETTINGS_PATH = path.join(app.getPath('userData'), 'settings.json');

let mainWindow = null;
let tray = null;
let isAnonymousMode = false;
let currentProfile = 'Default';
let appSettings = {};
let registeredHotkeys = new Map();

// ── Ensure directories exist ───────────────────────────────────────
function ensureDirectories() {
  if (!fs.existsSync(PROFILES_DIR)) {
    fs.mkdirSync(PROFILES_DIR, { recursive: true });
  }
  const defaultProfile = path.join(PROFILES_DIR, 'Default');
  if (!fs.existsSync(defaultProfile)) {
    fs.mkdirSync(defaultProfile, { recursive: true });
    // Create a sample macro
    const sampleMacro = {
      name: 'Sample Macro',
      version: '1.0',
      commands: [
        { type: 'Comment', value: 'This is a sample macro' },
        { type: 'KeyDown', keyCode: 65, device: 1 },
        { type: 'Delay', value: 100 },
        { type: 'KeyUp', keyCode: 65, device: 1 }
      ],
      settings: {
        loop: false,
        loopCount: 1,
        bindKey: '',
        windowBind: ''
      }
    };
    fs.writeFileSync(
      path.join(defaultProfile, 'Sample Macro.kyrun'),
      JSON.stringify(sampleMacro, null, 2)
    );
  }
}

// ── Load / Save Settings ───────────────────────────────────────────
function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_PATH)) {
      appSettings = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
    }
  } catch (e) {
    appSettings = {};
  }
  return {
    theme: 'dark',
    startMinimized: false,
    minimizeToTray: true,
    anonymousOnStartup: false,
    language: 'en',
    defaultDelay: 50,
    speedMultiplier: 1.0,
    coordinateMode: 'absolute',
    streamerMode: false,
    profileHotkeys: {},
    ...appSettings
  };
}

function saveSettings(settings) {
  appSettings = { ...appSettings, ...settings };
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(appSettings, null, 2));
}

// ── Create Main Window ─────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#0d1117',
    icon: path.join(__dirname, 'src', 'assets', 'icons', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    },
    show: false
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    if (!appSettings.startMinimized) {
      mainWindow.show();
    }
  });

  mainWindow.on('close', (e) => {
    if (appSettings.minimizeToTray && !app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  // Dev tools in dev mode
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
}

// ── System Tray ────────────────────────────────────────────────────
function createTray() {
  // Create a simple 16x16 tray icon
  const iconSize = 16;
  const canvas = nativeImage.createEmpty();
  
  tray = new Tray(canvas.resize({ width: iconSize, height: iconSize }));
  
  updateTrayMenu();
  
  tray.on('double-click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  tray.setToolTip(`${APP_NAME} - Profile: ${currentProfile}`);
}

function updateTrayMenu() {
  if (!tray) return;
  
  const profiles = getProfiles();
  const profileMenuItems = profiles.map(p => ({
    label: p,
    type: 'radio',
    checked: p === currentProfile,
    click: () => switchProfile(p)
  }));

  const contextMenu = Menu.buildFromTemplate([
    { label: `${APP_NAME}`, enabled: false },
    { type: 'separator' },
    { label: 'Show Window', click: () => { mainWindow.show(); mainWindow.focus(); } },
    { type: 'separator' },
    { label: 'Profiles', submenu: profileMenuItems },
    { type: 'separator' },
    { label: `Anonymous Mode: ${isAnonymousMode ? 'ON' : 'OFF'}`, click: () => toggleAnonymousMode() },
    { type: 'separator' },
    { label: 'Quit', click: () => { app.isQuitting = true; app.quit(); } }
  ]);

  tray.setContextMenu(contextMenu);
}

// ── Profile Management ─────────────────────────────────────────────
function getProfiles() {
  try {
    return fs.readdirSync(PROFILES_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);
  } catch {
    return ['Default'];
  }
}

function switchProfile(profileName) {
  currentProfile = profileName;
  if (tray) {
    tray.setToolTip(`${APP_NAME} - Profile: ${currentProfile}`);
    updateTrayMenu();
  }
  if (mainWindow) {
    mainWindow.webContents.send('profile-changed', profileName);
  }
}

function getProfileMacros(profileName) {
  const profileDir = path.join(PROFILES_DIR, profileName);
  if (!fs.existsSync(profileDir)) return [];
  
  function readDir(dir, basePath = '') {
    const items = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = path.join(basePath, entry.name);
      if (entry.isDirectory()) {
        items.push({
          name: entry.name,
          type: 'folder',
          path: relativePath,
          children: readDir(fullPath, relativePath)
        });
      } else if (entry.name.endsWith('.kyrun') || entry.name.endsWith('.amc') || entry.name.endsWith('.krm')) {
        items.push({
          name: entry.name.replace(/\.(kyrun|amc|krm)$/, ''),
          type: 'macro',
          path: relativePath,
          fullPath: fullPath
        });
      }
    }
    return items;
  }
  
  return readDir(profileDir);
}

// ── Anonymous Mode ─────────────────────────────────────────────────
function toggleAnonymousMode() {
  isAnonymousMode = !isAnonymousMode;
  updateTrayMenu();
  if (mainWindow) {
    mainWindow.webContents.send('anonymous-mode-changed', isAnonymousMode);
  }
  
  if (isAnonymousMode) {
    // Hide window title
    mainWindow.setTitle(generateRandomProcessName());
  } else {
    mainWindow.setTitle(APP_NAME);
  }
}

function generateRandomProcessName() {
  const names = [
    'System Service Host', 'Windows Audio', 'Desktop Window Manager',
    'Windows Shell', 'Runtime Broker', 'Application Host',
    'Background Task', 'Service Worker', 'Update Agent',
    'Security Health', 'Compatibility Manager'
  ];
  const suffixes = ['Service', 'Host', 'Manager', 'Worker', 'Agent'];
  const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];
  return Math.random() > 0.5 ? rand(names) : `Windows ${rand(suffixes)} (${Math.floor(Math.random() * 9000 + 1000)})`;
}

// ── IPC Handlers ───────────────────────────────────────────────────
function setupIPC() {
  // Settings
  ipcMain.handle('get-settings', () => loadSettings());
  ipcMain.handle('save-settings', (_, settings) => saveSettings(settings));
  
  // Profiles
  ipcMain.handle('get-profiles', () => getProfiles());
  ipcMain.handle('get-current-profile', () => currentProfile);
  ipcMain.handle('switch-profile', (_, name) => switchProfile(name));
  ipcMain.handle('create-profile', (_, name) => {
    const dir = path.join(PROFILES_DIR, name);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return getProfiles();
  });
  ipcMain.handle('delete-profile', (_, name) => {
    if (name === 'Default') return false;
    const dir = path.join(PROFILES_DIR, name);
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true });
    if (currentProfile === name) switchProfile('Default');
    return getProfiles();
  });
  ipcMain.handle('get-profile-macros', (_, name) => getProfileMacros(name || currentProfile));
  
  // File operations
  ipcMain.handle('read-macro-file', (_, filePath) => {
    try {
      const fullPath = path.isAbsolute(filePath) ? filePath : path.join(PROFILES_DIR, currentProfile, filePath);
      return fs.readFileSync(fullPath, 'utf8');
    } catch (e) {
      return null;
    }
  });
  
  ipcMain.handle('save-macro-file', (_, filePath, content) => {
    try {
      const fullPath = path.isAbsolute(filePath) ? filePath : path.join(PROFILES_DIR, currentProfile, filePath);
      const dir = path.dirname(fullPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(fullPath, content, 'utf8');
      return true;
    } catch (e) {
      return false;
    }
  });

  ipcMain.handle('create-macro', (_, name, profileName) => {
    const profile = profileName || currentProfile;
    const macro = {
      name: name,
      version: '1.0',
      commands: [],
      settings: { loop: false, loopCount: 1, bindKey: '', windowBind: '' }
    };
    const filePath = path.join(PROFILES_DIR, profile, `${name}.kyrun`);
    fs.writeFileSync(filePath, JSON.stringify(macro, null, 2));
    return true;
  });

  ipcMain.handle('delete-macro', (_, filePath) => {
    try {
      const fullPath = path.isAbsolute(filePath) ? filePath : path.join(PROFILES_DIR, currentProfile, filePath);
      if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
      return true;
    } catch { return false; }
  });

  ipcMain.handle('create-folder', (_, folderPath) => {
    const fullPath = path.join(PROFILES_DIR, currentProfile, folderPath);
    if (!fs.existsSync(fullPath)) fs.mkdirSync(fullPath, { recursive: true });
    return true;
  });

  // Import/Export
  ipcMain.handle('import-file-dialog', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      filters: [
        { name: 'All Macro Files', extensions: ['amc', 'krm', 'kyrun'] },
        { name: 'Keyran Files', extensions: ['amc', 'krm'] },
        { name: 'Kyrun Files', extensions: ['kyrun'] }
      ],
      properties: ['openFile', 'multiSelections']
    });
    if (result.canceled) return null;
    return result.filePaths.map(fp => ({
      path: fp,
      name: path.basename(fp),
      content: fs.readFileSync(fp, 'utf8')
    }));
  });

  ipcMain.handle('export-file-dialog', async (_, defaultName) => {
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: defaultName,
      filters: [
        { name: 'Keyran AMC', extensions: ['amc'] },
        { name: 'Kyrun File', extensions: ['kyrun'] },
        { name: 'AutoHotkey Script', extensions: ['ahk'] }
      ]
    });
    return result.canceled ? null : result.filePath;
  });

  // Anonymous Mode
  ipcMain.handle('toggle-anonymous', () => {
    toggleAnonymousMode();
    return isAnonymousMode;
  });
  ipcMain.handle('get-anonymous-status', () => isAnonymousMode);

  // Window controls
  ipcMain.on('window-minimize', () => mainWindow.minimize());
  ipcMain.on('window-maximize', () => {
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  });
  ipcMain.on('window-close', () => mainWindow.close());
  
  // Hotkey registration
  ipcMain.handle('register-hotkey', (_, id, accelerator) => {
    try {
      if (registeredHotkeys.has(id)) {
        globalShortcut.unregister(registeredHotkeys.get(id));
      }
      globalShortcut.register(accelerator, () => {
        mainWindow.webContents.send('hotkey-triggered', id);
      });
      registeredHotkeys.set(id, accelerator);
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle('unregister-hotkey', (_, id) => {
    if (registeredHotkeys.has(id)) {
      globalShortcut.unregister(registeredHotkeys.get(id));
      registeredHotkeys.delete(id);
    }
    return true;
  });

  // App info
  ipcMain.handle('get-app-info', () => ({
    name: APP_NAME,
    version: app.getVersion(),
    profilesDir: PROFILES_DIR,
    platform: process.platform,
    pid: process.pid
  }));
}

// ── App Lifecycle ──────────────────────────────────────────────────
app.whenReady().then(() => {
  ensureDirectories();
  appSettings = loadSettings();
  setupIPC();
  createWindow();
  createTray();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    // Don't quit if minimize to tray is enabled
    if (!appSettings.minimizeToTray) {
      app.quit();
    }
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});
