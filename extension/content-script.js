// ============================================================================
// Canvas Item Bank Exporter — Phase 4
// FINAL stable version — Fetch/XHR Network Sniffer
// ============================================================================

(() => {
  console.log("%c[CanvasExporter] Content script booting…", "color:#9c27b0;font-weight:bold");

  // Global state (persists across navigation in SPA)
  if (!window.CanvasExporter_Global) {
    window.CanvasExporter_Global = {
      lastBankId: null,
      reportedBankIds: new Set(),
      fetchPatched: false,
      xhrPatched: false,
    };
  }

  const GS = window.CanvasExporter_Global;

  // Utility: extract bank ID from API URLs
  function extractBankId(url) {
    if (!url) return null;

    // /api/banks/3387
    let m = url.match(/\/api\/banks\/(\d+)/);
    if (m) return m[1];

    // /api/banks/<id>/bank_entries
    m = url.match(/\/api\/banks\/(\d+)\/bank_entries/);
    if (m) return m[1];

    return null;
  }

  // Report bank detection to background + popup
  function reportBank(bankId, source) {
    if (!bankId) return;
    if (GS.lastBankId === bankId) return;

    GS.lastBankId = bankId;

    console.log(`%c[CanvasExporter] Bank detected (${source}): ${bankId}`, "color:#4caf50;font-weight:bold");

    chrome.runtime?.sendMessage({
      type: "BANK_DETECTED",
      bankId,
      source,
      ts: Date.now(),
    });
  }

  // ---------------------------------------------------------------------------
  // FETCH PATCH
  // ---------------------------------------------------------------------------
  function patchFetch() {
    if (GS.fetchPatched) return;
    GS.fetchPatched = true;

    const realFetch = window.fetch;

    window.fetch = async function (...args) {
      try {
        const url = args[0]?.toString?.() || "";
        const bankId = extractBankId(url);
        if (bankId) reportBank(bankId, "fetch");
      } catch {}

      return realFetch.apply(this, args);
    };

    console.log("[CanvasExporter] fetch() patched");
  }

  // ---------------------------------------------------------------------------
  // XHR PATCH
  // ---------------------------------------------------------------------------
  function patchXHR() {
    if (GS.xhrPatched) return;
    GS.xhrPatched = true;

    const realOpen = XMLHttpRequest.prototype.open;

    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
      try {
        const urlStr = url?.toString?.() || "";
        const bankId = extractBankId(urlStr);
        if (bankId) reportBank(bankId, "xhr");
      } catch {}

      return realOpen.call(this, method, url, ...rest);
    };

    console.log("[CanvasExporter] XHR patched");
  }

  // ---------------------------------------------------------------------------
  // INITIALIZATION
  // ---------------------------------------------------------------------------

  console.log("%c[CanvasExporter] Initialization starting…", "color:#03a9f4;font-weight:bold");

  patchFetch();
  patchXHR();

  // Re-run patches if Canvas hot-reloads page scripts (rare but happens)
  const interval = setInterval(() => {
    patchFetch();
    patchXHR();
  }, 2000);
})();
