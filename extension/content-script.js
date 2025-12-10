// ============================================================================
// Canvas New Quizzes Item Bank Exporter — Phase 3.3.2
// FULLY IDEMPOTENT + SANDBOX-SAFE (NO chrome.* CRASHES)
// ============================================================================

(() => {
  console.log("%c[CanvasExporter] Content script booting…", "color:#9c27b0;font-weight:bold");

  // ---------------------------------------------------------------------------
  // GLOBAL SINGLETON STATE (never cleared across reinjections)
  // ---------------------------------------------------------------------------
  if (!window.CanvasExporter_GlobalState) {
    window.CanvasExporter_GlobalState = {
      postMessageListenerAttached: false,
      mutationObserverAttached: false,
      smartPollingAttached: false,

      trackedIframes: new Set(), // FIX: Set, not WeakSet
      confirmedIframes: new WeakMap(),
      iframeLastUrl: new WeakMap(),

      lastMessageUuid: null,
      lastIframeUuid: null,
      lastIframeCheck: 0,
      lastMutationTime: 0,
      lastMessageTime: 0,

      recentBankUuids: [],

      debugEnabled: false,
      debugCount: 0,
    };
  }

  const GS = window.CanvasExporter_GlobalState;

  // ---------------------------------------------------------------------------
  // SAFE STORAGE ACCESS (Chrome API unavailable inside sandboxed LTI iframes)
  // ---------------------------------------------------------------------------

  const storage = chrome?.storage?.local;
  const storageEvents = chrome?.storage?.onChanged;

  if (!storage) {
    console.warn(
      "[CanvasExporter] chrome.storage API unavailable in this frame (Canvas sandbox). Debug toggle disabled here.",
    );
  }

  // Debug configuration --------------------------------------------------------
  const DEBUG_MAX = 50;

  if (storage) {
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

  setInterval(() => {
    GS.debugCount = 0;
  }, 2000);

  function debug(...args) {
    if (!GS.debugEnabled) return;
    if (GS.debugCount < DEBUG_MAX) {
      GS.debugCount++;
      console.log("[CanvasExporter]", ...args);
    }
  }

  function emit(eventType, detail) {
    document.dispatchEvent(new CustomEvent("CanvasExporter:" + eventType, { detail }));
    debug("Event emitted:", eventType, detail);
  }

  // ---------------------------------------------------------------------------
  // URL UTILITIES
  // ---------------------------------------------------------------------------

  function isQuizLtiUrl(url) {
    try {
      if (!url || url.startsWith("blob:")) return false;
      const hostname = new URL(url).hostname;
      return hostname.includes("quiz-lti") && hostname.endsWith(".instructure.com");
    } catch {
      return false;
    }
  }

  const BANK_PATTERNS = [
    /\/banks\/([^/?#]+)/i,
    /\/bank_entries\/([^/?#]+)/i,
    /\/bank_entries\/new/i,
    /\/build\/([0-9]+)/i,
  ];

  function extractBankFromUrl(url) {
    if (!url || !url.includes("quiz-lti")) return null;
    for (const p of BANK_PATTERNS) {
      const m = url.match(p);
      if (m && m[1]) return m[1].toLowerCase();
    }
    return null;
  }

  function getIframeHref(iframe) {
    try {
      const win = iframe.contentWindow;
      if (!win) return null;
      const href = win.location?.href;
      if (!href || href === "about:blank") return null;
      return href;
    } catch {
      return null;
    }
  }

  function findUuid(obj) {
    if (!obj) return null;
    const UUID = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
    try {
      const json = JSON.stringify(obj);
      const m = json.match(UUID);
      return m ? m[1].toLowerCase() : null;
    } catch {
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // POSTMESSAGE LISTENER (idempotent)
  // ---------------------------------------------------------------------------

  function attachPostMessageListener() {
    if (GS.postMessageListenerAttached) return;
    GS.postMessageListenerAttached = true;

    window.addEventListener("message", (event) => {
      const now = performance.now();
      if (now - GS.lastMessageTime < 25) return; // debounce
      GS.lastMessageTime = now;

      let data = event.data;
      if (!data || typeof data !== "object") return;

      const uuid = findUuid(data) || findUuid(data?.data) || findUuid(data?._unpacked);

      if (!uuid) return;

      if (GS.lastMessageUuid === uuid) return;
      GS.lastMessageUuid = uuid;

      GS.recentBankUuids = [uuid, ...GS.recentBankUuids.filter((x) => x !== uuid)].slice(0, 10);

      debug("UUID via postMessage:", uuid);

      const msg = {
        type: "BANK_CONTEXT_DETECTED",
        source: "postMessage",
        uuid,
        timestamp: Date.now(),
      };

      emit("bankDetected", msg);
      chrome.runtime?.sendMessage(msg, () => {});
    });

    debug("postMessage listener attached");
  }

  // ---------------------------------------------------------------------------
  // IFRAME PROCESSING
  // ---------------------------------------------------------------------------

  function verifyIframe(iframe) {
    if (!GS.confirmedIframes.get(iframe)) {
      GS.confirmedIframes.set(iframe, true);
      debug("Iframe verified:", iframe.src);
    }
  }

  function processIframe(iframe) {
    const now = Date.now();
    if (now - GS.lastIframeCheck < 200) return;
    GS.lastIframeCheck = now;

    const url = getIframeHref(iframe) || iframe.src;
    if (!url) return;

    if (!isQuizLtiUrl(url)) return;

    if (GS.iframeLastUrl.get(iframe) === url) return;
    GS.iframeLastUrl.set(iframe, url);

    const uuid = extractBankFromUrl(url);
    if (!uuid) return;

    if (GS.lastIframeUuid === uuid) return;
    GS.lastIframeUuid = uuid;

    GS.recentBankUuids = [uuid, ...GS.recentBankUuids.filter((x) => x !== uuid)].slice(0, 10);

    console.log(`%c🖼️ Bank detected via iframe URL: ${uuid}`, "color:#4caf50;font-weight:bold");

    const msg = {
      type: "BANK_CONTEXT_DETECTED",
      source: "iframe",
      mode: "url",
      uuid,
      iframeUrl: url,
      timestamp: Date.now(),
    };

    emit("bankDetected", msg);
    chrome.runtime?.sendMessage(msg, () => {});
  }

  function handleIframe(iframe) {
    if (GS.trackedIframes.has(iframe)) return;
    GS.trackedIframes.add(iframe);

    debug("Iframe detected:", iframe.src);

    setTimeout(() => {
      if (document.contains(iframe) && (iframe.src || getIframeHref(iframe))) {
        verifyIframe(iframe);
      }
    }, 100);

    iframe.addEventListener("load", () => {
      verifyIframe(iframe);
      setTimeout(() => processIframe(iframe), 50);
    });

    setTimeout(() => processIframe(iframe), 50);
  }

  function scanForIframes() {
    const iframes = document.querySelectorAll("iframe");
    console.log(`[CanvasExporter] Initial iframe scan: ${iframes.length} found`);
    iframes.forEach(handleIframe);
  }

  // ---------------------------------------------------------------------------
  // MUTATION OBSERVER
  // ---------------------------------------------------------------------------

  function attachMutationObserver() {
    if (GS.mutationObserverAttached) return;
    GS.mutationObserverAttached = true;

    if (!document.body) {
      console.warn("[CanvasExporter] document.body missing at observer attach time");
      return;
    }

    const observer = new MutationObserver((mutations) => {
      const now = performance.now();
      if (now - GS.lastMutationTime < 10) return;
      GS.lastMutationTime = now;

      for (const mut of mutations) {
        if (mut.type === "childList") {
          mut.addedNodes.forEach((node) => {
            if (node.nodeType !== Node.ELEMENT_NODE) return;

            if (node.nodeName === "IFRAME") {
              handleIframe(node);
            } else if (node.querySelectorAll) {
              node.querySelectorAll("iframe").forEach(handleIframe);
            }
          });
        }

        if (mut.type === "attributes" && mut.target.nodeName === "IFRAME") {
          setTimeout(() => processIframe(mut.target), 50);
        }
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["src", "srcdoc"],
    });

    console.log("[CanvasExporter] MutationObserver attached");
  }

  // ---------------------------------------------------------------------------
  // SMART POLLING
  // ---------------------------------------------------------------------------

  function attachSmartPolling() {
    if (GS.smartPollingAttached) return;
    GS.smartPollingAttached = true;

    setInterval(() => {
      GS.trackedIframes.forEach((iframe) => {
        if (!document.contains(iframe)) return;
        if (!GS.confirmedIframes.get(iframe)) return;

        const url = getIframeHref(iframe);
        if (!url) return;

        if (GS.iframeLastUrl.get(iframe) !== url) {
          console.log("[CanvasExporter] Polling detected iframe URL change:", url);
          processIframe(iframe);
        }
      });
    }, 1000);

    console.log("[CanvasExporter] Smart polling enabled");
  }

  // ---------------------------------------------------------------------------
  // INITIALIZATION
  // ---------------------------------------------------------------------------

  console.log("%c[CanvasExporter] Initialization starting…", "color:#03a9f4;font-weight:bold");

  attachPostMessageListener();

  setTimeout(() => {
    scanForIframes();
    attachMutationObserver();
  }, 75);

  setTimeout(() => {
    attachSmartPolling();
  }, 150);
})();
