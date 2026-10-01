/**
 * Dreaming Spanish Enhancer - Time Outside CSV Import (pure logic, no DOM)
 *
 * Turns a listening-history CSV (Podcast Addict's "Listening report", or any
 * CSV with date / duration / show / episode columns) into DS "time outside"
 * entries, and flags episodes that are already on DS so they aren't added twice.
 *
 * Pipeline:
 *   parseCsv → detectColumns → toEpisodes → suggestShows (which shows are Spanish)
 *   → classifyDuplicates (against DS entries + local import log) → buildEntries
 */

const TimeOutsideImport = {
  // DS rolls its day over at 4am local time (DATE_CHANGE_TIME in the DS app).
  DAY_CHANGE_HOUR: 4,

  // ---- CSV parsing ----

  parseCsv(text) {
    text = String(text || '').replace(/^﻿/, '');
    const delimiter = this.sniffDelimiter(text);
    const records = [];
    let row = [];
    let field = '';
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inQuotes) {
        if (ch === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
        } else {
          field += ch;
        }
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === delimiter) {
        row.push(field); field = '';
      } else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(field); field = '';
        records.push(row); row = [];
      } else {
        field += ch;
      }
    }
    if (field !== '' || row.length) { row.push(field); records.push(row); }

    const nonEmpty = records.filter(r => r.some(c => c.trim() !== ''));
    if (nonEmpty.length === 0) return { headers: [], rows: [] };
    const headers = nonEmpty[0].map(h => h.trim());
    const rows = nonEmpty.slice(1).map(r => {
      const obj = {};
      headers.forEach((h, i) => { obj[h] = (r[i] ?? '').trim(); });
      return obj;
    });
    return { headers, rows };
  },

  /** Pick the delimiter that splits the header line into the most columns. */
  sniffDelimiter(text) {
    let firstLine = '';
    let inQuotes = false;
    for (const ch of text) {
      if (ch === '"') inQuotes = !inQuotes;
      if (!inQuotes && (ch === '\n' || ch === '\r')) break;
      firstLine += ch;
    }
    const outsideQuotes = firstLine.replace(/"[^"]*"/g, '');
    let best = ',';
    let bestCount = 0;
    for (const d of [',', ';', '\t']) {
      const n = outsideQuotes.split(d).length - 1;
      if (n > bestCount) { best = d; bestCount = n; }
    }
    return best;
  },

  // ---- Value parsing ----

  /** Seconds from "HH:MM:SS", "MM:SS", "1h 23m 4s", or a bare number (unit from the header). */
  parseDuration(value, header = '') {
    const v = String(value ?? '').trim().toLowerCase();
    if (!v) return null;

    let m = v.match(/^(\d+):(\d{1,2}):(\d{1,2})(?:\.\d+)?$/);
    if (m) return +m[1] * 3600 + +m[2] * 60 + +m[3];
    m = v.match(/^(\d+):(\d{1,2})(?:\.\d+)?$/);
    if (m) return +m[1] * 60 + +m[2];

    m = v.match(/^(?:(\d+(?:\.\d+)?)\s*h(?:ours?|rs?)?)?\s*(?:(\d+(?:\.\d+)?)\s*m(?:in(?:utes?|s)?)?)?\s*(?:(\d+(?:\.\d+)?)\s*s(?:ec(?:onds?|s)?)?)?$/);
    if (m && (m[1] || m[2] || m[3])) {
      return Math.round((+(m[1] || 0)) * 3600 + (+(m[2] || 0)) * 60 + (+(m[3] || 0)));
    }

    if (/^\d+(\.\d+)?$/.test(v)) {
      const n = parseFloat(v);
      const h = header.toLowerCase();
      // Unit words may be glued on with underscores ("duration_ms"), so don't rely on \b.
      if (/(^|[^a-z])ms($|[^a-z])|millis/.test(h)) return Math.round(n / 1000);
      if (/min/.test(h)) return Math.round(n * 60);
      if (/hour|hora|(^|[^a-z])hrs?($|[^a-z])/.test(h)) return Math.round(n * 3600);
      return Math.round(n);
    }
    return null;
  },

  /**
   * Parse a date or timestamp. Returns { date: 'YYYY-MM-DD', hour } (hour is
   * null when the value has no time part) or null.
   */
  parseDate(value) {
    const v = String(value ?? '').trim();
    if (!v) return null;
    const pad = n => String(n).padStart(2, '0');
    const valid = (y, mo, d) => {
      const dt = new Date(y, mo - 1, d);
      return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d;
    };
    const timeHour = rest => {
      const t = (rest || '').match(/(\d{1,2}):\d{2}(?::\d{2})?\s*(am|pm)?/i);
      if (!t) return null;
      let h = +t[1];
      if (t[2]) h = (h % 12) + (/pm/i.test(t[2]) ? 12 : 0);
      return h;
    };

    // Epoch seconds or milliseconds
    if (/^\d{10}(\d{3})?$/.test(v)) {
      const dt = new Date(v.length === 13 ? +v : +v * 1000);
      return { date: `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`, hour: dt.getHours() };
    }

    // ISO-ish: 2026-05-27, 2026-05-27 10:52:19, 2026-05-27T10:52:19
    let m = v.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(.*)$/);
    if (m) {
      const [y, mo, d] = [+m[1], +m[2], +m[3]];
      if (!valid(y, mo, d)) return null;
      // A trailing Z / offset means UTC — convert to local time.
      if (/T?\d{1,2}:\d{2}.*(Z|[+-]\d{2}:?\d{2})$/.test(m[4])) {
        const dt = new Date(v);
        if (!isNaN(dt)) return { date: `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`, hour: dt.getHours() };
      }
      return { date: `${y}-${pad(mo)}-${pad(d)}`, hour: timeHour(m[4]) };
    }

    // D/M/Y or M/D/Y: month-first unless the first number can't be a month.
    m = v.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})(.*)$/);
    if (m) {
      let [a, b, y] = [+m[1], +m[2], +m[3]];
      if (y < 100) y += 2000;
      const dotted = v.includes('.');
      let [mo, d] = (a > 12 || dotted) ? [b, a] : [a, b];
      if (!valid(y, mo, d)) return null;
      return { date: `${y}-${pad(mo)}-${pad(d)}`, hour: timeHour(m[4]) };
    }
    return null;
  },

  shiftDate(ymd, days) {
    const [y, m, d] = ymd.split('-').map(Number);
    const dt = new Date(y, m - 1, d + days);
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  },

  dayDiff(a, b) {
    const toUtc = s => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
    return Math.round((toUtc(a) - toUtc(b)) / 86400000);
  },

  /** The DS day a listen belongs to: before 4am counts toward the previous day. */
  dsDay(dateParsed, startParsed) {
    const base = dateParsed?.date || startParsed?.date;
    if (!base) return null;
    const ref = startParsed || dateParsed;
    if (ref.hour != null && ref.date === base && ref.hour < this.DAY_CHANGE_HOUR) {
      return this.shiftDate(base, -1);
    }
    return base;
  },

  // ---- Column detection ----

  ROLE_RULES: {
    date: [[/^(listening_|played_|listen_)?date$|^fecha$|^day$|^d[ií]a$/, 10], [/date|fecha|\bday\b|d[ií]a/, 5]],
    start: [[/start|inicio|played.?at|began|listened.?at|timestamp/, 8]],
    end: [[/(^|[_\s])end|finish|fin$/, 7]],
    duration: [
      [/listened.?(duration|time)|time.?listened|played.?(duration|time)|listening.?time/, 10],
      [/duration|duraci[oó]n|minutes|minutos|seconds|segundos|length|tiempo/, 5],
      [/elapsed/, 2],
      [/episode/, -4],
    ],
    show: [[/(podcast|show|feed|channel)[_\s]?(name|title)/, 10], [/podcast|show|programa|feed|channel|series|serie\b/, 6], [/episode/, -6]],
    title: [
      [/episode[_\s]?(name|title)|^title$|t[ií]tulo|episodio/, 10],
      [/episode|title|name|nombre/, 4],
      [/podcast|show|feed/, -3],
      [/duration|date|time|start|end|fully|quality/, -10],
    ],
  },

  /** Guess which header plays which role. Returns { date, start, end, duration, show, title } (header or null). */
  detectColumns(headers, rows = []) {
    const sample = rows.slice(0, 50);
    const share = (h, pred) => {
      const vals = sample.map(r => r[h]).filter(v => v != null && v !== '');
      return vals.length ? vals.filter(pred).length / vals.length : 0;
    };
    const candidates = [];
    for (const [role, rules] of Object.entries(this.ROLE_RULES)) {
      for (const h of headers) {
        const name = h.toLowerCase();
        let score = 0;
        for (const [re, pts] of rules) if (re.test(name)) score += pts;
        if (score <= 0) continue;
        // Values must look like the role, when there are rows to check.
        if (sample.length) {
          if ((role === 'date' || role === 'start' || role === 'end') && share(h, v => this.parseDate(v)) < 0.8) continue;
          if (role === 'duration' && share(h, v => this.parseDuration(v, h) != null) < 0.8) continue;
          if ((role === 'show' || role === 'title') && share(h, v => /[a-zà-ÿ]/i.test(v)) < 0.8) continue;
        }
        candidates.push({ role, h, score });
      }
    }
    candidates.sort((a, b) => b.score - a.score);
    const mapping = { date: null, start: null, end: null, duration: null, show: null, title: null };
    const used = new Set();
    for (const c of candidates) {
      if (mapping[c.role] || used.has(c.h)) continue;
      mapping[c.role] = c.h;
      used.add(c.h);
    }
    return mapping;
  },

  // ---- Rows → episodes ----

  toEpisodes(rows, mapping) {
    return rows.map((r, i) => {
      const ep = { row: i + 2, show: '', title: '', date: null, seconds: 0, error: null };
      ep.show = this.cleanText(mapping.show ? r[mapping.show] : '');
      ep.title = this.cleanText(mapping.title ? r[mapping.title] : '');

      const dateP = mapping.date ? this.parseDate(r[mapping.date]) : null;
      const startP = mapping.start ? this.parseDate(r[mapping.start]) : null;
      ep.date = this.dsDay(dateP, startP);

      let seconds = mapping.duration ? this.parseDuration(r[mapping.duration], mapping.duration) : null;
      if (seconds == null && mapping.start && mapping.end) {
        const s = Date.parse(String(r[mapping.start]).replace(' ', 'T'));
        const e = Date.parse(String(r[mapping.end]).replace(' ', 'T'));
        if (!isNaN(s) && !isNaN(e) && e > s) seconds = Math.round((e - s) / 1000);
      }
      ep.seconds = seconds || 0;

      if (!ep.date) ep.error = 'No readable date';
      else if (seconds == null) ep.error = 'No readable duration';
      else if (!ep.show && !ep.title) ep.error = 'No show or episode name';
      return ep;
    });
  },

  cleanText(s) {
    return String(s ?? '').replace(/\s+/g, ' ').trim();
  },

  // ---- Language detection (which shows are Spanish) ----

  ES_WORDS: new Set('de la que el en los del las por con una para es un como mas mi se al lo su sus pero muy esta este son hay sobre entre cuando porque todo nos ya fue era tu te yo hoy dia vida cosas historia historias hablamos hablar espanol aprender aprende episodio mundo nuestro donde quien'.split(' ')),
  EN_WORDS: new Set('the and of to in is with for you what how on your my this that are we our it why from about who was be at have not week show episode recap game'.split(' ')),

  languageScore(text) {
    let es = 0, en = 0;
    for (const t of this.tokens(text)) {
      if (this.ES_WORDS.has(t)) es++;
      if (this.EN_WORDS.has(t)) en++;
    }
    if (/[ñ¿¡]|ción\b/i.test(text)) es += 2;
    return { es, en };
  },

  /**
   * Summarise episodes per show and guess which are Spanish.
   * Returns [{ show, episodes, seconds, spanish }] sorted Spanish-first, then by time.
   */
  suggestShows(episodes) {
    const byShow = new Map();
    for (const ep of episodes) {
      if (ep.error) continue;
      if (!byShow.has(ep.show)) byShow.set(ep.show, { show: ep.show, episodes: 0, seconds: 0, es: 0, en: 0 });
      const s = byShow.get(ep.show);
      s.episodes++;
      s.seconds += ep.seconds;
      const sc = this.languageScore(ep.title);
      s.es += sc.es;
      s.en += sc.en;
    }
    const out = [];
    for (const s of byShow.values()) {
      const name = this.languageScore(s.show);
      const learnerShow = /spanish|espa[nñ]ol|castellano/i.test(s.show);
      const spanish = learnerShow || (s.es + name.es * 2) > (s.en + name.en * 2);
      out.push({ show: s.show, episodes: s.episodes, seconds: s.seconds, spanish });
    }
    return out.sort((a, b) => (b.spanish - a.spanish) || (b.seconds - a.seconds));
  },

  // ---- Text matching helpers ----

  normalize(s) {
    return String(s ?? '')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  },

  tokens(s) {
    const n = this.normalize(s);
    return n ? n.split(' ') : [];
  },

  // Words too common in podcast names/titles to identify a show or episode.
  GENERIC: new Set(('podcast podcasts spanish espanol learn learning aprende aprender aprendiendo intermediate advanced beginner beginners ' +
    'principiantes falsos the with for and from del las los para con una por que daily diario conversation conversations ' +
    'conversaciones real extra extras chats slow learners course curso level nivel episode episodio episodes episodios ' +
    'part parte everyday dia through mexican').split(' ')),

  STOP: new Set('the and for with que los las del por una con para are was you your our this that its'.split(' ')),

  /** Distinctive words and initialisms that identify a show in a hand-typed note. */
  showSignature(show) {
    const words = this.tokens(show);
    let distinctive = words.filter(w => w.length >= 3 && !this.GENERIC.has(w) && !this.STOP.has(w));
    if (distinctive.length === 0) distinctive = words.filter(w => w.length >= 3 && !this.STOP.has(w));
    const acronyms = new Set();
    for (const seg of String(show).split(/[:|(\-–—]/)) {
      const segWords = this.tokens(seg);
      if (segWords.length >= 2) {
        acronyms.add(segWords.map(w => w[0]).join(''));
        const trimmed = segWords.filter(w => w !== 'podcast');
        if (trimmed.length >= 2) acronyms.add(trimmed.map(w => w[0]).join(''));
      }
    }
    return { distinctive, acronyms: [...acronyms].filter(a => a.length >= 3) };
  },

  showMatches(show, text) {
    const sig = this.showSignature(show);
    const toks = new Set(this.tokens(text));
    if (sig.acronyms.some(a => toks.has(a))) return true;
    const long = sig.distinctive.filter(w => w.length >= 4);
    if (long.length) return long.some(w => toks.has(w));
    return sig.distinctive.length > 0 && sig.distinctive.every(w => toks.has(w));
  },

  titleTokens(title) {
    return [...new Set(this.tokens(title).filter(w =>
      w.length >= 3 && !this.STOP.has(w) && !this.GENERIC.has(w) && !/^\d+$/.test(w)))];
  },

  titleMatches(title, text) {
    const tt = this.titleTokens(title);
    if (tt.length === 0) return false;
    const toks = new Set(this.tokens(text));
    const common = tt.filter(w => toks.has(w)).length;
    if (common >= 3) return true;
    return common >= Math.min(2, tt.length) && common / tt.length >= 0.6 && (tt.length > 1 || tt[0].length >= 5);
  },

  episodeNumber(title) {
    const t = String(title);
    const m = t.match(/(?:\bep(?:isodio|isode|i)?\b\.?|#|\bn[º°o]\.?)\s*(\d{1,4})\b/i) || t.match(/^\s*(\d{1,4})\s*[.:\-–|)]/);
    return m ? +m[1] : null;
  },

  /** Episode numbers mentioned in a note: "ep 25", "eps 1, 3, 6", "#12", "episode 7", "13, 14, 15". */
  numbersInNote(text) {
    const nums = new Set();
    const t = this.normalize(text);
    const re = /\b(?:ep|eps|episode|episodes|episodio|episodios|s\d+\s*ep)\s*((?:\d{1,4}(?:\s*(?:and|y)\s*|\s+)?)+)/g;
    let m;
    while ((m = re.exec(t))) {
      for (const n of m[1].match(/\d{1,4}/g) || []) nums.add(+n);
    }
    // A bare list like "cuentame 13, 14, 15" (normalised to "13 14 15")
    for (const run of t.match(/\b\d{1,4}(?: \d{1,4}){1,}\b/g) || []) {
      for (const n of run.split(' ')) nums.add(+n);
    }
    return nums;
  },

  // ---- Duplicate detection ----

  /** Key that identifies an episode across imports, independent of when it was played. */
  episodeKey(ep) {
    return `${this.normalize(ep.show)}|${this.normalize(ep.title)}`;
  },

  /**
   * Mark each episode with a duplicate status. Nothing is removed — the UI shows
   * every row with its reason, and `selected` is only the default checkbox state.
   *
   *   imported  — this extension already imported it (local log), or its full title
   *               is already in a DS entry's description
   *   repeat    — same episode earlier in this file
   *   manual    — looks like an entry you typed by hand (show + title/episode number,
   *               or show on the same day)
   *   weak      — same show within a day, nothing else agrees (selected, but flagged)
   *   new       — no match
   *   invalid   — row couldn't be read
   *
   * existing: DS externalTimes entries. importedKeys: Set of episodeKey()s from the import log.
   */
  classifyDuplicates(episodes, existing = [], importedKeys = new Set()) {
    const seen = new Set();
    const entries = existing.map(e => ({
      ...e,
      _norm: ` ${this.normalize(e.description)} `,
      _lines: new Set(String(e.description || '').split('\n').map(l => this.normalize(l)).filter(Boolean)),
    }));

    return episodes.map(ep => {
      if (ep.error) return { ...ep, status: 'invalid', reason: ep.error, selected: false };
      const key = this.episodeKey(ep);
      const out = (status, reason, match = null, selected = false) =>
        ({ ...ep, key, status, reason, match, selected });

      if (importedKeys.has(key)) return out('imported', 'Already imported by DS Enhancer');

      // Imported entries list one title per line, so an exact title line under a
      // matching show is conclusive even for short titles. A long title anywhere
      // in a description is conclusive on its own.
      const normTitle = this.normalize(ep.title);
      if (normTitle) {
        const hit = entries.find(e =>
          (normTitle.length >= 15 && e._norm.includes(` ${normTitle} `)) ||
          (e._lines.has(normTitle) && (!ep.show || this.showMatches(ep.show, e.description || ''))));
        if (hit) return out('imported', `Already on DS (${hit.date})`, hit);
      }

      if (seen.has(key)) return out('repeat', 'Same episode appears earlier in this file');
      seen.add(key);

      const near = entries.filter(e => e.date && Math.abs(this.dayDiff(e.date, ep.date)) <= 1);
      const epNum = this.episodeNumber(ep.title);
      let weak = null;
      for (const e of near) {
        const desc = e.description || '';
        const show = ep.show && this.showMatches(ep.show, desc);
        const title = this.titleMatches(ep.title, desc);
        const num = epNum != null && this.numbersInNote(desc).has(epNum);
        if ((show && (title || num)) || (title && this.titleTokens(ep.title).length >= 3)) {
          return out('manual', `Matches your entry on ${e.date}`, e);
        }
        if (show && e.date === ep.date) {
          return out('manual', `You logged this show on ${e.date}`, e);
        }
        if (show && !weak) weak = e;
      }
      if (weak) return out('weak', `Same show logged on ${weak.date}`, weak, true);
      return out('new', '', null, true);
    });
  },

  // ---- Episodes → DS entries ----

  /**
   * Group selected episodes into one DS entry per day + show, formatted like
   * hand-typed entries ("Show:\n\nEpisode\nEpisode"). Time is summed first and
   * rounded to whole minutes once; groups under 30 seconds are dropped.
   * `percent` (1–100) credits only that share of the listened time, applied to
   * each entry before rounding.
   */
  buildEntries(episodes, { type = 'listening', percent = 100 } = {}) {
    const share = this.clampPercent(percent) / 100;
    const groups = new Map();
    for (const ep of episodes) {
      if (!ep.selected || ep.error) continue;
      const k = `${ep.date}|${ep.show}`;
      if (!groups.has(k)) groups.set(k, { date: ep.date, show: ep.show, seconds: 0, titles: [], keys: [] });
      const g = groups.get(k);
      g.seconds += ep.seconds;
      if (ep.title) g.titles.push(ep.title);
      g.keys.push(ep.key || this.episodeKey(ep));
    }
    const entries = [];
    for (const g of groups.values()) {
      const timeSeconds = Math.round((g.seconds * share) / 60) * 60;
      if (timeSeconds <= 0) continue;
      const description = g.show
        ? `${g.show}:\n\n${g.titles.join('\n')}`.trim()
        : g.titles.join('\n');
      entries.push({ date: g.date, timeSeconds, description, type, keys: g.keys });
    }
    return entries.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  },

  /** Whole percent between 1 and 100; anything unreadable means 100. */
  clampPercent(value) {
    if (value == null || String(value).trim() === '') return 100;
    const n = Math.round(Number(value));
    if (!Number.isFinite(n)) return 100;
    return Math.min(100, Math.max(1, n));
  },
};
