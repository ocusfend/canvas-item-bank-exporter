(() => {
  console.log("%c[CanvasExporter] Content script booting (Phase 3.4)…", "color:#9c27b0;font-weight:bold");

  // Global shared memory
  if (!window.CanvasExporter_GlobalState) {
    window.CanvasExporter_GlobalState = {
      lastDetectedBank: null,
      recentlySeen: new Set(),
      debug: true,
    };
  }

  const GS = window.CanvasExporter_GlobalState;

  // -------------------------------------------------------
  // Utility: Send message to background
  // -------------------------------------------------------
  function reportBank(uuid, source, extra = {}) {
    if (!uuid) return;
    if (GS.lastDetectedBank === uuid) return;
    GS.lastDetectedBank = uuid;

    console.log(`%c[CanvasExporter] Bank detected (${source}): ${uuid}`, "color:#4caf50;font-weight:bold");

    chrome.runtime?.sendMessage({
      type: "BANK_CONTEXT_DETECTED",
      uuid,
      source,
      ...extra,
    });
  }

  // -------------------------------------------------------
  // 1) DETECTION MODE A — URL scanning
  // -------------------------------------------------------
  function scanUrl(url) {
    if (!url) return;
    const bankMatch = url.match(/\/banks\/(\d+)/i);
    if (bankMatch) {
      reportBank(bankMatch[1], "url");
    }
  }

  scanUrl(location.href);

  // -------------------------------------------------------
  // 2) DETECTION MODE B — fetch() monkeypatch
  // -------------------------------------------------------
  (function patchFetch() {
    const origFetch = window.fetch;
    if (!origFetch) return;

    window.fetch = async (...args) => {
      try {
        const res = await origFetch(...args);

        const url = typeof args[0] === "string" ? args[0] : args[0].url;

        if (url.includes("/api/banks/")) {
          const m = url.match(/\/api\/banks\/(\d+)/);
          if (m) reportBank(m[1], "fetch", { url });
        }

        return res;
      } catch (e) {
        return origFetch(...args);
      }
    };

    console.log("[CanvasExporter] fetch() patched");
  })();

  // -------------------------------------------------------
  // 3) DETECTION MODE C — XHR monkeypatch
  // -------------------------------------------------------
  (function patchXHR() {
    const origOpen = XMLHttpRequest.prototype.open;

    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
      if (url.includes("/api/banks/")) {
        const m = url.match(/\/api\/banks\/(\d+)/);
        if (m) reportBank(m[1], "xhr", { url });
      }
      return origOpen.call(this, method, url, ...rest);
    };

    console.log("[CanvasExporter] XHR patched");
  })();

  // -------------------------------------------------------
  // 4) DETECTION MODE D — MutationObserver (LTI iframe watch)
  // -------------------------------------------------------
  const observer = new MutationObserver(() => {
    document.querySelectorAll("iframe").forEach((iframe) => {
      try {
        const src = iframe.src || iframe.contentWindow?.location?.href;
        if (src && src.includes("/banks/")) {
          const m = src.match(/\/banks\/(\d+)/);
          if (m) reportBank(m[1], "iframe");
        }
      } catch {}
    });
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

  console.log("[CanvasExporter] MutationObserver running");

  // -------------------------------------------------------
  // 5) DETECTION MODE E — Learnosity JSON sniffing
  // -------------------------------------------------------
  function scanForLearnosity() {
    const scripts = document.querySelectorAll("script");
    for (const s of scripts) {
      if (!s.textContent) continue;
      if (s.textContent.includes("learnosity") || s.textContent.includes("item_bank_id")) {
        const m = s.textContent.match(/bank[_ ]?id["']?\s*[:=]\s*["']?(\d+)/i);
        if (m) reportBank(m[1], "learnosity");
      }
    }
  }

  setTimeout(scanForLearnosity, 500);
  setTimeout(scanForLearnosity, 1500);
  setTimeout(scanForLearnosity, 3000);

  console.log("[CanvasExporter] Phase 3.4 page script active");
})();
