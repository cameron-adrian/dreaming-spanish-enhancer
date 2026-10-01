# CLAUDE.md

## Development Requirements

### Version Numbers
- Every code push must include a version number bump in `manifest.json`
- The extension must log its version to the console each time it loads
- Version format: `MAJOR.MINOR.PATCH` (e.g. `0.1.0`)
- The console log must use the prefix `[DS Enhancer]` and include the version from `manifest.json`
- Bump `manifest.firefox.json` to the same version (a test enforces this)

### Tests
- Run: `npm test` (Node's built-in `node:test`, Node 20+, no dependencies to install)
- CI: `.github/workflows/test.yml` runs on every PR and on pushes to `main`, once in UTC and once in `America/New_York` — date bugs often only show west of UTC
- `tests/helpers/load-script.js` loads a browser script from `src/` into a `vm` context with stubbed `localStorage`/`fetch`/`location`; use it rather than turning the scripts into modules
- `tests/fixtures/ds-api.js` mirrors the live DS API response shapes (captured 2026-09-30). When DS changes a shape, update the fixture first
- `tests/manifest.test.js` guards the two manifests staying in sync, referenced files existing, scripts parsing, and content scripts not redeclaring each other's top-level names
- `tests/install-macos.test.js` covers the installer against real zips and a fake Chrome profile (`CHROME_ROOT`, `DSE_OS`, `DSE_SKIP_CHROME`) — never the real profile

### Installing on macOS (after a version bump merges)
Do this immediately, without being asked, as the last step of every merged version bump:

1. Download `main` as a version-named zip:
   `gh api repos/cameron-adrian/dreaming-spanish-enhancer/zipball/main > ~/Downloads/dreaming-spanish-enhancer-<version>.zip`
2. Verify it: `unzip -t` on the archive, and the `manifest.json` inside reads the version just shipped
3. Run `scripts/install-macos.sh` (newest zip in `~/Downloads` by default; `--dry-run`, `--zip`, `--dir`, `--force`, `--no-nudge`)
4. Tell Cameron to click the reload arrow on the extension's card in the `chrome://extensions` tab it opens

The installer updates **the folder Chrome already loads** in place (found via `scripts/chrome.js`, which reads Chrome's profile preferences — read-only; never edit them, they're signed). On Cameron's Mac that is `~/Downloads/dreaming-spanish-enhancer-main`. Never "remove, then Load unpacked" a new folder: that mints a new extension id and wipes everything in `chrome.storage` (books, hidden videos, Sheets settings, the time-outside import log).

`scripts/` isn't shipped to the browser, but the version rule above still applies to any push.
