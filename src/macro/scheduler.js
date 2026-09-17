// macroId -> { timer, kind } so re-syncing can tear down cleanly.
const active = new Map();

function msUntilNextTime(hhmm) {
  const [h, m] = (hhmm || '00:00').split(':').map(Number);
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}

function clearEntry(id) {
  const entry = active.get(id);
  if (!entry) return;
  clearTimeout(entry.timer);
  clearInterval(entry.timer);
  active.delete(id);
}

// onTrigger(macroId) is called whenever a macro's schedule fires.
function syncAll(macros, onTrigger) {
  for (const id of [...active.keys()]) clearEntry(id);

  for (const macro of macros) {
    const s = macro.schedule;
    if (!s || !s.enabled) continue;

    if (s.kind === 'interval' && s.intervalMinutes > 0) {
      const timer = setInterval(() => onTrigger(macro.id), Math.max(1, s.intervalMinutes) * 60000);
      active.set(macro.id, { timer, kind: 'interval' });
    } else if (s.kind === 'time' && s.atTime) {
      const scheduleNext = () => {
        const timer = setTimeout(() => {
          onTrigger(macro.id);
          scheduleNext(); // re-arm for the same time tomorrow
        }, msUntilNextTime(s.atTime));
        active.set(macro.id, { timer, kind: 'time' });
      };
      scheduleNext();
    }
  }
}

function unregisterAll() {
  for (const id of [...active.keys()]) clearEntry(id);
}

module.exports = { syncAll, unregisterAll };
