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

  function waitForGridAndInject() {
    // Already injected?
    if (document.getElementById(CARD_ID)) {
      console.log('[DS Enhancer] Card already exists, skipping inject');
      return;
    }

    const grid = findGridContainer();
    if (grid) {
      console.log('[DS Enhancer] Grid found immediately, injecting');
      injectCard(grid);
      return;
    }

    console.log('[DS Enhancer] Grid not ready, starting MutationObserver');

    // Grid not ready yet — observe DOM changes
    const observer = new MutationObserver(() => {
      if (!isProgressPage()) {
        observer.disconnect();
        return;
      }
      if (document.getElementById(CARD_ID)) {
        observer.disconnect();
        return;
      }
      const g = findGridContainer();
      if (g) {
        console.log('[DS Enhancer] Grid appeared, injecting');
        observer.disconnect();
        injectCard(g);
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    // Safety timeout — stop observing after 15s
    setTimeout(() => {
      observer.disconnect();
      // One final attempt after timeout in case we missed it
      if (!document.getElementById(CARD_ID) && isProgressPage()) {
        const g = findGridContainer();
        if (g) {
          console.log('[DS Enhancer] Grid found on timeout retry, injecting');
          injectCard(g);
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
    if (!existing) return;

    if (!progressData || Object.keys(progressData).filter(k => !k.startsWith('_')).length === 0) {
      existing.innerHTML = `
        <div class="ds-card-header">
          <h2 class="ds-card-title">Enhanced Statistics</h2>
        </div>
        <div class="ds-card-loading">No progress data available. Watch some videos first!</div>
      `;
      return;
    }

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

    // Inject Book Tracker card below Enhanced Statistics
    injectBookCard(gridContainer);
  }

  async function injectBookCard(gridContainer) {
    if (document.getElementById(BOOK_CARD_ID)) return;
    console.log('[DS Enhancer] injectBookCard — creating book tracker card');

    const books = await BookTrackerUI.loadBooks();
    const bookCard = BookTrackerUI.createCard(books, isDarkMode());
    bookCard.id = BOOK_CARD_ID;
    gridContainer.appendChild(bookCard);
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
