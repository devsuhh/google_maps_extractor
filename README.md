# Google Maps List Extractor

A Chrome extension that extracts places, addresses, and notes from your Google Maps saved lists. Designed as the first half of a two-step workflow — extract from Google Maps, then import into [Wanderlog](https://wanderlog.com) using the companion [Wanderlog Importer](https://github.com/devsuhh/wanderlog_importer) extension.

## What it does

Open any saved list in Google Maps, click **Extract Places**, and the extension will:

1. **Pre-scroll** the entire list to force Google's virtual scrolling to load every place into the DOM
2. **Click each place** to open its side panel and read the address
3. **Read notes** from the list view (the `textarea` Google Maps renders for each place's note)
4. **Detect addressless places** (landmarks, areas, transit stops) using heuristic signals
5. **Output a numbered list** you can copy to clipboard or download as CSV

The extraction is non-aggressive — it clicks one place at a time, waits for the address panel to update, then moves on. You can stop at any time and keep partial results.

## Output format

The clipboard output looks like this:

```
1. Café Mogador ✓
   Address: 101 St Marks Pl, New York, NY 10009
   Note: great shakshuka

2. Watsons Bay 📍
   Address: No address (landmark/area)
   Note: cliff walk

3. Some Closed Place ✗
   Address: No address found
   Note:
```

Status icons: `✓` = address found, `📍` = place exists but has no street address, `✗` = extraction failed for this place.

This format is designed to be pasted directly into the Wanderlog Place Importer extension.

## Installation

1. Clone or download this repo
2. Open `chrome://extensions/` in Chrome
3. Enable **Developer mode** (top right toggle)
4. Click **Load unpacked** and select the folder containing these files
5. The extension icon appears in your toolbar

## Usage

1. Go to Google Maps and open a saved list (e.g. "Want to go", "Favorites", or any custom list)
2. Make sure you're on the **desktop** version of Maps (not the mobile/lite view)
3. Click the extension icon in your toolbar
4. Click **Extract Places**
5. Wait — the extension pre-scrolls to load all places first, then processes them one by one
6. When done, click **Copy to Clipboard** or **Download CSV**

### Stopping early

Click **Stop Extraction** at any time. You'll get results for all places processed so far, and the UI will show a partial results banner. Results persist — you can close the popup, reopen it, and your data is still there.

### Persistence

Results are saved to `chrome.storage.local` after each place is processed. If the popup closes mid-extraction (you click away, Chrome minimises, etc.), the extraction continues in the background and results are preserved. Reopen the popup to see current progress or completed results.

Click **Clear Results** to wipe saved data and start fresh.

## How it works

The extension has three parts:

| File | Role |
|------|------|
| `content.js` | Runs in the Google Maps tab. Contains all extraction logic — scrolling, clicking, address reading, note reading. Persists as long as the tab is open. Saves results incrementally to `chrome.storage.local`. |
| `popup.js` | The popup UI. Sends a `START_EXTRACTION` message to the content script, then polls storage for progress and results. Handles copy/download/clear. |
| `popup.html` | Layout and styling for the popup. |

### Why the content script, not `executeScript`?

Earlier versions injected the extraction function from the popup using `chrome.scripting.executeScript`. This worked while the popup stayed open, but if you clicked away mid-extraction, the popup's JS context died and the `executeScript` promise chain broke — results were lost. Moving the extraction into the content script means it runs independently of the popup and survives popup close/reopen.

### Address detection

The extension tries multiple DOM selectors to find the address in Google Maps' side panel, in order of reliability:

- `[data-item-id="address"]`
- `[data-attrid="kc:/location/location:address"]`
- `button[data-item-id="address"]`
- `[aria-label*="Address:"]`
- `[data-tooltip="Copy address"]`

For places that genuinely have no street address (parks, landmarks, areas), it detects signals like "Send to phone" or "Get directions" text in the panel and marks them as `📍` instead of `✗`.

### Virtual scrolling

Google Maps uses virtual scrolling for saved lists — only ~20 DOM elements exist at a time. The extension handles this with a two-phase pre-scroll:

1. **Chase the bottom** — scroll to `scrollHeight` repeatedly until it stops growing (3 stable checks in a row)
2. **Slow pass** — scroll back to top and do a gradual top-to-bottom pass to confirm all items are loaded and notes are hydrated

### Address change detection

When you click a place, the side panel updates — but sometimes slowly. The extension uses a "previous address" strategy: it remembers the last successfully read address and waits for the panel to show a *different* address, confirming it's loaded data for the new place. This avoids recording stale addresses from the previous place.

## Caveats

- **DOM scraping** — this reads Google Maps' DOM directly. If Google changes their class names, `data-` attributes, or panel structure, selectors may break. The multi-selector fallback approach makes it reasonably resilient, but it's not guaranteed to survive every Maps redesign.
- **One tab at a time** — the content script runs in the active Maps tab. Don't switch to a different Maps tab during extraction.
- **Speed vs. reliability** — each place takes 1–6 seconds depending on how fast the address panel loads. A 50-place list takes 2–5 minutes. This is intentionally slow to avoid triggering rate limits or breaking the DOM.
- **Notes require scroll hydration** — Google Maps only renders note textareas for places that have been scrolled into view. The pre-scroll phase handles this, but if it's interrupted, some notes may be missed.
- **No API involved** — this doesn't use the Google Maps API or Places API. It's pure DOM automation. Your data stays local; nothing is sent to any server.
- **Desktop only** — the mobile/lite view of Google Maps has a completely different DOM structure and is not supported.

## Project structure

```
├── manifest.json    # MV3 extension manifest
├── popup.html       # Popup UI
├── popup.js         # Popup logic (start/stop/display/copy/download)
├── content.js       # Extraction engine (runs in Maps tab)
└── README.md
```

## Companion tool

This extension produces output designed for the **Wanderlog Place Importer** — a separate Chrome extension that takes the clipboard output and imports places into a Wanderlog trip, including notes. See the [Wanderlog Place Importer repo](https://github.com/your-username/wanderlog-place-importer) for details.

## License

MIT
