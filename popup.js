// NON-AGGRESSIVE DESKTOP EXTRACTOR v3.1
// Fix: extraction runs in content script (survives popup close),
//      results persist in chrome.storage.local.

console.log('🚀 v3.1 LOADED');

const extractorState = {
  isRunning: false,
  shouldStop: false,
  extractedData: [],
  pollTimer: null
};

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

function clearSavedResults() {
  chrome.storage.local.remove([
    'extractedData', 'wasStopped', 'savedAt',
    'extractionStatus', 'progress'
  ]);
  extractorState.extractedData = [];
  const resultsEl = document.getElementById('results');
  if (resultsEl) resultsEl.textContent = '';
  hideStopNotice();
  setStatus('Ready — open your saved list first');
}

async function loadFromStorage() {
  return new Promise((resolve) => {
    chrome.storage.local.get(
      ['extractedData', 'wasStopped', 'savedAt', 'extractionStatus', 'progress'],
      (result) => resolve(result)
    );
  });
}

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------

function setStatus(msg, type = '') {
  const el = document.getElementById('status');
  if (!el) return;
  el.textContent = msg;
  el.className = type ? `status-${type}` : '';
}

function updateProgress(current, total) {
  const container = document.querySelector('.progress-container');
  const bar = document.getElementById('progressBar');
  const text = document.getElementById('progressText');

  if (container) container.style.display = 'block';
  if (bar && total > 0) bar.style.width = `${(current / total) * 100}%`;
  if (text) text.textContent = `${current}/${total} places processed`;
}

function showStopNotice() {
  const el = document.getElementById('stopNotice');
  if (el) el.style.display = 'block';
}

function hideStopNotice() {
  const el = document.getElementById('stopNotice');
  if (el) el.style.display = 'none';
}

function toggleButtons(isExtracting) {
  const extractBtn = document.getElementById('nonAggressiveBtn');
  const stopBtn = document.getElementById('stopBtn');

  if (extractBtn) {
    extractBtn.disabled = isExtracting;
    extractBtn.textContent = isExtracting ? 'Extracting...' : 'Extract Places';
    extractBtn.style.display = isExtracting ? 'none' : 'block';
  }
  if (stopBtn) {
    stopBtn.style.display = isExtracting ? 'block' : 'none';
    stopBtn.textContent = '⏹️ Stop Extraction';
    stopBtn.disabled = false;
  }
}

function finishExtraction() {
  toggleButtons(false);
  const container = document.querySelector('.progress-container');
  if (container) {
    setTimeout(() => { container.style.display = 'none'; }, 3000);
  }
  extractorState.isRunning = false;
  extractorState.shouldStop = false;
  stopPolling();
}

// ---------------------------------------------------------------------------
// Stop button
// ---------------------------------------------------------------------------

function stopExtraction() {
  if (!extractorState.isRunning) return;
  console.log('🛑 Stop requested');
  extractorState.shouldStop = true;

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]) {
      chrome.tabs.sendMessage(tabs[0].id, { type: 'STOP_EXTRACTION' });
    }
  });

  setStatus('Stopping extraction…', 'stopped');
  const stopBtn = document.getElementById('stopBtn');
  if (stopBtn) {
    stopBtn.textContent = '⏹️ Stopping…';
    stopBtn.disabled = true;
  }
}

// ---------------------------------------------------------------------------
// Results display  (safe DOM construction — no innerHTML interpolation)
// ---------------------------------------------------------------------------

function displayResults(data, wasStopped = false) {
  const resultsEl = document.getElementById('results');
  if (!resultsEl) return;

  const successCount = data.filter(p => p.success).length;
  const noAddressCount = data.filter(p => p.noAddress).length;

  resultsEl.textContent = '';

  // Summary banner
  const banner = document.createElement('div');
  banner.style.cssText = `background:${wasStopped ? '#fef7e0' : '#e6f4ea'};border:1px solid ${wasStopped ? '#f9ab00' : '#34a853'};border-radius:8px;padding:12px;margin-bottom:16px;`;
  const bannerTitle = document.createElement('h3');
  bannerTitle.style.cssText = `margin:0 0 8px;color:${wasStopped ? '#b06000' : '#34a853'};`;
  bannerTitle.textContent = `${wasStopped ? '⏹️ Partial' : '✅ Complete'} Extraction Results`;
  const bannerSub = document.createElement('p');
  bannerSub.style.cssText = 'margin:0;font-size:14px;';
  bannerSub.textContent = `${data.length} places processed · ${successCount} with addresses · ${noAddressCount} no address${wasStopped ? ' (stopped by user)' : ''}`;
  banner.appendChild(bannerTitle);
  banner.appendChild(bannerSub);
  resultsEl.appendChild(banner);

  // Action buttons row
  const btnRow = document.createElement('div');
  btnRow.className = 'button-row';

  const copyBtn = document.createElement('button');
  copyBtn.className = 'copy-btn';
  copyBtn.textContent = 'Copy to Clipboard';
  copyBtn.addEventListener('click', copyToClipboard);

  const dlBtn = document.createElement('button');
  dlBtn.className = 'download-btn';
  dlBtn.textContent = 'Download CSV';
  dlBtn.addEventListener('click', downloadResults);

  btnRow.appendChild(copyBtn);
  btnRow.appendChild(dlBtn);
  resultsEl.appendChild(btnRow);

  // Clear button
  const clearBtn = document.createElement('button');
  clearBtn.textContent = '🗑️ Clear Results';
  clearBtn.style.cssText = 'background:none;border:1px solid #dadce0;border-radius:6px;padding:6px;font-size:12px;color:#5f6368;cursor:pointer;width:100%;margin-bottom:10px;';
  clearBtn.addEventListener('click', clearSavedResults);
  resultsEl.appendChild(clearBtn);

  // Place list
  const list = document.createElement('div');
  list.style.cssText = 'max-height:300px;overflow-y:auto;border:1px solid #e0e0e0;border-radius:6px;';

  data.forEach((place, i) => {
    const row = document.createElement('div');
    row.style.cssText = 'padding:8px;border-bottom:1px solid #f0f0f0;font-size:12px;';

    const nameEl = document.createElement('div');
    nameEl.style.cssText = 'font-weight:bold;color:#1a73e8;';

    let icon = '✅';
    if (!place.success) icon = '❌';
    else if (place.noAddress) icon = '📍';

    nameEl.textContent = `${icon} ${i + 1}. ${place.name}`;

    const addrEl = document.createElement('div');
    addrEl.style.cssText = 'color:#5f6368;';
    addrEl.textContent = `Address: ${place.address || 'No address'}`;

    row.appendChild(nameEl);
    row.appendChild(addrEl);

    if (place.note) {
      const noteEl = document.createElement('div');
      noteEl.style.cssText = 'color:#b06000;margin-top:1px;';
      noteEl.textContent = `Note: ${place.note}`;
      row.appendChild(noteEl);
    }
    list.appendChild(row);
  });

  resultsEl.appendChild(list);
}

// ---------------------------------------------------------------------------
// Polling — reads progress/results from chrome.storage.local
// ---------------------------------------------------------------------------

function startPolling() {
  stopPolling();
  extractorState.pollTimer = setInterval(async () => {
    const stored = await loadFromStorage();

    if (stored.progress && stored.extractionStatus === 'running') {
      const p = stored.progress;
      if (p.current > 0) {
        updateProgress(p.current, p.total);
        setStatus(`Processing ${p.current}/${p.total}: ${p.placeName}`);
      }
    }

    if (stored.extractionStatus === 'complete' || stored.extractionStatus === 'stopped') {
      const data = stored.extractedData || [];
      const stopped = stored.wasStopped || false;

      extractorState.extractedData = data;
      updateProgress(data.length, data.length);

      if (stopped) {
        setStatus(`Stopped! ${data.length} places processed.`, 'stopped');
        showStopNotice();
      } else {
        setStatus(`Complete! ${data.length} places processed.`, 'success');
      }

      displayResults(data, stopped);
      finishExtraction();
    }

    if (stored.extractionStatus === 'error') {
      setStatus('Extraction failed — no places or scroll container found.', 'error');
      finishExtraction();
    }
  }, 1000);
}

function stopPolling() {
  if (extractorState.pollTimer) {
    clearInterval(extractorState.pollTimer);
    extractorState.pollTimer = null;
  }
}

// ---------------------------------------------------------------------------
// MAIN EXTRACTION — sends START to content script, then polls storage
// ---------------------------------------------------------------------------

async function startNonAggressiveExtraction() {
  if (extractorState.isRunning) {
    setStatus('Extraction already running…');
    return;
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url.includes('google.com/maps')) {
    setStatus('Please open a Google Maps saved list first');
    return;
  }

  extractorState.isRunning = true;
  extractorState.shouldStop = false;
  extractorState.extractedData = [];

  toggleButtons(true);
  hideStopNotice();
  updateProgress(0, 0);
  setStatus('Pre-scrolling to load all places — please wait…');

  // Also listen for direct messages from content script (while popup is open)
  chrome.runtime.onMessage.addListener(liveMessageListener);

  // Tell the content script to start extraction
  try {
    chrome.tabs.sendMessage(tab.id, { type: 'START_EXTRACTION' }, (response) => {
      if (chrome.runtime.lastError) {
        setStatus('Error: content script not ready. Refresh the Maps page and try again.', 'error');
        finishExtraction();
        return;
      }
      if (response && !response.started) {
        setStatus('Extraction already running in this tab.', 'stopped');
        // Still start polling to pick up results
      }
    });
  } catch (err) {
    setStatus(`Error: ${err.message}`, 'error');
    finishExtraction();
    return;
  }

  // Poll storage for progress and results
  startPolling();
}

// Live message listener — handles progress updates while popup is open
function liveMessageListener(message) {
  if (message.type === 'PROGRESS_UPDATE' && message.current > 0) {
    updateProgress(message.current, message.total);
    setStatus(`Processing ${message.current}/${message.total}: ${message.placeName}`);
  }
  if (message.type === 'EXTRACTION_COMPLETE') {
    const data = message.extractedData || [];
    const stopped = message.stopped || false;

    extractorState.extractedData = data;
    updateProgress(data.length, data.length);

    if (stopped) {
      setStatus(`Stopped! ${data.length} places processed.`, 'stopped');
      showStopNotice();
    } else {
      setStatus(`Complete! ${data.length} places processed.`, 'success');
    }

    displayResults(data, stopped);
    finishExtraction();
  }
}

// ---------------------------------------------------------------------------
// Copy to clipboard
// ---------------------------------------------------------------------------

function copyToClipboard() {
  const data = extractorState.extractedData;
  if (!data || data.length === 0) { alert('No data to copy'); return; }

  const lines = [];

  data.forEach((place, i) => {
    const status = place.success ? (place.noAddress ? '📍' : '✓') : '✗';
    lines.push(`${i + 1}. ${place.name} ${status}`);
    lines.push(`   Address: ${place.address || 'No address'}`);
    if (place.note) lines.push(`   Note: ${place.note}`);
    if (place.phone) lines.push(`   Phone: ${place.phone}`);
    lines.push('');
  });

  const text = lines.join('\n');

  navigator.clipboard.writeText(text).then(() => {
    const btn = document.querySelector('.copy-btn');
    if (!btn) return;
    const orig = btn.textContent;
    btn.textContent = 'Copied!';
    btn.style.background = '#34a853';
    setTimeout(() => {
      btn.textContent = orig;
      btn.style.background = '#1a73e8';
    }, 2000);
  }).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); alert('Copied!'); }
    catch (_) { alert('Copy failed — please select and copy manually.'); }
    document.body.removeChild(ta);
  });
}

// ---------------------------------------------------------------------------
// CSV download
// ---------------------------------------------------------------------------

function downloadResults() {
  const data = extractorState.extractedData;
  if (!data || data.length === 0) { alert('No data to download'); return; }

  function csvCell(val) {
    return `"${String(val || '').replace(/"/g, '""')}"`;
  }

  const rows = [
    ['Name', 'Address', 'Note', 'Phone', 'Has Address', 'Success'].map(csvCell).join(',')
  ];

  data.forEach(place => {
    rows.push([
      place.name || '',
      place.address || '',
      place.note || '',
      place.phone || '',
      place.noAddress ? 'No' : (place.success ? 'Yes' : 'Unknown'),
      place.success ? 'Yes' : 'No'
    ].map(csvCell).join(','));
  });

  const csv = '\uFEFF' + rows.join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `maps_export_${new Date().toISOString().split('T')[0]}.csv`;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);
}

// ---------------------------------------------------------------------------
// Boot — restore saved results or resume in-progress extraction
// ---------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', async () => {
  console.log('🎯 v3.1 ready');

  document.getElementById('nonAggressiveBtn')
    ?.addEventListener('click', startNonAggressiveExtraction);

  document.getElementById('stopBtn')
    ?.addEventListener('click', stopExtraction);

  // Check storage for existing results or in-progress extraction
  const stored = await loadFromStorage();

  if (stored.extractionStatus === 'running') {
    // Extraction is still going — resume UI
    extractorState.isRunning = true;
    toggleButtons(true);
    chrome.runtime.onMessage.addListener(liveMessageListener);

    if (stored.progress && stored.progress.current > 0) {
      updateProgress(stored.progress.current, stored.progress.total);
      setStatus(`Processing ${stored.progress.current}/${stored.progress.total}: ${stored.progress.placeName}`);
    } else {
      setStatus('Extraction in progress — please wait…');
    }

    startPolling();
    return;
  }

  if (stored.extractedData && stored.extractedData.length > 0) {
    extractorState.extractedData = stored.extractedData;
    const count = stored.extractedData.length;
    const stopped = stored.wasStopped || false;
    const label = stopped ? 'Partial' : 'Complete';
    setStatus(`${label} — ${count} places (from previous run)`, stopped ? 'stopped' : 'success');
    if (stopped) showStopNotice();
    displayResults(stored.extractedData, stopped);
  }
});
