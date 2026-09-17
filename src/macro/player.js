const { keyboard, mouse, screen, Point, Button } = require('@nut-tree-fork/nut-js');
const { nameToNutKey } = require('./keymap');
const macroStore = require('./macroStore');

keyboard.config.autoDelayMs = 0;
mouse.config.autoDelayMs = 0;

const NUT_BUTTON = { left: Button.LEFT, right: Button.RIGHT, middle: Button.MIDDLE };
const MAX_NEST_DEPTH = 5; // guards against "run macro" chains that are absurdly deep, on top of the cycle check

let playing = false;
let cancelRequested = false;

// Tracks whatever is currently held down mid-macro so the panic release can
// let go of exactly those, rather than guessing or releasing everything.
const heldKeys = new Set();
const heldButtons = new Set();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jitter(amount) {
  if (!amount) return 0;
  return (Math.random() * 2 - 1) * amount;
}

// A macro recorded on one display produces garbage absolute coordinates when
// played back on a different resolution, or a different monitor in a
// multi-monitor setup. `recordedBounds` is the display's bounds (in global
// desktop coordinates) at record time; `currentBounds` is wherever that same
// logical display (or the chosen fallback) sits now. Coordinates are mapped
// display-relative, then rescaled, then re-offset into the current display.
function scalePoint(x, y, macroOpts, currentBounds) {
  if (!macroOpts?.scaleToScreen || !currentBounds) return { x, y };
  const recordedBounds = macroOpts.screenSize?.bounds
    || (macroOpts.screenSize?.width ? { x: 0, y: 0, width: macroOpts.screenSize.width, height: macroOpts.screenSize.height } : null);
  if (!recordedBounds || !recordedBounds.width || !recordedBounds.height) return { x, y };
  const sx = currentBounds.width / recordedBounds.width;
  const sy = currentBounds.height / recordedBounds.height;
  return {
    x: Math.round(currentBounds.x + (x - recordedBounds.x) * sx),
    y: Math.round(currentBounds.y + (y - recordedBounds.y) * sy),
  };
}

async function resolveTarget(action, macroOpts, currentBounds) {
  let target;
  if (action.relative) {
    const cur = await mouse.getPosition();
    target = { x: cur.x + action.x, y: cur.y + action.y };
  } else {
    target = scalePoint(action.x, action.y, macroOpts, currentBounds);
  }
  const px = macroOpts?.jitter?.enabled ? macroOpts.jitter.px || 0 : 0;
  if (px) {
    target = { x: Math.round(target.x + jitter(px)), y: Math.round(target.y + jitter(px)) };
  }
  return target;
}

function hexToRgb(hex) {
  const clean = (hex || '').replace('#', '');
  const n = parseInt(clean, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function colorMatches(sample, target, tolerance) {
  return (
    Math.abs(sample.R - target.r) <= tolerance
    && Math.abs(sample.G - target.g) <= tolerance
    && Math.abs(sample.B - target.b) <= tolerance
  );
}

async function runAction(action, ctx) {
  const { speed = 1, macroOpts = {}, currentBounds = null, visited = new Set(), depth = 0 } = ctx;

  switch (action.type) {
    case 'text':
      await keyboard.type(action.text || '');
      return;
    case 'wait': {
      let ms = Math.max(0, action.ms / speed);
      if (macroOpts.jitter?.enabled) ms = Math.max(0, ms + jitter(macroOpts.jitter.ms || 0));
      await sleep(ms);
      return;
    }
    case 'moveMouse': {
      const target = await resolveTarget(action, macroOpts, currentBounds);
      await mouse.setPosition(new Point(target.x, target.y));
      return;
    }
    case 'mouseButton': {
      const btn = NUT_BUTTON[action.button] || Button.LEFT;
      const target = await resolveTarget(action, macroOpts, currentBounds);
      await mouse.setPosition(new Point(target.x, target.y));
      if (action.method === 'press') {
        await mouse.pressButton(btn);
        await mouse.releaseButton(btn);
      } else if (action.method === 'down') {
        await mouse.pressButton(btn);
        heldButtons.add(action.button);
      } else {
        await mouse.releaseButton(btn);
        heldButtons.delete(action.button);
      }
      return;
    }
    case 'keyboardKey': {
      const key = nameToNutKey(action.key);
      if (key == null) return; // unmapped key — skip rather than throw mid-macro
      if (action.method === 'press') {
        await keyboard.pressKey(key);
        await keyboard.releaseKey(key);
      } else if (action.method === 'down') {
        await keyboard.pressKey(key);
        heldKeys.add(action.key);
      } else {
        await keyboard.releaseKey(key);
        heldKeys.delete(action.key);
      }
      return;
    }
    case 'keyCombo': {
      // Chord: press every key in order, then release in reverse order —
      // e.g. Ctrl, Shift, A down; then A, Shift, Ctrl up.
      const keys = (action.keys || []).map(nameToNutKey).filter((k) => k != null);
      for (const key of keys) await keyboard.pressKey(key);
      for (const key of [...keys].reverse()) await keyboard.releaseKey(key);
      return;
    }
    case 'waitForPixel': {
      // Blocks until the pixel matches (or times out), for macros that need
      // to react to something on screen instead of guessing a fixed delay —
      // e.g. "wait until the loading screen is gone" instead of `wait 8000`.
      const target = hexToRgb(action.color);
      const tolerance = Number.isFinite(action.tolerance) ? action.tolerance : 10;
      const pollMs = Math.max(50, action.pollMs || 200);
      const deadline = Date.now() + Math.max(0, action.timeoutMs ?? 10000);
      while (Date.now() < deadline && !cancelRequested) {
        try {
          const sample = await screen.colorAt(new Point(action.x, action.y));
          if (colorMatches(sample, target, tolerance)) return;
        } catch {
          // Transient read failure — keep polling until the deadline.
        }
        await sleep(pollMs);
      }
      return; // timed out — proceed anyway rather than hanging the macro forever
    }
    case 'runMacro': {
      if (depth >= MAX_NEST_DEPTH || visited.has(action.macroId)) return; // cycle/depth guard
      const sub = macroStore.getMacro(action.macroId);
      if (!sub) return;
      const nextVisited = new Set(visited);
      nextVisited.add(action.macroId);
      // A nested macro's own "loop until stopped" would hang the parent forever — cap it to its numeric loop count.
      const subLoops = sub.loopForever ? 1 : Math.max(1, sub.loops || 1);
      for (let i = 0; i < subLoops && !cancelRequested; i++) {
        for (const subAction of sub.actions) {
          if (cancelRequested) break;
          await runAction(subAction, { speed, macroOpts, currentBounds, visited: nextVisited, depth: depth + 1 });
        }
      }
      return;
    }
    default:
      return;
  }
}

// loops: number of times to run the action list, or Infinity until stop() is called.
// speed: >1 plays faster (shrinks waits), <1 plays slower.
// macroOpts: { scaleToScreen, screenSize, jitter: { enabled, ms, px } } — carried
// from the macro record so absolute coordinates/waits can be adjusted at playback.
// currentBounds: the display's current bounds to scale into (resolved by the
// caller, which has access to Electron's `screen` — this module only has nut-js's).
// startIndex: skip straight to this step on the first loop pass, for the
// editor's "run from here" debugging control. Later loop passes start at 0.
// onStep(index): called right before each top-level action runs, for the
// editor's live step highlight. Optional. Not called for nested runMacro steps.
async function play(actions, { loops = 1, speed = 1, macroOpts = {}, currentBounds = null, startIndex = 0, onStep = null } = {}) {
  if (playing) throw new Error('A macro is already playing');
  playing = true;
  cancelRequested = false;
  try {
    for (let i = 0; i < loops && !cancelRequested; i++) {
      const from = i === 0 ? Math.max(0, Math.min(startIndex, actions.length)) : 0;
      for (let idx = from; idx < actions.length; idx++) {
        if (cancelRequested) break;
        if (onStep) onStep(idx);
        await runAction(actions[idx], { speed, macroOpts, currentBounds, visited: new Set(), depth: 0 });
      }
    }
  } finally {
    playing = false;
    cancelRequested = false;
    if (onStep) onStep(-1); // signal completion so the UI can clear its highlight
  }
}

// Runs one action in isolation, for the editor's "Test step" button. Ignores
// screen scaling (the point on screen right now is what the user picked).
async function runSingle(action) {
  if (playing) throw new Error('A macro is already playing');
  await runAction(action, { speed: 1, macroOpts: {}, currentBounds: null, visited: new Set(), depth: 0 });
}

// For the pixel-trigger picker in the editor: sample the color under the
// cursor right now, e.g. after the user hovers a UI element in their game.
async function pickPixelUnderCursor() {
  const pos = await mouse.getPosition();
  const color = await screen.colorAt(new Point(pos.x, pos.y));
  const hex = `#${[color.R, color.G, color.B].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
  return { x: pos.x, y: pos.y, color: hex };
}

function stop() {
  cancelRequested = true;
}

function isPlaying() {
  return playing;
}

// Emergency release: lets go of every key/button this module believes is
// currently held, then stops playback. Doesn't know about input the OS or
// another app is holding — only what runAction put down.
async function panicReleaseAll() {
  cancelRequested = true;
  const keyReleases = [...heldKeys].map((name) => {
    const key = nameToNutKey(name);
    heldKeys.delete(name);
    return key == null ? Promise.resolve() : keyboard.releaseKey(key).catch(() => {});
  });
  const buttonReleases = [...heldButtons].map((name) => {
    const btn = NUT_BUTTON[name];
    heldButtons.delete(name);
    return btn == null ? Promise.resolve() : mouse.releaseButton(btn).catch(() => {});
  });
  await Promise.all([...keyReleases, ...buttonReleases]);
}

module.exports = { play, runSingle, pickPixelUnderCursor, stop, isPlaying, panicReleaseAll };
