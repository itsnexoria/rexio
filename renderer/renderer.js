const list = document.getElementById('list');
const emptyState = document.getElementById('emptyState');
const addBtn = document.getElementById('addBtn');
const refreshBtn = document.getElementById('refreshBtn');
const viewListBtn = document.getElementById('viewListBtn');
const viewGridBtn = document.getElementById('viewGridBtn');
const selectModeBtn = document.getElementById('selectModeBtn');
const searchInput = document.getElementById('accountSearch');
const installBanner = document.getElementById('installBanner');
const installBannerText = document.getElementById('installBannerText');
const installBannerBtn = document.getElementById('installBannerBtn');
const bulkBar = document.getElementById('bulkBar');
const bulkCount = document.getElementById('bulkCount');
const bulkLaunchBtn = document.getElementById('bulkLaunchBtn');
const bulkDeleteBtn = document.getElementById('bulkDeleteBtn');
const bulkCancelBtn = document.getElementById('bulkCancelBtn');
const overlay = document.getElementById('confirmOverlay');
const confirmMessage = document.getElementById('confirmMessage');
const confirmCancel = document.getElementById('confirmCancel');
const confirmOk = document.getElementById('confirmOk');

let allAccounts = [];
let cachedMacros = [];
let selectMode = false;
const selectedIds = new Set();

function initial(name) {
  return (name || '?').charAt(0).toUpperCase();
}

const PRESENCE = {
  0: { cls: 'offline', label: 'Offline' },
  1: { cls: 'online', label: 'Online' },
  2: { cls: 'ingame', label: 'In game' },
  3: { cls: 'ingame', label: 'In Studio' },
};

function presenceInfo(presence) {
  if (!presence) return null;
  const info = PRESENCE[presence.userPresenceType] || PRESENCE[0];
  const label = presence.userPresenceType === 2 && presence.lastLocation ? presence.lastLocation : info.label;
  return { cls: info.cls, label };
}

function timeAgo(ts) {
  if (!ts) return null;
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

function confirmDialog(message) {
  return new Promise((resolve) => {
    confirmMessage.textContent = message;
    overlay.hidden = false;
    const cleanup = (result) => {
      overlay.hidden = true;
      confirmCancel.onclick = null;
      confirmOk.onclick = null;
      resolve(result);
    };
    confirmCancel.onclick = () => cleanup(false);
    confirmOk.onclick = () => cleanup(true);
  });
}

const promptOverlay = document.getElementById('promptOverlay');
const promptMessage = document.getElementById('promptMessage');
const promptInput = document.getElementById('promptInput');
const promptCancel = document.getElementById('promptCancel');
const promptOk = document.getElementById('promptOk');

function promptDialog(message) {
  return new Promise((resolve) => {
    promptMessage.textContent = message;
    promptInput.value = '';
    promptOverlay.hidden = false;
    promptInput.focus();
    const cleanup = (result) => {
      promptOverlay.hidden = true;
      promptCancel.onclick = null;
      promptOk.onclick = null;
      promptInput.onkeydown = null;
      resolve(result);
    };
    promptCancel.onclick = () => cleanup(null);
    promptOk.onclick = () => cleanup(promptInput.value || null);
    promptInput.onkeydown = (e) => {
      if (e.key === 'Enter') cleanup(promptInput.value || null);
      if (e.key === 'Escape') cleanup(null);
    };
  });
}
window.promptDialog = promptDialog;

const toastContainer = document.getElementById('toastContainer');
function toast(message, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  toastContainer.appendChild(el);
  setTimeout(() => {
    el.classList.add('leaving');
    el.addEventListener('animationend', () => el.remove(), { once: true });
  }, 3500);
}
window.toast = toast;

function buildCard(acc, total, index) {
  const li = document.createElement('li');
  li.className = 'account-card';
  li.dataset.userId = acc.userId;
  li.style.animationDelay = `${Math.min(index, 8) * 30}ms`;

  const avatarInner = acc.avatarUrl
    ? `<img class="avatar-img" src="${acc.avatarUrl}" alt="" />`
    : initial(acc.displayName || acc.username);
  const presence = presenceInfo(acc.presence);
  const lastLaunched = timeAgo(acc.lastLaunched);
  const noteText = acc.note || 'Add a note…';
  const noteClass = acc.note ? 'account-note' : 'account-note placeholder';
  const isSelected = selectedIds.has(String(acc.userId));
  if (isSelected) li.classList.add('selected');
  const expired = acc.cookieValid === false;
  if (expired) li.classList.add('expired');
  const robuxText = typeof acc.robux === 'number' ? `${acc.robux.toLocaleString()} R$` : null;

  const leadingControl = selectMode
    ? `<span class="select-checkbox ${isSelected ? 'checked' : ''}">✓</span>`
    : `<span class="drag-handle">⠿</span>`;

  li.innerHTML = `
    ${leadingControl}
    <div class="avatar-wrap">
      <div class="avatar">${avatarInner}</div>
      ${presence ? `<span class="presence-dot ${presence.cls}"></span>` : ''}
    </div>
    <div class="account-info">
      <div class="account-name">${acc.displayName}${expired ? '<span class="expired-badge">Session expired</span>' : ''}</div>
      <div class="account-handle">@${acc.username}${presence ? ` · ${presence.label}` : ''}${robuxText ? ` · ${robuxText}` : ''}</div>
      ${lastLaunched ? `<div class="last-launched">Last launched ${lastLaunched}</div>` : ''}
      <div class="${noteClass}" data-note="${(acc.note || '').replace(/"/g, '&quot;')}">${noteText}</div>
      <select class="macro-autorun-select" title="Play this macro ~15s after launching">
        <option value="">No auto-run macro</option>
        ${cachedMacros.map((m) => `<option value="${m.id}" ${acc.launchMacroId === m.id ? 'selected' : ''}>▶ ${m.name}</option>`).join('')}
      </select>
    </div>
    <div class="account-actions">
      ${acc.lastPlaceName ? `<button class="btn-join" title="Join ${acc.lastPlaceName}">▶ ${acc.lastPlaceName}</button>` : ''}
      <button class="btn-launch">Launch</button>
      <button class="btn-delete" title="Remove account">✕</button>
    </div>
  `;

  if (selectMode) {
    const checkbox = li.querySelector('.select-checkbox');
    const toggle = () => {
      const id = String(acc.userId);
      if (selectedIds.has(id)) selectedIds.delete(id);
      else selectedIds.add(id);
      checkbox.classList.toggle('checked');
      li.classList.toggle('selected');
      updateBulkBar();
    };
    checkbox.onclick = toggle;
    li.onclick = (e) => {
      if (e.target.closest('.select-checkbox')) return;
      toggle();
    };
  }

  const macroSelect = li.querySelector('.macro-autorun-select');
  macroSelect.onclick = (e) => e.stopPropagation();
  macroSelect.onchange = async () => {
    await window.api.setLaunchMacro(acc.userId, macroSelect.value || null);
    acc.launchMacroId = macroSelect.value || null;
  };

  const noteEl = li.querySelector('.account-note');
  noteEl.onclick = () => {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'note-input';
    input.value = noteEl.dataset.note || '';
    input.placeholder = 'Add a note…';
    noteEl.replaceWith(input);
    input.focus();
    const save = async () => {
      const value = input.value.trim();
      await window.api.setNote(acc.userId, value);
      acc.note = value;
      input.replaceWith(noteEl);
      noteEl.textContent = value || 'Add a note…';
      noteEl.className = value ? 'account-note' : 'account-note placeholder';
      noteEl.dataset.note = value;
    };
    input.onblur = save;
    input.onkeydown = (e) => {
      if (e.key === 'Enter') input.blur();
    };
  };

  const joinBtn = li.querySelector('.btn-join');
  if (joinBtn) {
    joinBtn.onclick = async (e) => {
      e.stopPropagation();
      joinBtn.disabled = true;
      try {
        await window.api.launch(acc.userId, { joinLastGame: true });
      } catch (err) {
        toast('Launch failed: ' + err.message, 'error');
      }
      joinBtn.disabled = false;
      loadAndRender();
    };
  }

  li.querySelector('.btn-launch').onclick = async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = 'Launching…';
    try {
      await window.api.launch(acc.userId);
    } catch (err) {
      toast('Launch failed: ' + err.message, 'error');
    }
    btn.disabled = false;
    btn.textContent = 'Launch';
    loadAndRender();
  };

  li.querySelector('.btn-delete').onclick = async () => {
    const isLast = total === 1;
    const warning = isLast
      ? `Remove ${acc.displayName} (@${acc.username})? This is your last account — you'll need to log in again to add any account.`
      : `Remove ${acc.displayName} (@${acc.username})? You'll need to log in again to re-add it.`;
    const ok = await confirmDialog(warning);
    if (!ok) return;
    await window.api.delete(acc.userId);
    loadAndRender();
  };

  return li;
}

function renderList(accounts) {
  list.innerHTML = '';
  list.classList.toggle('select-mode', selectMode);
  emptyState.hidden = allAccounts.length > 0;
  if (allAccounts.length > 0 && accounts.length === 0) {
    list.innerHTML = '<li class="no-results">No accounts match your search.</li>';
    return;
  }
  accounts.forEach((acc, i) => list.appendChild(buildCard(acc, accounts.length, i)));
}

async function loadAndRender() {
  [allAccounts, cachedMacros] = await Promise.all([window.api.list(), window.api.listMacros()]);
  searchInput.hidden = allAccounts.length <= 5;
  applyFilter();
}

function applyFilter() {
  const q = searchInput.value.trim().toLowerCase();
  const filtered = q
    ? allAccounts.filter((a) => a.username.toLowerCase().includes(q) || a.displayName.toLowerCase().includes(q))
    : allAccounts;
  renderList(filtered);
}

searchInput.oninput = applyFilter;

refreshBtn.onclick = async () => {
  refreshBtn.classList.add('spinning');
  await loadAndRender();
  setTimeout(() => refreshBtn.classList.remove('spinning'), 600);
};

function setViewMode(mode) {
  list.classList.toggle('grid-view', mode === 'grid');
  viewListBtn.classList.toggle('active', mode !== 'grid');
  viewGridBtn.classList.toggle('active', mode === 'grid');
  localStorage.setItem('rexio-view-mode', mode);
}

viewListBtn.onclick = () => setViewMode('list');
viewGridBtn.onclick = () => setViewMode('grid');
setViewMode(localStorage.getItem('rexio-view-mode') || 'list');

// ---- Bulk selection ----
function updateBulkBar() {
  const n = selectedIds.size;
  bulkBar.hidden = !selectMode || n === 0;
  bulkCount.textContent = `${n} selected`;
}

selectModeBtn.onclick = () => {
  selectMode = !selectMode;
  selectModeBtn.classList.toggle('active', selectMode);
  if (!selectMode) selectedIds.clear();
  applyFilter();
  updateBulkBar();
};

bulkCancelBtn.onclick = () => {
  selectMode = false;
  selectModeBtn.classList.remove('active');
  selectedIds.clear();
  applyFilter();
  updateBulkBar();
};

bulkLaunchBtn.onclick = async () => {
  const ids = [...selectedIds];
  if (!ids.length) return;
  if (platformIsLinux && ids.length > 1) {
    toast('Sober only runs one account at a time — launching each in turn.', 'info');
  }
  bulkLaunchBtn.disabled = true;
  let failed = 0;
  for (const id of ids) {
    try {
      await window.api.launch(id);
    } catch {
      failed += 1;
    }
    await new Promise((r) => setTimeout(r, 1200));
  }
  bulkLaunchBtn.disabled = false;
  toast(failed ? `Launched ${ids.length - failed}/${ids.length} (${failed} failed).` : `Launched ${ids.length} account(s).`, failed ? 'error' : 'success');
};

bulkDeleteBtn.onclick = async () => {
  const ids = [...selectedIds];
  if (!ids.length) return;
  const wipesAll = ids.length === allAccounts.length;
  const ok = await confirmDialog(
    `Remove ${ids.length} account(s)?${wipesAll ? ' This removes every account you have.' : ''} You'll need to log in again to re-add them.`
  );
  if (!ok) return;
  for (const id of ids) {
    await window.api.delete(id);
  }
  selectedIds.clear();
  selectMode = false;
  selectModeBtn.classList.remove('active');
  updateBulkBar();
  toast(`Removed ${ids.length} account(s).`, 'success');
  loadAndRender();
};

// ---- First-run install check ----
let platformIsLinux = true;
async function checkInstall() {
  platformIsLinux = (await window.api.getPlatform()) !== 'win32';
  const result = await window.api.checkClientInstalled();
  if (result.installed) {
    installBanner.hidden = true;
    return;
  }
  installBannerText.textContent = result.message;
  installBannerBtn.textContent = result.actionLabel;
  installBannerBtn.onclick = () => window.api.openExternal(result.actionUrl);
  installBanner.hidden = false;
}
checkInstall();

addBtn.onclick = async () => {
  addBtn.disabled = true;
  addBtn.textContent = 'Log in…';
  try {
    await window.api.add();
    toast('Account added.', 'success');
  } catch (e) {
    toast(e.message, 'error');
  }
  addBtn.disabled = false;
  addBtn.textContent = '+ Add account';
  loadAndRender();
};

// ---- Pointer-based drag to reorder (native HTML5 DnD is unreliable in Electron/Linux) ----
let dragState = null;

list.addEventListener('pointerdown', (e) => {
  const handle = e.target.closest('.drag-handle');
  if (!handle) return;
  const card = handle.closest('.account-card');
  const cards = [...list.children];
  dragState = { card, startIndex: cards.indexOf(card) };
  card.classList.add('dragging-active');
  handle.setPointerCapture(e.pointerId);
});

list.addEventListener('pointermove', (e) => {
  if (!dragState) return;
  const cards = [...list.children].filter((c) => c !== dragState.card);
  const y = e.clientY;
  let target = null;
  for (const c of cards) {
    const rect = c.getBoundingClientRect();
    if (y < rect.top + rect.height / 2) {
      target = c;
      break;
    }
  }
  if (target) list.insertBefore(dragState.card, target);
  else list.appendChild(dragState.card);
});

async function endDrag() {
  if (!dragState) return;
  dragState.card.classList.remove('dragging-active');
  const ids = [...list.children].map((el) => el.dataset.userId);
  dragState = null;
  await window.api.reorder(ids);
  loadAndRender();
}

list.addEventListener('pointerup', endDrag);
list.addEventListener('pointercancel', endDrag);

// ---- Live presence updates from the background poller ----
window.api.onPresenceUpdate((accounts) => {
  allAccounts = accounts;
  applyFilter();
});

// ---- Custom menu bar (dropdowns) ----
const menuItems = document.querySelectorAll('.menu-item');

function closeAllMenus() {
  menuItems.forEach((m) => m.classList.remove('open'));
}

menuItems.forEach((item) => {
  item.addEventListener('click', (e) => {
    // Ignore clicks on the action buttons inside — handled separately below.
    if (e.target.closest('.menu-dropdown')) return;
    const wasOpen = item.classList.contains('open');
    closeAllMenus();
    if (!wasOpen) item.classList.add('open');
  });
});

document.addEventListener('click', (e) => {
  if (!e.target.closest('.menu-item')) closeAllMenus();
});

const menuActions = {
  about: async () => {
    const { version } = await window.api.showAbout();
    toast(`Rexio v${version} — a Roblox account manager.`, 'info');
  },
  'check-updates': async () => {
    const result = await window.api.checkForUpdates();
    if (!result.ok) toast(result.error, 'error');
    else toast(result.version ? `Update available: v${result.version}` : "You're up to date.", 'success');
  },
  'goto-settings': () => document.querySelector('.tab[data-view="app"]').click(),
  quit: () => window.api.quitApp(),
  'add-account': () => addBtn.click(),
  refresh: () => refreshBtn.click(),
  'view-list': () => setViewMode('list'),
  'view-grid': () => setViewMode('grid'),
  'zoom-in': () => window.api.zoomIn(),
  'zoom-out': () => window.api.zoomOut(),
  'zoom-reset': () => window.api.resetZoom(),
  fullscreen: () => window.api.toggleFullscreen(),
  minimize: () => window.api.minimizeWindow(),
  close: () => window.api.closeWindow(),
  'open-log': () => window.api.openLogFile(),
  github: () => window.api.openExternal('https://github.com/itsnexoria/rexio'),
  issue: () => window.api.openExternal('https://github.com/itsnexoria/rexio/issues'),
};

document.querySelectorAll('.menu-dropdown button').forEach((btn) => {
  btn.onclick = () => {
    closeAllMenus();
    menuActions[btn.dataset.action]?.();
  };
});

// ---- Custom app menu actions ----
window.api.onMenuAddAccount(() => addBtn.click());
window.api.onMenuRefresh(() => refreshBtn.click());
window.api.onMenuViewMode((mode) => setViewMode(mode));
window.api.onMenuGotoSettings(() => document.querySelector('.tab[data-view="app"]').click());

loadAndRender();

// Tab switching
const tabIndicator = document.querySelector('.tab-indicator');

function moveIndicatorTo(tab) {
  tabIndicator.style.width = `${tab.offsetWidth}px`;
  tabIndicator.style.left = `${tab.offsetLeft}px`;
}
window.moveIndicatorTo = moveIndicatorTo;

document.querySelectorAll('.tab').forEach((tab) => {
  tab.onclick = () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
    document.querySelectorAll('.view').forEach((v) => (v.hidden = true));
    tab.classList.add('active');
    moveIndicatorTo(tab);
    const view = document.getElementById(`view-${tab.dataset.view}`);
    view.hidden = false;
    if (tab.dataset.view === 'macros' && window.initMacros) window.initMacros();
    if (tab.dataset.view === 'platform' && window.initPlatformSettings) window.initPlatformSettings();
    if (tab.dataset.view === 'app' && window.initAppSettings) window.initAppSettings();
  };
});

requestAnimationFrame(() => {
  const activeTab = document.querySelector('.tab.active');
  if (activeTab) {
    tabIndicator.style.transition = 'none';
    moveIndicatorTo(activeTab);
    requestAnimationFrame(() => { tabIndicator.style.transition = ''; });
  }
});
