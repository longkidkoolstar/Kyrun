const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('kyrun', {
  // ── Settings ───────────────────────────────
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  getMacroTriggersState: () => ipcRenderer.invoke('get-macro-triggers-state'),
  setMacroTriggersArmed: (armed) => ipcRenderer.invoke('set-macro-triggers-armed', armed),

  // ── Profiles ───────────────────────────────
  getProfiles: () => ipcRenderer.invoke('get-profiles'),
  getCurrentProfile: () => ipcRenderer.invoke('get-current-profile'),
  switchProfile: (name) => ipcRenderer.invoke('switch-profile', name),
  createProfile: (name) => ipcRenderer.invoke('create-profile', name),
  deleteProfile: (name) => ipcRenderer.invoke('delete-profile', name),
  renameProfile: (oldName, newName) => ipcRenderer.invoke('rename-profile', oldName, newName),
  getProfileMacros: (name) => ipcRenderer.invoke('get-profile-macros', name),

  // ── Macro Files ────────────────────────────
  readMacroFile: (path) => ipcRenderer.invoke('read-macro-file', path),
  saveMacroFile: (path, content) => ipcRenderer.invoke('save-macro-file', path, content),
  createMacro: (name, profile) => ipcRenderer.invoke('create-macro', name, profile),
  deleteMacro: (path) => ipcRenderer.invoke('delete-macro', path),
  createFolder: (path) => ipcRenderer.invoke('create-folder', path),

  // ── Import / Export ────────────────────────
  importFileDialog: () => ipcRenderer.invoke('import-file-dialog'),
  exportFileDialog: (name) => ipcRenderer.invoke('export-file-dialog', name),
  importToProfile: (src, dest) => ipcRenderer.invoke('import-to-profile', src, dest),

  // ── Macro Execution ────────────────────────
  executeMacro: (commands, settings) => ipcRenderer.invoke('execute-macro', commands, settings),
  stopMacro: () => ipcRenderer.invoke('stop-macro'),
  isMacroRunning: () => ipcRenderer.invoke('is-macro-running'),
  registerMouseTrigger: (id, vk) => ipcRenderer.invoke('register-mouse-trigger', id, vk),
  unregisterMouseTrigger: (vk) => ipcRenderer.invoke('unregister-mouse-trigger', vk),

  // ── Mouse / Screen ─────────────────────────
  getMousePosition: () => ipcRenderer.invoke('get-mouse-position'),
  getPixelColor: (x, y) => ipcRenderer.invoke('get-pixel-color', x, y),

  // ── Anonymous Mode ─────────────────────────
  toggleAnonymous: () => ipcRenderer.invoke('toggle-anonymous'),
  getAnonymousStatus: () => ipcRenderer.invoke('get-anonymous-status'),

  // ── Window Controls ────────────────────────
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),

  // ── Hotkeys ────────────────────────────────
  registerHotkey: (id, accel) => ipcRenderer.invoke('register-hotkey', id, accel),
  unregisterHotkey: (id) => ipcRenderer.invoke('unregister-hotkey', id),

  startGlobalRecordCapture: () => ipcRenderer.invoke('start-global-record-capture'),
  stopGlobalRecordCapture: () => ipcRenderer.invoke('stop-global-record-capture'),
  /** @returns {() => void} unsubscribe */
  onRecordCapture: (cb) => {
    const fn = (_, data) => cb(data);
    ipcRenderer.on('record-capture', fn);
    return () => ipcRenderer.removeListener('record-capture', fn);
  },

  // ── Events ─────────────────────────────────
  onProfileChanged: (cb) => ipcRenderer.on('profile-changed', (_, name) => cb(name)),
  onAnonymousModeChanged: (cb) => ipcRenderer.on('anonymous-mode-changed', (_, status) => cb(status)),
  onHotkeyTriggered: (cb) => ipcRenderer.on('hotkey-triggered', (_, id) => cb(id)),
  onMacroTriggersState: (cb) => ipcRenderer.on('macro-triggers-state', (_, data) => cb(data)),
  onMacroState: (cb) => ipcRenderer.on('macro-state', (_, data) => cb(data)),
  onMacroLine: (cb) => ipcRenderer.on('macro-line', (_, line) => cb(line)),

  // ── App Info ───────────────────────────────
  getAppInfo: () => ipcRenderer.invoke('get-app-info')
});
