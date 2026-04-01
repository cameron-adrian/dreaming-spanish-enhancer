/**
 * Dreaming Spanish Enhancer - Book Tracker UI
 * A card for tracking books read and estimating word counts.
 * Uses the Open Library API (openlibrary.org) for ISBN lookup.
 */

const BookTrackerUI = {
  STORAGE_KEY: 'ds_books',
  WORDS_PER_PAGE_DEFAULT: 250,

  // ---- Storage ----

  loadBooks() {
    return new Promise(resolve => {
      chrome.storage.local.get([this.STORAGE_KEY], result => {
        resolve(result[this.STORAGE_KEY]?.books || []);
      });
    });
  },

  saveBooks(books) {
    return new Promise(resolve => {
      chrome.storage.local.set({ [this.STORAGE_KEY]: { books } }, resolve);
    });
  },

  // ---- Book Search (ISBN or title/author) ----

  async lookupIsbn(isbn) {
    const clean = isbn.replace(/[-\s]/g, '');
    // Open Library Books API — returns rich data including formatted author names in one request
    const url = `https://openlibrary.org/api/books?bibkeys=ISBN:${encodeURIComponent(clean)}&format=json&jscmd=data`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const json = await resp.json();

    const key = `ISBN:${clean}`;
    const book = json[key];
    if (!book) throw new Error('ISBN not found');

    const title = book.title || '';
    const authors = (book.authors || []).map(a => a.name).filter(Boolean);
    const author = authors.join(', ');
    const pages = book.number_of_pages || 0;

    return { title, author, isbn: clean, pages };
  },

  async searchBooks(query) {
    const url = `https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&limit=7&fields=title,author_name,isbn,number_of_pages_median,first_publish_year`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const json = await resp.json();
    return (json.docs || []).map(doc => ({
      title: doc.title || '',
      author: (doc.author_name || []).join(', '),
      isbn: (doc.isbn || [])[0] || '',
      pages: doc.number_of_pages_median || 0,
      year: doc.first_publish_year || null,
    }));
  },

  // ---- Stats ----

  computeStats(books) {
    const totalBooks = books.length;
    const totalPages = books.reduce((sum, b) => sum + (b.pages || 0), 0);
    const totalWords = books.reduce((sum, b) => sum + (b.wordCount || 0), 0);
    const avgWords = totalBooks > 0 ? Math.round(totalWords / totalBooks) : 0;
    return { totalBooks, totalPages, totalWords, avgWords };
  },

  // ---- Card Creation ----

  async createCard(books, isDark) {
    const card = document.createElement('div');
    card.className = 'ds-card ds-book-card' + (isDark ? ' ds-dark' : '');

    const sheetsConfig = await SheetsIntegration.getConfig();
    const stats = this.computeStats(books);
    card.innerHTML = this.buildCardHtml(books, stats, sheetsConfig);
    this.wireEvents(card, books, sheetsConfig);

    return card;
  },

  buildCardHtml(books, stats, sheetsConfig) {
    return `
      <div class="ds-card-header">
        <h2 class="ds-card-title">Book Tracker</h2>
        <div class="ds-card-header-actions">
          <button class="ds-book-add-btn" title="Add a book">+ Add Book</button>
          <button class="ds-sheets-settings-btn" title="Google Sheets settings">⚙ Sheets</button>
        </div>
      </div>
      <div class="ds-card-stats">
        <div class="ds-stat">
          <span class="ds-stat-value">${stats.totalBooks}</span>
          <span class="ds-stat-label">Books Read</span>
        </div>
        <div class="ds-stat">
          <span class="ds-stat-value">${this.formatCompact(stats.totalWords)}</span>
          <span class="ds-stat-label">Total Words</span>
        </div>
        <div class="ds-stat">
          <span class="ds-stat-value">${this.formatNumber(stats.totalPages)}</span>
          <span class="ds-stat-label">Total Pages</span>
        </div>
        <div class="ds-stat">
          <span class="ds-stat-value">${this.formatCompact(stats.avgWords)}</span>
          <span class="ds-stat-label">Avg Words</span>
        </div>
      </div>
      <div class="ds-book-form-wrap ds-book-form-hidden">
        ${this.buildAddFormHtml()}
      </div>
      <div class="ds-card-body-inner ds-book-list">
        ${this.buildBookListHtml(books)}
      </div>
      <div class="ds-book-sync-status"></div>
      <div class="ds-sheets-settings-wrap ds-sheets-settings-hidden">
        ${SheetsIntegration.buildSettingsHtml(sheetsConfig)}
      </div>`;
  },

  buildAddFormHtml() {
    return `
      <div class="ds-book-form">
        <div class="ds-book-form-row">
          <div class="ds-book-form-field">
            <label class="ds-book-form-label">Book Search</label>
            <div class="ds-book-isbn-row">
              <input class="ds-book-input ds-book-search-input" type="text" placeholder="Title, author, or ISBN…" />
              <button class="ds-book-lookup-btn">Search</button>
            </div>
          </div>
        </div>
        <div class="ds-book-lookup-status"></div>
        <div class="ds-book-search-results ds-book-search-results-hidden"></div>
        <div class="ds-book-form-row">
          <div class="ds-book-form-field">
            <label class="ds-book-form-label">Title <span class="ds-book-required">*</span></label>
            <input class="ds-book-input ds-book-title-input" type="text" placeholder="Book title" />
          </div>
        </div>
        <div class="ds-book-form-row">
          <div class="ds-book-form-field">
            <label class="ds-book-form-label">Author</label>
            <input class="ds-book-input ds-book-author-input" type="text" placeholder="Author name" />
          </div>
        </div>
        <div class="ds-book-form-row ds-book-form-row-half">
          <div class="ds-book-form-field">
            <label class="ds-book-form-label">Pages</label>
            <input class="ds-book-input ds-book-pages-input" type="number" placeholder="0" min="0" />
          </div>
          <div class="ds-book-form-field">
            <label class="ds-book-form-label">Words / Page</label>
            <input class="ds-book-input ds-book-wpp-input" type="number" value="${this.WORDS_PER_PAGE_DEFAULT}" min="1" />
          </div>
        </div>
        <div class="ds-book-form-row">
          <div class="ds-book-form-field">
            <label class="ds-book-form-label">Word Count</label>
            <input class="ds-book-input ds-book-wordcount-input" type="number" placeholder="Auto-calculated from pages × words/page" min="0" />
          </div>
        </div>
        <div class="ds-book-form-actions">
          <button class="ds-book-submit-btn">Add Book</button>
          <button class="ds-book-cancel-btn">Cancel</button>
        </div>
      </div>`;
  },

  buildBookListHtml(books) {
    if (books.length === 0) {
      return `<p class="ds-empty">No books added yet. Click "+ Add Book" to get started!</p>`;
    }
    return books.map((b, i) => this.buildBookRowHtml(b, i)).join('');
  },

  buildBookRowHtml(book, index) {
    const wordCount = book.wordCount || 0;
    const pages = book.pages || 0;
    return `
      <div class="ds-book-row" data-index="${index}">
        <div class="ds-book-row-info">
          <span class="ds-book-row-title">${this.escapeHtml(book.title || 'Untitled')}</span>
          ${book.author ? `<span class="ds-book-row-author">${this.escapeHtml(book.author)}</span>` : ''}
          ${book.isbn ? `<span class="ds-book-row-isbn">ISBN: ${this.escapeHtml(book.isbn)}</span>` : ''}
        </div>
        <div class="ds-book-row-meta">
          <span class="ds-book-row-words">~${this.formatNumber(wordCount)} words</span>
          <span class="ds-book-row-pages">${this.formatNumber(pages)} pages</span>
          <button class="ds-book-delete-btn" data-index="${index}" title="Remove book">×</button>
        </div>
      </div>`;
  },

  // ---- Event Wiring ----

  wireEvents(card, books, sheetsConfig) {
    // Toggle add form
    card.querySelector('.ds-book-add-btn').addEventListener('click', () => {
      const wrap = card.querySelector('.ds-book-form-wrap');
      wrap.classList.toggle('ds-book-form-hidden');
      if (!wrap.classList.contains('ds-book-form-hidden')) {
        card.querySelector('.ds-book-search-input').focus();
      }
    });

    // Toggle Sheets settings panel
    card.querySelector('.ds-sheets-settings-btn').addEventListener('click', () => {
      card.querySelector('.ds-sheets-settings-wrap').classList.toggle('ds-sheets-settings-hidden');
    });

    // Wire Sheets settings controls
    SheetsIntegration.wireSettingsEvents(card, sheetsConfig);

    // Cancel
    card.querySelector('.ds-book-cancel-btn').addEventListener('click', () => {
      card.querySelector('.ds-book-form-wrap').classList.add('ds-book-form-hidden');
      this.clearForm(card);
    });

    // Book search on button click or Enter key
    card.querySelector('.ds-book-lookup-btn').addEventListener('click', () => {
      this.handleSearch(card);
    });
    card.querySelector('.ds-book-search-input').addEventListener('keydown', e => {
      if (e.key === 'Enter') this.handleSearch(card);
    });

    // Live word count: auto-populate from pages × words/page unless manually set
    const pagesInput = card.querySelector('.ds-book-pages-input');
    const wppInput = card.querySelector('.ds-book-wpp-input');
    const wordCountInput = card.querySelector('.ds-book-wordcount-input');

    wordCountInput.addEventListener('input', () => {
      wordCountInput.dataset.manual = wordCountInput.value !== '' ? 'true' : '';
    });

    const updateEst = () => {
      if (wordCountInput.dataset.manual === 'true') return;
      const pages = parseInt(pagesInput.value) || 0;
      const wpp = parseInt(wppInput.value) || this.WORDS_PER_PAGE_DEFAULT;
      const est = pages * wpp;
      wordCountInput.value = est > 0 ? est : '';
    };
    pagesInput.addEventListener('input', updateEst);
    wppInput.addEventListener('input', updateEst);

    // Submit
    card.querySelector('.ds-book-submit-btn').addEventListener('click', () => {
      this.handleAddBook(card, books);
    });

    // Delete buttons
    this.wireDeleteButtons(card, books);
  },

  wireDeleteButtons(card, books) {
    card.querySelectorAll('.ds-book-delete-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const idx = parseInt(btn.dataset.index, 10);
        books.splice(idx, 1);
        await this.saveBooks(books);
        this.rerenderList(card, books);
      });
    });
  },

  // ---- Handlers ----

  async handleSearch(card) {
    const query = card.querySelector('.ds-book-search-input').value.trim();
    if (!query) return;

    const statusEl = card.querySelector('.ds-book-lookup-status');
    const searchBtn = card.querySelector('.ds-book-lookup-btn');
    const clean = query.replace(/[-\s]/g, '');
    const isIsbn = /^\d{10}$|^\d{13}$/.test(clean);

    statusEl.textContent = 'Searching…';
    statusEl.className = 'ds-book-lookup-status ds-book-lookup-loading';
    searchBtn.disabled = true;

    try {
      if (isIsbn) {
        const data = await this.lookupIsbn(query);
        this.populateForm(card, data);
        this.hideSearchResults(card);
        statusEl.textContent = data.title ? `Found: "${data.title}"` : 'Found! Fill in any missing details.';
        statusEl.className = 'ds-book-lookup-status ds-book-lookup-success';
      } else {
        const results = await this.searchBooks(query);
        if (results.length === 0) {
          this.hideSearchResults(card);
          statusEl.textContent = 'No results found. Enter details manually.';
          statusEl.className = 'ds-book-lookup-status ds-book-lookup-error';
        } else {
          this.showSearchResults(card, results);
          statusEl.textContent = `${results.length} result${results.length > 1 ? 's' : ''} — select one below.`;
          statusEl.className = 'ds-book-lookup-status ds-book-lookup-success';
        }
      }
    } catch (err) {
      this.hideSearchResults(card);
      statusEl.textContent = 'Search failed. Enter details manually.';
      statusEl.className = 'ds-book-lookup-status ds-book-lookup-error';
    } finally {
      searchBtn.disabled = false;
    }
  },

  populateForm(card, data) {
    card.querySelector('.ds-book-title-input').value = data.title || '';
    card.querySelector('.ds-book-author-input').value = data.author || '';
    if (data.pages) {
      const pagesEl = card.querySelector('.ds-book-pages-input');
      pagesEl.value = data.pages;
      pagesEl.dispatchEvent(new Event('input'));
    }
  },

  showSearchResults(card, results) {
    const container = card.querySelector('.ds-book-search-results');
    container.innerHTML = results.map((r, i) => `
      <div class="ds-book-search-result" data-index="${i}">
        <span class="ds-book-result-title">${this.escapeHtml(r.title)}</span>
        <span class="ds-book-result-meta">${this.escapeHtml([r.author, r.year].filter(Boolean).join(' · '))}</span>
      </div>`).join('');
    container.classList.remove('ds-book-search-results-hidden');

    container.querySelectorAll('.ds-book-search-result').forEach((el, i) => {
      el.addEventListener('click', () => {
        this.populateForm(card, results[i]);
        this.hideSearchResults(card);
        const statusEl = card.querySelector('.ds-book-lookup-status');
        statusEl.textContent = `Selected: "${results[i].title}"`;
        statusEl.className = 'ds-book-lookup-status ds-book-lookup-success';
      });
    });
  },

  hideSearchResults(card) {
    const container = card.querySelector('.ds-book-search-results');
    container.innerHTML = '';
    container.classList.add('ds-book-search-results-hidden');
  },

  async handleAddBook(card, books) {
    const titleInput = card.querySelector('.ds-book-title-input');
    const title = titleInput.value.trim();

    if (!title) {
      titleInput.classList.add('ds-book-input-error');
      titleInput.focus();
      setTimeout(() => titleInput.classList.remove('ds-book-input-error'), 2000);
      return;
    }

    const author = card.querySelector('.ds-book-author-input').value.trim();
    const searchQuery = card.querySelector('.ds-book-search-input').value.trim();
    const cleanQuery = searchQuery.replace(/[-\s]/g, '');
    const isbn = /^\d{10}$|^\d{13}$/.test(cleanQuery) ? cleanQuery : '';
    const pages = parseInt(card.querySelector('.ds-book-pages-input').value) || 0;
    const wpp = parseInt(card.querySelector('.ds-book-wpp-input').value) || this.WORDS_PER_PAGE_DEFAULT;
    const manualWordCount = parseInt(card.querySelector('.ds-book-wordcount-input').value) || 0;
    const wordCount = manualWordCount > 0 ? manualWordCount : pages * wpp;

    const newBook = {
      id: Date.now(),
      title,
      author,
      isbn,
      pages,
      wordsPerPage: wpp,
      wordCount,
      addedAt: Date.now(),
    };
    books.push(newBook);

    await this.saveBooks(books);
    card.querySelector('.ds-book-form-wrap').classList.add('ds-book-form-hidden');
    this.clearForm(card);
    this.rerenderList(card, books);
    this.rerenderStats(card, books);

    // Sync to Google Sheets if configured
    this.syncBookToSheets(card, newBook);
  },

  async syncBookToSheets(card, book) {
    const config = await SheetsIntegration.getConfig();
    if (!config.enabled || !config.spreadsheetId) return;

    const statusEl = card.querySelector('.ds-book-sync-status');
    if (statusEl) {
      statusEl.textContent = 'Syncing to Google Sheets…';
      statusEl.className = 'ds-book-sync-status ds-book-sync-loading';
    }

    const result = await SheetsIntegration.appendBook(book);

    if (!statusEl) return;
    if (result?.ok) {
      statusEl.textContent = 'Synced to Google Sheets ✓';
      statusEl.className = 'ds-book-sync-status ds-book-sync-success';
      setTimeout(() => {
        statusEl.textContent = '';
        statusEl.className = 'ds-book-sync-status';
      }, 4000);
    } else if (!result?.skipped) {
      statusEl.textContent = `Sheets sync failed: ${result?.error || 'unknown error'}`;
      statusEl.className = 'ds-book-sync-status ds-book-sync-error';
    }
  },

  // ---- Re-rendering ----

  rerenderList(card, books) {
    const list = card.querySelector('.ds-book-list');
    list.innerHTML = this.buildBookListHtml(books);
    this.wireDeleteButtons(card, books);
    this.rerenderStats(card, books);
  },

  rerenderStats(card, books) {
    const stats = this.computeStats(books);
    const values = card.querySelectorAll('.ds-stat-value');
    values[0].textContent = stats.totalBooks;
    values[1].textContent = this.formatCompact(stats.totalWords);
    values[2].textContent = this.formatNumber(stats.totalPages);
    values[3].textContent = this.formatCompact(stats.avgWords);
  },

  clearForm(card) {
    card.querySelector('.ds-book-search-input').value = '';
    this.hideSearchResults(card);
    card.querySelector('.ds-book-title-input').value = '';
    card.querySelector('.ds-book-author-input').value = '';
    card.querySelector('.ds-book-pages-input').value = '';
    card.querySelector('.ds-book-wpp-input').value = this.WORDS_PER_PAGE_DEFAULT;
    const wcInput = card.querySelector('.ds-book-wordcount-input');
    wcInput.value = '';
    wcInput.dataset.manual = '';
    const statusEl = card.querySelector('.ds-book-lookup-status');
    statusEl.textContent = '';
    statusEl.className = 'ds-book-lookup-status';
  },

  // ---- Formatting ----

  formatCompact(n) {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (n >= 1_000) return Math.round(n / 1_000) + 'k';
    return String(n);
  },

  formatNumber(n) {
    return (n || 0).toLocaleString();
  },

  escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  },
};
