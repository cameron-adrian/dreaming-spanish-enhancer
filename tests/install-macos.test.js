// Tests for scripts/install-macos.sh and scripts/chrome.js (ported from
// zendesk-enhancer).
//
// These run everywhere, including Linux CI: the installer's macOS gate is
// overridable with DSE_OS, DSE_SKIP_CHROME=1 stops it touching a browser, and
// CHROME_ROOT always points at a throwaway fake profile — never the real one.
// So the file-moving half (the half that can silently install nothing, install
// the wrong version, pick the wrong folder, or leave deleted files behind) is
// exercised for real against real zips. The AppleScript half (opening
// chrome://extensions) needs a Mac with Chrome running.
//
// Requires `zip`, `unzip` and `rsync`. A missing one fails loudly rather than
// skipping: a green run that quietly tested nothing is worse than a red one.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO = path.join(__dirname, '..');
const INSTALLER = path.join(REPO, 'scripts', 'install-macos.sh');
const CHROME_JS = path.join(REPO, 'scripts', 'chrome.js');
const NAME = 'Dreaming Spanish Enhancer';

for (const tool of ['zip', 'unzip', 'rsync']) {
  try {
    execFileSync('sh', ['-c', `command -v ${tool}`], { stdio: 'pipe' });
  } catch (_) {
    throw new Error(`${tool} is required to run these tests and was not found on PATH`);
  }
}

let tmpCount = 0;
const tmpdir = label => fs.mkdtempSync(path.join(os.tmpdir(), `dse-${label}-${tmpCount++}-`));

// A minimal but realistic tree: the shipped files the installer must copy,
// plus the repo furniture it must leave behind.
function writeSource(dir, { version = '9.9.9', name = NAME, extraShipped = [] } = {}) {
  for (const d of ['images', 'src', 'tests', 'scripts', '.github/workflows']) {
    fs.mkdirSync(path.join(dir, d), { recursive: true });
  }
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ name, version }, null, 2));
  fs.writeFileSync(path.join(dir, 'manifest.firefox.json'), JSON.stringify({ name, version }, null, 2));
  fs.writeFileSync(path.join(dir, 'src', 'content.js'), '// content\n');
  fs.writeFileSync(path.join(dir, 'images', 'icon-48.png'), 'png');
  fs.writeFileSync(path.join(dir, 'tests', 'a.test.js'), '// test\n');
  fs.writeFileSync(path.join(dir, 'scripts', 'install-macos.sh'), '#!/bin/sh\n');
  fs.writeFileSync(path.join(dir, '.github', 'workflows', 'test.yml'), 'name: test\n');
  for (const f of ['CLAUDE.md', 'README.md', 'ROADMAP.md', 'package.json', 'mockup.html', 'generate_mockup.py']) {
    fs.writeFileSync(path.join(dir, f), 'x\n');
  }
  for (const f of extraShipped) fs.writeFileSync(path.join(dir, f), '// extra\n');
  return dir;
}

// GitHub's zipball wraps the tree in a commit-named folder; `wrap: false`
// covers a hand-rolled zip with the manifest at the top.
function makeZip(zipPath, opts = {}) {
  const { wrap = true, ...sourceOpts } = opts;
  const staging = tmpdir('stage');
  const inner = wrap ? path.join(staging, 'cameron-adrian-dreaming-spanish-enhancer-abc123') : staging;
  writeSource(inner, sourceOpts);
  execFileSync('zip', ['-qr', zipPath, '.'], { cwd: staging });
  return zipPath;
}

function writeChromeProfile(root, profile, extensions = {}) {
  const dir = path.join(root, profile);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'Secure Preferences'), JSON.stringify({ extensions: { settings: extensions } }));
  fs.writeFileSync(path.join(dir, 'Preferences'), '{}');
}

function run(args, env = {}) {
  return execFileSync(INSTALLER, args, {
    encoding: 'utf8',
    stdio: 'pipe',
    env: { ...process.env, DSE_OS: 'Darwin', DSE_SKIP_CHROME: '1', CHROME_ROOT: tmpdir('chrome-empty'), ...env },
  });
}

function runFails(args, env = {}) {
  try {
    run(args, env);
  } catch (e) {
    return { status: e.status, stderr: String(e.stderr || ''), stdout: String(e.stdout || '') };
  }
  throw new Error('expected the installer to fail, but it succeeded');
}

const installedVersion = dir => JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')).version;

describe('install-macos.sh: the OS gate', () => {
  test('does nothing at all on a non-Mac', () => {
    const home = tmpdir('home');
    const dest = path.join(home, 'ext');
    const out = run(['--zip', makeZip(path.join(home, 'dse.zip')), '--dir', dest], { DSE_OS: 'Linux' });
    assert.match(out, /Not macOS \(Linux\)/);
    assert.equal(fs.existsSync(dest), false, 'must not install anything off-Mac');
  });
});

describe('install-macos.sh: choosing the folder', () => {
  test('defaults to the folder Chrome already loads, so the extension id and its data survive', () => {
    const home = tmpdir('home');
    const loaded = path.join(home, 'Downloads', 'dreaming-spanish-enhancer-main');
    writeSource(loaded, { version: '0.1.7' });
    const chromeRoot = tmpdir('chrome');
    writeChromeProfile(chromeRoot, 'Profile 1', { abcd: { location: 4, path: loaded } });

    const out = run(['--zip', makeZip(path.join(home, 'new.zip'), { version: '0.2.5' })],
      { HOME: home, CHROME_ROOT: chromeRoot });
    assert.match(out, /Installed: 0\.1\.7 -> 0\.2\.5/);
    assert.equal(installedVersion(loaded), '0.2.5');
    assert.equal(fs.existsSync(path.join(home, 'Extensions')), false, 'must not create a second folder');
  });

  test('uses ~/Extensions only when Chrome is not loading it from anywhere', () => {
    const home = tmpdir('home');
    run(['--zip', makeZip(path.join(home, 'new.zip'), { version: '0.2.5' })], { HOME: home });
    assert.equal(installedVersion(path.join(home, 'Extensions', 'dreaming-spanish-enhancer')), '0.2.5');
  });

  test('refuses to guess when Chrome loads it from two folders', () => {
    const home = tmpdir('home');
    const a = writeSource(path.join(home, 'a'), { version: '0.1.0' });
    const b = writeSource(path.join(home, 'b'), { version: '0.1.1' });
    const chromeRoot = tmpdir('chrome');
    writeChromeProfile(chromeRoot, 'Profile 1', { aaaa: { location: 4, path: a }, bbbb: { location: 4, path: b } });

    const r = runFails(['--zip', makeZip(path.join(home, 'new.zip'), { version: '0.2.5' })],
      { HOME: home, CHROME_ROOT: chromeRoot });
    assert.match(r.stderr, /more than one folder/);
    assert.match(r.stderr, /--dir/);
    assert.equal(installedVersion(a), '0.1.0');
    assert.equal(installedVersion(b), '0.1.1');
  });

  test('an explicit --dir wins over detection', () => {
    const home = tmpdir('home');
    const loaded = writeSource(path.join(home, 'loaded'), { version: '0.1.7' });
    const chromeRoot = tmpdir('chrome');
    writeChromeProfile(chromeRoot, 'Profile 1', { abcd: { location: 4, path: loaded } });
    const dest = path.join(home, 'elsewhere');
    run(['--zip', makeZip(path.join(home, 'new.zip'), { version: '0.2.5' }), '--dir', dest],
      { HOME: home, CHROME_ROOT: chromeRoot });
    assert.equal(installedVersion(dest), '0.2.5');
    assert.equal(installedVersion(loaded), '0.1.7');
  });
});

describe('install-macos.sh: installing', () => {
  test('copies the shipped files and nothing else', () => {
    const home = tmpdir('home');
    const dest = path.join(home, 'ext');
    run(['--zip', makeZip(path.join(home, 'dse.zip'), { version: '0.3.0' }), '--dir', dest]);

    for (const f of ['manifest.json', 'manifest.firefox.json', 'src/content.js', 'images/icon-48.png']) {
      assert.ok(fs.existsSync(path.join(dest, f)), `${f} should have been installed`);
    }
    for (const f of ['tests', 'scripts', '.github', 'CLAUDE.md', 'README.md', 'ROADMAP.md', 'package.json', 'mockup.html', 'generate_mockup.py']) {
      assert.equal(fs.existsSync(path.join(dest, f)), false, `${f} should not be installed`);
    }
    assert.equal(installedVersion(dest), '0.3.0');
  });

  test('handles a zip with no wrapper folder', () => {
    const home = tmpdir('home');
    const dest = path.join(home, 'ext');
    run(['--zip', makeZip(path.join(home, 'flat.zip'), { wrap: false, version: '0.3.0' }), '--dir', dest]);
    assert.equal(installedVersion(dest), '0.3.0');
  });

  test('removes shipped files the new version dropped, but leaves unshipped extras alone', () => {
    const home = tmpdir('home');
    const dest = path.join(home, 'ext');
    run(['--zip', makeZip(path.join(home, 'old.zip'), { version: '0.2.0', extraShipped: ['legacy.js'] }), '--dir', dest]);
    // An old hand-unzipped folder still holding repo furniture (the real one does).
    fs.writeFileSync(path.join(dest, 'CLAUDE.md'), 'old copy\n');

    run(['--zip', makeZip(path.join(home, 'new.zip'), { version: '0.3.0' }), '--dir', dest]);
    assert.equal(fs.existsSync(path.join(dest, 'legacy.js')), false,
      'a file dropped in the new release must disappear from the browser too');
    assert.ok(fs.existsSync(path.join(dest, 'CLAUDE.md')), 'excluded files already there are left alone');
    assert.equal(installedVersion(dest), '0.3.0');
  });

  test('installs a changed manifest of the same byte length (checksum, not size+mtime)', () => {
    const home = tmpdir('home');
    const dest = path.join(home, 'ext');
    run(['--zip', makeZip(path.join(home, 'a.zip'), { version: '0.2.4' }), '--dir', dest]);
    run(['--zip', makeZip(path.join(home, 'b.zip'), { version: '0.2.5' }), '--dir', dest]);
    assert.equal(installedVersion(dest), '0.2.5');
  });

  test('leaves nothing behind on a dry run', () => {
    const home = tmpdir('home');
    const dest = path.join(home, 'ext');
    const out = run(['--zip', makeZip(path.join(home, 'dse.zip')), '--dir', dest, '--dry-run']);
    assert.match(out, /dry run/);
    assert.equal(fs.existsSync(dest), false);
  });

  test('picks the newest zip in ~/Downloads when none is named', () => {
    const home = tmpdir('home');
    const dest = path.join(home, 'ext');
    fs.mkdirSync(path.join(home, 'Downloads'));
    const older = makeZip(path.join(home, 'Downloads', 'dreaming-spanish-enhancer-0.9.0.zip'), { version: '0.9.0' });
    const newer = makeZip(path.join(home, 'Downloads', 'dreaming-spanish-enhancer-0.10.0.zip'), { version: '0.10.0' });
    // Name order and time order disagree on purpose: 0.9.0 sorts after 0.10.0
    // as text, so the script must not be choosing by name.
    const past = new Date(Date.now() - 60_000);
    fs.utimesSync(older, past, past);
    fs.utimesSync(newer, new Date(), new Date());

    run(['--dir', dest], { HOME: home });
    assert.equal(installedVersion(dest), '0.10.0');
  });
});

describe('install-macos.sh: refusals', () => {
  test('refuses a corrupt zip', () => {
    const home = tmpdir('home');
    const zip = path.join(home, 'broken.zip');
    fs.writeFileSync(zip, 'this is not a zip file');
    assert.match(runFails(['--zip', zip, '--dir', path.join(home, 'ext')]).stderr, /corrupt or unreadable zip/);
  });

  test("refuses a zip that isn't this extension", () => {
    const home = tmpdir('home');
    const zip = makeZip(path.join(home, 'other.zip'), { name: 'Zendesk Enhancer' });
    assert.match(runFails(['--zip', zip, '--dir', path.join(home, 'ext')]).stderr, /Zendesk Enhancer/);
  });

  test('refuses a zip with no manifest at all', () => {
    const home = tmpdir('home');
    const staging = tmpdir('stage');
    fs.writeFileSync(path.join(staging, 'readme.txt'), 'nothing here');
    const zip = path.join(home, 'empty.zip');
    execFileSync('zip', ['-qr', zip, '.'], { cwd: staging });
    assert.match(runFails(['--zip', zip, '--dir', path.join(home, 'ext')]).stderr, /no manifest\.json/);
  });

  test('refuses to install an older version over a newer one', () => {
    const home = tmpdir('home');
    const dest = path.join(home, 'ext');
    run(['--zip', makeZip(path.join(home, 'new.zip'), { version: '0.24.0' }), '--dir', dest]);
    const old = makeZip(path.join(home, 'old.zip'), { version: '0.9.0' });

    const r = runFails(['--zip', old, '--dir', dest]);
    assert.match(r.stderr, /older than the installed 0\.24\.0/);
    assert.equal(installedVersion(dest), '0.24.0', 'the refusal must not have half-installed it');

    // 0.9.0 vs 0.24.0 is exactly the pair a string comparison gets wrong.
    run(['--zip', old, '--dir', dest, '--force']);
    assert.equal(installedVersion(dest), '0.9.0');
  });

  test('reinstalls the same version without complaint', () => {
    const home = tmpdir('home');
    const dest = path.join(home, 'ext');
    const zip = makeZip(path.join(home, 'dse.zip'), { version: '0.3.0' });
    run(['--zip', zip, '--dir', dest]);
    assert.match(run(['--zip', zip, '--dir', dest]), /same version/);
    assert.equal(installedVersion(dest), '0.3.0');
  });
});

// ---------------------------------------------------------------------------
// scripts/chrome.js — reading Chrome's own preference files to find which
// folder Chrome has actually loaded this extension from.
// ---------------------------------------------------------------------------

const chrome = (args, env = {}) =>
  execFileSync('node', [CHROME_JS, ...args], { encoding: 'utf8', stdio: 'pipe', env: { ...process.env, ...env } });

describe('chrome.js installs', () => {
  test('lists only unpacked copies of this extension', () => {
    const root = tmpdir('chrome');
    const ours = writeSource(tmpdir('ours'), { version: '0.1.7' });
    const theirs = writeSource(tmpdir('theirs'), { name: 'Zendesk Enhancer', version: '2.24.0' });

    writeChromeProfile(root, 'Profile 1', {
      aaaa: { location: 4, path: ours },                                    // ours, unpacked
      bbbb: { location: 4, path: theirs },                                  // someone else's
      cccc: { location: 1, path: ours },                                    // ours, but from the store
      dddd: { location: 4, path: '/gone/dreaming-spanish-enhancer-main 2' }, // folder deleted
    });

    const rows = chrome(['installs'], { CHROME_ROOT: root }).trim().split('\n');
    assert.equal(rows.length, 2, `expected 2 rows, got: ${rows.join(' | ')}`);
    assert.deepEqual(rows[0].split('\t'), ['Profile 1', 'aaaa', '0.1.7', ours]);
    assert.deepEqual(rows[1].split('\t'), ['Profile 1', 'dddd', 'MISSING', '/gone/dreaming-spanish-enhancer-main 2']);
  });

  test('prints nothing when there is nothing of ours', () => {
    const root = tmpdir('chrome');
    writeChromeProfile(root, 'Default', {});
    assert.equal(chrome(['installs'], { CHROME_ROOT: root }), '');
  });

  test('survives an unreadable profile', () => {
    const root = tmpdir('chrome');
    const ours = writeSource(tmpdir('ours'));
    fs.mkdirSync(path.join(root, 'Broken'));
    fs.writeFileSync(path.join(root, 'Broken', 'Secure Preferences'), '{not json');
    writeChromeProfile(root, 'Profile 1', { aaaa: { location: 4, path: ours } });
    assert.match(chrome(['installs'], { CHROME_ROOT: root }), /Profile 1\taaaa/);
  });
});
