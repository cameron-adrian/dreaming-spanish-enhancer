/**
 * Loads one of the extension's browser scripts (plain globals, no modules)
 * into an isolated vm context with whatever browser stubs a test supplies,
 * and hands back the named top-level globals it defines.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..', '..');

function loadScript(relPath, exportNames, globals = {}) {
  const code = fs.readFileSync(path.join(ROOT, relPath), 'utf8');
  const context = vm.createContext({
    console,
    URL,
    URLSearchParams,
    setTimeout,
    clearTimeout,
    ...globals,
  });
  // Top-level const/let don't become context properties, so read them back
  // out in a second script that shares the same global lexical scope.
  vm.runInContext(code, context, { filename: relPath });
  const exported = vm.runInContext(`({ ${exportNames.join(', ')} })`, context);
  return { ...exported, context };
}

/** Minimal Storage stand-in matching the parts of localStorage DSApi uses. */
function fakeLocalStorage(entries = {}) {
  const map = new Map(Object.entries(entries));
  return {
    getItem: k => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    key: i => [...map.keys()][i] ?? null,
    get length() { return map.size; },
  };
}

/**
 * fetch stub: routes by endpoint name (the last path segment) to a canned
 * JSON body or a status code, and records every call for assertions.
 */
function fakeFetch(routes) {
  const calls = [];
  const fn = async (url, init = {}) => {
    const u = new URL(url);
    const endpoint = u.pathname.split('/').pop();
    calls.push({ url: u, endpoint, init });
    const route = routes[endpoint];
    if (route === undefined) throw new Error(`fakeFetch: no route for ${endpoint}`);
    if (route instanceof Error) throw route;
    const status = typeof route === 'number' ? route : 200;
    const body = typeof route === 'number' ? {} : route;
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? 'OK' : 'ERR',
      json: async () => JSON.parse(JSON.stringify(body)),
    };
  };
  fn.calls = calls;
  return fn;
}

module.exports = { ROOT, loadScript, fakeLocalStorage, fakeFetch };
