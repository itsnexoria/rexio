const { globalShortcut } = require('electron');

// macroId -> accelerator string currently registered, so re-syncing after an
// edit can cleanly unregister the old binding first.
const registered = new Map();

// Reserved for the emergency release-all shortcut (see main.js) — a macro
// can never claim it, so there's always a way out of a stuck loop.
const RESERVED_ACCELERATOR = 'CommandOrControl+Shift+Escape';

// onTrigger(macroId) is called whenever a bound hotkey fires.
function syncAll(macros, onTrigger) {
  for (const id of registered.keys()) {
    globalShortcut.unregister(registered.get(id));
  }
  registered.clear();

  for (const macro of macros) {
    if (!macro.hotkey || macro.hotkey === RESERVED_ACCELERATOR) continue;
    try {
      const ok = globalShortcut.register(macro.hotkey, () => onTrigger(macro.id));
      if (ok) registered.set(macro.id, macro.hotkey);
    } catch {
      // Invalid/unavailable accelerator (e.g. already claimed by the OS) —
      // leave it unbound rather than crashing the sync.
    }
  }
}

function unregisterAll() {
  globalShortcut.unregisterAll();
  registered.clear();
}

module.exports = { syncAll, unregisterAll, RESERVED_ACCELERATOR };
