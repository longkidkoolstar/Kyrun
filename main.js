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
/** Window/tray title string while anonymous (matches fake process name). */
let anonymousDisplayTitle = '';
let currentProfile = 'Default';
let appSettings = {};
let registeredHotkeys = new Map();
let macroRunning = false;
let macroAbort = false;
let mouseTriggerInterval = null; // polling for mouse button triggers
let mouseTriggerBindings = new Map(); // vkCode → macroId
/** Special macroId: fires even when macro triggers are disarmed (toggles armed state). */
const TOGGLE_TRIGGERS_ID = '!kyrun:toggle-triggers';
let triggersToggleAccelRegistered = null;
let triggersToggleMouseVk = null;

/** Global macro recording while the window is unfocused (GetAsyncKeyState polling). */
let recordCaptureInterval = null;
const recordPrevKeyState = new Uint8Array(256);
const recordMousePendingUp = new Map(); // vk → true if we recorded a Down outside Kyrun

const MOUSE_RECORD_VKS = [
  { vk: 0x01, down: 'LeftDown', up: 'LeftUp' },
  { vk: 0x02, down: 'RightDown', up: 'RightUp' },
  { vk: 0x04, down: 'MiddleDown', up: 'MiddleUp' },
  { vk: 0x05, down: 'XButton1Down', up: 'XButton1Up' },
  { vk: 0x06, down: 'XButton2Down', up: 'XButton2Up' }
];

function pointInMainWindowScreen(pt) {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  const b = mainWindow.getBounds();
  return pt.x >= b.x && pt.x < b.x + b.width && pt.y >= b.y && pt.y < b.y + b.height;
}

function startRecordCapturePolling() {
  if (recordCaptureInterval || !input) return;
  recordPrevKeyState.fill(0);
  recordMousePendingUp.clear();
  recordCaptureInterval = setInterval(() => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const wc = mainWindow.webContents;
    if (!wc || wc.isDestroyed()) return;

    const cursor = input.getMousePos();
    const insideKyrun = pointInMainWindowScreen(cursor);
    const kyrunFocused = mainWindow.isFocused();

    for (const { vk, down, up } of MOUSE_RECORD_VKS) {
      const pressed = input.isKeyDown(vk);
      const prev = recordPrevKeyState[vk];
      if (pressed && !prev) {
        if (!insideKyrun) {
          wc.send('record-capture', { kind: 'mouse', cmdType: down });
          recordMousePendingUp.set(vk, true);
        }
        recordPrevKeyState[vk] = 1;
      } else if (!pressed && prev) {
        if (recordMousePendingUp.get(vk)) {
          wc.send('record-capture', { kind: 'mouse', cmdType: up });
          recordMousePendingUp.delete(vk);
        }
        recordPrevKeyState[vk] = 0;
      } else {
        recordPrevKeyState[vk] = pressed ? 1 : 0;
      }
    }

    if (!kyrunFocused) {
      if (input.isKeyDown(0x1b) && !recordPrevKeyState[0x1b]) {
        wc.send('record-capture', { kind: 'stop' });
        for (let vk = 1; vk < 256; vk++) {
          recordPrevKeyState[vk] = input.isKeyDown(vk) ? 1 : 0;
        }
        return;
      }
      for (let vk = 8; vk < 256; vk++) {
        const pressed = input.isKeyDown(vk);
        const prev = recordPrevKeyState[vk];
        if (pressed && !prev) {
          wc.send('record-capture', { kind: 'key', cmdType: 'down', keyCode: vk });
        } else if (!pressed && prev) {
          wc.send('record-capture', { kind: 'key', cmdType: 'up', keyCode: vk });
        }
        recordPrevKeyState[vk] = pressed ? 1 : 0;
      }
    } else {
      for (let vk = 8; vk < 256; vk++) {
        recordPrevKeyState[vk] = input.isKeyDown(vk) ? 1 : 0;
      }
    }
  }, 8);
}

function stopRecordCapturePolling() {
  if (recordCaptureInterval) {
    clearInterval(recordCaptureInterval);
    recordCaptureInterval = null;
  }
  recordPrevKeyState.fill(0);
  recordMousePendingUp.clear();
}

/** Global hotkeys (macro binds + profile-switch binds) only fire when true (titlebar or tray). */
let macroTriggersArmed = false;

function macroTriggersEffectivelyArmed() {
  return macroTriggersArmed;
}

function sendMacroTriggersState() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('macro-triggers-state', { armed: macroTriggersArmed });
  }
  if (tray) updateTrayMenu();
}

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
        windowBind: '',
        holdWhilePressed: false,
        holdBetweenPassesMs: 45,
        bindSecondPressStops: false
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
  let raw = {};
  try {
    if (fs.existsSync(SETTINGS_PATH)) {
      raw = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
    }
  } catch (e) {
    raw = {};
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
    /** Global default: apply ±20% delay jitter (same as per-macro Randomize delays). */
    randomTiming: true,
    profileHotkeys: {},
    /** When true, register a global key/mouse bind that toggles macro hotkeys armed (titlebar). */
    triggersToggleBindEnabled: false,
    triggersToggleBindKey: '',
    triggersToggleBindVk: 0,
    triggersToggleBindIsMouse: false,
    ...raw
  };
}

/** Same rules as renderer `convertToElectronAccelerator` — keyboard-only. */
function keyNameToElectronAccelerator(keyname) {
  if (!keyname) return null;
  if (keyname.includes('Mouse')) return null;
  if (/^[A-Z0-9]$/i.test(keyname)) return keyname.toUpperCase();
  if (/^F([1-9]|1[0-2])$/i.test(keyname)) return keyname.toUpperCase();
  const map = {
    Space: 'Space', Enter: 'Return', Escape: 'Escape', Tab: 'Tab',
    Backspace: 'Backspace', Delete: 'Delete', Insert: 'Insert',
    Home: 'Home', End: 'End', PgUp: 'PageUp', PgDn: 'PageDown',
    Up: 'Up', Down: 'Down', Left: 'Left', Right: 'Right',
    Pause: 'Pause', CapsLock: 'CapsLock', NumLock: 'NumLock', ScrollLock: 'ScrollLock',
    Num0: 'num0', Num1: 'num1', Num2: 'num2', Num3: 'num3', Num4: 'num4',
    Num5: 'num5', Num6: 'num6', Num7: 'num7', Num8: 'num8', Num9: 'num9',
    'Num*': 'nummult', 'Num+': 'numadd', 'Num-': 'numsub', 'Num.': 'numdec', 'Num/': 'numdiv',
    LShift: 'Shift', RShift: 'Shift', Shift: 'Shift',
    LCtrl: 'Control', RCtrl: 'Control', Ctrl: 'Control',
    LAlt: 'Alt', RAlt: 'Alt', Alt: 'Alt'
  };
  if (map[keyname]) return map[keyname];
  return null;
}

function unregisterTriggersToggleBind() {
  if (triggersToggleAccelRegistered) {
    try { globalShortcut.unregister(triggersToggleAccelRegistered); } catch (_) {}
    triggersToggleAccelRegistered = null;
  }
  if (triggersToggleMouseVk != null) {
    mouseTriggerBindings.delete(triggersToggleMouseVk);
    triggersToggleMouseVk = null;
    if (mouseTriggerBindings.size === 0) stopMouseTriggerPolling();
  }
}

function applyTriggersToggleBind(settings) {
  unregisterTriggersToggleBind();
  if (!settings || !settings.triggersToggleBindEnabled) return;
  const vk = settings.triggersToggleBindVk || 0;
  const isMouse = !!settings.triggersToggleBindIsMouse;
  const keyName = settings.triggersToggleBindKey || '';
  if (isMouse) {
    if (!input || !vk) return;
    mouseTriggerBindings.set(vk, TOGGLE_TRIGGERS_ID);
    triggersToggleMouseVk = vk;
    startMouseTriggerPolling();
    return;
  }
  const accel = keyNameToElectronAccelerator(keyName);
  if (!accel) return;
  try {
    globalShortcut.register(accel, () => {
      macroTriggersArmed = !macroTriggersArmed;
      sendMacroTriggersState();
    });
    triggersToggleAccelRegistered = accel;
  } catch (_) {
    triggersToggleAccelRegistered = null;
  }
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

  setTrayTooltip();
}

function setTrayTooltip() {
  if (!tray) return;
  if (isAnonymousMode && anonymousDisplayTitle) {
    tray.setToolTip(`${anonymousDisplayTitle} — Profile: ${currentProfile}`);
  } else {
    tray.setToolTip(`${APP_NAME} - Profile: ${currentProfile}`);
  }
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

  const headerLabel = isAnonymousMode && anonymousDisplayTitle ? anonymousDisplayTitle : APP_NAME;

  const contextMenu = Menu.buildFromTemplate([
    { label: headerLabel, enabled: false },
    { type: 'separator' },
    { label: 'Show Window', click: () => { mainWindow.show(); mainWindow.focus(); } },
    { type: 'separator' },
    {
      label: `Global hotkeys: ${macroTriggersArmed ? 'ON' : 'OFF'}`,
      click: () => {
        macroTriggersArmed = !macroTriggersArmed;
        sendMacroTriggersState();
      }
    },
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
    setTrayTooltip();
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
function setAnonymousMode(enabled) {
  isAnonymousMode = !!enabled;
  if (mainWindow) {
    if (isAnonymousMode) {
      anonymousDisplayTitle = generateRandomProcessName();
      mainWindow.setTitle(anonymousDisplayTitle);
    } else {
      anonymousDisplayTitle = '';
      mainWindow.setTitle(APP_NAME);
    }
    mainWindow.webContents.send('anonymous-mode-changed', isAnonymousMode);
  } else if (!isAnonymousMode) {
    anonymousDisplayTitle = '';
  }
  updateTrayMenu();
  setTrayTooltip();
}

function toggleAnonymousMode() {
  setAnonymousMode(!isAnonymousMode);
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

function sanitizeMacroRenameBase(name) {
  if (!name || typeof name !== 'string') return '';
  let s = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/\s+/g, ' ').trim();
  s = s.replace(/\.(kyrun|amc|krm)$/i, '');
  if (!s || s === '.' || s === '..') return '';
  if (s.length > 100) s = s.slice(0, 100);
  return s;
}

function win32PathsEqualInsensitive(a, b) {
  return path.normalize(a).toLowerCase() === path.normalize(b).toLowerCase();
}

// ── IPC Handlers ───────────────────────────────────────────────────
function setupIPC() {
  // Settings
  ipcMain.handle('get-settings', () => loadSettings());
  ipcMain.handle('save-settings', (_, settings) => {
    saveSettings(settings);
    applyTriggersToggleBind(appSettings);
    return true;
  });

  ipcMain.handle('reapply-triggers-toggle-bind', () => {
    applyTriggersToggleBind(appSettings);
    return true;
  });

  ipcMain.handle('get-macro-triggers-state', () => ({ armed: macroTriggersArmed }));
  ipcMain.handle('set-macro-triggers-armed', (_, armed) => {
    macroTriggersArmed = !!armed;
    sendMacroTriggersState();
    return true;
  });
  
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
      settings: { loop: false, loopCount: 1, bindKey: '', windowBind: '', holdWhilePressed: false, holdBetweenPassesMs: 45, bindSecondPressStops: false }
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

  ipcMain.handle('rename-macro', (_, oldRelativePath, newName) => {
    try {
      const base = sanitizeMacroRenameBase(newName);
      if (!base) return { ok: false, error: 'Invalid name' };
      const profileDir = path.join(PROFILES_DIR, currentProfile);
      const oldFull = path.isAbsolute(oldRelativePath)
        ? oldRelativePath
        : path.join(profileDir, oldRelativePath);
      if (!fs.existsSync(oldFull)) return { ok: false, error: 'Not found' };

      const dir = path.dirname(oldFull);
      const ext = path.extname(oldFull) || '.kyrun';
      const newFull = path.join(dir, base + ext);
      const normOld = path.normalize(oldFull);
      const normNew = path.normalize(newFull);

      if (normOld === normNew) {
        return {
          ok: true,
          newPath: path.relative(profileDir, oldFull),
          displayName: path.basename(oldFull, ext)
        };
      }

      const caseOnlyRename = process.platform === 'win32' && win32PathsEqualInsensitive(oldFull, newFull) && normOld !== normNew;
      if (!caseOnlyRename && fs.existsSync(newFull)) return { ok: false, error: 'Exists' };

      if (caseOnlyRename) {
        const tmp = path.join(dir, `.__kyrun_rename_tmp_${Date.now()}${ext}`);
        fs.renameSync(oldFull, tmp);
        fs.renameSync(tmp, newFull);
      } else {
        fs.renameSync(oldFull, newFull);
      }

      if (ext.toLowerCase() === '.kyrun') {
        try {
          const raw = fs.readFileSync(newFull, 'utf8');
          const data = JSON.parse(raw);
          if (data && typeof data === 'object') {
            data.name = base;
            fs.writeFileSync(newFull, JSON.stringify(data, null, 2), 'utf8');
          }
        } catch (_) { /* renamed file kept */ }
      }

      return { ok: true, newPath: path.relative(profileDir, newFull), displayName: base };
    } catch (e) {
      return { ok: false, error: e.message || 'Rename failed' };
    }
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
        if (!macroTriggersEffectivelyArmed()) return;
        if (mainWindow) mainWindow.webContents.send('hotkey-triggered', id);
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
    if (!input) return false;
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
    const globalSettings = loadSettings();
    const randomize = !!(settings.randomDelays || isAnonymousMode || globalSettings.randomTiming);
    const loopEnabled = settings.loop || false;
    const loopCount = settings.loopCount || 0;
    const holdActive = !!(settings.triggerFromBind && settings.holdWhilePressed && settings.bindVk > 0);
    const ignoreGoWhile = holdActive;
    const releaseVk = holdActive ? settings.bindVk : 0;
    let holdPassGapMs = 0;
    if (holdActive) {
      const raw = settings.holdBetweenPassesMs;
      if (raw === undefined || raw === null) holdPassGapMs = 45;
      else {
        const n = Number(raw);
        holdPassGapMs = Number.isFinite(n) && n >= 0 ? Math.min(2000, n) : 45;
      }
    }
    const heldKeys = new Set();
    const heldMouse = new Set();

    /** Release any keys/buttons still down from this macro (always; not only in hold-while-trigger mode). */
    function releaseTrackedHoldInputs() {
      if (!input) return;
      const keys = [...heldKeys];
      const mice = [...heldMouse];
      heldKeys.clear();
      heldMouse.clear();
      for (const vk of keys) {
        try { input.keyUp(vk); } catch (_) {}
      }
      for (const b of mice) {
        try { input.mouseUp(b); } catch (_) {}
      }
    }

    function jitter(ms) {
      if (!randomize) return Math.round(ms / speed);
      const variance = ms * 0.2;
      return Math.max(1, Math.round((ms + (Math.random() * variance * 2 - variance)) / speed));
    }

    async function sleep(ms) {
      if (releaseVk) {
        const deadline = Date.now() + ms;
        while (Date.now() < deadline) {
          if (macroAbort) return;
          if (!input.isKeyDown(releaseVk)) { macroAbort = true; return; }
          await new Promise(r => setTimeout(r, Math.min(16, Math.max(1, deadline - Date.now()))));
        }
      } else {
        // Chunk delays so Stop / switching to another macro is not blocked for the full Delay duration.
        const deadline = Date.now() + ms;
        while (Date.now() < deadline) {
          if (macroAbort) return;
          await new Promise(r => setTimeout(r, Math.min(16, Math.max(1, deadline - Date.now()))));
        }
      }
    }

    /** Between hold-mode passes: no jitter; still abort if trigger released. */
    async function sleepHoldPassGap(ms) {
      if (ms <= 0) return;
      if (releaseVk) {
        const deadline = Date.now() + ms;
        while (Date.now() < deadline) {
          if (macroAbort) return;
          if (!input.isKeyDown(releaseVk)) { macroAbort = true; return; }
          await new Promise(r => setTimeout(r, Math.min(16, Math.max(1, deadline - Date.now()))));
        }
      } else {
        const deadline = Date.now() + ms;
        while (Date.now() < deadline) {
          if (macroAbort) return;
          await new Promise(r => setTimeout(r, Math.min(16, Math.max(1, deadline - Date.now()))));
        }
      }
    }

    async function runOnce(cmds) {
      for (let i = 0; i < cmds.length; i++) {
        if (macroAbort) return;
        // Skip release check before line 0: right after the hotkey fires, GetAsyncKeyState
        // for the trigger can briefly read "up" (or mismatch bindVk), which aborted before
        // the first command and looked like execution started on line 2. Delays still poll in sleep().
        if (releaseVk && i > 0 && !input.isKeyDown(releaseVk)) { macroAbort = true; return; }
        const cmd = cmds[i];
        mainWindow.webContents.send('macro-line', i);
        try {
          switch (cmd.type) {
            case 'KeyDown':
              input.keyDown(cmd.keyCode);
              heldKeys.add(cmd.keyCode);
              break;
            case 'KeyUp':
              input.keyUp(cmd.keyCode);
              heldKeys.delete(cmd.keyCode);
              break;
            case 'LeftDown':
              input.mouseDown('left');
              heldMouse.add('left');
              break;
            case 'LeftUp':
              input.mouseUp('left');
              heldMouse.delete('left');
              break;
            case 'RightDown':
              input.mouseDown('right');
              heldMouse.add('right');
              break;
            case 'RightUp':
              input.mouseUp('right');
              heldMouse.delete('right');
              break;
            case 'MiddleDown':
              input.mouseDown('middle');
              heldMouse.add('middle');
              break;
            case 'MiddleUp':
              input.mouseUp('middle');
              heldMouse.delete('middle');
              break;
            case 'XButton1Down':
              input.mouseDown('x1');
              heldMouse.add('x1');
              break;
            case 'XButton1Up':
              input.mouseUp('x1');
              heldMouse.delete('x1');
              break;
            case 'XButton2Down':
              input.mouseDown('x2');
              heldMouse.add('x2');
              break;
            case 'XButton2Up':
              input.mouseUp('x2');
              heldMouse.delete('x2');
              break;
            case 'ScrollUp': input.scroll(cmd.value || 3); break;
            case 'ScrollDown': input.scroll(-(cmd.value || 3)); break;
            case 'Delay': await sleep(jitter(cmd.value)); break;
            case 'RandomDelay': await sleep(jitter(Math.floor(Math.random()*(cmd.max-cmd.min)+cmd.min))); break;
            case 'MouseMove': input.moveMouse(cmd.x, cmd.y); break;
            case 'GoTo': i = (cmd.targetLine - 1) - 1; break;
            case 'GoWhile': {
              if (ignoreGoWhile) break;
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
      if (holdActive) {
        let firstHoldPass = true;
        do {
          if (macroAbort) break;
          if (!firstHoldPass && holdPassGapMs > 0) await sleepHoldPassGap(holdPassGapMs);
          firstHoldPass = false;
          await runOnce(commands);
        } while (!macroAbort && input.isKeyDown(releaseVk));
      } else if (loopEnabled) {
        let iterations = 0;
        while (!macroAbort && (loopCount === 0 || iterations < loopCount)) {
          await runOnce(commands);
          iterations++;
        }
      } else {
        await runOnce(commands);
      }
    } catch(e) { /* macro error */ }
    finally {
      releaseTrackedHoldInputs();
    }

    macroRunning = false;
    macroAbort = false;
    mainWindow.webContents.send('macro-state', { running: false });
    return { success: true };
  });

  ipcMain.handle('stop-macro', () => {
    macroAbort = true;
    // Keep macroRunning true until execute-macro finishes (finally + release); so is-macro-running
    // and queued triggers can wait for a clean handoff to the next macro.
    return true;
  });

  ipcMain.handle('is-macro-running', () => macroRunning);

  ipcMain.handle('start-global-record-capture', () => {
    if (!input) return { success: false };
    startRecordCapturePolling();
    return { success: true };
  });
  ipcMain.handle('stop-global-record-capture', () => {
    stopRecordCapturePolling();
    return true;
  });

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
        if (macroId === TOGGLE_TRIGGERS_ID) {
          macroTriggersArmed = !macroTriggersArmed;
          sendMacroTriggersState();
        } else {
          if (!macroTriggersEffectivelyArmed()) continue;
          if (mainWindow) mainWindow.webContents.send('hotkey-triggered', macroId);
        }
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
  if (appSettings.anonymousOnStartup) {
    setAnonymousMode(true);
  }
  applyTriggersToggleBind(appSettings);
  sendMacroTriggersState();
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
  stopRecordCapturePolling();
});
