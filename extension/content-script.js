// ============================================================================
// Canvas Exporter — Phase 3.4
// XHR + fetch interception (idempotent, sandbox safe)
// ============================================================================

(() => {
  if (window.CanvasExporter_ContentLoaded) return;
  window.CanvasExporter_ContentLoaded = true;

  console.log("%c[CanvasExporter] Content script booting…", "color:#9c27b0;font-weight:bold");
  console.log("%c[CanvasExporter] Initialization starting…", "color:#03a9f4;font-weight:bold");

  // GLOBAL STATE -------------------------------------------------------------
  const GS = (window.CanvasExporter_Global = window.CanvasExporter_Global || {
    lastBank: null,
    lastEmit: 0,
    debounceMs: 200,
  });

  // Helper: extract bank ID from URL -----------------------------------------
  function extractBankId(url) {
    if (!url) return null;
    const m = url.match(/\/api\/banks\/(\d+)/i);
    return m ? m[1] : null;
  }

  function notifyBank(bankId, via) {
    if (!bankId) return;

    const now = performance.now();
    if (now - GS.lastEmit < GS.debounceMs) return;
    GS.lastEmit = now;

    GS.lastBank = bankId;
    console.log(`%c[CanvasExporter] Bank detected: ${bankId} via ${via}`, "color:#4caf50;font-weight:bold");

    window.postMessage(
      {
        type: "CANVAS_EXPORTER_BANK",
        bank: bankId,
        src: via,
        ts: Date.now(),
      },
      "*",
    );
  }

  // ---------------------------------------------------------------------------
  // FETCH INTERCEPTOR
  // ---------------------------------------------------------------------------

  if (!window.__CanvasExporter_fetchPatched) {
    window.__CanvasExporter_fetchPatched = true;

    const origFetch = window.fetch;
    window.fetch = async (...args) => {
      let url = args[0];
      if (typeof url !== "string") url = url?.url;

      const bankId = extractBankId(url);
      if (bankId) notifyBank(bankId, "fetch");

      return origFetch.apply(window, args);
    };

    console.log("[CanvasExporter] fetch() patched");
  }

  // ---------------------------------------------------------------------------
  // XHR INTERCEPTOR
  // ---------------------------------------------------------------------------

  if (!window.__CanvasExporter_xhrPatched) {
    window.__CanvasExporter_xhrPatched = true;

    const origOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
      const bankId = extractBankId(url);
      if (bankId) notifyBank(bankId, "xhr");

      return origOpen.call(this, method, url, ...rest);
    };

    console.log("[CanvasExporter] XHR patched");
  }
})();
