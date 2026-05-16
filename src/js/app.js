// ═══════════════════════════════════════════════════════════════
// KYRUN — Main Application Controller (Full Featured)
// ═══════════════════════════════════════════════════════════════

// ── Complete Key Code Map ────────────────────────────────────
const KEY_CODE_MAP = {
  1:'LButton',2:'RButton',3:'Cancel',4:'MButton',5:'XButton1',6:'XButton2',
  8:'Backspace',9:'Tab',12:'Clear',13:'Enter',16:'Shift',17:'Ctrl',18:'Alt',
  19:'Pause',20:'CapsLock',27:'Escape',32:'Space',33:'PgUp',34:'PgDn',
  35:'End',36:'Home',37:'Left',38:'Up',39:'Right',40:'Down',
  44:'PrtSc',45:'Insert',46:'Delete',
  48:'0',49:'1',50:'2',51:'3',52:'4',53:'5',54:'6',55:'7',56:'8',57:'9',
  65:'A',66:'B',67:'C',68:'D',69:'E',70:'F',71:'G',72:'H',73:'I',74:'J',
  75:'K',76:'L',77:'M',78:'N',79:'O',80:'P',81:'Q',82:'R',83:'S',84:'T',
  85:'U',86:'V',87:'W',88:'X',89:'Y',90:'Z',
  91:'Win',93:'Menu',
  96:'Num0',97:'Num1',98:'Num2',99:'Num3',100:'Num4',
  101:'Num5',102:'Num6',103:'Num7',104:'Num8',105:'Num9',
  106:'Num*',107:'Num+',109:'Num-',110:'Num.',111:'Num/',
  112:'F1',113:'F2',114:'F3',115:'F4',116:'F5',117:'F6',
  118:'F7',119:'F8',120:'F9',121:'F10',122:'F11',123:'F12',
  144:'NumLock',145:'ScrollLock',
  160:'LShift',161:'RShift',162:'LCtrl',163:'RCtrl',164:'LAlt',165:'RAlt',
  186:';',187:'=',188:',',189:'-',190:'.',191:'/',192:'`',
  219:'[',220:'\\',221:']',222:"'"
};

// Incremented on each openMacro so stale async reads cannot overwrite the editor.
let openMacroGeneration = 0;

function isUnsetCoord(value) {
  return value === undefined || value === null || value === '';
}

function resolveWaitPosition(cmd, xKey, yKey, fallbackXKey = 'x', fallbackYKey = 'y') {
  const rawX = cmd[xKey];
  const rawY = cmd[yKey];
  const toRounded = value => {
    const n = Number(value);
    return Number.isFinite(n) ? Math.round(n) : 0;
  };
  if (isUnsetCoord(rawX) || isUnsetCoord(rawY)) {
    return { x: toRounded(cmd[fallbackXKey]), y: toRounded(cmd[fallbackYKey]) };
  }
  const x = toRounded(rawX);
  const y = toRounded(rawY);
  const fx = toRounded(cmd[fallbackXKey]);
  const fy = toRounded(cmd[fallbackYKey]);
  if (x === 0 && y === 0 && (fx !== 0 || fy !== 0)) {
    return { x: fx, y: fy };
  }
  return { x, y };
}

function syncOrMatchPositions(cmd) {
  const x = cmd.x ?? 0;
  const y = cmd.y ?? 0;
  const shouldSyncA = isUnsetCoord(cmd.xA) || isUnsetCoord(cmd.yA)
    || (cmd.xA === 0 && cmd.yA === 0 && (x !== 0 || y !== 0));
  const shouldSyncB = isUnsetCoord(cmd.xB) || isUnsetCoord(cmd.yB)
    || (cmd.xB === 0 && cmd.yB === 0 && (x !== 0 || y !== 0));
  if (shouldSyncA) {
    cmd.xA = x;
    cmd.yA = y;
  }
  if (shouldSyncB) {
    cmd.xB = x;
    cmd.yB = y;
  }
}

// ── State ────────────────────────────────────────────────────
const state = {
  currentProfile: 'Default',
  currentMacro: null,
  commands: [],
  selectedIndices: new Set(),
  clipboard: [],
  undoStack: [],
  redoStack: [],
  isRecording: false,
  isRunning: false,
  isAnonymous: false,
  streamerMode: false,
  cachedPidText: '',
  macroSettings: { loop: false, loopCount: 0, bindKey: '', bindVk: 0, bindIsMouse: false, randomDelays: false, holdWhilePressed: false, holdBetweenPassesMs: 45, bindSecondPressStops: false },
  speedMultiplier: 1.0,
  currentView: 'editor',
  hasRobot: false,
  recordLastTime: 0,
  dragIndex: -1,
  /** armed — global macro + profile hotkeys (same toggle) */
  macroTriggers: { armed: false }
};

// ── Helpers ──────────────────────────────────────────────────
const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);
const getKeyName = c => KEY_CODE_MAP[c] || `Key${c}`;

function privacyActive() {
  return !!(state.streamerMode || state.isAnonymous);
}

function syncProfileTtsSettingsUi() {
  const en = $('#setting-profile-tts-enabled');
  const hot = $('#setting-profile-tts-hotkeys');
  const ui = $('#setting-profile-tts-ui');
  const tray = $('#setting-profile-tts-tray');
  const sup = $('#setting-profile-tts-suppress-privacy');
  const hk = $('#setting-hotkeys-tts-enabled');
  const cb = $('#setting-colorbot-tts-enabled');
  const disabled = !!(en && !en.checked);
  if (hot) hot.disabled = disabled;
  if (ui) ui.disabled = disabled;
  if (tray) tray.disabled = disabled;
  if (sup) sup.disabled = disabled;
  if (hk) hk.disabled = disabled;
  if (cb) cb.disabled = disabled;
}

async function speakProfileName(profileName, source) {
  if (!profileName || !window.speechSynthesis || typeof window.SpeechSynthesisUtterance !== 'function') return;
  let settings;
  try {
    settings = await window.kyrun.getSettings();
  } catch {
    return;
  }
  if (!settings || settings.profileTtsEnabled === false) return;
  const scope = settings.profileTtsScopes || {};
  if (source === 'hotkeys' && !scope.hotkeys) return;
  if (source === 'ui' && !scope.ui) return;
  if (source === 'tray' && !scope.tray) return;
  if (settings.profileTtsSuppressPrivacy && privacyActive()) return;
  try {
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(String(profileName)));
  } catch {}
}

async function speakHotkeysState(enabled) {
  if (!window.speechSynthesis || typeof window.SpeechSynthesisUtterance !== 'function') return;
  let settings;
  try {
    settings = await window.kyrun.getSettings();
  } catch {
    return;
  }
  if (!settings || settings.profileTtsEnabled === false || settings.hotkeysTtsEnabled === false) return;
  if (settings.profileTtsSuppressPrivacy && privacyActive()) return;
  const text = enabled ? 'Hotkeys enabled' : 'Hotkeys disabled';
  try {
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
  } catch {}
}

async function speakColorbotState(enabled) {
  if (!window.speechSynthesis || typeof window.SpeechSynthesisUtterance !== 'function') return;
  let settings;
  try {
    settings = await window.kyrun.getSettings();
  } catch {
    return;
  }
  if (!settings || settings.profileTtsEnabled === false || settings.colorbotTtsEnabled === false) return;
  if (settings.profileTtsSuppressPrivacy && privacyActive()) return;
  const text = enabled ? 'Color bot enabled' : 'Color bot disabled';
  try {
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
  } catch {}
}

/** Hold between Down and Up when adding from the command palette or keyboard (Settings → Default Delay). */
function getPaletteHoldDelayMs() {
  const el = $('#setting-default-delay');
  if (el && el.value !== '') {
    const v = parseInt(el.value, 10);
    if (!Number.isNaN(v)) return Math.max(1, v);
  }
  return 50;
}

/** querySelector('[data-path="..."]') breaks on paths with () or other special chars — compare in JS instead */
function findFileTreeItemByPath(relPath) {
  return [...document.querySelectorAll('.file-tree__item')].find(el => el.dataset.path === relPath);
}

function sanitizeMacroFilenameBase(name) {
  if (!name || typeof name !== 'string') return 'Imported';
  let s = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/\s+/g, ' ').trim();
  if (!s || s === '.' || s === '..') s = 'Imported';
  if (s.length > 100) s = s.slice(0, 100);
  return s;
}

function collectMacroRelPaths(items, out = []) {
  for (const it of items || []) {
    if (it.type === 'folder' && it.children) collectMacroRelPaths(it.children, out);
    else if (it.type === 'macro') out.push(it.path);
  }
  return out;
}

/** Avoid overwriting; Windows FS is case-insensitive — track lowercased names */
function pickUniqueKyrunFilename(base, reservedLowercaseSet) {
  const safe = sanitizeMacroFilenameBase(base);
  let candidate = `${safe}.kyrun`;
  let n = 0;
  while (reservedLowercaseSet.has(candidate.toLowerCase())) {
    n++;
    candidate = `${safe} (${n}).kyrun`;
  }
  reservedLowercaseSet.add(candidate.toLowerCase());
  return candidate;
}

/** Stable bind label for global shortcuts (Electron); avoids deprecated keyCode mismatches. */
function keyEventToBindLabel(e) {
  const code = e.code || '';
  const km = code.match(/^Key([A-Z])$/);
  if (km) return km[1];
  const dig = code.match(/^Digit([0-9])$/);
  if (dig) return dig[1];
  const np = code.match(/^Numpad([0-9])$/);
  if (np) return `Num${np[1]}`;
  const fk = code.match(/^F([1-9]|1[0-2])$/);
  if (fk) return `F${fk[1]}`;
  const codeMap = {
    Space: 'Space', Enter: 'Enter', Escape: 'Escape', Tab: 'Tab', Backspace: 'Backspace',
    Delete: 'Delete', Insert: 'Insert', Home: 'Home', End: 'End', PageUp: 'PgUp', PageDown: 'PgDn',
    ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
    Pause: 'Pause', CapsLock: 'CapsLock', NumLock: 'NumLock', ScrollLock: 'ScrollLock',
    ShiftLeft: 'LShift', ShiftRight: 'RShift', ControlLeft: 'LCtrl', ControlRight: 'RCtrl',
    AltLeft: 'LAlt', AltRight: 'RAlt'
  };
  if (codeMap[code]) return codeMap[code];
  return getKeyName(e.keyCode);
}

function showToast(msg, type='info') {
  const t = document.createElement('div');
  t.className = `toast toast--${type}`;
  t.textContent = msg;
  $('#toast-container').appendChild(t);
  setTimeout(() => { t.style.opacity='0'; setTimeout(()=>t.remove(),300); }, 3000);
}

let activeModalCleanup = null;
function resetModalPresentation() {
  const modal = $('#modal');
  if (!modal) return;
  modal.style.maxWidth = '';
  modal.style.width = '';
  modal.style.maxHeight = '';
}
function setModalPresentation(opts = {}) {
  resetModalPresentation();
  const modal = $('#modal');
  if (!modal) return;
  if (opts.maxWidth) modal.style.maxWidth = opts.maxWidth;
  if (opts.width) modal.style.width = opts.width;
  if (opts.maxHeight) modal.style.maxHeight = opts.maxHeight;
}
function setModalCleanup(fn) {
  activeModalCleanup = typeof fn === 'function' ? fn : null;
}
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function showModal(title, bodyHTML, buttons=[]) {
  if (activeModalCleanup) {
    try { activeModalCleanup(); } catch {}
    activeModalCleanup = null;
  }
  resetModalPresentation();
  $('#modal-title').textContent = title;
  $('#modal-body').innerHTML = bodyHTML;
  const f = $('#modal-footer'); f.innerHTML = '';
  buttons.forEach(b => {
    const btn = document.createElement('button');
    btn.className = `btn btn--${b.type||'secondary'}`;
    btn.textContent = b.label;
    btn.onclick = () => { b.action(); hideModal(); };
    f.appendChild(btn);
  });
  $('#modal-overlay').classList.add('modal-overlay--visible');
  setTimeout(() => { const inp = $('#modal-body input'); if(inp) inp.focus(); }, 100);
}
function hideModal() {
  const cleanup = activeModalCleanup;
  activeModalCleanup = null;
  if (cleanup) {
    try { cleanup(); } catch {}
  }
  resetModalPresentation();
  $('#modal-overlay').classList.remove('modal-overlay--visible');
}

const SCREEN_PICK_MOUSE_NAMES = { 1:'Middle Mouse', 2:'Right Mouse', 3:'Mouse X1 (Side)', 4:'Mouse X2 (Side)' };
const SCREEN_PICK_MOUSE_VK_CODES = { 1:4, 2:2, 3:5, 4:6 };
const SCREEN_PICK_MOUSE_DOWN_TYPES = { 2:'RightDown', 4:'MiddleDown', 5:'XButton1Down', 6:'XButton2Down' };
let activeScreenCaptureSession = null;

function getMouseBindInfo(button) {
  const vk = SCREEN_PICK_MOUSE_VK_CODES[button];
  if (!vk) return null;
  return { label: SCREEN_PICK_MOUSE_NAMES[button] || `Mouse ${button}`, vk, isMouse: true };
}

function screenCaptureEventMatchesBind(data, bind) {
  if (!bind) return false;
  if (bind.isMouse) return data.kind === 'mouse' && data.cmdType === SCREEN_PICK_MOUSE_DOWN_TYPES[bind.vk];
  if (bind.vk === 27 && data.kind === 'stop') return true;
  return data.kind === 'key' && data.cmdType === 'down' && data.keyCode === bind.vk;
}

async function applyCommandScreenTarget(idx, updates, message, type = 'success') {
  const cmd = state.commands[idx];
  if (!cmd || !state.currentMacro) { showToast('Capture target is no longer available', 'error'); return false; }
  pushUndo();
  Object.assign(cmd, updates);
  state.currentMacro.dirty = true;
  state.selectedIndices.clear();
  state.selectedIndices.add(idx);
  renderCommands();
  showCommandProperties(idx);
  if (message) showToast(message, type);
  return true;
}

function buildScreenTargetUpdates(x, y, opts = {}) {
  const xProp = opts.xProp || 'x';
  const yProp = opts.yProp || 'y';
  return { [xProp]: x, [yProp]: y };
}

async function captureCurrentScreenSample(idx, opts = {}) {
  try {
    const pos = await window.kyrun.getMousePosition();
    const updates = buildScreenTargetUpdates(pos.x, pos.y, opts);
    let message = `Captured ${pos.x}, ${pos.y}`;
    if (opts.captureColor) {
      const colorProp = opts.colorProp || 'color';
      const color = await window.kyrun.getPixelColor(pos.x, pos.y);
      updates[colorProp] = color;
      const label = opts.colorLabel || 'color';
      message = `Captured ${label} #${color} at ${pos.x}, ${pos.y}`;
    }
    await applyCommandScreenTarget(idx, updates, message);
  } catch {
    showToast('Screen capture failed', 'error');
  }
}

function openFrozenScreenshotPicker(idx, capture, opts = {}) {
  if (!capture || !capture.imageDataUrl) { showToast('Screenshot capture failed', 'error'); return; }
  const subject = opts.captureColor ? `${opts.colorLabel || 'color'} and coordinates` : 'coordinates';
  showModal(
    'Pick from Screenshot',
    `<div class="screen-picker">
      <p class="screen-picker__hint">This is a frozen frame from ${capture.displayName || 'the display'}. Click the exact pixel you want to use for ${subject}.</p>
      <div class="screen-picker__meta">
        <div><strong>Hover:</strong> <span id="screen-picker-hover">Move over the image</span></div>
        <div style="display:flex;align-items:center;gap:8px"><strong>Color:</strong> <span class="screen-picker__swatch" id="screen-picker-swatch"></span> <code id="screen-picker-color">------</code></div>
      </div>
      <div class="screen-picker__viewport">
        <img id="screen-picker-image" class="screen-picker__image" src="${capture.imageDataUrl}" alt="Captured screen frame" draggable="false">
      </div>
    </div>`,
    [{ label: 'Cancel', type: 'secondary', action: () => {} }]
  );
  setModalPresentation({ width: 'min(96vw, 1100px)', maxWidth: 'min(96vw, 1100px)', maxHeight: '92vh' });

  setTimeout(() => {
    const img = document.getElementById('screen-picker-image');
    const hover = document.getElementById('screen-picker-hover');
    const swatch = document.getElementById('screen-picker-swatch');
    const colorText = document.getElementById('screen-picker-color');
    if (!img || !hover || !swatch || !colorText) return;

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    let imageReady = false;
    const bounds = capture.physicalBounds || { x: 0, y: 0, width: capture.imageWidth || 1, height: capture.imageHeight || 1 };

    const paintImage = () => {
      if (!ctx || !img.naturalWidth || !img.naturalHeight) return;
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      ctx.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight);
      imageReady = true;
    };

    const sampleFromEvent = e => {
      if (!imageReady || !ctx) return null;
      const rect = img.getBoundingClientRect();
      if (!rect.width || !rect.height) return null;
      const relX = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
      const relY = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
      const pixelX = Math.min(img.naturalWidth - 1, Math.max(0, Math.floor(relX * img.naturalWidth)));
      const pixelY = Math.min(img.naturalHeight - 1, Math.max(0, Math.floor(relY * img.naturalHeight)));
      const [r, g, b] = ctx.getImageData(pixelX, pixelY, 1, 1).data;
      const hex = [r, g, b].map(n => n.toString(16).padStart(2, '0')).join('').toUpperCase();
      const screenX = bounds.x + Math.min(Math.max(bounds.width - 1, 0), Math.max(0, Math.floor((pixelX / Math.max(1, img.naturalWidth)) * bounds.width)));
      const screenY = bounds.y + Math.min(Math.max(bounds.height - 1, 0), Math.max(0, Math.floor((pixelY / Math.max(1, img.naturalHeight)) * bounds.height)));
      return { pixelX, pixelY, screenX, screenY, hex };
    };

    const updatePreview = e => {
      const sample = sampleFromEvent(e);
      if (!sample) return;
      hover.textContent = `Image ${sample.pixelX}, ${sample.pixelY} -> Screen ${sample.screenX}, ${sample.screenY}`;
      swatch.style.background = `#${sample.hex}`;
      colorText.textContent = `#${sample.hex}`;
    };

    const onClick = async e => {
      const sample = sampleFromEvent(e);
      if (!sample) return;
      hideModal();
      const updates = buildScreenTargetUpdates(sample.screenX, sample.screenY, opts);
      let message = `Captured ${sample.screenX}, ${sample.screenY} from screenshot`;
      if (opts.captureColor) {
        updates[opts.colorProp || 'color'] = sample.hex;
        message = `Captured ${opts.colorLabel || 'color'} #${sample.hex} at ${sample.screenX}, ${sample.screenY} from screenshot`;
      }
      await applyCommandScreenTarget(idx, updates, message);
    };

    const cleanup = () => {
      img.removeEventListener('mousemove', updatePreview);
      img.removeEventListener('click', onClick);
      img.removeEventListener('load', paintImage);
    };
    setModalCleanup(cleanup);

    img.addEventListener('mousemove', updatePreview);
    img.addEventListener('click', onClick);
    img.addEventListener('load', paintImage);
    if (img.complete) paintImage();
  }, 0);
}

function stopArmedScreenCapture(opts = {}) {
  const session = activeScreenCaptureSession;
  if (!session) return;
  activeScreenCaptureSession = null;
  if (session.timeoutId) clearTimeout(session.timeoutId);
  if (session.unsubscribe) session.unsubscribe();
  if (session.cancelFocusedKey) document.removeEventListener('keydown', session.cancelFocusedKey, true);
  try { if (window.kyrun.stopGlobalRecordCapture) window.kyrun.stopGlobalRecordCapture(); } catch {}
  if (opts.message) showToast(opts.message, opts.type || 'info');
}

async function startArmedScreenCapture(idx, opts = {}) {
  if (!state.currentMacro || !state.commands[idx]) { showToast('Open a macro first', 'error'); return; }
  if (state.isRecording) { showToast('Stop recording before arming capture', 'info'); return; }
  if (!state.hasRobot || !window.kyrun.onRecordCapture || !window.kyrun.startGlobalRecordCapture) {
    showToast('Global hotkey capture is unavailable on this setup', 'error');
    return;
  }
  if (!opts.bind || !opts.bind.vk) { showToast('Choose a capture bind first', 'error'); return; }

  stopArmedScreenCapture();
  const startedAt = Date.now();
  const timeoutMs = 30000;
  suppressHotkeyTriggersUntil = Math.max(suppressHotkeyTriggersUntil, startedAt + timeoutMs + 500);

  const cancelFocusedKey = e => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    stopArmedScreenCapture({ message: 'Hotkey capture cancelled', type: 'info' });
  };
  document.addEventListener('keydown', cancelFocusedKey, true);

  const finishCapture = async () => {
    stopArmedScreenCapture();
    try {
      if (opts.captureMode === 'screenshot') {
        const capture = await window.kyrun.captureScreenFrame();
        if (!capture || capture.success === false) {
          showToast(capture?.error || 'Screenshot capture failed', 'error');
          return;
        }
        try { if (window.kyrun.focusWindow) window.kyrun.focusWindow(); } catch {}
        setTimeout(() => openFrozenScreenshotPicker(idx, capture, opts), 120);
        return;
      }

      const pos = await window.kyrun.getMousePosition();
      const updates = buildScreenTargetUpdates(pos.x, pos.y, opts);
      let message = `Captured ${pos.x}, ${pos.y} via ${opts.bind.label}`;
      if (opts.captureColor) {
        const colorProp = opts.colorProp || 'color';
        const color = await window.kyrun.getPixelColor(pos.x, pos.y);
        updates[colorProp] = color;
        const label = opts.colorLabel || 'color';
        message = `Captured ${label} #${color} at ${pos.x}, ${pos.y} via ${opts.bind.label}`;
      }
      await applyCommandScreenTarget(idx, updates, message);
    } catch {
      showToast(opts.captureMode === 'screenshot' ? 'Screenshot capture failed' : 'Hotkey capture failed', 'error');
    }
  };

  const unsubscribe = window.kyrun.onRecordCapture(data => {
    if (!activeScreenCaptureSession || activeScreenCaptureSession.startedAt !== startedAt) return;
    if (Date.now() - startedAt < 250) return;
    if (!screenCaptureEventMatchesBind(data, opts.bind)) return;
    void finishCapture();
  });

  const timeoutId = setTimeout(() => {
    stopArmedScreenCapture({ message: 'Hotkey capture timed out', type: 'info' });
  }, timeoutMs);

  activeScreenCaptureSession = { startedAt, timeoutId, unsubscribe, cancelFocusedKey };
  const result = await window.kyrun.startGlobalRecordCapture();
  if (!result || result.success === false) {
    stopArmedScreenCapture();
    showToast('Global hotkey capture is unavailable on this setup', 'error');
    return;
  }
  const subject = opts.captureMode === 'screenshot'
    ? 'freeze a screenshot and open the picker'
    : (opts.captureColor ? `${opts.colorLabel || 'color'} and position` : 'position');
  showToast(`Capture armed. Switch to the game and press ${opts.bind.label} to ${subject}.`, 'info');
}

function openArmedScreenCaptureSetup(idx, opts = {}) {
  if (!state.currentMacro || !state.commands[idx]) { showToast('Open a macro first', 'error'); return; }
  if (state.isRecording) { showToast('Stop recording before arming capture', 'info'); return; }
  if (!state.hasRobot || !window.kyrun.onRecordCapture || !window.kyrun.startGlobalRecordCapture) {
    showToast('Global hotkey capture is unavailable on this setup', 'error');
    return;
  }
  if (activeScreenCaptureSession) stopArmedScreenCapture({ message: 'Previous hotkey capture cancelled', type: 'info' });

  let bind = null;
  const subject = opts.captureMode === 'screenshot'
    ? 'freeze the current game frame and open a clickable screenshot picker'
    : `capture the current cursor ${opts.captureColor ? `${opts.colorLabel || 'color'} and position` : 'position'}`;
  showModal(
    'Arm Screen Capture',
    `<div style="display:flex;flex-direction:column;gap:10px">
      <p style="margin:0;color:var(--text-secondary);font-size:12px;line-height:1.45">Choose a temporary capture bind, switch to the game, then press it to ${subject}.</p>
      <input type="text" class="properties-panel__input" id="screen-capture-bind-input" placeholder="Click to choose a key or mouse button..." readonly title="Left-click to bind · Right-click to clear">
      <p style="margin:0;color:var(--text-tertiary);font-size:11px;line-height:1.35">Right-click the field to clear. Press Escape while Kyrun is focused to cancel an armed capture.</p>
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button type="button" class="btn btn--secondary" id="screen-capture-cancel">Cancel</button>
        <button type="button" class="btn btn--primary" id="screen-capture-arm">Arm Capture</button>
      </div>
    </div>`,
    []
  );

  setTimeout(() => {
    const input = document.getElementById('screen-capture-bind-input');
    const armBtn = document.getElementById('screen-capture-arm');
    const cancelBtn = document.getElementById('screen-capture-cancel');
    if (!input || !armBtn || !cancelBtn) return;

    const cleanupBindCapture = () => {
      document.removeEventListener('keydown', keyH);
      document.removeEventListener('mousedown', mouseH);
    };
    setModalCleanup(cleanupBindCapture);

    const keyH = e => {
      e.preventDefault();
      bind = { label: keyEventToBindLabel(e), vk: e.keyCode, isMouse: false };
      input.value = bind.label;
      cleanupBindCapture();
    };
    const mouseH = e => {
      if (e.button === 0) return;
      e.preventDefault();
      e.stopPropagation();
      bind = getMouseBindInfo(e.button);
      if (!bind) return;
      input.value = bind.label;
      cleanupBindCapture();
    };

    input.onclick = () => {
      input.value = 'Press a key or mouse button...';
      cleanupBindCapture();
      document.addEventListener('keydown', keyH);
      document.addEventListener('mousedown', mouseH);
    };
    input.oncontextmenu = e => {
      e.preventDefault();
      bind = null;
      input.value = '';
      cleanupBindCapture();
    };
    armBtn.onclick = async () => {
      if (!bind) { showToast('Choose a capture bind first', 'error'); return; }
      cleanupBindCapture();
      hideModal();
      await startArmedScreenCapture(idx, { ...opts, bind });
    };
    cancelBtn.onclick = () => {
      cleanupBindCapture();
      hideModal();
    };
  }, 0);
}

// ── Profiles ─────────────────────────────────────────────────
async function loadProfiles() {
  try {
    const profiles = await window.kyrun.getProfiles();
    const dd = $('#profile-dropdown');
    dd.innerHTML = '';
    profiles.forEach(p => {
      const o = document.createElement('option');
      o.value = p; o.textContent = p;
      if (p === state.currentProfile) o.selected = true;
      dd.appendChild(o);
    });
  } catch {}
  updateStatusBar();
}

async function loadFileTree() {
  let macros;
  try { macros = await window.kyrun.getProfileMacros(state.currentProfile); }
  catch { macros = []; }
  renderFileTree(macros);
}

function renderFileTree(items, container=null, depth=0) {
  const tree = container || $('#file-tree');
  if (!container) tree.innerHTML = '';
  items.forEach(item => {
    const el = document.createElement('div');
    el.className = `file-tree__item ${item.type==='folder'?'file-tree__item--folder':''}`;
    el.style.paddingLeft = `${14+depth*16}px`;
    el.dataset.path = item.path; el.dataset.type = item.type;
    if (item.type === 'folder') {
      el.innerHTML = `<span class="file-tree__icon file-tree__icon--arrow">▶</span><span class="file-tree__icon file-tree__icon--folder">📁</span><span class="file-tree__name">${item.name}</span>`;
      el.onclick = e => { e.stopPropagation(); const a=el.querySelector('.file-tree__icon--arrow'),c=el.nextElementSibling; if(c&&c.classList.contains('file-tree__children')){c.classList.toggle('hidden');a.classList.toggle('expanded');} };
      tree.appendChild(el);
      if (item.children && item.children.length) { const d=document.createElement('div'); d.className='file-tree__children'; renderFileTree(item.children,d,depth+1); tree.appendChild(d); }
    } else {
      el.innerHTML = `<span class="file-tree__icon file-tree__icon--macro">⚡</span><span class="file-tree__name">${item.name}</span>`;
      el.onclick = () => openMacro(item);
      el.oncontextmenu = e => showFileContextMenu(e, item);
      tree.appendChild(el);
    }
  });
}

// ── Macro Open/Save ──────────────────────────────────────────
async function openMacro(item) {
  const gen = ++openMacroGeneration;
  $$('.file-tree__item--active').forEach(e=>e.classList.remove('file-tree__item--active'));
  const el = findFileTreeItemByPath(item.path);
  if (el) el.classList.add('file-tree__item--active');
  let data;
  try {
    const raw = await window.kyrun.readMacroFile(item.path);
    if (gen !== openMacroGeneration) return;
    data = raw ? JSON.parse(raw) : null;
    if (!data) data = { name: item.name, commands: [], settings: {} };
  } catch {
    if (gen !== openMacroGeneration) return;
    data = { name: item.name, commands: [], settings: {} };
  }
  state.currentMacro = { name: data.name||item.name, path: item.path, dirty: false };
  state.commands = data.commands || [];
  state.macroSettings = { loop:false, loopCount:0, bindKey:'', bindVk:0, bindIsMouse:false, randomDelays:false, holdWhilePressed:false, holdBetweenPassesMs:45, bindSecondPressStops:false, ...data.settings };
  state.selectedIndices.clear(); state.undoStack=[]; state.redoStack=[];
  $('#welcome-view').classList.add('hidden');
  $('#settings-view').classList.remove('settings-view--visible');
  $('#editor-content').classList.remove('hidden');
  state.currentView = 'editor';
  updateMacroSettings();
  $('#selected-command-props').classList.add('hidden');
  $('#command-props-content').innerHTML = '';
  renderCommands(); updateStatusBar();
}

// After capturing a new trigger key, registering globalShortcut immediately can fire the same keypress — defer reload + ignore IPC briefly.
let suppressHotkeyTriggersUntil = 0;
let suppressNextProfileChangedTts = false;
let hotkeysTtsReady = false;
let colorbotTtsReady = false;
let lastColorbotEnabled = false;
function scheduleReloadProfileTriggers(delayMs = 400) {
  suppressHotkeyTriggersUntil = Date.now() + delayMs + 350;
  setTimeout(() => { void reloadProfileTriggers(); }, delayMs);
}

/** Sync checkbox/number inputs into state so Save persists what the UI shows (fixes loop/hold not saving). */
function commitMacroSettingsFromUI() {
  const loopEl = $('#loop-enabled');
  const lc = $('#loop-count');
  const rd = $('#random-delays');
  const hw = $('#hold-while-pressed');
  if (loopEl) state.macroSettings.loop = !!loopEl.checked;
  if (lc) {
    const v = parseInt(lc.value, 10);
    state.macroSettings.loopCount = Number.isFinite(v) && v >= 0 ? v : 0;
  }
  if (rd) state.macroSettings.randomDelays = !!rd.checked;
  if (hw) state.macroSettings.holdWhilePressed = !!hw.checked;
  const hbg = $('#hold-between-passes-ms');
  if (hbg) {
    const g = parseInt(hbg.value, 10);
    state.macroSettings.holdBetweenPassesMs = Number.isFinite(g) && g >= 0 ? Math.min(2000, g) : 0;
  }
  const b2s = $('#bind-second-press-stops');
  if (b2s) state.macroSettings.bindSecondPressStops = !!b2s.checked;
}

async function saveMacro(opts = {}) {
  const silent = opts.silent === true;
  const deferTriggers = opts.deferTriggers === true;
  if (!state.currentMacro) return;
  commitMacroSettingsFromUI();
  const data = { name:state.currentMacro.name, version:'1.0', commands:state.commands, settings:state.macroSettings };
  try {
    await window.kyrun.saveMacroFile(state.currentMacro.path, JSON.stringify(data,null,2));
    state.currentMacro.dirty=false;
    if (!silent) showToast('Macro saved','success');
    if (deferTriggers) scheduleReloadProfileTriggers(400);
    else await reloadProfileTriggers(); // Re-apply binds!
  }
  catch { if (!silent) showToast('Save failed','error'); }
  updateStatusBar();
}

// ── Command Rendering ────────────────────────────────────────
function renderCommands() {
  const body = $('#command-list-body');
  body.querySelectorAll('.command-row').forEach(r => r.remove());
  let empty = $('#command-empty');
  if (state.commands.length === 0) {
    if (!empty) {
      empty = document.createElement('div');
      empty.id = 'command-empty';
      empty.className = 'command-list__empty';
      empty.innerHTML = '<div class="command-list__empty-icon">📝</div><div class="command-list__empty-text">No commands yet</div><div class="command-list__empty-hint">Click "Record" or add commands from the panel on the right</div>';
      body.appendChild(empty);
    }
    empty.classList.remove('hidden');
    updateStatusBar();
    return;
  }
  if (empty) empty.classList.add('hidden');
  const ifColorPreview = getRunIfColorPreview();
  state.commands.forEach((cmd, i) => {
    const row = document.createElement('div');
    row.className = 'command-row';
    if (state.selectedIndices.has(i)) row.classList.add('command-row--selected');
    if (cmd.breakpoint) row.classList.add('command-row--breakpoint');
    const isIfColorAnchor = !!ifColorPreview && i === ifColorPreview.startIndex;
    const isIfColorRange = !!ifColorPreview && i > ifColorPreview.startIndex && i <= ifColorPreview.endIndex;
    const isIfColorEnd = isIfColorRange && i === ifColorPreview.endIndex;
    if (isIfColorAnchor) row.classList.add('command-row--if-color-anchor');
    if (isIfColorRange) row.classList.add('command-row--if-color-range');
    if (isIfColorEnd) row.classList.add('command-row--if-color-end');
    row.dataset.index = i;
    row.draggable = true;
    const tc = getTypeClass(cmd.type), params = formatParams(cmd);
    const timing = cmd.type === 'Delay' ? `${cmd.value} ms`
      : cmd.type === 'RandomDelay' ? `from ${cmd.min} to ${cmd.max} ms` : '';
    const typeShown = cmd.type === 'RandomDelay' ? 'Delay' : cmd.type === 'RunIfColor' ? 'If Color' : cmd.type;
    const numClasses = ['command-row__num'];
    if (isIfColorAnchor) numClasses.push('command-row__num--if-color-anchor');
    if (isIfColorRange) numClasses.push('command-row__num--if-color-range');
    if (isIfColorEnd) numClasses.push('command-row__num--if-color-end');
    row.innerHTML = `<span class="${numClasses.join(' ')}">${i+1}</span><span class="command-row__breakpoint ${cmd.breakpoint?'command-row__breakpoint--active':''}" data-bp="${i}"></span><span class="command-row__type ${tc}">${typeShown}</span><span class="command-row__params">${params}</span><span class="command-row__delay">${timing}</span>`;
    row.onclick = e => selectCommand(i,e);
    row.ondblclick = () => showCommandProperties(i);
    row.oncontextmenu = e => showCommandContextMenu(e,i);
    row.querySelector('[data-bp]').onclick = e => { e.stopPropagation(); toggleBreakpoint(i); };
    // Drag and drop
    row.ondragstart = e => { state.dragIndex=i; e.dataTransfer.effectAllowed='move'; row.style.opacity='0.4'; };
    row.ondragend = () => { row.style.opacity='1'; state.dragIndex=-1; };
    row.ondragover = e => { e.preventDefault(); e.dataTransfer.dropEffect='move'; row.style.borderTop='2px solid var(--accent-primary)'; };
    row.ondragleave = () => { row.style.borderTop=''; };
    row.ondrop = e => { e.preventDefault(); row.style.borderTop=''; const from=state.dragIndex, to=i; if(from!==to&&from>=0){pushUndo();const c=state.commands.splice(from,1)[0];state.commands.splice(to>from?to-1:to,0,c);state.selectedIndices.clear();state.selectedIndices.add(to>from?to-1:to);state.currentMacro.dirty=true;renderCommands();} };
    body.appendChild(row);
  });
  if (state.selectedIndices.size) {
    const hi = Math.max(...state.selectedIndices);
    const r = body.querySelector(`.command-row[data-index="${hi}"]`);
    if (r) try { r.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch { r.scrollIntoView(); }
  }
  updateKeyboardViz(); updateStatusBar();
}

function getRunIfColorPreview() {
  if (state.selectedIndices.size !== 1) return null;
  const startIndex = [...state.selectedIndices][0];
  const cmd = state.commands[startIndex];
  if (!cmd || cmd.type !== 'RunIfColor') return null;
  const rawEndLine = Number(cmd.endLine);
  if (!Number.isFinite(rawEndLine)) return null;
  const endIndex = Math.min(state.commands.length - 1, Math.max(startIndex, Math.round(rawEndLine) - 1));
  return { startIndex, endIndex };
}

function getTypeClass(t) {
  const m = { KeyDown:'command-row__type--keydown',KeyUp:'command-row__type--keyup',LeftDown:'command-row__type--mousedown',LeftUp:'command-row__type--mouseup',RightDown:'command-row__type--mousedown',RightUp:'command-row__type--mouseup',MiddleDown:'command-row__type--mousedown',MiddleUp:'command-row__type--mouseup',XButton1Down:'command-row__type--mousedown',XButton1Up:'command-row__type--mouseup',XButton2Down:'command-row__type--mousedown',XButton2Up:'command-row__type--mouseup',ScrollUp:'command-row__type--mousemove',ScrollDown:'command-row__type--mousemove',Delay:'command-row__type--delay',RandomDelay:'command-row__type--delay',GoTo:'command-row__type--goto',GoWhile:'command-row__type--loop',Comment:'command-row__type--comment',Variable:'command-row__type--variable',ColorDetect:'command-row__type--color',WaitForPixelColor:'command-row__type--color',RunIfColor:'command-row__type--color',MouseMove:'command-row__type--mousemove'};
  return m[t]||'';
}

function formatParams(cmd) {
  switch(cmd.type) {
    case 'KeyDown': case 'KeyUp': return `Key: ${getKeyName(cmd.keyCode)} (${cmd.keyCode})`;
    case 'LeftDown': return 'Left Mouse ↓'; case 'LeftUp': return 'Left Mouse ↑';
    case 'RightDown': return 'Right Mouse ↓'; case 'RightUp': return 'Right Mouse ↑';
    case 'MiddleDown': return 'Middle Mouse ↓'; case 'MiddleUp': return 'Middle Mouse ↑';
    case 'XButton1Down': return 'Side Button 1 ↓'; case 'XButton1Up': return 'Side Button 1 ↑';
    case 'XButton2Down': return 'Side Button 2 ↓'; case 'XButton2Up': return 'Side Button 2 ↑';
    case 'ScrollUp': return `Scroll Up ×${cmd.value||3}`; case 'ScrollDown': return `Scroll Down ×${cmd.value||3}`;
    case 'Delay': return `Wait ${cmd.value} ms`;
    case 'RandomDelay': return `Wait from ${cmd.min} to ${cmd.max} ms`;
    case 'MouseMove': return `Move to (${cmd.x}, ${cmd.y})`; case 'GoTo': return `Jump to line ${cmd.targetLine}`;
    case 'GoWhile': return `Loop from line ${cmd.startLine}, ${cmd.count}×`;
    case 'Comment': return `// ${cmd.value}`;
    case 'ColorDetect': return `Check (${cmd.x},${cmd.y}) #${cmd.color}`;
    case 'RunIfColor': {
      const mode = cmd.mode || 'match';
      const relation = mode === 'notMatch' ? 'is not' : 'is';
      const jumpText = cmd.jumpOnMatch ? ' [jump on match]' : '';
      return `Run through line ${cmd.endLine} if (${cmd.x},${cmd.y}) ${relation} #${cmd.color} <=${cmd.tolerance ?? 10}${jumpText}`;
    }
    case 'WaitForPixelColor': {
      const mode = cmd.mode || 'match';
      const timeoutText = `(${cmd.timeoutMs ?? 1000} ms max)`;
      if (mode === 'notMatch') return `Wait until (${cmd.x},${cmd.y}) is not #${cmd.color} <=${cmd.tolerance ?? 10} ${timeoutText}`;
      if (mode === 'orMatch') {
        const posA = resolveWaitPosition(cmd, 'xA', 'yA');
        const posB = resolveWaitPosition(cmd, 'xB', 'yB');
        return `Wait for A (${posA.x},${posA.y}) #${cmd.colorA || cmd.color || 'FF0000'} or B (${posB.x},${posB.y}) #${cmd.colorB || '00FF00'} <=${cmd.tolerance ?? 10} ${timeoutText}`;
      }
      if (mode === 'transition') return `Wait for (${cmd.x},${cmd.y}) #${cmd.fromColor} -> #${cmd.toColor} <=${cmd.tolerance ?? 10} ${timeoutText}`;
      return `Wait for (${cmd.x},${cmd.y}) #${cmd.color} <=${cmd.tolerance ?? 10} ${timeoutText}`;
    }
    case 'Variable': return `${cmd.varName} ${cmd.operation} ${cmd.varValue}`;
    default: return JSON.stringify(cmd);
  }
}

// ── Selection / Editing ──────────────────────────────────────
function selectCommand(i,e) {
  if (e&&e.ctrlKey) { state.selectedIndices.has(i)?state.selectedIndices.delete(i):state.selectedIndices.add(i); }
  else if (e&&e.shiftKey&&state.selectedIndices.size>0) { const l=Math.max(...state.selectedIndices),s=Math.min(l,i),en=Math.max(l,i); for(let j=s;j<=en;j++) state.selectedIndices.add(j); }
  else { state.selectedIndices.clear(); state.selectedIndices.add(i); }
  renderCommands(); showCommandProperties(i);
}

function showCommandProperties(idx) {
  const cmd = state.commands[idx]; if(!cmd) return;
  const panel=$('#selected-command-props'), content=$('#command-props-content');
  panel.classList.remove('hidden');
  let html = '';
  const field = (label,prop,type='number',val) => `<div class="properties-panel__field"><label class="properties-panel__label">${label}</label><input type="${type}" class="properties-panel__input" value="${val!==undefined?val:cmd[prop]}" data-prop="${prop}" data-idx="${idx}" ${type==='number'?'min="0"':''}></div>`;
  const checkboxField = (label, prop, checked = false) => `<div class="properties-panel__checkbox-group"><input type="checkbox" class="properties-panel__checkbox" data-prop="${prop}" data-idx="${idx}" ${checked ? 'checked' : ''}><label class="properties-panel__checkbox-label">${label}</label></div>`;
  const waitMode = cmd.mode || 'match';
  const waitModeField = `<div class="properties-panel__field"><label class="properties-panel__label">Wait Mode</label><select class="properties-panel__select" data-prop="mode" data-idx="${idx}" style="width:100%;margin-bottom:8px"><option value="match" ${waitMode==='match'?'selected':''}>Until this color</option><option value="notMatch" ${waitMode==='notMatch'?'selected':''}>Until not this color</option><option value="orMatch" ${waitMode==='orMatch'?'selected':''}>Until this color or this color</option><option value="transition" ${waitMode==='transition'?'selected':''}>From one color to another</option></select></div>`;
  const ifColorMode = cmd.mode || 'match';
  const ifColorModeField = `<div class="properties-panel__field"><label class="properties-panel__label">Condition</label><select class="properties-panel__select" data-prop="mode" data-idx="${idx}" style="width:100%;margin-bottom:8px"><option value="match" ${ifColorMode==='match'?'selected':''}>Only if this color matches</option><option value="notMatch" ${ifColorMode==='notMatch'?'selected':''}>Only if this color does not match</option></select></div>`;
  switch(cmd.type) {
    case 'KeyDown': case 'KeyUp':
      html = field('Key Code','keyCode','number') + `<div class="properties-panel__field"><label class="properties-panel__label">Key: ${getKeyName(cmd.keyCode)}</label></div>`; break;
    case 'Delay': case 'RandomDelay': {
      const isR = cmd.type === 'RandomDelay';
      const fv = cmd.value != null ? cmd.value : 100;
      const mn = cmd.min != null ? cmd.min : 50;
      const mx = cmd.max != null ? cmd.max : 150;
      html = `<div class="properties-panel__field"><label class="properties-panel__label" style="display:flex;align-items:center;gap:8px;cursor:pointer"><input type="checkbox" id="delay-random-toggle" data-idx="${idx}" ${isR ? 'checked' : ''}> Random delay (min–max ms, Keyran-style)</label></div>`;
      html += `<div id="delay-fields-fixed" style="display:${isR ? 'none' : 'block'}">${field('Duration (ms)','value','number', fv)}</div>`;
      html += `<div id="delay-fields-random" style="display:${isR ? 'block' : 'none'}">${field('Min (ms)','min','number', mn)}${field('Max (ms)','max','number', mx)}</div>`;
      break;
    }
    case 'MouseMove': html = field('X','x','number') + field('Y','y','number') + `<button class="btn btn--secondary" style="margin-top:6px;width:100%" id="btn-pick-coords">📍 Pick from Screen</button>` + `<button class="btn btn--secondary" style="margin-top:6px;width:100%" id="btn-pick-coords-screenshot">🖼 Pick from Screenshot</button>`; break;
    case 'GoTo': html = field('Target Line','targetLine','number'); break;
    case 'GoWhile': html = field('Start Line','startLine','number') + field('Loop Count','count','number'); break;
    case 'Comment': html = field('Comment','value','text'); break;
    case 'ScrollUp': case 'ScrollDown': html = field('Scroll Amount','value','number'); break;
    case 'ColorDetect':
      html = field('X','x','number') + field('Y','y','number') + field('Color (hex)','color','text') + field('Tolerance','tolerance','number') + `<button class="btn btn--secondary" style="margin-top:6px;width:100%" id="btn-pick-color">🎨 Pick from Screen</button>` + `<button class="btn btn--secondary" style="margin-top:6px;width:100%" id="btn-pick-color-screenshot">🖼 Pick from Screenshot</button>`;
      break;
    case 'RunIfColor':
      html = ifColorModeField
        + field('X','x','number')
        + field('Y','y','number')
        + field('Color (hex)','color','text')
        + field('Tolerance','tolerance','number')
        + field('Run Through Line','endLine','number')
        + checkboxField('Jump straight here when the condition becomes met', 'jumpOnMatch', !!cmd.jumpOnMatch)
        + checkboxField('Play debug sound when condition is met', 'playSoundOnMatch', !!cmd.playSoundOnMatch)
        + `<button class="btn btn--secondary" style="margin-top:6px;width:100%" id="btn-pick-color">🎨 Pick from Screen</button>`
        + `<button class="btn btn--secondary" style="margin-top:6px;width:100%" id="btn-pick-color-screenshot">🖼 Pick from Screenshot</button>`
        + `<p class="properties-panel__hint" style="font-size:11px;color:var(--text-muted, #888);margin:6px 0 0 0;line-height:1.35">Place this before a block. If the condition fails, Kyrun skips every line through the line number above. The jump toggle also lets Kyrun skip ahead to this block before it would normally reach it.</p>`;
      break;
    case 'WaitForPixelColor':
      if (waitMode === 'orMatch') syncOrMatchPositions(cmd);
      html = waitModeField;
      if (waitMode === 'transition') {
        html += field('X','x','number') + field('Y','y','number');
        html += field('From Color (hex)','fromColor','text', cmd.fromColor || 'FF0000')
          + field('To Color (hex)','toColor','text', cmd.toColor || '00FF00')
          + `<button class="btn btn--secondary" style="margin-top:6px;width:100%" id="btn-pick-from-color">🎨 Pick "From" Color</button>`
          + `<button class="btn btn--secondary" style="margin-top:6px;width:100%" id="btn-pick-from-color-screenshot">🖼 Pick "From" from Screenshot</button>`
          + `<button class="btn btn--secondary" style="margin-top:6px;width:100%" id="btn-pick-to-color">🎨 Pick "To" Color</button>`
          + `<button class="btn btn--secondary" style="margin-top:6px;width:100%" id="btn-pick-to-color-screenshot">🖼 Pick "To" from Screenshot</button>`
          + `<p class="properties-panel__hint" style="font-size:11px;color:var(--text-muted, #888);margin:6px 0 8px 0;line-height:1.35">This waits until the pixel first becomes the From color, then later becomes the To color.</p>`;
      } else if (waitMode === 'orMatch') {
        const posA = resolveWaitPosition(cmd, 'xA', 'yA');
        const posB = resolveWaitPosition(cmd, 'xB', 'yB');
        html += field('Position A X','xA','number', posA.x)
          + field('Position A Y','yA','number', posA.y)
          + field('Color A (hex)','colorA','text', cmd.colorA || cmd.color || 'FF0000')
          + `<button class="btn btn--secondary" style="margin-top:6px;width:100%" id="btn-pick-pos-a">📍 Pick Position A</button>`
          + `<button class="btn btn--secondary" style="margin-top:6px;width:100%" id="btn-pick-pos-a-screenshot">🖼 Pick Pos A from Screenshot</button>`
          + `<button class="btn btn--secondary" style="margin-top:6px;width:100%" id="btn-pick-color-a">🎨 Pick Color A</button>`
          + `<button class="btn btn--secondary" style="margin-top:6px;width:100%" id="btn-pick-color-a-screenshot">🖼 Pick Color A from Screenshot</button>`
          + field('Position B X','xB','number', posB.x)
          + field('Position B Y','yB','number', posB.y)
          + field('Color B (hex)','colorB','text', cmd.colorB || '00FF00')
          + `<button class="btn btn--secondary" style="margin-top:6px;width:100%" id="btn-pick-pos-b">📍 Pick Position B</button>`
          + `<button class="btn btn--secondary" style="margin-top:6px;width:100%" id="btn-pick-pos-b-screenshot">🖼 Pick Pos B from Screenshot</button>`
          + `<button class="btn btn--secondary" style="margin-top:6px;width:100%" id="btn-pick-color-b">🎨 Pick Color B</button>`
          + `<button class="btn btn--secondary" style="margin-top:6px;width:100%" id="btn-pick-color-b-screenshot">🖼 Pick Color B from Screenshot</button>`
          + `<p class="properties-panel__hint" style="font-size:11px;color:var(--text-muted, #888);margin:6px 0 8px 0;line-height:1.35">This waits until the pixel at Position A matches Color A OR the pixel at Position B matches Color B.</p>`;
      } else {
        html += field('X','x','number') + field('Y','y','number')
          + field('Color (hex)','color','text')
          + `<button class="btn btn--secondary" style="margin-top:6px;width:100%" id="btn-pick-color">🎨 Pick from Screen</button>`
          + `<button class="btn btn--secondary" style="margin-top:6px;width:100%" id="btn-pick-color-screenshot">🖼 Pick from Screenshot</button>`;
      }
      html += field('Tolerance','tolerance','number')
        + field('Timeout (ms)','timeoutMs','number')
        + field('Poll Every (ms)','pollMs','number')
        + checkboxField('Play debug sound when condition is met', 'playSoundOnMatch', !!cmd.playSoundOnMatch)
        + `<p class="properties-panel__hint" style="font-size:11px;color:var(--text-muted, #888);margin:6px 0 0 0;line-height:1.35">Pick from Screenshot freezes the current game frame and lets you click the exact pixel without opening the in-game menu first.</p>`;
      break;
    case 'Variable': html = field('Name','varName','text') + `<select class="properties-panel__select" data-prop="operation" data-idx="${idx}" style="width:100%;margin-bottom:8px"><option ${cmd.operation==='='?'selected':''} value="=">=</option><option ${cmd.operation==='+='?'selected':''} value="+=">+=</option><option ${cmd.operation==='-='?'selected':''} value="-=">-=</option></select>` + field('Value','varValue','number'); break;
    default: html = `<p style="color:var(--text-tertiary);font-size:12px;">No editable properties</p>`;
  }
  content.innerHTML = html;
  content.querySelectorAll('input[data-prop],select[data-prop]').forEach(inp => {
    inp.addEventListener('change', e => {
      const i=parseInt(e.target.dataset.idx,10), prop=e.target.dataset.prop;
      const val = e.target.type==='number'
        ? parseInt(e.target.value,10)
        : e.target.type==='checkbox'
          ? !!e.target.checked
          : e.target.value;
      pushUndo();
      state.commands[i][prop]=val;
      if (prop === 'mode' && state.commands[i]?.type === 'WaitForPixelColor') {
        if (val === 'transition') {
          state.commands[i].x = state.commands[i].xA ?? state.commands[i].x ?? 0;
          state.commands[i].y = state.commands[i].yA ?? state.commands[i].y ?? 0;
          if (!state.commands[i].fromColor) state.commands[i].fromColor = state.commands[i].color || 'FF0000';
          if (!state.commands[i].toColor) state.commands[i].toColor = '00FF00';
        } else if (val === 'orMatch') {
          syncOrMatchPositions(state.commands[i]);
          if (!state.commands[i].colorA) state.commands[i].colorA = state.commands[i].color || state.commands[i].fromColor || 'FF0000';
          if (!state.commands[i].colorB) state.commands[i].colorB = state.commands[i].toColor || '00FF00';
        } else {
          state.commands[i].x = state.commands[i].xA ?? state.commands[i].x ?? 0;
          state.commands[i].y = state.commands[i].yA ?? state.commands[i].y ?? 0;
          if (!state.commands[i].color) {
            state.commands[i].color = state.commands[i].colorA || state.commands[i].toColor || state.commands[i].fromColor || 'FF0000';
          }
        }
      }
      state.currentMacro.dirty=true; renderCommands(); showCommandProperties(i);
    });
  });
  const delayRandToggle = document.getElementById('delay-random-toggle');
  if (delayRandToggle) {
    delayRandToggle.addEventListener('change', () => {
      const i = parseInt(delayRandToggle.dataset.idx, 10);
      const c = state.commands[i];
      if (!c) return;
      pushUndo();
      if (delayRandToggle.checked) {
        const base = c.type === 'Delay' ? (c.value != null ? c.value : 100) : (c.min != null ? c.min : 50);
        const hi = c.type === 'Delay' ? base + 10 : (c.max != null ? c.max : 150);
        state.commands[i] = { type: 'RandomDelay', min: Math.min(base, hi), max: Math.max(base, hi) };
      } else {
        const v = c.type === 'RandomDelay' ? (c.min != null ? c.min : 100) : (c.value != null ? c.value : 100);
        state.commands[i] = { type: 'Delay', value: v };
      }
      state.currentMacro.dirty = true;
      renderCommands();
      state.selectedIndices.clear(); state.selectedIndices.add(i);
      showCommandProperties(i);
    });
  }
  // Coordinate picker
  const pickBtn = document.getElementById('btn-pick-coords');
  if (pickBtn) pickBtn.onclick = async () => {
    await captureCurrentScreenSample(idx, { captureColor: false });
  };
  const pickScreenshotBtn = document.getElementById('btn-pick-coords-screenshot');
  if (pickScreenshotBtn) pickScreenshotBtn.onclick = () => openArmedScreenCaptureSetup(idx, { captureColor: false, captureMode: 'screenshot' });
  // Color picker
  const colorBtn = document.getElementById('btn-pick-color');
  if (colorBtn) colorBtn.onclick = async () => { await captureCurrentScreenSample(idx, { captureColor: true, colorProp: 'color', colorLabel: 'color' }); };
  const colorScreenshotBtn = document.getElementById('btn-pick-color-screenshot');
  if (colorScreenshotBtn) colorScreenshotBtn.onclick = () => openArmedScreenCaptureSetup(idx, { captureColor: true, colorProp: 'color', colorLabel: 'color', captureMode: 'screenshot' });
  const fromColorBtn = document.getElementById('btn-pick-from-color');
  if (fromColorBtn) fromColorBtn.onclick = async () => { await captureCurrentScreenSample(idx, { captureColor: true, colorProp: 'fromColor', colorLabel: 'from color' }); };
  const fromColorScreenshotBtn = document.getElementById('btn-pick-from-color-screenshot');
  if (fromColorScreenshotBtn) fromColorScreenshotBtn.onclick = () => openArmedScreenCaptureSetup(idx, { captureColor: true, colorProp: 'fromColor', colorLabel: 'from color', captureMode: 'screenshot' });
  const toColorBtn = document.getElementById('btn-pick-to-color');
  if (toColorBtn) toColorBtn.onclick = async () => { await captureCurrentScreenSample(idx, { captureColor: true, colorProp: 'toColor', colorLabel: 'to color' }); };
  const toColorScreenshotBtn = document.getElementById('btn-pick-to-color-screenshot');
  if (toColorScreenshotBtn) toColorScreenshotBtn.onclick = () => openArmedScreenCaptureSetup(idx, { captureColor: true, colorProp: 'toColor', colorLabel: 'to color', captureMode: 'screenshot' });
  const posABtn = document.getElementById('btn-pick-pos-a');
  if (posABtn) posABtn.onclick = async () => { await captureCurrentScreenSample(idx, { captureColor: false, xProp: 'xA', yProp: 'yA' }); };
  const posAScreenshotBtn = document.getElementById('btn-pick-pos-a-screenshot');
  if (posAScreenshotBtn) posAScreenshotBtn.onclick = () => openArmedScreenCaptureSetup(idx, { captureColor: false, xProp: 'xA', yProp: 'yA', captureMode: 'screenshot' });
  const colorABtn = document.getElementById('btn-pick-color-a');
  if (colorABtn) colorABtn.onclick = async () => { await captureCurrentScreenSample(idx, { captureColor: true, xProp: 'xA', yProp: 'yA', colorProp: 'colorA', colorLabel: 'color A' }); };
  const colorAScreenshotBtn = document.getElementById('btn-pick-color-a-screenshot');
  if (colorAScreenshotBtn) colorAScreenshotBtn.onclick = () => openArmedScreenCaptureSetup(idx, { captureColor: true, xProp: 'xA', yProp: 'yA', colorProp: 'colorA', colorLabel: 'color A', captureMode: 'screenshot' });
  const posBBtn = document.getElementById('btn-pick-pos-b');
  if (posBBtn) posBBtn.onclick = async () => { await captureCurrentScreenSample(idx, { captureColor: false, xProp: 'xB', yProp: 'yB' }); };
  const posBScreenshotBtn = document.getElementById('btn-pick-pos-b-screenshot');
  if (posBScreenshotBtn) posBScreenshotBtn.onclick = () => openArmedScreenCaptureSetup(idx, { captureColor: false, xProp: 'xB', yProp: 'yB', captureMode: 'screenshot' });
  const colorBBtn = document.getElementById('btn-pick-color-b');
  if (colorBBtn) colorBBtn.onclick = async () => { await captureCurrentScreenSample(idx, { captureColor: true, xProp: 'xB', yProp: 'yB', colorProp: 'colorB', colorLabel: 'color B' }); };
  const colorBScreenshotBtn = document.getElementById('btn-pick-color-b-screenshot');
  if (colorBScreenshotBtn) colorBScreenshotBtn.onclick = () => openArmedScreenCaptureSetup(idx, { captureColor: true, xProp: 'xB', yProp: 'yB', colorProp: 'colorB', colorLabel: 'color B', captureMode: 'screenshot' });
}

// ── Add Command ──────────────────────────────────────────────
const MOUSE_DOWN_TO_UP = {
  LeftDown: 'LeftUp', RightDown: 'RightUp', MiddleDown: 'MiddleUp',
  XButton1Down: 'XButton1Up', XButton2Down: 'XButton2Up'
};

function addCommand(type) {
  if (!state.currentMacro) { showToast('Open or create a macro first', 'error'); return; }
  pushUndo();
  const insertAt = state.selectedIndices.size>0 ? Math.max(...state.selectedIndices)+1 : state.commands.length;
  const holdMs = getPaletteHoldDelayMs();
  let cmds;
  switch(type) {
    case 'KeyDown': {
      const kd = { type: 'KeyDown', keyCode: 65, device: 1 };
      cmds = [
        { type: 'Delay', value: holdMs },
        kd,
        { type: 'Delay', value: holdMs },
        { type: 'KeyUp', keyCode: 65, device: 1 }
      ];
      break;
    }
    case 'KeyUp': cmds = [{ type, keyCode: 65, device: 1 }]; break;
    case 'LeftDown': case 'RightDown': case 'MiddleDown': case 'XButton1Down': case 'XButton2Down':
      cmds = [
        { type: 'Delay', value: holdMs },
        { type },
        { type: 'Delay', value: holdMs },
        { type: MOUSE_DOWN_TO_UP[type] }
      ];
      break;
    case 'LeftUp': case 'RightUp': case 'MiddleUp': case 'XButton1Up': case 'XButton2Up':
      cmds = [{ type }]; break;
    case 'ScrollUp': case 'ScrollDown': cmds = [{ type, value: 3 }]; break;
    case 'Delay': cmds = [{ type, value: 100 }]; break;
    case 'RandomDelay': cmds = [{ type, min: 50, max: 150 }]; break;
    case 'MouseMove': cmds = [{ type, x: 0, y: 0 }]; break;
    case 'GoTo': cmds = [{ type, targetLine: 1 }]; break;
    case 'GoWhile': cmds = [{ type, startLine: 1, count: 10 }]; break;
    case 'Comment': cmds = [{ type, value: 'Comment' }]; break;
    case 'ColorDetect': cmds = [{ type, x: 0, y: 0, color: 'FF0000', tolerance: 10 }]; break;
    case 'RunIfColor': cmds = [{ type, mode: 'match', x: 0, y: 0, color: 'FF0000', tolerance: 10, endLine: Math.max(2, insertAt + 2), jumpOnMatch: false, playSoundOnMatch: false }]; break;
    case 'WaitForPixelColor': cmds = [{ type, mode: 'match', x: 0, y: 0, color: 'FF0000', colorA: 'FF0000', colorB: '00FF00', fromColor: 'FF0000', toColor: '00FF00', tolerance: 10, timeoutMs: 1000, pollMs: 16, playSoundOnMatch: false }]; break;
    case 'Variable': cmds = [{ type, varName: 'var1', operation: '=', varValue: 0 }]; break;
    default: cmds = [{ type }]; break;
  }
  state.commands.splice(insertAt, 0, ...cmds);
  state.currentMacro.dirty=true;
  state.selectedIndices.clear(); state.selectedIndices.add(insertAt);
  renderCommands(); showCommandProperties(insertAt);
}

// ── Undo/Redo ────────────────────────────────────────────────
function pushUndo() { state.undoStack.push(JSON.parse(JSON.stringify(state.commands))); if(state.undoStack.length>50)state.undoStack.shift(); state.redoStack=[]; }
function undo() { if(!state.undoStack.length)return; state.redoStack.push(JSON.parse(JSON.stringify(state.commands))); state.commands=state.undoStack.pop(); state.currentMacro.dirty=true; renderCommands(); }
function redo() { if(!state.redoStack.length)return; state.undoStack.push(JSON.parse(JSON.stringify(state.commands))); state.commands=state.redoStack.pop(); state.currentMacro.dirty=true; renderCommands(); }

// ── Cut/Copy/Paste/Delete/Move ───────────────────────────────
function cutSelected() { if(!state.selectedIndices.size)return; pushUndo(); state.clipboard=[...state.selectedIndices].sort((a,b)=>a-b).map(i=>({...state.commands[i]})); deleteSelectedInternal(); renderCommands(); }
function copySelected() { if(!state.selectedIndices.size)return; state.clipboard=[...state.selectedIndices].sort((a,b)=>a-b).map(i=>JSON.parse(JSON.stringify(state.commands[i]))); showToast(`Copied ${state.clipboard.length} command(s)`,'info'); }
function pasteCommands() { if(!state.clipboard.length)return; pushUndo(); const at=state.selectedIndices.size>0?Math.max(...state.selectedIndices)+1:state.commands.length; const c=state.clipboard.map(x=>JSON.parse(JSON.stringify(x))); state.commands.splice(at,0,...c); state.currentMacro.dirty=true; state.selectedIndices.clear(); c.forEach((_,j)=>state.selectedIndices.add(at+j)); renderCommands(); }
function deleteSelected() { if(!state.selectedIndices.size)return; pushUndo(); deleteSelectedInternal(); renderCommands(); }
function deleteSelectedInternal() { [...state.selectedIndices].sort((a,b)=>b-a).forEach(i=>state.commands.splice(i,1)); state.selectedIndices.clear(); state.currentMacro.dirty=true; }
function moveSelected(dir) { if(state.selectedIndices.size!==1)return; const i=[...state.selectedIndices][0],n=i+dir; if(n<0||n>=state.commands.length)return; pushUndo(); [state.commands[i],state.commands[n]]=[state.commands[n],state.commands[i]]; state.selectedIndices.clear(); state.selectedIndices.add(n); state.currentMacro.dirty=true; renderCommands(); }
function toggleBreakpoint(i) { state.commands[i].breakpoint=!state.commands[i].breakpoint; renderCommands(); }

// ── Recording ────────────────────────────────────────────────
let removeRecordCaptureListener = null;

function recordCaptureFromMain(data) {
  if (!state.isRecording || !data) return;
  if (data.kind === 'stop') {
    stopRecording();
    return;
  }
  addRecordDelay();
  if (data.kind === 'key') {
    if (data.cmdType === 'down') state.commands.push({ type: 'KeyDown', keyCode: data.keyCode, device: 1 });
    else state.commands.push({ type: 'KeyUp', keyCode: data.keyCode, device: 1 });
  } else if (data.kind === 'mouse') {
    state.commands.push({ type: data.cmdType });
  }
  renderCommands();
}

function startRecording() {
  if (!state.currentMacro) { showToast('Open a macro first','error'); return; }
  state.isRecording = true;
  state.recordLastTime = Date.now();
  pushUndo();
  $('#btn-record').classList.add('toolbar__btn--active');
  $('#btn-record').innerHTML = '<span class="toolbar__btn-icon" style="color:#ef4444">⏺</span> Stop Rec';
  const globalHint = state.hasRobot ? ' Works in other apps too (Windows).' : '';
  showToast(`Recording... Keys, mouse, and wheel.${globalHint} Escape or Stop Rec to finish.`, 'info');
  document.addEventListener('keydown', recordKeyHandler, true);
  document.addEventListener('keyup', recordKeyUpHandler, true);
  document.addEventListener('mousedown', recordMouseHandler, true);
  document.addEventListener('mouseup', recordMouseUpHandler, true);
  document.addEventListener('wheel', recordWheelHandler, true);
  if (state.hasRobot && window.kyrun.onRecordCapture && window.kyrun.startGlobalRecordCapture) {
    removeRecordCaptureListener = window.kyrun.onRecordCapture(recordCaptureFromMain);
    window.kyrun.startGlobalRecordCapture();
  }
}

function stopRecording() {
  state.isRecording = false;
  if (removeRecordCaptureListener) {
    removeRecordCaptureListener();
    removeRecordCaptureListener = null;
  }
  if (window.kyrun.stopGlobalRecordCapture) window.kyrun.stopGlobalRecordCapture();
  $('#btn-record').classList.remove('toolbar__btn--active');
  $('#btn-record').innerHTML = '<span class="toolbar__btn-icon">⏺</span> Record';
  document.removeEventListener('keydown', recordKeyHandler, true);
  document.removeEventListener('keyup', recordKeyUpHandler, true);
  document.removeEventListener('mousedown', recordMouseHandler, true);
  document.removeEventListener('mouseup', recordMouseUpHandler, true);
  document.removeEventListener('wheel', recordWheelHandler, true);
  state.currentMacro.dirty = true;
  renderCommands();
  showToast(`Recorded ${state.commands.length} commands`,'success');
}

function addRecordDelay() {
  const now = Date.now();
  const elapsed = now - state.recordLastTime;
  state.recordLastTime = now;
  if (elapsed > 5) state.commands.push({ type:'Delay', value: Math.max(1, elapsed) });
}

function recordKeyHandler(e) {
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); stopRecording(); return; }
  // Ignore if typing in an input
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  e.preventDefault(); e.stopPropagation();
  addRecordDelay();
  state.commands.push({ type:'KeyDown', keyCode: e.keyCode, device:1 });
  renderCommands();
}

function recordKeyUpHandler(e) {
  if (!state.isRecording) return;
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  e.preventDefault(); e.stopPropagation();
  addRecordDelay();
  state.commands.push({ type:'KeyUp', keyCode: e.keyCode, device:1 });
  renderCommands();
}

function recordMouseHandler(e) {
  if (!state.isRecording) return;
  // Don't record clicks on the toolbar/sidebar
  if (e.target.closest('.toolbar') || e.target.closest('.sidebar') || e.target.closest('.properties-panel') || e.target.closest('.statusbar') || e.target.closest('.titlebar')) return;
  e.preventDefault(); e.stopPropagation();
  addRecordDelay();
  switch(e.button) {
    case 0: state.commands.push({type:'LeftDown'}); break;
    case 1: state.commands.push({type:'MiddleDown'}); break;
    case 2: state.commands.push({type:'RightDown'}); break;
    case 3: state.commands.push({type:'XButton1Down'}); break;
    case 4: state.commands.push({type:'XButton2Down'}); break;
  }
  renderCommands();
}

function recordMouseUpHandler(e) {
  if (!state.isRecording) return;
  if (e.target.closest('.toolbar') || e.target.closest('.sidebar') || e.target.closest('.properties-panel') || e.target.closest('.statusbar') || e.target.closest('.titlebar')) return;
  e.preventDefault(); e.stopPropagation();
  addRecordDelay();
  switch(e.button) {
    case 0: state.commands.push({type:'LeftUp'}); break;
    case 1: state.commands.push({type:'MiddleUp'}); break;
    case 2: state.commands.push({type:'RightUp'}); break;
    case 3: state.commands.push({type:'XButton1Up'}); break;
    case 4: state.commands.push({type:'XButton2Up'}); break;
  }
  renderCommands();
}

function recordWheelHandler(e) {
  if (!state.isRecording) return;
  if (e.target.closest('.toolbar') || e.target.closest('.sidebar') || e.target.closest('.properties-panel')) return;
  e.preventDefault(); e.stopPropagation();
  addRecordDelay();
  state.commands.push({ type: e.deltaY<0?'ScrollUp':'ScrollDown', value:3 });
  renderCommands();
}

// ── Macro Execution ──────────────────────────────────────────
async function waitForMacroStopped(maxMs = 15000) {
  const start = Date.now();
  while (await window.kyrun.isMacroRunning()) {
    if (Date.now() - start > maxMs) break;
    await new Promise(r => setTimeout(r, 16));
  }
}

/** Which macro file path owns the current run (bind or Play); cleared when execution ends. */
let executionMacroPath = null;

function sameMacroRelPath(a, b) {
  if (!a || !b) return false;
  return String(a).replace(/\\/g, '/').toLowerCase() === String(b).replace(/\\/g, '/').toLowerCase();
}

async function runMacro() {
  if (!state.currentMacro || !state.commands.length) { showToast('No macro to run','error'); return; }
  if (await window.kyrun.isMacroRunning()) {
    try { await window.kyrun.stopMacro(); } catch {}
    await waitForMacroStopped();
  }
  const settings = { ...state.macroSettings, speedMultiplier: state.speedMultiplier, triggerFromBind: false };
  const prevPath = executionMacroPath;
  executionMacroPath = state.currentMacro.path;
  try {
    const result = await window.kyrun.executeMacro(state.commands, settings);
    if (!result.success) {
      executionMacroPath = prevPath;
      showToast(result.error||'Execution failed','error');
    }
  } catch (e) {
    executionMacroPath = prevPath;
    showToast('Input module not available','error');
  }
}

async function stopMacro() {
  try { await window.kyrun.stopMacro(); } catch {}
}

function updateRunningUI(running) {
  const dot = $('#macro-dot'), text = $('#macro-status-text');
  if (running) {
    dot.className='titlebar__status-dot titlebar__status-dot--active';
    text.textContent='Running';
    $('#btn-play').innerHTML='<span class="toolbar__btn-icon">⏸</span> Pause';
  } else {
    dot.className='titlebar__status-dot titlebar__status-dot--inactive';
    text.textContent='Stopped';
    $('#btn-play').innerHTML='<span class="toolbar__btn-icon">▶</span> Run';
    $$('.command-row--executing').forEach(r=>r.classList.remove('command-row--executing'));
  }
}

// ── .amc/.krm Import/Export ──────────────────────────────────

// Keyran-specific indices → Windows VK (when file uses Keyran numbering, not HID / not raw VK)
const KEYRAN_TO_VK = {
  1:1, 2:2, 4:4, // L, R, M mouse
  8:8, 9:9, 13:13, 16:16, 17:17, 18:18, // Backspace, Tab, Enter, Shift, Ctrl, Alt
  20:81, // q
  22:83, // s
  25:86, // v (HID usage 25; Keyran files often omit this index — avoids wrong VK 25)
  26:87, // w
  27:27, 32:32, 33:33, 34:34, 35:35, 36:36, 37:37, 38:38, 39:39, 40:40, // Esc, Space, PgUp, PgDn, End, Home, Arrows
  45:45, 46:46, // Ins, Del
  48:48, 49:49, 50:50, 51:51, 52:52, 53:53, 54:54, 55:55, 56:56, 57:57, // 0-9
  65:65, 66:66, 67:67, 68:68, 69:69, 70:70, 71:71, 72:72, 73:73, 74:74, 75:75, 76:76, 77:77, // a-m
  78:78, 79:79, 80:80, 81:81, 82:82, 83:83, 84:84, 85:85, 86:86, 87:87, 88:88, 89:89, 90:90, // n-z
  96:96, 97:97, 98:98, 99:99, 100:100, 101:101, 102:102, 103:103, 104:104, 105:105, // Numpad
  112:112, 113:113, 114:114, 115:115, 116:116, 117:117, 118:118, 119:119, 120:120, 121:121, 122:122, 123:123, // F1-F12
  225:16 // Keyran extended shift → VK_SHIFT
};

/**
 * USB HID keyboard usage IDs (decimal) → Windows VK.
 * Many .amc exports (mouse software, some games) store HID usages: 8=E, 9=F — same numbers Keyran uses for Backspace/Tab.
 */
function hidKeyboardUsageToVk(u) {
  if (u <= 0) return null;
  // Letters a–z: HID 4–29 → VK A–Z
  if (u >= 4 && u <= 29) return 65 + (u - 4);
  // Row 1–0: HID 30–39
  if (u >= 30 && u <= 38) return 49 + (u - 30); // 1..9
  if (u === 39) return 48; // 0
  // HID 40–46 → Enter, Esc, Backspace, Tab, Space (USB HID 0x28–0x2E)
  if (u === 40) return 13; // Enter
  if (u === 41) return 27; // Escape
  if (u === 42) return 8; // Backspace
  if (u === 43) return 9; // Tab
  if (u === 44) return 32; // Space
  if (u === 45) return 189; // -_
  if (u === 46) return 187; // =+
  // 47–56: [ ] \ ; ' ` , . /
  const misc47 = { 47:219,48:221,49:220,50:186,51:222,52:192,53:188,54:190,55:191 };
  if (misc47[u]) return misc47[u];
  if (u === 57) return 20; // CapsLock
  // F1–F12: HID 58–69
  if (u >= 58 && u <= 69) return 112 + (u - 58);
  // Nav cluster: 70–83 approx (PrintScreen, ScrollLock, Pause, Insert, Home, etc.) — partial
  if (u === 73) return 45; // Insert
  if (u === 74) return 36; // Home
  if (u === 75) return 33; // PageUp
  if (u === 76) return 46; // Delete
  if (u === 77) return 35; // End
  if (u === 78) return 34; // PageDown
  if (u === 79) return 39; // Right
  if (u === 80) return 37; // Left
  if (u === 81) return 40; // Down
  if (u === 82) return 38; // Up
  // Numpad 1–9: HID 89–97, Numpad 0: 98
  if (u >= 89 && u <= 97) return 97 + (u - 89); // VK_NUMPAD1 = 97 … NUMPAD9 = 105
  if (u === 98) return 96; // Numpad 0
  // Left/right modifiers (common in macro tools, decimal 224–231)
  if (u === 224) return 162; // Left Ctrl
  if (u === 225) return 160; // Left Shift
  if (u === 226) return 164; // Left Alt
  if (u === 227) return 91; // Left Win
  if (u === 228) return 163; // Right Ctrl
  if (u === 229) return 161; // Right Shift
  if (u === 230) return 165; // Right Alt
  if (u === 231) return 92; // Right Win
  return null;
}

function keyranIndexToVk(raw) {
  return KEYRAN_TO_VK[raw] !== undefined ? KEYRAN_TO_VK[raw] : raw;
}

function collectRawKeyCodesFromSyntax(text) {
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    const p = line.trim().split(/\s+/);
    if (p.length >= 2 && /^(KeyDown|KeyUp)$/i.test(p[0])) {
      const n = parseInt(p[1], 10);
      if (!isNaN(n)) out.push(n);
    }
  }
  return out;
}

/** Choose HID vs Keyran table: HID 8,9 = E,F; Keyran 8,9 = Backspace,Tab — same numbers, different meaning. */
function detectImportKeyCodec(rawCodes) {
  const uniq = [...new Set(rawCodes)].filter(c => c > 0);
  if (uniq.length === 0) return 'keyran';
  // File already stores Windows VK codes (65–90 letters)
  if (uniq.some(c => c >= 65 && c <= 90)) return 'keyran';
  // Keyran index 27 = Escape (VK 27); HID usage 27 = X — lone 27 must stay Keyran for Esc macros
  if (uniq.length === 1 && uniq[0] === 27) return 'keyran';

  let hidLetter = 0, krLetter = 0;
  for (const raw of uniq) {
    const h = hidKeyboardUsageToVk(raw);
    const k = keyranIndexToVk(raw);
    if (h >= 65 && h <= 90) hidLetter++;
    if (k >= 65 && k <= 90) krLetter++;
  }
  if (hidLetter > krLetter) return 'hid';
  if (krLetter > hidLetter) return 'keyran';
  if (uniq.includes(8) && uniq.includes(9)) return 'hid';
  // Tie: do NOT map lone 8/9 to Keyran — that turns USB E/F into Backspace/Tab. Prefer HID (typical Keyran .amc export).
  return 'hid';
}

function importRawKeyCodeToVk(raw, codec) {
  if (codec === 'hid') {
    const h = hidKeyboardUsageToVk(raw);
    if (h != null) return h;
  }
  return keyranIndexToVk(raw);
}

// Parse Keyran syntax lines into command array
function parseSyntaxLines(text, codec = 'keyran') {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  const commands = [];
  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    const cmd = parts[0].replace(/;+$/g, '').toLowerCase();
    switch(cmd) {
      case 'keydown': {
        const raw = parseInt(parts[1])||0;
        commands.push({type:'KeyDown',keyCode:importRawKeyCodeToVk(raw, codec),device:parseInt(parts[2])||1});
        break;
      }
      case 'keyup': {
        const raw = parseInt(parts[1])||0;
        commands.push({type:'KeyUp',keyCode:importRawKeyCodeToVk(raw, codec),device:parseInt(parts[2])||1});
        break;
      }
      case 'leftdown': commands.push({type:'LeftDown'}); break;
      case 'leftup': commands.push({type:'LeftUp'}); break;
      case 'rightdown': commands.push({type:'RightDown'}); break;
      case 'rightup': commands.push({type:'RightUp'}); break;
      case 'middledown': commands.push({type:'MiddleDown'}); break;
      case 'middleup': commands.push({type:'MiddleUp'}); break;
      case 'xbutton1down': commands.push({type:'XButton1Down'}); break;
      case 'xbutton1up': commands.push({type:'XButton1Up'}); break;
      case 'xbutton2down': commands.push({type:'XButton2Down'}); break;
      case 'xbutton2up': commands.push({type:'XButton2Up'}); break;
      case 'delay': {
        const a = parseInt(String(parts[1] || '').replace(/;+$/g, ''), 10) || 100;
        const bStr = parts[2] !== undefined ? String(parts[2]).replace(/;+$/g, '') : '';
        const b = bStr !== '' ? parseInt(bStr, 10) : NaN;
        if (!isNaN(b)) {
          const lo = Math.min(a, b), hi = Math.max(a, b);
          commands.push({ type: 'RandomDelay', min: lo, max: hi });
        } else {
          commands.push({ type: 'Delay', value: a });
        }
        break;
      }
      case 'gowhile': commands.push({type:'GoWhile',startLine:parseInt(parts[1])||1,count:parseInt(parts[2])||1}); break;
      case 'goto': commands.push({type:'GoTo',targetLine:parseInt(parts[1])||1}); break;
      case 'mousemove': commands.push({type:'MouseMove',x:parseInt(parts[1])||0,y:parseInt(parts[2])||0}); break;
      case 'scrollup': commands.push({type:'ScrollUp',value:parseInt(parts[1])||3}); break;
      case 'scrolldown': commands.push({type:'ScrollDown',value:parseInt(parts[1])||3}); break;
      // Ignore unknown or comment lines
    }
  }
  return commands;
}

// Parse Keyran .amc/.krm XML — handles all known XML structures
function parseAmcXml(content) {
  // First: try to parse as XML
  const parser = new DOMParser();
  const doc = parser.parseFromString(content, 'text/xml');
  const hasParseError = doc.querySelector('parsererror');

  if (!hasParseError) {
    // Try every known Keyran XML structure to find Syntax nodes:
    // 1) <Root><DefaultMacro><KeyDown><Syntax>...</Syntax></KeyDown></DefaultMacro></Root>
    // 2) <Root><MacroName><KeyDown><Syntax>...</Syntax></KeyDown></MacroName></Root>
    // 3) <KeyDown><Syntax>...</Syntax></KeyDown>
    // 4) Any element named Syntax anywhere in the tree
    const syntaxNodes = doc.querySelectorAll('Syntax');
    if (syntaxNodes.length > 0) {
      let combinedSyntax = '';
      syntaxNodes.forEach(node => { combinedSyntax += node.textContent + '\n'; });
      const codec = detectImportKeyCodec(collectRawKeyCodesFromSyntax(combinedSyntax));
      const allCommands = [];
      syntaxNodes.forEach(node => {
        const cmds = parseSyntaxLines(node.textContent, codec);
        allCommands.push(...cmds);
      });
      if (allCommands.length > 0) {
        return { commands: allCommands, name: 'Imported Macro', importCodec: codec };
      }
    }
  }

  // Second: try to parse as raw syntax text (no XML wrapper)
  // Check if the content looks like syntax lines (starts with a known command)
  const knownCmds = ['keydown','keyup','leftdown','leftup','rightdown','rightup','delay','gowhile','goto','mousemove','middledown','middleup','scrollup','scrolldown','xbutton'];
  const firstWord = content.trim().split(/\s+/)[0];
  if (firstWord && knownCmds.some(c => firstWord.toLowerCase().startsWith(c))) {
    const codec = detectImportKeyCodec(collectRawKeyCodesFromSyntax(content));
    const cmds = parseSyntaxLines(content, codec);
    if (cmds.length > 0) return { commands: cmds, name: 'Imported Macro', importCodec: codec };
  }

  return null;
}

function exportToAmc(commands) {
  let syntax = '';
  commands.forEach(cmd => {
    switch(cmd.type) {
      case 'KeyDown': syntax+=`KeyDown ${cmd.keyCode} ${cmd.device||1}\n`; break;
      case 'KeyUp': syntax+=`KeyUp ${cmd.keyCode} ${cmd.device||1}\n`; break;
      case 'LeftDown': syntax+='LeftDown\n'; break; case 'LeftUp': syntax+='LeftUp\n'; break;
      case 'RightDown': syntax+='RightDown\n'; break; case 'RightUp': syntax+='RightUp\n'; break;
      case 'MiddleDown': syntax+='MiddleDown\n'; break; case 'MiddleUp': syntax+='MiddleUp\n'; break;
      case 'XButton1Down': syntax+='XButton1Down\n'; break; case 'XButton1Up': syntax+='XButton1Up\n'; break;
      case 'XButton2Down': syntax+='XButton2Down\n'; break; case 'XButton2Up': syntax+='XButton2Up\n'; break;
      case 'ScrollUp': syntax+=`ScrollUp ${cmd.value||3}\n`; break;
      case 'ScrollDown': syntax+=`ScrollDown ${cmd.value||3}\n`; break;
      case 'Delay': syntax+=`Delay ${cmd.value}\n`; break;
      case 'RandomDelay': syntax+=`Delay ${cmd.min} ${cmd.max}\n`; break;
      case 'GoWhile': syntax+=`GoWhile ${cmd.startLine} ${cmd.count}\n`; break;
      case 'GoTo': syntax+=`GoTo ${cmd.targetLine}\n`; break;
      case 'MouseMove': syntax+=`MouseMove ${cmd.x} ${cmd.y}\n`; break;
    }
  });
  return `<Root>\n  <DefaultMacro>\n    <KeyDown>\n      <Syntax>\n${syntax}      </Syntax>\n    </KeyDown>\n  </DefaultMacro>\n</Root>`;
}

function exportToAhk(commands, hotkey='F1', speed=1.0) {
  let body = '';
  commands.forEach(cmd => {
    const k = KEY_CODE_MAP[cmd.keyCode];
    switch(cmd.type) {
      case 'KeyDown': body+=`    Send, {${k||'a'} Down}\n`; break;
      case 'KeyUp': body+=`    Send, {${k||'a'} Up}\n`; break;
      case 'LeftDown': body+='    Click, Left, Down\n'; break; case 'LeftUp': body+='    Click, Left, Up\n'; break;
      case 'RightDown': body+='    Click, Right, Down\n'; break; case 'RightUp': body+='    Click, Right, Up\n'; break;
      case 'Delay': body+=`    Sleep, ${Math.round(cmd.value*speed)}\n`; break;
      case 'MouseMove': body+=`    MouseMove, ${cmd.x}, ${cmd.y}\n`; break;
    }
  });
  return `; Generated by Kyrun\n#SingleInstance force\nSetBatchLines, -1\nSetKeyDelay, -1, -1\nSetMouseDelay, -1\ntoggle := false\n#MaxThreadsPerHotkey 2\n\n${hotkey}::\n    toggle := !toggle\n    if (!toggle)\n        return\n    Loop\n    {\n        if (!toggle)\n            break\n${body}    }\nReturn\n`;
}

const AMC_EXPORT_TYPES = new Set(['KeyDown', 'KeyUp', 'LeftDown', 'LeftUp', 'RightDown', 'RightUp', 'MiddleDown', 'MiddleUp', 'XButton1Down', 'XButton1Up', 'XButton2Down', 'XButton2Up', 'ScrollUp', 'ScrollDown', 'Delay', 'RandomDelay', 'GoWhile', 'GoTo', 'MouseMove']);
const AHK_EXPORT_TYPES = new Set(['KeyDown', 'KeyUp', 'LeftDown', 'LeftUp', 'RightDown', 'RightUp', 'Delay', 'MouseMove']);

function getUnsupportedCommandTypes(commands, supportedTypes) {
  return [...new Set((commands || []).map(cmd => cmd?.type).filter(type => type && !supportedTypes.has(type)))];
}

// ── Import Handler ───────────────────────────────────────────
async function importMacros() {
  try {
    try { await window.kyrun.switchProfile(state.currentProfile); } catch {}
    const files = await window.kyrun.importFileDialog();
    if (!files || !files.length) return;
    let lastImported = null;
    let macros;
    try { macros = await window.kyrun.getProfileMacros(state.currentProfile); }
    catch { macros = []; }
    const reserved = new Set(collectMacroRelPaths(macros).map(p => p.toLowerCase()));

    for (const f of files) {
      let data = null;
      const isAmcKrm = f.name.endsWith('.amc') || f.name.endsWith('.krm');
      
      if (isAmcKrm) {
        data = parseAmcXml(f.content);
        if (data) data.name = f.name.replace(/\.\w+$/,'');
      } else {
        // Try JSON (.kyrun)
        try { data = JSON.parse(f.content); } catch { data = null; }
      }

      if (data && data.commands && data.commands.length > 0) {
        const baseName = data.name || f.name.replace(/\.\w+$/,'') || 'Imported';
        const destName = pickUniqueKyrunFilename(baseName, reserved);
        const macroName = destName.replace(/\.kyrun$/i, '');
        const macroData = { name: macroName, version:'1.0', commands: data.commands, settings: data.settings||{} };
        await window.kyrun.saveMacroFile(destName, JSON.stringify(macroData, null, 2));
        lastImported = { name: macroName, path: destName, type: 'macro' };
        const codecHint = data.importCodec === 'hid' ? ' (USB HID key codes)' : '';
        showToast(`Imported "${macroName}" — ${data.commands.length} commands${codecHint}`, 'success');
      } else {
        showToast(`Failed to parse: ${f.name} (no commands found)`, 'error');
      }
    }

    // Refresh the file tree
    await loadFileTree();

    // Auto-open the last imported macro so user sees it immediately
    if (lastImported) {
      openMacro(lastImported);
    }
  } catch(e) { showToast('Import failed: ' + (e.message||'unknown error'), 'error'); }
}

async function exportMacro() {
  if (!state.currentMacro) return;
  try {
    const filePath = await window.kyrun.exportFileDialog(state.currentMacro.name);
    if (!filePath) return;
    let content;
    if (filePath.endsWith('.amc')) {
      const unsupported = getUnsupportedCommandTypes(state.commands, AMC_EXPORT_TYPES);
      if (unsupported.length) showToast(`.amc export skips: ${unsupported.join(', ')}`, 'info');
      content = exportToAmc(state.commands);
    }
    else if (filePath.endsWith('.ahk')) {
      const unsupported = getUnsupportedCommandTypes(state.commands, AHK_EXPORT_TYPES);
      if (unsupported.length) showToast(`.ahk export skips: ${unsupported.join(', ')}`, 'info');
      content = exportToAhk(state.commands);
    }
    else content = JSON.stringify({name:state.currentMacro.name,commands:state.commands,settings:state.macroSettings},null,2);
    await window.kyrun.saveMacroFile(filePath, content);
    showToast('Exported successfully','success');
  } catch { showToast('Export not available','error'); }
}

// ── Context Menus ────────────────────────────────────────────
function showCommandContextMenu(e,i) {
  e.preventDefault();
  if(!state.selectedIndices.has(i)){state.selectedIndices.clear();state.selectedIndices.add(i);renderCommands();}
  const m=$('#context-menu');
  m.innerHTML=`<button class="context-menu__item" data-a="edit">✏ Edit properties…</button><div class="context-menu__separator"></div><button class="context-menu__item" data-a="cut">✂ Cut<span class="context-menu__shortcut">Ctrl+X</span></button><button class="context-menu__item" data-a="copy">📋 Copy<span class="context-menu__shortcut">Ctrl+C</span></button><button class="context-menu__item" data-a="paste">📌 Paste<span class="context-menu__shortcut">Ctrl+V</span></button><div class="context-menu__separator"></div><button class="context-menu__item" data-a="dup">⧉ Duplicate</button><button class="context-menu__item" data-a="bp">⏸ Toggle Breakpoint</button><div class="context-menu__separator"></div><button class="context-menu__item context-menu__item--danger" data-a="del">🗑 Delete<span class="context-menu__shortcut">Del</span></button>`;
  posCtx(m,e);
  m.querySelectorAll('[data-a]').forEach(b=>{b.onclick=()=>{hideCtx();switch(b.dataset.a){case'edit':showCommandProperties(i);break;case'cut':cutSelected();break;case'copy':copySelected();break;case'paste':pasteCommands();break;case'dup':copySelected();pasteCommands();break;case'bp':toggleBreakpoint(i);break;case'del':deleteSelected();break;}}});
}
function showFileContextMenu(e,item) {
  e.preventDefault();
  const m=$('#context-menu');
  m.innerHTML=`<button class="context-menu__item" data-a="open">📂 Open</button><button class="context-menu__item" data-a="export">📤 Export</button><button class="context-menu__item" data-a="rename">✏ Rename…</button><div class="context-menu__separator"></div><button class="context-menu__item context-menu__item--danger" data-a="del">🗑 Delete</button>`;
  posCtx(m,e);
  m.querySelectorAll('[data-a]').forEach(b=>{b.onclick=()=>{hideCtx();switch(b.dataset.a){case'open':openMacro(item);break;case'del':deleteMacroFile(item);break;case'export':exportMacro();break;case'rename':renameMacroFile(item);break;}}});
}
function posCtx(m,e){m.classList.add('context-menu--visible');let x=e.clientX,y=e.clientY;setTimeout(()=>{const r=m.getBoundingClientRect();if(x+r.width>innerWidth)x=innerWidth-r.width-4;if(y+r.height>innerHeight)y=innerHeight-r.height-4;m.style.left=x+'px';m.style.top=y+'px';},0);}
function hideCtx(){$('#context-menu').classList.remove('context-menu--visible');}

// ── UI Updates ───────────────────────────────────────────────
function updateMacroSettings() {
  $('#loop-enabled').checked = state.macroSettings.loop;
  $('#loop-count').value = state.macroSettings.loopCount||0;
  $('#loop-count-field').style.display = state.macroSettings.loop?'block':'none';
  const hw = $('#hold-while-pressed');
  if (hw) hw.checked = !!state.macroSettings.holdWhilePressed;
  const hbg = $('#hold-between-passes-ms');
  if (hbg) hbg.value = state.macroSettings.holdBetweenPassesMs ?? 45;
  syncHoldPassGapFieldVisibility();
  $('#random-delays').checked = state.macroSettings.randomDelays;
  const b2s = $('#bind-second-press-stops');
  if (b2s) b2s.checked = !!state.macroSettings.bindSecondPressStops;
  $('#bind-key-input').value = state.macroSettings.bindKey||'';
}
function syncAnonymousButtonUI() {
  const btn = $('#btn-anonymous');
  const anon = $('#anonymous-text');
  if (!btn || !anon) return;
  btn.className = `statusbar__anonymous statusbar__anonymous--${state.isAnonymous ? 'on' : 'off'}`;
  if (state.streamerMode) {
    anon.textContent = '';
    btn.title = state.isAnonymous ? 'Privacy: anonymous on' : 'Privacy: anonymous off';
  } else {
    anon.textContent = `Anonymous: ${state.isAnonymous ? 'ON' : 'OFF'}`;
    btn.title = 'Toggle Anonymous Mode';
  }
}

function updateTitlebarBrand() {
  const privacy = privacyActive();
  const logoIcon = $('#titlebar-logo-icon');
  const titleText = $('#titlebar-title-text');
  if (logoIcon) logoIcon.textContent = privacy ? '•' : 'K';
  if (titleText) titleText.textContent = privacy ? 'APP' : 'KYRUN';
  document.title = privacy ? 'App' : 'Kyrun';
}

function updateStatusBar() {
  $('#statusbar-commands span').textContent = `${state.commands.length} commands`;
  if (privacyActive()) {
    $('#statusbar-profile').textContent = '—';
    $('#statusbar-pid').textContent = '';
    const mn = $('#statusbar-macro-name span');
    mn.textContent = state.currentMacro
      ? (state.currentMacro.dirty ? 'Macro open •' : 'Macro open')
      : 'No macro open';
  } else {
    $('#statusbar-profile').textContent = state.currentProfile;
    const mn = $('#statusbar-macro-name span');
    mn.textContent = state.currentMacro ? `${state.currentMacro.name}${state.currentMacro.dirty ? ' •' : ''}` : 'No macro open';
    $('#statusbar-pid').textContent = state.cachedPidText || '';
  }
  updateTitlebarBrand();
  syncAnonymousButtonUI();
  updateTriggersTitlebar();
}

function updateTriggersTitlebar() {
  const dot = $('#triggers-dot');
  const text = $('#triggers-status-text');
  const row = $('#status-triggers');
  if (!dot || !text) return;
  const armed = state.macroTriggers.armed;
  if (armed) {
    dot.className = 'titlebar__status-dot titlebar__status-dot--active';
    text.textContent = privacyActive() ? 'On' : 'Hotkeys: On';
    if (row) row.title = 'Global hotkeys on: macro binds and profile switch keys (Settings).';
  } else {
    dot.className = 'titlebar__status-dot titlebar__status-dot--inactive';
    text.textContent = privacyActive() ? 'Off' : 'Hotkeys: Off';
    if (row) row.title = 'Global hotkeys off: binds are unhooked so keys work normally in other apps.';
  }
}
function updateKeyboardViz() {
  $$('.keyboard-viz__key').forEach(k=>k.classList.remove('keyboard-viz__key--active'));
  state.selectedIndices.forEach(i=>{const c=state.commands[i];if(c&&(c.type==='KeyDown'||c.type==='KeyUp')){const k=$(`.keyboard-viz__key[data-key="${c.keyCode}"]`);if(k)k.classList.add('keyboard-viz__key--active');}});
}

async function deleteMacroFile(item) {
  showModal('Delete Macro',`<p>Delete <strong>${item.name}</strong>?</p>`,[
    {label:'Cancel',type:'secondary',action:()=>{}},
    {label:'Delete',type:'danger',action:async()=>{
      try{await window.kyrun.deleteMacro(item.path);}catch{}
      if(state.currentMacro&&state.currentMacro.path===item.path){state.currentMacro=null;state.commands=[];$('#editor-content').classList.add('hidden');$('#welcome-view').classList.remove('hidden');}
      loadFileTree(); showToast('Deleted','info');
    }}
  ]);
}

function renameMacroFile(item) {
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  showModal('Rename Macro', `<input type="text" class="properties-panel__input" id="rename-macro-name" value="${esc(item.name)}" placeholder="Macro name…">`, [
    { label: 'Cancel', type: 'secondary', action: () => {} },
    { label: 'Rename', type: 'primary', action: async () => {
      const inp = document.getElementById('rename-macro-name');
      const raw = (inp && inp.value || '').trim();
      if (!raw) return;
      const withoutExt = raw.replace(/\.(kyrun|amc|krm)$/i, '');
      if (withoutExt === item.name) return;
      try {
        const res = await window.kyrun.renameMacro(item.path, raw);
        if (!res || !res.ok) {
          const err = res && res.error;
          showToast(err === 'Exists' ? 'A file with that name already exists' : (err || 'Rename failed'), 'error');
          return;
        }
        if (state.currentMacro && state.currentMacro.path === item.path) {
          state.currentMacro.path = res.newPath;
          if (res.displayName) state.currentMacro.name = res.displayName;
          if (state.currentMacro.dirty) await saveMacro({ silent: true });
          else await reloadProfileTriggers();
        } else {
          await reloadProfileTriggers();
        }
        await loadFileTree();
        const hi = findFileTreeItemByPath(res.newPath);
        if (hi) hi.classList.add('file-tree__item--active');
        showToast('Macro renamed', 'success');
      } catch {
        showToast('Rename failed', 'error');
      }
    }}
  ]);
}

// ── Keyboard Viz Click ───────────────────────────────────────
$$('.keyboard-viz__key').forEach(key => {
  key.addEventListener('click', e => {
    e.preventDefault();
    e.stopPropagation();
    const kc = parseInt(key.dataset.key, 10);
    if (!state.currentMacro) { showToast('Open or create a macro first', 'error'); return; }
    pushUndo();
    const at = state.selectedIndices.size>0?Math.max(...state.selectedIndices)+1:state.commands.length;
    const h = getPaletteHoldDelayMs();
    state.commands.splice(at,0,{type:'Delay',value:h},{type:'KeyDown',keyCode:kc,device:1},{type:'Delay',value:h},{type:'KeyUp',keyCode:kc,device:1});
    state.currentMacro.dirty=true;
    state.selectedIndices.clear(); state.selectedIndices.add(at);
    renderCommands();
    showCommandProperties(at);
  });
});

// ── Event Listeners from IPC ─────────────────────────────────
try {
  window.kyrun.onMacroState(data => {
    state.isRunning = data.running;
    if (!data.running) executionMacroPath = null;
    updateRunningUI(data.running);
  });
  window.kyrun.onMacroLine(line => {
    $$('.command-row--executing').forEach(r=>r.classList.remove('command-row--executing'));
    const row=$(`.command-row[data-index="${line}"]`);
    if(row) row.classList.add('command-row--executing');
  });
  window.kyrun.onProfileChanged(name => {
    state.currentProfile = name;
    loadProfiles(); loadFileTree(); reloadProfileTriggers(); updateStatusBar();
    if (suppressNextProfileChangedTts) {
      suppressNextProfileChangedTts = false;
      return;
    }
    void speakProfileName(name, 'tray');
  });
  window.kyrun.onAnonymousModeChanged(isAnon => { state.isAnonymous = !!isAnon; updateStatusBar(); });
  window.kyrun.onMacroTriggersState(data => {
    const prevArmed = !!(state.macroTriggers && state.macroTriggers.armed);
    const nextArmed = !!data.armed;
    state.macroTriggers = { armed: !!data.armed };
    updateTriggersTitlebar();
    void reloadProfileTriggers();
    if (hotkeysTtsReady && prevArmed !== nextArmed) {
      void speakHotkeysState(nextArmed);
    }
  });
  
  // Serialize hotkey handling. Do NOT await executeMacro here — that would block the queue until the
  // macro finishes, so a second bind press could never run to stop (toggle) or interrupt.
  let hotkeyTriggerQueue = Promise.resolve();
  async function handleHotkeyTrigger(macroPath) {
    if (Date.now() < suppressHotkeyTriggersUntil) return;
    if (macroPath.startsWith('!profile:')) {
      const pName = macroPath.replace('!profile:', '');
      if (pName !== state.currentProfile) {
        state.currentProfile = pName;
        suppressNextProfileChangedTts = true;
        try { await window.kyrun.switchProfile(pName); } catch {}
        loadProfiles(); loadFileTree(); reloadProfileTriggers();
        $('#editor-content').classList.add('hidden'); $('#welcome-view').classList.remove('hidden');
        updateStatusBar();
        await speakProfileName(pName, 'hotkeys');
        showToast(privacyActive() ? 'Profile switched' : `Profile switched: ${pName}`, 'info');
      }
      return;
    }

    let data;
    try {
      const raw = await window.kyrun.readMacroFile(macroPath);
      if (!raw) return;
      data = JSON.parse(raw);
      if (!data || !data.commands) return;
    } catch { return; }

    const running = await window.kyrun.isMacroRunning();
    const stopOnly = !!(data.settings && data.settings.bindSecondPressStops)
      && sameMacroRelPath(executionMacroPath, macroPath);

    if (running) {
      try { await window.kyrun.stopMacro(); } catch {}
      await waitForMacroStopped();
      if (stopOnly) return;
    }

    const settings = { ...data.settings, speedMultiplier: state.speedMultiplier, triggerFromBind: true };
    const prevPath = executionMacroPath;
    executionMacroPath = macroPath;
    window.kyrun.executeMacro(data.commands, settings)
      .then((result) => {
        if (!result.success) {
          executionMacroPath = prevPath;
          if (result.error !== 'Macro already running') {
            showToast(result.error || 'Execution failed', 'error');
          }
        }
      })
      .catch(() => { executionMacroPath = prevPath; });
  }
  window.kyrun.onHotkeyTriggered((macroPath) => {
    hotkeyTriggerQueue = hotkeyTriggerQueue.then(() => handleHotkeyTrigger(macroPath)).catch(() => {});
  });
} catch {}

// ── Trigger Registration ─────────────────────────────────────
let activeTriggers = []; // {path, isMouse, vk, bindKey}

async function reloadProfileTriggers() {
  let firstHotkeyError = null;
  // Unregister all existing
  for (const t of activeTriggers) {
    if (t.isMouse) await window.kyrun.unregisterMouseTrigger(t.vk);
    else await window.kyrun.unregisterHotkey(t.path);
  }
  activeTriggers = [];

  try {
  // When hotkeys are off, do not register globalShortcut / mouse polling — otherwise the OS still
  // captures those keys and other apps (and games) never receive them.
  if (!state.macroTriggers.armed) return;

  // Find all macros in this profile and check settings
  async function scanTree(items) {
    for (const item of items) {
      if (item.type === 'folder') {
        if (item.children) await scanTree(item.children);
      } else {
        try {
          const raw = await window.kyrun.readMacroFile(item.path);
          const data = JSON.parse(raw);
          if (data && data.settings && (data.settings.bindKey || data.settings.bindVk)) {
            const vk = data.settings.bindVk || 0;
            const isMouse = data.settings.bindIsMouse || false;
            const macroLabel = data.name || item.name || item.path;
            if (isMouse && vk) {
              const ok = await window.kyrun.registerMouseTrigger(item.path, vk);
              if (ok) activeTriggers.push({path: item.path, isMouse: true, vk});
              else if (!firstHotkeyError) firstHotkeyError = `Mouse trigger failed: "${macroLabel}"`;
            } else if (data.settings.bindKey) {
              const electronAc = convertToElectronAccelerator(data.settings.bindKey);
              if (!electronAc) {
                if (!firstHotkeyError) {
                  firstHotkeyError = `Unsupported hotkey "${data.settings.bindKey}" for "${macroLabel}" — use a letter, number, F1–F12, or Space.`;
                }
              } else {
                const ok = await window.kyrun.registerHotkey(item.path, electronAc);
                if (ok) {
                  activeTriggers.push({path: item.path, isMouse: false, bindKey: data.settings.bindKey});
                } else if (!firstHotkeyError) {
                  firstHotkeyError = `Could not register "${electronAc}" for "${macroLabel}" (in use or blocked by the OS).`;
                }
              }
            }
          }
        } catch {} // ignore bad files
      }
    }
  }
  
  try {
    const macros = await window.kyrun.getProfileMacros(state.currentProfile);
    await scanTree(macros);
  } catch {}
  
  // Register Profile Hotkeys (keyboard via globalShortcut, mouse via low-level polling — both work unfocused)
  try {
    const settings = await window.kyrun.getSettings();
    if (settings && settings.profileHotkeys) {
      for (const [pName, bindKey] of Object.entries(settings.profileHotkeys)) {
        if (!bindKey) continue;
        const electronAc = convertToElectronAccelerator(bindKey);
        if (electronAc) {
          await window.kyrun.registerHotkey(`!profile:${pName}`, electronAc);
          activeTriggers.push({path: `!profile:${pName}`, isMouse: false, bindKey});
        } else {
          const vk = profileMouseBindToVk(bindKey);
          if (vk) {
            const ok = await window.kyrun.registerMouseTrigger(`!profile:${pName}`, vk);
            if (ok) activeTriggers.push({path: `!profile:${pName}`, isMouse: true, vk});
            else if (!firstHotkeyError) firstHotkeyError = `Mouse profile hotkey needs native input (profile "${pName}").`;
          }
        }
      }
    }
  } catch {}
  if (firstHotkeyError) showToast(firstHotkeyError, 'error');
  } finally {
    try { await window.kyrun.reapplyTriggersToggleBind(); } catch {}
    try { await window.kyrun.reapplyColorbotToggleBind(); } catch {}
    // reapply both (reloadProfileTriggers finally already does; keep explicit)
  }
}

function profileMouseBindToVk(bindKey) {
  const map = {
    'Middle Mouse': 4,
    'Right Mouse': 2,
    'Mouse X1 (Side)': 5,
    'Mouse X2 (Side)': 6
  };
  return map[bindKey] || null;
}

function convertToElectronAccelerator(keyname) {
  if (!keyname) return null;
  // Mouse buttons can't be Electron accelerators
  if (keyname.includes('Mouse')) return null;
  // Single letter or digit
  if (/^[A-Z0-9]$/i.test(keyname)) return keyname.toUpperCase();
  // F-keys
  if (/^F([1-9]|1[0-2])$/i.test(keyname)) return keyname.toUpperCase();
  // Common key names → Electron accelerator names
  const map = {
    'Space':'Space','Enter':'Return','Escape':'Escape','Tab':'Tab',
    'Backspace':'Backspace','Delete':'Delete','Insert':'Insert',
    'Home':'Home','End':'End','PgUp':'PageUp','PgDn':'PageDown',
    'Up':'Up','Down':'Down','Left':'Left','Right':'Right',
    'Pause':'Pause','CapsLock':'CapsLock','NumLock':'NumLock','ScrollLock':'ScrollLock',
    'Num0':'num0','Num1':'num1','Num2':'num2','Num3':'num3','Num4':'num4',
    'Num5':'num5','Num6':'num6','Num7':'num7','Num8':'num8','Num9':'num9',
    'Num*':'nummult','Num+':'numadd','Num-':'numsub','Num.':'numdec','Num/':'numdiv',
    // Left/right modifiers → Electron names (single-modifier hotkeys may still fail on some OSes)
    'LShift':'Shift','RShift':'Shift','Shift':'Shift',
    'LCtrl':'Control','RCtrl':'Control','Ctrl':'Control',
    'LAlt':'Alt','RAlt':'Alt','Alt':'Alt'
  };
  if (map[keyname]) return map[keyname];
  return null;
}

// ── All Event Bindings ───────────────────────────────────────
$('#btn-minimize').onclick = ()=>{ try{window.kyrun.minimize();}catch{} };
$('#btn-maximize').onclick = ()=>{ try{window.kyrun.maximize();}catch{} };
$('#btn-close').onclick = ()=>{ try{window.kyrun.close();}catch{} };
$('#modal-close').onclick = hideModal;
$('#modal-overlay').onclick = e=>{ if(e.target===e.currentTarget) hideModal(); };

$('#profile-dropdown').onchange = async e => {
  const name = e.target.value;
  suppressNextProfileChangedTts = true;
  try {
    await window.kyrun.switchProfile(name);
    state.currentProfile = name;
  } catch {
    suppressNextProfileChangedTts = false;
    e.target.value = state.currentProfile;
    return;
  }
  loadFileTree(); state.currentMacro=null; state.commands=[];
  $('#editor-content').classList.add('hidden'); $('#welcome-view').classList.remove('hidden');
  updateStatusBar();
  void speakProfileName(name, 'ui');
};

$('#btn-add-profile').onclick = ()=>showModal('New Profile','<input type="text" class="properties-panel__input" id="new-profile-name" placeholder="Profile name...">',[{label:'Cancel',type:'secondary',action:()=>{}},{label:'Create',type:'primary',action:async()=>{const n=document.getElementById('new-profile-name').value.trim();if(!n)return;try{await window.kyrun.createProfile(n);await window.kyrun.switchProfile(n);}catch{showToast('Could not create or switch profile','error');return;}showToast(`Profile "${n}" created`,'success');}}]);

$('#btn-rename-profile').onclick = ()=>{
  if(state.currentProfile==='Default'){showToast('Cannot rename Default','error');return;}
  showModal('Rename Profile',`<input type="text" class="properties-panel__input" id="rename-profile-name" value="${state.currentProfile}">`,[
    {label:'Cancel',type:'secondary',action:()=>{}},
    {label:'Rename',type:'primary',action:async()=>{const n=document.getElementById('rename-profile-name').value.trim();if(!n||n===state.currentProfile)return;try{await window.kyrun.renameProfile(state.currentProfile,n);state.currentProfile=n;loadProfiles();loadFileTree();showToast('Renamed','success');}catch{showToast('Rename failed','error');}}}
  ]);
};

$('#btn-delete-profile').onclick = ()=>{
  if(state.currentProfile==='Default'){showToast('Cannot delete Default','error');return;}
  showModal('Delete Profile',`<p>Delete <strong>${state.currentProfile}</strong> and all its macros?</p>`,[{label:'Cancel',type:'secondary',action:()=>{}},{label:'Delete',type:'danger',action:async()=>{try{await window.kyrun.deleteProfile(state.currentProfile);}catch{}state.currentProfile='Default';loadProfiles();loadFileTree();showToast('Deleted','info');}}]);
};

$('#btn-new-macro').onclick = $('#btn-welcome-new').onclick = ()=>showModal('New Macro','<input type="text" class="properties-panel__input" id="new-macro-name" placeholder="Macro name...">',[{label:'Cancel',type:'secondary',action:()=>{}},{label:'Create',type:'primary',action:async()=>{const n=document.getElementById('new-macro-name').value.trim();if(!n)return;try{await window.kyrun.createMacro(n);}catch{}loadFileTree();openMacro({name:n,path:`${n}.kyrun`,type:'macro'});showToast(`"${n}" created`,'success');}}]);

$('#btn-new-folder').onclick = ()=>showModal('New Folder','<input type="text" class="properties-panel__input" id="new-folder-name" placeholder="Folder name...">',[{label:'Cancel',type:'secondary',action:()=>{}},{label:'Create',type:'primary',action:async()=>{const n=document.getElementById('new-folder-name').value.trim();if(!n)return;try{await window.kyrun.createFolder(n);}catch{}loadFileTree();showToast(`Folder "${n}" created`,'success');}}]);

$('#btn-import-macro').onclick = $('#btn-welcome-import').onclick = importMacros;

// File menu
$('.titlebar__menu-item[data-action="import"]').onclick = ()=>{
  showModal('File',`<div style="display:flex;flex-direction:column;gap:8px"><button class="btn btn--secondary" id="fm-import">📥 Import Macro Files (.amc, .krm, .kyrun)</button><button class="btn btn--secondary" id="fm-export">📤 Export Current Macro</button><button class="btn btn--secondary" id="fm-save">💾 Save Current Macro</button></div>`,[{label:'Close',type:'secondary',action:()=>{}}]);
  setTimeout(()=>{
    const imp=document.getElementById('fm-import');if(imp)imp.onclick=()=>{hideModal();importMacros();};
    const exp=document.getElementById('fm-export');if(exp)exp.onclick=()=>{hideModal();exportMacro();};
    const sav=document.getElementById('fm-save');if(sav)sav.onclick=()=>{hideModal();saveMacro();};
  },50);
};

// Toolbar
$('#btn-record').onclick = ()=>{ state.isRecording?stopRecording():startRecording(); };
$('#btn-play').onclick = runMacro;
$('#btn-stop').onclick = stopMacro;
$('#btn-save').onclick = saveMacro;
$('#btn-export').onclick = exportMacro;
$('#btn-undo').onclick = undo; $('#btn-redo').onclick = redo;
$('#btn-cut').onclick = cutSelected; $('#btn-copy').onclick = copySelected; $('#btn-paste').onclick = pasteCommands;
$('#btn-move-up').onclick = ()=>moveSelected(-1); $('#btn-move-down').onclick = ()=>moveSelected(1);

$('#speed-slider').oninput = e=>{ state.speedMultiplier=parseInt(e.target.value)/100; $('#speed-value').textContent=`${e.target.value}%`; };

// Command palette (delegation — reliable when panel scrolls / repaints)
$('#editor-content').addEventListener('click', e => {
  const btn = e.target.closest('.command-palette__btn');
  if (!btn || !btn.dataset.cmd) return;
  e.preventDefault();
  e.stopPropagation();
  addCommand(btn.dataset.cmd);
});

// Macro settings
$('#loop-enabled').onchange = e=>{ state.macroSettings.loop=e.target.checked; $('#loop-count-field').style.display=e.target.checked?'block':'none'; if(state.currentMacro){state.currentMacro.dirty=true;saveMacro({silent:true,deferTriggers:true});} };
function syncHoldPassGapFieldVisibility() {
  const f = $('#hold-between-passes-field');
  const hw = $('#hold-while-pressed');
  if (f && hw) f.style.display = hw.checked ? 'block' : 'none';
}
$('#loop-count').oninput = e=>{ const v=parseInt(e.target.value,10); state.macroSettings.loopCount=Number.isFinite(v)&&v>=0?v:0; if(state.currentMacro)state.currentMacro.dirty=true; };
$('#loop-count').onchange = e=>{ const v=parseInt(e.target.value,10); state.macroSettings.loopCount=Number.isFinite(v)&&v>=0?v:0; if(state.currentMacro){state.currentMacro.dirty=true;saveMacro({silent:true,deferTriggers:true});} };
const holdWhileEl = $('#hold-while-pressed');
if (holdWhileEl) holdWhileEl.onchange = e=>{ state.macroSettings.holdWhilePressed=e.target.checked; syncHoldPassGapFieldVisibility(); if(state.currentMacro){state.currentMacro.dirty=true;saveMacro({silent:true,deferTriggers:true});} };
const holdGapEl = $('#hold-between-passes-ms');
if (holdGapEl) {
  holdGapEl.oninput = ()=>{ if(state.currentMacro)state.currentMacro.dirty=true; };
  holdGapEl.onchange = ()=>{ if(state.currentMacro){state.currentMacro.dirty=true;saveMacro({silent:true,deferTriggers:true});} };
}
$('#random-delays').onchange = e=>{ state.macroSettings.randomDelays=e.target.checked; if(state.currentMacro){state.currentMacro.dirty=true;saveMacro({silent:true,deferTriggers:true});} };
const bindSecondPressEl = $('#bind-second-press-stops');
if (bindSecondPressEl) {
  bindSecondPressEl.onchange = e => {
    state.macroSettings.bindSecondPressStops = e.target.checked;
    if (state.currentMacro) { state.currentMacro.dirty = true; saveMacro({ silent: true, deferTriggers: true }); }
  };
}
$('#bind-key-input').onclick = function() {
  this.value = 'Press a key or mouse button...';
  const self = this;
  const keyH = e => {
    e.preventDefault();
    const name = keyEventToBindLabel(e);
    self.value = name;
    state.macroSettings.bindKey = name;
    state.macroSettings.bindVk = e.keyCode;
    state.macroSettings.bindIsMouse = false;
    if (state.currentMacro) state.currentMacro.dirty = true;
    cleanup();
    if (state.currentMacro) saveMacro({ silent: true, deferTriggers: true });
  };
  const mouseH = e => {
    if (e.button === 0) return; // ignore left click (that's what opened this)
    e.preventDefault(); e.stopPropagation();
    const names = { 1:'Middle Mouse', 2:'Right Mouse', 3:'Mouse X1 (Side)', 4:'Mouse X2 (Side)' };
    const vkCodes = { 1:4, 2:2, 3:5, 4:6 }; // VK_MBUTTON=4, VK_RBUTTON=2, VK_XBUTTON1=5, VK_XBUTTON2=6
    const name = names[e.button] || `Mouse ${e.button}`;
    self.value = name;
    state.macroSettings.bindKey = name;
    state.macroSettings.bindVk = vkCodes[e.button] || e.button;
    state.macroSettings.bindIsMouse = true;
    if (state.currentMacro) state.currentMacro.dirty = true;
    cleanup();
    if (state.currentMacro) saveMacro({ silent: true, deferTriggers: true });
  };
  function cleanup() {
    document.removeEventListener('keydown', keyH);
    document.removeEventListener('mousedown', mouseH);
    delete self._bindKeyCaptureCleanup;
  }
  self._bindKeyCaptureCleanup = cleanup;
  document.addEventListener('keydown', keyH);
  document.addEventListener('mousedown', mouseH);
};
$('#bind-key-input').oncontextmenu = function(e) {
  e.preventDefault();
  if (this._bindKeyCaptureCleanup) this._bindKeyCaptureCleanup();
  if (!state.macroSettings.bindKey && !state.macroSettings.bindVk) return;
  this.value = '';
  state.macroSettings.bindKey = '';
  state.macroSettings.bindVk = 0;
  state.macroSettings.bindIsMouse = false;
  if (state.currentMacro) {
    state.currentMacro.dirty = true;
    saveMacro({ silent: true, deferTriggers: true });
  }
  showToast('Trigger key cleared', 'info');
};

// Anonymous
$('#btn-anonymous').onclick = async()=>{
  try { state.isAnonymous = await window.kyrun.toggleAnonymous(); }
  catch { state.isAnonymous = !state.isAnonymous; }
  updateStatusBar();
  showToast(`Anonymous ${state.isAnonymous ? 'enabled' : 'disabled'}`, state.isAnonymous ? 'success' : 'info');
};

// ── Settings UI ──────────────────────────────────────────────
async function renderProfileHotkeys() {
  const container = $('#profile-hotkeys-list');
  if (!container) return;
  
  try {
    const settings = await window.kyrun.getSettings();
    const hotkeys = settings.profileHotkeys || {};
    const profiles = await window.kyrun.getProfiles();
    
    let html = '';
    profiles.forEach(p => {
      const currentBind = hotkeys[p] || '';
      html += `
        <div class="settings-view__row" style="margin-bottom:8px">
          <div>
            <div class="settings-view__row-label" style="font-weight:600;color:var(--text-primary)">${p}</div>
          </div>
          <input type="text" class="properties-panel__input" style="width:140px;cursor:pointer;" 
            placeholder="Click to bind..." 
            title="Left-click to bind · Right-click to unbind"
            value="${currentBind}" 
            data-profile="${p}" readonly>
        </div>
      `;
    });
    container.innerHTML = html;
    
    // Bind click events
    container.querySelectorAll('input').forEach(input => {
      input.oncontextmenu = async e => {
        e.preventDefault();
        const profile = input.dataset.profile;
        settings.profileHotkeys = settings.profileHotkeys || {};
        if (!settings.profileHotkeys[profile]) return;
        delete settings.profileHotkeys[profile];
        input.value = '';
        mergeColorTriggerbotFormIntoSettings(settings);
        await window.kyrun.saveSettings(settings);
        scheduleReloadProfileTriggers(400);
        showToast(`Unbound ${profile}`, 'info');
      };
      input.onclick = function() {
        this.value = 'Press key/mouse...';
        const profile = this.dataset.profile;
        const self = this;
        const keyH = async e => {
          e.preventDefault();
          const name = getKeyName(e.keyCode);
          self.value = name;
          cleanup();
          await saveBind(profile, name);
        };
        const mouseH = async e => {
          if (e.button === 0) return; // ignore left click
          e.preventDefault(); e.stopPropagation();
          const names = { 1:'Middle Mouse', 2:'Right Mouse', 3:'Mouse X1 (Side)', 4:'Mouse X2 (Side)' };
          const name = names[e.button] || `Mouse ${e.button}`;
          self.value = name;
          cleanup();
          await saveBind(profile, name);
        };
        function cleanup() {
          document.removeEventListener('keydown', keyH);
          document.removeEventListener('mousedown', mouseH);
        }
        async function saveBind(prof, n) {
          settings.profileHotkeys = settings.profileHotkeys || {};
          settings.profileHotkeys[prof] = n;
          mergeColorTriggerbotFormIntoSettings(settings);
          await window.kyrun.saveSettings(settings);
          scheduleReloadProfileTriggers(400);
          showToast(`Bound ${n} to ${prof}`, 'success');
        }
        document.addEventListener('keydown', keyH);
        document.addEventListener('mousedown', mouseH);
      };
    });
  } catch {}
}

function syncTriggersToggleBindUi() {
  const en = $('#setting-triggers-toggle-enabled');
  const bind = $('#setting-triggers-toggle-bind');
  if (bind) bind.disabled = !!(en && !en.checked);
}

function syncColorTriggerbotToggleBindUi() {
  const en = $('#setting-color-trigger-toggle-enabled');
  const bind = $('#setting-color-trigger-toggle-bind');
  if (bind) bind.disabled = !!(en && !en.checked);
}

function syncColorTriggerbotEnabledUi(data) {
  const active = !!(data && data.active);
  const enabled = data && data.enabled != null ? !!data.enabled : active;
  updateColorTriggerTitlebar(active, enabled);
  const cte = $('#setting-color-trigger-enabled');
  if (cte) cte.checked = enabled;
}

function rgbToHsvClient(r, g, b) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  const s = max === 0 ? 0 : d / max;
  const v = max;
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
    else if (max === gn) h = ((bn - rn) / d + 2) / 6;
    else h = ((rn - gn) / d + 4) / 6;
  }
  return {
    h: Math.round(h * 179),
    s: Math.round(s * 255),
    v: Math.round(v * 255)
  };
}

function parseHexColorClient(hex) {
  const raw = String(hex ?? '').trim().replace(/^#/, '');
  if (!/^[\da-fA-F]{6}$/.test(raw)) return null;
  return {
    r: parseInt(raw.slice(0, 2), 16),
    g: parseInt(raw.slice(2, 4), 16),
    b: parseInt(raw.slice(4, 6), 16)
  };
}

function syncColorTriggerbotPanels() {
  const sourceEl = $('#setting-color-trigger-source');
  const source = sourceEl ? sourceEl.value : 'preset';
  const preset = $('#color-trigger-preset-panel');
  const rgb = $('#color-trigger-rgb-panel');
  const hsv = $('#color-trigger-hsv-panel');
  const tolRow = $('#color-trigger-tolerance-row');
  if (preset) preset.hidden = source !== 'preset' && source !== 'mixed';
  if (rgb) rgb.hidden = source !== 'customRgb' && source !== 'mixed';
  if (hsv) hsv.hidden = source !== 'customHsv';
  if (tolRow) tolRow.hidden = source !== 'preset' && source !== 'customRgb' && source !== 'mixed';
  const holdOn = !!($('#setting-color-trigger-hold')?.checked);
  const clickPanel = $('#color-trigger-click-panel');
  if (clickPanel) clickPanel.hidden = holdOn;
  const aimbotOn = !!($('#setting-color-trigger-aimbot')?.checked);
  const aimbotPanel = $('#color-trigger-aimbot-panel');
  if (aimbotPanel) aimbotPanel.hidden = !aimbotOn;
  const predOn = !!($('#setting-color-trigger-prediction')?.checked);
  const predPanel = $('#color-trigger-prediction-panel');
  if (predPanel) predPanel.hidden = !aimbotOn || !predOn;
  syncColorTriggerDebugPanel();
  syncColorTriggerbotToggleBindUi();
}

function syncColorTriggerDebugPanel() {
  const debugOn = !!($('#setting-color-trigger-debug')?.checked);
  const panel = $('#color-trigger-debug-panel');
  if (panel) panel.hidden = !debugOn;
}

function formatColorTriggerDebug(data) {
  if (!data) return 'No data';
  const lines = [];
  const ts = data.ts ? new Date(data.ts).toLocaleTimeString() : '';
  if (ts) lines.push(`[${ts}]`);
  if (data.startupProbe) lines.push('— startup probe —');
  if (data.fired) lines.push('FIRED action');
  if (data.skipped) lines.push(`Skipped: ${data.skipped}`);
  if (data.error) lines.push(`Error: ${data.error}`);
  if (data.fireError) lines.push(`Fire error: ${data.fireError}`);
  if (data.captureOk === false) lines.push('Capture: FAILED');
  else if (data.captureOk === true) lines.push('Capture: OK');
  if (data.region) {
    const r = data.region;
    const centerMode = r.centerOnScreen ? 'screen center' : 'mouse cursor';
    lines.push(`Region: ${r.left},${r.top} ${r.width}x${r.height} (screen ${r.screenWidth}x${r.screenHeight} @${r.scaleFactor}x)`);
    lines.push(`FOV center: ${centerMode} (${r.centerX},${r.centerY})`);
  }
  if (data.centerOnScreen != null) lines.push(`Center on screen: ${data.centerOnScreen ? 'yes' : 'no'}`);
  if (data.centerHex != null) {
    const hsv = data.centerHsv;
    const hsvTxt = hsv ? ` HSV ${hsv.h},${hsv.s},${hsv.v}` : '';
    lines.push(`Center pixel: #${data.centerHex}${hsvTxt} match=${!!data.centerMatch}`);
  }
  if (data.matchCount != null) lines.push(`Matching pixels: ${data.matchCount}`);
  if (data.minDist != null && data.minDist >= 0) lines.push(`Closest match: ${data.minDist.toFixed(1)}px`);
  else if (data.minDist === -1) lines.push('Closest match: none');
  if (data.triggerDistance != null) lines.push(`Trigger distance: ${data.triggerDistance}px`);
  if (data.wouldTrigger != null) lines.push(`Would trigger: ${data.wouldTrigger ? 'YES' : 'no'}`);
  if (data.macroRunning) lines.push('Macro running: yes (trigger blocked)');
  if (data.action) lines.push(`Action: ${data.action}`);
  if (data.holdWhileOnTarget != null) lines.push(`Hold on target: ${data.holdWhileOnTarget ? 'yes' : 'no'}`);
  if (data.clickMode) lines.push(`Click mode: ${data.clickMode}`);
  if (data.aimbotEnabled != null) lines.push(`Aimbot: ${data.aimbotEnabled ? 'on' : 'off'}`);
  if (data.aimMoved) lines.push('Aim: moved toward target');
  if (data.aimDelta) lines.push(`Aim delta: ${data.aimDelta.x},${data.aimDelta.y}`);
  if (data.aimTarget) lines.push(`Aim toward: ${data.aimTarget.x},${data.aimTarget.y}`);
  if (data.aimPredicted) lines.push('Aim: using movement prediction');
  if (data.aimRawPx != null) lines.push(`Aim raw centroid: ${data.aimRawPx},${data.aimRawPy}`);
  if (data.aimPredPx != null) lines.push(`Aim predicted: ${data.aimPredPx},${data.aimPredPy}`);
  if (data.aimVelocity) {
    lines.push(`Aim velocity px/ms: ${Number(data.aimVelocity.vx).toFixed(3)},${Number(data.aimVelocity.vy).toFixed(3)}`);
  }
  if (data.clickQueued) lines.push('Click: queued (down, up after hold)');
  if (data.clickHoldMs != null) lines.push(`Click hold: ${data.clickHoldMs}ms`);
  if (data.cooldownMs != null) lines.push(`Cooldown: ${data.cooldownMs}ms`);
  if (data.msSinceLastAction != null) lines.push(`Ms since last action: ${data.msSinceLastAction}`);
  if (data.buttonHeld) lines.push(`Button held: ${data.buttonHeld}`);
  if (data.holdPressed) lines.push('Hold: pressed');
  if (data.holdReleased) lines.push('Hold: released');
  if (data.fallbackCenterHex) lines.push(`GetPixel fallback center: #${data.fallbackCenterHex}`);
  if (data.source) lines.push(`Color source: ${data.source}`);
  if (data.preset) {
    const p = Array.isArray(data.preset) ? data.preset.join(', ') : data.preset;
    lines.push(`Presets: ${p}${data.tolerance != null ? ` tolerance=${data.tolerance}` : ''}`);
  }
  if (data.targetColor != null) {
    const c = Array.isArray(data.targetColor) ? data.targetColor.map(x => `#${x}`).join(', ') : `#${data.targetColor}`;
    lines.push(`Target RGB: ${c} tol=${data.tolerance} valid=${data.targetColorValid !== false}`);
  }
  if (data.hsvLower) {
    lines.push((data.preset ? 'Effective preset HSV min' : 'HSV lower') + `: ${data.hsvLower.join(',')}`);
  }
  if (data.hsvUpper) {
    lines.push((data.preset ? 'Effective preset HSV max' : 'HSV upper') + `: ${data.hsvUpper.join(',')}`);
  }
  return lines.join('\n') || JSON.stringify(data, null, 2);
}

function appendColorTriggerDebugLog(data) {
  const log = $('#color-trigger-debug-log');
  if (!log) return;
  const block = formatColorTriggerDebug(data);
  const prev = log.textContent === 'Enable debug or click Probe now.' ? '' : log.textContent + '\n\n';
  const combined = (prev + block).split('\n\n');
  log.textContent = combined.slice(-12).join('\n\n');
  log.scrollTop = log.scrollHeight;
}

async function applyColorTriggerHexFromPicker(hex, { fillHsv = false } = {}) {
  const rgb = parseHexColorClient(hex);
  if (!rgb) {
    showToast('Invalid color', 'error');
    return;
  }
  const settings = await window.kyrun.getSettings();
  if (fillHsv) {
    const { h, s, v } = rgbToHsvClient(rgb.r, rgb.g, rgb.b);
    settings.colorTriggerbotHsvLower = [Math.max(0, h - 5), Math.max(0, s - 40), Math.max(0, v - 30)];
    settings.colorTriggerbotHsvUpper = [Math.min(179, h + 5), Math.min(255, s + 40), Math.min(255, v + 30)];
    const h0 = $('#setting-color-trigger-h0');
    const s0 = $('#setting-color-trigger-s0');
    const v0 = $('#setting-color-trigger-v0');
    const h1 = $('#setting-color-trigger-h1');
    const s1 = $('#setting-color-trigger-s1');
    const v1 = $('#setting-color-trigger-v1');
    if (h0) h0.value = settings.colorTriggerbotHsvLower[0];
    if (s0) s0.value = settings.colorTriggerbotHsvLower[1];
    if (v0) v0.value = settings.colorTriggerbotHsvLower[2];
    if (h1) h1.value = settings.colorTriggerbotHsvUpper[0];
    if (s1) s1.value = settings.colorTriggerbotHsvUpper[1];
    if (v1) v1.value = settings.colorTriggerbotHsvUpper[2];
  } else {
    settings.colorTriggerbotColor = hex.toUpperCase();
    const colorEl = $('#setting-color-trigger-color');
    if (colorEl) colorEl.value = hex.toUpperCase();
  }
  readColorTriggerbotFromForm(settings);
    await window.kyrun.saveSettings(settings);
    setColorTriggerbotSaveStatus('saved');
    showToast(fillHsv ? `HSV range set from #${hex}` : `Color #${hex} saved`, 'success');
}

function openColorTriggerScreenshotPicker(capture, { fillHsv = false, onPick = null } = {}) {
  if (!capture?.imageDataUrl) {
    showToast('Screenshot capture failed', 'error');
    return;
  }
  showModal(
    'Pick color for triggerbot',
    `<div class="screen-picker">
      <p class="screen-picker__hint">Click the enemy/outline color on this frozen screenshot.</p>
      <div class="screen-picker__meta">
        <div><strong>Hover:</strong> <span id="screen-picker-hover">Move over the image</span></div>
        <div style="display:flex;align-items:center;gap:8px"><strong>Color:</strong> <span class="screen-picker__swatch" id="screen-picker-swatch"></span> <code id="screen-picker-color">------</code></div>
      </div>
      <div class="screen-picker__viewport">
        <img id="screen-picker-image" class="screen-picker__image" src="${capture.imageDataUrl}" alt="Captured screen" draggable="false">
      </div>
    </div>`,
    [{ label: 'Cancel', type: 'secondary', action: () => {} }]
  );
  setModalPresentation({ width: 'min(96vw, 1100px)', maxWidth: 'min(96vw, 1100px)', maxHeight: '92vh' });

  setTimeout(() => {
    const img = document.getElementById('screen-picker-image');
    const hover = document.getElementById('screen-picker-hover');
    const swatch = document.getElementById('screen-picker-swatch');
    const colorText = document.getElementById('screen-picker-color');
    if (!img || !hover || !swatch || !colorText) return;

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    let imageReady = false;

    const paintImage = () => {
      if (!ctx || !img.naturalWidth || !img.naturalHeight) return;
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      ctx.drawImage(img, 0, 0);
      imageReady = true;
    };

    const sampleFromEvent = e => {
      if (!imageReady || !ctx) return null;
      const rect = img.getBoundingClientRect();
      if (!rect.width || !rect.height) return null;
      const relX = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
      const relY = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
      const pixelX = Math.min(img.naturalWidth - 1, Math.max(0, Math.floor(relX * img.naturalWidth)));
      const pixelY = Math.min(img.naturalHeight - 1, Math.max(0, Math.floor(relY * img.naturalHeight)));
      const [r, g, b] = ctx.getImageData(pixelX, pixelY, 1, 1).data;
      const hex = [r, g, b].map(n => n.toString(16).padStart(2, '0')).join('').toUpperCase();
      return { pixelX, pixelY, hex };
    };

    const updatePreview = e => {
      const sample = sampleFromEvent(e);
      if (!sample) return;
      hover.textContent = `Pixel ${sample.pixelX}, ${sample.pixelY}`;
      swatch.style.background = `#${sample.hex}`;
      colorText.textContent = `#${sample.hex}`;
    };

    const onClick = async e => {
      const sample = sampleFromEvent(e);
      if (!sample) return;
      hideModal();
      if (onPick) {
        onPick(sample.hex);
      } else {
        await applyColorTriggerHexFromPicker(sample.hex, { fillHsv });
      }
    };

    const cleanup = () => {
      img.removeEventListener('mousemove', updatePreview);
      img.removeEventListener('click', onClick);
      img.removeEventListener('load', paintImage);
    };
    setModalCleanup(cleanup);
    img.addEventListener('mousemove', updatePreview);
    img.addEventListener('click', onClick);
    img.addEventListener('load', paintImage);
    if (img.complete) paintImage();
  }, 0);
}

async function pickColorTriggerFromScreenshot({ fillHsv = false } = {}) {
  try {
    const capture = await window.kyrun.captureScreenFrame();
    if (!capture?.success) {
      showToast(capture?.error || 'Screenshot capture failed', 'error');
      return;
    }
    openColorTriggerScreenshotPicker(capture, { fillHsv });
  } catch {
    showToast('Screenshot capture failed', 'error');
  }
}

async function runColorTriggerProbe() {
  const panel = $('#color-trigger-debug-panel');
  if (panel) panel.hidden = false;
  try {
    await saveColorTriggerbotSettings();
    const result = await window.kyrun.probeColorTriggerbot();
    appendColorTriggerDebugLog({ ts: Date.now(), ...result });
    if (result.ok && result.wouldTrigger) {
      showToast('Probe: would trigger now', 'success');
    } else if (result.ok) {
      showToast('Probe: scan OK but no trigger (check color/distance)', 'info');
    } else {
      showToast(result.error || 'Probe failed', 'error');
    }
  } catch (e) {
    showToast('Probe failed', 'error');
  }
}

const COLOR_TRIGGERBOT_PROFILE_KEYS = [
  'colorTriggerbotSource',
  'colorTriggerbotPreset',
  'colorTriggerbotColor',
  'colorTriggerbotTolerance',
  'colorTriggerbotHsvLower',
  'colorTriggerbotHsvUpper',
  'colorTriggerbotFov',
  'colorTriggerbotCenterOnScreen',
  'colorTriggerbotDistance',
  'colorTriggerbotPollMs',
  'colorTriggerbotCooldownMs',
  'colorTriggerbotClickHoldMs',
  'colorTriggerbotClickMode',
  'colorTriggerbotAction',
  'colorTriggerbotHoldWhileOnTarget',
  'colorTriggerbotAimbotEnabled',
  'colorTriggerbotAimSpeed',
  'colorTriggerbotAimMaxStep',
  'colorTriggerbotAimOffsetX',
  'colorTriggerbotAimOffsetY',
  'colorTriggerbotPredictionEnabled',
  'colorTriggerbotPredictionLeadMs',
  'colorTriggerbotPredictionMaxLeadPx',
  'colorTriggerbotPredictionSmooth',
  'colorTriggerbotDebug'
];

let colorbotProfileSelectSyncing = false;

function extractColorTriggerbotProfileFromSettings(settings) {
  const out = {};
  for (const k of COLOR_TRIGGERBOT_PROFILE_KEYS) {
    if (settings[k] !== undefined) out[k] = settings[k];
  }
  if (Array.isArray(out.colorTriggerbotHsvLower)) {
    out.colorTriggerbotHsvLower = [...out.colorTriggerbotHsvLower];
  }
  if (Array.isArray(out.colorTriggerbotHsvUpper)) {
    out.colorTriggerbotHsvUpper = [...out.colorTriggerbotHsvUpper];
  }
  return out;
}

function applyColorTriggerbotProfileToSettings(settings, profileName) {
  const profiles = settings.colorTriggerbotProfiles;
  if (!profiles || !profileName) return;
  const p = profiles[profileName];
  if (!p) return;
  for (const k of COLOR_TRIGGERBOT_PROFILE_KEYS) {
    if (p[k] !== undefined) settings[k] = p[k];
  }
  if (Array.isArray(settings.colorTriggerbotHsvLower)) {
    settings.colorTriggerbotHsvLower = [...settings.colorTriggerbotHsvLower];
  }
  if (Array.isArray(settings.colorTriggerbotHsvUpper)) {
    settings.colorTriggerbotHsvUpper = [...settings.colorTriggerbotHsvUpper];
  }
}

function sanitizeColorbotProfileName(name) {
  return String(name || '').trim().slice(0, 48);
}

function resolveColorbotProfileKey(profiles, name) {
  if (!profiles || !name) return null;
  if (profiles[name]) return name;
  const want = sanitizeColorbotProfileName(name);
  for (const key of Object.keys(profiles)) {
    if (sanitizeColorbotProfileName(key) === want) return key;
  }
  return null;
}

function syncColorTriggerbotProfileSelect(settings) {
  const sel = $('#setting-color-trigger-profile');
  if (!sel) return;
  const profiles = settings.colorTriggerbotProfiles || {};
  const active = settings.colorTriggerbotActiveProfile || 'Default';
  const names = Object.keys(profiles).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  colorbotProfileSelectSyncing = true;
  sel.innerHTML = '';
  for (const n of names) {
    const opt = document.createElement('option');
    opt.value = n;
    opt.textContent = n;
    if (n === active) opt.selected = true;
    sel.appendChild(opt);
  }
  if (!names.length) {
    const opt = document.createElement('option');
    opt.value = 'Default';
    opt.textContent = 'Default';
    opt.selected = true;
    sel.appendChild(opt);
  }
  colorbotProfileSelectSyncing = false;
}

function persistCurrentColorbotProfileInSettings(settings) {
  readColorTriggerbotFromForm(settings);
  const profiles = { ...(settings.colorTriggerbotProfiles || {}) };
  const active = settings.colorTriggerbotActiveProfile || 'Default';
  profiles[active] = extractColorTriggerbotProfileFromSettings(settings);
  settings.colorTriggerbotProfiles = profiles;
}

async function switchColorbotProfile(name) {
  const next = sanitizeColorbotProfileName(name);
  if (!next) return;
  try {
    const settings = await window.kyrun.getSettings();
    const profiles = settings.colorTriggerbotProfiles || {};
    const nextKey = resolveColorbotProfileKey(profiles, next);
    if (!nextKey) {
      showToast('Profile not found', 'error');
      return;
    }
    if (settings.colorTriggerbotActiveProfile === nextKey) return;
    persistCurrentColorbotProfileInSettings(settings);
    settings.colorTriggerbotActiveProfile = nextKey;
    applyColorTriggerbotProfileToSettings(settings, nextKey);
    loadColorTriggerbotToForm(settings);
    await saveColorTriggerbotSettings({ toast: false, baseSettings: settings });
    showToast(`Colorbot profile: ${nextKey}`, 'info');
  } catch {
    showToast('Failed to switch colorbot profile', 'error');
  }
}

function showNewColorbotProfileModal() {
  showModal(
    'New colorbot profile',
    '<input type="text" class="properties-panel__input" id="new-colorbot-profile-name" placeholder="Character name…" maxlength="48">',
    [
      { label: 'Cancel', type: 'secondary', action: () => {} },
      {
        label: 'Create',
        type: 'primary',
        action: () => { void createColorbotProfileFromModal(); }
      }
    ]
  );
  setTimeout(() => document.getElementById('new-colorbot-profile-name')?.focus(), 50);
}

async function createColorbotProfileFromModal() {
  const name = sanitizeColorbotProfileName(document.getElementById('new-colorbot-profile-name')?.value);
  if (!name) return;
  try {
    const settings = await window.kyrun.getSettings();
    persistCurrentColorbotProfileInSettings(settings);
    const profiles = { ...(settings.colorTriggerbotProfiles || {}) };
    if (profiles[name]) {
      showToast('Profile already exists', 'error');
      return;
    }
    profiles[name] = extractColorTriggerbotProfileFromSettings(settings);
    settings.colorTriggerbotProfiles = profiles;
    settings.colorTriggerbotActiveProfile = name;
    loadColorTriggerbotToForm(settings);
    await saveColorTriggerbotSettings({ toast: false, baseSettings: settings });
    showToast(`Created colorbot profile "${name}"`, 'success');
  } catch {
    showToast('Could not create profile', 'error');
  }
}

function showRenameColorbotProfileModal() {
  const sel = $('#setting-color-trigger-profile');
  const current = sel?.value || 'Default';
  showModal(
    'Rename colorbot profile',
    `<input type="text" class="properties-panel__input" id="rename-colorbot-profile-name" value="${escapeHtml(current)}" maxlength="48">`,
    [
      { label: 'Cancel', type: 'secondary', action: () => {} },
      {
        label: 'Rename',
        type: 'primary',
        action: () => { void renameColorbotProfileFromModal(); }
      }
    ]
  );
  setTimeout(() => {
    const input = document.getElementById('rename-colorbot-profile-name');
    if (input) {
      input.focus();
      input.select();
    }
  }, 50);
}

async function renameColorbotProfileFromModal() {
  const sel = $('#setting-color-trigger-profile');
  const oldName = sel?.value || 'Default';
  const name = sanitizeColorbotProfileName(document.getElementById('rename-colorbot-profile-name')?.value);
  if (!name || name === oldName) return;
  try {
    const settings = await window.kyrun.getSettings();
    const profiles = { ...(settings.colorTriggerbotProfiles || {}) };
    const oldKey = resolveColorbotProfileKey(profiles, oldName);
    if (!oldKey) {
      showToast('Profile not found', 'error');
      return;
    }
    if (profiles[name] && name !== oldKey) {
      showToast('Profile name already in use', 'error');
      return;
    }
    settings.colorTriggerbotActiveProfile = oldKey;
    persistCurrentColorbotProfileInSettings(settings);
    const nextProfiles = { ...(settings.colorTriggerbotProfiles || {}) };
    nextProfiles[name] = nextProfiles[oldKey];
    delete nextProfiles[oldKey];
    settings.colorTriggerbotProfiles = nextProfiles;
    settings.colorTriggerbotActiveProfile = name;
    loadColorTriggerbotToForm(settings);
    await saveColorTriggerbotSettings({ toast: false, baseSettings: settings });
    showToast(`Renamed to "${name}"`, 'success');
  } catch {
    showToast('Could not rename profile', 'error');
  }
}

async function duplicateColorbotProfile() {
  const sel = $('#setting-color-trigger-profile');
  const base = sel?.value || 'Default';
  const suffix = ' copy';
  try {
    const settings = await window.kyrun.getSettings();
    persistCurrentColorbotProfileInSettings(settings);
    const profiles = { ...(settings.colorTriggerbotProfiles || {}) };
    const baseKey = resolveColorbotProfileKey(profiles, base) || base;
    const source = profiles[baseKey] || extractColorTriggerbotProfileFromSettings(settings);
    let name = sanitizeColorbotProfileName(base + suffix);
    let i = 2;
    while (profiles[name]) {
      name = sanitizeColorbotProfileName(`${base}${suffix} ${i}`);
      i += 1;
    }
    profiles[name] = JSON.parse(JSON.stringify(source));
    settings.colorTriggerbotProfiles = profiles;
    settings.colorTriggerbotActiveProfile = name;
    applyColorTriggerbotProfileToSettings(settings, name);
    loadColorTriggerbotToForm(settings);
    await saveColorTriggerbotSettings({ toast: false, baseSettings: settings });
    showToast(`Duplicated as "${name}"`, 'success');
  } catch {
    showToast('Could not duplicate profile', 'error');
  }
}

async function deleteColorbotProfile() {
  const sel = $('#setting-color-trigger-profile');
  const name = sel?.value;
  if (!name) return;
  try {
    const settings = await window.kyrun.getSettings();
    const profiles = { ...(settings.colorTriggerbotProfiles || {}) };
    const names = Object.keys(profiles);
    const key = resolveColorbotProfileKey(profiles, name);
    if (!key) {
      showToast('Profile not found', 'error');
      return;
    }
    if (names.length <= 1) {
      showToast('Cannot delete the only profile', 'error');
      return;
    }
    delete profiles[key];
    settings.colorTriggerbotProfiles = profiles;
    if (settings.colorTriggerbotActiveProfile === key) {
      const next = names.find(n => n !== key) || Object.keys(profiles)[0];
      settings.colorTriggerbotActiveProfile = next;
      applyColorTriggerbotProfileToSettings(settings, next);
    }
    loadColorTriggerbotToForm(settings);
    await saveColorTriggerbotSettings({ toast: false, baseSettings: settings });
    showToast(`Deleted profile "${name}"`, 'info');
  } catch {
    showToast('Could not delete profile', 'error');
  }
}

function loadColorTriggerbotToForm(s) {
  const cte = $('#setting-color-trigger-enabled');
  const cts = $('#setting-color-trigger-source');
  const ctp = $('#setting-color-trigger-preset');
  const ctc = $('#setting-color-trigger-color');
  const ctt = $('#setting-color-trigger-tolerance');
  const cth0 = $('#setting-color-trigger-h0');
  const cts0 = $('#setting-color-trigger-s0');
  const ctv0 = $('#setting-color-trigger-v0');
  const cth1 = $('#setting-color-trigger-h1');
  const cts1 = $('#setting-color-trigger-s1');
  const ctv1 = $('#setting-color-trigger-v1');
  const ctf = $('#setting-color-trigger-fov');
  const ctcs = $('#setting-color-trigger-center-screen');
  const ctd = $('#setting-color-trigger-distance');
  const ctpl = $('#setting-color-trigger-poll');
  const ctcd = $('#setting-color-trigger-cooldown');
  const ctch = $('#setting-color-trigger-click-hold');
  const ctcm = $('#setting-color-trigger-click-mode');
  const ctaim = $('#setting-color-trigger-aimbot');
  const ctas = $('#setting-color-trigger-aim-speed');
  const ctams = $('#setting-color-trigger-aim-max-step');
  const ctaox = $('#setting-color-trigger-aim-offset-x');
  const ctaoy = $('#setting-color-trigger-aim-offset-y');
  const ctpred = $('#setting-color-trigger-prediction');
  const ctplead = $('#setting-color-trigger-prediction-lead');
  const ctpmax = $('#setting-color-trigger-prediction-max');
  const cta = $('#setting-color-trigger-action');
  const ctdbg = $('#setting-color-trigger-debug');
  const cthold = $('#setting-color-trigger-hold');
  const cttoe = $('#setting-color-trigger-toggle-enabled');
  const cttob = $('#setting-color-trigger-toggle-bind');
  if (cts) cts.value = s.colorTriggerbotSource || 'preset';

  // Presets (Multiple)
  let presets = s.colorTriggerbotPreset || ['bluegreen'];
  if (!Array.isArray(presets)) presets = [presets];
  document.querySelectorAll('.setting-color-trigger-preset-check').forEach(el => {
    el.checked = presets.includes(el.value);
  });

  // Custom RGB (Multiple)
  let colors = s.colorTriggerbotColor || ['FF0000'];
  if (!Array.isArray(colors)) colors = [colors];
  const rgbList = $('#color-trigger-rgb-list');
  if (rgbList) {
    rgbList.innerHTML = '';
    colors.forEach((hex, idx) => {
      const row = document.createElement('div');
      row.className = 'color-triggerbot-rgb-row';
      row.style.display = 'flex';
      row.style.gap = '6px';
      row.style.alignItems = 'center';
      row.style.marginBottom = '8px';
      row.innerHTML = `
        <input type="text" class="properties-panel__input setting-color-trigger-color" style="width:75px" maxlength="6" value="${hex.replace(/^#/, '')}">
        <button type="button" class="btn btn--secondary btn-color-trigger-pick-rgb" title="Pick from cursor" style="padding: 4px 8px;">Pick</button>
        <button type="button" class="btn btn--secondary btn-color-trigger-pick-rgb-shot" title="Pick from screenshot" style="padding: 4px 8px;">Shot</button>
        ${idx === 0 
          ? '<button type="button" class="btn btn--secondary btn-color-trigger-add-rgb" style="padding: 4px 8px; font-weight: bold;">+</button>' 
          : '<button type="button" class="btn btn--secondary btn-color-trigger-remove-rgb" style="padding: 4px 8px; font-weight: bold;">-</button>'}
      `;
      rgbList.appendChild(row);
    });
    wireColorTriggerRgbRowEvents(rgbList);
  }

  if (ctt) ctt.value = s.colorTriggerbotTolerance != null ? s.colorTriggerbotTolerance : 10;
  const lo = s.colorTriggerbotHsvLower || [80, 40, 225];
  const hi = s.colorTriggerbotHsvUpper || [90, 100, 255];
  if (cth0) cth0.value = lo[0];
  if (cts0) cts0.value = lo[1];
  if (ctv0) ctv0.value = lo[2];
  if (cth1) cth1.value = hi[0];
  if (cts1) cts1.value = hi[1];
  if (ctv1) ctv1.value = hi[2];
  if (ctf) ctf.value = s.colorTriggerbotFov != null ? s.colorTriggerbotFov : 120;
  if (ctcs) ctcs.checked = !!s.colorTriggerbotCenterOnScreen;
  if (ctd) ctd.value = s.colorTriggerbotDistance != null ? s.colorTriggerbotDistance : 25;
  if (ctpl) ctpl.value = s.colorTriggerbotPollMs != null ? s.colorTriggerbotPollMs : 16;
  if (ctcd) ctcd.value = s.colorTriggerbotCooldownMs != null ? s.colorTriggerbotCooldownMs : 50;
  if (ctch) ctch.value = s.colorTriggerbotClickHoldMs != null ? s.colorTriggerbotClickHoldMs : 50;
  if (ctcm) ctcm.value = s.colorTriggerbotClickMode || 'single';
  if (ctaim) ctaim.checked = !!s.colorTriggerbotAimbotEnabled;
  if (ctas) ctas.value = s.colorTriggerbotAimSpeed != null ? s.colorTriggerbotAimSpeed : 0.35;
  if (ctams) ctams.value = s.colorTriggerbotAimMaxStep != null ? s.colorTriggerbotAimMaxStep : 40;
  if (ctaox) ctaox.value = s.colorTriggerbotAimOffsetX != null ? s.colorTriggerbotAimOffsetX : 0;
  if (ctaoy) ctaoy.value = s.colorTriggerbotAimOffsetY != null ? s.colorTriggerbotAimOffsetY : 0;
  if (ctpred) ctpred.checked = !!s.colorTriggerbotPredictionEnabled;
  if (ctplead) ctplead.value = s.colorTriggerbotPredictionLeadMs != null ? s.colorTriggerbotPredictionLeadMs : 50;
  if (ctpmax) ctpmax.value = s.colorTriggerbotPredictionMaxLeadPx != null ? s.colorTriggerbotPredictionMaxLeadPx : 80;
  if (cta) cta.value = s.colorTriggerbotAction || 'leftClick';
  if (cthold) cthold.checked = !!s.colorTriggerbotHoldWhileOnTarget;
  if (ctdbg) ctdbg.checked = !!s.colorTriggerbotDebug;
  if (cttoe) cttoe.checked = !!s.colorTriggerbotToggleBindEnabled;
  if (cttob) cttob.value = s.colorTriggerbotToggleBindKey || '';
  syncColorTriggerbotProfileSelect(s);
  syncColorTriggerbotPanels();
}

function wireColorTriggerRgbRowEvents(container) {
  container.querySelectorAll('.btn-color-trigger-add-rgb').forEach(btn => {
    btn.onclick = () => {
      const row = document.createElement('div');
      row.className = 'color-triggerbot-rgb-row';
      row.style.display = 'flex';
      row.style.gap = '6px';
      row.style.alignItems = 'center';
      row.style.marginBottom = '8px';
      row.innerHTML = `
        <input type="text" class="properties-panel__input setting-color-trigger-color" style="width:75px" maxlength="6" placeholder="FF0000">
        <button type="button" class="btn btn--secondary btn-color-trigger-pick-rgb" title="Pick from cursor" style="padding: 4px 8px;">Pick</button>
        <button type="button" class="btn btn--secondary btn-color-trigger-pick-rgb-shot" title="Pick from screenshot" style="padding: 4px 8px;">Shot</button>
        <button type="button" class="btn btn--secondary btn-color-trigger-remove-rgb" style="padding: 4px 8px; font-weight: bold;">-</button>
      `;
      container.appendChild(row);
      wireColorTriggerRgbRowEvents(container);
      void saveColorTriggerbotSettings({ toast: false });
    };
  });
  container.querySelectorAll('.btn-color-trigger-remove-rgb').forEach(btn => {
    btn.onclick = () => {
      btn.closest('.color-triggerbot-rgb-row').remove();
      void saveColorTriggerbotSettings({ toast: false });
    };
  });
  container.querySelectorAll('.setting-color-trigger-color').forEach(el => {
    el.onchange = () => { void saveColorTriggerbotSettings({ toast: false }); };
    el.oninput = () => scheduleColorTriggerbotSave();
  });
  container.querySelectorAll('.btn-color-trigger-pick-rgb').forEach(btn => {
    btn.onclick = async () => {
      const input = btn.closest('.color-triggerbot-rgb-row').querySelector('.setting-color-trigger-color');
      await pickColorForInput(input, { fillHsv: false });
    };
  });
  container.querySelectorAll('.btn-color-trigger-pick-rgb-shot').forEach(btn => {
    btn.onclick = async () => {
      const input = btn.closest('.color-triggerbot-rgb-row').querySelector('.setting-color-trigger-color');
      await pickColorFromScreenshotForInput(input, { fillHsv: false });
    };
  });
}

async function pickColorForInput(input, { fillHsv = false } = {}) {
  if (!state.hasRobot) {
    showToast('Native input required to pick colors', 'error');
    return;
  }
  showToast('Move cursor to target pixel, then wait…', 'info');
  await new Promise(r => setTimeout(r, 1200));
  try {
    const pos = await window.kyrun.getMousePosition();
    const hex = await window.kyrun.getPixelColor(pos.x, pos.y);
    if (input) input.value = hex.replace(/^#/, '').toUpperCase();
    if (fillHsv) {
      await applyColorTriggerHexFromPicker(hex, { fillHsv: true });
    }
    void saveColorTriggerbotSettings({ toast: false });
  } catch {
    showToast('Screen capture failed', 'error');
  }
}

async function pickColorFromScreenshotForInput(input, { fillHsv = false } = {}) {
  try {
    const capture = await window.kyrun.captureScreenFrame();
    if (!capture?.success) {
      showToast(capture?.error || 'Screenshot capture failed', 'error');
      return;
    }
    openColorTriggerScreenshotPicker(capture, { 
      fillHsv, 
      onPick: (hex) => {
        if (input) input.value = hex.replace(/^#/, '').toUpperCase();
        void saveColorTriggerbotSettings({ toast: false });
      }
    });
  } catch {
    showToast('Screenshot capture failed', 'error');
  }
}

async function refreshColorTriggerbotEnabledFromMain() {
  try {
    const ct = await window.kyrun.getColorTriggerbotState();
    syncColorTriggerbotEnabledUi(ct);
  } catch {
    syncColorTriggerbotEnabledUi({ active: false, enabled: false });
  }
}

/** Call before save-settings IPC so unrelated saves do not wipe the active colorbot profile with stale disk snapshot. */
function mergeColorTriggerbotFormIntoSettings(settings) {
  try {
    if (!settings || typeof settings !== 'object') return;
    readColorTriggerbotFromForm(settings);
  } catch (_) {}
}

function readColorTriggerbotFromForm(settings) {
  const en = $('#setting-color-trigger-enabled');
  const src = $('#setting-color-trigger-source');
  const tol = $('#setting-color-trigger-tolerance');
  const h0 = $('#setting-color-trigger-h0');
  const s0 = $('#setting-color-trigger-s0');
  const v0 = $('#setting-color-trigger-v0');
  const h1 = $('#setting-color-trigger-h1');
  const s1 = $('#setting-color-trigger-s1');
  const v1 = $('#setting-color-trigger-v1');
  const fov = $('#setting-color-trigger-fov');
  const centerScreen = $('#setting-color-trigger-center-screen');
  const dist = $('#setting-color-trigger-distance');
  const poll = $('#setting-color-trigger-poll');
  const cd = $('#setting-color-trigger-cooldown');
  const clickMode = $('#setting-color-trigger-click-mode');
  const aimbot = $('#setting-color-trigger-aimbot');
  const aimSpeed = $('#setting-color-trigger-aim-speed');
  const aimMaxStep = $('#setting-color-trigger-aim-max-step');
  const aimOx = $('#setting-color-trigger-aim-offset-x');
  const aimOy = $('#setting-color-trigger-aim-offset-y');
  const prediction = $('#setting-color-trigger-prediction');
  const predLead = $('#setting-color-trigger-prediction-lead');
  const predMax = $('#setting-color-trigger-prediction-max');
  const act = $('#setting-color-trigger-action');
  const hold = $('#setting-color-trigger-hold');
  const dbg = $('#setting-color-trigger-debug');
  const toggleEn = $('#setting-color-trigger-toggle-enabled');

  settings.colorTriggerbotEnabled = !!(en && en.checked);
  settings.colorTriggerbotToggleBindEnabled = !!(toggleEn && toggleEn.checked);
  settings.colorTriggerbotSource = src ? src.value : 'preset';

  // Presets (Multiple)
  const selectedPresets = Array.from(document.querySelectorAll('.setting-color-trigger-preset-check'))
    .filter(cb => cb.checked)
    .map(cb => cb.value);
  settings.colorTriggerbotPreset = selectedPresets.length > 0 ? selectedPresets : ['bluegreen'];

  // Custom RGB (Multiple)
  const selectedColors = Array.from(document.querySelectorAll('.setting-color-trigger-color'))
    .map(input => (input.value || '').replace(/^#/, '').toUpperCase())
    .filter(val => /^[0-9A-F]{6}$/.test(val));
  settings.colorTriggerbotColor = selectedColors.length > 0 ? selectedColors : ['FF0000'];

  settings.colorTriggerbotTolerance = Math.min(255, Math.max(0, parseInt(tol?.value, 10) || 10));
  settings.colorTriggerbotHsvLower = [
    parseInt(h0?.value, 10) || 0,
    parseInt(s0?.value, 10) || 0,
    parseInt(v0?.value, 10) || 0
  ];
  settings.colorTriggerbotHsvUpper = [
    parseInt(h1?.value, 10) || 179,
    parseInt(s1?.value, 10) || 255,
    parseInt(v1?.value, 10) || 255
  ];
  settings.colorTriggerbotFov = Math.min(400, Math.max(20, parseInt(fov?.value, 10) || 120));
  settings.colorTriggerbotCenterOnScreen = !!(centerScreen && centerScreen.checked);
  settings.colorTriggerbotDistance = Math.min(200, Math.max(1, parseInt(dist?.value, 10) || 25));
  settings.colorTriggerbotPollMs = Math.min(100, Math.max(8, parseInt(poll?.value, 10) || 16));
  settings.colorTriggerbotCooldownMs = Math.max(0, parseInt(cd?.value, 10) || 50);
  const clickHold = $('#setting-color-trigger-click-hold');
  settings.colorTriggerbotClickHoldMs = Math.max(0, parseInt(clickHold?.value, 10) ?? 50);
  const mode = clickMode ? clickMode.value : 'single';
  settings.colorTriggerbotClickMode = ['single', 'rapid', 'edge'].includes(mode) ? mode : 'single';
  settings.colorTriggerbotAimbotEnabled = !!(aimbot && aimbot.checked);
  settings.colorTriggerbotAimSpeed = Math.min(1, Math.max(0.05, parseFloat(aimSpeed?.value) || 0.35));
  settings.colorTriggerbotAimMaxStep = Math.min(200, Math.max(4, Math.round(parseFloat(aimMaxStep?.value) || 40)));
  settings.colorTriggerbotAimOffsetX = Math.round(parseFloat(aimOx?.value) || 0);
  settings.colorTriggerbotAimOffsetY = Math.round(parseFloat(aimOy?.value) || 0);
  settings.colorTriggerbotPredictionEnabled = !!(prediction && prediction.checked);
  settings.colorTriggerbotPredictionLeadMs = Math.max(0, Math.min(200, parseInt(predLead?.value, 10) || 50));
  settings.colorTriggerbotPredictionMaxLeadPx = Math.max(0, Math.min(200, parseInt(predMax?.value, 10) || 80));
  settings.colorTriggerbotAction = act ? act.value : 'leftClick';
  settings.colorTriggerbotHoldWhileOnTarget = !!(hold && hold.checked);
  settings.colorTriggerbotDebug = !!(dbg && dbg.checked);
}

let colorTriggerbotSaveDebounce = null;

function setColorTriggerbotSaveStatus(mode) {
  const el = $('#color-trigger-save-status');
  if (!el) return;
  el.classList.remove('color-triggerbot-save-status--saved', 'color-triggerbot-save-status--unsaved', 'color-triggerbot-save-status--error');
  if (mode === 'saved') {
    el.textContent = 'Saved';
    el.classList.add('color-triggerbot-save-status--saved');
  } else if (mode === 'unsaved') {
    el.textContent = 'Unsaved changes';
    el.classList.add('color-triggerbot-save-status--unsaved');
  } else if (mode === 'error') {
    el.textContent = 'Save failed';
    el.classList.add('color-triggerbot-save-status--error');
  } else {
    el.textContent = 'Changes save automatically';
  }
}

function scheduleColorTriggerbotSave() {
  setColorTriggerbotSaveStatus('unsaved');
  if (colorTriggerbotSaveDebounce) clearTimeout(colorTriggerbotSaveDebounce);
  colorTriggerbotSaveDebounce = setTimeout(() => {
    colorTriggerbotSaveDebounce = null;
    void saveColorTriggerbotSettings({ toast: false });
  }, 450);
}

async function saveColorTriggerbotSettings(opts = {}) {
  const showToastOnSave = opts.toast === true;
  try {
    const settings = opts.baseSettings
      ? { ...opts.baseSettings }
      : await window.kyrun.getSettings();
    readColorTriggerbotFromForm(settings);
    const enabled = !!($('#setting-color-trigger-enabled')?.checked);
    settings.colorTriggerbotEnabled = enabled;
    await window.kyrun.saveSettings(settings);
    updateColorTriggerTitlebar(enabled, enabled);
    syncColorTriggerDebugPanel();
    setColorTriggerbotSaveStatus('saved');
    if (showToastOnSave) showToast('Color triggerbot settings saved', 'success');
    return true;
  } catch {
    setColorTriggerbotSaveStatus('error');
    if (showToastOnSave) showToast('Failed to save colorbot settings', 'error');
    return false;
  }
}

async function pickColorTriggerbotSample({ fillHsv = false } = {}) {
  if (!state.hasRobot) {
    showToast('Native input required to pick colors', 'error');
    return;
  }
  showToast('Move cursor to target pixel, then wait…', 'info');
  await new Promise(r => setTimeout(r, 1200));
  try {
    const pos = await window.kyrun.getMousePosition();
    const hex = await window.kyrun.getPixelColor(pos.x, pos.y);
    await applyColorTriggerHexFromPicker(hex, { fillHsv });
  } catch {
    showToast('Screen capture failed', 'error');
  }
}

function updateColorTriggerTitlebar(active, enabled) {
  const dot = $('#color-trigger-dot');
  const text = $('#color-trigger-status-text');
  if (!dot || !text) return;
  const on = enabled != null ? !!enabled : !!active;
  if (on) {
    dot.className = 'titlebar__status-dot titlebar__status-dot--active';
    text.textContent = privacyActive() ? 'On' : 'Color: On';
  } else {
    dot.className = 'titlebar__status-dot titlebar__status-dot--inactive';
    text.textContent = privacyActive() ? 'Off' : 'Color: Off';
  }
}

async function loadSettingsToForm() {
  try {
    const s = await window.kyrun.getSettings();
    const mt = $('#setting-minimize-tray');
    const sm = $('#setting-start-minimized');
    const st = $('#setting-streamer-mode');
    const tte = $('#setting-triggers-toggle-enabled');
    const ttb = $('#setting-triggers-toggle-bind');
    const ao = $('#setting-anonymous-startup');
    const rt = $('#setting-random-timing');
    const dd = $('#setting-default-delay');
    const cm = $('#setting-coord-mode');
    const pte = $('#setting-profile-tts-enabled');
    const pth = $('#setting-profile-tts-hotkeys');
    const ptu = $('#setting-profile-tts-ui');
    const ptt = $('#setting-profile-tts-tray');
    const ptsp = $('#setting-profile-tts-suppress-privacy');
    const hkte = $('#setting-hotkeys-tts-enabled');
    const cbte = $('#setting-colorbot-tts-enabled');
    if (mt) mt.checked = s.minimizeToTray !== false;
    if (sm) sm.checked = !!s.startMinimized;
    if (st) st.checked = !!s.streamerMode;
    if (tte) tte.checked = !!s.triggersToggleBindEnabled;
    if (ttb) ttb.value = s.triggersToggleBindKey || '';
    if (ao) ao.checked = !!s.anonymousOnStartup;
    if (rt) rt.checked = s.randomTiming !== false;
    if (dd) dd.value = s.defaultDelay != null ? s.defaultDelay : 50;
    if (cm) cm.value = s.coordinateMode || 'absolute';
    if (pte) pte.checked = s.profileTtsEnabled !== false;
    const scopes = s.profileTtsScopes || {};
    if (pth) pth.checked = scopes.hotkeys !== false;
    if (ptu) ptu.checked = !!scopes.ui;
    if (ptt) ptt.checked = !!scopes.tray;
    if (ptsp) ptsp.checked = !!s.profileTtsSuppressPrivacy;
    if (hkte) hkte.checked = s.hotkeysTtsEnabled !== false;
    if (cbte) cbte.checked = s.colorbotTtsEnabled !== false;
    const cte = $('#setting-color-trigger-enabled');
    if (cte) cte.checked = false;
    loadColorTriggerbotToForm(s);
    await refreshColorTriggerbotEnabledFromMain();
    setColorTriggerbotSaveStatus('saved');
    syncTriggersToggleBindUi();
    syncProfileTtsSettingsUi();
  } catch {}
}

function wireSettingsControls() {
  const onToggle = async (sel, key, after) => {
    const el = $(sel);
    if (!el) return;
    el.addEventListener('change', async () => {
      try {
        const settings = await window.kyrun.getSettings();
        settings[key] = el.checked;
        mergeColorTriggerbotFormIntoSettings(settings);
        await window.kyrun.saveSettings(settings);
        if (key === 'streamerMode') {
          state.streamerMode = el.checked;
          updateStatusBar();
        }
        if (after) after();
      } catch {}
    });
  };
  onToggle('#setting-minimize-tray', 'minimizeToTray');
  onToggle('#setting-start-minimized', 'startMinimized');
  onToggle('#setting-streamer-mode', 'streamerMode');
  onToggle('#setting-triggers-toggle-enabled', 'triggersToggleBindEnabled', syncTriggersToggleBindUi);
  onToggle('#setting-anonymous-startup', 'anonymousOnStartup');
  onToggle('#setting-random-timing', 'randomTiming');
  const colorTriggerToggles = [
    '#setting-color-trigger-enabled',
    '#setting-color-trigger-debug',
    '#setting-color-trigger-hold',
    '#setting-color-trigger-aimbot',
    '#setting-color-trigger-prediction',
    '#setting-color-trigger-center-screen',
    '#setting-color-trigger-toggle-enabled'
  ];
  colorTriggerToggles.forEach(sel => {
    const el = $(sel);
    if (!el) return;
    el.addEventListener('change', () => {
      syncColorTriggerbotPanels();
      void saveColorTriggerbotSettings({ toast: false });
    });
  });

  const saveColorbotBtn = $('#btn-color-trigger-save');
  if (saveColorbotBtn) {
    saveColorbotBtn.onclick = () => { void saveColorTriggerbotSettings({ toast: true }); };
  }

  const colorbotProfileSel = $('#setting-color-trigger-profile');
  if (colorbotProfileSel) {
    colorbotProfileSel.addEventListener('change', () => {
      if (colorbotProfileSelectSyncing) return;
      void switchColorbotProfile(colorbotProfileSel.value);
    });
  }
  const colorbotProfileNew = $('#btn-colorbot-profile-new');
  if (colorbotProfileNew) colorbotProfileNew.onclick = () => showNewColorbotProfileModal();
  const colorbotProfileRename = $('#btn-colorbot-profile-rename');
  if (colorbotProfileRename) colorbotProfileRename.onclick = () => showRenameColorbotProfileModal();
  const colorbotProfileDup = $('#btn-colorbot-profile-dup');
  if (colorbotProfileDup) colorbotProfileDup.onclick = () => { void duplicateColorbotProfile(); };
  const colorbotProfileDel = $('#btn-colorbot-profile-del');
  if (colorbotProfileDel) colorbotProfileDel.onclick = () => { void deleteColorbotProfile(); };

  const cts = $('#setting-color-trigger-source');
  if (cts) {
    cts.addEventListener('change', async () => {
      syncColorTriggerbotPanels();
      await saveColorTriggerbotSettings({ toast: false });
    });
  }
  
  // Presets (Multiple)
  document.querySelectorAll('.setting-color-trigger-preset-check').forEach(cb => {
    cb.addEventListener('change', () => { void saveColorTriggerbotSettings({ toast: false }); });
  });

  const colorTriggerInputs = [
    '#setting-color-trigger-tolerance',
    '#setting-color-trigger-h0', '#setting-color-trigger-s0', '#setting-color-trigger-v0',
    '#setting-color-trigger-h1', '#setting-color-trigger-s1', '#setting-color-trigger-v1',
    '#setting-color-trigger-fov', '#setting-color-trigger-distance',
    '#setting-color-trigger-poll', '#setting-color-trigger-cooldown', '#setting-color-trigger-click-hold',
    '#setting-color-trigger-aim-speed', '#setting-color-trigger-aim-max-step',
    '#setting-color-trigger-aim-offset-x', '#setting-color-trigger-aim-offset-y',
    '#setting-color-trigger-prediction-lead', '#setting-color-trigger-prediction-max'
  ];
  colorTriggerInputs.forEach(sel => {
    const el = $(sel);
    if (!el) return;
    el.addEventListener('change', () => { void saveColorTriggerbotSettings({ toast: false }); });
    if (el.tagName === 'INPUT' && (el.type === 'text' || el.type === 'number')) {
      el.addEventListener('input', () => scheduleColorTriggerbotSave());
    }
  });

  const cta = $('#setting-color-trigger-action');
  if (cta) cta.addEventListener('change', () => { void saveColorTriggerbotSettings({ toast: false }); });
  const ctcm = $('#setting-color-trigger-click-mode');
  if (ctcm) ctcm.addEventListener('change', () => { void saveColorTriggerbotSettings({ toast: false }); });

  const pickRgb = $('#btn-color-trigger-pick-rgb');
  if (pickRgb) pickRgb.onclick = () => { void pickColorTriggerbotSample({ fillHsv: false }); };
  const pickRgbShot = $('#btn-color-trigger-pick-rgb-shot');
  if (pickRgbShot) pickRgbShot.onclick = () => { void pickColorTriggerFromScreenshot({ fillHsv: false }); };
  const pickHsv = $('#btn-color-trigger-pick-hsv');
  if (pickHsv) pickHsv.onclick = () => { void pickColorTriggerbotSample({ fillHsv: true }); };
  const pickHsvShot = $('#btn-color-trigger-pick-hsv-shot');
  if (pickHsvShot) pickHsvShot.onclick = () => { void pickColorTriggerFromScreenshot({ fillHsv: true }); };
  const probeBtn = $('#btn-color-trigger-probe');
  if (probeBtn) probeBtn.onclick = () => { void runColorTriggerProbe(); };

  const pte = $('#setting-profile-tts-enabled');
  const pth = $('#setting-profile-tts-hotkeys');
  const ptu = $('#setting-profile-tts-ui');
  const ptt = $('#setting-profile-tts-tray');
  const ptsp = $('#setting-profile-tts-suppress-privacy');
  const hkte = $('#setting-hotkeys-tts-enabled');
  const cbte = $('#setting-colorbot-tts-enabled');
  async function saveProfileTtsSettingsFromUi() {
    try {
      const settings = await window.kyrun.getSettings();
      settings.profileTtsEnabled = !!(pte && pte.checked);
      settings.profileTtsScopes = {
        hotkeys: !!(pth && pth.checked),
        ui: !!(ptu && ptu.checked),
        tray: !!(ptt && ptt.checked)
      };
      settings.profileTtsSuppressPrivacy = !!(ptsp && ptsp.checked);
      settings.hotkeysTtsEnabled = !!(hkte && hkte.checked);
      settings.colorbotTtsEnabled = !!(cbte && cbte.checked);
      mergeColorTriggerbotFormIntoSettings(settings);
      await window.kyrun.saveSettings(settings);
      syncProfileTtsSettingsUi();
    } catch {}
  }
  if (pte) pte.addEventListener('change', () => { void saveProfileTtsSettingsFromUi(); });
  if (pth) pth.addEventListener('change', () => { void saveProfileTtsSettingsFromUi(); });
  if (ptu) ptu.addEventListener('change', () => { void saveProfileTtsSettingsFromUi(); });
  if (ptt) ptt.addEventListener('change', () => { void saveProfileTtsSettingsFromUi(); });
  if (ptsp) ptsp.addEventListener('change', () => { void saveProfileTtsSettingsFromUi(); });
  if (hkte) hkte.addEventListener('change', () => { void saveProfileTtsSettingsFromUi(); });
  if (cbte) cbte.addEventListener('change', () => { void saveProfileTtsSettingsFromUi(); });

  const ctToggleBind = $('#setting-color-trigger-toggle-bind');
  if (ctToggleBind) {
    ctToggleBind.onclick = async function () {
      if (ctToggleBind.disabled) return;
      this.value = 'Press key or mouse...';
      const self = this;
      const keyH = async e => {
        e.preventDefault();
        const name = keyEventToBindLabel(e);
        self.value = name;
        cleanup();
        try {
          const settings = await window.kyrun.getSettings();
          readColorTriggerbotFromForm(settings);
          settings.colorTriggerbotToggleBindKey = name;
          settings.colorTriggerbotToggleBindVk = e.keyCode;
          settings.colorTriggerbotToggleBindIsMouse = false;
          settings.colorTriggerbotToggleBindEnabled = true;
          const toggleEn = $('#setting-color-trigger-toggle-enabled');
          if (toggleEn) toggleEn.checked = true;
          syncColorTriggerbotToggleBindUi();
          const enabled = !!($('#setting-color-trigger-enabled')?.checked);
          settings.colorTriggerbotEnabled = enabled;
          await window.kyrun.saveSettings(settings);
          showToast('Colorbot toggle shortcut saved', 'success');
        } catch {}
      };
      const mouseH = async e => {
        if (e.button === 0) return;
        e.preventDefault(); e.stopPropagation();
        const names = { 1: 'Middle Mouse', 2: 'Right Mouse', 3: 'Mouse X1 (Side)', 4: 'Mouse X2 (Side)' };
        const vkCodes = { 1: 4, 2: 2, 3: 5, 4: 6 };
        const name = names[e.button] || `Mouse ${e.button}`;
        self.value = name;
        cleanup();
        try {
          const settings = await window.kyrun.getSettings();
          readColorTriggerbotFromForm(settings);
          settings.colorTriggerbotToggleBindKey = name;
          settings.colorTriggerbotToggleBindVk = vkCodes[e.button] || e.button;
          settings.colorTriggerbotToggleBindIsMouse = true;
          settings.colorTriggerbotToggleBindEnabled = true;
          const toggleEn = $('#setting-color-trigger-toggle-enabled');
          if (toggleEn) toggleEn.checked = true;
          syncColorTriggerbotToggleBindUi();
          const enabled = !!($('#setting-color-trigger-enabled')?.checked);
          settings.colorTriggerbotEnabled = enabled;
          await window.kyrun.saveSettings(settings);
          showToast('Colorbot toggle shortcut saved', 'success');
        } catch {}
      };
      function cleanup() {
        document.removeEventListener('keydown', keyH);
        document.removeEventListener('mousedown', mouseH);
      }
      document.addEventListener('keydown', keyH);
      document.addEventListener('mousedown', mouseH);
    };
    ctToggleBind.oncontextmenu = async e => {
      e.preventDefault();
      if (ctToggleBind.disabled) return;
      try {
        const settings = await window.kyrun.getSettings();
        readColorTriggerbotFromForm(settings);
        settings.colorTriggerbotToggleBindKey = '';
        settings.colorTriggerbotToggleBindVk = 0;
        settings.colorTriggerbotToggleBindIsMouse = false;
        const enabled = !!($('#setting-color-trigger-enabled')?.checked);
        settings.colorTriggerbotEnabled = enabled;
        await window.kyrun.saveSettings(settings);
        ctToggleBind.value = '';
        showToast('Colorbot toggle shortcut cleared', 'info');
      } catch {}
    };
  }

  const ttBind = $('#setting-triggers-toggle-bind');
  if (ttBind) {
    ttBind.onclick = async function () {
      if (ttBind.disabled) return;
      this.value = 'Press key or mouse...';
      const self = this;
      const keyH = async e => {
        e.preventDefault();
        const name = keyEventToBindLabel(e);
        self.value = name;
        cleanup();
        try {
          const settings = await window.kyrun.getSettings();
          settings.triggersToggleBindKey = name;
          settings.triggersToggleBindVk = e.keyCode;
          settings.triggersToggleBindIsMouse = false;
          mergeColorTriggerbotFormIntoSettings(settings);
          await window.kyrun.saveSettings(settings);
          showToast('Toggle shortcut saved', 'success');
        } catch {}
      };
      const mouseH = async e => {
        if (e.button === 0) return;
        e.preventDefault(); e.stopPropagation();
        const names = { 1: 'Middle Mouse', 2: 'Right Mouse', 3: 'Mouse X1 (Side)', 4: 'Mouse X2 (Side)' };
        const vkCodes = { 1: 4, 2: 2, 3: 5, 4: 6 };
        const name = names[e.button] || `Mouse ${e.button}`;
        self.value = name;
        cleanup();
        try {
          const settings = await window.kyrun.getSettings();
          settings.triggersToggleBindKey = name;
          settings.triggersToggleBindVk = vkCodes[e.button] || e.button;
          settings.triggersToggleBindIsMouse = true;
          mergeColorTriggerbotFormIntoSettings(settings);
          await window.kyrun.saveSettings(settings);
          showToast('Toggle shortcut saved', 'success');
        } catch {}
      };
      function cleanup() {
        document.removeEventListener('keydown', keyH);
        document.removeEventListener('mousedown', mouseH);
      }
      document.addEventListener('keydown', keyH);
      document.addEventListener('mousedown', mouseH);
    };
    ttBind.oncontextmenu = async e => {
      e.preventDefault();
      if (ttBind.disabled) return;
      try {
        const settings = await window.kyrun.getSettings();
        settings.triggersToggleBindKey = '';
        settings.triggersToggleBindVk = 0;
        settings.triggersToggleBindIsMouse = false;
        mergeColorTriggerbotFormIntoSettings(settings);
        await window.kyrun.saveSettings(settings);
        ttBind.value = '';
        showToast('Toggle shortcut cleared', 'info');
      } catch {}
    };
  }

  const dd = $('#setting-default-delay');
  if (dd) {
    dd.addEventListener('change', async () => {
      try {
        const settings = await window.kyrun.getSettings();
        settings.defaultDelay = Math.max(1, parseInt(dd.value, 10) || 50);
        mergeColorTriggerbotFormIntoSettings(settings);
        await window.kyrun.saveSettings(settings);
      } catch {}
    });
  }
  const cm = $('#setting-coord-mode');
  if (cm) {
    cm.addEventListener('change', async () => {
      try {
        const settings = await window.kyrun.getSettings();
        settings.coordinateMode = cm.value;
        mergeColorTriggerbotFormIntoSettings(settings);
        await window.kyrun.saveSettings(settings);
      } catch {}
    });
  }
}

$('.titlebar__menu-item[data-action="settings"]').onclick = async () => {
  if (state.currentView === 'settings') {
    if (colorTriggerbotSaveDebounce) {
      clearTimeout(colorTriggerbotSaveDebounce);
      colorTriggerbotSaveDebounce = null;
    }
    await saveColorTriggerbotSettings({ toast: false });
    $('#settings-view').classList.remove('settings-view--visible');
    if (state.currentMacro) $('#editor-content').classList.remove('hidden');
    else $('#welcome-view').classList.remove('hidden');
    state.currentView = 'editor';
  } else {
    await loadSettingsToForm();
    $('#settings-view').classList.add('settings-view--visible');
    $('#editor-content').classList.add('hidden');
    $('#welcome-view').classList.add('hidden');
    state.currentView = 'settings';
    renderProfileHotkeys();
  }
};

// Help
$('.titlebar__menu-item[data-action="help"]').onclick = ()=>{
  const privacy = privacyActive();
  const brand = privacy ? 'App' : 'Kyrun';
  const icon = privacy ? '•' : 'K';
  const tag = privacy ? 'Macro editor' : 'Advanced Macro Editor & Executor';
  const bodyIntro = privacy
    ? 'Macro editor with recording, profiles, and privacy-friendly display options.'
    : 'Keyran-compatible macro application with<br>full .amc file support, recording, execution,<br>profile management, and anonymous mode.';
  const foot = privacy
    ? 'Uses Windows <code>SendInput</code> for input. Follow each game’s terms of service.'
    : 'Games with strong anti-cheat (e.g. Marvel Rivals / NetEase ACE, Easy Anti-Cheat) often block <strong>software</strong> keyboard and mouse from other apps. Tools like Keyran may use a <strong>kernel driver</strong> or mouse firmware, which this app does not ship. Kyrun uses Windows <code>SendInput</code> (standard user-mode injection). Try running Kyrun <strong>as Administrator</strong> if the game runs elevated; if input still does nothing in-game, only hardware-level solutions or the game’s own settings may work. Always follow each game’s terms of service.';
  showModal(`About ${brand}`,`<div style="text-align:center"><div style="width:60px;height:60px;background:linear-gradient(135deg,var(--accent-primary),var(--accent-secondary));border-radius:12px;display:inline-flex;align-items:center;justify-content:center;font-size:28px;font-weight:800;color:var(--bg-primary);margin-bottom:12px">${icon}</div><h3 style="margin-bottom:4px">${brand} v1.0</h3><p style="color:var(--text-tertiary);font-size:12px;margin-bottom:12px">${tag}</p><p style="color:var(--text-secondary);font-size:12px;line-height:1.6">${bodyIntro}</p><p style="color:var(--text-secondary);font-size:11px;line-height:1.5;margin-top:14px;text-align:left;max-width:340px;margin-left:auto;margin-right:auto">${foot}</p></div>`,[{label:'Close',type:'secondary',action:()=>{}}]);
};

// Global shortcuts
document.addEventListener('keydown', e=>{
  if(e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA')return;
  if(state.isRecording)return; // handled by record handlers
  if(e.ctrlKey&&e.key==='z'){e.preventDefault();undo();}
  if(e.ctrlKey&&e.key==='y'){e.preventDefault();redo();}
  if(e.ctrlKey&&e.key==='x'){e.preventDefault();cutSelected();}
  if(e.ctrlKey&&e.key==='c'){e.preventDefault();copySelected();}
  if(e.ctrlKey&&e.key==='v'){e.preventDefault();pasteCommands();}
  if(e.ctrlKey&&e.key==='s'){e.preventDefault();saveMacro();}
  if(e.ctrlKey&&e.key==='r'){e.preventDefault();state.isRecording?stopRecording():startRecording();}
  if(e.key==='Delete'){e.preventDefault();deleteSelected();}
  if(e.key==='F5'){e.preventDefault();runMacro();}
  if(e.key==='F6'){e.preventDefault();stopMacro();}
  if(e.key==='Escape')hideCtx();
});
document.addEventListener('click', e=>{ if(!e.target.closest('.context-menu'))hideCtx(); });

// ── Init ─────────────────────────────────────────────────────
(async function init() {
  try {
    const cp = await window.kyrun.getCurrentProfile();
    if (cp) state.currentProfile = cp;
  } catch {}
  loadProfiles(); loadFileTree();
  try {
    const ts = await window.kyrun.getMacroTriggersState();
    state.macroTriggers = { armed: ts.armed };
  } catch {}
  hotkeysTtsReady = true;
  colorbotTtsReady = true;
  // We cannot reload triggers simultaneously because it reads the same macro files we just grabbed
  setTimeout(reloadProfileTriggers, 500);
  try {
    const info = await window.kyrun.getAppInfo();
    state.cachedPidText = `PID: ${info.pid}`;
    state.hasRobot = info.hasInput;
    if (info.hasInput) { $('#driver-dot').className='titlebar__status-dot titlebar__status-dot--active'; }
  } catch {
    state.cachedPidText = 'PID: demo';
  }
  try {
    state.isAnonymous = await window.kyrun.getAnonymousStatus();
    const settings = await window.kyrun.getSettings();
    state.streamerMode = !!settings.streamerMode;
  } catch {}
  wireSettingsControls();
  updateStatusBar();

  try {
    const ct = await window.kyrun.getColorTriggerbotState();
    lastColorbotEnabled = ct.enabled != null ? !!ct.enabled : !!ct.active;
    syncColorTriggerbotEnabledUi(ct);
  } catch {}
  if (window.kyrun.onColorTriggerbotState) {
    window.kyrun.onColorTriggerbotState(data => {
      const enabled = data && data.enabled != null ? !!data.enabled : !!data.active;
      if (colorbotTtsReady && enabled !== lastColorbotEnabled) {
        void speakColorbotState(enabled);
      }
      lastColorbotEnabled = enabled;
      syncColorTriggerbotEnabledUi(data);
    });
  }
  if (window.kyrun.onColorTriggerbotDebug) {
    window.kyrun.onColorTriggerbotDebug(data => {
      if ($('#setting-color-trigger-debug')?.checked) appendColorTriggerDebugLog(data);
    });
  }

  const stEl = $('#status-triggers');
  if (stEl) {
    stEl.style.cursor = 'pointer';
    stEl.addEventListener('click', async () => {
      try {
        await window.kyrun.setMacroTriggersArmed(!state.macroTriggers.armed);
      } catch {}
    });
  }
})();
