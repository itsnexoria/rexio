const { uIOhook } = require('uiohook-napi');
const { uiohookCodeToName, MOUSE_BUTTON_NAMES } = require('./keymap');

// Coalesce mousemove spam: uiohook fires this on every pixel of movement,
// which would bloat a macro and add nothing a human intended. We keep only
// one sample per this many ms, ending on the final position when recording
// stops (handled by whatever move/click event comes right after).
const MOUSEMOVE_SAMPLE_MS = 40;
// Below this gap a 'wait' action isn't worth persisting — record.js floods
// naturally-occurring micro-gaps between fast key/click events otherwise.
const MIN_WAIT_MS = 15;

let recording = false;
let actions = [];
let lastEventAt = 0;
let lastMouseMoveSampleAt = 0;

function pushWaitIfNeeded(now) {
  if (!lastEventAt) {
    lastEventAt = now;
    return;
  }
  const gap = now - lastEventAt;
  if (gap >= MIN_WAIT_MS) actions.push({ type: 'wait', ms: gap });
  lastEventAt = now;
}

function onKeydown(e) {
  const now = Date.now();
  pushWaitIfNeeded(now);
  const key = uiohookCodeToName(e.keycode);
  if (key) actions.push({ type: 'keyboardKey', key, method: 'down' });
}

function onKeyup(e) {
  const now = Date.now();
  pushWaitIfNeeded(now);
  const key = uiohookCodeToName(e.keycode);
  if (key) actions.push({ type: 'keyboardKey', key, method: 'up' });
}

function onMousedown(e) {
  const now = Date.now();
  pushWaitIfNeeded(now);
  actions.push({ type: 'mouseButton', button: MOUSE_BUTTON_NAMES[e.button] || 'left', method: 'down', x: e.x, y: e.y });
}

function onMouseup(e) {
  const now = Date.now();
  pushWaitIfNeeded(now);
  actions.push({ type: 'mouseButton', button: MOUSE_BUTTON_NAMES[e.button] || 'left', method: 'up', x: e.x, y: e.y });
}

function onMousemove(e) {
  const now = Date.now();
  if (now - lastMouseMoveSampleAt < MOUSEMOVE_SAMPLE_MS) return;
  lastMouseMoveSampleAt = now;
  pushWaitIfNeeded(now);
  actions.push({ type: 'moveMouse', x: e.x, y: e.y });
}

function start() {
  if (recording) return;
  recording = true;
  actions = [];
  lastEventAt = 0;
  lastMouseMoveSampleAt = 0;

  uIOhook.on('keydown', onKeydown);
  uIOhook.on('keyup', onKeyup);
  uIOhook.on('mousedown', onMousedown);
  uIOhook.on('mouseup', onMouseup);
  uIOhook.on('mousemove', onMousemove);
  uIOhook.start();
}

function stop() {
  if (!recording) return [];
  recording = false;
  uIOhook.stop();
  uIOhook.removeListener('keydown', onKeydown);
  uIOhook.removeListener('keyup', onKeyup);
  uIOhook.removeListener('mousedown', onMousedown);
  uIOhook.removeListener('mouseup', onMouseup);
  uIOhook.removeListener('mousemove', onMousemove);
  return actions;
}

function isRecording() {
  return recording;
}

module.exports = { start, stop, isRecording };
