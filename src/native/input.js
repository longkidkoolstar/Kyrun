// ═══════════════════════════════════════════════════════════════
// Kyrun — Windows input via SendInput (koffi FFI)
// Uses SendInput instead of legacy keybd_event/mouse_event so injected
// events follow the same path most games and macro tools expect.
// Note: titles with kernel anti-cheat may still block all user-mode
// synthetic input; driver-level tools are outside this app’s scope.
// ═══════════════════════════════════════════════════════════════
const koffi = require('koffi');

const user32 = koffi.load('user32.dll');
const gdi32 = koffi.load('gdi32.dll');

const KEYBDINPUT = koffi.struct('KEYBDINPUT_Kyrun', {
  wVk: 'uint16',
  wScan: 'uint16',
  dwFlags: 'uint32',
  time: 'uint32',
  dwExtraInfo: 'uintptr'
});
const MOUSEINPUT = koffi.struct('MOUSEINPUT_Kyrun', {
  dx: 'int32',
  dy: 'int32',
  mouseData: 'uint32',
  dwFlags: 'uint32',
  time: 'uint32',
  dwExtraInfo: 'uintptr'
});
const INPUT_UNION = koffi.union('INPUT_UNION_Kyrun', {
  mi: MOUSEINPUT,
  ki: KEYBDINPUT
});
const INPUT = koffi.struct('INPUT_Kyrun', {
  type: 'uint32',
  u: INPUT_UNION
});

const SendInput = user32.func('uint32 SendInput(uint32 cInputs, INPUT_Kyrun *pInputs, int32 cbSize)');
const MapVirtualKeyW = user32.func('uint32 MapVirtualKeyW(uint32 uCode, uint32 uMapType)');

const POINT = koffi.struct('POINT', { x: 'int32', y: 'int32' });
const GetCursorPos = user32.func('bool GetCursorPos(_Out_ POINT *lpPoint)');
const SetCursorPos = user32.func('bool SetCursorPos(int X, int Y)');
const GetSystemMetrics = user32.func('int GetSystemMetrics(int nIndex)');
const GetAsyncKeyState = user32.func('int16 GetAsyncKeyState(int vKey)');

const GetDC = user32.func('intptr GetDC(intptr hWnd)');
const GetPixel = gdi32.func('uint32 GetPixel(intptr hdc, int x, int y)');
const ReleaseDC = user32.func('int ReleaseDC(intptr hWnd, intptr hDC)');
const CreateCompatibleDC = gdi32.func('intptr CreateCompatibleDC(intptr hdc)');
const CreateCompatibleBitmap = gdi32.func('intptr CreateCompatibleBitmap(intptr hdc, int cx, int cy)');
const SelectObject = gdi32.func('intptr SelectObject(intptr hdc, intptr h)');
const BitBlt = gdi32.func('bool BitBlt(intptr hdcDest, int x, int y, int cx, int cy, intptr hdcSrc, int x1, int y1, uint32 rop)');
const DeleteObject = gdi32.func('bool DeleteObject(intptr hObject)');
const DeleteDC = gdi32.func('bool DeleteDC(intptr hdc)');
const GetDIBits = gdi32.func('int GetDIBits(intptr hdc, intptr hbmp, uint32 uStartScan, uint32 cScanLines, void *lpvBits, void *lpbmi, uint32 usage)');

const SRCCOPY = 0x00CC0020;
const DIB_RGB_COLORS = 0;

const INPUT_KEYBOARD = 1;
const INPUT_MOUSE = 0;

const KEYEVENTF_KEYUP = 0x0002;
const KEYEVENTF_EXTENDEDKEY = 0x0001;

const MOUSEEVENTF_LEFTDOWN = 0x0002;
const MOUSEEVENTF_LEFTUP = 0x0004;
const MOUSEEVENTF_RIGHTDOWN = 0x0008;
const MOUSEEVENTF_RIGHTUP = 0x0010;
const MOUSEEVENTF_MIDDLEDOWN = 0x0020;
const MOUSEEVENTF_MIDDLEUP = 0x0040;
const MOUSEEVENTF_XDOWN = 0x0080;
const MOUSEEVENTF_XUP = 0x0100;
const MOUSEEVENTF_WHEEL = 0x0800;

const XBUTTON1 = 0x0001;
const XBUTTON2 = 0x0002;
const SM_CXSCREEN = 0;
const SM_CYSCREEN = 1;

const INPUT_SIZE = koffi.sizeof(INPUT);

const EXTENDED_KEYS = new Set([
  0x21, 0x22, 0x23, 0x24,
  0x25, 0x26, 0x27, 0x28,
  0x2d, 0x2e,
  0x5b, 0x5c,
  0x6f,
  0x90
]);

function sendKeyboard(vk, keyUp) {
  const scan = MapVirtualKeyW(vk, 0) & 0xffff;
  let flags = keyUp ? KEYEVENTF_KEYUP : 0;
  if (EXTENDED_KEYS.has(vk)) flags |= KEYEVENTF_EXTENDEDKEY;
  const inp = {
    type: INPUT_KEYBOARD,
    u: {
      ki: {
        wVk: vk & 0xffff,
        wScan: scan,
        dwFlags: flags,
        time: 0,
        dwExtraInfo: 0
      }
    }
  };
  SendInput(1, [inp], INPUT_SIZE);
}

function sendMouse(dwFlags, mouseData = 0) {
  const inp = {
    type: INPUT_MOUSE,
    u: {
      mi: {
        dx: 0,
        dy: 0,
        mouseData: mouseData >>> 0,
        dwFlags,
        time: 0,
        dwExtraInfo: 0
      }
    }
  };
  SendInput(1, [inp], INPUT_SIZE);
}

module.exports = {
  keyDown(vk) {
    sendKeyboard(vk, false);
  },

  keyUp(vk) {
    sendKeyboard(vk, true);
  },

  mouseDown(button) {
    switch (button) {
      case 'left':
        sendMouse(MOUSEEVENTF_LEFTDOWN);
        break;
      case 'right':
        sendMouse(MOUSEEVENTF_RIGHTDOWN);
        break;
      case 'middle':
        sendMouse(MOUSEEVENTF_MIDDLEDOWN);
        break;
      case 'x1':
        sendMouse(MOUSEEVENTF_XDOWN, XBUTTON1);
        break;
      case 'x2':
        sendMouse(MOUSEEVENTF_XDOWN, XBUTTON2);
        break;
    }
  },

  mouseUp(button) {
    switch (button) {
      case 'left':
        sendMouse(MOUSEEVENTF_LEFTUP);
        break;
      case 'right':
        sendMouse(MOUSEEVENTF_RIGHTUP);
        break;
      case 'middle':
        sendMouse(MOUSEEVENTF_MIDDLEUP);
        break;
      case 'x1':
        sendMouse(MOUSEEVENTF_XUP, XBUTTON1);
        break;
      case 'x2':
        sendMouse(MOUSEEVENTF_XUP, XBUTTON2);
        break;
    }
  },

  scroll(amount) {
    sendMouse(MOUSEEVENTF_WHEEL, (amount * 120) >>> 0);
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
    const r = color & 0xff;
    const g = (color >> 8) & 0xff;
    const b = (color >> 16) & 0xff;
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
  },

  /**
   * Capture a screen rectangle as BGR bytes (3 per pixel, top-down).
   * Coordinates are physical pixels on the primary display.
   */
  captureRegion(x, y, width, height) {
    const w = Math.max(1, Math.floor(width));
    const h = Math.max(1, Math.floor(height));
    const srcX = Math.floor(x);
    const srcY = Math.floor(y);

    const hdcScreen = GetDC(0);
    if (!hdcScreen) return null;

    const hdcMem = CreateCompatibleDC(hdcScreen);
    if (!hdcMem) {
      ReleaseDC(0, hdcScreen);
      return null;
    }

    const hbmp = CreateCompatibleBitmap(hdcScreen, w, h);
    if (!hbmp) {
      DeleteDC(hdcMem);
      ReleaseDC(0, hdcScreen);
      return null;
    }

    const oldObj = SelectObject(hdcMem, hbmp);
    BitBlt(hdcMem, 0, 0, w, h, hdcScreen, srcX, srcY, SRCCOPY);

    const bmi = Buffer.alloc(40);
    bmi.writeUInt32LE(40, 0);
    bmi.writeInt32LE(w, 4);
    bmi.writeInt32LE(-h, 8);
    bmi.writeUInt16LE(1, 12);
    bmi.writeUInt16LE(32, 14);
    bmi.writeUInt32LE(0, 16);

    const bgra = Buffer.alloc(w * h * 4);
    GetDIBits(hdcMem, hbmp, 0, h, bgra, bmi, DIB_RGB_COLORS);

    SelectObject(hdcMem, oldObj);
    DeleteObject(hbmp);
    DeleteDC(hdcMem);
    ReleaseDC(0, hdcScreen);

    const bgr = Buffer.alloc(w * h * 3);
    for (let i = 0; i < w * h; i++) {
      const si = i * 4;
      const di = i * 3;
      bgr[di] = bgra[si];
      bgr[di + 1] = bgra[si + 1];
      bgr[di + 2] = bgra[si + 2];
    }

    return { width: w, height: h, data: bgr };
  }
};
