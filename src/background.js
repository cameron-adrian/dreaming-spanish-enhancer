/**
 * Dreaming Spanish Enhancer - Background Service Worker
 * Handles message passing between popup and content scripts,
 * and manages cached progress data in chrome.storage.
 */

const CACHE_KEY = 'ds_progress_cache';
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_PROGRESS') {
    handleGetProgress(message.language || 'es', sendResponse);
    return true; // keep channel open for async response
  }

  if (message.type === 'CLEAR_CACHE') {
    chrome.storage.local.remove(CACHE_KEY, () => sendResponse({ ok: true }));
    return true;
  }

  if (message.type === 'SAVE_PROGRESS') {
    const cacheEntry = {
      data: message.data,
      timestamp: Date.now(),
      language: message.language || 'es'
    };
    chrome.storage.local.set({ [CACHE_KEY]: cacheEntry }, () => {
      sendResponse({ ok: true });
    });
    return true;
  }
});

async function handleGetProgress(language, sendResponse) {
  try {
    const result = await chrome.storage.local.get(CACHE_KEY);
    const cached = result[CACHE_KEY];

    if (cached && cached.language === language && (Date.now() - cached.timestamp) < CACHE_TTL_MS) {
      sendResponse({ ok: true, data: cached.data, fromCache: true });
      return;
    }

    // No valid cache — the content script needs to fetch fresh data
    sendResponse({ ok: false, reason: 'stale' });
  } catch (err) {
    sendResponse({ ok: false, reason: err.message });
  }
}

// Set badge to indicate extension is active on DS pages
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (tab.url && tab.url.includes('dreaming')) {
    chrome.action.setBadgeBackgroundColor({ color: '#4CAF50', tabId });
    chrome.action.setBadgeText({ text: 'DS', tabId });
  }
});
