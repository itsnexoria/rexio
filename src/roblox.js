const https = require('https');

function request(opts, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function getUserInfo(cookie) {
  const res = await request({
    hostname: 'users.roblox.com',
    path: '/v1/users/authenticated',
    method: 'GET',
    headers: { Cookie: `.ROBLOSECURITY=${cookie}` },
  });
  if (res.status !== 200) throw new Error('Invalid cookie / not logged in');
  return JSON.parse(res.body); // { id, name, displayName }
}

async function getAuthTicket(cookie, attempt = 0) {
  const opts = {
    hostname: 'auth.roblox.com',
    path: '/v1/authentication-ticket',
    method: 'POST',
    headers: {
      Cookie: `.ROBLOSECURITY=${cookie}`,
      Referer: 'https://www.roblox.com/',
      'Content-Type': 'application/json',
      'Content-Length': 0,
    },
  };

  // First attempt has no CSRF token; Roblox returns 403 with the token in a header.
  let res = await request(opts);
  const csrf = res.headers['x-csrf-token'];
  if (csrf) {
    res = await request({ ...opts, headers: { ...opts.headers, 'X-CSRF-TOKEN': csrf } });
  }

  const ticket = res.headers['rbx-authentication-ticket'];
  if (ticket) return ticket;

  if (res.status === 401 || res.status === 403) {
    const err = new Error('Session expired — please log in again.');
    err.code = 'COOKIE_EXPIRED';
    throw err;
  }

  // Transient failure (Roblox API flake) — retry once.
  if (attempt === 0) {
    await delay(800);
    return getAuthTicket(cookie, attempt + 1);
  }

  throw new Error(`Failed to get auth ticket (status ${res.status})`);
}

function buildLaunchUri(ticket) {
  const time = Date.now();
  return (
    'roblox-player:1+launchmode:app+gameinfo:' +
    encodeURIComponent(ticket) +
    '+launchtime:' + time +
    '+browsertrackerid:0+robloxLocale:en_us+gameLocale:en_us+channel:'
  );
}

function buildJoinPlaceUri(ticket, placeId) {
  const time = Date.now();
  const placeLauncherUrl =
    `https://www.roblox.com/Game/PlaceLauncher.ashx?request=RequestGame&browserTrackerId=0&placeId=${placeId}&isPlayTogetherGame=false`;
  return (
    'roblox-player:1+launchmode:play+gameinfo:' +
    encodeURIComponent(ticket) +
    '+launchtime:' + time +
    '+placelauncherurl:' + encodeURIComponent(placeLauncherUrl) +
    '+browsertrackerid:0+robloxLocale:en_us+gameLocale:en_us+channel:'
  );
}

async function getPlaceNames(placeIds) {
  if (!placeIds.length) return {};
  const res = await request({
    hostname: 'games.roblox.com',
    path: `/v1/games/multiget-place-details?placeIds=${placeIds.join(',')}`,
    method: 'GET',
  });
  const json = JSON.parse(res.body);
  const map = {};
  (Array.isArray(json) ? json : []).forEach((p) => {
    map[p.placeId] = p.name;
  });
  return map;
}

async function getAvatarHeadshots(userIds) {
  if (!userIds.length) return {};
  const res = await request({
    hostname: 'thumbnails.roblox.com',
    path: `/v1/users/avatar-headshot?userIds=${userIds.join(',')}&size=150x150&format=Png&isCircular=false`,
    method: 'GET',
  });
  const json = JSON.parse(res.body);
  const map = {};
  (json.data || []).forEach((d) => {
    if (d.state === 'Completed') map[d.targetId] = d.imageUrl;
  });
  return map;
}

// userPresenceType: 0 Offline, 1 Online, 2 InGame, 3 InStudio
async function getPresence(cookie, userIds) {
  if (!userIds.length) return {};
  const body = JSON.stringify({ userIds });
  const opts = {
    hostname: 'presence.roblox.com',
    path: '/v1/presence/users',
    method: 'POST',
    headers: {
      Cookie: `.ROBLOSECURITY=${cookie}`,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    },
  };

  let res = await request(opts, body);
  if (res.status === 403 && res.headers['x-csrf-token']) {
    res = await request({ ...opts, headers: { ...opts.headers, 'X-CSRF-TOKEN': res.headers['x-csrf-token'] } }, body);
  }
  if (res.status !== 200) throw new Error(`presence status ${res.status}`);

  const json = JSON.parse(res.body);
  const map = {};
  (json.userPresences || []).forEach((p) => {
    map[p.userId] = p;
  });
  return map;
}

async function getRobuxBalance(cookie) {
  const res = await request({
    hostname: 'economy.roblox.com',
    path: '/v1/user/currency',
    method: 'GET',
    headers: { Cookie: `.ROBLOSECURITY=${cookie}` },
  });
  if (res.status !== 200) throw new Error(`currency status ${res.status}`);
  return JSON.parse(res.body).robux;
}

module.exports = {
  getUserInfo,
  getAuthTicket,
  buildLaunchUri,
  buildJoinPlaceUri,
  getAvatarHeadshots,
  getPresence,
  getPlaceNames,
  getRobuxBalance,
};
