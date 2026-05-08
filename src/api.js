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
    const [videosResp, watchedResp, userResp, seriesResp] = await Promise.all([
      this.fetch('videos', { language }),
      this.fetch('watchedVideo', { language }),
      this.fetch('user', { timezone: '0' }).catch(() => null),
      this.fetch('series', { language }).catch(() => null),
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

    // Build "Almost Done" data
    const almostDone = this.computeAlmostDone(videos, watchedMap, categories, seriesMap);

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
  computeAlmostDone(videos, watchedMap, categories, seriesMap) {
    // --- Nearly Finished: videos with partial progress ---
    const nearlyFinished = [];
    for (const video of videos) {
      const watchInfo = watchedMap.get(video._id);
      if (!watchInfo) continue;
      if (watchInfo.watched === true) continue; // fully watched, skip

      // Try to get partial progress from various possible API fields
      let progress = 0;
      if (typeof watchInfo.watchPosition === 'number' && watchInfo.watchPosition > 0 && video.duration > 0) {
        progress = watchInfo.watchPosition / video.duration;
      } else if (typeof watchInfo.progress === 'number') {
        progress = watchInfo.progress; // 0-1 or 0-100
        if (progress > 1) progress = progress / 100; // normalize to 0-1
      } else if (typeof watchInfo.currentTime === 'number' && video.duration > 0) {
        progress = watchInfo.currentTime / video.duration;
      } else if (typeof watchInfo.watchedTime === 'number' && video.duration > 0) {
        progress = watchInfo.watchedTime / video.duration;
      } else if (typeof watchInfo.secondsWatched === 'number' && video.duration > 0) {
        progress = watchInfo.secondsWatched / video.duration;
      }

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

    // Build a map of videos per category label for lookups
    const catTypes = ['guide', 'level', 'topic'];
    if (categories.series) catTypes.push('series');

    for (const catType of catTypes) {
      const labels = categories[catType];
      if (!labels) continue;

      for (const [label, stats] of Object.entries(labels)) {
        const remaining = stats.count - stats.watchedCount;
        if (remaining < 1 || remaining > MAX_REMAINING) continue;
        // Already complete
        if (stats.watched >= stats.total) continue;

        // Find the actual unwatched videos for this label
        const unwatchedVideos = [];
        for (const video of videos) {
          // Check if video belongs to this category label
          let belongs = false;
          if (catType === 'guide') {
            belongs = (video.guides || []).includes(label);
          } else if (catType === 'level') {
            const lvl = (video.level || '').charAt(0).toUpperCase() + (video.level || '').slice(1);
            belongs = lvl === label;
          } else if (catType === 'topic') {
            belongs = (video.tags || []).some(t => {
              const tagLabel = t.charAt(0).toUpperCase() + t.slice(1).replace(/-/g, ' ');
              return tagLabel === label;
            });
          } else if (catType === 'series') {
            belongs = seriesMap.get(video.seriesId) === label;
          }

          if (!belongs) continue;

          const watchInfo = watchedMap.get(video._id);
          const isWatched = watchInfo?.watched === true;
          if (!isWatched) {
            unwatchedVideos.push({
              id: video._id,
              slug: video.slug || video.path || video._id || '',
              title: video.title || 'Untitled',
              duration: video.duration || 0,
              level: video.level || '',
              difficultyScore: video.difficultyScore || 0,
            });
          }
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
  },

  /**
   * Compute the average watch seconds per weekday across all returned days.
   * Returns a length-7 array indexed by Date.getDay() (0=Sun..6=Sat),
   * or null if no data source.
   */
  async computeWeekdayAverages(language = 'es') {
    const records = await this.fetchDailyActivity(language);
    if (!records) return null;

    const totals = [0, 0, 0, 0, 0, 0, 0];
    const counts = [0, 0, 0, 0, 0, 0, 0];

    for (const r of records) {
      const dateStr = r.date || r.day || r.d || r.timestamp;
      if (!dateStr) continue;
      const date = new Date(dateStr);
      if (isNaN(date.getTime())) continue;

      let seconds = 0;
      if (typeof r.timeSeconds === 'number') seconds = r.timeSeconds;
      else if (typeof r.seconds === 'number') seconds = r.seconds;
      else if (typeof r.time === 'number') seconds = r.time;
      else if (typeof r.watchTime === 'number') seconds = r.watchTime;
      else if (typeof r.minutes === 'number') seconds = r.minutes * 60;
      else if (typeof r.value === 'number') seconds = r.value;

      const dow = date.getDay();
      totals[dow] += seconds;
      counts[dow] += 1;
    }

    return totals.map((t, i) => counts[i] > 0 ? t / counts[i] : 0);
  }
};
