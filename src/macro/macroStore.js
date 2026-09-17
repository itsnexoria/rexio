const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const filePath = () => path.join(app.getPath('userData'), 'macros.json');
const versionsFilePath = () => path.join(app.getPath('userData'), 'macro-versions.json');
const MAX_VERSIONS_PER_MACRO = 10;

function readAll() {
  try {
    return JSON.parse(fs.readFileSync(filePath(), 'utf8'));
  } catch {
    return [];
  }
}

function writeAll(macros) {
  fs.writeFileSync(filePath(), JSON.stringify(macros, null, 2));
}

function readVersions() {
  try {
    return JSON.parse(fs.readFileSync(versionsFilePath(), 'utf8'));
  } catch {
    return {};
  }
}

function writeVersions(all) {
  fs.writeFileSync(versionsFilePath(), JSON.stringify(all, null, 2));
}

function snapshotVersion(macro) {
  const all = readVersions();
  const list = all[macro.id] || [];
  list.push({ at: Date.now(), name: macro.name, actions: macro.actions });
  while (list.length > MAX_VERSIONS_PER_MACRO) list.shift();
  all[macro.id] = list;
  writeVersions(all);
}

function getVersions(id) {
  return (readVersions()[id] || []).slice().reverse(); // newest first
}

function listMacros() {
  return readAll();
}

function getMacro(id) {
  return readAll().find((m) => m.id === id) || null;
}

// actions: array of { type: 'moveMouse'|'mouseButton'|'keyboardKey'|'wait'|'text'|'runMacro', ... }
// hotkey: Electron accelerator string, e.g. 'F6', or null if untriggered.
// loops: how many times to run the action list per trigger (ignored if loopForever).
// loopForever: keep looping until the hotkey is pressed again / stop is called.
// speed: playback speed multiplier (1 = as recorded).
// scaleToScreen / screenSize: see player.js's scalePoint. screenSize.bounds carries
// the recording display's global bounds for multi-monitor-aware rescaling.
// targetDisplayId: force scaling against a specific display rather than whichever
// one the macro happened to be recorded on.
// jitter: { enabled, ms, px } — randomizes wait durations and click/move positions
// slightly so playback doesn't look mechanically identical every run.
// pixelTrigger: { enabled, x, y, color: '#rrggbb', tolerance, pollMs } or null.
// schedule: { enabled, kind: 'interval'|'time', intervalMinutes, atTime: 'HH:MM' } or null.
// confirmBeforeRun: ask before running from the UI Play button (not enforced for
// hotkey/pixel/schedule triggers, which are meant to run hands-free).
// tags: free-text labels for organizing/filtering the macro list.
function saveMacro({
  id, name, actions, hotkey, loops, loopForever, speed, scaleToScreen, screenSize,
  targetDisplayId, jitter, pixelTrigger, schedule, confirmBeforeRun, tags,
}) {
  const macros = readAll();
  const idx = macros.findIndex((m) => m.id === id);
  if (idx >= 0) snapshotVersion(macros[idx]); // keep the pre-edit version before overwriting

  const record = {
    id: id || `macro_${Date.now()}`,
    name: name || 'Untitled macro',
    actions: actions || [],
    hotkey: hotkey || null,
    loops: Number.isFinite(loops) && loops > 0 ? loops : 1,
    loopForever: Boolean(loopForever),
    speed: Number.isFinite(speed) && speed > 0 ? speed : 1,
    scaleToScreen: scaleToScreen !== false,
    screenSize: screenSize || null,
    targetDisplayId: targetDisplayId ?? null,
    jitter: jitter || null,
    pixelTrigger: pixelTrigger || null,
    schedule: schedule || null,
    confirmBeforeRun: Boolean(confirmBeforeRun),
    tags: Array.isArray(tags) ? tags.filter(Boolean) : [],
    updatedAt: Date.now(),
  };
  if (idx >= 0) macros[idx] = { ...macros[idx], ...record };
  else macros.push(record);
  writeAll(macros);
  return record;
}

// Imported macros always get a fresh id so importing never silently
// overwrites something already on this machine, even if the file was
// exported from this same machine.
function importMacro(data) {
  return saveMacro({ ...data, id: undefined });
}

function restoreVersion(id, versionAt) {
  const versions = readVersions()[id] || [];
  const version = versions.find((v) => v.at === versionAt);
  if (!version) return null;
  const current = getMacro(id);
  if (!current) return null;
  return saveMacro({ ...current, name: version.name, actions: version.actions });
}

function setLastRun(id, result) {
  const macros = readAll();
  const idx = macros.findIndex((m) => m.id === id);
  if (idx < 0) return null;
  macros[idx].lastRun = { at: Date.now(), ok: Boolean(result.ok), error: result.error || null, durationMs: result.durationMs || 0 };
  const stats = macros[idx].stats || { runCount: 0, successCount: 0, failCount: 0, totalMs: 0 };
  stats.runCount += 1;
  if (result.ok) stats.successCount += 1;
  else stats.failCount += 1;
  stats.totalMs += result.durationMs || 0;
  macros[idx].stats = stats;
  writeAll(macros);
  return macros[idx];
}

// Cross-checks runMacro steps against macros that still exist, so a deleted
// macro doesn't silently become a no-op inside another one without warning.
function validateMacro(macro) {
  const allIds = new Set(readAll().map((m) => m.id));
  const issues = [];
  (macro.actions || []).forEach((a, i) => {
    if (a.type === 'runMacro' && !allIds.has(a.macroId)) {
      issues.push(`Step ${i + 1}: references a macro that no longer exists.`);
    }
    if (a.type === 'runMacro' && a.macroId === macro.id) {
      issues.push(`Step ${i + 1}: a macro can't run itself directly.`);
    }
  });
  return issues;
}

function bulkDelete(ids) {
  writeAll(readAll().filter((m) => !ids.includes(m.id)));
  const all = readVersions();
  ids.forEach((id) => delete all[id]);
  writeVersions(all);
}

function bulkAddTag(ids, tag) {
  const macros = readAll();
  macros.forEach((m) => {
    if (ids.includes(m.id) && tag && !m.tags?.includes(tag)) {
      m.tags = [...(m.tags || []), tag];
    }
  });
  writeAll(macros);
  return macros;
}

function deleteMacro(id) {
  writeAll(readAll().filter((m) => m.id !== id));
  const all = readVersions();
  delete all[id];
  writeVersions(all);
}

function setHotkey(id, hotkey) {
  const macros = readAll();
  const idx = macros.findIndex((m) => m.id === id);
  if (idx < 0) return null;
  macros[idx].hotkey = hotkey || null;
  writeAll(macros);
  return macros[idx];
}

module.exports = {
  listMacros, getMacro, saveMacro, importMacro, setLastRun, deleteMacro, setHotkey,
  getVersions, restoreVersion, validateMacro, bulkDelete, bulkAddTag, rawFilePath: filePath,
};
