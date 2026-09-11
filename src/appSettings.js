const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const filePath = () => path.join(app.getPath('userData'), 'app-settings.json');

const defaults = {
  minimizeToTray: true,
  showTrayIcon: true,
  showRobux: true,
};

function readAll() {
  try {
    return { ...defaults, ...JSON.parse(fs.readFileSync(filePath(), 'utf8')) };
  } catch {
    return { ...defaults };
  }
}

function get(key) {
  return readAll()[key];
}

function set(key, value) {
  const all = readAll();
  all[key] = value;
  fs.writeFileSync(filePath(), JSON.stringify(all, null, 2));
}

module.exports = { get, set };
