/**
 * Dreaming Spanish Enhancer - API Layer
 * Handles authentication and data fetching from the DS API.
 */

// Auto-detect the correct domain based on where we're running
const DS_API = (typeof location !== 'undefined' && location.hostname === 'app.dreamingspanish.com')
  ? 'https://app.dreamingspanish.com/.netlify/functions'
  : 'https://app.dreaming.com/.netlify/functions';

console.log('[DS Enhancer] API base URL:', DS_API);
console.log('[DS Enhancer] Current hostname:', typeof location !== 'undefined' ? location.hostname : 'N/A');

const DSApi = {
  /**
   * Get the bearer token from localStorage.
   */
  getToken() {
    // DS stores the JWT in localStorage under the key "token"
    const token = localStorage.getItem('token');
    if (token) {
      const cleaned = token.replace(/^["']|["']$/g, '');
      console.log('[DS Enhancer] Found token under "token" key, length:', cleaned.length,
        'preview:', cleaned.substring(0, 20) + '...');
      return cleaned;
    }

    // Fallback: search for any JWT-looking value
    console.log('[DS Enhancer] No "token" key found, scanning localStorage...');
    console.log('[DS Enhancer] localStorage keys:', Array.from({ length: localStorage.length },
      (_, i) => localStorage.key(i)));

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      const val = localStorage.getItem(key);
      if (val && val.startsWith('eyJ') && val.includes('.')) {
        console.log('[DS Enhancer] Found JWT-like value under key:', key, 'length:', val.length);
        return val.replace(/^["']|["']$/g, '');
      }
    }

    console.warn('[DS Enhancer] No auth token found in localStorage.');
    return null;
  },

  /**
   * Make an authenticated GET request to the DS API.
   */
  async fetch(endpoint, params = {}) {
    const token = this.getToken();
    if (!token) {
      throw new Error('NOT_AUTHENTICATED');
    }

    const url = new URL(`${DS_API}/${endpoint}`);
    for (const [key, val] of Object.entries(params)) {
      url.searchParams.set(key, val);
    }

    console.log(`[DS Enhancer] Fetching: ${endpoint}`, url.toString());
    const startTime = performance.now();

    let resp;
    try {
      resp = await fetch(url.toString(), {
        headers: { 'Authorization': `Bearer ${token}` }
      });
    } catch (networkErr) {
      console.error(`[DS Enhancer] Network error fetching ${endpoint}:`, networkErr);
      throw new Error(`NETWORK_ERROR: ${networkErr.message}`);
    }

    const elapsed = Math.round(performance.now() - startTime);
    console.log(`[DS Enhancer] ${endpoint} responded: ${resp.status} ${resp.statusText} (${elapsed}ms)`);

    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      console.error(`[DS Enhancer] API error response body:`, body.substring(0, 500));

      if (resp.status === 401 || resp.status === 403) {
        throw new Error(`AUTH_EXPIRED: ${resp.status} — Your session may have expired. Try logging in again.`);
      }
      throw new Error(`API_ERROR: ${resp.status} ${resp.statusText}`);
    }

    const data = await resp.json();
    console.log(`[DS Enhancer] ${endpoint} response type:`, typeof data,
      Array.isArray(data) ? `(array of ${data.length})` : `(keys: ${Object.keys(data || {}).join(', ')})`);

    return data;
  },

  /**
   * Try fetching an endpoint, returning null on error instead of throwing.
   */
  async tryFetch(endpoint, params = {}) {
    try {
      return await this.fetch(endpoint, params);
    } catch (e) {
      console.log(`[DS Enhancer] Probe ${endpoint}: ${e.message}`);
      return null;
    }
  },

  /**
   * Discover the correct API endpoints by probing common names.
   * Logs all results so we can figure out the real data structure.
   */
  async discoverEndpoints(language = 'es') {
    console.log('[DS Enhancer] ========== ENDPOINT DISCOVERY ==========');

    // Endpoints to try for video catalog
    const catalogEndpoints = [
      ['videos', { language }],
      ['video', { language }],
      ['content', { language }],
      ['contents', { language }],
      ['series', { language }],
      ['catalog', { language }],
      ['browse', { language }],
      ['search', { language }],
      ['feed', { language }],
      ['lessons', { language }],
      ['library', { language }],
      ['allVideos', { language }],
      ['getAllVideos', { language }],
      ['getVideos', { language }],
      ['videoList', { language }],
    ];

    // Endpoints to try for watch history
    const historyEndpoints = [
      ['watchedVideo', { language }],
      ['watched', { language }],
      ['history', { language }],
      ['watchHistory', { language }],
      ['progress', { language }],
      ['userProgress', { language }],
      ['stats', { language }],
      ['user', { timezone: '0' }],
    ];

    // Also try playlist with no params
    const playlistNoParams = await this.tryFetch('playlist');
    console.log('[DS Enhancer] playlist (no params):', playlistNoParams ?
      (Array.isArray(playlistNoParams) ? `array[${playlistNoParams.length}]` : `object{${Object.keys(playlistNoParams).join(', ')}}`) : 'FAILED');

    // Probe catalog endpoints in parallel
    console.log('[DS Enhancer] ---- Probing catalog endpoints ----');
    const catalogResults = await Promise.all(
      catalogEndpoints.map(async ([name, params]) => {
        const data = await this.tryFetch(name, params);
        return [name, data];
      })
    );

    for (const [name, data] of catalogResults) {
      if (!data) continue;
      const shape = Array.isArray(data) ? `array[${data.length}]` : `object{${Object.keys(data).join(', ')}}`;
      console.log(`[DS Enhancer] ✓ ${name}: ${shape}`);

      // If it's an array with objects that have video-like fields, log a sample
      const items = Array.isArray(data) ? data : (data.videos || data.items || data.results || data.content || []);
      if (items.length > 0) {
        console.log(`[DS Enhancer]   Sample from ${name}:`, JSON.stringify(items[0], null, 2).substring(0, 1500));
        console.log(`[DS Enhancer]   Fields:`, Object.keys(items[0]));
      }
    }

    // Probe history endpoints in parallel
    console.log('[DS Enhancer] ---- Probing history/progress endpoints ----');
    const historyResults = await Promise.all(
      historyEndpoints.map(async ([name, params]) => {
        const data = await this.tryFetch(name, params);
        return [name, data];
      })
    );

    for (const [name, data] of historyResults) {
      if (!data) continue;
      const shape = Array.isArray(data) ? `array[${data.length}]` : `object{${Object.keys(data).join(', ')}}`;
      console.log(`[DS Enhancer] ✓ ${name}: ${shape}`);

      const items = Array.isArray(data) ? data : [];
      if (items.length > 0) {
        console.log(`[DS Enhancer]   Sample from ${name}:`, JSON.stringify(items[0], null, 2).substring(0, 1500));
        console.log(`[DS Enhancer]   Fields:`, Object.keys(items[0]));
      } else if (!Array.isArray(data)) {
        // It's an object — log it directly (user profile, etc.)
        console.log(`[DS Enhancer]   ${name} data:`, JSON.stringify(data, null, 2).substring(0, 2000));
      }
    }

    console.log('[DS Enhancer] ========== DISCOVERY COMPLETE ==========');
    return { catalogResults, historyResults };
  },

  async computeProgress(language = 'es') {
    // Run endpoint discovery to find the right data
    await this.discoverEndpoints(language);

    // For now, return empty — once we know the right endpoints, we'll build the real logic
    console.log('[DS Enhancer] computeProgress: returning empty pending endpoint discovery results.');
    return {};
  }
};
