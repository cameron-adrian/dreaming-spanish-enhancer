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
