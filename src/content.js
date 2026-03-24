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
    // Wait for the page to settle
    await sleep(1500);

    if (!DSApi.getToken()) {
      console.log('[DS Enhancer] No auth token found — user not logged in.');
      return;
    }

    // Check if we have cached data
    try {
      const cached = await sendMessage({ type: 'GET_PROGRESS' });
      if (cached.ok && cached.data) {
        progressData = cached.data;
        injectToggleButton();
        return;
      }
    } catch (e) {
      // No cache, proceed to fetch
    }

    await fetchAndRender();
  }

  async function fetchAndRender() {
    if (isLoading) return;
    isLoading = true;

    try {
      updateToggleButton('loading');
      progressData = await DSApi.computeProgress();

      // Cache it via background script
      sendMessage({
        type: 'SAVE_PROGRESS',
        data: progressData,
        language: 'es'
      });

      injectToggleButton();
    } catch (err) {
      console.error('[DS Enhancer] Failed to load progress:', err);
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
