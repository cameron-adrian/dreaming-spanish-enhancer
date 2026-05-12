/**
 * Dreaming Spanish Enhancer - API Layer
 * Handles authentication and data fetching from the DS API.
 */

const DS_API = (typeof location !== 'undefined' && location.hostname === 'app.dreamingspanish.com')
  ? 'https://app.dreamingspanish.com/.netlify/functions'
  : 'https://app.dreaming.com/.netlify/functions';

// Known DS auth-token storage keys, in priority order. Avoid scanning all of
// localStorage for anything JWT-shaped — that risks forwarding unrelated
// third-party tokens to the DS API.
const DS_TOKEN_KEYS = ['token', 'accessToken', 'auth_token', 'authToken', 'ds_token'];

const DSApi = {
  getToken() {
    for (const key of DS_TOKEN_KEYS) {
      const raw = localStorage.getItem(key);
      if (raw) return raw.replace(/^["']|["']$/g, '');
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
    const [videosResp, watchedResp, userResp, seriesResp] = await Promise.all([
      this.fetch('videos', { language }),
      this.fetch('watchedVideo', { language }),
      this.fetch('user', { timezone: '0' }).catch(e => { console.warn('[DS Enhancer] user fetch failed:', e.message); return null; }),
      this.fetch('series', { language }).catch(e => { console.warn('[DS Enhancer] series fetch failed:', e.message); return null; }),
    ]);

    if (!videosResp || !watchedResp) {
      throw new Error('Failed to fetch video catalog or watch history');
    }

    const videos = videosResp.videos || [];
    const watchedVideos = watchedResp.watchedVideos || [];
    const user = userResp?.user || {};
    const seriesList = seriesResp?.series || [];

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

    // Index: catType -> label -> Video[]. Built in this same pass so
    // computeAlmostDone can look up label members in O(1) instead of
    // rescanning all videos per label.
    const videosByLabel = {
      guide: new Map(),
      level: new Map(),
      topic: new Map(),
      series: new Map(),
    };

    const addToIndex = (catType, label, video) => {
      const bucket = videosByLabel[catType];
      const list = bucket.get(label);
      if (list) list.push(video);
      else bucket.set(label, [video]);
    };

    const bumpStats = (catBucket, label, durationHours, isWatched) => {
      let s = catBucket[label];
      if (!s) {
        s = { total: 0, watched: 0, count: 0, watchedCount: 0 };
        catBucket[label] = s;
      }
      s.total += durationHours;
      s.watched += isWatched ? durationHours : 0;
      s.count += 1;
      if (isWatched) s.watchedCount += 1;
    };

    // Only add series tab if videos actually use series
    let hasAnySeries = false;

    for (const video of videos) {
      const durationHours = (video.duration || 0) / 3600;
      const watchInfo = watchedMap.get(video._id);
      const isWatched = watchInfo?.watched === true;

      // Group by guide(s)
      for (const guide of video.guides || []) {
        bumpStats(categories.guide, guide, durationHours, isWatched);
        addToIndex('guide', guide, video);
      }

      // Group by level
      const level = video.level || 'unknown';
      const levelLabel = level.charAt(0).toUpperCase() + level.slice(1);
      bumpStats(categories.level, levelLabel, durationHours, isWatched);
      addToIndex('level', levelLabel, video);

      // Group by topic/tag
      for (const tag of video.tags || []) {
        const tagLabel = tag.charAt(0).toUpperCase() + tag.slice(1).replace(/-/g, ' ');
        bumpStats(categories.topic, tagLabel, durationHours, isWatched);
        addToIndex('topic', tagLabel, video);
      }

      // Group by series (if applicable)
      if (video.seriesId) {
        hasAnySeries = true;
        const seriesName = seriesMap.get(video.seriesId) || 'Unknown Series';
        if (!categories.series) categories.series = {};
        bumpStats(categories.series, seriesName, durationHours, isWatched);
        addToIndex('series', seriesName, video);
      }
    }

    // Remove empty series category
    if (!hasAnySeries) delete categories.series;

    // Build "Almost Done" data
    const almostDone = this.computeAlmostDone(videos, watchedMap, categories, videosByLabel);

    // Attach user stats for the popup
    const fullyWatched = watchedVideos.filter(w => w.watched).length;
    categories._userStats = {
      totalWatchTimeHours: (user.watchTime || 0) / 3600,
      totalVideos: videos.length,
      watchedVideos: fullyWatched,
    };

    // Attach almost-done data
    categories._almostDone = almostDone;

    return categories;
  },

  /**
   * Compute "Almost Done" data:
   * 1. sectionCompleters: sections with only a few unwatched videos left, plus those videos
   * 2. nearlyFinished: partially-watched videos sorted by in-video progress (closest to 100%)
   */
  computeAlmostDone(videos, watchedMap, categories, videosByLabel) {
    // --- Nearly Finished: videos with partial progress ---
    const nearlyFinished = [];
    for (const video of videos) {
      const watchInfo = watchedMap.get(video._id);
      if (!watchInfo) continue;
      if (watchInfo.watched === true) continue; // fully watched, skip

      const progress = this._extractProgress(watchInfo, video.duration || 0);
      if (progress > 0 && progress < 1) {
        nearlyFinished.push({
          id: video._id,
          slug: video.slug || video.path || video._id || '',
          title: video.title || 'Untitled',
          guide: (video.guides || [])[0] || '',
          level: video.level || '',
          difficultyScore: video.difficultyScore || 0,
          duration: video.duration || 0,
          progress: Math.round(progress * 100),
          remainingSeconds: Math.round((1 - progress) * (video.duration || 0)),
        });
      }
    }
    // Sort by progress descending (closest to 100% first)
    nearlyFinished.sort((a, b) => b.progress - a.progress);

    // --- Section Completers: categories where only 1-3 videos remain ---
    const sectionCompleters = [];
    const MAX_REMAINING = 3; // sections with at most this many unwatched videos

    const catTypes = ['guide', 'level', 'topic'];
    if (categories.series) catTypes.push('series');

    for (const catType of catTypes) {
      const labels = categories[catType];
      if (!labels) continue;
      const labelIndex = videosByLabel[catType];
      if (!labelIndex) continue;

      for (const [label, stats] of Object.entries(labels)) {
        const remaining = stats.count - stats.watchedCount;
        if (remaining < 1 || remaining > MAX_REMAINING) continue;
        if (stats.watched >= stats.total) continue;

        const labelVideos = labelIndex.get(label) || [];
        const unwatchedVideos = [];
        for (const video of labelVideos) {
          if (watchedMap.get(video._id)?.watched === true) continue;
          unwatchedVideos.push({
            id: video._id,
            slug: video.slug || video.path || video._id || '',
            title: video.title || 'Untitled',
            duration: video.duration || 0,
            level: video.level || '',
            difficultyScore: video.difficultyScore || 0,
          });
        }

        if (unwatchedVideos.length > 0 && unwatchedVideos.length <= MAX_REMAINING) {
          const pct = stats.total > 0 ? Math.round((stats.watched / stats.total) * 100) : 0;
          sectionCompleters.push({
            category: catType,
            label,
            totalVideos: stats.count,
            watchedVideos: stats.watchedCount,
            remaining: unwatchedVideos.length,
            percent: pct,
            videos: unwatchedVideos,
          });
        }
      }
    }

    // Sort section completers: fewest remaining first, then highest % first
    sectionCompleters.sort((a, b) => a.remaining - b.remaining || b.percent - a.percent);

    return { sectionCompleters, nearlyFinished };
  },

  /** The DS API has used several field names for in-video progress; pick whichever is present. */
  _extractProgress(watchInfo, duration) {
    if (typeof watchInfo.watchPosition === 'number' && watchInfo.watchPosition > 0 && duration > 0) {
      return watchInfo.watchPosition / duration;
    }
    if (typeof watchInfo.progress === 'number') {
      const p = watchInfo.progress;
      return p > 1 ? p / 100 : p; // normalize 0-100 to 0-1
    }
    if (duration > 0) {
      for (const k of ['currentTime', 'watchedTime', 'secondsWatched']) {
        if (typeof watchInfo[k] === 'number') return watchInfo[k] / duration;
      }
    }
    return 0;
  },

  /**
   * Fetch the full daily watch-time history from DS.
   * Endpoint: GET /dayWatchedTime?language=<lang>
   * Returns the raw records array, or null on failure.
   */
  async fetchDailyActivity(language = 'es') {
    let resp;
    try {
      resp = await this.fetch('dayWatchedTime', { language });
    } catch (e) {
      console.warn('[DS Enhancer] dayWatchedTime fetch failed:', e.message);
      return null;
    }
    const arr = Array.isArray(resp) ? resp
      : resp?.dayWatchedTime || resp?.days || resp?.data || null;
    if (!Array.isArray(arr)) {
      console.warn('[DS Enhancer] dayWatchedTime: unexpected response shape', resp);
      return null;
    }
    return arr;
  },

  /**
   * Sum watch seconds for the given calendar year (Jan 1 → today inclusive)
   * and return hours rounded to one decimal. Returns null if no data source.
   */
  async computeYearlyHours(year = new Date().getFullYear(), language = 'es') {
    const records = await this.fetchDailyActivity(language);
    if (!records) return null;

    const yearStart = new Date(year, 0, 1);
    const yearEnd = new Date(year + 1, 0, 1);
    let totalSeconds = 0;

    for (const r of records) {
      const dateStr = r.date || r.day || r.d || r.timestamp;
      if (!dateStr) continue;
      const date = new Date(dateStr);
      if (isNaN(date.getTime())) continue;
      if (date < yearStart || date >= yearEnd) continue;

      let seconds = 0;
      if (typeof r.timeSeconds === 'number') seconds = r.timeSeconds;
      else if (typeof r.seconds === 'number') seconds = r.seconds;
      else if (typeof r.time === 'number') seconds = r.time;
      else if (typeof r.watchTime === 'number') seconds = r.watchTime;
      else if (typeof r.minutes === 'number') seconds = r.minutes * 60;
      else if (typeof r.value === 'number') seconds = r.value;
      totalSeconds += seconds;
    }

    return Math.round((totalSeconds / 3600) * 10) / 10;
  }
};
