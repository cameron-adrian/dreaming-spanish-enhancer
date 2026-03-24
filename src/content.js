/**
 * Dreaming Spanish Enhancer - Content Script
 * Runs on app.dreaming.com pages. Fetches progress data and
 * injects the progress panel into the page.
 */

(function () {
  'use strict';

  const PANEL_ID = 'ds-enhancer-panel';
  let progressData = null;
  let isLoading = false;

  async function init() {
    console.log('[DS Enhancer] Content script initializing...');
    console.log('[DS Enhancer] Page URL:', location.href);

    // Wait for the page to settle
    await sleep(1500);

    const token = DSApi.getToken();
    if (!token) {
      console.warn('[DS Enhancer] No auth token found — user not logged in.');
      console.warn('[DS Enhancer] The extension will activate once you log in to Dreaming Spanish.');
      return;
    }
    console.log('[DS Enhancer] Auth token found. Checking cache...');

    // Check if we have cached data
    try {
      const cached = await sendMessage({ type: 'GET_PROGRESS' });
      console.log('[DS Enhancer] Cache check result:', cached);
      if (cached.ok && cached.data) {
        console.log('[DS Enhancer] Using cached data. Categories:', Object.keys(cached.data));
        progressData = cached.data;
        injectToggleButton();
        return;
      }
      console.log('[DS Enhancer] Cache miss or stale, fetching fresh data...');
    } catch (e) {
      console.log('[DS Enhancer] Cache check failed:', e.message, '— fetching fresh data...');
    }

    await fetchAndRender();
  }

  async function fetchAndRender() {
    if (isLoading) {
      console.log('[DS Enhancer] Already loading, skipping duplicate fetch.');
      return;
    }
    isLoading = true;

    try {
      updateToggleButton('loading');
      console.log('[DS Enhancer] Fetching progress data from API...');
      const startTime = performance.now();
      progressData = await DSApi.computeProgress();
      const elapsed = Math.round(performance.now() - startTime);

      console.log(`[DS Enhancer] Progress data loaded in ${elapsed}ms`);
      console.log('[DS Enhancer] Categories found:', Object.keys(progressData));
      for (const [cat, labels] of Object.entries(progressData)) {
        console.log(`[DS Enhancer]   ${cat}: ${Object.keys(labels).length} labels`);
      }

      if (Object.keys(progressData).length === 0) {
        console.warn('[DS Enhancer] WARNING: Progress data is empty! The API responded but no categories were extracted.');
        console.warn('[DS Enhancer] Check the "SAMPLE VIDEO OBJECTS" logs above to debug field mapping.');
      }

      // Cache it via background script
      sendMessage({
        type: 'SAVE_PROGRESS',
        data: progressData,
        language: 'es'
      });

      injectToggleButton();
    } catch (err) {
      console.error('[DS Enhancer] Failed to load progress:', err);

      if (err.message.includes('NOT_AUTHENTICATED')) {
        console.error('[DS Enhancer] → You need to log in to Dreaming Spanish first.');
      } else if (err.message.includes('AUTH_EXPIRED')) {
        console.error('[DS Enhancer] → Your session has expired. Please log in again.');
      } else if (err.message.includes('NETWORK_ERROR')) {
        console.error('[DS Enhancer] → Network error. Check your connection and try refreshing.');
      } else if (err.message.includes('API_ERROR')) {
        console.error('[DS Enhancer] → The Dreaming Spanish API returned an error. It may be temporarily unavailable.');
      }

      updateToggleButton('error');
    } finally {
      isLoading = false;
    }
  }

  function injectToggleButton() {
    if (document.getElementById('ds-enhancer-toggle')) {
      updateToggleButton('ready');
      return;
    }

    const btn = document.createElement('button');
    btn.id = 'ds-enhancer-toggle';
    btn.title = 'Dreaming Spanish Enhancer — Click to toggle progress panel';
    btn.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <rect x="2" y="12" width="4" height="6" rx="1" fill="currentColor" opacity="0.5"/>
        <rect x="8" y="8" width="4" height="10" rx="1" fill="currentColor" opacity="0.7"/>
        <rect x="14" y="3" width="4" height="15" rx="1" fill="currentColor"/>
      </svg>
    `;
    btn.addEventListener('click', togglePanel);
    document.body.appendChild(btn);
    updateToggleButton('ready');
  }

  function updateToggleButton(state) {
    const btn = document.getElementById('ds-enhancer-toggle');
    if (!btn) return;
    btn.classList.remove('ds-loading', 'ds-error', 'ds-ready');
    btn.classList.add(`ds-${state}`);
  }

  function togglePanel() {
    const existing = document.getElementById(PANEL_ID);
    if (existing) {
      existing.classList.toggle('ds-panel-hidden');
      return;
    }

    if (!progressData || Object.keys(progressData).length === 0) {
      fetchAndRender();
      return;
    }

    const panel = ProgressUI.createPanel(progressData);
    panel.id = PANEL_ID;
    document.body.appendChild(panel);

    // Close button
    panel.querySelector('.ds-panel-close').addEventListener('click', () => {
      panel.classList.add('ds-panel-hidden');
    });

    // Refresh button
    panel.querySelector('.ds-panel-refresh').addEventListener('click', async () => {
      await sendMessage({ type: 'CLEAR_CACHE' });
      panel.remove();
      await fetchAndRender();
      // Re-open panel after refresh
      const newPanel = ProgressUI.createPanel(progressData);
      newPanel.id = PANEL_ID;
      document.body.appendChild(newPanel);
      newPanel.querySelector('.ds-panel-close').addEventListener('click', () => {
        newPanel.classList.add('ds-panel-hidden');
      });
    });
  }

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

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Listen for messages from popup
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'TOGGLE_PANEL') {
      togglePanel();
      sendResponse({ ok: true });
    }
    if (message.type === 'REFRESH') {
      const existing = document.getElementById(PANEL_ID);
      if (existing) existing.remove();
      fetchAndRender();
      sendResponse({ ok: true });
    }
  });

  init();
})();
