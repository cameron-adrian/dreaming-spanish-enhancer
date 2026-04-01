/**
 * Dreaming Spanish Enhancer - Content Script
 * Injects an "Enhanced Statistics" card into the progress page.
 */

(function () {
  'use strict';

  const CARD_ID = 'ds-enhancer-card';
  const BOOK_CARD_ID = 'ds-book-tracker-card';
  const HIDDEN_SECTION_ID = 'ds-hidden-section';
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
    console.log('[DS Enhancer] Route changed:', path, 'isProgress:', isProgressPage());

    if (isProgressPage()) {
      // Clear cached progress so we always fetch fresh on navigation
      progressData = null;
      waitForGridAndInject();
    } else {
      removeCard();
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

  // ---- 3-Dots Menu Observer ----

  function initMenuObserver() {
    // Capture the card that was clicked so portal-rendered menus can be linked back to it
    document.addEventListener('mousedown', e => {
      const btn = e.target.closest(
        '[data-testid="video-options-toggle"], [data-testid="video-options-toggle-mobile"],' +
        '[class*="video-options__toggle"], [class*="video-options-toggle"],' +
        '[aria-label*="options" i], [aria-label*="more" i]'
      );
      if (btn) {
        _lastClickedCard = btn.closest(
          '.ds-catalog-video-card, [class*="catalog-video-card"], [class*="video-card"]'
        );
      }
    });

    menuObserver = new MutationObserver(mutations => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== 1) continue;

          // Strategy 1: node carries data-testid directly
          let menu = null;
          if (node.dataset?.testid === 'video-options-dropdown') {
            menu = node;
          } else if (node.querySelector) {
            // Strategy 2: node wraps the dropdown
            menu = node.querySelector('[data-testid="video-options-dropdown"]');
            if (!menu) {
              // Strategy 3: node contains DS video-option items — use their parent as the menu
              const firstItem = node.querySelector('.ds-video-options__item');
              if (firstItem) {
                menu = firstItem.closest('[role="menu"], [class*="video-options"], [class*="dropdown"]')
                  || firstItem.parentElement;
              }
            }
          }
          // Strategy 4: node itself is a video-option item — parent is the menu
          if (!menu && node.classList?.contains('ds-video-options__item')) {
            menu = node.parentElement;
          }

          if (!menu || menu.querySelector('.ds-hide-menu-item')) continue;

          const card = menu.closest('.ds-catalog-video-card, [class*="catalog-video-card"]')
            || _lastClickedCard;
          if (!card) continue;

          const videoData = HideVideoUI.extractVideoData(card);
          if (!videoData.id && !videoData.slug) continue;

          HideVideoUI.injectMenuOption(menu, videoData, async () => {
            try {
              await sendMessage({ type: 'HIDE_VIDEO', video: videoData });
            } catch (e) { /* best-effort */ }
            // Fade the card out then hide it
            const targetCard = card.closest('.ds-carousel__slide') || card;
            targetCard.classList.add('ds-hidden-fade');
            setTimeout(() => {
              targetCard.style.display = 'none';
              targetCard.classList.remove('ds-hidden-fade');
            }, 300);
            // Update hidden section count if visible
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
      }
    });

    menuObserver.observe(document.body, { childList: true, subtree: true });
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
  const { version } = chrome.runtime.getManifest();
  console.log(`[DS Enhancer] v${version} loaded`);
  console.log('[DS Enhancer] Init — current path:', location.pathname, 'isProgress:', isProgressPage());
  patchHistory();
  onRouteChange();
  initMenuObserver();
  applyHidingToPage();
  setTimeout(applyHidingToPage, 600);
})();
