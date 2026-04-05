const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('kyrun', {
  // ── Settings ───────────────────────────────
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),

  // ── Profiles ───────────────────────────────
  getProfiles: () => ipcRenderer.invoke('get-profiles'),
  getCurrentProfile: () => ipcRenderer.invoke('get-current-profile'),
  switchProfile: (name) => ipcRenderer.invoke('switch-profile', name),
  createProfile: (name) => ipcRenderer.invoke('create-profile', name),
  deleteProfile: (name) => ipcRenderer.invoke('delete-profile', name),
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

  // ── Events ─────────────────────────────────
  onProfileChanged: (cb) => ipcRenderer.on('profile-changed', (_, name) => cb(name)),
  onAnonymousModeChanged: (cb) => ipcRenderer.on('anonymous-mode-changed', (_, status) => cb(status)),
  onHotkeyTriggered: (cb) => ipcRenderer.on('hotkey-triggered', (_, id) => cb(id)),

  // ── App Info ───────────────────────────────
  getAppInfo: () => ipcRenderer.invoke('get-app-info')
});
