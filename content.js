// Content script — handles extraction in the tab context (survives popup close)
// and persists results to chrome.storage.local.

console.log('[Maps Extractor] Content script loaded');

let extractionRunning = false;

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'STOP_EXTRACTION') {
    console.log('[Maps Extractor] Stop signal received');
    window.__mapsExtractorStop = true;
    sendResponse({ acknowledged: true });
    return true;
  }

  if (message?.type === 'START_EXTRACTION') {
    if (extractionRunning) {
      sendResponse({ started: false, reason: 'already_running' });
      return true;
    }
    sendResponse({ started: true });
    // Run extraction async — popup doesn't need to wait for it
    doExtraction();
    return true;
  }

  if (message?.type === 'GET_STATUS') {
    sendResponse({ running: extractionRunning });
    return true;
  }
});

// ---------------------------------------------------------------------------
// EXTRACTION (runs entirely in content script — survives popup close)
// ---------------------------------------------------------------------------

async function doExtraction() {
  extractionRunning = true;
  window.__mapsExtractorStop = false;

  // Clear previous results
  await chrome.storage.local.set({
    extractionStatus: 'running',
    extractedData: [],
    wasStopped: false,
    savedAt: Date.now(),
    progress: { current: 0, total: 0, placeName: '' }
  });

  function shouldStop() {
    return window.__mapsExtractorStop === true;
  }

  function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  async function sendProgress(current, total, placeName) {
    // Save progress to storage so popup can read it
    await chrome.storage.local.set({
      progress: { current, total, placeName }
    });
    // Also try to notify popup directly (if it's open)
    try {
      chrome.runtime.sendMessage({ type: 'PROGRESS_UPDATE', current, total, placeName });
    } catch (_) { /* popup may be closed */ }
  }

  // Find the scrollable list container by behaviour (not fragile class)
  function findScrollContainer() {
    const anchor = document.querySelector('.fontHeadlineSmall');
    if (!anchor) return null;
    let el = anchor.parentElement;
    while (el && el !== document.body) {
      const s = getComputedStyle(el);
      if ((s.overflowY === 'auto' || s.overflowY === 'scroll') &&
          el.scrollHeight > el.clientHeight) {
        return el;
      }
      el = el.parentElement;
    }
    return null;
  }

  // Progressive scroll to load all virtualised places
  async function loadAllPlaces(container) {
    let lastHeight = 0;
    let heightStable = 0;
    const MAX_CHASE = 30;
    let chaseAttempts = 0;

    while (heightStable < 3 && chaseAttempts < MAX_CHASE && !shouldStop()) {
      const currentHeight = container.scrollHeight;
      container.scrollTop = currentHeight;
      await sleep(1200);

      const newHeight = container.scrollHeight;
      if (newHeight === lastHeight) {
        heightStable++;
      } else {
        heightStable = 0;
      }
      lastHeight = newHeight;
      chaseAttempts++;
    }

    container.scrollTop = 0;
    await sleep(1500);

    let countStable = 0;
    let passAttempts = 0;
    const MAX_PASS = 20;

    while (passAttempts < MAX_PASS && countStable < 3 && !shouldStop()) {
      const before = document.querySelectorAll('.fontHeadlineSmall').length;
      container.scrollTop += container.clientHeight;
      await sleep(1000);
      const after = document.querySelectorAll('.fontHeadlineSmall').length;
      countStable = after === before ? countStable + 1 : 0;
      passAttempts++;
    }

    container.scrollTop = 0;
    await sleep(800);
  }

  function readNoteFromListItem(button) {
    const stripGlyphs = t => t?.replace(/[\uE000-\uF8FF]/g, '').trim();
    let container = button.parentElement;
    for (let i = 0; i < 5 && container; i++) {
      const textarea = container.querySelector('textarea[aria-label="Note"]');
      if (textarea) {
        const val = stripGlyphs(textarea.value);
        return val && val.length > 0 ? val : null;
      }
      container = container.parentElement;
    }
    return null;
  }

  function getAllPlaces() {
    return Array.from(document.querySelectorAll('.fontHeadlineSmall'))
      .map(el => {
        const button = el.closest('button');
        return {
          element: el,
          name: el.textContent?.trim(),
          button,
          note: button ? readNoteFromListItem(button) : null
        };
      })
      .filter(p => p.name && p.button);
  }

  const ADDRESS_SELECTORS = [
    '[data-item-id="address"]',
    '[data-attrid="kc:/location/location:address"]',
    'button[data-item-id="address"]',
    '[aria-label*="Address:"]',
    '[data-tooltip="Copy address"]',
  ];

  const NO_ADDRESS_SIGNALS = [
    'Send to phone',
    "You'll receive directions",
    'Get directions',
  ];

  function readCurrentAddress() {
    for (const sel of ADDRESS_SELECTORS) {
      try {
        const el = document.querySelector(sel);
        if (!el) continue;
        const text = el.textContent?.replace(/[\uE000-\uF8FF]/g, '').trim();
        if (!text || text.length < 4) continue;

        if (NO_ADDRESS_SIGNALS.some(sig => text.includes(sig))) {
          return { text: null, definitelyNoAddress: true };
        }

        return { text, definitelyNoAddress: false };
      } catch (_) {
        continue;
      }
    }
    return null;
  }

  async function extractFromSidePanel(placeName, previousAddress) {
    const MAX_WAIT = 6000;
    const POLL_INTERVAL = 300;
    const DEFINITE_WAIT = 4000;

    const start = Date.now();
    let panelEverAppeared = false;

    while (Date.now() - start < MAX_WAIT) {
      const result = readCurrentAddress();

      if (result !== null) {
        panelEverAppeared = true;

        if (result.definitelyNoAddress) {
          return {
            name: placeName,
            address: 'No address (landmark/area)',
            success: true,
            noAddress: true
          };
        }

        if (result.text && result.text !== previousAddress) {
          return {
            name: placeName,
            address: result.text,
            success: true,
            noAddress: false
          };
        }
      }

      if (!panelEverAppeared && (Date.now() - start) > DEFINITE_WAIT) {
        return {
          name: placeName,
          address: 'No address found',
          success: false,
          noAddress: false
        };
      }

      await sleep(POLL_INTERVAL);
    }

    if (panelEverAppeared) {
      const last = readCurrentAddress();
      if (last?.text) {
        return {
          name: placeName,
          address: last.text,
          success: true,
          noAddress: false,
          stale: true
        };
      }
      return {
        name: placeName,
        address: 'No address (panel appeared but no data)',
        success: true,
        noAddress: true
      };
    }

    return {
      name: placeName,
      address: 'No address found',
      success: false,
      noAddress: false
    };
  }

  // ── Main flow ─────────────────────────────────────────────────────────

  async function finishWith(status, data, stopped) {
    await chrome.storage.local.set({
      extractionStatus: status,
      extractedData: data,
      wasStopped: stopped,
      savedAt: Date.now()
    });
    extractionRunning = false;
    // Notify popup if it's still open
    try {
      chrome.runtime.sendMessage({
        type: 'EXTRACTION_COMPLETE',
        extractedData: data,
        stopped
      });
    } catch (_) { /* popup may be closed */ }
  }

  const container = findScrollContainer();
  if (!container) {
    await finishWith('error', [], false);
    return;
  }

  await loadAllPlaces(container);

  if (shouldStop()) {
    await finishWith('stopped', [], true);
    return;
  }

  const allPlaces = getAllPlaces();
  if (allPlaces.length === 0) {
    await finishWith('error', [], false);
    return;
  }

  const extractedData = [];
  let previousAddress = null;

  for (let i = 0; i < allPlaces.length && !shouldStop(); i++) {
    const place = allPlaces[i];
    const current = i + 1;

    await sendProgress(current, allPlaces.length, place.name);

    try {
      place.element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await sleep(600);

      place.button.click();
      await sleep(400);

      const details = await extractFromSidePanel(place.name, previousAddress);
      details.note = place.note || null;
      extractedData.push(details);

      if (details.address && !details.noAddress && details.success && !details.stale) {
        previousAddress = details.address;
      }

      // Save incrementally — every place persisted immediately
      await chrome.storage.local.set({
        extractedData,
        savedAt: Date.now()
      });

      await sleep(400);

    } catch (err) {
      extractedData.push({
        name: place.name,
        note: place.note || null,
        success: false,
        noAddress: false,
        address: 'Processing error',
        error: err.message
      });
    }
  }

  await finishWith(
    shouldStop() ? 'stopped' : 'complete',
    extractedData,
    shouldStop()
  );
}
