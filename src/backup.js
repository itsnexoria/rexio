const crypto = require('crypto');

function encrypt(passphrase, plainText) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(passphrase, salt, 32);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return JSON.stringify({
    v: 1,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    data: data.toString('base64'),
  });
}

function decrypt(passphrase, fileContents) {
  const obj = JSON.parse(fileContents);
  const salt = Buffer.from(obj.salt, 'base64');
  const key = crypto.scryptSync(passphrase, salt, 32);
  const iv = Buffer.from(obj.iv, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(Buffer.from(obj.authTag, 'base64'));
  const data = Buffer.concat([decipher.update(Buffer.from(obj.data, 'base64')), decipher.final()]);
  return data.toString('utf8');
}

module.exports = { encrypt, decrypt };
