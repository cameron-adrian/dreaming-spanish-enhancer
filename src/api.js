/**
 * Dreaming Spanish Enhancer - API Layer
 * Handles authentication and data fetching from the DS API.
 */

// Auto-detect the correct domain based on where we're running
const DS_API = (typeof location !== 'undefined' && location.hostname === 'app.dreamingspanish.com')
  ? 'https://app.dreamingspanish.com/.netlify/functions'
  : 'https://app.dreaming.com/.netlify/functions';

const DSApi = {
  /**
   * Get the bearer token from localStorage.
   */
  getToken() {
    // DS stores the JWT in localStorage under the key "token"
    const token = localStorage.getItem('token');
    if (token) {
      // Strip quotes if present
      return token.replace(/^["']|["']$/g, '');
    }
    // Fallback: search for any JWT-looking value
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      const val = localStorage.getItem(key);
      if (val && val.startsWith('eyJ') && val.includes('.')) {
        return val.replace(/^["']|["']$/g, '');
      }
    }
    return null;
  },

  /**
   * Make an authenticated GET request to the DS API.
   */
  async fetch(endpoint, params = {}) {
    const token = this.getToken();
    if (!token) {
      throw new Error('Not authenticated. Please log in to Dreaming Spanish.');
    }

    const url = new URL(`${DS_API}/${endpoint}`);
    for (const [key, val] of Object.entries(params)) {
      url.searchParams.set(key, val);
    }

    const resp = await fetch(url.toString(), {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (!resp.ok) {
      throw new Error(`DS API error: ${resp.status} ${resp.statusText}`);
    }

    return resp.json();
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
    const [playlist, watchedVideos] = await Promise.all([
      this.getPlaylist(language),
      this.getWatchedVideos(language)
    ]);

    // Build a set of watched video IDs for quick lookup
    const watchedSet = new Set();
    if (Array.isArray(watchedVideos)) {
      watchedVideos.forEach(v => {
        if (v.watched !== false) {
          watchedSet.add(v.videoId || v._id || v.id);
        }
      });
    }

    // Known label category fields on DS video objects
    // We'll dynamically discover them from the data, but these are expected:
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
      console.warn('[DS Enhancer] No videos found in playlist response. Response shape:', Object.keys(playlist || {}));
      return progress;
    }

    // Discover label fields from the first video
    const sampleVideo = videos[0];
    console.log('[DS Enhancer] Sample video fields:', Object.keys(sampleVideo));

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
