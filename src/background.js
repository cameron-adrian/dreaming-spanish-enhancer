/**
 * Dreaming Spanish Enhancer - Background Service Worker
 * Handles message passing between popup and content scripts,
 * and manages cached progress data in chrome.storage.
 */

const CACHE_KEY = 'ds_progress_cache';
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const HIDDEN_VIDEOS_KEY = 'ds_hidden_videos';
const FIREFOX_OAUTH_TOKEN_KEY = 'ds_firefox_oauth_token';

// Firefox cannot use the manifest `oauth2` block or chrome.identity.getAuthToken.
// Paste the OAuth 2.0 Web Application client ID here for Firefox builds.
// (Chrome ignores this and uses the `oauth2.client_id` from manifest.json.)
const FIREFOX_OAUTH_CLIENT_ID = 'YOUR_FIREFOX_CLIENT_ID.apps.googleusercontent.com';
const OAUTH_SCOPES = 'https://www.googleapis.com/auth/spreadsheets';

const isFirefox = typeof browser !== 'undefined'
  && browser.identity
  && typeof browser.identity.launchWebAuthFlow === 'function'
  && typeof chrome.identity.getAuthToken !== 'function';

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_HIDDEN_VIDEOS') {
    chrome.storage.local.get([HIDDEN_VIDEOS_KEY], result => {
      sendResponse({ ok: true, videos: result[HIDDEN_VIDEOS_KEY]?.videos || [] });
    });
    return true;
  }

  if (message.type === 'HIDE_VIDEO') {
    chrome.storage.local.get([HIDDEN_VIDEOS_KEY], result => {
      const existing = result[HIDDEN_VIDEOS_KEY]?.videos || [];
      if (!existing.find(v => v.id === message.video.id)) {
        existing.push({ ...message.video, hiddenAt: Date.now() });
      }
      chrome.storage.local.set({ [HIDDEN_VIDEOS_KEY]: { videos: existing } }, () => {
        sendResponse({ ok: true });
      });
    });
    return true;
  }

  if (message.type === 'UNHIDE_VIDEO') {
    chrome.storage.local.get([HIDDEN_VIDEOS_KEY], result => {
      const existing = result[HIDDEN_VIDEOS_KEY]?.videos || [];
      const filtered = existing.filter(v => v.id !== message.videoId);
      chrome.storage.local.set({ [HIDDEN_VIDEOS_KEY]: { videos: filtered } }, () => {
        sendResponse({ ok: true });
      });
    });
    return true;
  }

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

  if (message.type === 'SHEETS_APPEND_BOOK') {
    handleSheetsAppend(message.book, message.spreadsheetId, sendResponse);
    return true; // keep channel open for async response
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

// ---- Google Sheets Integration ----

async function handleSheetsAppend(book, spreadsheetId, sendResponse) {
  try {
    const token = await getAuthToken();
    const baseUrl = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}`;
    const authHeader = { 'Authorization': `Bearer ${token}` };

    // Check whether the sheet already has data in A1 to decide if headers are needed
    const checkResp = await fetch(`${baseUrl}/values/A1`, { headers: authHeader });
    if (!checkResp.ok) {
      // Firefox cached token may be revoked server-side; drop it so the next call re-prompts.
      if (checkResp.status === 401 && isFirefox) {
        await chrome.storage.local.remove(FIREFOX_OAUTH_TOKEN_KEY);
      }
      const err = await checkResp.json().catch(() => ({}));
      sendResponse({ ok: false, error: err.error?.message || `HTTP ${checkResp.status}` });
      return;
    }
    const checkData = await checkResp.json();
    const needsHeaders = !checkData.values || checkData.values.length === 0;

    const appendUrl = `${baseUrl}/values/A:G:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
    const rows = [];

    if (needsHeaders) {
      rows.push(['Date Added', 'Title', 'Author', 'ISBN', 'Pages', 'Words / Page', 'Word Count']);
    }

    rows.push([
      new Date(book.addedAt).toLocaleDateString(),
      book.title || '',
      book.author || '',
      book.isbn || '',
      book.pages || 0,
      book.wordsPerPage || 250,
      book.wordCount || 0,
    ]);

    const appendResp = await fetch(appendUrl, {
      method: 'POST',
      headers: { ...authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: rows }),
    });

    if (!appendResp.ok) {
      const err = await appendResp.json().catch(() => ({}));
      sendResponse({ ok: false, error: err.error?.message || `HTTP ${appendResp.status}` });
      return;
    }

    sendResponse({ ok: true });
  } catch (err) {
    sendResponse({ ok: false, error: err.message });
  }
}

function getAuthToken() {
  return isFirefox ? getAuthTokenFirefox() : getAuthTokenChrome();
}

function getAuthTokenChrome() {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive: true }, token => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(token);
      }
    });
  });
}

async function getAuthTokenFirefox() {
  const cached = await getCachedFirefoxToken();
  if (cached) return cached;

  const redirectUri = browser.identity.getRedirectURL();
  const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth'
    + `?client_id=${encodeURIComponent(FIREFOX_OAUTH_CLIENT_ID)}`
    + `&response_type=token`
    + `&redirect_uri=${encodeURIComponent(redirectUri)}`
    + `&scope=${encodeURIComponent(OAUTH_SCOPES)}`
    + `&prompt=consent`;

  const responseUrl = await browser.identity.launchWebAuthFlow({ url: authUrl, interactive: true });
  const fragment = (responseUrl.split('#')[1] || '');
  const params = new URLSearchParams(fragment);
  const token = params.get('access_token');
  const expiresIn = parseInt(params.get('expires_in') || '0', 10);
  if (!token) throw new Error('OAuth flow did not return an access token');

  // Refresh 60s before expiry to avoid using an about-to-expire token.
  const expiresAt = Date.now() + Math.max(0, (expiresIn - 60)) * 1000;
  await chrome.storage.local.set({ [FIREFOX_OAUTH_TOKEN_KEY]: { token, expiresAt } });
  return token;
}

async function getCachedFirefoxToken() {
  const result = await chrome.storage.local.get(FIREFOX_OAUTH_TOKEN_KEY);
  const entry = result[FIREFOX_OAUTH_TOKEN_KEY];
  if (entry && entry.token && entry.expiresAt > Date.now()) return entry.token;
  return null;
}

// Set badge to indicate extension is active on DS pages
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (tab.url && tab.url.includes('dreaming')) {
    chrome.action.setBadgeBackgroundColor({ color: '#4CAF50', tabId });
    chrome.action.setBadgeText({ text: 'DS', tabId });
  }
});
