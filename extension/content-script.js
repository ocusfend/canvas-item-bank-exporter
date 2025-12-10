// ===============================================================
// Canvas New Quizzes Item Bank Exporter — Content Script
// Phase 3.3.1 — Hardened observer, unified hydration, no dev-tool errors
// ===============================================================

// ---------------------------------------------------------------
// SINGLE-LOAD GUARD (Final Version — no partial init ever)
// ---------------------------------------------------------------
if (window.__CanvasExporterLoaded === true) {
  console.log("[CanvasExporter] Already loaded → skipping");
  // HARD EXIT — prevents double listeners, double observers, partial init
  return;
}

// First time load
window.__CanvasExporterLoaded = true;
console.log("[CanvasExporter] Content script loaded (Phase 3.3.1)");


// ---------------------------------------------------------------
// DEBUG SYSTEM
// ---------------------------------------------------------------
let DEBUG_ENABLED = false;
const DEBUG_MAX = 50;
let debugCount = 0;

chrome.storage.local.get("debug", (result) => {
  DEBUG_ENABLED = result.debug === true;
  if (DEBUG_ENABLED) console.log("[CanvasExporter] Debug mode: ON");
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.debug) {
    DEBUG_ENABLED = changes.debug.newValue === true;
    console.log("[CanvasExporter] Debug mode:", DEBUG_ENABLED ? "ON" : "OFF");
  }
});

// Reset debug suppression every 2 seconds
setInterval(() => (debugCount = 0), 2000);

function debugLog(...args) {
  if (!DEBUG_ENABLED) return;
  if (debugCount < DEBUG_MAX) {
    debugCount++;
    console.log("[CanvasExporter]", ...args);
  }
}

function debugGroup(label, fn) {
  if (!DEBUG_ENABLED) {
    fn();
    return;
  }
  if (debugCount < DEBUG_MAX) {
    debugCount++;
    console.groupCollapsed("[CanvasExporter] " + label);
    try {
      fn();
    } finally {
      console.groupEnd();
    }
  } else {
    fn();
  }
}


// ---------------------------------------------------------------
// INTERNAL EVENT EMITTER
// ---------------------------------------------------------------
function emit(eventType, detail) {
  document.dispatchEvent(
    new CustomEvent("CanvasExporter:" + eventType, { detail })
  );
  debugLog("Event emitted:", eventType, detail);
}


// ---------------------------------------------------------------
// LEARNOSITY + UUID DETECTION UTILITIES
// ---------------------------------------------------------------
function hasLearnosityFingerprint(data) {
  if (!data || typeof data !== "object") return false;
  const keys = Object.keys(data);
  const fp = ["activity_id", "session_id", "user_id", "type", "meta", "resource_id"];
  return keys.filter(k => fp.includes(k)).length >= 2;
}

function findAnyUuidDeep(obj) {
  if (!obj) return null;
  try {
    const json = JSON.stringify(obj);
    const rx = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
    const m = json.match(rx);
    return m ? m[1].toLowerCase() : null;
  } catch {
    return null;
  }
}

function findBankUuid(obj) {
  if (!obj) return null;

  const patterns = [
    /bank[_/:]([0-9a-f-]{36})/i,
    /"bankId"\s*:\s*"([0-9a-f-]{36})"/i,
    /"bank_id"\s*:\s*"([0-9a-f-]{36})"/i,
    /"resource_id"\s*:\s*"([0-9a-f-]{36})"/i,
    /"activity_id"\s*:\s*"([0-9a-f-]{36})"/i
  ];

  try {
    const json = JSON.stringify(obj);
    for (const p of patterns) {
      const m = json.match(p);
      if (m) return m[1].toLowerCase();
    }
  } catch {}

  return findAnyUuidDeep(obj);
}


// ---------------------------------------------------------------
// POSTMESSAGE CLASSIFIER
// ---------------------------------------------------------------
function classifyMessage(event) {
  if (event.origin === "null") return null;
  if (!event.data || typeof event.data !== "object") return null;

  let data = event.data;

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

  const isCanvas =
    hostname === "instructure.com" || hostname.endsWith(".instructure.com");

  const isPMF =
    hostname.endsWith(".canvaslms.com") ||
    hostname.endsWith(".cloudfront.net") ||
    hostname.endsWith(".lrn.io");

  const hasLearnosityShape =
    hasLearnosityFingerprint(data) ||
    hasLearnosityFingerprint(data.data) ||
    (() => {
      try {
        const json = JSON.stringify(data);
        return (
          json.includes("learnosity") ||
          json.includes("resource_id") ||
          json.includes("activity_id")
        );
      } catch {
        return false;
      }
    })();

  return { isCanvas, isPMF, hasLearnosityShape, data };
}


// ---------------------------------------------------------------
// UUID STATE MANAGEMENT
// ---------------------------------------------------------------
let lastMessageUuid = null;
let lastIframeUuid = null;
const MAX_RECENT = 10;
let recentBanks = [];

function trackRecent(uuid) {
  recentBanks = recentBanks.filter(u => u !== uuid);
  recentBanks.unshift(uuid);
  recentBanks = recentBanks.slice(0, MAX_RECENT);
  return true;
}


// ---------------------------------------------------------------
// IFRAME UTILITIES
// ---------------------------------------------------------------
const trackedIframes = [];
const iframeLastUrl = new WeakMap();
const confirmedIframes = new WeakMap();

function verifyIframe(iframe) {
  if (!confirmedIframes.get(iframe)) {
    confirmedIframes.set(iframe, true);
    debugLog("Verified iframe:", iframe.src);
  }
}

function isQuizLtiUrl(url) {
  try {
    if (!url || url.startsWith("blob:")) return false;
    const host = new URL(url).hostname;
    return host.includes("quiz-lti") && host.endsWith(".instructure.com");
  } catch {
    return false;
  }
}

function getInternalIframeUrl(iframe) {
  try {
    const href = iframe.contentWindow?.location?.href;
    if (!href || href === "about:blank") return null;
    return href;
  } catch {
    return null;
  }
}

function extractBankIdFromQuizLtiUrl(url) {
  if (!url.includes("quiz-lti")) return null;
  const patterns = [
    /\/banks\/([^/?#]+)/i,
    /\/bank_entries\/([^/?#]+)/i,
    /\/build\/([0-9]+)/i
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m && m[1]) return m[1].toLowerCase();
  }
  return null;
}


// ---------------------------------------------------------------
// HANDLE IFRAME CHANGES
// ---------------------------------------------------------------
let lastIframeCheck = 0;

function safeProcessIframe(iframe) {
  const now = Date.now();
  if (now - lastIframeCheck < 200) return;
  lastIframeCheck = now;
  processIframe(iframe);
}

function processIframe(iframe) {
  const url = getInternalIframeUrl(iframe) || iframe.src;
  if (!url || !isQuizLtiUrl(url)) return;

  if (iframeLastUrl.get(iframe) === url) return;
  iframeLastUrl.set(iframe, url);

  debugGroup("Iframe URL change", () => {
    const uuid = extractBankIdFromQuizLtiUrl(url);
    if (!uuid) return;

    if (lastIframeUuid === uuid) return;
    lastIframeUuid = uuid;

    trackRecent(uuid);

    const msg = {
      type: "BANK_CONTEXT_DETECTED",
      source: "iframe",
      mode: "url",
      uuid,
      iframeUrl: url,
      timestamp: Date.now()
    };

    emit("bankDetected", msg);
    chrome.runtime.sendMessage(msg);
  });
}

function handleIframe(iframe) {
  if (trackedIframes.includes(iframe)) return;
  trackedIframes.push(iframe);

  setTimeout(() => {
    if (document.contains(iframe)) verifyIframe(iframe);
  }, 100);

  iframe.addEventListener("load", () => {
    verifyIframe(iframe);
    setTimeout(() => safeProcessIframe(iframe), 50);
  });

  setTimeout(() => safeProcessIframe(iframe), 50);
}


// ---------------------------------------------------------------
// BODY WAITER (Full Safety)
// ---------------------------------------------------------------
function waitForBody(callback, retries = 100) {
  const body = document.body;
  if (body && body.nodeType === Node.ELEMENT_NODE) {
    callback();
    return;
  }
  if (retries <= 0) {
    console.error("[CanvasExporter] document.body never became available");
    return;
  }
  setTimeout(() => waitForBody(callback, retries - 1), 50);
}


// ---------------------------------------------------------------
// MUTATION OBSERVER (Hardened — no errors ever)
// ---------------------------------------------------------------
function setupObserver() {
  const body = document.body;
  if (!body || body.nodeType !== Node.ELEMENT_NODE) {
    console.error("[CanvasExporter] Observer aborted — invalid body");
    return;
  }

  const obs = new MutationObserver((mutations) => {
    for (const m of mutations) {
      // CHILD LIST
      if (m.type === "childList") {
        m.addedNodes.forEach((node) => {
          if (!node || node.nodeType !== Node.ELEMENT_NODE) return;

          if (node.nodeName === "IFRAME") {
            handleIframe(node);
            return;
          }

          if (node.querySelectorAll) {
            node.querySelectorAll("iframe").forEach(handleIframe);
          }
        });
      }

      // ATTRIBUTE CHANGES
      if (m.type === "attributes") {
        const target = m.target;
        if (!target || target.nodeType !== Node.ELEMENT_NODE) continue;

        if (target.nodeName === "IFRAME") {
          safeProcessIframe(target);
        }
      }
    }
  });

  obs.observe(body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["src", "srcdoc"]
  });

  debugLog("MutationObserver started");
}


// ---------------------------------------------------------------
// POSTMESSAGE LISTENER
// ---------------------------------------------------------------
function setupPostMessage() {
  let lastMsgTime = 0;

  window.addEventListener("message", (event) => {
    const now = performance.now();
    if (now - lastMsgTime < 25) return;
    lastMsgTime = now;

    const m = classifyMessage(event);
    if (!m) return;

    if (!m.isCanvas && !m.isPMF) return;

    const payload = m.data;

    const uuid =
      findBankUuid(payload) ||
      findBankUuid(payload.data) ||
      findBankUuid(payload._unpacked);

    if (!uuid) return;

    if (uuid === lastMessageUuid) return;
    lastMessageUuid = uuid;

    trackRecent(uuid);

    const msg = {
      type: "BANK_CONTEXT_DETECTED",
      source: m.isPMF ? "pmf" : "postMessage",
      mode: "payload",
      uuid,
      origin: event.origin,
      rawMessage: payload,
      timestamp: Date.now()
    };

    emit("bankDetected", msg);
    chrome.runtime.sendMessage(msg);
  });

  debugLog("postMessage listener started");
}


// ---------------------------------------------------------------
// UNIFIED HYDRATION BOOTSTRAP (no race conditions)
// ---------------------------------------------------------------
function start() {
  setupPostMessage();

  waitForBody(() => {
    debugLog("Body ready → starting observer and iframe scan");
    setupObserver();

    // Initial iframe scan AFTER observer starts
    document.querySelectorAll("iframe").forEach(handleIframe);
  });
}

start();
