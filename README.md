# Dreaming Spanish Enhancer

A browser extension (Chrome and Firefox) that adds progress tracking, statistics, book tracking, and quality-of-life features to the [Dreaming Spanish](https://www.dreamingspanish.com/) platform.

## Features

### Progress Statistics Card

Injected on the `/progress` page with detailed watch stats and a tabbed breakdown:

- **Overall stats**: total watched hours, available hours, completion percentage, videos watched
- **Almost Done tab**: categories (guide, level, topic, series) with only 1–3 videos remaining, plus nearly-finished individual videos sorted by closest to completion
- **Guide tab**: progress grouped by learning guide
- **Level tab**: progress grouped by difficulty level (Superbeginner, Beginner, Intermediate, Advanced)
- **Topic tab**: progress grouped by topic/tag
- **Series tab**: progress grouped by series

### Book Tracker

Injected on the `/progress` page alongside the stats card:

- Track books read in Spanish with title, author, ISBN, pages, and word count
- Search by ISBN or title/author via the Open Library API, or enter books manually
- Stats: total books read, total words read, total pages, average words per book
- Optional Google Sheets sync — each new book appends a row to your spreadsheet

### Hide Videos

Adds a "Hide video" option to the three-dot menu on every video card:

- Hidden videos are removed from catalog views immediately
- A "Hidden videos" carousel section appears on the `/library` page with unhide buttons
- Hidden video list persists across browser sessions

### Popup

Click the extension icon on any Dreaming Spanish page for a quick summary:

- Watched hours, available hours, videos seen, and a progress bar
- "View Progress Page" and "Refresh" buttons

## Installation

### Chrome

1. Clone or download this repository.
2. Open `chrome://extensions/` in Chrome.
3. Enable **Developer mode** (toggle in the top right).
4. Click **Load unpacked** and select the `dreaming-spanish-enhancer` directory.
5. Navigate to [app.dreamingspanish.com](https://app.dreamingspanish.com/) — the extension activates automatically.

### Firefox

Firefox uses a separate manifest (`manifest.firefox.json`) because it does not support
Chrome's `oauth2` manifest key or `chrome.identity.getAuthToken`. To install:

1. Clone or download this repository.
2. Replace the Chrome manifest with the Firefox one:
   ```sh
   cp manifest.firefox.json manifest.json
   ```
   (Or keep the original on a separate clone if you also use the Chrome build.)
3. Open `about:debugging#/runtime/this-firefox` in Firefox.
4. Click **Load Temporary Add-on…** and select `manifest.json` from the project directory.
5. Navigate to [app.dreamingspanish.com](https://app.dreamingspanish.com/) — the extension activates automatically.

> Temporary add-ons are removed when Firefox restarts. For a persistent install, the
> extension must be signed by Mozilla (AMO) or you can use Firefox Developer Edition /
> Nightly with `xpinstall.signatures.required=false` in `about:config`.

The extension reads your authentication token from localStorage, so you must be logged in to Dreaming Spanish for it to work.

## Google Sheets Integration (Optional)

To sync your book list to a Google Spreadsheet, follow the instructions for your browser
below, then configure in the extension: on the progress page, open the Book Tracker card →
click the gear icon → toggle On → paste your Spreadsheet ID (from the URL:
`docs.google.com/spreadsheets/d/[ID]/edit`).

### Chrome

1. **Create a Google Cloud project** at [console.cloud.google.com](https://console.cloud.google.com/).
2. **Enable the Google Sheets API**: APIs & Services → Library → search "Google Sheets API" → Enable.
3. **Create OAuth credentials**: APIs & Services → Credentials → Create Credentials → OAuth client ID → Application type: Chrome App. Use your extension's ID from `chrome://extensions/`.
4. **Update `manifest.json`**:
   ```json
   "oauth2": {
     "client_id": "YOUR_CLIENT_ID.apps.googleusercontent.com",
     "scopes": ["https://www.googleapis.com/auth/spreadsheets"]
   }
   ```

### Firefox

Firefox cannot use the Chrome App OAuth client type, so it uses a separate Web Application
client and `browser.identity.launchWebAuthFlow`.

1. **Create a Google Cloud project** at [console.cloud.google.com](https://console.cloud.google.com/).
2. **Enable the Google Sheets API**: APIs & Services → Library → search "Google Sheets API" → Enable.
3. **Find your extension's redirect URI**: load the extension in Firefox, open
   `about:debugging` → your extension → **Inspect** → in the console run:
   ```js
   browser.identity.getRedirectURL()
   ```
   Copy the result (looks like `https://<random-id>.extensions.allizom.org/`).
4. **Create OAuth credentials**: APIs & Services → Credentials → Create Credentials →
   OAuth client ID → Application type: **Web application**. Add the redirect URI from
   step 3 to **Authorized redirect URIs**.
5. **Paste the client ID** into `src/background.js`:
   ```js
   const FIREFOX_OAUTH_CLIENT_ID = 'YOUR_FIREFOX_CLIENT_ID.apps.googleusercontent.com';
   ```

## Project Structure

```
├── manifest.json              # Chrome extension manifest (version, permissions, scripts)
├── manifest.firefox.json      # Firefox extension manifest (alternate, see Installation)
├── src/
│   ├── content.js             # Entry point: SPA navigation, card injection, menu observer
│   ├── api.js                 # DS API calls, auth token extraction, progress aggregation
│   ├── progress-ui.js         # Progress stats card DOM rendering and tab logic
│   ├── book-tracker-ui.js     # Book tracker card, Open Library search, CRUD
│   ├── sheets-integration.js  # Google Sheets sync settings and OAuth token handling
│   ├── hide-video-ui.js       # Menu injection, hidden videos carousel
│   ├── background.js          # Service worker: message routing, cache (5 min TTL), storage
│   ├── popup.html             # Popup template
│   ├── popup.js               # Popup logic
│   └── progress.css           # All card styles, dark mode, animations
└── images/
    ├── icon-16.png
    ├── icon-48.png
    └── icon-128.png
```

## Development

After making changes, reload the extension at `chrome://extensions/` (click the refresh
icon on the extension card) or at `about:debugging#/runtime/this-firefox` in Firefox.

Per project convention, every code push must include a version bump in `manifest.json`.
Bump `manifest.firefox.json` to the same version to keep the two builds in sync.
