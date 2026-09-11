const SOBER_GENERAL_FIELDS = [
  { key: 'discord_rpc_enabled', label: 'Discord Rich Presence', desc: 'Show your Roblox activity on Discord.', type: 'bool' },
  { key: 'discord_rpc_show_join_button', label: 'Discord join button', desc: 'Let friends join your game from Discord.', type: 'bool' },
  { key: 'enable_gamemode', label: 'GameMode', desc: 'Use Feral Interactive GameMode for a performance boost.', type: 'bool' },
  { key: 'enable_hidpi', label: 'HiDPI scaling', desc: 'Optimize rendering for high-resolution displays.', type: 'bool' },
  { key: 'allow_gamepad_permission', label: 'Gamepad access', desc: 'Allow Roblox to detect connected controllers.', type: 'bool' },
  { key: 'close_on_leave', label: 'Close on leave', desc: 'Quit Sober automatically after leaving a game.', type: 'bool' },
  { key: 'server_location_indicator_enabled', label: 'Server location indicator', desc: 'Show the server region in-game.', type: 'bool' },
  { key: 'use_console_experience', label: 'Console experience', desc: 'Use the console-oriented UI layout.', type: 'bool' },
  { key: 'use_libsecret', label: 'Use libsecret', desc: 'Store credentials via the system keyring instead of plaintext.', type: 'bool' },
  { key: 'use_opengl', label: 'Force OpenGL', desc: 'Use OpenGL instead of Vulkan (for GPUs without Vulkan support).', type: 'bool' },
  { key: 'enable_mobile_home_screen', label: 'Mobile home screen', desc: 'Use the mobile-style home screen layout.', type: 'bool' },
  { key: 'graphics_optimization_mode', label: 'Graphics optimization', type: 'select', options: ['performance', 'balanced', 'quality'] },
  { key: 'touch_mode', label: 'Touch mode', type: 'select', options: ['off', 'fake-off', 'on'] },
];

let currentConfig = null;
let platform = 'linux';
let platformLoaded = false;
let appTabLoaded = false;

function parseFlagValue(str) {
  try {
    return JSON.parse(str);
  } catch {
    return str;
  }
}

function renderGeneral() {
  const container = document.getElementById('generalSettings');
  container.innerHTML = '';
  if (platform !== 'linux') return; // no equivalent general settings on Windows

  SOBER_GENERAL_FIELDS.forEach((field) => {
    const row = document.createElement('div');

    if (field.type === 'bool') {
      row.className = 'toggle-row';
      const isOn = Boolean(currentConfig[field.key]);
      row.innerHTML = `
        <div>
          <div class="toggle-label">${field.label}</div>
          ${field.desc ? `<div class="toggle-desc">${field.desc}</div>` : ''}
        </div>
        <div class="switch ${isOn ? 'on' : ''}"></div>
      `;
      const sw = row.querySelector('.switch');
      sw.onclick = () => {
        currentConfig[field.key] = !currentConfig[field.key];
        sw.classList.toggle('on', currentConfig[field.key]);
      };
    } else {
      row.className = 'toggle-row select-row';
      const current = currentConfig[field.key] ?? field.options[0];
      row.innerHTML = `
        <div class="toggle-label">${field.label}</div>
        <select>
          ${field.options.map((o) => `<option value="${o}" ${o === current ? 'selected' : ''}>${o}</option>`).join('')}
        </select>
      `;
      row.querySelector('select').onchange = (e) => {
        currentConfig[field.key] = e.target.value;
      };
    }

    container.appendChild(row);
  });
}

function renderFlags(filter = '') {
  const list = document.getElementById('flagList');
  list.innerHTML = '';
  const flags = currentConfig.fflags || {};
  const keys = Object.keys(flags)
    .filter((k) => k.toLowerCase().includes(filter.toLowerCase()))
    .sort();

  keys.forEach((key) => {
    const row = document.createElement('div');
    row.className = 'flag-row';
    row.innerHTML = `
      <span class="flag-key" title="${key}">${key}</span>
      <input class="flag-value" value="${String(flags[key])}" />
      <button class="flag-remove" title="Remove flag">✕</button>
    `;
    row.querySelector('.flag-value').onchange = (e) => {
      currentConfig.fflags[key] = parseFlagValue(e.target.value);
    };
    row.querySelector('.flag-remove').onclick = () => {
      delete currentConfig.fflags[key];
      row.remove();
    };
    list.appendChild(row);
  });
}

function showConfigError(message) {
  const box = document.getElementById('configError');
  if (!message) {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  box.textContent = message;
}

window.initPlatformSettings = async function initPlatformSettings() {
  if (platformLoaded) return;
  platformLoaded = true;

  platform = await window.api.getPlatform();
  const isWin = platform === 'win32';

  document.getElementById('platformTitle').textContent = isWin ? 'Roblox Settings' : 'Sober Settings';
  const platformTab = document.querySelector('.tab[data-view="platform"]');
  platformTab.textContent = isWin ? 'Roblox Settings' : 'Sober Settings';
  if (platformTab.classList.contains('active') && window.moveIndicatorTo) window.moveIndicatorTo(platformTab);
  document.getElementById('platformNote').innerHTML = isWin
    ? 'Edits <code>ClientAppSettings.json</code> in your current Roblox install folder. Only a small allowlist of FastFlags is actually honored by the client, and this file is wiped every time Roblox updates.'
    : "Edits Sober's <code>config.json</code> directly. Invalid FFlags can stop Sober from launching — when in doubt, leave it alone.";

  document.getElementById('flagSearch').oninput = (e) => renderFlags(e.target.value);

  document.getElementById('addFlagBtn').onclick = () => {
    const keyInput = document.getElementById('newFlagKey');
    const valInput = document.getElementById('newFlagValue');
    const key = keyInput.value.trim();
    if (!key) return;
    currentConfig.fflags = currentConfig.fflags || {};
    currentConfig.fflags[key] = parseFlagValue(valInput.value.trim() || 'True');
    keyInput.value = '';
    valInput.value = '';
    renderFlags(document.getElementById('flagSearch').value);
  };

  document.getElementById('saveConfigBtn').onclick = async () => {
    const btn = document.getElementById('saveConfigBtn');
    btn.disabled = true;
    btn.textContent = 'Saving…';
    const result = await window.api.saveConfig(currentConfig);
    if (!result.ok) {
      showConfigError('Save failed: ' + result.error);
    } else {
      showConfigError('');
      toast((isWin ? 'Roblox' : 'Sober') + ' settings saved.', 'success');
    }
    btn.disabled = false;
    btn.textContent = 'Save changes';
  };

  const result = await window.api.loadConfig();
  if (!result.ok) {
    showConfigError(
      (isWin
        ? "Couldn't read Roblox's ClientAppSettings.json (" 
        : "Couldn't read Sober's config (") +
        result.error +
        (isWin ? '). Launch Roblox at least once first.' : '). Launch Sober at least once to generate it.')
    );
    return;
  }
  currentConfig = result.config;
  document.getElementById('generalSettings').hidden = isWin;
  renderGeneral();
  renderFlags();
};

window.initAppSettings = async function initAppSettings() {
  if (appTabLoaded) return;
  appTabLoaded = true;

  const container = document.getElementById('appSettings');
  const [autoLaunch, minimizeToTray, showTrayIcon, showRobux] = await Promise.all([
    window.api.getAutoLaunch(),
    window.api.getPreference('minimizeToTray'),
    window.api.getPreference('showTrayIcon'),
    window.api.getPreference('showRobux'),
  ]);

  const rows = [
    {
      key: 'autoLaunch',
      label: 'Start Rexio on login',
      desc: 'Launches Rexio automatically in the background when you sign in.',
      value: autoLaunch,
      onToggle: (v) => window.api.setAutoLaunch(v),
    },
    {
      key: 'showTrayIcon',
      label: 'Show tray icon',
      desc: 'Adds a Rexio icon to the system tray with a quick-launch menu.',
      value: showTrayIcon,
      onToggle: (v) => window.api.setPreference('showTrayIcon', v),
    },
    {
      key: 'minimizeToTray',
      label: 'Minimize to tray on close',
      desc: 'Closing the window hides Rexio instead of quitting it.',
      value: minimizeToTray,
      onToggle: (v) => window.api.setPreference('minimizeToTray', v),
    },
    {
      key: 'showRobux',
      label: 'Show Robux balance',
      desc: "Fetches each account's balance. Turn off before screen-sharing if you'd rather not show it.",
      value: showRobux,
      onToggle: (v) => window.api.setPreference('showRobux', v),
    },
  ];

  container.innerHTML = rows
    .map(
      (r) => `
    <div class="toggle-row">
      <div>
        <div class="toggle-label">${r.label}</div>
        <div class="toggle-desc">${r.desc}</div>
      </div>
      <div class="switch ${r.value ? 'on' : ''}" data-key="${r.key}"></div>
    </div>
  `
    )
    .join('');

  rows.forEach((r) => {
    const sw = container.querySelector(`.switch[data-key="${r.key}"]`);
    sw.onclick = async () => {
      const next = !sw.classList.contains('on');
      await r.onToggle(next);
      sw.classList.toggle('on', next);
    };
  });

  document.getElementById('openBackupsBtn').onclick = () => window.api.openBackupsFolder();
  window.api.getBackupInfo().then((info) => {
    const el = document.getElementById('autoBackupInfo');
    el.textContent = info.latest
      ? `${info.count} kept, most recent ${timeAgo(info.latest)}.`
      : 'None yet — the first one is written shortly after Rexio starts.';
  });

  document.getElementById('exportBtn').onclick = async () => {
    const pass = await window.promptDialog('Set a passphrase to protect this backup:');
    if (!pass) return;
    const result = await window.api.exportAccounts(pass);
    if (result.canceled) return;
    if (result.ok) toast(`Exported to ${result.filePath}`, 'success');
    else toast('Export failed: ' + result.error, 'error');
  };

  document.getElementById('importBtn').onclick = async () => {
    const pass = await window.promptDialog('Enter the passphrase for this backup:');
    if (!pass) return;
    const result = await window.api.importAccounts(pass);
    if (result.canceled) return;
    if (result.ok) toast(`Imported ${result.count} account(s).`, 'success');
    else toast(result.error, 'error');
  };

  window.api.getVersion().then((v) => {
    document.getElementById('appVersion').textContent = `v${v}`;
  });

  document.getElementById('checkUpdateBtn').onclick = async () => {
    const btn = document.getElementById('checkUpdateBtn');
    btn.disabled = true;
    btn.textContent = 'Checking…';
    const result = await window.api.checkForUpdates();
    btn.disabled = false;
    if (!result.ok) {
      btn.textContent = 'Check for updates';
      toast(result.error, 'error');
    } else {
      btn.textContent = result.version ? `Update to v${result.version} available` : 'Up to date';
      setTimeout(() => (btn.textContent = 'Check for updates'), 4000);
    }
  };

  document.getElementById('openLogBtn').onclick = () => window.api.openLogFile();
};
