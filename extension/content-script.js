// ============================================================================
// Canvas New Quizzes Item Bank Exporter — Phase 3.3.1
// FULLY IDEMPOTENT — SAFE FOR MULTIPLE REINJECTIONS
// ============================================================================

(() => {
  // ← REAL IIFE WRAPPER START (Chrome-safe)

  // ----------------------------------------------------------------------------
  // GLOBAL SINGLETON STATE (never cleared across reinjections)
  // ----------------------------------------------------------------------------

  if (!window.CanvasExporter_GlobalState) {
    window.CanvasExporter_GlobalState = {
      postMessageListenerAttached: false,
      mutationObserverAttached: false,
      smartPollingAttached: false,

      // IMPORTANT:
      // WeakSet cannot be iterated → changed to Set()
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

  // ----------------------------------------------------------------------------
  // UTILITY: Add recent UUID with cleanup
  // ----------------------------------------------------------------------------

  function addRecentBank(uuid) {
    const arr = GS.recentBankUuids.filter((u) => u !== uuid);
    arr.unshift(uuid);
    GS.recentBankUuids = arr.slice(0, 10);
  }

  // ----------------------------------------------------------------------------
  // DEBUG SYSTEM (idempotent)
  // ----------------------------------------------------------------------------

  const DEBUG_MAX = 50;

  chrome.storage.local.get("debug", ({ debug }) => {
    GS.debugEnabled = debug === true;
    if (GS.debugEnabled) console.log("[CanvasExporter] Debug mode ON");
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.debug) {
      GS.debugEnabled = changes.debug.newValue === true;
      console.log("[CanvasExporter] Debug mode:", GS.debugEnabled);
    }
  });

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

  function emit(type, detail) {
    document.dispatchEvent(new CustomEvent("CanvasExporter:" + type, { detail }));
    debug("Event emitted:", type, detail);
  }

  // ----------------------------------------------------------------------------
  // URL + UUID UTILITIES
  // ----------------------------------------------------------------------------

  function isQuizLtiUrl(url) {
    try {
      if (!url || url.startsWith("blob:")) return false;
      const host = new URL(url).hostname;
      return host.includes("quiz-lti") && host.endsWith(".instructure.com");
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
      return href && href !== "about:blank" ? href : null;
    } catch {
      return null;
    }
  }

  function hasLearnosityFingerprint(obj) {
    if (!obj || typeof obj !== "object") return false;
    const keys = Object.keys(obj);
    const fp = ["activity_id", "session_id", "user_id", "type", "meta", "resource_id"];
    return keys.filter((k) => fp.includes(k)).length >= 2;
  }

  function findUuid(obj) {
    if (!obj) return null;
    const UUID = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
    try {
      const m = JSON.stringify(obj).match(UUID);
      return m ? m[1].toLowerCase() : null;
    } catch {
      return null;
    }
  }

  // ----------------------------------------------------------------------------
  // MESSAGE CLASSIFICATION
  // ----------------------------------------------------------------------------

  function classify(event) {
    if (event.origin === "null") return null;
    const data = event.data;
    if (!data || typeof data !== "object") return null;

    if (typeof data.message === "string" && data.message.trim().startsWith("{")) {
      try {
        data._unpacked = JSON.parse(data.message);
      } catch {}
    }

    let hostname = "";
    try {
      hostname = new URL(event.origin).hostname;
    } catch {
      return null;
    }

    const isCanvas = hostname === "instructure.com" || hostname.endsWith(".instructure.com");
    const isPMF =
      hostname.endsWith(".canvaslms.com") || hostname.endsWith(".cloudfront.net") || hostname.endsWith(".lrn.io");

    const json = JSON.stringify(data);
    const hasShape =
      hasLearnosityFingerprint(data) ||
      hasLearnosityFingerprint(data.data) ||
      hasLearnosityFingerprint(data._unpacked) ||
      json.includes("learnosity") ||
      json.includes("resource_id") ||
      json.includes("activity_id");

    return { isCanvas, isPMF, data, hasShape };
  }

  // ----------------------------------------------------------------------------
  // POSTMESSAGE LISTENER  (idempotent)
  // ----------------------------------------------------------------------------

  function attachPostMessageListener() {
    if (GS.postMessageListenerAttached) return;
    GS.postMessageListenerAttached = true;

    window.addEventListener("message", (event) => {
      const now = performance.now();
      if (now - GS.lastMessageTime < 25) return; // debounce
      GS.lastMessageTime = now;

      const m = classify(event);
      if (!m || (!m.isCanvas && !m.isPMF)) return;

      const payload = m.data;

      const uuid = findUuid(payload) || findUuid(payload.data) || findUuid(payload._unpacked);

      if (!uuid) return;

      if (GS.lastMessageUuid === uuid) return;
      GS.lastMessageUuid = uuid;

      addRecentBank(uuid);
      debug("UUID from message:", uuid);

      const msg = {
        type: "BANK_CONTEXT_DETECTED",
        source: m.isPMF ? "pmf" : "postMessage",
        mode: "payload",
        uuid,
        origin: event.origin,
        timestamp: Date.now(),
      };

      emit("bankDetected", msg);
      chrome.runtime.sendMessage(msg, () => {});
    });

    debug("postMessage listener attached");
  }

  // ----------------------------------------------------------------------------
  // IFRAME PROCESSING (idempotent)
  // ----------------------------------------------------------------------------

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
    if (!url || !isQuizLtiUrl(url)) return;

    if (GS.iframeLastUrl.get(iframe) === url) return;
    GS.iframeLastUrl.set(iframe, url);

    debug("Iframe URL changed:", url);

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
      timestamp: Date.now(),
    };

    emit("bankDetected", msg);
    chrome.runtime.sendMessage(msg, () => {});
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

    iframe.addEventListener("load", () => setTimeout(() => processIframe(iframe), 50));

    setTimeout(() => processIframe(iframe), 50);
  }

  function scanForIframes() {
    const all = document.querySelectorAll("iframe");
    debug(`Scanning ${all.length} iframes`);
    all.forEach(handleIframe);
  }

  // ----------------------------------------------------------------------------
  // MUTATION OBSERVER (idempotent)
  // ----------------------------------------------------------------------------

  function attachMutationObserver() {
    if (GS.mutationObserverAttached) return;
    GS.mutationObserverAttached = true;

    const obs = new MutationObserver((mutList) => {
      const now = performance.now();
      if (now - GS.lastMutationTime < 10) return;
      GS.lastMutationTime = now;

      for (const m of mutList) {
        try {
          if (m.type === "childList") {
            m.addedNodes.forEach((node) => {
              if (node.nodeType !== Node.ELEMENT_NODE) return;
              if (node.nodeName === "IFRAME") {
                handleIframe(node);
              } else if (node.querySelectorAll) {
                node.querySelectorAll("iframe").forEach(handleIframe);
              }
            });
          }

          if (m.type === "attributes" && m.target.nodeName === "IFRAME") {
            const iframe = m.target;
            setTimeout(() => processIframe(iframe), 50);
          }
        } catch (err) {
          console.error("[CanvasExporter] Mutation error:", err);
        }
      }
    });

    obs.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["src", "srcdoc"],
    });

    debug("MutationObserver attached");
  }

  // ----------------------------------------------------------------------------
  // SMART POLLING (idempotent)
  // ----------------------------------------------------------------------------

  function attachSmartPolling() {
    if (GS.smartPollingAttached) return;
    GS.smartPollingAttached = true;

    setInterval(() => {
      GS.trackedIframes.forEach((iframe) => {
        if (!document.contains(iframe)) return;
        if (!GS.confirmedIframes.get(iframe)) return;

        const url = getIframeHref(iframe);
        if (!url) return;

        if (GS.iframeLastUrl.get(iframe) === url) return;

        debug("Polling URL change:", url);
        processIframe(iframe);
      });
    }, 1000);

    debug("Smart polling enabled");
  }

  // ----------------------------------------------------------------------------
  // INIT
  // ----------------------------------------------------------------------------

  debug("Content script loaded (3.3.1)");

  attachPostMessageListener();

  setTimeout(() => {
    scanForIframes();
    if (document.body) attachMutationObserver();
  }, 75);

  setTimeout(() => attachSmartPolling(), 150);
})(); // ← END OF IIFE WRAPPER
