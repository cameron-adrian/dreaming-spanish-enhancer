/**
 * Dreaming Spanish Enhancer - Popup Script
 * Shows a quick summary in the extension popup.
 */

const CACHE_KEY = 'ds_progress_cache';
const contentEl = document.getElementById('content');

async function init() {
  try {
    const result = await chrome.storage.local.get(CACHE_KEY);
    const cached = result[CACHE_KEY];

    if (!cached || !cached.data || Object.keys(cached.data).length === 0) {
      showNoData();
      return;
    }

    showStats(cached.data, cached.timestamp);
  } catch (err) {
    showError(err.message);
  }
}

function showStats(progressData, timestamp) {
  const userStats = progressData._userStats;
  const levelLabels = progressData.level || {};
  let totalHours = 0, watchedHours = 0;
  for (const stats of Object.values(levelLabels)) {
    totalHours += stats.total;
    watchedHours += stats.watched;
  }

  const totalCount = userStats?.totalVideos || 0;
  const watchedCount = userStats?.watchedVideos || 0;
  const percent = totalHours > 0 ? Math.round((watchedHours / totalHours) * 100) : 0;
  const categories = Object.keys(progressData).filter(k => k !== '_userStats').length;
  const age = timestamp ? timeSince(timestamp) : 'unknown';

  contentEl.innerHTML = `
    <div class="status" style="padding: 12px 16px 8px;">
      <div class="status-text">Last updated ${age} ago</div>
    </div>
    <div class="stats-grid">
      <div class="stat-cell">
        <div class="value">${watchedHours.toFixed(1)}h</div>
        <div class="label">Watched</div>
      </div>
      <div class="stat-cell">
        <div class="value">${totalHours.toFixed(1)}h</div>
        <div class="label">Available</div>
      </div>
      <div class="stat-cell">
        <div class="value">${watchedCount}</div>
        <div class="label">Videos Seen</div>
      </div>
      <div class="stat-cell">
        <div class="value">${categories}</div>
        <div class="label">Categories</div>
      </div>
    </div>
    <div class="progress-bar-wrap">
      <div class="progress-bar-fill" style="width: ${percent}%"></div>
    </div>
    <div class="actions">
      <button class="primary" id="open-panel">View Progress Page</button>
      <button id="refresh">Refresh</button>
    </div>
  `;

  document.getElementById('open-panel').addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.url && tab.url.includes('dreaming')) {
      chrome.tabs.sendMessage(tab.id, { type: 'OPEN_PROGRESS' });
      window.close();
    } else {
      chrome.tabs.create({ url: 'https://app.dreaming.com/spanish/progress' });
    }
  });

  document.getElementById('refresh').addEventListener('click', async () => {
    contentEl.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
    await chrome.runtime.sendMessage({ type: 'CLEAR_CACHE' });
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.url && tab.url.includes('dreaming')) {
      chrome.tabs.sendMessage(tab.id, { type: 'REFRESH' });
    }
    // Wait a bit and re-check
    setTimeout(init, 3000);
  });
}

function showNoData() {
  contentEl.innerHTML = `
    <div class="status">
      <div class="status-icon">&#x1F4CA;</div>
      <div class="status-text">
        No progress data yet.<br>
        Visit <strong>Dreaming Spanish</strong> and click the<br>
        progress button to load your stats.
      </div>
    </div>
    <div class="actions">
      <button class="primary" id="open-ds">Open Dreaming Spanish</button>
    </div>
  `;

  document.getElementById('open-ds').addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://app.dreaming.com/spanish/progress' });
  });
}

function showError(message) {
  contentEl.innerHTML = `
    <div class="error">
      <p>Something went wrong:</p>
      <p>${escapeHtml(message)}</p>
    </div>
  `;
}

function timeSince(ts) {
  const seconds = Math.floor((Date.now() - ts) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

init();
