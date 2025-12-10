// ============================================================================
// Canvas Exporter — Phase 3.4
// Page-World Fetch/XHR Monkeypatch (Required for Canvas + Learnosity)
// ============================================================================

(function () {
  console.log("%c[CanvasExporter] Page script active (Phase 3.4)", "color:#03a9f4;font-weight:bold");

  const BANK_REGEX = /\/api\/banks\/(\d+)/i;
  const ENTRY_REGEX = /\/api\/banks\/(\d+)\/bank_entries\/(\d+)/i;

  function emitBank(uuid, source) {
    const evt = new CustomEvent("CanvasExporter:bankDetected", {
      detail: { uuid, source },
    });
    window.dispatchEvent(evt);
  }

  // ----------------------------
  // Intercept fetch()
  // ----------------------------
  const origFetch = window.fetch;
  window.fetch = async function (...args) {
    try {
      const url = typeof args[0] === "string" ? args[0] : args[0]?.url;
      if (url) inspectUrl(url, "fetch");
    } catch {}
    return origFetch.apply(this, args);
  };

  // ----------------------------
  // Intercept XHR
  // ----------------------------
  const origXHRopen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    try {
      inspectUrl(url, "xhr");
    } catch {}
    return origXHRopen.call(this, method, url, ...rest);
  };

  // ----------------------------
  // URL Inspector
  // ----------------------------
  function inspectUrl(url, source) {
    const b = url.match(BANK_REGEX);
    if (b) {
      const bankId = b[1];
      console.log(`%c[CanvasExporter] Bank detected via ${source}: ${bankId}`, "color:#4caf50;font-weight:bold");
      emitBank(bankId, source);
      return;
    }

    const e = url.match(ENTRY_REGEX);
    if (e) {
      const bankId = e[1];
      console.log(`%c[CanvasExporter] BankEntry detected via ${source}: ${bankId}`, "color:#4caf50;font-weight:bold");
      emitBank(bankId, source);
    }
  }
})();
