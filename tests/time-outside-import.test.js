const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadScript } = require('./helpers/load-script');

const { TimeOutsideImport: T } = loadScript('src/time-outside-import.js', ['TimeOutsideImport']);
const csv = fs.readFileSync(path.join(__dirname, 'fixtures', 'podcast-addict-listening-report.csv'), 'utf8');

const AL_VUELO = 'Intermediate Spanish - Español Al Vuelo Podcast';
const ECJ = 'Español con Juan';

function load(text = csv) {
  const table = T.parseCsv(text);
  const mapping = T.detectColumns(table.headers, table.rows);
  return { table, mapping, episodes: T.toEpisodes(table.rows, mapping) };
}

const plain = obj => JSON.parse(JSON.stringify(obj));
const find = (list, title) => list.find(e => e.title === title);

// Hand-typed entries in the style they're actually written on DS:
// show shorthand, colon, then loose episode notes.
const handEntries = [
  { id: 'h1', date: '2026-05-28', type: 'listening', timeSeconds: 1320, description: 'al vuelo:\n\ncrazy nightclub stories' },
  { id: 'h2', date: '2026-06-03', type: 'listening', timeSeconds: 840, description: 'ecj ep 25' },
  { id: 'h3', date: '2026-06-05', type: 'listening', timeSeconds: 1200, description: 'languatalk 1 ep' },
  { id: 'h4', date: '2026-06-06', type: 'watching', timeSeconds: 3600, description: 'some youtube video' },
];

// ---- Parsing ----

test('parseCsv handles quoted commas, BOM, CRLF and semicolons', () => {
  const t = T.parseCsv('﻿a;b;c\r\n1;"x;y";"say ""hi"""\r\n');
  assert.deepEqual(plain(t.headers), ['a', 'b', 'c']);
  assert.deepEqual(plain(t.rows), [{ a: '1', b: 'x;y', c: 'say "hi"' }]);

  const q = T.parseCsv('show,title\n"80,000 Hours","Line one\nline two"\n');
  assert.equal(q.rows[0].show, '80,000 Hours');
  assert.equal(q.rows[0].title, 'Line one\nline two');
});

test('Podcast Addict columns are detected, using time listened rather than episode length', () => {
  const { mapping } = load();
  assert.deepEqual(plain(mapping), {
    date: 'listening_date',
    start: 'listening_start_at',
    end: 'listening_end_at',
    duration: 'listened_duration',
    show: 'podcast_name',
    title: 'episode_name',
  });
});

test('generic CSV headers are detected too', () => {
  const t = T.parseCsv('Fecha,Programa,Título,Minutos\n27/05/2026,Hoy Hablamos,Episodio 1,25\n');
  const m = T.detectColumns(t.headers, t.rows);
  assert.equal(m.date, 'Fecha');
  assert.equal(m.show, 'Programa');
  assert.equal(m.title, 'Título');
  assert.equal(m.duration, 'Minutos');
  const [ep] = T.toEpisodes(t.rows, m);
  assert.equal(ep.date, '2026-05-27');
  assert.equal(ep.seconds, 25 * 60);
});

test('parseDuration reads clock, unit and bare-number formats', () => {
  assert.equal(T.parseDuration('01:11:30'), 4290);
  assert.equal(T.parseDuration('27:53'), 27 * 60 + 53);
  assert.equal(T.parseDuration('1h 23m'), 83 * 60);
  assert.equal(T.parseDuration('45 min'), 45 * 60);
  assert.equal(T.parseDuration('90', 'minutes'), 90 * 60);
  assert.equal(T.parseDuration('5400', 'seconds'), 5400);
  assert.equal(T.parseDuration('5400000', 'duration_ms'), 5400);
  assert.equal(T.parseDuration('soon'), null);
});

test('parseDate reads ISO, US, European and rejects impossible dates', () => {
  assert.equal(T.parseDate('2026-05-27').date, '2026-05-27');
  assert.equal(T.parseDate('2026-05-27 10:52:19').hour, 10);
  assert.equal(T.parseDate('5/27/2026').date, '2026-05-27');
  assert.equal(T.parseDate('27/05/2026').date, '2026-05-27');
  assert.equal(T.parseDate('27.05.2026').date, '2026-05-27');
  assert.equal(T.parseDate('2026-02-30'), null);
  assert.equal(T.parseDate('not a date'), null);
});

test('a listen before 4am counts toward the previous DS day', () => {
  const { episodes } = load();
  assert.equal(find(episodes, '2267. La misión Artemis II').date, '2026-06-01');
  assert.equal(find(episodes, 'Viajar sola por el mundo').date, '2026-06-05');
});

test('unreadable rows are reported, not dropped or guessed', () => {
  const { episodes } = load();
  const bad = find(episodes, 'Broken row');
  assert.equal(bad.error, 'No readable date');
  assert.equal(bad.row, 13);
});

// ---- Which shows are Spanish ----

test('Spanish shows are suggested and English ones are not', () => {
  const shows = Object.fromEntries(T.suggestShows(load().episodes).map(s => [s.show, s.spanish]));
  assert.equal(shows[AL_VUELO], true);
  assert.equal(shows[ECJ], true);
  assert.equal(shows['Rugidos de Detroit'], true);
  assert.equal(shows['LanguaTalk Spanish: Learn Spanish through conversation'], true);
  assert.equal(shows['Gridiron Talk with Sam & Alex'], false);
  assert.equal(shows['The Long Read Show'], false);
});

// ---- Duplicate detection ----

test('episodes logged by hand in shorthand are caught', () => {
  const out = T.classifyDuplicates(load().episodes, handEntries, new Set());

  // Same day, show nickname and title words — minutes differ (22 vs 28).
  const nightclub = find(out, 'Crazy Nightclub Stories in Slow Spanish');
  assert.equal(nightclub.status, 'manual');
  assert.equal(nightclub.selected, false);
  assert.equal(nightclub.match.id, 'h1');

  // "ecj ep 25" — initialism plus episode number.
  const ep25 = out.filter(e => e.title === 'Episodio 25: Las vacaciones de mi familia');
  assert.equal(ep25[0].status, 'manual');
  assert.equal(ep25[0].match.id, 'h2');

  // "languatalk 1 ep" — show logged that day, no title to compare.
  assert.equal(find(out, 'Viajar sola por el mundo').status, 'manual');
});

// Podcast Addict's rows hold the time listened in the report period, so one episode
// on two days is two separate listens (this test used to expect "repeat" — that
// assumed one cumulative row per episode, which the measured export disproved).
test('the same episode on two days is two listens; an identical row is a repeat', () => {
  const out = T.classifyDuplicates(load().episodes, [], new Set());
  const ep25 = out.filter(e => e.title === 'Episodio 25: Las vacaciones de mi familia');
  assert.equal(ep25.length, 2);
  assert.deepEqual(plain(ep25.map(e => [e.date, e.status, e.selected])), [['2026-06-03', 'new', true], ['2026-06-07', 'new', true]]);

  const doubled = csv.trim() + '\n' + csv.trim().split('\n')[7];
  const twice = T.classifyDuplicates(load(doubled).episodes, [], new Set())
    .filter(e => e.title === 'Episodio 26: ¿Por qué aprender idiomas?');
  assert.deepEqual(plain(twice.map(e => [e.status, e.selected])), [['new', true], ['repeat', false]]);
});

test('an unrelated entry on a nearby day does not block a new episode', () => {
  const out = T.classifyDuplicates(load().episodes, handEntries, new Set());
  assert.equal(find(out, 'Episodio 26: ¿Por qué aprender idiomas?').status, 'weak');
  assert.equal(find(out, 'Episodio 26: ¿Por qué aprender idiomas?').selected, true);
  assert.equal(find(out, 'Lo que aprendimos del draft').status, 'new');
});

test('re-importing the same file finds everything it posted — with or without the local log', () => {
  const { episodes } = load();
  const first = T.classifyDuplicates(episodes, [], new Set());
  const posted = T.buildEntries(first).map((e, i) => ({ ...e, id: `imp${i}` }));
  const postedTitles = new Set(first.filter(e => e.selected && e.seconds >= 30).map(e => e.title));

  // With the import log (same browser)
  const withLog = T.classifyDuplicates(episodes, posted, new Set(posted.flatMap(p => p.keys)));
  for (const ep of withLog.filter(e => postedTitles.has(e.title))) {
    assert.ok(['imported', 'repeat'].includes(ep.status), `${ep.title}: ${ep.status}`);
    assert.equal(ep.selected, false);
  }

  // Without it (another computer, cleared storage): descriptions alone must be enough,
  // including for a short title like "Art".
  const noLog = T.classifyDuplicates(episodes, posted, new Set());
  for (const ep of noLog.filter(e => postedTitles.has(e.title))) {
    assert.ok(['imported', 'repeat'].includes(ep.status), `${ep.title}: ${ep.status}`);
    assert.equal(ep.selected, false);
  }
  assert.equal(find(noLog, 'Art').status, 'imported');
});

test('a short title only counts as imported under the same show', () => {
  const other = [{ id: 'x', date: '2026-01-01', type: 'listening', timeSeconds: 600, description: 'Some Other Show:\n\nArt' }];
  const out = T.classifyDuplicates(load().episodes, other, new Set());
  assert.equal(find(out, 'Art').status, 'new');
});

// ---- Building DS entries ----

test('entries are one per day and show, in the hand-typed format, rounded to whole minutes', () => {
  const out = T.classifyDuplicates(load().episodes, [], new Set());
  const entries = T.buildEntries(out);

  const alVuelo30 = entries.find(e => e.date === '2026-05-30');
  assert.equal(alVuelo30.description,
    `${AL_VUELO}:\n\nLearn Spanish While Eating Out! - Español Al Vuelo S02 x Ep 25\nArt`);
  // 18:10 + 12:05 = 30:15 → 30 minutes
  assert.equal(alVuelo30.timeSeconds, 30 * 60);
  assert.equal(alVuelo30.type, 'listening');
  assert.equal(alVuelo30.keys.length, 2);

  for (const e of entries) assert.equal(e.timeSeconds % 60, 0);
  // A 20-second listen rounds to nothing and is left out.
  assert.ok(!entries.some(e => e.description.startsWith('Rugidos de Detroit')));
  // Sorted by date, unreadable and unticked rows excluded.
  assert.deepEqual(plain(entries.map(e => e.date)), plain([...entries.map(e => e.date)].sort()));
  assert.ok(!entries.some(e => e.description.includes('Broken row')));
});

test('an attention percentage scales each entry before rounding', () => {
  const out = T.classifyDuplicates(load().episodes, [], new Set());
  const full = T.buildEntries(out);
  const ninety = T.buildEntries(out, { percent: 90 });

  // 30:15 × 0.9 = 27:13.5 → 27 minutes
  assert.equal(ninety.find(e => e.date === '2026-05-30').timeSeconds, 27 * 60);
  // Same entries, descriptions and dedupe keys — only the time changes.
  assert.deepEqual(plain(ninety.map(e => [e.date, e.description, e.keys])), plain(full.map(e => [e.date, e.description, e.keys])));
  for (const e of ninety) assert.equal(e.timeSeconds % 60, 0);
  assert.deepEqual(plain(T.buildEntries(out, { percent: 100 })), plain(full));
});

test('the percentage is clamped to 1–100 and unreadable values mean 100', () => {
  assert.equal(T.clampPercent(90), 90);
  assert.equal(T.clampPercent('85'), 85);
  assert.equal(T.clampPercent(89.6), 90);
  assert.equal(T.clampPercent(150), 100);
  assert.equal(T.clampPercent(0), 1);
  assert.equal(T.clampPercent(-20), 1);
  for (const v of ['', ' ', 'abc', null, undefined, NaN]) assert.equal(T.clampPercent(v), 100, String(v));
});

// ---- Episodes listened to across several imports ----
// Made-up rows in the real layout. Verified on two real exports (2026-09-30): a
// report has one row per episode for its period, and a "measured" row holds only
// the time listened in that period — finishing an episode on a later day shows up
// as a new row with just that day's time, not a bigger running total.

const HEADER = 'listening_date,podcast_name,episode_name,listening_start_at,listening_end_at,elapsed_time,listened_duration,fully_listened,episode_duration,history_quality';
const report = (...rows) => [HEADER, ...rows].join('\n');
// Report 1 (up to 9/29)
const PARTIAL = '2026-09-27,"Charlas Lentas","Un viaje largo por Patagonia",2026-09-27 01:12:51,2026-09-27 01:12:51,00:00:00,00:06:08,false,00:23:13,"approximate"';
const LONG = '2026-09-29,"Historias Largas","La ruta de la seda",2026-09-29 13:07:31,2026-09-29 23:50:58,10:43:27,02:38:49,false,03:05:19,"approximate"';
// Report 2 (9/30 only): the same two episodes finished, plus a 1-second blip.
const PARTIAL_TODAY = '2026-09-30,"Charlas Lentas","Un viaje largo por Patagonia",2026-09-30 13:53:47,2026-09-30 14:21:49,00:28:01,00:14:50,true,00:23:13,"measured"';
const LONG_TODAY = '2026-09-30,"Historias Largas","La ruta de la seda",2026-09-30 00:11:58,2026-09-30 11:40:34,11:28:35,00:30:15,true,03:05:19,"measured"';
const BLIP = '2026-09-30,"Charlas Lentas","Mercados de Oaxaca",2026-09-30 19:40:43,2026-09-30 19:40:45,00:00:01,00:00:01,false,00:22:15,"measured"';
// Report 2 exported again later that day, after more listening.
const PARTIAL_TODAY_LATER = PARTIAL_TODAY.replace('2026-09-30 14:21:49,00:28:01,00:14:50', '2026-09-30 20:05:00,06:11:13,00:25:00');

/** Import a report the way the card does; returns the DS entries and log it leaves behind. */
function importReport(text, { existing = [], log = [], percent = 100 } = {}) {
  const imported = T.credits(log, existing, 'es');
  const classified = T.classifyDuplicates(load(text).episodes, existing, imported);
  const entries = T.buildEntries(classified, { percent });
  const posted = entries.map((e, i) => ({ ...e, id: `${log.length}-${i}` }));
  return {
    classified,
    entries,
    existing: [...existing, ...posted.map(({ id, date, timeSeconds, description, type }) => ({ id, date, timeSeconds, description, type }))],
    log: [...log, { language: 'es', percent, entries: posted.map(({ id, date, timeSeconds, keys, rows }) => ({ id, date, timeSeconds, keys, rows })) }],
  };
}
const statusOf = (r, title) => find(r.classified, title).status;

test('finishing an episode on a later day adds that day\'s listening in full, on that day', () => {
  const first = importReport(report(PARTIAL, LONG));
  // 01:12 is before DS's 4am rollover, so the first 6 minutes count for 9/26.
  assert.deepEqual(plain(first.entries.map(e => [e.date, e.timeSeconds])), [['2026-09-26', 6 * 60], ['2026-09-29', 159 * 60]]);

  const second = importReport(report(PARTIAL_TODAY, LONG_TODAY, BLIP), first);
  const partial = find(second.classified, 'Un viaje largo por Patagonia');
  assert.equal(partial.status, 'new');
  assert.equal(partial.selected, true);
  assert.match(partial.reason, /another day/);
  // Starts 00:11 but ran until 11:40 — it's 9/30's listening, and 9/29's credit doesn't touch it.
  const long = find(second.classified, 'La ruta de la seda');
  assert.equal(long.status, 'new');
  assert.equal(long.date, '2026-09-30');
  assert.deepEqual(plain(second.entries.map(e => [e.date, e.timeSeconds, e.description])), [
    ['2026-09-30', 15 * 60, 'Charlas Lentas:\n\nUn viaje largo por Patagonia'], // the 1-second blip is left out
    ['2026-09-30', 30 * 60, 'Historias Largas:\n\nLa ruta de la seda'],
  ]);

  // Running either report again finds nothing new.
  assert.equal(importReport(report(PARTIAL_TODAY, LONG_TODAY, BLIP), second).entries.length, 0);
  const again1 = importReport(report(PARTIAL, LONG), second);
  assert.equal(again1.entries.length, 0);
  assert.equal(statusOf(again1, 'La ruta de la seda'), 'imported');
});

test('a row re-exported later the same day adds only its extra time', () => {
  const first = importReport(report(PARTIAL_TODAY));
  const second = importReport(report(PARTIAL_TODAY_LATER), first);
  const ep = find(second.classified, 'Un viaje largo por Patagonia');
  assert.equal(ep.status, 'continued');
  assert.equal(ep.selected, true);
  assert.equal(ep.seconds, 1500 - 890);
  assert.deepEqual(plain(second.entries.map(e => [e.date, e.timeSeconds, e.description])), [
    ['2026-09-30', 10 * 60, 'Charlas Lentas:\n\nUn viaje largo por Patagonia (continued)'],
  ]);
  assert.equal(statusOf(importReport(report(PARTIAL_TODAY_LATER), second), 'Un viaje largo por Patagonia'), 'imported');
});

test('less than a minute of extra listening on the same row is not a continuation', () => {
  const first = importReport(report(PARTIAL_TODAY));
  const nudged = PARTIAL_TODAY.replace('00:14:50,true', '00:15:30,true');
  assert.equal(statusOf(importReport(report(nudged), first), 'Un viaje largo por Patagonia'), 'imported');
});

// Not seen in a real export yet: a multi-day report that merges an episode's days into one row.
test('a row whose span covers an imported row only adds the rest', () => {
  const first = importReport(report(LONG));
  const merged = LONG.replace('2026-09-29 23:50:58,10:43:27,02:38:49,false', '2026-09-30 11:40:34,22:33:03,03:09:04,true');
  const second = importReport(report(merged), first);
  const ep = find(second.classified, 'La ruta de la seda');
  assert.equal(ep.status, 'continued');
  assert.equal(ep.seconds, (3 * 3600 + 9 * 60 + 4) - (2 * 3600 + 38 * 60 + 49));
});

test('the percentage applies to the new time only; the log keeps raw seconds', () => {
  const first = importReport(report(PARTIAL_TODAY), { percent: 50 });
  assert.equal(first.entries[0].timeSeconds, 7 * 60); // 7:25
  assert.equal(first.log[0].entries[0].rows[0].seconds, 890);

  const second = importReport(report(PARTIAL_TODAY_LATER), { ...first, percent: 90 });
  // 10:10 × 0.9 = 9:09 → 9 minutes
  assert.equal(second.entries[0].timeSeconds, 9 * 60);
});

test('undoing an import lets the same rows be imported in full again', () => {
  const first = importReport(report(PARTIAL_TODAY));
  const again = importReport(report(PARTIAL_TODAY_LATER), { log: first.log, existing: [] }); // entries deleted from DS
  assert.equal(statusOf(again, 'Un viaje largo por Patagonia'), 'new');
  assert.equal(again.entries[0].timeSeconds, 25 * 60);
});

test('import logs from 0.3.1–0.3.3 match by day', () => {
  const key = T.episodeKey({ show: 'Charlas Lentas', title: 'Un viaje largo por Patagonia' });
  const otherKey = T.episodeKey({ show: 'Charlas Lentas', title: 'Mercados de Oaxaca' });
  const existing = [{ id: 'old1', date: '2026-09-26', timeSeconds: 360, type: 'listening', description: 'Charlas Lentas:\n\nUn viaje largo por Patagonia' }];
  const log031 = [{ language: 'es', entries: [{ id: 'old1', date: '2026-09-26', timeSeconds: 360, keys: [key] }] }];
  assert.deepEqual(plain(T.credits(log031, existing, 'es').get(key)), [{ startAt: null, date: '2026-09-26', seconds: 360 }]);

  // Another day: new listening in full.
  const today = importReport(report(PARTIAL_TODAY), { existing, log: log031 });
  assert.equal(statusOf(today, 'Un viaje largo por Patagonia'), 'new');
  assert.equal(today.entries[0].timeSeconds, 15 * 60);
  // Same day: already imported.
  assert.equal(statusOf(importReport(report(PARTIAL), { existing, log: log031 }), 'Un viaje largo por Patagonia'), 'imported');

  // Two episodes sharing one old entry can't be split: same-day rows stay "Already imported".
  const shared = [{ language: 'es', entries: [{ id: 'old1', date: '2026-09-26', timeSeconds: 1560, keys: [key, otherKey] }] }];
  assert.equal(T.credits(shared, existing, 'es').get(key)[0].seconds, null);
  assert.equal(statusOf(importReport(report(PARTIAL), { existing, log: shared }), 'Un viaje largo por Patagonia'), 'imported');

  // 0.3.3 stored per-episode seconds without timestamps.
  const log033 = [{ language: 'es', entries: [{ id: 'old1', date: '2026-09-26', timeSeconds: 360, keys: [key], episodes: { [key]: 368 } }] }];
  assert.equal(T.credits(log033, existing, 'es').get(key)[0].seconds, 368);
});

test('without the import log, a later day\'s listening is held back for review, not double-counted', () => {
  const first = importReport(report(PARTIAL, LONG));
  const noLog = importReport(report(PARTIAL_TODAY, LONG_TODAY), { existing: first.existing });
  // The 9/29 entry is within a day of 9/30 and names the episode — flagged, unticked.
  assert.equal(statusOf(noLog, 'La ruta de la seda'), 'manual');
  // The 9/26 entry is days away — new.
  assert.equal(statusOf(noLog, 'Un viaje largo por Patagonia'), 'new');
});
