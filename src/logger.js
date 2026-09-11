const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const MAX_BYTES = 512 * 1024; // trim if the log grows past this

const logPath = () => path.join(app.getPath('userData'), 'rexio.log');

function write(level, message) {
  const line = `[${new Date().toISOString()}] [${level}] ${message}\n`;
  try {
    const p = logPath();
    if (fs.existsSync(p) && fs.statSync(p).size > MAX_BYTES) {
      const tail = fs.readFileSync(p, 'utf8').slice(-MAX_BYTES / 2);
      fs.writeFileSync(p, tail);
    }
    fs.appendFileSync(p, line);
  } catch {
    // logging must never itself crash the app
  }
}

module.exports = {
  info: (m) => write('INFO', m),
  error: (m) => write('ERROR', m instanceof Error ? m.stack || m.message : String(m)),
  path: logPath,
};
