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

test('an episode repeated later in the file is unticked', () => {
  const out = T.classifyDuplicates(load().episodes, [], new Set());
  const ep25 = out.filter(e => e.title === 'Episodio 25: Las vacaciones de mi familia');
  assert.equal(ep25.length, 2);
  assert.equal(ep25[0].status, 'new');
  assert.equal(ep25[1].status, 'repeat');
  assert.equal(ep25[1].selected, false);
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

// ---- Episodes finished after an import ----
// Podcast Addict has one row per episode: a later report repeats the row with a
// larger listened time and a later end time (made-up rows, real column layout).

const HEADER = 'listening_date,podcast_name,episode_name,listening_start_at,listening_end_at,elapsed_time,listened_duration,fully_listened,episode_duration,history_quality';
const report = (...rows) => [HEADER, ...rows].join('\n');
const PARTIAL = '2026-09-27,"Charlas Lentas","Un viaje largo por Patagonia",2026-09-27 01:12:51,2026-09-27 01:12:51,00:00:00,00:06:08,false,00:23:13,"approximate"';
const OTHER = '2026-09-28,"Charlas Lentas","Mercados de Oaxaca",2026-09-28 15:00:00,2026-09-28 15:00:00,00:00:00,00:20:00,true,00:20:00,"approximate"';
// Same episode, finished on 9/30: only the end time and totals moved...
const FINISHED_END_MOVED = '2026-09-27,"Charlas Lentas","Un viaje largo por Patagonia",2026-09-27 01:12:51,2026-09-30 18:40:00,00:00:00,00:23:13,true,00:23:13,"approximate"';
// ...or the whole row moved to the new day.
const FINISHED_ROW_MOVED = '2026-09-30,"Charlas Lentas","Un viaje largo por Patagonia",2026-09-30 18:20:00,2026-09-30 18:40:00,00:00:00,00:23:13,true,00:23:13,"approximate"';

/** Import a report the way the card does; returns the DS entries and log it leaves behind. */
function importReport(text, { existing = [], log = [], percent = 100 } = {}) {
  const imported = T.creditedSeconds(log, existing, 'es');
  const classified = T.classifyDuplicates(load(text).episodes, existing, imported);
  const entries = T.buildEntries(classified, { percent });
  const posted = entries.map((e, i) => ({ ...e, id: `${log.length}-${i}` }));
  return {
    classified,
    entries,
    existing: [...existing, ...posted.map(({ id, date, timeSeconds, description, type }) => ({ id, date, timeSeconds, description, type }))],
    log: [...log, { language: 'es', percent, entries: posted.map(({ id, date, timeSeconds, keys, episodes }) => ({ id, date, timeSeconds, keys, episodes })) }],
  };
}

for (const [label, finished] of [['end time moved', FINISHED_END_MOVED], ['whole row moved', FINISHED_ROW_MOVED]]) {
  test(`a partly heard episode finished later adds only the extra time, on the day it was finished (${label})`, () => {
    const first = importReport(report(PARTIAL));
    // 01:12 is before DS's 4am rollover, so the first 6 minutes count for 9/26.
    assert.deepEqual(plain(first.entries.map(e => [e.date, e.timeSeconds])), [['2026-09-26', 6 * 60]]);

    const second = importReport(report(finished, OTHER), first);
    const ep = find(second.classified, 'Un viaje largo por Patagonia');
    assert.equal(ep.status, 'continued');
    assert.equal(ep.selected, true);
    assert.equal(ep.seconds, 1393 - 368);
    assert.equal(ep.date, '2026-09-30');

    const cont = second.entries.find(e => e.date === '2026-09-30');
    assert.equal(cont.timeSeconds, 17 * 60); // 17:05 more
    assert.equal(cont.description, 'Charlas Lentas:\n\nUn viaje largo por Patagonia (continued)');
    assert.equal(find(second.classified, 'Mercados de Oaxaca').status, 'new');

    // A third run of the same report finds nothing new.
    const third = importReport(report(finished, OTHER), second);
    assert.equal(find(third.classified, 'Un viaje largo por Patagonia').status, 'imported');
    assert.equal(find(third.classified, 'Mercados de Oaxaca').status, 'imported');
    assert.equal(third.entries.length, 0);
  });
}

test('the percentage applies to the extra time only, and counts the raw time as heard', () => {
  const first = importReport(report(PARTIAL), { percent: 50 });
  assert.equal(first.entries[0].timeSeconds, 3 * 60);
  assert.equal(first.log[0].entries[0].episodes[first.entries[0].keys[0]], 368);

  const second = importReport(report(FINISHED_END_MOVED), { ...first, percent: 90 });
  assert.equal(find(second.classified, 'Un viaje largo por Patagonia').seconds, 1393 - 368);
  // 17:05 × 0.9 = 15:22 → 15 minutes
  assert.equal(second.entries[0].timeSeconds, 15 * 60);
});

test('undoing the first import means the finished episode is imported in full', () => {
  const first = importReport(report(PARTIAL));
  const undone = { log: first.log, existing: [] }; // entries deleted from DS
  const again = importReport(report(FINISHED_ROW_MOVED), undone);
  const ep = find(again.classified, 'Un viaje largo por Patagonia');
  assert.equal(ep.status, 'new');
  assert.equal(again.entries[0].timeSeconds, 23 * 60);
});

test('less than a minute of extra listening is not a continuation', () => {
  const first = importReport(report(PARTIAL));
  const nudged = PARTIAL.replace('00:06:08,false', '00:06:50,false').replace('2026-09-27 01:12:51,00:00', '2026-09-30 10:00:00,00:00');
  const second = importReport(report(nudged), first);
  assert.equal(find(second.classified, 'Un viaje largo por Patagonia').status, 'imported');
});

test('import logs from before 0.3.3 still allow continuing a single-episode entry', () => {
  const key = T.episodeKey({ show: 'Charlas Lentas', title: 'Un viaje largo por Patagonia' });
  const otherKey = T.episodeKey({ show: 'Charlas Lentas', title: 'Mercados de Oaxaca' });
  const existing = [
    { id: 'old1', date: '2026-09-26', timeSeconds: 360, type: 'listening', description: 'Charlas Lentas:\n\nUn viaje largo por Patagonia' },
  ];
  // Old record: no percent, no per-episode seconds.
  const log = [{ language: 'es', entries: [{ id: 'old1', date: '2026-09-26', timeSeconds: 360, keys: [key] }] }];
  assert.equal(T.creditedSeconds(log, existing, 'es').get(key), 360);
  const second = importReport(report(FINISHED_END_MOVED), { existing, log });
  const ep = find(second.classified, 'Un viaje largo por Patagonia');
  assert.equal(ep.status, 'continued');
  assert.equal(ep.seconds, 1393 - 360);

  // Two episodes sharing one old entry can't be split — stays "Already imported".
  const shared = [{ language: 'es', entries: [{ id: 'old1', date: '2026-09-26', timeSeconds: 1560, keys: [key, otherKey] }] }];
  assert.equal(T.creditedSeconds(shared, existing, 'es').get(key), null);
  const third = importReport(report(FINISHED_END_MOVED), { existing, log: shared });
  assert.equal(find(third.classified, 'Un viaje largo por Patagonia').status, 'imported');
});
