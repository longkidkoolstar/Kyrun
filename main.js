const { app, BrowserWindow, ipcMain, globalShortcut, Tray, Menu, nativeImage, dialog, shell, screen, desktopCapturer } = require('electron');
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
/** Map of vkCode -> { macroIds: Set<string>, isColorbotToggle: boolean, isTriggersToggle: boolean, isAutoWalkToggle: boolean } */
const globalMouseActions = new Map();
/** Map of accelerator -> { macroIds: Set<string>, isColorbotToggle: boolean, isTriggersToggle: boolean, isAutoWalkToggle: boolean } */
const globalHotkeyActions = new Map();

/** Special macroId: fires even when macro triggers are disarmed (toggles armed state). */
const TOGGLE_TRIGGERS_ID = '!kyrun:toggle-triggers';
const TOGGLE_COLORBOT_ID = '!kyrun:toggle-colorbot';

function getOrCreateInfo(map, key) {
  let info = map.get(key);
  if (!info) {
    info = { macroIds: new Set(), isColorbotToggle: false, isTriggersToggle: false, isAutoWalkToggle: false };
    map.set(key, info);
  }
  return info;
}

function updateGlobalHotkeyRegistration(accel) {
  try { globalShortcut.unregister(accel); } catch (_) {}
  const info = globalHotkeyActions.get(accel);
  if (!info) return;
  if (!info.isTriggersToggle && !info.isColorbotToggle && !info.isAutoWalkToggle && info.macroIds.size === 0) {
    globalHotkeyActions.delete(accel);
    return;
  }

  try {
    globalShortcut.register(accel, () => {
      // Priority 1: Triggers Toggle (always works)
      if (info.isTriggersToggle) {
        macroTriggersArmed = !macroTriggersArmed;
        sendMacroTriggersState();
        return;
      }

      // Priority 2: Macro Hotkeys (if armed)
      if (macroTriggersEffectivelyArmed() && info.macroIds.size > 0) {
        if (mainWindow) {
          for (const mid of info.macroIds) {
            mainWindow.webContents.send('hotkey-triggered', mid);
          }
        }
        return; // PREVENT colorbot toggle if macro triggered
      }

      // Priority 3: Colorbot Toggle
      if (info.isColorbotToggle) {
        toggleColorTriggerbot();
        return;
      }

      // Priority 4: Auto Walk Toggle
      if (info.isAutoWalkToggle) {
        toggleAutoWalk();
      }
    });
  } catch (_) {}
}

function handleMouseTriggerAction(vkCode) {
  const info = globalMouseActions.get(vkCode);
  if (!info) return;

  // Priority 1: Triggers Toggle
  if (info.isTriggersToggle) {
    macroTriggersArmed = !macroTriggersArmed;
    sendMacroTriggersState();
    return;
  }

  // Priority 2: Macro Hotkeys (if armed)
  if (macroTriggersEffectivelyArmed() && info.macroIds.size > 0) {
    if (mainWindow) {
      for (const mid of info.macroIds) {
        mainWindow.webContents.send('hotkey-triggered', mid);
      }
    }
    return; // PREVENT colorbot toggle if macro triggered
  }

  // Priority 3: Colorbot Toggle
  if (info.isColorbotToggle) {
    toggleColorTriggerbot();
    return;
  }

  // Priority 4: Auto Walk Toggle
  if (info.isAutoWalkToggle) {
    toggleAutoWalk();
  }
}
let triggersToggleAccelRegistered = null;
let triggersToggleMouseVk = null;
let colorbotToggleAccelRegistered = null;
let colorbotToggleMouseVk = null;
let autoWalkToggleAccelRegistered = null;
let autoWalkToggleMouseVk = null;

// ── Auto Walk ──────────────────────────────────────────────────────
/** Whether auto walk is currently active (key held down). */
let autoWalkActive = false;
/** The VK code being held for walking. */
let autoWalkHeldVk = 0;

function sendAutoWalkState() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('auto-walk-state', { active: autoWalkActive });
  }
}

function stopAutoWalk() {
  if (!autoWalkActive) return;
  autoWalkActive = false;
  if (input && autoWalkHeldVk) {
    try { input.keyUp(autoWalkHeldVk); } catch (_) {}
  }
  autoWalkHeldVk = 0;
  sendAutoWalkState();
}

function toggleAutoWalk(settings) {
  const s = settings || appSettings;
  if (autoWalkActive) {
    stopAutoWalk();
  } else {
    if (!input) return;
    // Walk key VK defaults to W (0x57 = 87)
    const walkVk = Number(s.autoWalkKeyVk) || 0x57;
    autoWalkActive = true;
    autoWalkHeldVk = walkVk;
    try { input.keyDown(walkVk); } catch (_) { autoWalkActive = false; autoWalkHeldVk = 0; }
    sendAutoWalkState();
  }
}

function unregisterAutoWalkToggleBind() {
  if (autoWalkToggleAccelRegistered) {
    const info = globalHotkeyActions.get(autoWalkToggleAccelRegistered);
    if (info) {
      info.isAutoWalkToggle = false;
      updateGlobalHotkeyRegistration(autoWalkToggleAccelRegistered);
    }
    autoWalkToggleAccelRegistered = null;
  }
  if (autoWalkToggleMouseVk != null) {
    const info = globalMouseActions.get(autoWalkToggleMouseVk);
    if (info) {
      info.isAutoWalkToggle = false;
      if (!info.isTriggersToggle && !info.isColorbotToggle && info.macroIds.size === 0) globalMouseActions.delete(autoWalkToggleMouseVk);
    }
    autoWalkToggleMouseVk = null;
    if (globalMouseActions.size === 0) stopMouseTriggerPolling();
  }
}

function applyAutoWalkToggleBind(settings) {
  unregisterAutoWalkToggleBind();
  if (!settings || !settings.autoWalkBindEnabled) return;
  const vk = settings.autoWalkBindVk || 0;
  const isMouse = !!settings.autoWalkBindIsMouse;
  const keyName = settings.autoWalkBindKey || '';
  // Mouse button or keyboard key without an Electron accelerator → use VK polling
  if (isMouse || (!isMouse && vk && !keyNameToElectronAccelerator(keyName))) {
    if (!input || !vk) return;
    const info = getOrCreateInfo(globalMouseActions, vk);
    info.isAutoWalkToggle = true;
    autoWalkToggleMouseVk = vk;
    startMouseTriggerPolling();
    return;
  }
  const accel = keyNameToElectronAccelerator(keyName);
  if (!accel) return;
  const info = getOrCreateInfo(globalHotkeyActions, accel);
  info.isAutoWalkToggle = true;
  autoWalkToggleAccelRegistered = accel;
  updateGlobalHotkeyRegistration(accel);
}

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

function getPhysicalCursorPoint() {
  if (input && typeof input.getMousePos === 'function') return input.getMousePos();
  const dipPoint = screen.getCursorScreenPoint();
  if (typeof screen.dipToScreenPoint === 'function') {
    try { return screen.dipToScreenPoint(dipPoint); } catch (_) {}
  }
  return dipPoint;
}

function getDisplayForPhysicalPoint(point) {
  const dipPoint = typeof screen.screenToDipPoint === 'function'
    ? (() => { try { return screen.screenToDipPoint(point); } catch (_) { return point; } })()
    : point;
  return screen.getDisplayNearestPoint(dipPoint);
}

function getDisplayPhysicalBounds(display) {
  if (typeof screen.dipToScreenRect === 'function') {
    try { return screen.dipToScreenRect(null, display.bounds); } catch (_) {}
  }
  const scale = display?.scaleFactor || 1;
  const bounds = display?.bounds || { x: 0, y: 0, width: 0, height: 0 };
  return {
    x: Math.round(bounds.x * scale),
    y: Math.round(bounds.y * scale),
    width: Math.round(bounds.width * scale),
    height: Math.round(bounds.height * scale)
  };
}

function parseHexColor(value) {
  const raw = String(value ?? '').trim().replace(/^#/, '');
  if (!/^[\da-fA-F]{6}$/.test(raw)) return null;
  return {
    r: parseInt(raw.slice(0, 2), 16),
    g: parseInt(raw.slice(2, 4), 16),
    b: parseInt(raw.slice(4, 6), 16)
  };
}

function colorsMatchWithinTolerance(actualColor, expectedColor, tolerance = 0) {
  const actual = typeof actualColor === 'string' ? parseHexColor(actualColor) : actualColor;
  const expected = typeof expectedColor === 'string' ? parseHexColor(expectedColor) : expectedColor;
  if (!actual || !expected) return false;
  const rawTolerance = Number(tolerance);
  const delta = Number.isFinite(rawTolerance) && rawTolerance >= 0 ? Math.min(255, Math.round(rawTolerance)) : 0;
  return Math.abs(actual.r - expected.r) <= delta
    && Math.abs(actual.g - expected.g) <= delta
    && Math.abs(actual.b - expected.b) <= delta;
}

// ── Color triggerbot (HSV region scan) ─────────────────────────────
const COLOR_TRIGGERBOT_PRESETS = {
  bluegreen: { lower: [80, 40, 225], upper: [90, 100, 255] },
  pinkishpurple: { lower: [150, 85, 230], upper: [150, 120, 255] },
  green: { lower: [55, 70, 235], upper: [75, 145, 255] },
  pink: { lower: [150, 100, 245], upper: [160, 155, 255] }
};

let colorTriggerbotInterval = null;
let colorTriggerbotLastClick = 0;
let colorTriggerbotMatcher = null;
let colorTriggerbotRuntime = null;
/** Session-only; never written to settings.json */
let colorTriggerbotActive = false;
/** @type {'left'|'right'|'middle'|null} */
let colorTriggerbotButtonHeld = null;
let colorTriggerbotWasOnTarget = false;
/** @type {{ button: 'left'|'right'|'middle', at: number }|null} */
let colorTriggerbotClickRelease = null;
/** Centroid tracking for movement prediction (FOV pixel coords). */
let colorTriggerbotTrackState = { px: -1, py: -1, ts: 0, vx: 0, vy: 0 };

function colorTriggerbotResetTrackState() {
  colorTriggerbotTrackState = { px: -1, py: -1, ts: 0, vx: 0, vy: 0 };
}

function colorTriggerbotResolveAimTarget(capture, analysis, predictionEnabled, leadMs, maxLeadPx, smoothFactor) {
  const px = analysis.targetPx;
  const py = analysis.targetPy;
  if (px < 0 || py < 0) {
    colorTriggerbotResetTrackState();
    return { px, py, predicted: false };
  }
  if (!predictionEnabled) {
    colorTriggerbotTrackState = { px, py, ts: Date.now(), vx: 0, vy: 0 };
    return { px, py, predicted: false };
  }

  const now = Date.now();
  const st = colorTriggerbotTrackState;
  let vx = st.vx;
  let vy = st.vy;

  if (st.px >= 0 && st.ts > 0) {
    const dt = now - st.ts;
    if (dt > 0 && dt < 300) {
      const rawVx = (px - st.px) / dt;
      const rawVy = (py - st.py) / dt;
      const smooth = Math.min(0.95, Math.max(0, Number(smoothFactor) ?? 0.65));
      vx = vx * smooth + rawVx * (1 - smooth);
      vy = vy * smooth + rawVy * (1 - smooth);
    } else {
      vx = 0;
      vy = 0;
    }
  }

  const lead = Math.max(0, Math.round(Number(leadMs) || 50));
  let predPx = px + vx * lead;
  let predPy = py + vy * lead;

  const offX = predPx - px;
  const offY = predPy - py;
  const offDist = Math.sqrt(offX * offX + offY * offY);
  const cap = Math.max(0, Math.round(Number(maxLeadPx) || 80));
  if (offDist > cap && cap > 0) {
    predPx = px + (offX / offDist) * cap;
    predPy = py + (offY / offDist) * cap;
  }

  const w = capture.width;
  const h = capture.height;
  predPx = Math.max(0, Math.min(w - 1, Math.round(predPx)));
  predPy = Math.max(0, Math.min(h - 1, Math.round(predPy)));

  colorTriggerbotTrackState = { px, py, ts: now, vx, vy };
  return {
    px: predPx,
    py: predPy,
    predicted: true,
    rawPx: px,
    rawPy: py,
    vx,
    vy,
    leadMs: lead
  };
}

function colorTriggerbotActionToButton(action) {
  if (action === 'rightClick') return 'right';
  if (action === 'middleClick') return 'middle';
  if (action === 'leftClick') return 'left';
  return null;
}

function colorTriggerbotReleaseHold() {
  if (!colorTriggerbotButtonHeld || !input) return;
  try { input.mouseUp(colorTriggerbotButtonHeld); } catch (_) {}
  colorTriggerbotButtonHeld = null;
}

function colorTriggerbotProcessClickRelease() {
  if (!colorTriggerbotClickRelease || !input) return;
  if (Date.now() < colorTriggerbotClickRelease.at) return;
  try { input.mouseUp(colorTriggerbotClickRelease.button); } catch (_) {}
  colorTriggerbotClickRelease = null;
}

function colorTriggerbotCancelClickRelease() {
  if (!colorTriggerbotClickRelease || !input) return;
  try { input.mouseUp(colorTriggerbotClickRelease.button); } catch (_) {}
  colorTriggerbotClickRelease = null;
}

function colorTriggerbotUpdateHold(button, onTarget) {
  if (!input || !button) {
    colorTriggerbotReleaseHold();
    return;
  }
  if (onTarget) {
    if (colorTriggerbotButtonHeld && colorTriggerbotButtonHeld !== button) {
      colorTriggerbotReleaseHold();
    }
    if (!colorTriggerbotButtonHeld) {
      try {
        input.mouseDown(button);
        colorTriggerbotButtonHeld = button;
      } catch (_) {}
    }
  } else if (colorTriggerbotButtonHeld) {
    try { input.mouseUp(colorTriggerbotButtonHeld); } catch (_) {}
    colorTriggerbotButtonHeld = null;
  }
}

function rgbToHsv(r, g, b) {
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

function hsvInRange(h, s, v, lower, upper) {
  const lo = lower || [0, 0, 0];
  const hi = upper || [179, 255, 255];
  return h >= lo[0] && h <= hi[0]
    && s >= lo[1] && s <= hi[1]
    && v >= lo[2] && v <= hi[2];
}

function normalizeHsvBound(arr, fallback) {
  if (!Array.isArray(arr) || arr.length < 3) return fallback.slice();
  return arr.slice(0, 3).map((n, i) => {
    const v = Math.round(Number(n));
    if (!Number.isFinite(v)) return fallback[i];
    if (i === 0) return Math.min(179, Math.max(0, v));
    return Math.min(255, Math.max(0, v));
  });
}

/** Widens preset OpenCV HSV box: higher tolerance = looser match (0 = exact preset only). */
function expandPresetHsvBounds(lower, upper, toleranceRaw) {
  const raw = Number(toleranceRaw);
  const tol = Number.isFinite(raw) ? Math.min(255, Math.max(0, Math.round(raw))) : 10;
  const lo = normalizeHsvBound(lower, [0, 0, 0]);
  const hi = normalizeHsvBound(upper, [179, 255, 255]);
  if (tol <= 0) {
    return { lower: lo, upper: hi };
  }
  const hPad = Math.min(44, Math.round((tol / 255) * 44));
  const svPad = Math.min(100, Math.round((tol / 255) * 100));
  lo[0] = Math.max(0, lo[0] - hPad);
  hi[0] = Math.min(179, hi[0] + hPad);
  lo[1] = Math.max(0, lo[1] - svPad);
  hi[1] = Math.min(255, hi[1] + svPad);
  lo[2] = Math.max(0, lo[2] - svPad);
  hi[2] = Math.min(255, hi[2] + svPad);
  return { lower: lo, upper: hi };
}

function buildColorTriggerbotMatcher(settings) {
  const source = settings.colorTriggerbotSource || 'preset';
  const matchers = [];

  if (source === 'preset' || source === 'mixed') {
    let presets = settings.colorTriggerbotPreset || 'bluegreen';
    if (!Array.isArray(presets)) presets = [presets];
    const tolerance = settings.colorTriggerbotTolerance ?? 10;
    
    const hsvMatchers = presets.map(p => {
      const key = String(p).toLowerCase();
      const preset = COLOR_TRIGGERBOT_PRESETS[key] || COLOR_TRIGGERBOT_PRESETS.bluegreen;
      const bounds = expandPresetHsvBounds(preset.lower, preset.upper, tolerance);
      return { lower: bounds.lower, upper: bounds.upper };
    });

    matchers.push((r, g, b) => {
      const { h, s, v } = rgbToHsv(r, g, b);
      return hsvMatchers.some(m => hsvInRange(h, s, v, m.lower, m.upper));
    });
  }

  if (source === 'customRgb' || source === 'mixed') {
    let colors = settings.colorTriggerbotColor || 'FF0000';
    if (!Array.isArray(colors)) colors = [colors];
    const tolerance = settings.colorTriggerbotTolerance ?? 10;
    
    const expectedColors = colors.map(c => parseHexColor(c)).filter(c => !!c);
    if (expectedColors.length > 0) {
      matchers.push((r, g, b) => {
        const actual = { r, g, b };
        return expectedColors.some(expected => colorsMatchWithinTolerance(actual, expected, tolerance));
      });
    }
  }

  if (source === 'customHsv') {
    const lower = normalizeHsvBound(settings.colorTriggerbotHsvLower, [0, 0, 0]);
    const upper = normalizeHsvBound(settings.colorTriggerbotHsvUpper, [179, 255, 255]);
    matchers.push((r, g, b) => {
      const { h, s, v } = rgbToHsv(r, g, b);
      return hsvInRange(h, s, v, lower, upper);
    });
  }

  if (matchers.length === 0) return () => false;
  if (matchers.length === 1) return matchers[0];
  return (r, g, b) => matchers.some(m => m(r, g, b));
}

function rgbBytesToHex(r, g, b) {
  return [r, g, b].map(n => (n & 255).toString(16).padStart(2, '0')).join('').toUpperCase();
}

function getColorTriggerbotCaptureRect(fov, centerOnScreen = false) {
  const primary = screen.getPrimaryDisplay();
  const bounds = getDisplayPhysicalBounds(primary);
  const size = Math.round(fov);
  let centerX;
  let centerY;
  if (centerOnScreen) {
    centerX = bounds.x + bounds.width / 2;
    centerY = bounds.y + bounds.height / 2;
  } else {
    const cursor = getPhysicalCursorPoint();
    centerX = Number.isFinite(cursor?.x) ? cursor.x : bounds.x + bounds.width / 2;
    centerY = Number.isFinite(cursor?.y) ? cursor.y : bounds.y + bounds.height / 2;
  }
  let left = Math.floor(centerX - size / 2);
  let top = Math.floor(centerY - size / 2);
  const maxLeft = bounds.x + bounds.width - size;
  const maxTop = bounds.y + bounds.height - size;
  left = Math.max(bounds.x, Math.min(maxLeft, left));
  top = Math.max(bounds.y, Math.min(maxTop, top));
  return {
    left,
    top,
    width: size,
    height: size,
    centerX,
    centerY,
    centerOnScreen: !!centerOnScreen,
    screenWidth: bounds.width,
    screenHeight: bounds.height,
    scaleFactor: primary?.scaleFactor || 1
  };
}

function dilateColorTriggerMask(mask, w, h, iterations) {
  const iters = Math.min(8, Math.max(0, Math.round(Number(iterations) || 0)));
  if (iters <= 0) return mask;
  let current = mask;
  for (let iter = 0; iter < iters; iter++) {
    const next = new Uint8Array(w * h);
    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        if (!current[py * w + px]) continue;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const ny = py + dy;
            const nx = px + dx;
            if (ny >= 0 && ny < h && nx >= 0 && nx < w) next[ny * w + nx] = 1;
          }
        }
      }
    }
    current = next;
  }
  return current;
}

/** Largest 8-connected blob; target = topmost row, tie-break X nearest cx. */
function resolveHeadTargetFromMask(mask, w, h, cx, maxDistance) {
  const visited = new Uint8Array(w * h);
  let bestSize = 0;
  let bestHeadPx = -1;
  let bestHeadPy = -1;
  let bestHeadDist = Infinity;

  for (let sy = 0; sy < h; sy++) {
    for (let sx = 0; sx < w; sx++) {
      const start = sy * w + sx;
      if (!mask[start] || visited[start]) continue;

      const stack = [start];
      visited[start] = 1;
      let size = 0;
      let minY = h;
      const topRow = [];

      while (stack.length) {
        const idx = stack.pop();
        size++;
        const py = (idx / w) | 0;
        const px = idx % w;
        if (py < minY) {
          minY = py;
          topRow.length = 0;
          topRow.push(px);
        } else if (py === minY) {
          topRow.push(px);
        }
        if (py > 0) {
          const n = idx - w;
          if (mask[n] && !visited[n]) { visited[n] = 1; stack.push(n); }
        }
        if (py < h - 1) {
          const n = idx + w;
          if (mask[n] && !visited[n]) { visited[n] = 1; stack.push(n); }
        }
        if (px > 0) {
          const n = idx - 1;
          if (mask[n] && !visited[n]) { visited[n] = 1; stack.push(n); }
        }
        if (px < w - 1) {
          const n = idx + 1;
          if (mask[n] && !visited[n]) { visited[n] = 1; stack.push(n); }
        }
        if (py > 0 && px > 0) {
          const n = idx - w - 1;
          if (mask[n] && !visited[n]) { visited[n] = 1; stack.push(n); }
        }
        if (py > 0 && px < w - 1) {
          const n = idx - w + 1;
          if (mask[n] && !visited[n]) { visited[n] = 1; stack.push(n); }
        }
        if (py < h - 1 && px > 0) {
          const n = idx + w - 1;
          if (mask[n] && !visited[n]) { visited[n] = 1; stack.push(n); }
        }
        if (py < h - 1 && px < w - 1) {
          const n = idx + w + 1;
          if (mask[n] && !visited[n]) { visited[n] = 1; stack.push(n); }
        }
      }

      if (size <= bestSize || topRow.length === 0) continue;
      let headPx = topRow[0];
      for (let i = 1; i < topRow.length; i++) {
        const px = topRow[i];
        if (Math.abs(px - cx) < Math.abs(headPx - cx)) headPx = px;
      }
      bestSize = size;
      bestHeadPx = headPx;
      bestHeadPy = minY;
    }
  }

  const cy = (h / 2) | 0;
  if (bestHeadPx >= 0) {
    bestHeadDist = Math.sqrt((bestHeadPx - cx) ** 2 + (bestHeadPy - cy) ** 2);
  }
  const inRange = bestHeadPx >= 0 && bestHeadDist <= maxDistance;
  return {
    targetPx: inRange ? bestHeadPx : -1,
    targetPy: inRange ? bestHeadPy : -1,
    wouldTrigger: inRange,
    blobPixelCount: bestSize,
    headDist: bestHeadPx >= 0 ? bestHeadDist : -1
  };
}

function analyzeColorTriggerCapture(capture, matcher, maxDistance, opts = {}) {
  const stride = opts.fullScan ? 1 : (capture.width > 150 ? 2 : 1);
  const targetMode = opts.targetMode === 'head' ? 'head' : 'body';
  const morphEnabled = !!opts.morphEnabled;
  const morphIterations = Math.min(8, Math.max(0, Math.round(Number(opts.morphIterations) || 0)));
  const { width: w, height: h, data } = capture;
  const cx = Math.floor(w / 2);
  const cy = Math.floor(h / 2);
  const ci = (cy * w + cx) * 3;
  const centerB = data[ci];
  const centerG = data[ci + 1];
  const centerR = data[ci + 2];
  const centerHex = rgbBytesToHex(centerR, centerG, centerB);
  const centerMatch = matcher(centerR, centerG, centerB);
  const centerHsv = rgbToHsv(centerR, centerG, centerB);

  let minDist = Infinity;
  let matchCount = 0;
  let closestPx = -1;
  let closestPy = -1;
  let sumPx = 0;
  let sumPy = 0;
  let inRangeCount = 0;
  let mask = null;

  for (let py = 0; py < h; py += stride) {
    for (let px = 0; px < w; px += stride) {
      const i = (py * w + px) * 3;
      const b = data[i];
      const g = data[i + 1];
      const r = data[i + 2];
      if (!matcher(r, g, b)) continue;
      if (targetMode === 'head') {
        if (!mask) mask = new Uint8Array(w * h);
        mask[py * w + px] = 1;
      }
      matchCount++;
      const dist = Math.sqrt((px - cx) ** 2 + (py - cy) ** 2);
      if (dist < minDist) {
        minDist = dist;
        closestPx = px;
        closestPy = py;
      }
      if (targetMode === 'body' && dist <= maxDistance) {
        sumPx += px;
        sumPy += py;
        inRangeCount++;
      }
    }
  }

  const hasMatch = minDist !== Infinity;
  const effectiveMinDist = hasMatch ? minDist : -1;
  let targetPx = -1;
  let targetPy = -1;
  let wouldTrigger = false;
  let aimCentroid = false;
  let blobPixelCount = 0;
  let headDist = -1;

  if (targetMode === 'head' && mask && hasMatch) {
    if (morphEnabled && morphIterations > 0) {
      mask = dilateColorTriggerMask(mask, w, h, morphIterations);
    }
    const head = resolveHeadTargetFromMask(mask, w, h, cx, maxDistance);
    targetPx = head.targetPx;
    targetPy = head.targetPy;
    wouldTrigger = head.wouldTrigger;
    blobPixelCount = head.blobPixelCount;
    headDist = head.headDist;
  } else if (targetMode === 'body') {
    const inRange = hasMatch && minDist <= maxDistance;
    wouldTrigger = inRange;
    if (inRange) {
      if (inRangeCount > 0) {
        targetPx = Math.round(sumPx / inRangeCount);
        targetPy = Math.round(sumPy / inRangeCount);
        aimCentroid = true;
      } else {
        targetPx = closestPx;
        targetPy = closestPy;
      }
    }
  }

  return {
    minDist: effectiveMinDist,
    matchCount,
    centerHex,
    centerMatch,
    centerHsv,
    wouldTrigger,
    targetPx,
    targetPy,
    aimCentroid,
    targetMode,
    morphEnabled: targetMode === 'head' && morphEnabled,
    morphIterations: targetMode === 'head' && morphEnabled ? morphIterations : 0,
    blobPixelCount: targetMode === 'head' ? blobPixelCount : undefined,
    headDist: targetMode === 'head' ? headDist : undefined
  };
}

function colorTriggerbotAimAtTarget(capture, targetPx, targetPy, aimSpeed, offsetX, offsetY, aimMaxStep) {
  if (!input || !capture || targetPx < 0 || targetPy < 0) return;
  const cx = Math.floor(capture.width / 2);
  const cy = Math.floor(capture.height / 2);
  const dx = (targetPx - cx) + (offsetX || 0);
  const dy = (targetPy - cy) + (offsetY || 0);
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 2) return;
  const speed = Math.min(1, Math.max(0.05, Number(aimSpeed) || 0.35));
  const maxStep = Math.max(4, Math.round(Number(aimMaxStep) || 40));
  // Move a fraction of remaining distance, capped so we don't overshoot in one tick
  let step = dist * speed;
  step = Math.min(step, maxStep, Math.max(0, dist - 2));
  if (step < 1) return;
  const pos = input.getMousePos();
  const nx = Math.round(pos.x + (dx / dist) * step);
  const ny = Math.round(pos.y + (dy / dist) * step);
  try { input.moveMouse(nx, ny); } catch (_) {}
}

function shouldColorTriggerbotClick(onTarget, clickMode, cooldownMs) {
  if (!onTarget) return false;
  const mode = clickMode || 'single';
  const now = Date.now();
  if (mode === 'edge') {
    if (!colorTriggerbotWasOnTarget) {
      colorTriggerbotWasOnTarget = true;
      colorTriggerbotLastClick = now;
      return true;
    }
    return false;
  }
  if (mode === 'rapid') {
    const interval = Math.max(0, cooldownMs);
    if (now - colorTriggerbotLastClick < interval) return false;
    colorTriggerbotLastClick = now;
    return true;
  }
  // single
  if (now - colorTriggerbotLastClick < Math.max(0, cooldownMs)) return false;
  colorTriggerbotLastClick = now;
  return true;
}

function scanRegionForColorTrigger(capture, matcher, maxDistance) {
  return analyzeColorTriggerCapture(capture, matcher, maxDistance).minDist;
}

function queueColorTriggerbotClick(action) {
  if (!input) return false;
  const button = colorTriggerbotActionToButton(action);
  if (!button) return false;
  if (colorTriggerbotClickRelease) {
    if (Date.now() >= colorTriggerbotClickRelease.at) {
      colorTriggerbotProcessClickRelease();
    } else {
      return false;
    }
  }
  try {
    input.mouseDown(button);
    const holdMs = Math.max(0, Math.round(Number(colorTriggerbotRuntime?.clickHoldMs) || 50));
    colorTriggerbotClickRelease = { button, at: Date.now() + holdMs };
    return true;
  } catch (_) {
    return false;
  }
}

function sendColorTriggerbotDebug(payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('color-triggerbot-debug', payload);
  }
}

function probeColorTriggerbot(settings) {
  if (!input) {
    return { ok: false, error: 'Native input module not loaded' };
  }
  const fov = Math.min(400, Math.max(20, Math.round(Number(settings.colorTriggerbotFov) || 120)));
  const distance = Math.min(fov / 2, Math.max(1, Math.round(Number(settings.colorTriggerbotDistance) || 25)));
  const matcher = buildColorTriggerbotMatcher(settings);
  const centerOnScreen = !!settings.colorTriggerbotCenterOnScreen;
  const region = getColorTriggerbotCaptureRect(fov, centerOnScreen);

  let capture;
  try {
    capture = input.captureRegion(region.left, region.top, region.width, region.height);
  } catch (e) {
    return { ok: false, error: `Capture failed: ${e.message}`, region };
  }
  if (!capture || !capture.data) {
    const centerPx = {
      x: Math.floor(region.left + region.width / 2),
      y: Math.floor(region.top + region.height / 2)
    };
    let fallbackHex = null;
    try { fallbackHex = input.getPixelColor(centerPx.x, centerPx.y); } catch (_) {}
    return {
      ok: false,
      error: 'BitBlt capture returned empty (common in exclusive fullscreen or some games). Try windowed/borderless.',
      region,
      centerPixel: centerPx,
      fallbackCenterHex: fallbackHex
    };
  }

  const targetMode = settings.colorTriggerbotTargetMode === 'head' ? 'head' : 'body';
  const morphEnabled = !!settings.colorTriggerbotMorphEnabled;
  const morphIterations = Math.min(8, Math.max(0, Math.round(Number(settings.colorTriggerbotMorphIterations) || 3)));
  const analysis = analyzeColorTriggerCapture(capture, matcher, distance, {
    fullScan: true,
    targetMode,
    morphEnabled,
    morphIterations
  });
  const source = settings.colorTriggerbotSource || 'preset';
  const extra = {};
  if (source === 'customRgb') {
    let colors = settings.colorTriggerbotColor || 'FF0000';
    if (!Array.isArray(colors)) colors = [colors];
    extra.targetColor = colors;
    extra.tolerance = settings.colorTriggerbotTolerance ?? 10;
    extra.targetColorValid = colors.every(c => !!parseHexColor(c));
  }
  if (source === 'customHsv') {
    extra.hsvLower = normalizeHsvBound(settings.colorTriggerbotHsvLower, [0, 0, 0]);
    extra.hsvUpper = normalizeHsvBound(settings.colorTriggerbotHsvUpper, [179, 255, 255]);
  }
  if (source === 'preset') {
    let presets = settings.colorTriggerbotPreset || 'bluegreen';
    if (!Array.isArray(presets)) presets = [presets];
    extra.preset = presets;
    extra.tolerance = settings.colorTriggerbotTolerance ?? 10;
    
    // For debug display, we'll just show the bounds of the first preset or a merged range
    const firstKey = String(presets[0]).toLowerCase();
    const firstPreset = COLOR_TRIGGERBOT_PRESETS[firstKey] || COLOR_TRIGGERBOT_PRESETS.bluegreen;
    const bounds = expandPresetHsvBounds(firstPreset.lower, firstPreset.upper, extra.tolerance);
    extra.hsvLower = bounds.lower;
    extra.hsvUpper = bounds.upper;
  }
  return {
    ok: true,
    region,
    fov,
    distance,
    source,
    action: settings.colorTriggerbotAction || 'leftClick',
    holdWhileOnTarget: !!settings.colorTriggerbotHoldWhileOnTarget,
    clickMode: settings.colorTriggerbotClickMode || 'single',
    aimbotEnabled: !!settings.colorTriggerbotAimbotEnabled,
    centerOnScreen,
    targetMode,
    morphEnabled,
    morphIterations: morphEnabled ? morphIterations : 0,
    macroRunning: !!macroRunning,
    ...extra,
    ...analysis
  };
}

function sendColorTriggerbotState(active) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('color-triggerbot-state', {
      active: !!active,
      enabled: colorTriggerbotActive
    });
  }
}

function toggleColorTriggerbot() {
  applyColorTriggerbot(appSettings, !colorTriggerbotActive);
}

function stopColorTriggerbotPolling(notify = true) {
  if (colorTriggerbotInterval) {
    clearInterval(colorTriggerbotInterval);
    colorTriggerbotInterval = null;
  }
  colorTriggerbotReleaseHold();
  colorTriggerbotCancelClickRelease();
  colorTriggerbotWasOnTarget = false;
  colorTriggerbotMatcher = null;
  colorTriggerbotRuntime = null;
  colorTriggerbotResetTrackState();
  if (notify) sendColorTriggerbotState(false);
}

function colorTriggerbotTick() {
  if (!input || !colorTriggerbotMatcher || !colorTriggerbotRuntime) return;
  colorTriggerbotProcessClickRelease();

  const {
    fov, distance, cooldownMs, clickHoldMs, action, debug, holdWhileOnTarget,
    clickMode, aimbotEnabled, aimSpeed, aimMaxStep, aimOffsetX, aimOffsetY, centerOnScreen,
    predictionEnabled, predictionLeadMs, predictionMaxLeadPx, predictionSmooth,
    targetMode, morphEnabled, morphIterations
  } = colorTriggerbotRuntime;
  const button = colorTriggerbotActionToButton(action);
  const captureCenterOnScreen = centerOnScreen || aimbotEnabled;
  const region = getColorTriggerbotCaptureRect(fov, captureCenterOnScreen);
  const baseDebug = {
    ts: Date.now(),
    region,
    macroRunning: !!macroRunning,
    action,
    holdWhileOnTarget: !!holdWhileOnTarget,
    clickMode,
    aimbotEnabled: !!aimbotEnabled,
    buttonHeld: colorTriggerbotButtonHeld
  };

  if (macroRunning) {
    colorTriggerbotReleaseHold();
    colorTriggerbotCancelClickRelease();
    if (debug) sendColorTriggerbotDebug({ ...baseDebug, captureOk: false, skipped: 'macro running' });
    return;
  }

  let capture;
  try {
    capture = input.captureRegion(region.left, region.top, region.width, region.height);
  } catch (e) {
    colorTriggerbotReleaseHold();
    if (debug) sendColorTriggerbotDebug({ ...baseDebug, captureOk: false, error: e.message });
    return;
  }
  if (!capture || !capture.data) {
    colorTriggerbotReleaseHold();
    if (debug) {
      sendColorTriggerbotDebug({
        ...baseDebug,
        captureOk: false,
        error: 'Empty capture (try windowed/borderless mode)'
      });
    }
    return;
  }

  const analysis = analyzeColorTriggerCapture(capture, colorTriggerbotMatcher, distance, {
    targetMode,
    morphEnabled,
    morphIterations
  });
  const onTarget = !!analysis.wouldTrigger;

  if (!onTarget) {
    colorTriggerbotWasOnTarget = false;
    colorTriggerbotResetTrackState();
  }

  if (aimbotEnabled && onTarget && analysis.targetPx >= 0) {
    const cx = Math.floor(capture.width / 2);
    const cy = Math.floor(capture.height / 2);
    const aimTarget = colorTriggerbotResolveAimTarget(
      capture,
      analysis,
      predictionEnabled,
      predictionLeadMs,
      predictionMaxLeadPx,
      predictionSmooth
    );
    const aimDx = aimTarget.px - cx + (aimOffsetX || 0);
    const aimDy = aimTarget.py - cy + (aimOffsetY || 0);
    colorTriggerbotAimAtTarget(
      capture, aimTarget.px, aimTarget.py, aimSpeed, aimOffsetX, aimOffsetY, aimMaxStep
    );
    if (debug) {
      const pos = input.getMousePos();
      sendColorTriggerbotDebug({
        ...baseDebug,
        captureOk: true,
        ...analysis,
        aimMoved: true,
        aimDelta: { x: aimDx, y: aimDy },
        aimTarget: { x: pos.x + aimDx, y: pos.y + aimDy },
        aimPredicted: aimTarget.predicted,
        aimRawPx: aimTarget.rawPx,
        aimRawPy: aimTarget.rawPy,
        aimPredPx: aimTarget.px,
        aimPredPy: aimTarget.py,
        aimVelocity: aimTarget.predicted ? { vx: aimTarget.vx, vy: aimTarget.vy } : undefined
      });
    }
  }

  if (holdWhileOnTarget && button) {
    colorTriggerbotCancelClickRelease();
    const wasHeld = !!colorTriggerbotButtonHeld;
    colorTriggerbotUpdateHold(button, onTarget);
    if (debug) {
      sendColorTriggerbotDebug({
        ...baseDebug,
        captureOk: true,
        ...analysis,
        triggerDistance: distance,
        holdMode: true,
        buttonHeld: colorTriggerbotButtonHeld,
        holdPressed: !wasHeld && !!colorTriggerbotButtonHeld,
        holdReleased: wasHeld && !colorTriggerbotButtonHeld
      });
    }
    return;
  }

  colorTriggerbotReleaseHold();

  if (debug) {
    sendColorTriggerbotDebug({
      ...baseDebug,
      captureOk: true,
      ...analysis,
      triggerDistance: distance,
      cooldownMs,
      clickHoldMs,
      msSinceLastAction: Date.now() - colorTriggerbotLastClick
    });
  }

  if (!onTarget || action === 'none') return;

  if (!shouldColorTriggerbotClick(onTarget, clickMode, cooldownMs)) return;

  try {
    const fired = queueColorTriggerbotClick(action);
    if (debug) {
      sendColorTriggerbotDebug({
        ...baseDebug,
        captureOk: true,
        fired,
        clickQueued: fired,
        clickMode,
        clickHoldMs,
        ...analysis
      });
    }
  } catch (e) {
    if (debug) sendColorTriggerbotDebug({ ...baseDebug, captureOk: true, fireError: e.message });
  }
}

function applyColorTriggerbot(settings, enabled = colorTriggerbotActive) {
  colorTriggerbotActive = !!enabled;
  stopColorTriggerbotPolling(false);
  if (!settings || !colorTriggerbotActive || !input) {
    sendColorTriggerbotState(false);
    return;
  }

  const fov = Math.min(400, Math.max(20, Math.round(Number(settings.colorTriggerbotFov) || 120)));
  const distance = Math.min(fov / 2, Math.max(1, Math.round(Number(settings.colorTriggerbotDistance) || 25)));
  const pollMs = Math.min(100, Math.max(8, Math.round(Number(settings.colorTriggerbotPollMs) || 16)));
  const cooldownMs = Math.max(0, Math.round(Number(settings.colorTriggerbotCooldownMs) || 50));
  const clickHoldMs = Math.max(0, Math.round(Number(settings.colorTriggerbotClickHoldMs) ?? 50));
  const action = settings.colorTriggerbotAction || 'leftClick';
  const debug = !!settings.colorTriggerbotDebug;
  const holdWhileOnTarget = !!settings.colorTriggerbotHoldWhileOnTarget;
  const clickMode = settings.colorTriggerbotClickMode || 'single';
  const aimbotEnabled = !!settings.colorTriggerbotAimbotEnabled;
  const aimSpeed = Math.min(1, Math.max(0.05, Number(settings.colorTriggerbotAimSpeed) || 0.35));
  const aimMaxStep = Math.max(4, Math.round(Number(settings.colorTriggerbotAimMaxStep) || 40));
  const aimOffsetX = Math.round(Number(settings.colorTriggerbotAimOffsetX) || 0);
  const aimOffsetY = Math.round(Number(settings.colorTriggerbotAimOffsetY) || 0);
  const centerOnScreen = !!settings.colorTriggerbotCenterOnScreen;
  const predictionEnabled = !!settings.colorTriggerbotPredictionEnabled;
  const predictionLeadMs = Math.max(0, Math.min(200, Math.round(Number(settings.colorTriggerbotPredictionLeadMs) || 50)));
  const predictionMaxLeadPx = Math.max(0, Math.min(200, Math.round(Number(settings.colorTriggerbotPredictionMaxLeadPx) || 80)));
  const predictionSmooth = Math.min(0.95, Math.max(0, Number(settings.colorTriggerbotPredictionSmooth) ?? 0.65));
  const targetMode = settings.colorTriggerbotTargetMode === 'head' ? 'head' : 'body';
  const morphEnabled = !!settings.colorTriggerbotMorphEnabled;
  const morphIterations = Math.min(8, Math.max(0, Math.round(Number(settings.colorTriggerbotMorphIterations) || 3)));

  colorTriggerbotMatcher = buildColorTriggerbotMatcher(settings);
  colorTriggerbotRuntime = {
    fov, distance, cooldownMs, clickHoldMs, action, debug, holdWhileOnTarget,
    clickMode, aimbotEnabled, aimSpeed, aimMaxStep, aimOffsetX, aimOffsetY, centerOnScreen,
    predictionEnabled, predictionLeadMs, predictionMaxLeadPx, predictionSmooth,
    targetMode, morphEnabled, morphIterations
  };
  colorTriggerbotLastClick = 0;
  colorTriggerbotWasOnTarget = false;
  colorTriggerbotResetTrackState();

  colorTriggerbotInterval = setInterval(colorTriggerbotTick, pollMs);
  sendColorTriggerbotState(true);
  if (debug) {
    const probe = probeColorTriggerbot(settings);
    sendColorTriggerbotDebug({ ts: Date.now(), startupProbe: true, ...probe });
  }
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

// ── Color triggerbot profiles ─────────────────────────────────────
const COLOR_TRIGGERBOT_PROFILE_KEYS = [
  'colorTriggerbotSource',
  'colorTriggerbotPreset',
  'colorTriggerbotColor',
  'colorTriggerbotTolerance',
  'colorTriggerbotHsvLower',
  'colorTriggerbotHsvUpper',
  'colorTriggerbotFov',
  'colorTriggerbotCenterOnScreen',
  'colorTriggerbotTargetMode',
  'colorTriggerbotMorphEnabled',
  'colorTriggerbotMorphIterations',
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

function normalizeColorTriggerbotProfiles(settings) {
  let profiles = settings.colorTriggerbotProfiles;
  if (!profiles || typeof profiles !== 'object' || Array.isArray(profiles)) {
    profiles = { Default: extractColorTriggerbotProfileFromSettings(settings) };
    settings.colorTriggerbotProfiles = profiles;
  }
  const names = Object.keys(profiles);
  if (!settings.colorTriggerbotActiveProfile || !profiles[settings.colorTriggerbotActiveProfile]) {
    settings.colorTriggerbotActiveProfile = names.includes('Default')
      ? 'Default'
      : (names[0] || 'Default');
    if (!profiles[settings.colorTriggerbotActiveProfile]) {
      profiles[settings.colorTriggerbotActiveProfile] = extractColorTriggerbotProfileFromSettings(settings);
    }
  }
}

function persistActiveColorTriggerbotProfile(settings) {
  normalizeColorTriggerbotProfiles(settings);
  const active = settings.colorTriggerbotActiveProfile;
  settings.colorTriggerbotProfiles = { ...settings.colorTriggerbotProfiles };
  settings.colorTriggerbotProfiles[active] = extractColorTriggerbotProfileFromSettings(settings);
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
  const merged = {
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
    /** Speak profile name on switch. */
    profileTtsEnabled: true,
    /** Scope switches for profile-switch speech feedback. */
    profileTtsScopes: {
      hotkeys: true,
      ui: false,
      tray: false
    },
    /** Optional privacy guard for speech output. */
    profileTtsSuppressPrivacy: false,
    /** Speak "Hotkeys enabled/disabled" when global hotkeys state changes. */
    hotkeysTtsEnabled: true,
    /** Speak when color triggerbot is enabled or disabled. */
    colorbotTtsEnabled: true,
    /** Speak when auto walk is enabled or disabled. */
    autoWalkTtsEnabled: true,
    colorTriggerbotEnabled: false,
    colorTriggerbotSource: 'preset',
    colorTriggerbotPreset: 'bluegreen',
    colorTriggerbotColor: 'FF0000',
    colorTriggerbotTolerance: 10,
    colorTriggerbotHsvLower: [80, 40, 225],
    colorTriggerbotHsvUpper: [90, 100, 255],
    colorTriggerbotFov: 120,
    colorTriggerbotCenterOnScreen: false,
    colorTriggerbotTargetMode: 'body',
    colorTriggerbotMorphEnabled: false,
    colorTriggerbotMorphIterations: 3,
    colorTriggerbotToggleBindEnabled: false,
    colorTriggerbotToggleBindKey: '',
    colorTriggerbotToggleBindVk: 0,
    colorTriggerbotToggleBindIsMouse: false,
    colorTriggerbotDistance: 25,
    colorTriggerbotPollMs: 16,
    colorTriggerbotCooldownMs: 50,
    colorTriggerbotClickHoldMs: 50,
    colorTriggerbotAction: 'leftClick',
    colorTriggerbotHoldWhileOnTarget: false,
    colorTriggerbotClickMode: 'single',
    colorTriggerbotAimbotEnabled: false,
    colorTriggerbotAimSpeed: 0.35,
    colorTriggerbotAimMaxStep: 40,
    colorTriggerbotAimOffsetX: 0,
    colorTriggerbotAimOffsetY: 0,
    colorTriggerbotPredictionEnabled: false,
    colorTriggerbotPredictionLeadMs: 50,
    colorTriggerbotPredictionMaxLeadPx: 80,
    colorTriggerbotPredictionSmooth: 0.65,
    colorTriggerbotDebug: false,
    colorTriggerbotProfiles: {},
    colorTriggerbotActiveProfile: 'Default',
    ...raw,
    colorTriggerbotEnabled: false
  };
  normalizeColorTriggerbotProfiles(merged);
  applyColorTriggerbotProfileToSettings(merged, merged.colorTriggerbotActiveProfile);
  return merged;
}

/** Same rules as renderer `convertToElectronAccelerator` — keyboard-only.
 *  Returns null for keys that cannot be used as Electron globalShortcut accelerators
 *  (punctuation/symbols). Those must be handled via VK polling instead.
 */
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
    // Punctuation/symbols (;  '  ,  .  /  \  [  ]  `  -  =) intentionally omitted:
    // globalShortcut cannot register them reliably. They are handled via VK polling.
  };
  if (map[keyname]) return map[keyname];
  return null;
}

function unregisterTriggersToggleBind() {
  if (triggersToggleAccelRegistered) {
    const info = globalHotkeyActions.get(triggersToggleAccelRegistered);
    if (info) {
      info.isTriggersToggle = false;
      updateGlobalHotkeyRegistration(triggersToggleAccelRegistered);
    }
    triggersToggleAccelRegistered = null;
  }
  if (triggersToggleMouseVk != null) {
    const info = globalMouseActions.get(triggersToggleMouseVk);
    if (info) {
      info.isTriggersToggle = false;
      if (!info.isColorbotToggle && info.macroIds.size === 0) globalMouseActions.delete(triggersToggleMouseVk);
    }
    triggersToggleMouseVk = null;
    if (globalMouseActions.size === 0) stopMouseTriggerPolling();
  }
}

function unregisterColorbotToggleBind() {
  if (colorbotToggleAccelRegistered) {
    const info = globalHotkeyActions.get(colorbotToggleAccelRegistered);
    if (info) {
      info.isColorbotToggle = false;
      updateGlobalHotkeyRegistration(colorbotToggleAccelRegistered);
    }
    colorbotToggleAccelRegistered = null;
  }
  if (colorbotToggleMouseVk != null) {
    const info = globalMouseActions.get(colorbotToggleMouseVk);
    if (info) {
      info.isColorbotToggle = false;
      if (!info.isTriggersToggle && info.macroIds.size === 0) globalMouseActions.delete(colorbotToggleMouseVk);
    }
    colorbotToggleMouseVk = null;
    if (globalMouseActions.size === 0) stopMouseTriggerPolling();
  }
}

function applyColorbotToggleBind(settings) {
  unregisterColorbotToggleBind();
  if (!settings || !settings.colorTriggerbotToggleBindEnabled) return;
  const vk = settings.colorTriggerbotToggleBindVk || 0;
  const isMouse = !!settings.colorTriggerbotToggleBindIsMouse;
  const keyName = settings.colorTriggerbotToggleBindKey || '';
  // Mouse button or keyboard key without an Electron accelerator → use VK polling
  if (isMouse || (!isMouse && vk && !keyNameToElectronAccelerator(keyName))) {
    if (!input || !vk) return;
    const info = getOrCreateInfo(globalMouseActions, vk);
    info.isColorbotToggle = true;
    colorbotToggleMouseVk = vk;
    startMouseTriggerPolling();
    return;
  }
  const accel = keyNameToElectronAccelerator(keyName);
  if (!accel) return;
  const info = getOrCreateInfo(globalHotkeyActions, accel);
  info.isColorbotToggle = true;
  colorbotToggleAccelRegistered = accel;
  updateGlobalHotkeyRegistration(accel);
}

function applyTriggersToggleBind(settings) {
  unregisterTriggersToggleBind();
  if (!settings || !settings.triggersToggleBindEnabled) return;
  const vk = settings.triggersToggleBindVk || 0;
  const isMouse = !!settings.triggersToggleBindIsMouse;
  const keyName = settings.triggersToggleBindKey || '';
  // Mouse button or keyboard key without an Electron accelerator → use VK polling
  if (isMouse || (!isMouse && vk && !keyNameToElectronAccelerator(keyName))) {
    if (!input || !vk) return;
    const info = getOrCreateInfo(globalMouseActions, vk);
    info.isTriggersToggle = true;
    triggersToggleMouseVk = vk;
    startMouseTriggerPolling();
    return;
  }
  const accel = keyNameToElectronAccelerator(keyName);
  if (!accel) return;
  const info = getOrCreateInfo(globalHotkeyActions, accel);
  info.isTriggersToggle = true;
  triggersToggleAccelRegistered = accel;
  updateGlobalHotkeyRegistration(accel);
}

function saveSettings(settings) {
  const next = { ...settings };
  delete next.colorTriggerbotEnabled;
  persistActiveColorTriggerbotProfile(next);
  appSettings = { ...appSettings, ...next };
  appSettings.colorTriggerbotEnabled = false;
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
  
  // Handle colorbot profile linking
  if (appSettings) {
    const links = appSettings.colorTriggerbotProfileLinks || {};
    const linkedCbProfile = links[profileName];
    if (linkedCbProfile && appSettings.colorTriggerbotProfiles && appSettings.colorTriggerbotProfiles[linkedCbProfile]) {
      if (appSettings.colorTriggerbotActiveProfile !== linkedCbProfile) {
        persistActiveColorTriggerbotProfile(appSettings);
        appSettings.colorTriggerbotActiveProfile = linkedCbProfile;
        applyColorTriggerbotProfileToSettings(appSettings, linkedCbProfile);
        saveSettings(appSettings);
        if (colorTriggerbotActive) {
          applyColorTriggerbot(appSettings, true);
        }
      }
    }
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
    const enabled = settings?.colorTriggerbotEnabled;
    saveSettings(settings);
    applyTriggersToggleBind(appSettings);
    applyColorbotToggleBind(appSettings);
    applyAutoWalkToggleBind(appSettings);
    applyColorTriggerbot(appSettings, enabled !== undefined ? !!enabled : colorTriggerbotActive);
    return true;
  });

  ipcMain.handle('get-color-triggerbot-state', () => ({
    active: !!colorTriggerbotInterval,
    enabled: colorTriggerbotActive
  }));

  ipcMain.handle('probe-color-triggerbot', () => probeColorTriggerbot(appSettings));

  ipcMain.handle('reapply-triggers-toggle-bind', () => {
    applyTriggersToggleBind(appSettings);
    return true;
  });

  ipcMain.handle('reapply-colorbot-toggle-bind', () => {
    applyColorbotToggleBind(appSettings);
    return true;
  });

  ipcMain.handle('reapply-auto-walk-bind', () => {
    applyAutoWalkToggleBind(appSettings);
    return true;
  });

  ipcMain.handle('toggle-auto-walk', () => {
    toggleAutoWalk();
    return { active: autoWalkActive };
  });

  ipcMain.handle('get-auto-walk-state', () => ({ active: autoWalkActive }));

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
  ipcMain.on('window-focus', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
  ipcMain.on('window-close', () => mainWindow.close());
  
  // Hotkey registration
  ipcMain.handle('register-hotkey', (_, id, accelerator) => {
    try {
      if (registeredHotkeys.has(id)) {
        const oldAccel = registeredHotkeys.get(id);
        const info = globalHotkeyActions.get(oldAccel);
        if (info) {
          info.macroIds.delete(id);
          updateGlobalHotkeyRegistration(oldAccel);
        }
      }
      const info = getOrCreateInfo(globalHotkeyActions, accelerator);
      info.macroIds.add(id);
      registeredHotkeys.set(id, accelerator);
      updateGlobalHotkeyRegistration(accelerator);
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle('unregister-hotkey', (_, id) => {
    if (registeredHotkeys.has(id)) {
      const accel = registeredHotkeys.get(id);
      const info = globalHotkeyActions.get(accel);
      if (info) {
        info.macroIds.delete(id);
        updateGlobalHotkeyRegistration(accel);
      }
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

  ipcMain.handle('capture-screen-frame', async () => {
    try {
      const physicalPoint = getPhysicalCursorPoint();
      const targetDisplay = getDisplayForPhysicalPoint(physicalPoint) || screen.getPrimaryDisplay();
      const physicalBounds = getDisplayPhysicalBounds(targetDisplay);
      const thumbnailSize = {
        width: Math.max(1, physicalBounds.width || 1),
        height: Math.max(1, physicalBounds.height || 1)
      };
      const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize });
      let source = sources.find(s => String(s.display_id || '') === String(targetDisplay.id));
      if (!source && sources.length) source = sources[0];
      if (!source || !source.thumbnail || source.thumbnail.isEmpty()) {
        return { success: false, error: 'Screen capture returned no image' };
      }
      const size = source.thumbnail.getSize();
      return {
        success: true,
        imageDataUrl: source.thumbnail.toDataURL(),
        imageWidth: size.width,
        imageHeight: size.height,
        physicalBounds,
        displayName: source.name || `Display ${targetDisplay.id}`
      };
    } catch (e) {
      return { success: false, error: e?.message || 'Screen capture failed' };
    }
  });

  // ── Mouse Button Trigger Registration ─────────────────────────────
  // Electron's globalShortcut doesn't support mouse buttons, so we poll
  ipcMain.handle('register-mouse-trigger', (_, macroId, vkCode) => {
    if (!input) return false;
    const info = getOrCreateInfo(globalMouseActions, vkCode);
    info.macroIds.add(macroId);
    startMouseTriggerPolling();
    return true;
  });

  ipcMain.handle('unregister-mouse-trigger', (_, vkCode) => {
    const info = globalMouseActions.get(vkCode);
    if (info) {
      info.macroIds.clear(); 
      if (!info.isTriggersToggle && !info.isColorbotToggle) globalMouseActions.delete(vkCode);
    }
    if (globalMouseActions.size === 0) stopMouseTriggerPolling();
    return true;
  });

  ipcMain.handle('toggle-color-triggerbot', () => {
    toggleColorTriggerbot();
    return { enabled: colorTriggerbotActive, active: !!colorTriggerbotInterval };
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

    function toCoord(value) {
      const n = Number(value);
      return Number.isFinite(n) ? Math.round(n) : 0;
    }

    function isUnsetCoord(value) {
      return value === undefined || value === null || value === '';
    }

    function resolveWaitPosition(cmd, xKey, yKey, fallbackXKey = 'x', fallbackYKey = 'y') {
      const rawX = cmd[xKey];
      const rawY = cmd[yKey];
      if (isUnsetCoord(rawX) || isUnsetCoord(rawY)) {
        return { x: toCoord(cmd[fallbackXKey]), y: toCoord(cmd[fallbackYKey]) };
      }
      const x = toCoord(rawX);
      const y = toCoord(rawY);
      const fx = toCoord(cmd[fallbackXKey]);
      const fy = toCoord(cmd[fallbackYKey]);
      // Legacy macros stored 0,0 before a position was picked; fall back to shared x/y.
      if (x === 0 && y === 0 && (fx !== 0 || fy !== 0)) {
        return { x: fx, y: fy };
      }
      return { x, y };
    }

    function getWaitTimingOptions(cmd) {
      const rawPollMs = Number(cmd.pollMs);
      const pollMs = Number.isFinite(rawPollMs) && rawPollMs > 0 ? Math.min(1000, Math.max(1, Math.round(rawPollMs))) : 16;
      const rawTimeoutMs = Number(cmd.timeoutMs);
      const timeoutMs = Number.isFinite(rawTimeoutMs) && rawTimeoutMs > 0 ? Math.min(600000, Math.max(1, Math.round(rawTimeoutMs))) : 0;
      const deadline = timeoutMs > 0 ? Date.now() + timeoutMs : Infinity;
      return { pollMs, timeoutMs, deadline };
    }

    function getWaitCommandOptions(cmd) {
      const x = toCoord(cmd.x);
      const y = toCoord(cmd.y);
      const { pollMs, timeoutMs, deadline } = getWaitTimingOptions(cmd);
      return { x, y, pollMs, timeoutMs, deadline };
    }

    function pixelConditionMatches(cmd) {
      const expectedColor = parseHexColor(cmd.color || 'FF0000');
      if (!expectedColor) return false;
      const sampledColor = input.getPixelColor(toCoord(cmd.x), toCoord(cmd.y));
      const tolerance = cmd.tolerance ?? 10;
      const matched = colorsMatchWithinTolerance(sampledColor, expectedColor, tolerance);
      return (cmd.mode || 'match') === 'notMatch' ? !matched : matched;
    }

    function buttonConditionMatches(cmd) {
      if (!input) return false;
      const vk = Number(cmd.keyCode);
      if (!vk) return false;
      const isDown = input.isKeyDown(vk);
      const mode = cmd.mode || 'held'; // 'held' or 'notHeld'
      return mode === 'notHeld' ? !isDown : isDown;
    }

    function getJumpToRunIfColorIndex(cmds, currentIndex) {
      for (let i = currentIndex + 1; i < cmds.length; i++) {
        const candidate = cmds[i];
        if (!candidate || candidate.type !== 'RunIfColor' || !candidate.jumpOnMatch || candidate.breakpoint) continue;
        if (pixelConditionMatches(candidate)) return i;
      }
      return -1;
    }

    async function waitForPixelPredicate(cmd, matcher) {
      const { x, y, pollMs, timeoutMs, deadline } = getWaitCommandOptions(cmd);

      while (!macroAbort) {
        if (releaseVk && !input.isKeyDown(releaseVk)) { macroAbort = true; return; }
        const sampledColor = input.getPixelColor(x, y);
        if (matcher(sampledColor)) return true;
        const remainingMs = deadline - Date.now();
        if (remainingMs <= 0) return false;
        const nextSleepMs = timeoutMs > 0 ? Math.min(pollMs, Math.max(1, remainingMs)) : pollMs;
        await new Promise(r => setTimeout(r, nextSleepMs));
      }
      return false;
    }

    async function waitForPixelColor(cmd) {
      const mode = cmd.mode || 'match';
      const tolerance = cmd.tolerance ?? 10;

      if (mode === 'transition') {
        const fromColor = parseHexColor(cmd.fromColor || cmd.color || 'FF0000');
        const toColor = parseHexColor(cmd.toColor || '00FF00');
        if (!fromColor || !toColor) return;
        let sawFromColor = false;
        return await waitForPixelPredicate(cmd, sampledColor => {
          if (!sawFromColor) {
            if (colorsMatchWithinTolerance(sampledColor, fromColor, tolerance)) sawFromColor = true;
            return false;
          }
          return colorsMatchWithinTolerance(sampledColor, toColor, tolerance);
        });
      }

      if (mode === 'orMatch') {
        const colorA = parseHexColor(cmd.colorA || cmd.color || 'FF0000');
        const colorB = parseHexColor(cmd.colorB || '00FF00');
        if (!colorA || !colorB) return;
        const posA = resolveWaitPosition(cmd, 'xA', 'yA');
        const posB = resolveWaitPosition(cmd, 'xB', 'yB');
        const { pollMs, timeoutMs, deadline } = getWaitTimingOptions(cmd);

        while (!macroAbort) {
          if (releaseVk && !input.isKeyDown(releaseVk)) { macroAbort = true; return; }
          const sampledColorA = input.getPixelColor(posA.x, posA.y);
          if (colorsMatchWithinTolerance(sampledColorA, colorA, tolerance)) return true;
          const sampledColorB = input.getPixelColor(posB.x, posB.y);
          if (colorsMatchWithinTolerance(sampledColorB, colorB, tolerance)) return true;
          const remainingMs = deadline - Date.now();
          if (remainingMs <= 0) return false;
          const nextSleepMs = timeoutMs > 0 ? Math.min(pollMs, Math.max(1, remainingMs)) : pollMs;
          await new Promise(r => setTimeout(r, nextSleepMs));
        }
        return false;
      }

      const expectedColor = parseHexColor(cmd.color || 'FF0000');
      if (!expectedColor) return;
      if (mode === 'notMatch') {
        return await waitForPixelPredicate(cmd, sampledColor => !colorsMatchWithinTolerance(sampledColor, expectedColor, tolerance));
      }
      return await waitForPixelPredicate(cmd, sampledColor => colorsMatchWithinTolerance(sampledColor, expectedColor, tolerance));
    }

    async function runOnce(cmds) {
      for (let i = 0; i < cmds.length; i++) {
        if (macroAbort) return;
        // Skip release check before line 0: right after the hotkey fires, GetAsyncKeyState
        // for the trigger can briefly read "up" (or mismatch bindVk), which aborted before
        // the first command and looked like execution started on line 2. Delays still poll in sleep().
        if (releaseVk && i > 0 && !input.isKeyDown(releaseVk)) { macroAbort = true; return; }
        const jumpToIndex = getJumpToRunIfColorIndex(cmds, i);
        if (jumpToIndex > i) {
          i = jumpToIndex - 1;
          continue;
        }
        const cmd = cmds[i];
        if (cmd && cmd.breakpoint) continue;
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
              if (!pixelConditionMatches(cmd)) {
                i++;
              }
              break;
            }
            case 'RunIfColor': {
              const matched = pixelConditionMatches(cmd);
              if (matched && cmd.playSoundOnMatch) {
                try { shell.beep(); } catch (_) {}
              }
              if (!matched) {
                const endIndex = Math.max(i, toCoord(cmd.endLine) - 1);
                i = endIndex;
              }
              break;
            }
            case 'RunIfButton': {
              const matched = buttonConditionMatches(cmd);
              if (matched && cmd.playSoundOnMatch) {
                try { shell.beep(); } catch (_) {}
              }
              if (!matched) {
                const endIndex = Math.max(i, toCoord(cmd.endLine) - 1);
                i = endIndex;
              }
              break;
            }
            case 'WaitForPixelColor': {
              const matched = await waitForPixelColor(cmd);
              if (matched && cmd.playSoundOnMatch) {
                try { shell.beep(); } catch (_) {}
              }
              break;
            }
          }
        } catch(err) { /* skip command on error */ }

        // Loop back check for RunIfButton blocks
        for (let k = 0; k < cmds.length; k++) {
          const candidate = cmds[k];
          if (candidate && candidate.type === 'RunIfButton' && !candidate.breakpoint) {
            const endIdx = toCoord(candidate.endLine) - 2;
            if (i === endIdx) {
              if (buttonConditionMatches(candidate)) {
                i = k - 1; // loop back to the RunIfButton command
                await new Promise(r => setTimeout(r, 1)); // Yield to prevent CPU freeze/lag spike
                break;
              }
            }
          }
        }
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
    for (const vkCode of globalMouseActions.keys()) {
      const pressed = input.isKeyDown(vkCode);
      const wasPressed = mouseButtonStates.get(vkCode) || false;
      if (pressed && !wasPressed) {
        handleMouseTriggerAction(vkCode);
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
  applyColorbotToggleBind(appSettings);
  applyAutoWalkToggleBind(appSettings);
  applyColorTriggerbot(appSettings, false);
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
  stopColorTriggerbotPolling();
  stopAutoWalk();
  unregisterColorbotToggleBind();
  unregisterAutoWalkToggleBind();
});
