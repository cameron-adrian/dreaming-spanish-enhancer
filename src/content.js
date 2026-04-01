/**
 * Dreaming Spanish Enhancer - Content Script
 * Injects an "Enhanced Statistics" card into the progress page.
 */

(function () {
  'use strict';

  const CARD_ID = 'ds-enhancer-card';
  const BOOK_CARD_ID = 'ds-book-tracker-card';
  let progressData = null;
  let isLoading = false;
  let lastPath = null;

  // ---- SPA Navigation Detection ----

  function onRouteChange() {
    const path = location.pathname;
    if (path === lastPath) return;
    lastPath = path;
    console.log('[DS Enhancer] Route changed:', path, 'isProgress:', isProgressPage());

    if (isProgressPage()) {
      // Clear cached progress so we always fetch fresh on navigation
      progressData = null;
      waitForGridAndInject();
    } else {
      removeCard();
    }
  }

  function isProgressPage() {
    return /\/progress\/?$/.test(location.pathname);
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
    if (!missing.stats && !missing.book) {
      console.log('[DS Enhancer] Both cards already exist, skipping inject');
      return;
    }

    const grid = findGridContainer();
    if (grid) {
      console.log('[DS Enhancer] Grid found immediately, injecting');
      injectMissingCards(grid, missing);
      return;
    }

    console.log('[DS Enhancer] Grid not ready, starting MutationObserver');

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
        console.log('[DS Enhancer] Grid appeared, injecting');
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
          console.log('[DS Enhancer] Grid found on timeout retry, injecting');
          injectMissingCards(g, m);
        } else {
          console.warn('[DS Enhancer] Grid not found after 15s timeout');
        }
      }
    }, 15000);
  }

  async function injectCard(gridContainer) {
    if (document.getElementById(CARD_ID)) return;
    console.log('[DS Enhancer] injectCard — creating placeholder');

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

    // Fetch data
    console.log('[DS Enhancer] injectCard — fetching data...');
    await fetchData();
    console.log('[DS Enhancer] injectCard — fetch complete, has data:', !!progressData);

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
    console.log('[DS Enhancer] injectBookCard — creating book tracker card');

    const liveGrid = findGridContainer() || gridContainer;
    if (!liveGrid || !document.contains(liveGrid)) {
      console.warn('[DS Enhancer] injectBookCard — grid container not in document, skipping');
      return;
    }

    try {
      const books = await BookTrackerUI.loadBooks();
      console.log('[DS Enhancer] injectBookCard — books loaded:', books?.length ?? 0);
      const bookCard = await BookTrackerUI.createCard(books, isDarkMode());
      bookCard.id = BOOK_CARD_ID;
      const currentGrid = findGridContainer() || liveGrid;
      if (!document.contains(currentGrid)) {
        console.warn('[DS Enhancer] injectBookCard — grid container detached after async load, skipping');
        return;
      }
      currentGrid.appendChild(bookCard);
      console.log('[DS Enhancer] injectBookCard — book tracker card injected');
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
          console.log('[DS Enhancer] Using cached data');
          return;
        }
        if (cached.ok && cached.data && !cached.data._almostDone) {
          console.log('[DS Enhancer] Cache missing _almostDone, fetching fresh data');
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
  console.log('[DS Enhancer] Init — current path:', location.pathname, 'isProgress:', isProgressPage());
  patchHistory();
  onRouteChange();
})();
