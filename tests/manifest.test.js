const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { ROOT } = require('./helpers/load-script');

const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const chrome = JSON.parse(read('manifest.json'));
const firefox = JSON.parse(read('manifest.firefox.json'));

test('version is MAJOR.MINOR.PATCH', () => {
  assert.match(chrome.version, /^\d+\.\d+\.\d+$/);
});

test('Chrome and Firefox manifests carry the same version', () => {
  assert.equal(firefox.version, chrome.version);
});

test('Chrome and Firefox load the same content scripts and CSS in the same order', () => {
  assert.deepEqual(firefox.content_scripts, chrome.content_scripts);
});

test('Chrome and Firefox request the same DS host access', () => {
  const dsHosts = m => m.host_permissions.filter(h => h.includes('dreaming')).sort();
  assert.deepEqual(dsHosts(firefox), dsHosts(chrome));
});

test('every file either manifest references exists', () => {
  for (const m of [chrome, firefox]) {
    const files = [
      ...Object.values(m.icons),
      ...Object.values(m.action.default_icon),
      m.action.default_popup,
      ...m.content_scripts.flatMap(cs => [...(cs.js || []), ...(cs.css || [])]),
      ...(m.background.scripts || []),
      ...(m.background.service_worker ? [m.background.service_worker] : []),
    ];
    for (const f of files) {
      assert.ok(fs.existsSync(path.join(ROOT, f)), `${m.name}: missing ${f}`);
    }
  }
});

test('every extension script parses', () => {
  const scripts = fs.readdirSync(path.join(ROOT, 'src')).filter(f => f.endsWith('.js'));
  assert.ok(scripts.length > 0);
  for (const f of scripts) {
    assert.doesNotThrow(() => new vm.Script(read(`src/${f}`), { filename: f }), `src/${f} has a syntax error`);
  }
});

// Content scripts share one global scope, so two files declaring the same
// top-level const/let/class make the later file throw on load and the
// extension silently stops working.
test('content scripts do not redeclare each other\'s top-level names', () => {
  const seen = new Map();
  for (const file of chrome.content_scripts.flatMap(cs => cs.js)) {
    const names = [...read(file).matchAll(/^(?:const|let|class)\s+([A-Za-z_$][\w$]*)/gm)].map(m => m[1]);
    for (const name of names) {
      assert.ok(!seen.has(name), `${name} declared in both ${seen.get(name)} and ${file}`);
      seen.set(name, file);
    }
  }
});

test('the extension logs its manifest version with the [DS Enhancer] prefix', () => {
  const content = read('src/content.js');
  assert.match(content, /chrome\.runtime\.getManifest\(\)/);
  assert.match(content, /console\.log\(`\[DS Enhancer\] v\$\{version\}/);
});
