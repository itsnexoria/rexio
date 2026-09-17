// uiohook-napi identifies keys by numeric keycode; nut-js identifies them by
// a `Key` enum. Both are keyed here off a common human-readable name so the
// stored macro JSON is portable and readable, and each side just needs a
// name <-> its own representation.
const { UiohookKey } = require('uiohook-napi');
const { Key } = require('@nut-tree-fork/nut-js');

// name -> uiohook keycode (built once, reversed for lookup on record)
const NAME_TO_UIOHOOK = UiohookKey;
const UIOHOOK_TO_NAME = Object.fromEntries(Object.entries(UiohookKey).map(([k, v]) => [v, k]));

// name -> nut-js Key enum, for the keys a macro is realistically built from.
const NAME_TO_NUT = {
  A: Key.A, B: Key.B, C: Key.C, D: Key.D, E: Key.E, F: Key.F, G: Key.G, H: Key.H,
  I: Key.I, J: Key.J, K: Key.K, L: Key.L, M: Key.M, N: Key.N, O: Key.O, P: Key.P,
  Q: Key.Q, R: Key.R, S: Key.S, T: Key.T, U: Key.U, V: Key.V, W: Key.W, X: Key.X,
  Y: Key.Y, Z: Key.Z,
  0: Key.Num0, 1: Key.Num1, 2: Key.Num2, 3: Key.Num3, 4: Key.Num4,
  5: Key.Num5, 6: Key.Num6, 7: Key.Num7, 8: Key.Num8, 9: Key.Num9,
  F1: Key.F1, F2: Key.F2, F3: Key.F3, F4: Key.F4, F5: Key.F5, F6: Key.F6,
  F7: Key.F7, F8: Key.F8, F9: Key.F9, F10: Key.F10, F11: Key.F11, F12: Key.F12,
  Space: Key.Space, Enter: Key.Return, Escape: Key.Escape, Tab: Key.Tab,
  Backspace: Key.Backspace, Delete: Key.Delete, Insert: Key.Insert,
  Home: Key.Home, End: Key.End, PageUp: Key.PageUp, PageDown: Key.PageDown,
  ArrowUp: Key.Up, ArrowDown: Key.Down, ArrowLeft: Key.Left, ArrowRight: Key.Right,
  Shift: Key.LeftShift, ShiftRight: Key.RightShift,
  Ctrl: Key.LeftControl, CtrlRight: Key.RightControl,
  Alt: Key.LeftAlt, AltRight: Key.RightAlt,
  Meta: Key.LeftSuper, MetaRight: Key.RightSuper,
  CapsLock: Key.CapsLock,
};

// uiohook's raw event names differ slightly (e.g. "1", "Ctrl_L") — normalize
// what we get back from a recording session into the names table above.
const UIOHOOK_NAME_ALIASES = {
  Ctrl: 'Ctrl', CtrlRight: 'CtrlRight',
  Alt: 'Alt', AltRight: 'AltRight',
  Shift: 'Shift', ShiftRight: 'ShiftRight',
  Meta: 'Meta', MetaRight: 'MetaRight',
  ArrowUp: 'ArrowUp', ArrowDown: 'ArrowDown', ArrowLeft: 'ArrowLeft', ArrowRight: 'ArrowRight',
};

function uiohookCodeToName(keycode) {
  const raw = UIOHOOK_TO_NAME[keycode];
  return UIOHOOK_NAME_ALIASES[raw] || raw || null;
}

function nameToUiohookCode(name) {
  return NAME_TO_UIOHOOK[name] ?? null;
}

function nameToNutKey(name) {
  return NAME_TO_NUT[name] ?? null;
}

const MOUSE_BUTTON_NAMES = { 1: 'left', 2: 'right', 3: 'middle' };
const MOUSE_BUTTON_CODES = { left: 1, right: 2, middle: 3 };

module.exports = {
  uiohookCodeToName,
  nameToUiohookCode,
  nameToNutKey,
  MOUSE_BUTTON_NAMES,
  MOUSE_BUTTON_CODES,
  KEY_NAMES: Object.keys(NAME_TO_NUT),
};
