/**
 * Dreaming Spanish Enhancer - Time Outside Import Card
 * Injected on /progress/time-outside. Upload a listening-history CSV, pick the
 * Spanish shows, review every episode (duplicates are unticked with a reason),
 * then post one DS entry per day + show. The last import can be undone.
 */

const TimeOutsideUI = {
  LOG_KEY: 'ds_time_outside_imports',
  SHOWS_KEY: 'ds_time_outside_shows',
  ROLE_LABELS: { date: 'Date', start: 'Start time', end: 'End time', duration: 'Time listened', show: 'Show', title: 'Episode' },
  STATUS_LABELS: {
    new: 'New', weak: 'Check', manual: 'Logged by hand', imported: 'Already imported',
    repeat: 'Repeat', invalid: 'Unreadable',
  },

  // ---- Storage ----

  storageGet(key, fallback) {
    return new Promise(resolve => {
      chrome.storage.local.get([key], r => resolve(r[key] ?? fallback));
    });
  },

  storageSet(key, value) {
    return new Promise(resolve => chrome.storage.local.set({ [key]: value }, resolve));
  },

  /** Import log: [{ at, language, entries: [{ id, date, timeSeconds, keys }] }], newest last. */
  loadLog() { return this.storageGet(this.LOG_KEY, []); },
  saveLog(log) { return this.storageSet(this.LOG_KEY, log); },

  /** Episode keys from past imports whose DS entry still exists (deleted ones can be re-imported). */
  importedKeys(log, existing, language) {
    const ids = new Set(existing.map(e => e.id));
    const keys = new Set();
    for (const imp of log) {
      if (imp.language !== language) continue;
      for (const e of imp.entries) if (ids.has(e.id)) e.keys.forEach(k => keys.add(k));
    }
    return keys;
  },

  // ---- Card ----

  createCard({ language, isDark }) {
    const card = document.createElement('div');
    card.className = 'ds-card ds-toi-card' + (isDark ? ' ds-dark' : '');
    card.innerHTML = `
      <div class="ds-card-header">
        <h2 class="ds-card-title">Import listening from CSV</h2>
        <div class="ds-card-header-actions">
          <button class="ds-toi-btn ds-toi-undo" hidden></button>
        </div>
      </div>
      <div class="ds-toi-body"></div>
    `;
    const state = { language, table: null, mapping: null, episodes: [], shows: [], existing: [], showPrefs: {}, rowOverride: new Map(), confirm: false };
    card._toi = state;
    this.renderPicker(card);
    this.refreshUndo(card);
    return card;
  },

  body(card) { return card.querySelector('.ds-toi-body'); },

  renderPicker(card, message = '') {
    this.body(card).innerHTML = `
      <label class="ds-toi-drop">
        <input type="file" accept=".csv,text/csv,text/plain" hidden>
        <strong>Choose a listening-history CSV</strong>
        <span>e.g. Podcast Addict's "Listening report". Nothing is posted until you confirm.</span>
      </label>
      ${message ? `<p class="ds-toi-msg ds-toi-msg-error">${this.esc(message)}</p>` : ''}
    `;
    const input = this.body(card).querySelector('input[type=file]');
    input.addEventListener('change', () => {
      if (input.files[0]) this.loadFile(card, input.files[0]);
    });
  },

  async loadFile(card, file) {
    const state = card._toi;
    this.body(card).innerHTML = '<div class="ds-card-loading">Reading file and your existing entries…</div>';
    try {
      const text = await file.text();
      state.table = TimeOutsideImport.parseCsv(text);
      if (state.table.rows.length === 0) throw new Error('That file has no rows.');
      state.mapping = TimeOutsideImport.detectColumns(state.table.headers, state.table.rows);
      // Duplicate checks need the current DS entries — refuse to continue without them.
      state.existing = await DSApi.getExternalTimes(state.language);
      state.importedKeys = this.importedKeys(await this.loadLog(), state.existing, state.language);
      state.showPrefs = await this.storageGet(this.SHOWS_KEY, {});
      state.fileName = file.name;
      this.recompute(card);
    } catch (e) {
      this.renderPicker(card, this.errorText(e));
    }
  },

  recompute(card) {
    const state = card._toi;
    state.rowOverride.clear();
    const raw = TimeOutsideImport.toEpisodes(state.table.rows, state.mapping);
    state.shows = TimeOutsideImport.suggestShows(raw);
    state.episodes = TimeOutsideImport.classifyDuplicates(raw, state.existing, state.importedKeys);
    this.renderReview(card);
  },

  isShowOn(state, show) {
    const pref = state.showPrefs[show];
    if (typeof pref === 'boolean') return pref;
    return !!state.shows.find(s => s.show === show)?.spanish;
  },

  isRowOn(state, ep) {
    return state.rowOverride.has(ep.row) ? state.rowOverride.get(ep.row) : ep.selected;
  },

  /** Episodes from ticked shows with their effective checkbox state. */
  activeEpisodes(state) {
    return state.episodes
      .filter(ep => ep.status === 'invalid' || this.isShowOn(state, ep.show))
      .map(ep => ({ ...ep, selected: ep.status !== 'invalid' && this.isRowOn(state, ep) }));
  },

  renderReview(card) {
    const state = card._toi;
    const T = TimeOutsideImport;
    const active = this.activeEpisodes(state);
    const entries = T.buildEntries(active);
    const totalSec = entries.reduce((s, e) => s + e.timeSeconds, 0);
    const counts = {};
    active.forEach(ep => { counts[ep.status] = (counts[ep.status] || 0) + 1; });
    const hours = s => (s / 3600).toFixed(1);

    const mappingHtml = Object.entries(this.ROLE_LABELS).map(([role, label]) => `
      <label class="ds-toi-map">
        <span>${label}</span>
        <select data-role="${role}">
          <option value="">—</option>
          ${state.table.headers.map(h => `<option value="${this.esc(h)}" ${state.mapping[role] === h ? 'selected' : ''}>${this.esc(h)}</option>`).join('')}
        </select>
      </label>`).join('');

    const showsHtml = state.shows.map(s => `
      <label class="ds-toi-show">
        <input type="checkbox" data-show="${this.esc(s.show)}" ${this.isShowOn(state, s.show) ? 'checked' : ''}>
        <span class="ds-toi-show-name">${this.esc(s.show || '(no show name)')}</span>
        <span class="ds-toi-muted">${s.episodes} ep · ${hours(s.seconds)} h</span>
      </label>`).join('');

    const rowsHtml = active.map(ep => `
      <tr class="ds-toi-row ds-toi-${ep.status}${ep.selected ? '' : ' ds-toi-off'}">
        <td><input type="checkbox" data-row="${ep.row}" ${ep.selected ? 'checked' : ''} ${ep.status === 'invalid' ? 'disabled' : ''}></td>
        <td class="ds-toi-nowrap">${this.esc(ep.date || '')}</td>
        <td>${this.esc(ep.show)}</td>
        <td>${this.esc(ep.title)}</td>
        <td class="ds-toi-num">${Math.round(ep.seconds / 60)}m</td>
        <td>
          <span class="ds-toi-badge ds-toi-badge-${ep.status}">${this.STATUS_LABELS[ep.status]}</span>
          ${ep.reason ? `<div class="ds-toi-reason">${this.esc(ep.reason)}</div>` : ''}
          ${ep.match ? `<div class="ds-toi-match">“${this.esc(String(ep.match.description || '').replace(/\s+/g, ' ').slice(0, 90))}”</div>` : ''}
        </td>
      </tr>`).join('');

    const dupCount = (counts.imported || 0) + (counts.manual || 0) + (counts.repeat || 0);
    // Re-rendering replaces the table, so carry its scroll position and the open sections over.
    const prevScroll = this.body(card).querySelector('.ds-toi-table-wrap')?.scrollTop || 0;
    this.body(card).innerHTML = `
      <p class="ds-toi-file">${this.esc(state.fileName)} · ${state.table.rows.length} rows
        <button class="ds-toi-link ds-toi-change">Choose another file</button></p>

      <details class="ds-toi-section" ${Object.values(state.mapping).some(Boolean) && state.mapping.date && (state.mapping.duration || (state.mapping.start && state.mapping.end)) ? '' : 'open'}>
        <summary>Columns</summary>
        <div class="ds-toi-maps">${mappingHtml}</div>
      </details>

      <details class="ds-toi-section" open>
        <summary>Shows to import <span class="ds-toi-muted">(Spanish shows are pre-ticked)</span></summary>
        <div class="ds-toi-shows">${showsHtml}</div>
      </details>

      <div class="ds-toi-summary">
        <strong>${entries.length}</strong> entries · <strong>${hours(totalSec)} h</strong>
        <span class="ds-toi-muted">from ${active.filter(e => e.selected).length} episodes, one entry per day and show</span>
        ${dupCount ? `<div class="ds-toi-dupnote">${dupCount} episode${dupCount === 1 ? '' : 's'} already on DS or repeated — unticked. Tick any you still want to add.</div>` : ''}
        ${counts.weak ? `<div class="ds-toi-dupnote">${counts.weak} marked “Check”: same show logged within a day, but nothing else matched. Still ticked.</div>` : ''}
      </div>

      <div class="ds-toi-table-wrap">
        <table class="ds-toi-table">
          <thead><tr><th></th><th>DS day</th><th>Show</th><th>Episode</th><th>Time</th><th>Status</th></tr></thead>
          <tbody>${rowsHtml || '<tr><td colspan="6" class="ds-toi-muted">No episodes from the ticked shows.</td></tr>'}</tbody>
        </table>
      </div>

      <div class="ds-toi-actions">
        <button class="ds-toi-btn ds-toi-btn-primary ds-toi-import" ${entries.length ? '' : 'disabled'}>
          ${state.confirm ? `Post ${entries.length} entries (${hours(totalSec)} h) to Dreaming — confirm` : `Import ${entries.length} entries`}
        </button>
        ${state.confirm ? '<button class="ds-toi-btn ds-toi-cancel">Cancel</button>' : ''}
      </div>
      <div class="ds-toi-status"></div>
    `;

    const b = this.body(card);
    b.querySelector('.ds-toi-table-wrap').scrollTop = prevScroll;
    b.querySelector('.ds-toi-change').addEventListener('click', () => this.renderPicker(card));
    b.querySelectorAll('select[data-role]').forEach(sel => sel.addEventListener('change', () => {
      state.mapping[sel.dataset.role] = sel.value || null;
      state.confirm = false;
      this.recompute(card);
    }));
    b.querySelectorAll('input[data-show]').forEach(cb => cb.addEventListener('change', () => {
      state.showPrefs[cb.dataset.show] = cb.checked;
      this.storageSet(this.SHOWS_KEY, state.showPrefs);
      state.confirm = false;
      this.renderReview(card);
    }));
    b.querySelectorAll('input[data-row]').forEach(cb => cb.addEventListener('change', () => {
      state.rowOverride.set(+cb.dataset.row, cb.checked);
      state.confirm = false;
      this.renderReview(card);
    }));
    b.querySelector('.ds-toi-cancel')?.addEventListener('click', () => {
      state.confirm = false;
      this.renderReview(card);
    });
    b.querySelector('.ds-toi-import').addEventListener('click', () => {
      if (!state.confirm) { state.confirm = true; this.renderReview(card); return; }
      state.confirm = false;
      this.runImport(card, entries);
    });
  },

  async runImport(card, entries) {
    const state = card._toi;
    const b = this.body(card);
    b.querySelectorAll('button, input, select').forEach(el => { el.disabled = true; });
    const status = b.querySelector('.ds-toi-status');

    const log = await this.loadLog();
    const record = { at: new Date().toISOString(), language: state.language, file: state.fileName, entries: [] };
    log.push(record);

    let failure = null;
    for (let i = 0; i < entries.length; i++) {
      status.textContent = `Posting ${i + 1} of ${entries.length}…`;
      const entry = entries[i];
      const opts = { id: DSApi.newExternalTimeId(), idempotencyKey: DSApi.idempotencyKey() };
      try {
        let id;
        try {
          id = await DSApi.addExternalTime(entry, state.language, opts);
        } catch (e) {
          if (/AUTH_EXPIRED|NOT_AUTHENTICATED/.test(e.message)) throw e;
          // The POST may have landed with only the response lost — DS isn't known to
          // honour the idempotency key, so look for our id before retrying once.
          await new Promise(r => setTimeout(r, 1500));
          const landed = (await DSApi.getExternalTimes(state.language)).some(x => x.id === opts.id);
          id = landed ? opts.id : await DSApi.addExternalTime(entry, state.language, opts);
        }
        record.entries.push({ id, date: entry.date, timeSeconds: entry.timeSeconds, keys: entry.keys });
        // Save after every entry so a closed tab can't lose track of what was posted.
        await this.saveLog(log);
      } catch (e) {
        failure = { index: i, entry, error: e };
        break;
      }
    }
    if (record.entries.length === 0) {
      log.pop();
      await this.saveLog(log);
    }

    const added = record.entries.length;
    const addedSec = record.entries.reduce((s, e) => s + e.timeSeconds, 0);
    this.body(card).innerHTML = `
      <div class="ds-toi-result ${failure ? 'ds-toi-msg-error' : ''}">
        <p><strong>Added ${added} of ${entries.length} entries (${(addedSec / 3600).toFixed(1)} h).</strong></p>
        ${failure ? `<p>Stopped at ${this.esc(failure.entry.date)} · ${this.esc(failure.entry.description.split('\n')[0])}: ${this.esc(this.errorText(failure.error))}</p>
          <p>Choose the file again to continue — everything already added will show as “Already imported”.</p>` : ''}
        <p class="ds-toi-muted">Reload the page to see the new entries in your history and totals.</p>
        <div class="ds-toi-actions">
          <button class="ds-toi-btn ds-toi-btn-primary ds-toi-reload">Reload page</button>
          <button class="ds-toi-btn ds-toi-again">Import another file</button>
        </div>
      </div>
    `;
    this.body(card).querySelector('.ds-toi-reload').addEventListener('click', () => location.reload());
    this.body(card).querySelector('.ds-toi-again').addEventListener('click', () => this.renderPicker(card));
    this.refreshUndo(card);
  },

  // ---- Undo ----

  async refreshUndo(card) {
    const btn = card.querySelector('.ds-toi-undo');
    const log = await this.loadLog();
    const last = [...log].reverse().find(imp => imp.language === card._toi.language && imp.entries.length);
    if (!last) { btn.hidden = true; return; }
    btn.hidden = false;
    btn.disabled = false;
    btn.textContent = `Undo last import (${last.entries.length})`;
    btn.onclick = async () => {
      if (btn.dataset.confirm !== '1') {
        btn.dataset.confirm = '1';
        btn.textContent = `Delete ${last.entries.length} imported entries? Click again`;
        return;
      }
      btn.dataset.confirm = '';
      btn.disabled = true;
      await this.undo(card, last);
    };
  },

  async undo(card, imp) {
    const btn = card.querySelector('.ds-toi-undo');
    const language = card._toi.language;
    let existingIds;
    try {
      existingIds = new Set((await DSApi.getExternalTimes(language)).map(e => e.id));
    } catch (e) {
      btn.textContent = `Undo failed: ${this.errorText(e)}`;
      btn.disabled = false;
      return;
    }
    const remaining = [];
    const toDelete = imp.entries.filter(e => existingIds.has(e.id)); // skip ones already deleted by hand
    for (const [i, e] of toDelete.entries()) {
      btn.textContent = `Deleting ${i + 1} of ${toDelete.length}…`;
      try {
        await DSApi.deleteExternalTime(e.id, language);
      } catch (err) {
        remaining.push(e);
      }
    }
    const log = await this.loadLog();
    const idx = log.findIndex(x => x.at === imp.at);
    if (idx >= 0) {
      if (remaining.length) log[idx].entries = remaining; else log.splice(idx, 1);
      await this.saveLog(log);
    }
    if (remaining.length) {
      btn.textContent = `${remaining.length} couldn't be deleted — try again`;
      btn.disabled = false;
    } else {
      this.body(card).innerHTML = `
        <p>Removed that import. <button class="ds-toi-link ds-toi-reload">Reload page</button></p>`;
      this.body(card).querySelector('.ds-toi-reload').addEventListener('click', () => location.reload());
      this.refreshUndo(card);
    }
  },

  // ---- Helpers ----

  errorText(e) {
    const m = String(e?.message || e);
    if (/AUTH_EXPIRED|NOT_AUTHENTICATED/.test(m)) return 'Your Dreaming login has expired — reload the page and sign in.';
    if (/API_SHAPE/.test(m)) return 'Dreaming changed how it returns your entries, so duplicates can’t be checked. Nothing was posted.';
    if (/NETWORK_ERROR/.test(m)) return 'Network error — check your connection.';
    return m;
  },

  esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  },
};
