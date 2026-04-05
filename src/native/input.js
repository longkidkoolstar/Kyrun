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
  }
};
