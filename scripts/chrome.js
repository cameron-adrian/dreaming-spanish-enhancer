#!/usr/bin/env node
// Everything install-macos.sh needs to know about Chrome that Chrome itself
// offers no command line for:
//
//   installs   TSV of every unpacked copy of this extension Chrome has
//              registered: <profile>\t<id>\t<version|MISSING>\t<path>
//
// Why read Chrome's own preference files: there is no CLI or automation
// surface for chrome://extensions, so this is the only way to learn which
// folder a running Chrome actually loads the extension from — which is what
// the installer has to update *in place* to keep the extension id stable, and
// with it every chrome.storage value the extension owns (books, hidden videos,
// Sheets settings, the time-outside import log). Reloading from a new folder
// mints a new id and silently wipes all of it.
//
// Read-only: never write these files. They are MAC-signed, and Chrome treats
// an edit as tampering.
//
// Env: CHROME_ROOT overrides the Chrome user-data directory (used by tests).

const fs = require("fs");
const os = require("os");
const path = require("path");

const EXTENSION_NAME = "Dreaming Spanish Enhancer";
// Folder-name fallback for an entry whose directory has since been deleted:
// there is no manifest left to read, but a stale registration still shows in
// chrome://extensions, so report it rather than silently dropping it.
const PATH_HINT_RE = /dreaming[-_ ]?spanish[-_ ]?enhancer/i;
// Chrome's Manifest::Location enum — 4 is the unpacked/LOAD case. Anything
// else came from the Web Store or a policy and is not ours to touch.
const LOCATION_UNPACKED = 4;

const chromeRoot = process.env.CHROME_ROOT
  || path.join(os.homedir(), "Library", "Application Support", "Google", "Chrome");

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (_) { return null; }
}

function profileDirs(root) {
  let entries = [];
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch (_) { return []; }
  return entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
}

// Modern Chrome keeps extension records in "Secure Preferences"; older builds
// kept them in "Preferences". Read both, and skip a malformed or unreadable
// profile rather than failing — a browser mid-write must not break an install.
function listInstalls() {
  const rows = [];
  const seen = new Set();
  for (const profile of profileDirs(chromeRoot)) {
    for (const file of ["Secure Preferences", "Preferences"]) {
      const prefs = readJson(path.join(chromeRoot, profile, file));
      const settings = prefs && prefs.extensions && prefs.extensions.settings;
      if (!settings || typeof settings !== "object") continue;
      for (const [id, entry] of Object.entries(settings)) {
        if (!entry || entry.location !== LOCATION_UNPACKED) continue;
        const dir = typeof entry.path === "string" ? entry.path : "";
        if (!dir) continue;
        const manifest = readJson(path.join(dir, "manifest.json"));
        const named = manifest && typeof manifest.name === "string" ? manifest : null;
        const isOurs = named ? named.name === EXTENSION_NAME : PATH_HINT_RE.test(dir);
        if (!isOurs) continue;
        const key = `${profile}\t${id}`;
        if (seen.has(key)) continue;      // same record present in both files
        seen.add(key);
        rows.push([profile, id, named ? named.version : "MISSING", dir].join("\t"));
      }
    }
  }
  return rows;
}

const [cmd] = process.argv.slice(2);
if (cmd === "installs") {
  const rows = listInstalls();
  if (rows.length) process.stdout.write(rows.join("\n") + "\n");
} else {
  process.stderr.write("usage: chrome.js installs\n");
  process.exit(2);
}
