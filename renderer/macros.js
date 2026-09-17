const macroList = document.getElementById('macroList');
const macroEmptyState = document.getElementById('macroEmptyState');
const macroNoResults = document.getElementById('macroNoResults');
const recordMacroBtn = document.getElementById('recordMacroBtn');
const newMacroBtn = document.getElementById('newMacroBtn');
const importMacroBtn = document.getElementById('importMacroBtn');
const waylandBanner = document.getElementById('waylandBanner');
const macroSearchInput = document.getElementById('macroSearchInput');
const killSwitchCheckbox = document.getElementById('macroKillSwitch');

const editorOverlay = document.getElementById('macroEditorOverlay');
const editorNameInput = document.getElementById('macroEditorName');
const editorTagsInput = document.getElementById('macroEditorTags');
const editorLastRun = document.getElementById('macroLastRun');
const editorList = document.getElementById('macroEditorList');
const editorEmpty = document.getElementById('macroEditorEmpty');
const editorCancelBtn = document.getElementById('macroEditorCancel');
const editorSaveBtn = document.getElementById('macroEditorSave');
const timelineEl = document.getElementById('macroTimeline');
const undoBtn = document.getElementById('macroUndoBtn');
const redoBtn = document.getElementById('macroRedoBtn');
const copyAllBtn = document.getElementById('macroCopyAllBtn');
const pasteBtn = document.getElementById('macroPasteBtn');
const exportBtn = document.getElementById('macroExportBtn');
const validateBtn = document.getElementById('macroValidateBtn');
const statsEl = document.getElementById('macroStats');
const appendRecordBtn = document.getElementById('macroAppendRecordBtn');
const addRunMacroBtn = document.getElementById('macroAddRunMacroBtn');
const runMacroPicker = document.getElementById('macroRunMacroPicker');

const loopsInput = document.getElementById('macroLoops');
const loopForeverInput = document.getElementById('macroLoopForever');
const speedSelect = document.getElementById('macroSpeed');
const scaleToggle = document.getElementById('macroScaleToggle');
const targetDisplaySelect = document.getElementById('macroTargetDisplay');
const jitterToggle = document.getElementById('macroJitterToggle');
const jitterMsInput = document.getElementById('macroJitterMs');
const jitterPxInput = document.getElementById('macroJitterPx');
const confirmToggle = document.getElementById('macroConfirmToggle');

const pixelToggle = document.getElementById('macroPixelToggle');
const pixelFields = document.getElementById('macroPixelFields');
const pixelX = document.getElementById('macroPixelX');
const pixelY = document.getElementById('macroPixelY');
const pixelColor = document.getElementById('macroPixelColor');
const pixelTolerance = document.getElementById('macroPixelTolerance');
const pixelPoll = document.getElementById('macroPixelPoll');
const pixelPickBtn = document.getElementById('macroPixelPick');

const scheduleToggle = document.getElementById('macroScheduleToggle');
const scheduleFields = document.getElementById('macroScheduleFields');
const scheduleKindSelect = document.getElementById('macroScheduleKind');
const scheduleIntervalWrap = document.getElementById('macroScheduleIntervalWrap');
const scheduleIntervalInput = document.getElementById('macroScheduleInterval');
const scheduleTimeWrap = document.getElementById('macroScheduleTimeWrap');
const scheduleTimeInput = document.getElementById('macroScheduleTime');

const versionSelect = document.getElementById('macroVersionSelect');
const restoreVersionBtn = document.getElementById('macroRestoreVersionBtn');

const bulkBar = document.getElementById('macroBulkBar');
const bulkCountEl = document.getElementById('macroBulkCount');
const bulkTagInput = document.getElementById('macroBulkTagInput');
const bulkTagBtn = document.getElementById('macroBulkTagBtn');
const bulkExportBtn = document.getElementById('macroBulkExportBtn');
const bulkDeleteBtn = document.getElementById('macroBulkDeleteBtn');
const bulkClearBtn = document.getElementById('macroBulkClearBtn');

const RESERVED_ACCELERATOR = 'CommandOrControl+Shift+Escape';
// Combos that are risky to steal system/OS-wide — not blocked, just warned about.
const RISKY_ACCELERATORS = new Set([
  'Alt+F4', 'CommandOrControl+W', 'CommandOrControl+Q', 'CommandOrControl+Alt+Delete',
  'Super+L', 'CommandOrControl+Alt+L',
]);

// Fallback in case the getKeyNames round-trip hasn't resolved yet — kept in
// sync with src/macro/keymap.js's NAME_TO_NUT as a backstop, but the real
// source of truth is fetched from the main process below.
let KEY_NAMES = [
  'A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P','Q','R','S','T','U','V','W','X','Y','Z',
  '0','1','2','3','4','5','6','7','8','9',
  'F1','F2','F3','F4','F5','F6','F7','F8','F9','F10','F11','F12',
  'Space','Enter','Escape','Tab','Backspace','Delete','Insert','Home','End','PageUp','PageDown',
  'ArrowUp','ArrowDown','ArrowLeft','ArrowRight',
  'Shift','ShiftRight','Ctrl','CtrlRight','Alt','AltRight','Meta','MetaRight','CapsLock',
];
window.api.getKeyNames().then((names) => { if (Array.isArray(names) && names.length) KEY_NAMES = names; });

let macros = [];
let displays = [];
let searchTerm = '';
let selectedIds = new Set();
let recording = false;
let recordingScreenSize = null;
let appendRecording = false;
let capturingHotkeyFor = null;

// Editor draft state — null/empty when the overlay is closed.
let draftId = null;
let draftActions = [];
let draftScreenSize = null;
let scaleToScreen = true;
let pixelEnabled = false;
let jitterEnabled = false;
let scheduleEnabled = false;

// Undo/redo history for the step list, and a clipboard that survives closing
// one macro and opening another (both in-memory only, reset on app restart).
let history = [];
let future = [];
let stepClipboard = [];

function formatActionCount(actions) {
  const n = (actions || []).filter((a) => a.type !== 'wait').length;
  return `${n} step${n === 1 ? '' : 's'}`;
}

function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function acceleratorFromEvent(e) {
  const parts = [];
  if (e.ctrlKey) parts.push('CommandOrControl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  if (e.metaKey) parts.push('Super');
  const key = e.key;
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(key)) return null; // modifier alone isn't a usable accelerator
  const named = { ' ': 'Space', Escape: 'Escape', Enter: 'Enter', Tab: 'Tab' };
  const keyName = named[key] || (key.length === 1 ? key.toUpperCase() : key);
  parts.push(keyName);
  return parts.join('+');
}

function macroNameById(id) {
  return macros.find((m) => m.id === id)?.name || '(deleted macro)';
}

// ---------------------------------------------------------------------------
// Kill switch
// ---------------------------------------------------------------------------

async function loadKillSwitch() {
  killSwitchCheckbox.checked = await window.api.getKillSwitch();
}

killSwitchCheckbox.onchange = async () => {
  await window.api.setKillSwitch(killSwitchCheckbox.checked);
  toast(killSwitchCheckbox.checked ? 'All macro triggers disabled.' : 'Macro triggers re-enabled.');
};

window.api.onMacroKillSwitchChanged((disabled) => {
  killSwitchCheckbox.checked = disabled;
});

// ---------------------------------------------------------------------------
// Macro list (Macros tab)
// ---------------------------------------------------------------------------

function triggerSummary(macro) {
  const parts = [];
  if (macro.hotkey) parts.push(macro.hotkey);
  if (macro.pixelTrigger?.enabled) parts.push(`pixel (${macro.pixelTrigger.x},${macro.pixelTrigger.y})`);
  if (macro.schedule?.enabled) {
    parts.push(macro.schedule.kind === 'time' ? `daily @ ${macro.schedule.atTime}` : `every ${macro.schedule.intervalMinutes}m`);
  }
  return parts.length ? parts.join(' · ') : 'none';
}

function runLogSummary(macro) {
  if (!macro.lastRun) return '';
  const { ok, at, error } = macro.lastRun;
  return ok ? `Last run ${timeAgo(at)}` : `Last run ${timeAgo(at)} failed: ${error || 'unknown error'}`;
}

function matchesSearch(macro, term) {
  if (!term) return true;
  const haystack = `${macro.name} ${(macro.tags || []).join(' ')}`.toLowerCase();
  return haystack.includes(term.toLowerCase());
}

function buildMacroRow(macro) {
  const li = document.createElement('li');
  li.className = 'account-card';
  const tagsHtml = (macro.tags || []).map((t) => `<span class="macro-tag-badge">${t}</span>`).join('');
  const runLog = runLogSummary(macro);
  li.innerHTML = `
    <input type="checkbox" class="macro-select-checkbox" ${selectedIds.has(macro.id) ? 'checked' : ''} />
    <div class="avatar-wrap"><div class="avatar">🎯</div></div>
    <div class="account-info">
      <div class="account-name">${macro.name} ${tagsHtml}</div>
      <div class="account-handle">${formatActionCount(macro.actions)} · Trigger: <span class="hotkey-label">${triggerSummary(macro)}</span></div>
      ${runLog ? `<div class="macro-last-run ${macro.lastRun.ok ? 'ok' : 'error'}">${runLog}</div>` : ''}
    </div>
    <div class="account-actions">
      <button class="btn-cancel" data-act="edit">Edit</button>
      <button class="btn-cancel" data-act="hotkey">Set hotkey</button>
      <button class="btn-launch" data-act="play">▶ Play</button>
      <button class="btn-delete" data-act="delete" title="Delete macro">✕</button>
    </div>
  `;

  li.querySelector('.macro-select-checkbox').onchange = (e) => {
    if (e.target.checked) selectedIds.add(macro.id);
    else selectedIds.delete(macro.id);
    updateBulkBar();
  };

  li.querySelector('[data-act="edit"]').onclick = () => openEditor(macro);

  li.querySelector('[data-act="play"]').onclick = async () => {
    if (macro.confirmBeforeRun) {
      const ok = await confirmDialog(`Run "${macro.name}"? This macro is flagged to confirm before running (it may type text or perform sensitive actions).`);
      if (!ok) return;
    }
    const result = await window.api.playMacro(macro.id);
    if (result && result.ok === false) toast(result.error || 'Playback failed', 'error');
    await loadMacros(); // refresh so the run-log line updates
  };

  li.querySelector('[data-act="delete"]').onclick = async () => {
    const ok = await confirmDialog(`Delete macro "${macro.name}"?`);
    if (!ok) return;
    macros = await window.api.deleteMacro(macro.id);
    renderMacros();
  };

  const hotkeyBtn = li.querySelector('[data-act="hotkey"]');
  hotkeyBtn.onclick = () => {
    if (capturingHotkeyFor === macro.id) return;
    capturingHotkeyFor = macro.id;
    hotkeyBtn.textContent = 'Press keys…';
    const label = li.querySelector('.hotkey-label');

    const onKeydown = async (e) => {
      e.preventDefault();
      if (e.key === 'Escape') {
        cleanup();
        return;
      }
      const accelerator = acceleratorFromEvent(e);
      if (!accelerator) return;
      if (accelerator === RESERVED_ACCELERATOR) {
        toast('That combo is reserved for the emergency release shortcut.', 'error');
        cleanup();
        return;
      }
      cleanup();
      if (RISKY_ACCELERATORS.has(accelerator)) {
        toast(`Heads up: ${accelerator} is normally an OS/app shortcut — binding it may have side effects.`, 'error');
      }
      const updated = await window.api.setMacroHotkey(macro.id, accelerator);
      if (updated) {
        label.textContent = triggerSummary(updated);
        const idx = macros.findIndex((m) => m.id === macro.id);
        if (idx >= 0) macros[idx] = updated;
      } else {
        toast('Could not register that hotkey — it may already be in use.', 'error');
      }
    };

    function cleanup() {
      document.removeEventListener('keydown', onKeydown, true);
      hotkeyBtn.textContent = 'Set hotkey';
      capturingHotkeyFor = null;
    }

    document.addEventListener('keydown', onKeydown, true);
  };

  return li;
}

function updateBulkBar() {
  // Drop selections for macros that no longer exist (deleted individually, etc).
  const validIds = new Set(macros.map((m) => m.id));
  selectedIds = new Set([...selectedIds].filter((id) => validIds.has(id)));
  bulkBar.hidden = selectedIds.size === 0;
  bulkCountEl.textContent = `${selectedIds.size} selected`;
}

function renderMacros() {
  const filtered = macros.filter((m) => matchesSearch(m, searchTerm));
  macroList.innerHTML = '';
  macroEmptyState.hidden = macros.length > 0;
  macroNoResults.hidden = !(macros.length > 0 && filtered.length === 0);
  filtered.forEach((m) => macroList.appendChild(buildMacroRow(m)));
  updateBulkBar();
}

async function loadMacros() {
  macros = await window.api.listMacros();
  renderMacros();
}

async function loadDisplays() {
  displays = await window.api.getDisplays();
}

macroSearchInput.oninput = () => {
  searchTerm = macroSearchInput.value.trim();
  renderMacros();
};

async function checkWaylandBanner() {
  try {
    const info = await window.api.getSessionInfo();
    waylandBanner.hidden = !info.isWayland;
  } catch {
    waylandBanner.hidden = true;
  }
}

recordMacroBtn.onclick = async () => {
  if (!recording) {
    recording = true;
    recordMacroBtn.textContent = '■ Stop recording';
    recordMacroBtn.classList.add('recording');
    recordingScreenSize = await window.api.startMacroRecording();
    toast('Recording — perform the mouse/keyboard sequence, then stop.');
    return;
  }

  recording = false;
  recordMacroBtn.textContent = '● Record new macro';
  recordMacroBtn.classList.remove('recording');
  const actions = await window.api.stopMacroRecording();

  if (!actions || actions.length === 0) {
    toast('Nothing was recorded.', 'error');
    return;
  }

  openEditor({ name: 'New macro', actions, screenSize: recordingScreenSize });
};

newMacroBtn.onclick = async () => {
  const screenSize = await window.api.getScreenSize();
  openEditor({ name: 'New macro', actions: [], screenSize });
};

importMacroBtn.onclick = async () => {
  const result = await window.api.importMacro();
  if (result.canceled) return;
  if (result.imported?.length) {
    macros.push(...result.imported);
    renderMacros();
    toast(`Imported ${result.imported.length} macro(s).`);
  }
  if (result.errors?.length) {
    toast(`Some files failed to import: ${result.errors.join('; ')}`, 'error');
  }
};

bulkClearBtn.onclick = () => {
  selectedIds = new Set();
  renderMacros();
};

bulkTagBtn.onclick = async () => {
  const tag = bulkTagInput.value.trim();
  if (!tag) {
    toast('Type a tag first.', 'error');
    return;
  }
  macros = await window.api.bulkAddMacroTag([...selectedIds], tag);
  bulkTagInput.value = '';
  renderMacros();
  toast(`Tagged ${selectedIds.size} macro(s) with "${tag}".`);
};

bulkExportBtn.onclick = async () => {
  for (const id of selectedIds) {
    const result = await window.api.exportMacro(id);
    if (result.canceled) break; // user backed out of the save dialog — stop the batch
  }
};

bulkDeleteBtn.onclick = async () => {
  const ok = await confirmDialog(`Delete ${selectedIds.size} selected macro(s)? This can't be undone.`);
  if (!ok) return;
  macros = await window.api.bulkDeleteMacros([...selectedIds]);
  selectedIds = new Set();
  renderMacros();
  toast('Selected macros deleted.');
};

// ---------------------------------------------------------------------------
// Live playback feedback: highlight the step currently running, if its
// macro happens to be open in the editor right now.
// ---------------------------------------------------------------------------

window.api.onMacroProgress(({ macroId, index }) => {
  if (macroId !== draftId) return;
  editorList.querySelectorAll('.macro-step.active-step').forEach((el) => el.classList.remove('active-step'));
  if (index >= 0) {
    const row = editorList.querySelector(`.macro-step[data-idx="${index}"]`);
    if (row) row.scrollIntoView({ block: 'nearest' });
    if (row) row.classList.add('active-step');
  }
});

window.api.onMacroPanicked(() => {
  toast('Panic release: all macro-held keys and mouse buttons were released.', 'error');
});

// ---------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------

function pushHistory() {
  history.push(JSON.stringify(draftActions));
  if (history.length > 50) history.shift();
  future = [];
  updateHistoryButtons();
}

function updateHistoryButtons() {
  undoBtn.disabled = history.length === 0;
  redoBtn.disabled = future.length === 0;
}

function undo() {
  if (!history.length) return;
  future.push(JSON.stringify(draftActions));
  draftActions = JSON.parse(history.pop());
  updateHistoryButtons();
  renderEditorList();
}

function redo() {
  if (!future.length) return;
  history.push(JSON.stringify(draftActions));
  draftActions = JSON.parse(future.pop());
  updateHistoryButtons();
  renderEditorList();
}

function defaultActionFor(type) {
  switch (type) {
    case 'moveMouse': return { type: 'moveMouse', x: 0, y: 0, relative: false };
    case 'mouseButton': return { type: 'mouseButton', button: 'left', method: 'press', x: 0, y: 0, relative: false };
    case 'keyboardKey': return { type: 'keyboardKey', key: 'A', method: 'press' };
    case 'keyCombo': return { type: 'keyCombo', keys: ['Ctrl', 'C'] };
    case 'text': return { type: 'text', text: '' };
    case 'wait': return { type: 'wait', ms: 500 };
    case 'waitForPixel': return { type: 'waitForPixel', x: 0, y: 0, color: '#ff0000', tolerance: 10, timeoutMs: 10000, pollMs: 200 };
    default: return null;
  }
}

function actionSummary(action) {
  switch (action.type) {
    case 'moveMouse': return 'Move mouse';
    case 'mouseButton': return 'Mouse click';
    case 'keyboardKey': return 'Key press';
    case 'keyCombo': return 'Key combo';
    case 'text': return 'Type text';
    case 'wait': return 'Wait';
    case 'waitForPixel': return 'Wait for pixel';
    case 'runMacro': return 'Run macro';
    default: return action.type;
  }
}

function fieldsHtmlFor(action, idx) {
  switch (action.type) {
    case 'moveMouse':
      return `
        <label>X <input type="number" data-field="x" data-idx="${idx}" value="${action.x}" /></label>
        <label>Y <input type="number" data-field="y" data-idx="${idx}" value="${action.y}" /></label>
        <label class="checkbox"><input type="checkbox" data-field="relative" data-idx="${idx}" ${action.relative ? 'checked' : ''} /> Relative</label>
        <button class="btn-cancel small" data-pick="${idx}">Pick position</button>
      `;
    case 'mouseButton':
      return `
        <label>Button
          <select data-field="button" data-idx="${idx}">
            ${['left', 'right', 'middle'].map((b) => `<option value="${b}" ${action.button === b ? 'selected' : ''}>${b}</option>`).join('')}
          </select>
        </label>
        <label>Action
          <select data-field="method" data-idx="${idx}">
            ${['press', 'down', 'up'].map((m) => `<option value="${m}" ${action.method === m ? 'selected' : ''}>${m}</option>`).join('')}
          </select>
        </label>
        <label>X <input type="number" data-field="x" data-idx="${idx}" value="${action.x}" /></label>
        <label>Y <input type="number" data-field="y" data-idx="${idx}" value="${action.y}" /></label>
        <label class="checkbox"><input type="checkbox" data-field="relative" data-idx="${idx}" ${action.relative ? 'checked' : ''} /> Relative</label>
        <button class="btn-cancel small" data-pick="${idx}">Pick position</button>
      `;
    case 'keyboardKey':
      return `
        <label>Key
          <select data-field="key" data-idx="${idx}">
            ${KEY_NAMES.map((k) => `<option value="${k}" ${action.key === k ? 'selected' : ''}>${k}</option>`).join('')}
          </select>
        </label>
        <label>Action
          <select data-field="method" data-idx="${idx}">
            ${['press', 'down', 'up'].map((m) => `<option value="${m}" ${action.method === m ? 'selected' : ''}>${m}</option>`).join('')}
          </select>
        </label>
      `;
    case 'text':
      return `<label class="grow">Text <input type="text" data-field="text" data-idx="${idx}" value="${(action.text || '').replace(/"/g, '&quot;')}" /></label>`;
    case 'wait':
      return `<label>Milliseconds <input type="number" min="0" data-field="ms" data-idx="${idx}" value="${action.ms}" /></label>`;
    case 'keyCombo':
      return `<label class="grow">Keys, comma-separated (e.g. Ctrl,Shift,A)
          <input type="text" data-field="keysText" data-idx="${idx}" value="${(action.keys || []).join(',')}" />
        </label>`;
    case 'waitForPixel':
      return `
        <label>X <input type="number" data-field="x" data-idx="${idx}" value="${action.x}" /></label>
        <label>Y <input type="number" data-field="y" data-idx="${idx}" value="${action.y}" /></label>
        <label>Color <input type="color" data-field="color" data-idx="${idx}" value="${action.color}" /></label>
        <label>Tolerance <input type="number" min="0" max="255" data-field="tolerance" data-idx="${idx}" value="${action.tolerance}" /></label>
        <label>Timeout (ms) <input type="number" min="0" data-field="timeoutMs" data-idx="${idx}" value="${action.timeoutMs}" /></label>
        <button class="btn-cancel small" data-pick-pixel="${idx}">Pick pixel under cursor</button>
      `;
    case 'runMacro':
      return `
        <label class="grow">Macro
          <select data-field="macroId" data-idx="${idx}">
            ${macros.filter((m) => m.id !== draftId).map((m) => `<option value="${m.id}" ${action.macroId === m.id ? 'selected' : ''}>${m.name}</option>`).join('')}
          </select>
        </label>
      `;
    default:
      return '';
  }
}

function buildEditorRow(action, idx) {
  const li = document.createElement('li');
  li.className = 'macro-step';
  li.draggable = true;
  li.dataset.idx = idx;
  li.innerHTML = `
    <span class="drag-handle">⠿</span>
    <span class="macro-step-type">${actionSummary(action)}</span>
    <div class="macro-step-fields">${fieldsHtmlFor(action, idx)}</div>
    <div class="macro-step-actions">
      <button class="btn-cancel small" data-test title="Run just this step">▶</button>
      <button class="btn-cancel small" data-run-from title="Run macro starting from here (save first)">⏭</button>
      <button class="btn-cancel small" data-dup title="Duplicate">⧉</button>
      <button class="btn-cancel small" data-move="up" title="Move up">↑</button>
      <button class="btn-cancel small" data-move="down" title="Move down">↓</button>
      <button class="btn-delete" data-remove title="Remove step">✕</button>
    </div>
  `;

  li.querySelectorAll('[data-field]').forEach((input) => {
    input.addEventListener('change', () => {
      pushHistory();
      const field = input.dataset.field;
      if (field === 'keysText') {
        draftActions[idx].keys = input.value.split(',').map((k) => k.trim()).filter(Boolean);
        return;
      }
      let value;
      if (input.type === 'checkbox') value = input.checked;
      else if (input.type === 'number') value = Number(input.value);
      else value = input.value;
      draftActions[idx][field] = value;
    });
  });

  const testBtn = li.querySelector('[data-test]');
  if (action.type === 'runMacro') {
    testBtn.disabled = true;
    testBtn.title = 'Use ▶ Play on the macro list to test a nested macro';
  } else {
    testBtn.onclick = async () => {
      const result = await window.api.testMacroAction(draftActions[idx]);
      if (result && result.ok === false) toast(result.error || 'Test failed', 'error');
    };
  }

  const runFromBtn = li.querySelector('[data-run-from]');
  runFromBtn.onclick = async () => {
    if (!draftId) {
      toast('Save the macro first, then you can run from a specific step.', 'error');
      return;
    }
    const result = await window.api.playMacroFrom(draftId, idx);
    if (result && result.ok === false) toast(result.error || 'Playback failed', 'error');
  };

  const pickPixelBtn = li.querySelector('[data-pick-pixel]');
  if (pickPixelBtn) {
    pickPixelBtn.onclick = async () => {
      pickPixelBtn.disabled = true;
      let secondsLeft = 3;
      pickPixelBtn.textContent = `Hover target… ${secondsLeft}`;
      const timer = setInterval(() => {
        secondsLeft -= 1;
        if (secondsLeft > 0) pickPixelBtn.textContent = `Hover target… ${secondsLeft}`;
      }, 1000);
      await new Promise((r) => setTimeout(r, 3000));
      clearInterval(timer);
      const { x, y, color } = await window.api.pickPixel();
      pushHistory();
      draftActions[idx].x = x;
      draftActions[idx].y = y;
      draftActions[idx].color = color;
      renderEditorList();
    };
  }

  li.querySelector('[data-dup]').onclick = () => {
    pushHistory();
    draftActions.splice(idx + 1, 0, JSON.parse(JSON.stringify(draftActions[idx])));
    renderEditorList();
  };

  const pickBtn = li.querySelector('[data-pick]');
  if (pickBtn) {
    pickBtn.onclick = async () => {
      pickBtn.disabled = true;
      let secondsLeft = 3;
      pickBtn.textContent = `Move mouse… ${secondsLeft}`;
      const timer = setInterval(() => {
        secondsLeft -= 1;
        if (secondsLeft > 0) pickBtn.textContent = `Move mouse… ${secondsLeft}`;
      }, 1000);
      await new Promise((r) => setTimeout(r, 3000));
      clearInterval(timer);
      const pos = await window.api.getCursorPos();
      pushHistory();
      draftActions[idx].x = pos.x;
      draftActions[idx].y = pos.y;
      renderEditorList();
    };
  }

  li.querySelector('[data-move="up"]').onclick = () => {
    if (idx === 0) return;
    pushHistory();
    [draftActions[idx - 1], draftActions[idx]] = [draftActions[idx], draftActions[idx - 1]];
    renderEditorList();
  };
  li.querySelector('[data-move="down"]').onclick = () => {
    if (idx === draftActions.length - 1) return;
    pushHistory();
    [draftActions[idx + 1], draftActions[idx]] = [draftActions[idx], draftActions[idx + 1]];
    renderEditorList();
  };
  li.querySelector('[data-remove]').onclick = () => {
    pushHistory();
    draftActions.splice(idx, 1);
    renderEditorList();
  };

  // Drag-to-reorder, matching the account list's interaction pattern.
  li.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('text/plain', String(idx));
    li.classList.add('dragging');
  });
  li.addEventListener('dragend', () => li.classList.remove('dragging'));
  li.addEventListener('dragover', (e) => e.preventDefault());
  li.addEventListener('drop', (e) => {
    e.preventDefault();
    const from = Number(e.dataTransfer.getData('text/plain'));
    if (from === idx) return;
    pushHistory();
    const [moved] = draftActions.splice(from, 1);
    draftActions.splice(idx, 0, moved);
    renderEditorList();
  });

  return li;
}

// Quick visual overview: one colored segment per step, wait steps sized
// (capped) by duration so long pauses are visible at a glance.
function renderTimeline() {
  timelineEl.innerHTML = '';
  draftActions.forEach((action) => {
    const seg = document.createElement('div');
    seg.className = `macro-timeline-seg ${action.type}`;
    seg.title = actionSummary(action);
    if (action.type === 'wait') {
      seg.style.width = `${Math.min(120, Math.max(6, action.ms / 20))}px`;
    } else {
      seg.style.width = '14px';
    }
    timelineEl.appendChild(seg);
  });
}

function renderEditorList() {
  editorList.innerHTML = '';
  editorEmpty.hidden = draftActions.length > 0;
  draftActions.forEach((action, idx) => editorList.appendChild(buildEditorRow(action, idx)));
  renderTimeline();
}

function setScaleToggle(on) {
  scaleToScreen = on;
  scaleToggle.classList.toggle('on', on);
}

function setPixelToggle(on) {
  pixelEnabled = on;
  pixelToggle.classList.toggle('on', on);
  pixelFields.hidden = !on;
}

function setJitterToggle(on) {
  jitterEnabled = on;
  jitterToggle.classList.toggle('on', on);
}

function setScheduleToggle(on) {
  scheduleEnabled = on;
  scheduleToggle.classList.toggle('on', on);
  scheduleFields.hidden = !on;
}

function updateScheduleKindFields() {
  const isTime = scheduleKindSelect.value === 'time';
  scheduleTimeWrap.hidden = !isTime;
  scheduleIntervalWrap.hidden = isTime;
}

function populateTargetDisplaySelect(currentTargetId, recordedDisplayId) {
  const auto = `<option value="">Auto (as recorded${recordedDisplayId != null ? '' : ', primary'})</option>`;
  const options = displays.map((d) => `<option value="${d.id}" ${currentTargetId === d.id ? 'selected' : ''}>${d.label}</option>`).join('');
  targetDisplaySelect.innerHTML = auto + options;
  if (!currentTargetId) targetDisplaySelect.value = '';
}

async function populateVersionSelect(id) {
  versionSelect.innerHTML = '<option value="">No previous versions</option>';
  if (!id) return;
  const versions = await window.api.getMacroVersions(id);
  versions.forEach((v) => {
    const opt = document.createElement('option');
    opt.value = v.at;
    opt.textContent = `${new Date(v.at).toLocaleString()} — "${v.name}" (${formatActionCount(v.actions)})`;
    versionSelect.appendChild(opt);
  });
}

function openEditor(macro) {
  draftId = macro.id || null;
  draftActions = JSON.parse(JSON.stringify(macro.actions || []));
  draftScreenSize = macro.screenSize || null;
  history = [];
  future = [];
  updateHistoryButtons();

  editorNameInput.value = macro.name || 'New macro';
  editorTagsInput.value = (macro.tags || []).join(', ');
  loopsInput.value = macro.loops || 1;
  loopForeverInput.checked = Boolean(macro.loopForever);
  speedSelect.value = String(macro.speed || 1);
  setScaleToggle(macro.scaleToScreen !== false);
  populateTargetDisplaySelect(macro.targetDisplayId ?? null, macro.screenSize?.displayId ?? null);

  setJitterToggle(Boolean(macro.jitter?.enabled));
  jitterMsInput.value = macro.jitter?.ms ?? 30;
  jitterPxInput.value = macro.jitter?.px ?? 2;

  confirmToggle.classList.toggle('on', Boolean(macro.confirmBeforeRun));

  const runLog = runLogSummary(macro);
  editorLastRun.hidden = !runLog;
  editorLastRun.textContent = runLog;
  editorLastRun.className = `settings-note macro-last-run ${macro.lastRun?.ok ? 'ok' : 'error'}`;

  if (macro.stats?.runCount) {
    const { runCount, successCount, totalMs } = macro.stats;
    const successPct = Math.round((successCount / runCount) * 100);
    const avgS = (totalMs / runCount / 1000).toFixed(1);
    statsEl.hidden = false;
    statsEl.textContent = `${runCount} run${runCount === 1 ? '' : 's'} · ${successPct}% success · avg ${avgS}s per run`;
  } else {
    statsEl.hidden = true;
  }

  const t = macro.pixelTrigger || {};
  setPixelToggle(Boolean(t.enabled));
  pixelX.value = t.x || 0;
  pixelY.value = t.y || 0;
  pixelColor.value = t.color || '#ff0000';
  pixelTolerance.value = Number.isFinite(t.tolerance) ? t.tolerance : 10;
  pixelPoll.value = t.pollMs || 300;

  const s = macro.schedule || {};
  setScheduleToggle(Boolean(s.enabled));
  scheduleKindSelect.value = s.kind || 'interval';
  scheduleIntervalInput.value = s.intervalMinutes || 30;
  scheduleTimeInput.value = s.atTime || '09:00';
  updateScheduleKindFields();

  populateVersionSelect(draftId);

  renderEditorList();
  editorOverlay.hidden = false;
}

function closeEditor() {
  if (appendRecording) stopAppendRecording(false);
  editorOverlay.hidden = true;
  draftId = null;
  draftActions = [];
}

document.querySelectorAll('.macro-add-bar [data-add]').forEach((btn) => {
  btn.onclick = () => {
    const action = defaultActionFor(btn.dataset.add);
    if (!action) return;
    pushHistory();
    draftActions.push(action);
    renderEditorList();
  };
});

addRunMacroBtn.onclick = () => {
  const choices = macros.filter((m) => m.id !== draftId);
  if (!choices.length) {
    toast('No other macros to run yet — create one first.', 'error');
    return;
  }
  runMacroPicker.innerHTML = '<option value="">Choose a macro to run…</option>'
    + choices.map((m) => `<option value="${m.id}">${m.name}</option>`).join('');
  runMacroPicker.hidden = false;
  runMacroPicker.focus();
};

runMacroPicker.onchange = () => {
  if (!runMacroPicker.value) return;
  pushHistory();
  draftActions.push({ type: 'runMacro', macroId: runMacroPicker.value });
  renderEditorList();
  runMacroPicker.hidden = true;
  runMacroPicker.value = '';
};

undoBtn.onclick = undo;
redoBtn.onclick = redo;

copyAllBtn.onclick = () => {
  stepClipboard = JSON.parse(JSON.stringify(draftActions));
  toast(`Copied ${stepClipboard.length} step(s).`);
};

pasteBtn.onclick = () => {
  if (!stepClipboard.length) {
    toast('Clipboard is empty — copy steps from a macro first.', 'error');
    return;
  }
  pushHistory();
  draftActions.push(...JSON.parse(JSON.stringify(stepClipboard)));
  renderEditorList();
};

exportBtn.onclick = async () => {
  if (!draftId) {
    toast('Save the macro first, then export it.', 'error');
    return;
  }
  const result = await window.api.exportMacro(draftId);
  if (result.canceled) return;
  if (result.ok) toast(`Exported to ${result.filePath}`);
  else toast(result.error || 'Export failed', 'error');
};

validateBtn.onclick = async () => {
  const issues = await window.api.validateMacro({ id: draftId, actions: draftActions });
  if (!issues.length) toast('No issues found.');
  else toast(issues.join(' '), 'error');
};

restoreVersionBtn.onclick = async () => {
  if (!versionSelect.value || !draftId) {
    toast('Pick a version to restore first.', 'error');
    return;
  }
  const ok = await confirmDialog('Restore this version? Your current unsaved edits in this editor will be discarded.');
  if (!ok) return;
  const restored = await window.api.restoreMacroVersion(draftId, Number(versionSelect.value));
  if (!restored) {
    toast('Could not restore that version.', 'error');
    return;
  }
  const idx = macros.findIndex((m) => m.id === restored.id);
  if (idx >= 0) macros[idx] = restored;
  openEditor(restored);
  toast('Version restored.');
};

async function stopAppendRecording(merge = true) {
  appendRecording = false;
  appendRecordBtn.textContent = '● Append recording';
  appendRecordBtn.classList.remove('recording');
  const actions = await window.api.stopMacroRecording();
  if (merge && actions?.length) {
    pushHistory();
    draftActions.push(...actions);
    renderEditorList();
    toast(`Appended ${formatActionCount(actions)}.`);
  }
}

appendRecordBtn.onclick = async () => {
  if (!appendRecording) {
    appendRecording = true;
    appendRecordBtn.textContent = '■ Stop appending';
    appendRecordBtn.classList.add('recording');
    await window.api.startMacroRecording();
    toast('Recording more steps for this macro — click Stop appending when done.');
    return;
  }
  await stopAppendRecording(true);
};

scaleToggle.onclick = () => setScaleToggle(!scaleToScreen);
pixelToggle.onclick = () => setPixelToggle(!pixelEnabled);
jitterToggle.onclick = () => setJitterToggle(!jitterEnabled);
scheduleToggle.onclick = () => setScheduleToggle(!scheduleEnabled);
confirmToggle.onclick = () => confirmToggle.classList.toggle('on');
scheduleKindSelect.onchange = updateScheduleKindFields;

pixelPickBtn.onclick = async () => {
  pixelPickBtn.disabled = true;
  let secondsLeft = 3;
  pixelPickBtn.textContent = `Hover target… ${secondsLeft}`;
  const timer = setInterval(() => {
    secondsLeft -= 1;
    if (secondsLeft > 0) pixelPickBtn.textContent = `Hover target… ${secondsLeft}`;
  }, 1000);
  await new Promise((r) => setTimeout(r, 3000));
  clearInterval(timer);
  const { x, y, color } = await window.api.pickPixel();
  pixelX.value = x;
  pixelY.value = y;
  pixelColor.value = color;
  pixelPickBtn.disabled = false;
  pixelPickBtn.textContent = 'Pick pixel under cursor';
};

// Ctrl+Z / Ctrl+Y only while the editor is open, so it doesn't fight with
// any browser/OS-level shortcut the rest of the app might want.
document.addEventListener('keydown', (e) => {
  if (editorOverlay.hidden) return;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    undo();
  } else if (mod && e.key.toLowerCase() === 'y') {
    e.preventDefault();
    redo();
  }
});

editorCancelBtn.onclick = closeEditor;

editorSaveBtn.onclick = async () => {
  const name = editorNameInput.value.trim() || 'Untitled macro';
  const tags = editorTagsInput.value.split(',').map((t) => t.trim()).filter(Boolean);
  const existing = draftId ? macros.find((m) => m.id === draftId) : null;
  const payload = {
    id: draftId,
    name,
    actions: draftActions,
    hotkey: existing ? existing.hotkey : null,
    loops: Number(loopsInput.value) || 1,
    loopForever: loopForeverInput.checked,
    speed: Number(speedSelect.value) || 1,
    scaleToScreen,
    screenSize: draftScreenSize,
    targetDisplayId: targetDisplaySelect.value ? Number(targetDisplaySelect.value) : null,
    jitter: jitterEnabled ? { enabled: true, ms: Number(jitterMsInput.value) || 0, px: Number(jitterPxInput.value) || 0 } : null,
    confirmBeforeRun: confirmToggle.classList.contains('on'),
    tags,
    pixelTrigger: pixelEnabled
      ? {
          enabled: true,
          x: Number(pixelX.value) || 0,
          y: Number(pixelY.value) || 0,
          color: pixelColor.value,
          tolerance: Number(pixelTolerance.value) || 10,
          pollMs: Number(pixelPoll.value) || 300,
        }
      : null,
    schedule: scheduleEnabled
      ? {
          enabled: true,
          kind: scheduleKindSelect.value,
          intervalMinutes: Number(scheduleIntervalInput.value) || 30,
          atTime: scheduleTimeInput.value || '09:00',
        }
      : null,
  };
  const saved = await window.api.saveMacro(payload);
  const idx = macros.findIndex((m) => m.id === saved.id);
  if (idx >= 0) macros[idx] = saved;
  else macros.push(saved);
  renderMacros();
  closeEditor();
  toast(`Saved "${saved.name}" (${formatActionCount(saved.actions)}).`);
};

window.initMacros = function initMacros() {
  loadMacros();
  loadDisplays();
  loadKillSwitch();
  checkWaylandBanner();
};
