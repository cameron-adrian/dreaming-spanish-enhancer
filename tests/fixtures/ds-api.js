/**
 * Canned DS API responses. Field names and nesting mirror the live
 * app.dreaming.com responses as captured on 2026-09-30 (shape only — the
 * values are made up). If DS changes a shape, update it here first and let
 * the tests show what breaks.
 */

const videos = {
  videos: [
    { _id: 'v1', level: 'beginner', title: 'Uno', duration: 600, guides: ['Pablo'], tags: ['food'], private: false, publishedAt: '2024-01-01T00:00:00.000Z', seriesId: 's1', endCutout: 0, difficultyScore: 10, soundQuality: 'good', language: 'es', hasAccess: true },
    { _id: 'v2', level: 'beginner', title: 'Dos', duration: 1200, guides: ['Pablo', 'Andrea'], tags: ['food', 'day-to-day'], private: false, publishedAt: '2024-01-02T00:00:00.000Z', seriesId: 's1', endCutout: 0, difficultyScore: 12, soundQuality: 'good', language: 'es', hasAccess: true },
    { _id: 'v3', level: 'intermediate', title: 'Tres', duration: 1800, guides: ['Andrea'], tags: ['travel'], private: false, publishedAt: '2024-01-03T00:00:00.000Z', endCutout: 0, difficultyScore: 40, soundQuality: 'good', language: 'es', hasAccess: true },
  ],
  guides: [
    { name: 'Pablo', country: 'Spain', isMainTeacher: true, language: 'es' },
    { name: 'Andrea', country: 'Mexico', isMainTeacher: false, language: 'es' },
  ],
  nextPublicationTime: '2026-10-01T00:00:00.000Z',
};

const watchedVideo = {
  watchedVideos: [
    { videoId: 'v1', lastWatched: '2026-01-01T00:00:00.000Z', watchPosition: 600, watched: true },
    { videoId: 'v3', lastWatched: '2026-01-02T00:00:00.000Z', watchPosition: 1350, watched: false },
  ],
};

const series = {
  series: [
    { _id: 's1', title: 'Cocina', description: '', level: 'beginner', numberOfEpisodes: 2, publishedAt: '2024-01-01T00:00:00.000Z' },
  ],
};

const user = { user: { watchTime: 7200 } };

// dayWatchedTime is a bare array, not wrapped in an object.
const dayWatchedTime = [
  { timeSeconds: 3600, goalReached: true, date: '2025-12-31' },
  { timeSeconds: 1800, goalReached: false, date: '2026-01-01' },
  { timeSeconds: 5400, goalReached: true, date: '2026-06-15' },
  { timeSeconds: 900, goalReached: false, date: '2027-01-01' },
];

// externalTime ("time outside the platform"). GET returns this; POST answers
// with { id } and DELETE with { message: 'Okay.' } (verified live 2026-09-30).
const externalTime = {
  externalTimes: [
    { id: '16940781857590.1461916007706927', timeSeconds: 0, description: 'Input time prior to Dreaming Spanish', type: 'initial', date: '2024-01-22' },
    { id: '17790813753937a1b2c3d4e5', timeSeconds: 1320, description: 'al vuelo:\n\ncrazy nightclub stories', type: 'listening', date: '2026-05-28' },
    { id: '17790813753937f6e5d4c3b2', timeSeconds: 4860, description: 'Every video in this playlist', type: 'watching', date: '2023-09-01', externalVideoUrl: 'https://www.youtube.com/playlist' },
  ],
};

module.exports = { videos, watchedVideo, series, user, dayWatchedTime, externalTime };
