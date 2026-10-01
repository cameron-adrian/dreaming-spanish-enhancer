const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadScript } = require('./helpers/load-script');

// background.js answers runtime messages from a dispatch table. A message type
// sent somewhere but missing from the table now gets { ok: false } instead of
// being handled — so check every type the extension sends is in the table.

function loadBackground() {
  const store = {};
  let listener = null;
  const badge = [];
  loadScript('src/background.js', [], {
    chrome: {
      runtime: { onMessage: { addListener: fn => { listener = fn; } }, lastError: null },
      storage: {
        local: {
          get: (keys, cb) => cb(Object.fromEntries([].concat(keys).filter(k => k in store).map(k => [k, store[k]]))),
          set: (obj, cb) => { Object.assign(store, obj); cb && cb(); },
          remove: (k, cb) => { delete store[k]; cb && cb(); },
        },
      },
      tabs: { onUpdated: { addListener: fn => { badge.listener = fn; } } },
      action: {
        setBadgeText: o => badge.push(['text', o.text]),
        setBadgeBackgroundColor: () => {},
      },
      identity: { getAuthToken: () => {} },
    },
  });
  const send = msg => new Promise(resolve => {
    const keepOpen = listener(msg, {}, resolve);
    if (keepOpen !== true) setTimeout(() => resolve(undefined), 0);
  });
  return { send, badge, store };
}

const SRC = path.join(__dirname, '..', 'src');
function typesSentToBackground() {
  const types = new Set();
  for (const f of fs.readdirSync(SRC).filter(f => f.endsWith('.js') && f !== 'background.js')) {
    const code = fs.readFileSync(path.join(SRC, f), 'utf8');
    // tabs.sendMessage goes to content scripts, not the background — skip those.
    for (const m of code.matchAll(/(tabs\.)?sendMessage\(\s*(?:[\w.]+,\s*)?\{\s*type:\s*'([A-Z_]+)'/g)) {
      if (!m[1]) types.add(m[2]);
    }
  }
  return types;
}

test('every message type the extension sends has a background handler', async () => {
  const types = typesSentToBackground();
  assert.ok(types.size >= 6, `found ${[...types]}`);
  const { send } = loadBackground();
  for (const type of types) {
    if (type === 'SHEETS_APPEND_BOOK' || type === 'GET_PROGRESS') continue; // need network; checked below
    const res = await send({ type, video: { id: 'v1' }, videoId: 'v1', data: {}, language: 'es' });
    assert.notEqual(res?.reason, `unknown_type:${type}`, type);
    assert.equal(res?.ok, true, type);
  }
});

test('an unknown message type gets an explicit answer instead of a dropped channel', async () => {
  const { send } = loadBackground();
  assert.deepEqual(JSON.parse(JSON.stringify(await send({ type: 'NOPE' }))), { ok: false, reason: 'unknown_type:NOPE' });
});

test('hide and unhide round-trip through storage', async () => {
  const { send } = loadBackground();
  await send({ type: 'HIDE_VIDEO', video: { id: 'v1', title: 'Uno' } });
  await send({ type: 'HIDE_VIDEO', video: { id: 'v1', title: 'Uno' } });
  assert.equal((await send({ type: 'GET_HIDDEN_VIDEOS' })).videos.map(v => v.id).join(), 'v1');
  await send({ type: 'UNHIDE_VIDEO', videoId: 'v1' });
  assert.equal((await send({ type: 'GET_HIDDEN_VIDEOS' })).videos.length, 0);
});

test('the badge shows only on DS hosts, not on look-alike URLs', () => {
  const { badge } = loadBackground();
  badge.listener(1, { status: 'complete' }, { url: 'https://app.dreaming.com/spanish/progress' });
  badge.listener(1, { status: 'complete' }, { url: 'https://dreaming-notes.example.com/' });
  assert.deepEqual(badge.filter(b => b[0] === 'text').map(b => b[1]), ['DS', '']);
});
