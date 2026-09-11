const fs = require('fs');
const os = require('os');
const path = require('path');

function findVersionFolder() {
  const versionsDir = path.join(os.homedir(), 'AppData', 'Local', 'Roblox', 'Versions');
  if (!fs.existsSync(versionsDir)) {
    throw new Error('Roblox installation not found. Launch Roblox at least once first.');
  }
  const dirs = fs.readdirSync(versionsDir, { withFileTypes: true }).filter((d) => d.isDirectory());
  for (const d of dirs) {
    if (fs.existsSync(path.join(versionsDir, d.name, 'RobloxPlayerBeta.exe'))) {
      return path.join(versionsDir, d.name);
    }
  }
  throw new Error('Roblox installation not found. Launch Roblox at least once first.');
}

function configPath() {
  return path.join(findVersionFolder(), 'ClientSettings', 'ClientAppSettings.json');
}

// Windows stores flags flat ({"Flag":"Value"}) with no general settings and no
// header comments. Wrap/unwrap so the renderer's Sober-shaped UI works as-is.
function load() {
  const p = configPath();
  let flags = {};
  if (fs.existsSync(p)) {
    const raw = fs.readFileSync(p, 'utf8').trim();
    flags = raw ? JSON.parse(raw) : {};
  }
  return { header: '', config: { fflags: flags } };
}

function save(config) {
  const p = configPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(config.fflags || {}, null, 4), 'utf8');
}

module.exports = { load, save, configPath, findVersionFolder };
