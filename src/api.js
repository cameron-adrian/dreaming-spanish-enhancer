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
   * Fetch the full video catalog for a language.
   * Returns an array of video objects with labels, duration, etc.
   */
  async getPlaylist(language = 'es') {
    return this.fetch('playlist', { language });
  },

  /**
   * Fetch the user's watched video history.
   * Returns an array of watched video records.
   */
  async getWatchedVideos(language = 'es') {
    return this.fetch('watchedVideo', { language });
  },

  /**
   * Fetch user profile info.
   */
  async getUser() {
    return this.fetch('user', { timezone: '0' });
  },

  /**
   * Compute progress data: for each label category, calculate total hours
   * and watched hours per label value.
   *
   * Returns: {
   *   "Country": {
   *     "Argentina": { total: 300, watched: 150, count: 500, watchedCount: 250 },
   *     "Mexico": { ... },
   *     ...
   *   },
   *   "Guide": { ... },
   *   ...
   * }
   */
  async computeProgress(language = 'es') {
    console.log('[DS Enhancer] Computing progress for language:', language);

    const [playlist, watchedVideos] = await Promise.all([
      this.getPlaylist(language),
      this.getWatchedVideos(language)
    ]);

    // Log raw response shapes for debugging
    console.log('[DS Enhancer] ---- RAW PLAYLIST RESPONSE ----');
    console.log('[DS Enhancer] playlist type:', typeof playlist, Array.isArray(playlist) ? `array[${playlist.length}]` : '');
    if (!Array.isArray(playlist) && playlist) {
      console.log('[DS Enhancer] playlist top-level keys:', Object.keys(playlist));
      // Log nested arrays to find the video list
      for (const [k, v] of Object.entries(playlist)) {
        if (Array.isArray(v)) console.log(`[DS Enhancer]   playlist.${k}: array[${v.length}]`);
        else console.log(`[DS Enhancer]   playlist.${k}:`, typeof v, typeof v === 'string' ? v.substring(0, 80) : '');
      }
    }

    console.log('[DS Enhancer] ---- RAW WATCHED RESPONSE ----');
    console.log('[DS Enhancer] watchedVideos type:', typeof watchedVideos, Array.isArray(watchedVideos) ? `array[${watchedVideos.length}]` : '');
    if (!Array.isArray(watchedVideos) && watchedVideos) {
      console.log('[DS Enhancer] watchedVideos top-level keys:', Object.keys(watchedVideos));
    }

    // Build a set of watched video IDs for quick lookup
    const watchedSet = new Set();
    if (Array.isArray(watchedVideos)) {
      watchedVideos.forEach(v => {
        if (v.watched !== false) {
          watchedSet.add(v.videoId || v._id || v.id);
        }
      });
    }
    console.log('[DS Enhancer] Watched video IDs count:', watchedSet.size);
    if (watchedSet.size > 0) {
      const sample = [...watchedSet].slice(0, 3);
      console.log('[DS Enhancer] Sample watched IDs:', sample);
    }
    if (Array.isArray(watchedVideos) && watchedVideos.length > 0) {
      console.log('[DS Enhancer] ---- SAMPLE WATCHED VIDEO OBJECT ----');
      console.log('[DS Enhancer]', JSON.stringify(watchedVideos[0], null, 2).substring(0, 1000));
    }

    // Known label category fields on DS video objects
    const LABEL_FIELDS = [
      'country', 'countries',
      'guide', 'guides',
      'topic', 'topics',
      'dialect', 'dialects',
      'difficulty', 'level',
      'type', 'videoType',
      'tags', 'labels',
      'playlist', 'playlists',
      'category', 'categories'
    ];

    const progress = {};
    const videos = Array.isArray(playlist) ? playlist : (playlist?.videos || playlist?.playlist || []);

    if (videos.length === 0) {
      console.warn('[DS Enhancer] No videos found in playlist response.');
      console.warn('[DS Enhancer] Tried: Array.isArray(playlist), playlist.videos, playlist.playlist');
      console.warn('[DS Enhancer] Available keys:', Object.keys(playlist || {}));
      return progress;
    }

    console.log('[DS Enhancer] Total videos to process:', videos.length);

    // Log first 3 full video objects for schema inspection
    const sampleVideo = videos[0];
    console.log('[DS Enhancer] ---- SAMPLE VIDEO OBJECTS (first 3) ----');
    videos.slice(0, 3).forEach((v, i) => {
      console.log(`[DS Enhancer] Video ${i}:`, JSON.stringify(v, null, 2).substring(0, 1500));
    });
    console.log('[DS Enhancer] Sample video fields:', Object.keys(sampleVideo));

    // Log which label fields actually exist on the data
    const foundFields = LABEL_FIELDS.filter(f => sampleVideo[f] !== undefined);
    const missingFields = LABEL_FIELDS.filter(f => sampleVideo[f] === undefined);
    console.log('[DS Enhancer] Label fields FOUND on videos:', foundFields);
    console.log('[DS Enhancer] Label fields MISSING on videos:', missingFields);

    // Log duration field detection
    console.log('[DS Enhancer] Duration field check:', {
      timeSeconds: sampleVideo.timeSeconds,
      duration: sampleVideo.duration,
      durationSeconds: sampleVideo.durationSeconds,
    });

    // Process each video
    videos.forEach(video => {
      const videoId = video._id || video.id || video.videoId;
      const durationSec = video.timeSeconds || video.duration || video.durationSeconds || 0;
      const durationHrs = durationSec / 3600;
      const isWatched = watchedSet.has(videoId) || video.watched === true;

      // Check all possible label fields
      const processLabel = (categoryName, value) => {
        if (!value) return;
        const values = Array.isArray(value) ? value : [value];
        values.forEach(v => {
          const label = typeof v === 'object' ? (v.name || v.title || v.label || JSON.stringify(v)) : String(v);
          if (!label || label === 'undefined' || label === 'null') return;

          if (!progress[categoryName]) progress[categoryName] = {};
          if (!progress[categoryName][label]) {
            progress[categoryName][label] = { total: 0, watched: 0, count: 0, watchedCount: 0 };
          }
          progress[categoryName][label].total += durationHrs;
          progress[categoryName][label].count += 1;
          if (isWatched) {
            progress[categoryName][label].watched += durationHrs;
            progress[categoryName][label].watchedCount += 1;
          }
        });
      };

      // Process known fields
      for (const field of LABEL_FIELDS) {
        if (video[field] !== undefined && video[field] !== null) {
          const categoryName = field.charAt(0).toUpperCase() + field.slice(1).replace(/s$/, '');
          processLabel(categoryName, video[field]);
        }
      }

      // Also process any array/string fields we haven't covered
      for (const [key, val] of Object.entries(video)) {
        if (LABEL_FIELDS.includes(key)) continue;
        if (key.startsWith('_') || ['id', 'videoId', 'title', 'name', 'description',
          'url', 'thumbnail', 'thumbnailUrl', 'image', 'slug',
          'timeSeconds', 'duration', 'durationSeconds',
          'createdAt', 'updatedAt', 'publishedAt', 'date',
          'watched', 'lastWatched', 'views', 'likes',
          'language', 'premium'].includes(key)) continue;

        if (Array.isArray(val) && val.length > 0 && val.length < 50) {
          const categoryName = key.charAt(0).toUpperCase() + key.slice(1).replace(/s$/, '');
          processLabel(categoryName, val);
        } else if (typeof val === 'string' && val.length < 100 && val.length > 0) {
          // Could be a label - only include if it looks categorical (not a long description)
          const categoryName = key.charAt(0).toUpperCase() + key.slice(1);
          processLabel(categoryName, val);
        }
      }
    });

    // Round all numbers
    for (const cat of Object.values(progress)) {
      for (const label of Object.values(cat)) {
        label.total = Math.round(label.total * 100) / 100;
        label.watched = Math.round(label.watched * 100) / 100;
      }
    }

    console.log('[DS Enhancer] Progress computed:', Object.keys(progress));
    return progress;
  }
};
