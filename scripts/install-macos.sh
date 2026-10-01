#!/usr/bin/env bash
# Installs a downloaded release zip into the unpacked extension folder Chrome
# already loads, then points you at the one-click reload in chrome://extensions
# so the new code goes live. Ported from zendesk-enhancer's installer.
#
# The important design decision is that this UPDATES IN PLACE rather than
# removing the extension and loading a new folder. "Remove, then Load unpacked
# from the new download" mints a NEW extension id every time, and an extension
# id is what chrome.storage.local is keyed to — so every such update silently
# wipes the book list, hidden videos, Sheets settings and the time-outside
# import log. Same folder, same id, data intact.
#
# That is also why the default install folder is not a fixed path: it is
# whichever folder Chrome is already loading this extension from (read from
# Chrome's profile preferences). ~/Extensions/dreaming-spanish-enhancer is only
# used when Chrome isn't loading it from anywhere yet.
#
# Usage:
#   scripts/install-macos.sh [options]
#     --zip PATH     zip to install (default: newest ~/Downloads/dreaming-spanish-enhancer-*.zip)
#     --dir PATH     install folder (default: the folder Chrome already loads)
#     --no-nudge     update the files and stop; don't touch Chrome at all
#     --force        allow installing a version older than the one installed
#     --dry-run      say what would happen, change nothing
#
# Env (tests): DSE_OS overrides the uname check, CHROME_ROOT overrides Chrome's
# user-data dir, DSE_SKIP_CHROME=1 skips every Chrome interaction.
set -euo pipefail

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHROME_JS="$SELF_DIR/chrome.js"
CHROME_APP="Google Chrome"
EXTENSION_NAME="Dreaming Spanish Enhancer"
ZIP_GLOB_PREFIX="dreaming-spanish-enhancer-"
FIRST_INSTALL_DIR="${HOME}/Extensions/dreaming-spanish-enhancer"

ZIP=""
INSTALL_DIR=""
NO_NUDGE=0
FORCE=0
DRY_RUN=0

die() { printf 'error: %s\n' "$*" >&2; exit 1; }
say() { printf '%s\n' "$*"; }

while [ $# -gt 0 ]; do
  case "$1" in
    --zip) ZIP="${2:?--zip needs a path}"; shift 2 ;;
    --dir) INSTALL_DIR="${2:?--dir needs a path}"; shift 2 ;;
    --no-nudge) NO_NUDGE=1; shift ;;
    --force) FORCE=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) sed -n '2,27p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) die "unknown option: $1" ;;
  esac
done

# --- 1. macOS only ---------------------------------------------------------
# Not an error anywhere else: this is a convenience for one machine, and a
# Linux CI run or a cloud session should skip it quietly, not fail.
OS="${DSE_OS:-$(uname -s)}"
if [ "$OS" != "Darwin" ]; then
  say "Not macOS ($OS) — nothing to install here."
  exit 0
fi

# --- 2. Which folder? --------------------------------------------------------
# Reading Chrome's preference files is read-only and safe while it runs.
INSTALLS="$(node "$CHROME_JS" installs || true)"
LOADED="$(printf '%s\n' "$INSTALLS" | grep -v '	MISSING	' | grep -v '^$' || true)"
ORPHANED="$(printf '%s\n' "$INSTALLS" | grep '	MISSING	' || true)"

if [ -z "$INSTALL_DIR" ]; then
  LOADED_DIRS="$(printf '%s\n' "$LOADED" | cut -f4 | grep -v '^$' | sort -u || true)"
  count="$(printf '%s' "$LOADED_DIRS" | grep -c . || true)"
  if [ "$count" -eq 1 ]; then
    INSTALL_DIR="$LOADED_DIRS"
  elif [ "$count" -gt 1 ]; then
    say "Chrome loads $EXTENSION_NAME from more than one folder:" >&2
    printf '%s\n' "$LOADED" | while IFS=$'\t' read -r profile id version path; do
      say "  - $path  ($version, id $id, $profile)" >&2
    done
    die "pick the one whose data you want to keep with --dir PATH, and remove the others in chrome://extensions"
  else
    INSTALL_DIR="$FIRST_INSTALL_DIR"
  fi
fi
say "Folder:  $INSTALL_DIR"

# --- 3. Find and verify the zip -------------------------------------------
if [ -z "$ZIP" ]; then
  # Newest by mtime rather than by name: version numbers do not sort as text
  # (0.9.0 vs 0.10.0), and the freshly downloaded one is always the newest.
  ZIP="$(ls -t "${HOME}"/Downloads/${ZIP_GLOB_PREFIX}*.zip 2>/dev/null | head -1 || true)"
  [ -n "$ZIP" ] || die "no zip found in ~/Downloads (looked for ${ZIP_GLOB_PREFIX}*.zip). Pass --zip PATH."
fi
[ -f "$ZIP" ] || die "no such file: $ZIP"
unzip -tqq "$ZIP" >/dev/null 2>&1 || die "corrupt or unreadable zip: $ZIP"
say "Zip:     $ZIP"

STAGE="$(mktemp -d "${TMPDIR:-/tmp}/dse-install.XXXXXX")"
trap 'rm -rf "$STAGE"' EXIT
unzip -qq "$ZIP" -d "$STAGE"

# GitHub's zipball wraps everything in a single commit-named folder; a hand-made
# zip might not. Handle both by looking for the manifest one level down, then
# at the top.
SRC=""
for candidate in "$STAGE"/*/ "$STAGE"/; do
  [ -f "${candidate}manifest.json" ] || continue
  SRC="${candidate%/}"
  break
done
[ -n "$SRC" ] || die "no manifest.json in $ZIP — is this the extension's zip?"

read_manifest() {   # read_manifest <dir> <field>
  node -e '
    const fs = require("fs");
    let m;
    try { m = JSON.parse(fs.readFileSync(process.argv[1] + "/manifest.json", "utf8")); }
    catch (e) { process.exit(1); }
    const v = m[process.argv[2]];
    if (typeof v !== "string") process.exit(1);
    process.stdout.write(v);
  ' "$1" "$2"
}

NEW_NAME="$(read_manifest "$SRC" name)" || die "unreadable manifest.json in $ZIP"
NEW_VERSION="$(read_manifest "$SRC" version)" || die "no version in the manifest.json inside $ZIP"
[ "$NEW_NAME" = "$EXTENSION_NAME" ] || die "that zip contains \"$NEW_NAME\", not $EXTENSION_NAME"
say "Version: $NEW_VERSION"

# --- 4. Compare with what is installed ------------------------------------
# The zip in ~/Downloads is not necessarily the newest thing that exists — an
# old download lingers, and installing it would quietly downgrade the browser
# to code the repo has moved past. Refuse unless asked twice.
OLD_VERSION=""
if [ -f "$INSTALL_DIR/manifest.json" ]; then
  OLD_VERSION="$(read_manifest "$INSTALL_DIR" version || true)"
fi
if [ -n "$OLD_VERSION" ]; then
  say "Installed: $OLD_VERSION -> $NEW_VERSION"
  if [ "$OLD_VERSION" = "$NEW_VERSION" ]; then
    say "(same version — reinstalling the files anyway)"
  else
    newest="$(printf '%s\n%s\n' "$OLD_VERSION" "$NEW_VERSION" | sort -t. -k1,1n -k2,2n -k3,3n | tail -1)"
    if [ "$newest" = "$OLD_VERSION" ] && [ "$FORCE" -ne 1 ]; then
      die "$NEW_VERSION is older than the installed $OLD_VERSION. Pass --force to go back on purpose."
    fi
  fi
fi

# --- 5. Copy into place ----------------------------------------------------
# Everything the browser does not load is left out. --delete matters: a file
# dropped in a later release must disappear from the browser too, which a
# plain copy would leave behind forever. Excluded paths already sitting in the
# folder are left alone (rsync only deletes them with --delete-excluded).
# --checksum, not rsync's default size+mtime quick check: two releases of
# manifest.json are often the same byte length (0.2.4 -> 0.2.5) and a zip
# keeps its own timestamps, so the quick check can skip a genuinely changed
# file and report success having installed nothing.
RSYNC_ARGS=(-a --checksum --delete
  --exclude '.git' --exclude '.git/' --exclude '.gitignore' --exclude '.github'
  --exclude '.claude' --exclude '.playwright-mcp' --exclude 'docs' --exclude 'tests'
  --exclude 'scripts' --exclude 'node_modules' --exclude 'package.json'
  --exclude 'package-lock.json' --exclude 'CLAUDE.md' --exclude 'README.md'
  --exclude 'ROADMAP.md' --exclude 'FEATURE-IDEAS.md' --exclude 'mockup.html'
  --exclude 'mockup.png' --exclude 'generate_mockup.py' --exclude '.DS_Store')

if [ "$DRY_RUN" -eq 1 ]; then
  say "(dry run) would sync $SRC/ -> $INSTALL_DIR/"
  rsync "${RSYNC_ARGS[@]}" --dry-run --itemize-changes "$SRC/" "$INSTALL_DIR/" || true
  exit 0
fi

mkdir -p "$INSTALL_DIR"
rsync "${RSYNC_ARGS[@]}" "$SRC/" "$INSTALL_DIR/"
INSTALLED_VERSION="$(read_manifest "$INSTALL_DIR" version)" \
  || die "copy finished but $INSTALL_DIR/manifest.json is unreadable"
[ "$INSTALLED_VERSION" = "$NEW_VERSION" ] \
  || die "copy finished but $INSTALL_DIR reads $INSTALLED_VERSION, expected $NEW_VERSION"
say "Installed $EXTENSION_NAME $NEW_VERSION -> $INSTALL_DIR"

if [ "$NO_NUDGE" -eq 1 ] || [ "${DSE_SKIP_CHROME:-0}" = "1" ]; then
  exit 0
fi

# --- 6. Point you at the reload, or the one-time setup ---------------------
# An unpacked extension is only re-read from disk when Chrome is explicitly
# told to: the reload arrow on its card in chrome://extensions, or Load
# unpacked. Both keep the extension's id (and so its storage) intact, and
# neither needs the browser to close. Chrome exposes no CLI or AppleScript
# hook for clicking that arrow, so the most this script can do is put the
# right page in front of you — the old code keeps working until you click it.
ALREADY_LOADED=0
printf '%s\n' "$LOADED" | cut -f4 | grep -Fxq "$INSTALL_DIR" && ALREADY_LOADED=1

if [ "$ALREADY_LOADED" -eq 1 ] && ! pgrep -x "$CHROME_APP" >/dev/null 2>&1; then
  say ""
  say "Chrome isn't running — it will load $NEW_VERSION fresh from disk next time"
  say "you open it. Nothing else to do."
  exit 0
fi

# Via AppleScript rather than `open`: Chrome ignores a chrome:// URL handed to
# it on the command line, but will open one in a tab — and this also launches
# Chrome if it wasn't running, for the one-time-setup case below.
osascript >/dev/null 2>&1 <<APPLESCRIPT || true
tell application "$CHROME_APP"
  activate
  if (count windows) = 0 then
    make new window
    set URL of active tab of front window to "chrome://extensions"
  else
    tell front window to make new tab at end of tabs with properties {URL:"chrome://extensions"}
  end if
end tell
APPLESCRIPT

if [ "$ALREADY_LOADED" -eq 1 ]; then
  say ""
  say "$NEW_VERSION is on disk. Click the reload icon on the $EXTENSION_NAME card in"
  say "chrome://extensions (just opened) to pick it up — same extension id, same"
  say "data, no restart needed. No rush: the old code keeps running until you do."
  exit 0
fi

say ""
say "Chrome is not loading this folder yet — one-time setup:"
say "  1. In chrome://extensions, turn on Developer mode."
if [ -n "$LOADED" ]; then
  say "  2. These loaded copies each have their own extension id and their own saved"
  say "     data. Removing one deletes its data, so only do it if you don't need it:"
  printf '%s\n' "$LOADED" | while IFS=$'\t' read -r profile id version path; do
    [ -n "$id" ] || continue
    say "       - $id  ($version)  $path"
  done
else
  say "  2. (nothing loaded to remove)"
fi
say "  3. Load unpacked -> $INSTALL_DIR"
if [ -n "$ORPHANED" ]; then
  say ""
  say "Also registered, but pointing at folders that no longer exist:"
  printf '%s\n' "$ORPHANED" | while IFS=$'\t' read -r profile id version path; do
    [ -n "$id" ] || continue
    say "  - $id  $path"
  done
  say "Chrome could not load these, so they usually show no card at all — ignore"
  say "them. Don't hand-edit Chrome's preference files to purge them: they are"
  say "signed, and Chrome treats an edit as tampering."
fi
say ""
say "After that, every future release lands here with a one-click reload."
