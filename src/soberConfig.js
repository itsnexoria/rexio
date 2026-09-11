const fs = require('fs');
const os = require('os');
const path = require('path');

const configPath = path.join(
  os.homedir(),
  '.var/app/org.vinegarhq.Sober/config/sober/config.json'
);

function load() {
  const raw = fs.readFileSync(configPath, 'utf8');
  const lines = raw.split('\n');
  const startIdx = lines.findIndex((l) => l.trim().startsWith('{'));
  const header = startIdx === -1 ? '' : lines.slice(0, startIdx).join('\n');
  const jsonText = startIdx === -1 ? raw : lines.slice(startIdx).join('\n');
  return { header, config: JSON.parse(jsonText) };
}

function save(config) {
  const body = JSON.stringify(config, null, 4) + '\n';
  fs.writeFileSync(configPath, body, 'utf8');
}

module.exports = { load, save, configPath };
