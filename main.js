const { app, BrowserWindow, ipcMain, globalShortcut, Tray, Menu, nativeImage, dialog, shell, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Load native input simulator (koffi FFI → user32 SendInput)
let input = null;
try { input = require('./src/native/input.js'); console.log('Native input loaded via koffi'); } catch(e) { console.log('Native input not available:', e.message); }

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
let macroRunning = false;
let macroAbort = false;
let mouseTriggerInterval = null; // polling for mouse button triggers
let mouseTriggerBindings = new Map(); // vkCode → macroId

/** Keyran/Oscar .amc files are often UTF-16 LE; reading as UTF-8 breaks XML/Syntax parsing. */
function readTextFileAutoEncoding(filePath) {
  const buf = fs.readFileSync(filePath);
  if (buf.length < 2) return buf.toString('utf8');
  // UTF-16 LE BOM
  if (buf[0] === 0xff && buf[1] === 0xfe) return buf.slice(2).toString('utf16le');
  // UTF-16 BE BOM
  if (buf[0] === 0xfe && buf[1] === 0xff) {
    const body = Buffer.from(buf.slice(2));
    body.swap16();
    return body.toString('utf16le');
  }
  return buf.toString('utf8');
}

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
      content: readTextFileAutoEncoding(fp)
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

  // Rename profile
  ipcMain.handle('rename-profile', (_, oldName, newName) => {
    if (oldName === 'Default') return false;
    const oldDir = path.join(PROFILES_DIR, oldName);
    const newDir = path.join(PROFILES_DIR, newName);
    if (!fs.existsSync(oldDir) || fs.existsSync(newDir)) return false;
    fs.renameSync(oldDir, newDir);
    if (currentProfile === oldName) switchProfile(newName);
    return getProfiles();
  });

  // Copy imported file into current profile directory
  ipcMain.handle('import-to-profile', (_, sourcePath, destName) => {
    try {
      const dest = path.join(PROFILES_DIR, currentProfile, destName);
      fs.copyFileSync(sourcePath, dest);
      return true;
    } catch { return false; }
  });

  // Mouse position
  ipcMain.handle('get-mouse-position', () => {
    if (input) return input.getMousePos();
    const pt = screen.getCursorScreenPoint();
    return { x: pt.x, y: pt.y };
  });

  // Pixel color at position
  ipcMain.handle('get-pixel-color', (_, x, y) => {
    if (!input) return '000000';
    try { return input.getPixelColor(x, y); } catch { return '000000'; }
  });

  // ── Mouse Button Trigger Registration ─────────────────────────────
  // Electron's globalShortcut doesn't support mouse buttons, so we poll
  ipcMain.handle('register-mouse-trigger', (_, macroId, vkCode) => {
    mouseTriggerBindings.set(vkCode, macroId);
    startMouseTriggerPolling();
    return true;
  });

  ipcMain.handle('unregister-mouse-trigger', (_, vkCode) => {
    mouseTriggerBindings.delete(vkCode);
    if (mouseTriggerBindings.size === 0) stopMouseTriggerPolling();
    return true;
  });

  // ── Macro Execution ──────────────────────────────────────────────
  ipcMain.handle('execute-macro', async (_, commands, settings) => {
    if (macroRunning) return { success: false, error: 'Macro already running' };
    if (!input) return { success: false, error: 'Input module not available' };
    macroRunning = true;
    macroAbort = false;
    mainWindow.webContents.send('macro-state', { running: true });

    const speed = (settings.speedMultiplier || 1);
    const randomize = settings.randomDelays || false;
    const loopEnabled = settings.loop || false;
    const loopCount = settings.loopCount || 0;

    function jitter(ms) {
      if (!randomize) return Math.round(ms / speed);
      const variance = ms * 0.2;
      return Math.max(1, Math.round((ms + (Math.random() * variance * 2 - variance)) / speed));
    }

    async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

    async function runOnce(cmds) {
      for (let i = 0; i < cmds.length; i++) {
        if (macroAbort) return;
        const cmd = cmds[i];
        mainWindow.webContents.send('macro-line', i);
        try {
          switch (cmd.type) {
            case 'KeyDown': input.keyDown(cmd.keyCode); break;
            case 'KeyUp': input.keyUp(cmd.keyCode); break;
            case 'LeftDown': input.mouseDown('left'); break;
            case 'LeftUp': input.mouseUp('left'); break;
            case 'RightDown': input.mouseDown('right'); break;
            case 'RightUp': input.mouseUp('right'); break;
            case 'MiddleDown': input.mouseDown('middle'); break;
            case 'MiddleUp': input.mouseUp('middle'); break;
            case 'XButton1Down': input.mouseDown('x1'); break;
            case 'XButton1Up': input.mouseUp('x1'); break;
            case 'XButton2Down': input.mouseDown('x2'); break;
            case 'XButton2Up': input.mouseUp('x2'); break;
            case 'ScrollUp': input.scroll(cmd.value || 3); break;
            case 'ScrollDown': input.scroll(-(cmd.value || 3)); break;
            case 'Delay': await sleep(jitter(cmd.value)); break;
            case 'RandomDelay': await sleep(jitter(Math.floor(Math.random()*(cmd.max-cmd.min)+cmd.min))); break;
            case 'MouseMove': input.moveMouse(cmd.x, cmd.y); break;
            case 'GoTo': i = (cmd.targetLine - 1) - 1; break;
            case 'GoWhile': {
              if (!cmd._counter) cmd._counter = 0;
              cmd._counter++;
              if (cmd._counter < cmd.count) { i = (cmd.startLine - 1) - 1; }
              else { cmd._counter = 0; }
              break;
            }
            case 'Comment': break;
            case 'ColorDetect': {
              const color = input.getPixelColor(cmd.x, cmd.y);
              if (color.toLowerCase() !== (cmd.color || '').toLowerCase()) {
                i++;
              }
              break;
            }
          }
        } catch(err) { /* skip command on error */ }
      }
    }

    try {
      if (loopEnabled) {
        let iterations = 0;
        while (!macroAbort && (loopCount === 0 || iterations < loopCount)) {
          await runOnce(commands);
          iterations++;
        }
      } else {
        await runOnce(commands);
      }
    } catch(e) { /* macro error */ }

    macroRunning = false;
    macroAbort = false;
    mainWindow.webContents.send('macro-state', { running: false });
    return { success: true };
  });

  ipcMain.handle('stop-macro', () => {
    macroAbort = true;
    macroRunning = false;
    return true;
  });

  ipcMain.handle('is-macro-running', () => macroRunning);

  // App info
  ipcMain.handle('get-app-info', () => ({
    name: APP_NAME,
    version: app.getVersion(),
    profilesDir: PROFILES_DIR,
    platform: process.platform,
    pid: process.pid,
    hasInput: !!input
  }));
}

// ── Mouse Button Trigger Polling ───────────────────────────────────
// Checks if bound mouse buttons are pressed and fires trigger events
let mouseButtonStates = new Map();

function startMouseTriggerPolling() {
  if (mouseTriggerInterval || !input) return;
  mouseTriggerInterval = setInterval(() => {
    for (const [vkCode, macroId] of mouseTriggerBindings) {
      const pressed = input.isKeyDown(vkCode);
      const wasPressed = mouseButtonStates.get(vkCode) || false;
      if (pressed && !wasPressed) {
        // Button just pressed — fire trigger
        if (mainWindow) mainWindow.webContents.send('hotkey-triggered', macroId);
      }
      mouseButtonStates.set(vkCode, pressed);
    }
  }, 16); // ~60Hz polling
}

function stopMouseTriggerPolling() {
  if (mouseTriggerInterval) {
    clearInterval(mouseTriggerInterval);
    mouseTriggerInterval = null;
  }
  mouseButtonStates.clear();
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
