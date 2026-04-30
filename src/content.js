/**
 * Dreaming Spanish Enhancer - Content Script
 * Injects an "Enhanced Statistics" card into the progress page.
 */

(function () {
  'use strict';

  const CARD_ID = 'ds-enhancer-card';
  const BOOK_CARD_ID = 'ds-book-tracker-card';
  const HIDDEN_SECTION_ID = 'ds-hidden-section';
  const HOURS_YEAR_TILE_ID = 'ds-hours-this-year-tile';
  let progressData = null;
  let isLoading = false;
  let lastPath = null;
  let _lastClickedCard = null; // captured on mousedown for portal-menu fallback
  let menuObserver = null;

  // ---- SPA Navigation Detection ----

  function onRouteChange() {
    const path = location.pathname;
    if (path === lastPath) return;
    lastPath = path;

    if (isProgressPage()) {
      // Clear cached progress so we always fetch fresh on navigation
      progressData = null;
      waitForGridAndInject();
      waitForActivityTileAndInject();
    } else {
      removeCard();
      removeHoursThisYearTile();
    }

    if (isLibraryPage()) {
      waitForLibraryAndInject();
    } else {
      const sec = document.getElementById(HIDDEN_SECTION_ID);
      if (sec) sec.remove();
    }

    // Hide any video cards that are in the hidden list
    applyHidingToPage();
    setTimeout(applyHidingToPage, 600);
  }

  function isProgressPage() {
    return /\/progress\/?$/.test(location.pathname);
  }

  function isLibraryPage() {
    return /\/library\/?$/.test(location.pathname);
  }

  // Detect SPA navigation by patching history methods
  function patchHistory() {
    const origPush = history.pushState;
    const origReplace = history.replaceState;

    history.pushState = function () {
      origPush.apply(this, arguments);
      onRouteChange();
    };
    history.replaceState = function () {
      origReplace.apply(this, arguments);
      onRouteChange();
    };
    window.addEventListener('popstate', onRouteChange);
  }

  // ---- Grid Detection & Card Injection ----

  function findGridContainer() {
    // Target the right (second) column — it's wider and has more room
    const columns = document.querySelectorAll('.ds-progress-page__column');
    if (columns.length >= 2) return columns[1];
    if (columns.length === 1) return columns[0];

    // Fallback: look for the masonry container and use the right column
    const masonry = document.querySelector('.ds-progress-page__masonry');
    if (masonry && masonry.children.length >= 2) return masonry.children[1];
    if (masonry && masonry.children.length > 0) return masonry.children[0];

    return null;
  }

  function missingCards() {
    return {
      stats: !document.getElementById(CARD_ID),
      book: !document.getElementById(BOOK_CARD_ID),
    };
  }

  function injectMissingCards(grid, missing) {
    if (missing.stats) injectCard(grid);
    if (missing.book) injectBookCard(grid);
  }

  function waitForGridAndInject() {
    const missing = missingCards();
    if (!missing.stats && !missing.book) return;

    const grid = findGridContainer();
    if (grid) {
      injectMissingCards(grid, missing);
      return;
    }

    const observer = new MutationObserver(() => {
      if (!isProgressPage()) {
        observer.disconnect();
        return;
      }
      const m = missingCards();
      if (!m.stats && !m.book) {
        observer.disconnect();
        return;
      }
      const g = findGridContainer();
      if (g) {
        observer.disconnect();
        injectMissingCards(g, m);
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    // Safety timeout — stop observing after 15s
    setTimeout(() => {
      observer.disconnect();
      const m = missingCards();
      if ((m.stats || m.book) && isProgressPage()) {
        const g = findGridContainer();
        if (g) {
          injectMissingCards(g, m);
        } else {
          console.warn('[DS Enhancer] Grid not found after 15s timeout');
        }
      }
    }, 15000);
  }

  async function injectCard(gridContainer) {
    if (document.getElementById(CARD_ID)) return;

    // Create a placeholder card while loading
    const placeholder = document.createElement('div');
    placeholder.id = CARD_ID;
    placeholder.className = 'ds-card';
    if (isDarkMode()) placeholder.classList.add('ds-dark');
    placeholder.innerHTML = `
      <div class="ds-card-header">
        <h2 class="ds-card-title">Enhanced Statistics</h2>
      </div>
      <div class="ds-card-loading">Loading progress data...</div>
    `;
    gridContainer.appendChild(placeholder);

    await fetchData();

    // Replace placeholder with full card
    const existing = document.getElementById(CARD_ID);
    if (existing) {
      if (!progressData || Object.keys(progressData).filter(k => !k.startsWith('_')).length === 0) {
        existing.innerHTML = `
          <div class="ds-card-header">
            <h2 class="ds-card-title">Enhanced Statistics</h2>
          </div>
          <div class="ds-card-loading">No progress data available. Watch some videos first!</div>
        `;
      } else {
        const card = ProgressUI.createCard(progressData);
        card.id = CARD_ID;
        if (isDarkMode()) card.classList.add('ds-dark');
        existing.replaceWith(card);

        // Wire refresh
        function handleRefresh() {
          (async () => {
            const current = document.getElementById(CARD_ID);
            if (!current) return;
            await sendMessage({ type: 'CLEAR_CACHE' });
            current.querySelector('.ds-card-body-inner').innerHTML =
              '<div class="ds-card-loading">Refreshing...</div>';
            await fetchData();
            const fresh = ProgressUI.createCard(progressData);
            fresh.id = CARD_ID;
            if (isDarkMode()) fresh.classList.add('ds-dark');
            current.replaceWith(fresh);
            fresh.querySelector('.ds-card-refresh')?.addEventListener('click', handleRefresh);
          })();
        }
        card.querySelector('.ds-card-refresh')?.addEventListener('click', handleRefresh);
      }
    }
  }

  async function injectBookCard(gridContainer) {
    if (document.getElementById(BOOK_CARD_ID)) return;

    const liveGrid = findGridContainer() || gridContainer;
    if (!liveGrid || !document.contains(liveGrid)) return;

    try {
      const books = await BookTrackerUI.loadBooks();
      const bookCard = await BookTrackerUI.createCard(books, isDarkMode());
      bookCard.id = BOOK_CARD_ID;
      const currentGrid = findGridContainer() || liveGrid;
      if (!document.contains(currentGrid)) return;
      currentGrid.appendChild(bookCard);
    } catch (err) {
      console.error('[DS Enhancer] injectBookCard — failed to load or render book tracker:', err);
    }
  }

  function removeCard() {
    const card = document.getElementById(CARD_ID);
    if (card) card.remove();
    const bookCard = document.getElementById(BOOK_CARD_ID);
    if (bookCard) bookCard.remove();
  }

  // ---- "Hours this year" tile (clones the native "Hours this month" tile) ----

  function findHoursThisMonthTile() {
    const valueEl = document.querySelector('[data-testid="hours-this-month-value"]');
    return valueEl ? valueEl.closest('.ds-mini-card') : null;
  }

  function removeHoursThisYearTile() {
    const t = document.getElementById(HOURS_YEAR_TILE_ID);
    if (t) t.remove();
  }

  async function injectHoursThisYearTile() {
    if (document.getElementById(HOURS_YEAR_TILE_ID)) return;

    const source = findHoursThisMonthTile();
    if (!source) return;

    const clone = source.cloneNode(true);
    clone.id = HOURS_YEAR_TILE_ID;

    const labelSpan = clone.querySelector('.ds-mini-card__header-title span');
    if (labelSpan) labelSpan.textContent = 'Hours this year';

    const icon = clone.querySelector('.ds-mini-card__header-icon');
    if (icon) icon.alt = 'hours-this-year';

    const valueWrap = clone.querySelector('.ds-mini-card__header-value');
    if (valueWrap) valueWrap.setAttribute('data-testid', 'hours-this-year-value');
    const valueSpan = valueWrap?.querySelector('span');
    if (valueSpan) valueSpan.textContent = '…';

    source.insertAdjacentElement('afterend', clone);
    console.log('[DS Enhancer] Hours-this-year tile injected, computing value...');

    try {
      const hours = await DSApi.computeYearlyHours();
      const live = document.getElementById(HOURS_YEAR_TILE_ID);
      if (!live) return;
      if (hours == null) {
        console.warn('[DS Enhancer] Could not compute yearly hours; removing tile');
        live.remove();
        return;
      }
      const span = live.querySelector('.ds-mini-card__header-value span');
      if (span) span.textContent = hours.toFixed(1);
    } catch (err) {
      console.error('[DS Enhancer] Yearly hours computation failed:', err);
      document.getElementById(HOURS_YEAR_TILE_ID)?.remove();
    }
  }

  function waitForActivityTileAndInject() {
    if (document.getElementById(HOURS_YEAR_TILE_ID)) return;

    if (findHoursThisMonthTile()) {
      injectHoursThisYearTile();
      return;
    }

    const observer = new MutationObserver(() => {
      if (!isProgressPage()) { observer.disconnect(); return; }
      if (document.getElementById(HOURS_YEAR_TILE_ID)) { observer.disconnect(); return; }
      if (findHoursThisMonthTile()) {
        observer.disconnect();
        injectHoursThisYearTile();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    setTimeout(() => {
      observer.disconnect();
      if (document.getElementById(HOURS_YEAR_TILE_ID) || !isProgressPage()) return;
      if (findHoursThisMonthTile()) {
        injectHoursThisYearTile();
      } else {
        console.warn('[DS Enhancer] Hours-this-month tile not found after 15s; skipping yearly tile');
      }
    }, 15000);
  }

  // ---- Library Page: Hidden Videos Section ----

  function findLibraryContainer() {
    // The library page contains .ds-downloads rows — find their common parent
    const firstRow = document.querySelector('.ds-downloads');
    if (firstRow?.parentElement) return firstRow.parentElement;
    return document.querySelector('[class*="library" i]') ||
           document.querySelector('main') ||
           document.querySelector('#__next > div > div');
  }

  function waitForLibraryAndInject() {
    if (document.getElementById(HIDDEN_SECTION_ID)) return;

    const container = findLibraryContainer();
    if (container) {
      injectHiddenSection(container);
      return;
    }

    const obs = new MutationObserver(() => {
      if (!isLibraryPage()) { obs.disconnect(); return; }
      if (document.getElementById(HIDDEN_SECTION_ID)) { obs.disconnect(); return; }
      const c = findLibraryContainer();
      if (c) { obs.disconnect(); injectHiddenSection(c); }
    });
    obs.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => obs.disconnect(), 15000);
  }

  async function injectHiddenSection(container) {
    if (document.getElementById(HIDDEN_SECTION_ID)) return;
    const videos = await HideVideoUI.loadHiddenVideos();
    const section = HideVideoUI.createSection(videos, isDarkMode());
    container.appendChild(section);
  }

  // ---- Apply Hiding to Current Page ----

  async function applyHidingToPage() {
    let resp;
    try {
      resp = await sendMessage({ type: 'GET_HIDDEN_VIDEOS' });
    } catch (e) { return; }

    const hiddenIds = new Set((resp.videos || []).map(v => v.id));
    if (hiddenIds.size === 0) return;

    const cards = document.querySelectorAll('.ds-catalog-video-card');
    cards.forEach(card => {
      // Skip cards inside our own injected section
      if (card.closest('#ds-hidden-section')) return;
      const data = HideVideoUI.extractVideoData(card);
      if (data.id && hiddenIds.has(data.id)) {
        card.style.display = 'none';
      }
    });
  }

  // ---- 3-Dots Menu Detection & Injection ----

  // Known labels that appear in the DS video options dropdown
  const MENU_LABELS = ['Download', 'Share', 'Add to my list', 'Mark as watched'];

  function initMenuObserver() {
    // Track any mousedown inside a video card so we know which card a menu belongs to
    document.addEventListener('mousedown', e => {
      const card = e.target.closest(
        '.ds-catalog-video-card, [class*="catalog-video-card"], [class*="video-card"]'
      );
      if (card && !card.closest('#ds-hidden-section')) _lastClickedCard = card;
    }, true);

    // PRIMARY: After a click on a video card, poll for a visible dropdown menu.
    // This handles menus that are pre-rendered but toggled via CSS (display/visibility/opacity),
    // which a childList MutationObserver would never detect.
    document.addEventListener('click', e => {
      const card = e.target.closest(
        '.ds-catalog-video-card, [class*="catalog-video-card"], [class*="video-card"]'
      );
      if (!card || card.closest('#ds-hidden-section')) return;
      for (const delay of [10, 50, 150, 300, 500]) {
        setTimeout(scanForMenuAndInject, delay);
      }
    }, true);

    // SECONDARY: MutationObserver for menus that are dynamically added to the DOM
    menuObserver = new MutationObserver(() => {
      setTimeout(scanForMenuAndInject, 0);
    });
    menuObserver.observe(document.body, { childList: true, subtree: true });
  }

  function scanForMenuAndInject() {
    if (!_lastClickedCard) return;
    const menu = findVisibleVideoMenu();
    if (!menu || menu.querySelector('.ds-hide-menu-item')) return;

    const videoData = HideVideoUI.extractVideoData(_lastClickedCard);
    if (!videoData.id && !videoData.slug) return;

    const cardRef = _lastClickedCard;
    HideVideoUI.injectMenuOption(menu, videoData, async () => {
      try {
        await sendMessage({ type: 'HIDE_VIDEO', video: videoData });
      } catch (e) { /* best-effort */ }
      const targetCard = cardRef.closest('.ds-carousel__slide') || cardRef;
      targetCard.classList.add('ds-hidden-fade');
      setTimeout(() => {
        targetCard.style.display = 'none';
        targetCard.classList.remove('ds-hidden-fade');
      }, 300);
      const sec = document.getElementById(HIDDEN_SECTION_ID);
      if (sec) {
        const titleEl = sec.querySelector('.ds-hidden-title');
        if (titleEl) {
          const match = titleEl.textContent.match(/\d+/);
          const count = match ? parseInt(match[0], 10) + 1 : 1;
          titleEl.textContent = `Hidden videos (${count})`;
        }
      }
    });
  }

  /** Check if an element's text content contains at least 2 known DS menu labels */
  function hasMenuLabels(el) {
    const text = el.textContent || '';
    let matches = 0;
    for (const label of MENU_LABELS) {
      if (text.includes(label)) matches++;
    }
    return matches >= 2;
  }

  /** Walk down from el to find the deepest visible child that still contains 2+ menu labels */
  function narrowToMenuContainer(el) {
    for (const child of el.children) {
      if (hasMenuLabels(child) && isElVisible(child)) {
        return narrowToMenuContainer(child);
      }
    }
    return el;
  }

  function isElVisible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return false;
    const style = getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && parseFloat(style.opacity) > 0;
  }

  /**
   * Find the currently visible video options dropdown anywhere on the page.
   * Uses multiple strategies: data-testid, class-based selectors, role attributes,
   * and ultimately text-content heuristics to find menus regardless of their markup.
   */
  function findVisibleVideoMenu() {
    // Strategy 1: DS-specific selectors
    for (const selector of [
      '[data-testid="video-options-dropdown"]',
      '[class*="video-options"]',
    ]) {
      for (const el of document.querySelectorAll(selector)) {
        if (isElVisible(el) && hasMenuLabels(el)) return narrowToMenuContainer(el);
      }
    }

    // Strategy 2: ARIA roles and common dropdown/popover patterns
    for (const selector of [
      '[role="menu"]',
      '[role="listbox"]',
      '[class*="dropdown"]',
      '[class*="popover"]',
      '[class*="popup"]',
    ]) {
      for (const el of document.querySelectorAll(selector)) {
        if (isElVisible(el) && hasMenuLabels(el)) return narrowToMenuContainer(el);
      }
    }

    // Strategy 3: Check direct children of body (React portals are typically appended here)
    for (const el of document.body.children) {
      if (el.nodeType !== 1 || el.id === '__next' || el.id === HIDDEN_SECTION_ID) continue;
      if (isElVisible(el) && hasMenuLabels(el)) return narrowToMenuContainer(el);
    }

    return null;
  }

  // ---- Data Fetching ----

  async function fetchData() {
    if (isLoading) return;
    isLoading = true;

    try {
      const token = DSApi.getToken();
      if (!token) return;

      // Check cache first
      try {
        const cached = await sendMessage({ type: 'GET_PROGRESS' });
        if (cached.ok && cached.data &&
            Object.keys(cached.data).filter(k => !k.startsWith('_')).length > 0 &&
            cached.data._almostDone) {
          progressData = cached.data;
          return;
        }
      } catch (e) { /* cache unavailable */ }

      progressData = await DSApi.computeProgress();

      sendMessage({
        type: 'SAVE_PROGRESS',
        data: progressData,
        language: 'es'
      });
    } catch (err) {
      console.error('[DS Enhancer] Failed to load progress:', err);
    } finally {
      isLoading = false;
    }
  }

  // ---- Theme Detection ----

  function isDarkMode() {
    const cs = getComputedStyle(document.documentElement).getPropertyValue('color-scheme').trim();
    if (cs === 'dark') return true;
    if (cs === 'light') return false;
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  // ---- Helpers ----

  function sendMessage(msg) {
    return new Promise((resolve, reject) => {
      if (!chrome.runtime?.sendMessage) {
        reject(new Error('Extension context invalidated'));
        return;
      }
      chrome.runtime.sendMessage(msg, (response) => {
        if (chrome.runtime?.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(response || {});
        }
      });
    });
  }

  // Listen for messages from popup
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'OPEN_PROGRESS') {
      if (!isProgressPage()) {
        // Navigate to progress page — card will auto-inject
        location.href = location.origin + '/' +
          location.pathname.split('/')[1] + '/progress';
      } else {
        const card = document.getElementById(CARD_ID);
        if (card) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      sendResponse({ ok: true });
    }
    if (message.type === 'REFRESH') {
      removeCard();
      if (isProgressPage()) waitForGridAndInject();
      sendResponse({ ok: true });
    }
  });

  // ---- Init ----
  const { version } = chrome.runtime.getManifest();
  console.log(`[DS Enhancer] v${version} loaded`);
  patchHistory();
  onRouteChange();
  initMenuObserver();
  applyHidingToPage();
  setTimeout(applyHidingToPage, 600);
})();
