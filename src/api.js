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

    // Log sample watch record fields for debugging
    if (watchedVideos.length > 0) {
      const sample = watchedVideos[0];
      console.log('[DS Enhancer] Sample watchedVideo fields:', Object.keys(sample));
      console.log('[DS Enhancer] Sample watchedVideo:', JSON.stringify(sample).slice(0, 500));
    }
    if (videos.length > 0) {
      const sample = videos[0];
      console.log('[DS Enhancer] Sample video fields:', Object.keys(sample));
      console.log('[DS Enhancer] Sample video:', JSON.stringify(sample).slice(0, 500));
    }

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
    categories._userStats = {
      totalWatchTimeHours: (user.watchTime || 0) / 3600,
      totalVideos: videos.length,
      watchedVideos: watchedVideos.filter(w => w.watched).length,
    };

    // Attach almost-done data
    categories._almostDone = almostDone;

    const elapsed = Math.round(performance.now() - startTime);
    console.log(`[DS Enhancer] Progress computed in ${elapsed}ms — categories:`,
      Object.keys(categories).filter(k => k !== '_userStats'));

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
    let partialWatchCount = 0; // records with watched=false but exist in watchedMap
    let hasProgressField = false;
    for (const video of videos) {
      const watchInfo = watchedMap.get(video._id);
      if (!watchInfo) continue;
      if (watchInfo.watched === true) continue; // fully watched, skip

      partialWatchCount++;

      // Try to get partial progress from various possible API fields
      let progress = 0;
      if (typeof watchInfo.watchPosition === 'number' && watchInfo.watchPosition > 0 && video.duration > 0) {
        hasProgressField = true;
        progress = watchInfo.watchPosition / video.duration;
      } else if (typeof watchInfo.progress === 'number') {
        hasProgressField = true;
        progress = watchInfo.progress; // 0-1 or 0-100
        if (progress > 1) progress = progress / 100; // normalize to 0-1
      } else if (typeof watchInfo.currentTime === 'number' && video.duration > 0) {
        hasProgressField = true;
        progress = watchInfo.currentTime / video.duration;
      } else if (typeof watchInfo.watchedTime === 'number' && video.duration > 0) {
        hasProgressField = true;
        progress = watchInfo.watchedTime / video.duration;
      } else if (typeof watchInfo.secondsWatched === 'number' && video.duration > 0) {
        hasProgressField = true;
        progress = watchInfo.secondsWatched / video.duration;
      }

      if (progress > 0 && progress < 1) {
        nearlyFinished.push({
          id: video._id,
          slug: video.slug || video.path || video._id || '',
          title: video.title || 'Untitled',
          guide: (video.guides || [])[0] || '',
          level: video.level || '',
          duration: video.duration || 0,
          progress: Math.round(progress * 100),
          remainingSeconds: Math.round((1 - progress) * (video.duration || 0)),
        });
      }
    }
    console.log(`[DS Enhancer] Almost Done — partial watch records: ${partialWatchCount}, has progress field: ${hasProgressField}, nearly finished: ${nearlyFinished.length}`);
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

    console.log(`[DS Enhancer] Almost Done — section completers: ${sectionCompleters.length}`);
    if (sectionCompleters.length > 0) {
      console.log('[DS Enhancer] Top section completer:', sectionCompleters[0].label,
        `(${sectionCompleters[0].category}, ${sectionCompleters[0].remaining} remaining)`);
    }

    return { sectionCompleters, nearlyFinished };
  }
};
