const fs = require('fs');
const path = require('path');
const { app, safeStorage } = require('electron');

const filePath = () => path.join(app.getPath('userData'), 'accounts.json');

function readAll() {
  try {
    return JSON.parse(fs.readFileSync(filePath(), 'utf8'));
  } catch {
    return [];
  }
}

function writeAll(accounts) {
  fs.writeFileSync(filePath(), JSON.stringify(accounts, null, 2));
}

function addAccount({ userId, username, displayName, cookie }) {
  const accounts = readAll();
  const encrypted = safeStorage.encryptString(cookie).toString('base64');
  const idx = accounts.findIndex((a) => a.userId === userId);
  if (idx >= 0) {
    // Merge so a re-login doesn't wipe note/lastLaunched/lastPlace.
    accounts[idx] = { ...accounts[idx], userId, username, displayName, cookie: encrypted };
  } else {
    accounts.push({ userId, username, displayName, cookie: encrypted });
  }
  writeAll(accounts);
}

function listAccounts() {
  return readAll().map(({ userId, username, displayName, lastLaunched, note, lastPlace, launchMacroId }) => ({
    userId,
    username,
    displayName,
    lastLaunched: lastLaunched || null,
    note: note || '',
    lastPlace: lastPlace || null,
    launchMacroId: launchMacroId || null,
  }));
}

function getCookie(userId) {
  const acc = readAll().find((a) => a.userId === userId);
  if (!acc) throw new Error('Account not found');
  return safeStorage.decryptString(Buffer.from(acc.cookie, 'base64'));
}

function deleteAccount(userId) {
  writeAll(readAll().filter((a) => a.userId !== userId));
}

function reorderAccounts(orderedUserIds) {
  const all = readAll();
  const map = new Map(all.map((a) => [String(a.userId), a]));
  const orderedSet = new Set(orderedUserIds.map(String));
  const reordered = orderedUserIds.map((id) => map.get(String(id))).filter(Boolean);
  all.forEach((a) => {
    if (!orderedSet.has(String(a.userId))) reordered.push(a);
  });
  writeAll(reordered);
}

function updateField(userId, field, value) {
  const accounts = readAll();
  const idx = accounts.findIndex((a) => a.userId === userId);
  if (idx >= 0) {
    accounts[idx][field] = value;
    writeAll(accounts);
  }
}

const setLastLaunched = (userId, timestamp) => updateField(userId, 'lastLaunched', timestamp);
const setNote = (userId, note) => updateField(userId, 'note', note);
const setLastPlace = (userId, placeInfo) => updateField(userId, 'lastPlace', placeInfo);
const setLaunchMacro = (userId, macroId) => updateField(userId, 'launchMacroId', macroId || null);

// ---- Passphrase-protected export/import ----
// Cookies are decrypted here (safeStorage keys are tied to this machine's OS
// keyring and won't decrypt on another machine), then re-encrypted with the
// user's passphrase so the backup file is portable.
function exportAll() {
  return readAll().map((a) => ({
    userId: a.userId,
    username: a.username,
    displayName: a.displayName,
    note: a.note || '',
    lastLaunched: a.lastLaunched || null,
    lastPlace: a.lastPlace || null,
    launchMacroId: a.launchMacroId || null,
    cookie: safeStorage.decryptString(Buffer.from(a.cookie, 'base64')),
  }));
}

function importAll(records) {
  records.forEach((r) => {
    addAccount({ userId: r.userId, username: r.username, displayName: r.displayName, cookie: r.cookie });
    if (r.note) setNote(r.userId, r.note);
    if (r.lastLaunched) setLastLaunched(r.userId, r.lastLaunched);
    if (r.lastPlace) setLastPlace(r.userId, r.lastPlace);
    if (r.launchMacroId) setLaunchMacro(r.userId, r.launchMacroId);
  });
}

module.exports = {
  addAccount,
  listAccounts,
  getCookie,
  deleteAccount,
  reorderAccounts,
  setLastLaunched,
  setNote,
  setLastPlace,
  setLaunchMacro,
  exportAll,
  importAll,
  rawFilePath: filePath,
};
