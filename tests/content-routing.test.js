const test = require('node:test');
const assert = require('node:assert/strict');
const { loadScript } = require('./helpers/load-script');

// content.js runs in Chrome's isolated world: the DS app's own history.pushState
// calls never reach the copy content.js patches. This simulates that — the "app"
// changes location without calling the patched history methods — and checks the
// time-outside card still appears and disappears with in-app navigation.

const HISTORY_SELECTOR = '.ds-time-outside-page > .ds-history-table-card';

function setup({ navigationApi = false } = {}) {
  const intervals = [];
  const navListeners = [];
  const inDom = new Map(); // id → element we injected
  const location = { pathname: '/spanish/', origin: 'https://app.dreaming.com', href: 'https://app.dreaming.com/spanish/' };
  let pageRendered = false; // whether DS has rendered the time-outside page

  const historyCard = {
    parentElement: {
      insertBefore(el) {
        inDom.set(el.id, el);
        el.remove = () => inDom.delete(el.id);
      },
    },
  };
  const document = {
    body: {},
    documentElement: {},
    addEventListener() {},
    querySelector: sel => (sel === HISTORY_SELECTOR && pageRendered ? historyCard : null),
    querySelectorAll: () => [],
    getElementById: id => inDom.get(id) || null,
  };
  const window = { addEventListener() {}, matchMedia: () => ({ matches: false }) };
  if (navigationApi) window.navigation = { addEventListener: (type, fn) => navListeners.push({ type, fn }) };

  loadScript('src/content.js', [], {
    window,
    document,
    location,
    history: { pushState() {}, replaceState() {} },
    getComputedStyle: () => ({ getPropertyValue: () => 'light' }),
    MutationObserver: class { observe() {} disconnect() {} },
    setInterval: fn => intervals.push(fn),
    setTimeout: () => 0,
    chrome: {
      runtime: {
        getManifest: () => ({ version: 'test' }),
        onMessage: { addListener() {} },
        sendMessage: (msg, cb) => cb({}),
      },
    },
    TimeOutsideUI: { createCard: () => ({}) },
    DSApi: {},
    ProgressUI: {},
    BookTrackerUI: {},
    HideVideoUI: {},
    SheetsIntegration: {},
    console: { log() {}, error() {}, warn() {} },
  });

  const go = path => {
    location.pathname = path;
    location.href = location.origin + path;
  };
  return {
    intervals, navListeners, inDom, go,
    renderPage: v => { pageRendered = v; },
    tick: () => intervals.forEach(fn => fn()),
    hasCard: () => inDom.has('ds-time-outside-import-card'),
  };
}

test('the import card appears after in-app navigation to Time outside, and goes on leaving', () => {
  const s = setup();
  assert.ok(s.intervals.length >= 1, 'content.js polls for route changes');
  assert.equal(s.hasCard(), false);

  s.go('/spanish/progress/time-outside');
  s.renderPage(true);
  s.tick();
  assert.equal(s.hasCard(), true);

  s.go('/spanish/library');
  s.renderPage(false);
  s.tick();
  assert.equal(s.hasCard(), false);

  s.go('/spanish/progress/time-outside');
  s.renderPage(true);
  s.tick();
  assert.equal(s.hasCard(), true);
});

test('the Navigation API event also triggers the route check', () => {
  const s = setup({ navigationApi: true });
  const nav = s.navListeners.find(l => l.type === 'navigatesuccess');
  assert.ok(nav, 'listens for navigatesuccess');
  s.go('/spanish/progress/time-outside');
  s.renderPage(true);
  nav.fn();
  assert.equal(s.hasCard(), true);
});
