/**
 * Dreaming Spanish Enhancer - Content Script
 * Injects an "Enhanced Statistics" card into the progress page.
 */

(function () {
  'use strict';

  const CARD_ID = 'ds-enhancer-card';
  let progressData = null;
  let isLoading = false;
  let lastPath = null;

  // ---- SPA Navigation Detection ----

  function onRouteChange() {
    const path = location.pathname;
    if (path === lastPath) return;
    lastPath = path;

    if (isProgressPage()) {
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
    // Look for headings that match known DS progress page sections
    const headings = document.querySelectorAll('h2, h3, [class*="heading"], [class*="title"]');
    for (const h of headings) {
      const text = (h.textContent || '').trim().toLowerCase();
      if (text === 'statistics' || text === 'outside hours' || text === 'levels') {
        // Walk up to find the card, then its parent (the grid)
        let card = h.closest('[class*="card"], [class*="box"], [class*="section"], [class*="container"]');
        if (!card) {
          // Try parent traversal: heading -> card wrapper -> grid
          card = h.parentElement;
          while (card && card !== document.body) {
            const style = getComputedStyle(card);
            if (style.borderRadius && parseFloat(style.borderRadius) >= 8 &&
                style.backgroundColor && style.backgroundColor !== 'rgba(0, 0, 0, 0)') {
              break;
            }
            card = card.parentElement;
          }
        }
        if (card && card.parentElement) {
          const grid = card.parentElement;
          const style = getComputedStyle(grid);
          // Verify it looks like a grid or flex container
          if (style.display === 'grid' || style.display === 'flex' ||
              grid.children.length >= 2) {
            return grid;
          }
        }
      }
    }
    return null;
  }

  function waitForGridAndInject() {
    // Already injected?
    if (document.getElementById(CARD_ID)) return;

    const grid = findGridContainer();
    if (grid) {
      injectCard(grid);
      return;
    }

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
        observer.disconnect();
        injectCard(g);
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    // Safety timeout — stop observing after 15s
    setTimeout(() => observer.disconnect(), 15000);
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

    // Fetch data
    await fetchData();

    // Replace placeholder with full card
    const existing = document.getElementById(CARD_ID);
    if (!existing) return;

    if (!progressData || Object.keys(progressData).filter(k => k !== '_userStats').length === 0) {
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
    card.querySelector('.ds-card-refresh')?.addEventListener('click', async () => {
      await sendMessage({ type: 'CLEAR_CACHE' });
      card.querySelector('.ds-card-body-inner').innerHTML =
        '<div class="ds-card-loading">Refreshing...</div>';
      await fetchData();
      const fresh = ProgressUI.createCard(progressData);
      fresh.id = CARD_ID;
      if (isDarkMode()) fresh.classList.add('ds-dark');
      card.replaceWith(fresh);
      fresh.querySelector('.ds-card-refresh')?.addEventListener('click', arguments.callee);
    });
  }

  function removeCard() {
    const card = document.getElementById(CARD_ID);
    if (card) card.remove();
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
            Object.keys(cached.data).filter(k => k !== '_userStats').length > 0) {
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
      chrome.runtime.sendMessage(msg, (response) => {
        if (chrome.runtime.lastError) {
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
  patchHistory();
  onRouteChange();

  // Also observe for late-loading content (SPA hydration)
  const initObserver = new MutationObserver(() => {
    if (isProgressPage() && !document.getElementById(CARD_ID)) {
      waitForGridAndInject();
    }
  });
  initObserver.observe(document.body, { childList: true, subtree: true });
  // Stop the broad observer after 30s to save resources
  setTimeout(() => initObserver.disconnect(), 30000);
})();
