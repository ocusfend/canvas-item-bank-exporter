// ============================================================================
// Canvas New Quizzes Item Bank Exporter — Phase 4.0
// Reliable Bank Detection + Fetch/XHR Sniffing + Sandbox Safe
// ============================================================================

(() => {
  console.log("%c[CanvasExporter] Content script booting…", "color:#9c27b0;font-weight:bold");

  // ==========================================================================
  // GLOBAL SINGLETON STATE
  // ==========================================================================
  if (!window.CanvasExporter_GlobalState) {
    window.CanvasExporter_GlobalState = {
      postMessageListenerAttached: false,
      mutationObserverAttached: false,
      smartPollingAttached: false,
      fetchPatched: false,
      xhrPatched: false,

      trackedIframes: new Set(),
      confirmedIframes: new WeakMap(),
      iframeLastUrl: new WeakMap(),

      lastMessageUuid: null,
      lastIframeUuid: null,
      lastMutationTime: 0,
      lastIframeCheck: 0,
      lastMessageTime: 0,

      lastBankId: null,
      recentBankIds: [],

      debugEnabled: false,
      debugCount: 0,
    };
  }

  const GS = window.CanvasExporter_GlobalState;

  // ==========================================================================
  // SAFE STORAGE ACCESS
  // ==========================================================================
  const storage = chrome?.storage?.local;
  const storageEvents = chrome?.storage?.onChanged;

  if (!storage) {
    console.warn("[CanvasExporter] chrome.storage unavailable in this frame (sandbox).");
  } else {
    storage.get("debug", ({ debug }) => {
      GS.debugEnabled = debug === true;
      if (GS.debugEnabled) console.log("[CanvasExporter] Debug mode ON");
    });

    storageEvents?.addListener((changes, area) => {
      if (area === "local" && changes.debug) {
        GS.debugEnabled = changes.debug.newValue === true;
        console.log("[CanvasExporter] Debug mode:", GS.debugEnabled ? "ON" : "OFF");
      }
    });
  }

  const DEBUG_MAX = 50;
  setInterval(() => (GS.debugCount = 0), 2000);

  function debug(...args) {
    if (!GS.debugEnabled) return;
    if (GS.debugCount++ < DEBUG_MAX) {
      console.log("[CanvasExporter]", ...args);
    }
  }

  function emit(eventType, detail) {
    document.dispatchEvent(new CustomEvent("CanvasExporter:" + eventType, { detail }));
    debug("Event emitted:", eventType, detail);
  }

  // ==========================================================================
  // BANK DETECTION UTILITIES
  // ==========================================================================

  const BANK_URL_REGEX = /\/api\/banks\/([0-9]+)/i;

  function extractBankIdFromUrl(url) {
    if (!url) return null;
    const m = url.match(BANK_URL_REGEX);
    return m ? m[1] : null;
  }

  function detectBankId(bankId, source) {
    if (!bankId) return;
    if (GS.lastBankId === bankId) return;

    GS.lastBankId = bankId;
    GS.recentBankIds = [bankId, ...GS.recentBankIds.filter((x) => x !== bankId)].slice(0, 10);

    console.log(`%c🏦 Bank detected: ${bankId} via ${source}`, "color:#4caf50;font-weight:bold");

    const msg = {
      type: "BANK_CONTEXT_DETECTED",
      bankId,
      source,
      timestamp: Date.now(),
    };

    emit("bankDetected", msg);
    chrome.runtime?.sendMessage(msg, () => {});
  }

  // ==========================================================================
  // FETCH INTERCEPTOR
  // ==========================================================================
  function patchFetch() {
    if (GS.fetchPatched) return;
    GS.fetchPatched = true;

    const origFetch = window.fetch;
    window.fetch = async function (...args) {
      try {
        const url = args[0]?.toString?.() || "";
        const bankId = extractBankIdFromUrl(url);
        if (bankId) detectBankId(bankId, "fetch");
      } catch (e) {
        debug("Fetch sniff error:", e);
      }

      return origFetch.apply(this, args);
    };

    console.log("[CanvasExporter] fetch() patched");
  }

  // ==========================================================================
  // XHR INTERCEPTOR
  // ==========================================================================
  function patchXHR() {
    if (GS.xhrPatched) return;
    GS.xhrPatched = true;

    const origOpen = XMLHttpRequest.prototype.open;

    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
      try {
        const bankId = extractBankIdFromUrl(url);
        if (bankId) detectBankId(bankId, "xhr");
      } catch (e) {
        debug("XHR sniff error:", e);
      }
      return origOpen.call(this, method, url, ...rest);
    };

    console.log("[CanvasExporter] XHR patched");
  }

  // ==========================================================================
  // IFRAMES (Fallback Learnosity / older Canvas flows)
  // ==========================================================================
  function isQuizLtiUrl(url) {
    try {
      if (!url || url.startsWith("blob:")) return false;
      return new URL(url).hostname.includes("quiz-lti");
    } catch {
      return false;
    }
  }

  function getIframeHref(iframe) {
    try {
      return iframe.contentWindow?.location?.href || null;
    } catch {
      return null;
    }
  }

  function processIframe(iframe) {
    const now = Date.now();
    if (now - GS.lastIframeCheck < 250) return;
    GS.lastIframeCheck = now;

    const url = getIframeHref(iframe) || iframe.src;
    if (!url) return;

    if (!isQuizLtiUrl(url)) return;

    const bankId = extractBankIdFromUrl(url);
    if (bankId) detectBankId(bankId, "iframe:url");
  }

  function handleIframe(iframe) {
    if (GS.trackedIframes.has(iframe)) return;
    GS.trackedIframes.add(iframe);

    debug("New iframe detected:", iframe.src);

    iframe.addEventListener("load", () => {
      setTimeout(() => processIframe(iframe), 50);
    });

    setTimeout(() => processIframe(iframe), 50);
  }

  function scanForIframes() {
    const iframes = document.querySelectorAll("iframe");
    console.log(`[CanvasExporter] Initial iframe scan: ${iframes.length} found`);
    iframes.forEach(handleIframe);
  }

  // ==========================================================================
  // MUTATION OBSERVER
  // ==========================================================================
  function attachMutationObserver() {
    if (GS.mutationObserverAttached) return;
    GS.mutationObserverAttached = true;

    if (!document.body) {
      console.warn("[CanvasExporter] document.body missing during observer init");
      return;
    }

    const obs = new MutationObserver((mutations) => {
      const now = performance.now();
      if (now - GS.lastMutationTime < 20) return;
      GS.lastMutationTime = now;

      for (const mut of mutations) {
        if (mut.type === "childList") {
          mut.addedNodes.forEach((node) => {
            if (node.nodeType !== Node.ELEMENT_NODE) return;
            if (node.nodeName === "IFRAME") handleIframe(node);
            else node.querySelectorAll?.("iframe").forEach(handleIframe);
          });
        }
      }
    });

    obs.observe(document.body, {
      childList: true,
      subtree: true,
    });

    console.log("[CanvasExporter] MutationObserver attached");
  }

  // ==========================================================================
  // SMART POLLING (iframe fallback)
  // ==========================================================================
  function attachSmartPolling() {
    if (GS.smartPollingAttached) return;
    GS.smartPollingAttached = true;

    setInterval(() => {
      GS.trackedIframes.forEach((iframe) => {
        if (!document.contains(iframe)) return;
        processIframe(iframe);
      });
    }, 1000);

    console.log("[CanvasExporter] Smart polling enabled");
  }

  // ==========================================================================
  // INITIALIZATION
  // ==========================================================================
  console.log("%c[CanvasExporter] Initialization starting…", "color:#03a9f4;font-weight:bold");

  patchFetch();
  patchXHR();

  setTimeout(() => {
    scanForIframes();
    attachMutationObserver();
  }, 50);

  setTimeout(() => {
    attachSmartPolling();
  }, 150);
})();
