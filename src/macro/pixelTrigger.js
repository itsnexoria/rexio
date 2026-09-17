const { screen, Point } = require('@nut-tree-fork/nut-js');

// macroId -> { timer, wasMatching } so re-syncing can tear down cleanly and
// so a trigger fires once when the color starts matching, not every poll
// while it continues to match.
const active = new Map();

function hexToRgb(hex) {
  const clean = (hex || '').replace('#', '');
  const n = parseInt(clean, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function colorMatches(sample, target, tolerance) {
  return (
    Math.abs(sample.R - target.r) <= tolerance &&
    Math.abs(sample.G - target.g) <= tolerance &&
    Math.abs(sample.B - target.b) <= tolerance
  );
}

// onTrigger(macroId) is called once each time the pixel transitions into a match.
function syncAll(macros, onTrigger) {
  for (const entry of active.values()) clearInterval(entry.timer);
  active.clear();

  for (const macro of macros) {
    const t = macro.pixelTrigger;
    if (!t || !t.enabled) continue;
    const target = hexToRgb(t.color);
    const tolerance = Number.isFinite(t.tolerance) ? t.tolerance : 10;
    const pollMs = Math.max(100, t.pollMs || 300);

    const entry = { wasMatching: false };
    entry.timer = setInterval(async () => {
      try {
        const sample = await screen.colorAt(new Point(t.x, t.y));
        const matches = colorMatches(sample, target, tolerance);
        if (matches && !entry.wasMatching) onTrigger(macro.id);
        entry.wasMatching = matches;
      } catch {
        // Screen read can transiently fail (e.g. display sleeping) — skip this tick.
      }
    }, pollMs);
    active.set(macro.id, entry);
  }
}

function unregisterAll() {
  for (const entry of active.values()) clearInterval(entry.timer);
  active.clear();
}

module.exports = { syncAll, unregisterAll };
