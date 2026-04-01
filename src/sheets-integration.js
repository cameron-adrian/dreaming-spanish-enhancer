/**
 * Dreaming Spanish Enhancer - Google Sheets Integration
 * Sends logged book data to a user-configured Google Spreadsheet.
 *
 * Setup:
 *  1. Go to https://console.cloud.google.com/ and create a project.
 *  2. Enable the "Google Sheets API" for your project.
 *  3. Create OAuth 2.0 credentials: APIs & Services → Credentials →
 *     Create Credentials → OAuth client ID → Chrome App.
 *     Use your extension's ID as the Application ID.
 *  4. Replace the client_id placeholder in manifest.json with your client ID.
 *  5. Create (or open) a Google Sheet and copy its ID from the URL:
 *     https://docs.google.com/spreadsheets/d/<SPREADSHEET_ID>/edit
 *  6. Paste the Spreadsheet ID into the "⚙ Sheets" panel on the Book Tracker card.
 */

const SheetsIntegration = {
  STORAGE_KEY: 'ds_sheets_config',

  // ---- Config Storage ----

  getConfig() {
    return new Promise(resolve => {
      chrome.storage.local.get([this.STORAGE_KEY], result => {
        resolve(result[this.STORAGE_KEY] || { enabled: false, spreadsheetId: '' });
      });
    });
  },

  saveConfig(config) {
    return new Promise(resolve => {
      chrome.storage.local.set({ [this.STORAGE_KEY]: config }, resolve);
    });
  },

  // ---- Append a book via background service worker ----

  async appendBook(book) {
    const config = await this.getConfig();
    if (!config.enabled || !config.spreadsheetId) return { skipped: true };

    return new Promise(resolve => {
      chrome.runtime.sendMessage(
        { type: 'SHEETS_APPEND_BOOK', book, spreadsheetId: config.spreadsheetId },
        response => {
          if (chrome.runtime?.lastError) {
            resolve({ ok: false, error: chrome.runtime.lastError.message });
          } else {
            resolve(response || { ok: false, error: 'No response from background' });
          }
        }
      );
    });
  },

  // ---- Settings UI ----

  buildSettingsHtml(config) {
    const enabled = !!config.enabled;
    const spreadsheetId = config.spreadsheetId || '';
    return `
      <div class="ds-sheets-inner">
        <div class="ds-sheets-header">
          <span class="ds-sheets-title">Google Sheets Sync</span>
          <label class="ds-sheets-toggle-wrap">
            <input type="checkbox" class="ds-sheets-enabled-cb"${enabled ? ' checked' : ''} />
            <span class="ds-sheets-toggle-track">
              <span class="ds-sheets-toggle-thumb"></span>
            </span>
            <span class="ds-sheets-toggle-label">${enabled ? 'On' : 'Off'}</span>
          </label>
        </div>
        <div class="ds-sheets-config${enabled ? '' : ' ds-sheets-config-hidden'}">
          <label class="ds-book-form-label">Spreadsheet ID</label>
          <div class="ds-sheets-id-row">
            <input
              class="ds-book-input ds-sheets-id-input"
              type="text"
              placeholder="1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms"
              value="${this.escapeHtml(spreadsheetId)}"
            />
            <button class="ds-sheets-save-btn">Save</button>
          </div>
          <p class="ds-sheets-hint">
            Find the ID in your sheet URL:<br>
            …/spreadsheets/d/<strong>[ID]</strong>/edit
          </p>
        </div>
        <div class="ds-sheets-status"></div>
      </div>`;
  },

  wireSettingsEvents(card, config) {
    const cb = card.querySelector('.ds-sheets-enabled-cb');
    const configDiv = card.querySelector('.ds-sheets-config');
    const label = card.querySelector('.ds-sheets-toggle-label');

    cb.addEventListener('change', async () => {
      config.enabled = cb.checked;
      label.textContent = cb.checked ? 'On' : 'Off';
      configDiv.classList.toggle('ds-sheets-config-hidden', !cb.checked);
      await this.saveConfig(config);
    });

    card.querySelector('.ds-sheets-save-btn').addEventListener('click', async () => {
      const id = card.querySelector('.ds-sheets-id-input').value.trim();
      config.spreadsheetId = id;
      await this.saveConfig(config);
      this.showSettingsStatus(card, 'Settings saved.', 'success');
    });
  },

  showSettingsStatus(card, text, type) {
    const el = card.querySelector('.ds-sheets-status');
    if (!el) return;
    el.textContent = text;
    el.className = `ds-sheets-status ds-sheets-status-${type}`;
    if (type === 'success') {
      setTimeout(() => {
        el.textContent = '';
        el.className = 'ds-sheets-status';
      }, 3000);
    }
  },

  // ---- Helpers ----

  escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  },
};
