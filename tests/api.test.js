const test = require('node:test');
const assert = require('node:assert/strict');
const { loadScript, fakeLocalStorage, fakeFetch } = require('./helpers/load-script');
const fx = require('./fixtures/ds-api');

const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.payload.sig';

function loadApi({ storage = { token: JSON.stringify(TOKEN) }, routes = {}, hostname = 'app.dreaming.com' } = {}) {
  const fetch = fakeFetch(routes);
  const { DSApi } = loadScript('src/api.js', ['DSApi'], {
    localStorage: fakeLocalStorage(storage),
    location: { hostname },
    fetch,
    crypto: globalThis.crypto,
  });
  return { DSApi, fetch };
}

const allRoutes = () => ({
  videos: fx.videos,
  watchedVideo: fx.watchedVideo,
  series: fx.series,
  user: fx.user,
  dayWatchedTime: fx.dayWatchedTime,
});

// ---- Auth / request plumbing ----

test('getToken strips the JSON quotes DS stores around the token', () => {
  const { DSApi } = loadApi();
  assert.equal(DSApi.getToken(), TOKEN);
});

test('getToken returns null when nothing JWT-shaped is stored', () => {
  const { DSApi } = loadApi({ storage: { theme: 'dark' } });
  assert.equal(DSApi.getToken(), null);
});

test('getToken only reads known DS keys, never another JWT that happens to be stored', () => {
  const { DSApi } = loadApi({ storage: { some_widget_jwt: 'eyJother.party.token' } });
  assert.equal(DSApi.getToken(), null);
});

test('fetch sends the bearer token to the matching DS host', async () => {
  const { DSApi, fetch } = loadApi({ routes: { user: fx.user }, hostname: 'app.dreamingspanish.com' });
  await DSApi.fetch('user', { timezone: '0' });
  const [call] = fetch.calls;
  assert.equal(call.url.origin, 'https://app.dreamingspanish.com');
  assert.equal(call.url.pathname, '/.netlify/functions/user');
  assert.equal(call.url.searchParams.get('timezone'), '0');
  assert.equal(call.init.headers.Authorization, `Bearer ${TOKEN}`);
});

test('fetch refuses to call the API without a token', async () => {
  const { DSApi, fetch } = loadApi({ storage: {} });
  await assert.rejects(DSApi.fetch('user'), /NOT_AUTHENTICATED/);
  assert.equal(fetch.calls.length, 0);
});

test('fetch maps 401/403 to AUTH_EXPIRED and other failures to API_ERROR', async () => {
  const { DSApi } = loadApi({ routes: { a: 401, b: 403, c: 500, d: new Error('offline') } });
  await assert.rejects(DSApi.fetch('a'), /AUTH_EXPIRED: 401/);
  await assert.rejects(DSApi.fetch('b'), /AUTH_EXPIRED: 403/);
  await assert.rejects(DSApi.fetch('c'), /API_ERROR: 500/);
  await assert.rejects(DSApi.fetch('d'), /NETWORK_ERROR: offline/);
});

// ---- computeProgress against the live response shapes ----

test('computeProgress groups hours by guide, level, topic and series', async () => {
  const { DSApi } = loadApi({ routes: allRoutes() });
  const p = await DSApi.computeProgress('es');

  // v2 has two guides, so it counts toward both.
  assert.deepEqual(
    { ...p.guide.Pablo },
    { total: (600 + 1200) / 3600, watched: 600 / 3600, count: 2, watchedCount: 1 },
  );
  assert.equal(p.guide.Andrea.count, 2);
  assert.equal(p.guide.Andrea.watchedCount, 0);

  assert.equal(p.level.Beginner.count, 2);
  assert.equal(p.level.Intermediate.count, 1);

  // Tag labels are capitalised and de-hyphenated.
  assert.ok(p.topic['Day to day'], 'expected "day-to-day" to become "Day to day"');
  assert.equal(p.topic.Food.count, 2);

  // Series name comes from the series endpoint, keyed by _id.
  assert.equal(p.series.Cocina.count, 2);
  assert.equal(p.series.Cocina.watchedCount, 1);
});

test('computeProgress only counts videos flagged watched, not partial progress', async () => {
  const { DSApi } = loadApi({ routes: allRoutes() });
  const p = await DSApi.computeProgress('es');
  assert.equal(p._userStats.watchedVideos, 1);
  assert.equal(p._userStats.totalVideos, 3);
  assert.equal(p._userStats.totalWatchTimeHours, 2);
  assert.equal(p.level.Intermediate.watched, 0);
});

test('computeProgress surfaces partially watched videos via watchPosition', async () => {
  const { DSApi } = loadApi({ routes: allRoutes() });
  const { _almostDone } = await DSApi.computeProgress('es');
  assert.equal(_almostDone.nearlyFinished.length, 1);
  assert.equal(_almostDone.nearlyFinished[0].id, 'v3');
  assert.equal(_almostDone.nearlyFinished[0].progress, 75);
  assert.equal(_almostDone.nearlyFinished[0].remainingSeconds, 450);
});

test('computeProgress still works when the optional user/series calls fail', async () => {
  const routes = allRoutes();
  routes.user = 500;
  routes.series = 500;
  const { DSApi } = loadApi({ routes });
  const p = await DSApi.computeProgress('es');
  assert.equal(p._userStats.totalWatchTimeHours, 0);
  assert.equal(p.series['Unknown Series'].count, 2);
});

test('computeProgress fails loudly if the catalog call fails', async () => {
  const routes = allRoutes();
  routes.videos = 500;
  const { DSApi } = loadApi({ routes });
  await assert.rejects(DSApi.computeProgress('es'), /API_ERROR/);
});

test('computeProgress passes the requested language through', async () => {
  const { DSApi, fetch } = loadApi({ routes: allRoutes() });
  await DSApi.computeProgress('fr');
  const byEndpoint = Object.fromEntries(fetch.calls.map(c => [c.endpoint, c.url.searchParams.get('language')]));
  assert.equal(byEndpoint.videos, 'fr');
  assert.equal(byEndpoint.watchedVideo, 'fr');
  assert.equal(byEndpoint.series, 'fr');
});

// ---- Yearly hours (dayWatchedTime) ----

test('computeYearlyHours sums only the requested calendar year', async () => {
  const { DSApi } = loadApi({ routes: allRoutes() });
  // 2026-01-01 (1800s) + 2026-06-15 (5400s) = 2h; 2025 and 2027 rows excluded.
  assert.equal(await DSApi.computeYearlyHours(2026, 'es'), 2);
});

test('computeYearlyHours returns null (not 0) when the response shape is unrecognised', async () => {
  const { DSApi } = loadApi({ routes: { dayWatchedTime: { somethingNew: [] } } });
  assert.equal(await DSApi.computeYearlyHours(2026, 'es'), null);
});

test('computeYearlyHours returns null when the request fails', async () => {
  const { DSApi } = loadApi({ routes: { dayWatchedTime: 500 } });
  assert.equal(await DSApi.computeYearlyHours(2026, 'es'), null);
});

// ---- Time outside (externalTime) ----

test('getExternalTimes returns the entries from the live response shape', async () => {
  const { DSApi, fetch } = loadApi({ routes: { externalTime: fx.externalTime } });
  const list = await DSApi.getExternalTimes('es');
  assert.equal(list.length, 3);
  assert.equal(fetch.calls[0].url.searchParams.get('language'), 'es');
});

test('getExternalTimes refuses a changed response instead of returning nothing', async () => {
  for (const body of [{ entries: [] }, { externalTimes: [{ id: 1, seconds: 60 }] }, []]) {
    const { DSApi } = loadApi({ routes: { externalTime: body } });
    await assert.rejects(DSApi.getExternalTimes('es'), /API_SHAPE/);
  }
});

test('addExternalTime posts the same body the DS app sends', async () => {
  const { DSApi, fetch } = loadApi({ routes: { externalTime: { id: 'abc123' } } });
  const id = await DSApi.addExternalTime(
    { date: '2026-06-05', timeSeconds: 1800, description: 'Show:\n\nEpisode', type: 'listening' },
    'es',
    { id: 'abc123', idempotencyKey: 'k'.repeat(64) },
  );
  assert.equal(id, 'abc123');

  const [call] = fetch.calls;
  assert.equal(call.init.method, 'POST');
  assert.equal(call.url.pathname, '/.netlify/functions/externalTime');
  assert.equal(call.url.searchParams.get('language'), 'es');
  assert.equal(call.init.headers.Authorization, `Bearer ${TOKEN}`);
  assert.equal(call.init.headers['Content-Type'], undefined);

  const body = JSON.parse(call.init.body);
  assert.deepEqual(Object.keys(body).sort(),
    ['date', 'description', 'id', 'idempotencyKey', 'timeSeconds', 'today', 'type']);
  assert.equal(body.id, 'abc123');
  assert.equal(body.timeSeconds, 1800);
  assert.equal(body.type, 'listening');
  assert.equal(body.date, '2026-06-05');
  assert.match(body.today, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(body.idempotencyKey, 'k'.repeat(64));
});

test('addExternalTime generates DS-style ids and fresh idempotency keys', async () => {
  const { DSApi, fetch } = loadApi({ routes: { externalTime: {} } });
  await DSApi.addExternalTime({ date: '2026-06-05', timeSeconds: 60, description: 'x', type: 'listening' });
  await DSApi.addExternalTime({ date: '2026-06-05', timeSeconds: 60, description: 'x', type: 'listening' });
  const [a, b] = fetch.calls.map(c => JSON.parse(c.init.body));
  assert.match(a.id, /^\d{13}[0-9a-f]+$/);
  assert.notEqual(a.id, b.id);
  assert.match(a.idempotencyKey, /^[0-9a-f]{64}$/);
  assert.notEqual(a.idempotencyKey, b.idempotencyKey);
});

test('addExternalTime surfaces an expired login so an import stops', async () => {
  const { DSApi } = loadApi({ routes: { externalTime: 401 } });
  await assert.rejects(
    DSApi.addExternalTime({ date: '2026-06-05', timeSeconds: 60, description: 'x', type: 'listening' }),
    /AUTH_EXPIRED/,
  );
});

test('deleteExternalTime sends the id in the body', async () => {
  const { DSApi, fetch } = loadApi({ routes: { externalTime: { message: 'Okay.' } } });
  await DSApi.deleteExternalTime('abc123', 'fr');
  const [call] = fetch.calls;
  assert.equal(call.init.method, 'DELETE');
  assert.equal(call.url.searchParams.get('language'), 'fr');
  const body = JSON.parse(call.init.body);
  assert.equal(body.id, 'abc123');
  assert.match(body.idempotencyKey, /^[0-9a-f]{64}$/);
});

test('dsToday rolls the day over at 4am', () => {
  const { DSApi } = loadApi();
  assert.equal(DSApi.dsToday(new Date(2026, 5, 2, 3, 59)), '2026-06-01');
  assert.equal(DSApi.dsToday(new Date(2026, 5, 2, 4, 0)), '2026-06-02');
});
