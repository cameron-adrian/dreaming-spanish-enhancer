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
