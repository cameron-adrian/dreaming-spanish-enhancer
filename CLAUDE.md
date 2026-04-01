# CLAUDE.md

## Development Requirements

### Version Numbers
- Every code push must include a version number bump in `manifest.json`
- The extension must log its version to the console each time it loads
- Version format: `MAJOR.MINOR.PATCH` (e.g. `0.1.0`)
- The console log must use the prefix `[DS Enhancer]` and include the version from `manifest.json`
