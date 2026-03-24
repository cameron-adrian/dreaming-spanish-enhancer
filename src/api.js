/**
 * Dreaming Spanish Enhancer - API Layer
 * Handles authentication and data fetching from the DS API.
 */

const DS_API = (typeof location !== 'undefined' && location.hostname === 'app.dreamingspanish.com')
  ? 'https://app.dreamingspanish.com/.netlify/functions'
  : 'https://app.dreaming.com/.netlify/functions';

const DSApi = {
  getToken() {
    const token = localStorage.getItem('token');
    if (token) return token.replace(/^["']|["']$/g, '');

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      const val = localStorage.getItem(key);
      if (val && val.startsWith('eyJ') && val.includes('.')) {
        return val.replace(/^["']|["']$/g, '');
      }
    }
    return null;
  },

  async fetch(endpoint, params = {}) {
    const token = this.getToken();
    if (!token) throw new Error('NOT_AUTHENTICATED');

    const url = new URL(`${DS_API}/${endpoint}`);
    for (const [key, val] of Object.entries(params)) {
      url.searchParams.set(key, val);
    }

    let resp;
    try {
      resp = await fetch(url.toString(), {
        headers: { 'Authorization': `Bearer ${token}` }
      });
    } catch (networkErr) {
      throw new Error(`NETWORK_ERROR: ${networkErr.message}`);
    }

    if (!resp.ok) {
      if (resp.status === 401 || resp.status === 403) {
        throw new Error(`AUTH_EXPIRED: ${resp.status}`);
      }
      throw new Error(`API_ERROR: ${resp.status} ${resp.statusText}`);
    }

    return resp.json();
  },

  /**
   * Fetch the full video catalog and watch history, then compute progress
   * grouped by guide, level, topic, and series.
   */
  async computeProgress(language = 'es') {
    console.log('[DS Enhancer] Fetching catalog and watch history...');
    const startTime = performance.now();

    const [videosResp, watchedResp, userResp, seriesResp] = await Promise.all([
      this.fetch('videos', { language }),
      this.fetch('watchedVideo', { language }),
      this.fetch('user', { timezone: '0' }),
      this.fetch('series', { language }).catch(() => null),
    ]);

    const videos = videosResp.videos || [];
    const watchedVideos = watchedResp.watchedVideos || [];
    const user = userResp.user || {};
    const seriesList = seriesResp?.series || [];

    console.log(`[DS Enhancer] Catalog: ${videos.length} videos, ${watchedVideos.length} watch records`);

    // Build lookup: videoId → watched info
    const watchedMap = new Map();
    for (const w of watchedVideos) {
      watchedMap.set(w.videoId, w);
    }

    // Build series name lookup
    const seriesMap = new Map();
    for (const s of seriesList) {
      seriesMap.set(s._id || s.id, s.title || s.name || 'Unknown Series');
    }

    // Categories to group by
    const categories = {
      guide: {},
      level: {},
      topic: {},
    };

    // Only add series tab if videos actually use series
    let hasAnySeries = false;

    for (const video of videos) {
      const durationHours = (video.duration || 0) / 3600;
      const watchInfo = watchedMap.get(video._id);
      const isWatched = watchInfo?.watched === true;
      const watchedHours = isWatched ? durationHours : 0;

      // Group by guide(s)
      const guides = video.guides || [];
      for (const guide of guides) {
        if (!categories.guide[guide]) {
          categories.guide[guide] = { total: 0, watched: 0, count: 0, watchedCount: 0 };
        }
        categories.guide[guide].total += durationHours;
        categories.guide[guide].watched += watchedHours;
        categories.guide[guide].count += 1;
        categories.guide[guide].watchedCount += isWatched ? 1 : 0;
      }

      // Group by level
      const level = video.level || 'unknown';
      const levelLabel = level.charAt(0).toUpperCase() + level.slice(1);
      if (!categories.level[levelLabel]) {
        categories.level[levelLabel] = { total: 0, watched: 0, count: 0, watchedCount: 0 };
      }
      categories.level[levelLabel].total += durationHours;
      categories.level[levelLabel].watched += watchedHours;
      categories.level[levelLabel].count += 1;
      categories.level[levelLabel].watchedCount += isWatched ? 1 : 0;

      // Group by topic/tag
      const tags = video.tags || [];
      for (const tag of tags) {
        const tagLabel = tag.charAt(0).toUpperCase() + tag.slice(1).replace(/-/g, ' ');
        if (!categories.topic[tagLabel]) {
          categories.topic[tagLabel] = { total: 0, watched: 0, count: 0, watchedCount: 0 };
        }
        categories.topic[tagLabel].total += durationHours;
        categories.topic[tagLabel].watched += watchedHours;
        categories.topic[tagLabel].count += 1;
        categories.topic[tagLabel].watchedCount += isWatched ? 1 : 0;
      }

      // Group by series (if applicable)
      if (video.seriesId) {
        hasAnySeries = true;
        const seriesName = seriesMap.get(video.seriesId) || 'Unknown Series';
        if (!categories.series) categories.series = {};
        if (!categories.series[seriesName]) {
          categories.series[seriesName] = { total: 0, watched: 0, count: 0, watchedCount: 0 };
        }
        categories.series[seriesName].total += durationHours;
        categories.series[seriesName].watched += watchedHours;
        categories.series[seriesName].count += 1;
        categories.series[seriesName].watchedCount += isWatched ? 1 : 0;
      }
    }

    // Remove empty series category
    if (!hasAnySeries) delete categories.series;

    // Attach user stats for the popup
    categories._userStats = {
      totalWatchTimeHours: (user.watchTime || 0) / 3600,
      totalVideos: videos.length,
      watchedVideos: watchedVideos.filter(w => w.watched).length,
    };

    const elapsed = Math.round(performance.now() - startTime);
    console.log(`[DS Enhancer] Progress computed in ${elapsed}ms — categories:`,
      Object.keys(categories).filter(k => k !== '_userStats'));

    return categories;
  }
};
