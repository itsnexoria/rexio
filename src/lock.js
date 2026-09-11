const crypto = require('crypto');
const appSettings = require('./appSettings');

function hashPin(pin, salt) {
  return crypto.scryptSync(pin, salt, 32).toString('hex');
}

function setPin(pin) {
  const salt = crypto.randomBytes(16).toString('hex');
  appSettings.set('pinSalt', salt);
  appSettings.set('pinHash', hashPin(pin, salt));
  appSettings.set('lockEnabled', true);
}

function verifyPin(pin) {
  const salt = appSettings.get('pinSalt');
  const hash = appSettings.get('pinHash');
  if (!salt || !hash) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(hashPin(pin, salt), 'hex'), Buffer.from(hash, 'hex'));
  } catch {
    return false;
  }
}

function disable() {
  appSettings.set('lockEnabled', false);
  appSettings.set('pinHash', null);
  appSettings.set('pinSalt', null);
}

function isEnabled() {
  return Boolean(appSettings.get('lockEnabled'));
}

module.exports = { setPin, verifyPin, disable, isEnabled };
