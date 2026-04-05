// ═══════════════════════════════════════════════════════════════
// Kyrun — Windows Input Simulator via koffi FFI
// Uses keybd_event / mouse_event (simple flat calls, no struct issues)
// ═══════════════════════════════════════════════════════════════
const koffi = require('koffi');

const user32 = koffi.load('user32.dll');
const gdi32 = koffi.load('gdi32.dll');

// ── Structures (only used for simple queries) ────────────────
const POINT = koffi.struct('POINT', { x: 'int32', y: 'int32' });

// ── Win32 Functions ──────────────────────────────────────────
// Legacy input functions — flat params, no struct alignment issues
const keybd_event = user32.func('void keybd_event(uint8 bVk, uint8 bScan, uint32 dwFlags, uintptr dwExtraInfo)');
const mouse_event = user32.func('void mouse_event(uint32 dwFlags, uint32 dx, uint32 dy, uint32 dwData, uintptr dwExtraInfo)');
const MapVirtualKeyW = user32.func('uint32 MapVirtualKeyW(uint32 uCode, uint32 uMapType)');

// Cursor / Screen
const GetCursorPos = user32.func('bool GetCursorPos(_Out_ POINT *lpPoint)');
const SetCursorPos = user32.func('bool SetCursorPos(int X, int Y)');
const GetSystemMetrics = user32.func('int GetSystemMetrics(int nIndex)');
const GetAsyncKeyState = user32.func('int16 GetAsyncKeyState(int vKey)');

// Pixel color
const GetDC = user32.func('intptr GetDC(intptr hWnd)');
const GetPixel = gdi32.func('uint32 GetPixel(intptr hdc, int x, int y)');
const ReleaseDC = user32.func('int ReleaseDC(intptr hWnd, intptr hDC)');

// ── Constants ────────────────────────────────────────────────
const KEYEVENTF_KEYUP = 0x0002;
const KEYEVENTF_SCANCODE = 0x0008;
const KEYEVENTF_EXTENDEDKEY = 0x0001;

const MOUSEEVENTF_MOVE = 0x0001;
const MOUSEEVENTF_LEFTDOWN = 0x0002;
const MOUSEEVENTF_LEFTUP = 0x0004;
const MOUSEEVENTF_RIGHTDOWN = 0x0008;
const MOUSEEVENTF_RIGHTUP = 0x0010;
const MOUSEEVENTF_MIDDLEDOWN = 0x0020;
const MOUSEEVENTF_MIDDLEUP = 0x0040;
const MOUSEEVENTF_XDOWN = 0x0080;
const MOUSEEVENTF_XUP = 0x0100;
const MOUSEEVENTF_WHEEL = 0x0800;
const MOUSEEVENTF_ABSOLUTE = 0x8000;

const XBUTTON1 = 0x0001;
const XBUTTON2 = 0x0002;
const SM_CXSCREEN = 0;
const SM_CYSCREEN = 1;

// Extended keys that need KEYEVENTF_EXTENDEDKEY flag
const EXTENDED_KEYS = new Set([
  0x21, 0x22, 0x23, 0x24, // PgUp, PgDn, End, Home
  0x25, 0x26, 0x27, 0x28, // Arrow keys
  0x2D, 0x2E,             // Insert, Delete
  0x5B, 0x5C,             // Left/Right Windows key
  0x6F,                   // Numpad Divide
  0x90,                   // NumLock
]);

// ── Public API ───────────────────────────────────────────────
module.exports = {
  keyDown(vk) {
    const scan = MapVirtualKeyW(vk, 0);
    const flags = EXTENDED_KEYS.has(vk) ? KEYEVENTF_EXTENDEDKEY : 0;
    keybd_event(vk & 0xFF, scan & 0xFF, flags, 0);
  },

  keyUp(vk) {
    const scan = MapVirtualKeyW(vk, 0);
    const flags = KEYEVENTF_KEYUP | (EXTENDED_KEYS.has(vk) ? KEYEVENTF_EXTENDEDKEY : 0);
    keybd_event(vk & 0xFF, scan & 0xFF, flags, 0);
  },

  mouseDown(button) {
    switch(button) {
      case 'left': mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0); break;
      case 'right': mouse_event(MOUSEEVENTF_RIGHTDOWN, 0, 0, 0, 0); break;
      case 'middle': mouse_event(MOUSEEVENTF_MIDDLEDOWN, 0, 0, 0, 0); break;
      case 'x1': mouse_event(MOUSEEVENTF_XDOWN, 0, 0, XBUTTON1, 0); break;
      case 'x2': mouse_event(MOUSEEVENTF_XDOWN, 0, 0, XBUTTON2, 0); break;
    }
  },

  mouseUp(button) {
    switch(button) {
      case 'left': mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0); break;
      case 'right': mouse_event(MOUSEEVENTF_RIGHTUP, 0, 0, 0, 0); break;
      case 'middle': mouse_event(MOUSEEVENTF_MIDDLEUP, 0, 0, 0, 0); break;
      case 'x1': mouse_event(MOUSEEVENTF_XUP, 0, 0, XBUTTON1, 0); break;
      case 'x2': mouse_event(MOUSEEVENTF_XUP, 0, 0, XBUTTON2, 0); break;
    }
  },

  scroll(amount) {
    // amount > 0 = up, < 0 = down. WHEEL_DELTA = 120
    mouse_event(MOUSEEVENTF_WHEEL, 0, 0, (amount * 120) >>> 0, 0);
  },

  moveMouse(x, y) {
    SetCursorPos(x, y);
  },

  getMousePos() {
    const pt = { x: 0, y: 0 };
    GetCursorPos(pt);
    return { x: pt.x, y: pt.y };
  },

  getPixelColor(x, y) {
    const hdc = GetDC(0);
    const color = GetPixel(hdc, x, y);
    ReleaseDC(0, hdc);
    const r = color & 0xFF;
    const g = (color >> 8) & 0xFF;
    const b = (color >> 16) & 0xFF;
    return ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
  },

  isKeyDown(vk) {
    return (GetAsyncKeyState(vk) & 0x8000) !== 0;
  },

  getScreenSize() {
    return {
      width: GetSystemMetrics(SM_CXSCREEN),
      height: GetSystemMetrics(SM_CYSCREEN)
    };
  }
};
