// ============================================================================
// Canvas New Quizzes Item Bank Exporter — Phase 3.3.1
// FULLY IDEMPOTENT VERSION — SAFE TO RUN MULTIPLE TIMES
// ============================================================================

(() => {

  // GLOBAL SINGLETON STATE (never cleared across reinjections)
  if (!window.CanvasExporter_GlobalState) {
    window.CanvasExporter_GlobalState = {
      postMessageListenerAttached: false,
      mutationObserverAttached: false,
      smartPollingAttached: false,

      // IMPORTANT FIX:
      // WeakSet cannot be iterated; replaced with Set.
      trackedIframes: new Set(),

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
  // Utility: Track last 10 seen bank UUIDs
  // ---------------------------------------------------------------------------
  function addRecentBank(uuid) {
    let arr = GS.recentBankUuids;
    arr = arr.filter(x => x !== uuid);
    arr.unshift(uuid);
    GS.recentBankUuids = arr.slice(0, 10);
  }

  // ---------------------------------------------------------------------------
  // DEBUG SYSTEM
  // ---------------------------------------------------------------------------

  const DEBUG_MAX = 50;

  chrome.storage.local.get("debug", ({ debug }) => {
    GS.debugEnabled = debug === true;
    if (GS.debugEnabled) console.log("[CanvasExporter] Debug mode ON");
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.debug) {
      GS.debugEnabled = changes.debug.newValue === true;
      console.log("[CanvasExporter] Debug:", GS.debugEnabled ? "ON" : "OFF");
    }
  });

  setInterval(() => { GS.debugCount = 0; }, 2000);

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
  // UTILITIES
  // ---------------------------------------------------------------------------

  function isQuizLtiUrl(url) {
    try {
      if (!url || url.startsWith("blob:")) return false;
      const hostname = new URL(url).hostname;
      return hostname.includes("quiz-lti") && hostname.endsWith(".instructure.com");
    } catch { return false; }
  }

  const BANK_PATTERNS = [
    /\/banks\/([^/?#]+)/i,
    /\/bank_entries\/([^/?#]+)/i,
    /\/bank_entries\/new/i,
    /\/build\/([0-9]+)/i
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
    } catch { return null; }
  }

  function hasLearnosityFingerprint(obj) {
    if (!obj || typeof obj !== "object") return false;
    const keys = Object.keys(obj);
    const fp = ["activity_id", "session_id", "user_id", "type", "meta", "resource_id"];
    return keys.filter(k => fp.includes(k)).length >= 2;
  }

  function findUuid(obj) {
    if (!obj) return null;
    const UUID = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
    try {
      const json = JSON.stringify(obj);
      const m = json.match(UUID);
      return m ? m[1].toLowerCase() : null;
    } catch { return null; }
  }

  // ---------------------------------------------------------------------------
  // POSTMESSAGE LISTENER (idempotent)
  // ---------------------------------------------------------------------------

  function classify(event) {
    if (event.origin === "null") return null;
    let data = event.data;
    if (!data || typeof data !== "object") return null;

    if (typeof data.message === "string" && data.message.trim().startsWith("{")) {
      try { data._unpacked = JSON.parse(data.message); } catch {}
    }

    let hostname = "";
    try { hostname = new URL(event.origin).hostname; }
    catch { return null; }

    const isCanvas = hostname === "instructure.com" || hostname.endsWith(".instructure.com");
    const isPMF = hostname.endsWith(".canvaslms.com") ||
                  hostname.endsWith(".cloudfront.net") ||
                  hostname.endsWith(".lrn.io");

    const json = JSON.stringify(data);
    const hasLearnosityShape =
      hasLearnosityFingerprint(data) ||
      hasLearnosityFingerprint(data.data) ||
      hasLearnosityFingerprint(data._unpacked) ||
      json.includes("learnosity") ||
      json.includes("resource_id") ||
      json.includes("activity_id") ||
      json.includes("session_id");

    return { isCanvas, isPMF, data, hasLearnosityShape };
  }

  function attachPostMessageListener() {
    if (GS.postMessageListenerAttached) return;
    GS.postMessageListenerAttached = true;

    window.addEventListener("message", (event) => {
      const now = performance.now();
      if (now - GS.lastMessageTime < 25) return;
      GS.lastMessageTime = now;

      const m = classify(event);
      if (!m) return;

      debug("postMessage:", event.origin, m.hasLearnosityShape);

      if (!m.isCanvas && !m.isPMF) return;

      const payload = m.data;
      const uuid =
        findUuid(payload) ||
        findUuid(payload.data) ||
        findUuid(payload._unpacked);

      if (!uuid) return;

      if (GS.lastMessageUuid === uuid) return;
      GS.lastMessageUuid = uuid;

      addRecentBank(uuid);
      debug("UUID via postMessage:", uuid);

      const msg = {
        type: "BANK_CONTEXT_DETECTED",
        source: m.isPMF ? "pmf" : "postMessage",
        mode: "payload",
        uuid,
        origin: event.origin,
        timestamp: Date.now()
      };

      emit("bankDetected", msg);
      chrome.runtime.sendMessage(msg, () => {});
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

    debug("Iframe URL change:", url);

    const uuid = extractBankFromUrl(url);
    if (!uuid) return;

    if (GS.lastIframeUuid === uuid) return;
    GS.lastIframeUuid = uuid;

    addRecentBank(uuid);

    const msg = {
      type: "BANK_CONTEXT_DETECTED",
      source: "iframe",
      mode: "url",
      uuid,
      iframeUrl: url,
      timestamp: Date.now()
    };

    emit("bankDetected", msg);
    chrome.runtime.sendMessage(msg, () => {});
  }

  function handleIframe(iframe) {
    if (GS.trackedIframes.has(iframe)) return;
    GS.trackedIframes.add(iframe);

    debug("Iframe discovered:", iframe.src);

    setTimeout(() => {
      if (document.contains(iframe) && (iframe.src || getIframeHref(iframe))) {
        verifyIframe(iframe);
      }
    }, 100);

    iframe.addEventListener("load", () => {
      debug("Iframe load event");
      verifyIframe(iframe);
      setTimeout(() => processIframe(iframe), 50);
    });

    setTimeout(() => processIframe(iframe), 50);
  }

  function scanForIframes() {
    const iframes = document.querySelectorAll("iframe");
    debug(`Initial iframe scan: ${iframes.length}`);
    iframes.forEach(handleIframe);
  }

  // ---------------------------------------------------------------------------
  // MUTATION OBSERVER (idempotent)
  // ---------------------------------------------------------------------------

  function attachMutationObserver() {
    if (GS.mutationObserverAttached) return;
    GS.mutationObserverAttached = true;

    const observer = new MutationObserver((mutations) => {
      const now = performance.now();
      if (now - GS.lastMutationTime < 10) return;
      GS.lastMutationTime = now;

      for (const mut of mutations) {
        try {
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
            debug("Iframe attribute changed:", mut.attributeName);
            setTimeout(() => processIframe(mut.target), 50);
          }
        } catch (err) {
          console.error("[CanvasExporter] MutationObserver error:", err);
        }
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["src", "srcdoc"]
    });

    debug("MutationObserver attached");
  }

  // ---------------------------------------------------------------------------
  // SMART POLLING — FIXED (Set iteration works)
  // ---------------------------------------------------------------------------

  function attachSmartPolling() {
    if (GS.smartPollingAttached) return;
    GS.smartPollingAttached = true;

    setInterval(() => {
      for (const iframe of GS.trackedIframes) {
        if (!document.contains(iframe)) continue;
        if (!GS.confirmedIframes.get(iframe)) continue;

        const url = getIframeHref(iframe);
        if (!url) continue;

        if (GS.iframeLastUrl.get(iframe) === url) continue;

        debug("Polling → iframe URL changed:", url);
        processIframe(iframe);
      }
    }, 1000);

    debug("Smart polling enabled");
  }

  // ---------------------------------------------------------------------------
  // INITIALIZATION
  // ---------------------------------------------------------------------------

  debug("Content script loaded (Phase 3.3.1)");

  attachPostMessageListener();

  setTimeout(() => {
    scanForIframes();
    if (document.body) attachMutationObserver();
  }, 75);

  setTimeout(() => {
    attachSmartPolling();
  }, 150);

})();
