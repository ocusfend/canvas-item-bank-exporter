// Canvas New Quizzes Item Bank Exporter - Content Script
// Phase 3.2 - Pure Canvas-visible signal detection

// ============================================
// DEBUG UTILITIES WITH THROTTLING
// Refinement #2: Throttle to 50 messages per 5 seconds
// ============================================

const DEBUG = true;
let debugCount = 0;

// Reset debug count every 5 seconds to prevent console flooding
setInterval(() => { debugCount = 0; }, 5000);

function debugLog(...args) {
  if (DEBUG && debugCount < 50) {
    debugCount++;
    console.log("[CanvasExporter]", ...args);
  }
}

function debugGroup(label, fn) {
  if (DEBUG && debugCount < 50) {
    debugCount++;
    console.group(`[CanvasExporter] ${label}`);
    try {
      fn();
    } finally {
      console.groupEnd();
    }
  } else {
    // Still execute fn, just don't log
    fn();
  }
}

// ============================================
// URL UTILITIES
// ============================================

/**
 * Check if URL is a quiz-lti URL
 * Refinement #9: try/catch for malformed URLs (blob:, etc.)
 */
function isQuizLtiUrl(url) {
  try {
    if (!url || url.startsWith("blob:")) return false;
    const hostname = new URL(url).hostname;
    return hostname.includes("quiz-lti") && hostname.endsWith(".instructure.com");
  } catch {
    return false;
  }
}

/**
 * URL patterns that indicate bank context
 * Refinement #3: Non-greedy patterns for both numeric IDs and UUIDs
 */
const BANK_URL_PATTERNS = [
  /\/banks\/([^/?#]+)/i,
  /\/bank_entries\/([^/?#]+)/i,
  /\/bank_entries\/new/i,
  /\/build\/([0-9]+)/i
];

/**
 * Extract bank ID from URL (only for quiz-lti domains)
 * Refinement #3: Require quiz-lti domain to prevent false positives
 */
function extractBankIdFromQuizLtiUrl(url) {
  if (!url || !url.includes("quiz-lti")) return null;
  
  for (const pattern of BANK_URL_PATTERNS) {
    const match = url.match(pattern);
    if (match && match[1]) {
      return match[1].toLowerCase();
    }
  }
  
  return null;
}

/**
 * Safely get the internal iframe URL (contentWindow.location.href)
 * Returns null if cross-origin blocked or iframe not ready
 */
function getInternalIframeUrl(iframe) {
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

// ============================================
// MESSAGE CLASSIFICATION
// Phase 3.2: Unified classifier for Canvas/PMF/Learnosity
// ============================================

/**
 * Classify incoming postMessage by origin type
 * Refinement #1: Unpack nested JSON strings
 * Refinement #4: Guard against null origin
 */
function classifyMessage(event) {
  // Refinement #4: Explicitly ignore null origin
  if (event.origin === "null") {
    debugLog("Ignoring null-origin postMessage");
    return null;
  }

  let data = event.data;
  if (!data || typeof data !== "object") return null;

  // Refinement #1: Unpack nested JSON strings
  if (typeof data.message === "string" && data.message.trim().startsWith("{")) {
    try {
      data._unpacked = JSON.parse(data.message);
    } catch (_) {}
  }

  const origin = event.origin || "";
  let hostname = "";
  
  try {
    hostname = new URL(origin).hostname;
  } catch {
    return null;
  }

  // Canvas origins (strict .endsWith validation)
  const isCanvas = hostname === "instructure.com" || hostname.endsWith(".instructure.com");

  // post_message_forwarding origins (including lrn.io for Learnosity CDN)
  const isPMF = 
    hostname.endsWith(".canvaslms.com") || 
    hostname.endsWith(".cloudfront.net") ||
    hostname.endsWith(".lrn.io");

  // Detect Learnosity-shaped payloads
  const hasLearnosityShape = (() => {
    try {
      const json = JSON.stringify(data);
      return (
        json.includes("learnosity") ||
        json.includes("resource_id") ||
        json.includes("activity_id") ||
        json.includes("session_id") ||
        json.includes("activity.")
      );
    } catch {
      return false;
    }
  })();

  return {
    isCanvas,
    isPMF,
    hasLearnosityShape,
    data
  };
}

// ============================================
// UUID EXTRACTION
// Phase 3.2: Bank-specific patterns with lowercase normalization
// ============================================

/**
 * Find any UUID deep in an object structure
 * Returns lowercase-normalized UUID
 */
function findAnyUuidDeep(obj) {
  if (!obj) return null;

  const UUID = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

  try {
    const json = JSON.stringify(obj);
    const match = json.match(UUID);
    return match ? match[1].toLowerCase() : null;
  } catch {
    return null;
  }
}

/**
 * Find bank-specific UUID using common patterns
 * Returns lowercase-normalized UUID
 */
function findBankUuid(obj) {
  if (!obj) return null;
  
  const patterns = [
    /bank[_/:]([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
    /"bankId"\s*:\s*"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"/i,
    /"bank_id"\s*:\s*"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"/i,
    /"resource_id"\s*:\s*"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"/i,
    /"activity_id"\s*:\s*"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"/i
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

// ============================================
// STATE MANAGEMENT
// Phase 3.2: Separate dedupe pools + LRU tracking
// ============================================

// Refinement #5: Separate dedupe pools for different signal sources
let lastIframeUuid = null;
let lastMessageUuid = null;

// Refinement #6: Debounce for iframe processing
let lastIframeCheck = 0;

// Refinement #8: LRU Map for recent bank tracking
const MAX_RECENT_BANKS = 10;
const recentBanks = new Map();

// Track iframes for polling
const iframeLastUrl = new WeakMap();
const trackedIframes = [];

/**
 * Track recent bank UUID with LRU eviction
 * Returns true if this is a new bank
 */
function trackRecentBankUuid(uuid) {
  const isNew = !recentBanks.has(uuid);
  
  // LRU bump: delete and re-add to move to end
  if (recentBanks.has(uuid)) {
    recentBanks.delete(uuid);
  }
  recentBanks.set(uuid, Date.now());
  
  // Evict oldest entries
  while (recentBanks.size > MAX_RECENT_BANKS) {
    const oldest = [...recentBanks.keys()][0];
    recentBanks.delete(oldest);
  }
  
  return isNew;
}

// ============================================
// IFRAME URL DETECTION (Signal A)
// ============================================

/**
 * Debounced iframe processing (200ms throttle)
 * Refinement #6: Reduces console spam during rapid mutations
 */
function safeProcessIframe(iframe) {
  const now = Date.now();
  if (now - lastIframeCheck < 200) return;
  lastIframeCheck = now;
  processIframe(iframe);
}

/**
 * Handle iframe URL changes and extract bank context
 * Refinement #5: Uses separate dedupe pool for iframe signals
 * Refinement #6: Adds mode field
 */
function handleIframeUrlChange(iframe, url) {
  if (!url || !isQuizLtiUrl(url)) return;
  
  // Dedup on exact URL match
  if (iframeLastUrl.get(iframe) === url) return;
  iframeLastUrl.set(iframe, url);
  
  debugGroup("Iframe URL change detected", () => {
    debugLog("URL:", url);
    
    const uuid = extractBankIdFromQuizLtiUrl(url);
    
    if (!uuid) {
      debugLog("No bank ID in URL");
      return;
    }
    
    debugLog("Extracted UUID:", uuid);
    
    // Refinement #5: Use separate dedupe pool for iframe signals
    if (lastIframeUuid === uuid) {
      debugLog("Duplicate iframe UUID → ignoring");
      return;
    }
    lastIframeUuid = uuid;
    
    const isNew = trackRecentBankUuid(uuid);
    debugLog("New bank:", isNew);
    
    // Refinement #6: Add mode field
    chrome.runtime.sendMessage({
      type: "BANK_CONTEXT_DETECTED",
      source: "iframe",
      mode: "url",
      uuid: uuid,
      iframeUrl: url,
      timestamp: Date.now()
    }, (response) => {
      if (chrome.runtime.lastError) {
        debugLog("Runtime error:", chrome.runtime.lastError.message);
        return;
      }
      debugLog("Forwarded to background ✓");
    });
  });
}

/**
 * Process an iframe: try internal URL first, fall back to src
 */
function processIframe(iframe) {
  const internalUrl = getInternalIframeUrl(iframe);
  const currentUrl = internalUrl || iframe.src;
  
  if (currentUrl) {
    handleIframeUrlChange(iframe, currentUrl);
  }
}

/**
 * Handle an iframe: track it and attach load listener
 * Refinement #7: 50ms delay for src to stabilize
 */
function handleIframe(iframe) {
  if (trackedIframes.includes(iframe)) {
    return;
  }
  
  debugGroup("Iframe detected", () => {
    debugLog("src:", iframe.src || "(empty)");
  });
  
  trackedIframes.push(iframe);
  
  iframe.addEventListener("load", () => {
    debugLog("Iframe load event fired");
    // Refinement #7: 50ms delay for src to stabilize
    setTimeout(() => safeProcessIframe(iframe), 50);
  });
  
  // Refinement #7: 50ms initial delay
  setTimeout(() => safeProcessIframe(iframe), 50);
}

/**
 * Scan DOM for existing iframes
 */
function scanForIframes() {
  debugGroup("Initial iframe scan", () => {
    const iframes = document.querySelectorAll("iframe");
    debugLog(`Found ${iframes.length} existing iframe(s)`);
    
    iframes.forEach((iframe) => {
      handleIframe(iframe);
    });
  });
}

/**
 * Setup MutationObserver for dynamic iframe detection
 */
function setupObserver() {
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      try {
        // Check for added nodes (new iframes)
        if (mutation.type === "childList") {
          mutation.addedNodes.forEach((node) => {
            if (node.nodeName === "IFRAME") {
              handleIframe(node);
            }
            if (node.querySelectorAll) {
              node.querySelectorAll("iframe").forEach(handleIframe);
            }
          });
        }
        
        // Check for attribute changes on iframes (src changes)
        if (mutation.type === "attributes" && mutation.target.nodeName === "IFRAME") {
          const iframe = mutation.target;
          debugLog("Iframe attribute changed:", mutation.attributeName);
          setTimeout(() => safeProcessIframe(iframe), 50);
        }
      } catch (err) {
        debugLog("Observer error:", err);
      }
    }
  });
  
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["src", "srcdoc"]
  });
  
  debugLog("MutationObserver started");
}

/**
 * Setup polling to detect internal iframe navigation (SPA changes)
 */
function setupPolling() {
  setInterval(() => {
    trackedIframes.forEach((iframe) => {
      if (!document.contains(iframe)) return;
      
      const url = getInternalIframeUrl(iframe);
      if (!url) return;
      
      if (iframeLastUrl.get(iframe) === url) return;
      
      debugLog("Polling detected URL change:", url);
      handleIframeUrlChange(iframe, url);
    });
  }, 1000);
  
  debugLog("Polling started (1s interval)");
}

// ============================================
// POSTMESSAGE LISTENER (Signals B & C)
// Phase 3.2: Unified router with classifier
// ============================================

function setupPostMessageListener() {
  window.addEventListener("message", (event) => {
    if (DEBUG && debugCount < 50) {
      console.groupCollapsed("[CanvasExporter] postMessage received");
    }
    
    try {
      // Ignore self-messages from top window
      if (event.source === window && window.top === window) {
        debugLog("Ignoring top-window self-message");
        return;
      }
      
      // Classify the message
      const m = classifyMessage(event);
      
      if (!m) {
        debugLog("Classifier returned null → ignoring");
        return;
      }
      
      debugLog("Origin:", event.origin);
      debugLog("Is Canvas:", m.isCanvas);
      debugLog("Is PMF:", m.isPMF);
      debugLog("Has Learnosity shape:", m.hasLearnosityShape);
      
      // Only accept Canvas or PMF origins
      if (!m.isCanvas && !m.isPMF) {
        debugLog("Ignoring – unknown or untrusted origin");
        return;
      }
      
      const payload = m.data;
      
      // Refinement #1: Check _unpacked payload too
      const uuid = 
        findBankUuid(payload) ||
        findBankUuid(payload?.data) ||
        findBankUuid(payload?._unpacked) ||
        null;
      
      if (!uuid) {
        debugLog("No UUID found → ignoring");
        return;
      }
      
      debugLog("Extracted UUID:", uuid);
      
      // Refinement #5: Use separate dedupe pool for message signals
      if (lastMessageUuid === uuid) {
        debugLog("Duplicate message UUID → ignoring");
        return;
      }
      lastMessageUuid = uuid;
      
      const isNew = trackRecentBankUuid(uuid);
      debugLog("New bank:", isNew);
      debugLog("Recent banks:", [...recentBanks.keys()]);
      
      // Refinement #6: Add mode field
      chrome.runtime.sendMessage({
        type: "BANK_CONTEXT_DETECTED",
        source: m.isPMF ? "pmf" : "postMessage",
        mode: "payload",
        uuid: uuid,
        origin: event.origin,
        rawMessage: payload,
        timestamp: Date.now()
      }, (res) => {
        if (chrome.runtime.lastError) {
          debugLog("Runtime error:", chrome.runtime.lastError.message);
        } else {
          debugLog("Forwarded:", res);
        }
      });
      
    } finally {
      if (DEBUG && debugCount < 50) {
        console.groupEnd();
      }
    }
  });
  
  debugLog("postMessage listener started (Phase 3.2)");
}

// ============================================
// INITIALIZATION
// ============================================

debugLog("Content script loaded on:", window.location.href);
debugLog("Phase 3.2 - Pure Canvas-visible signal detection");

// Setup postMessage listener FIRST to catch early messages
setupPostMessageListener();

// Initial scan for existing iframes
scanForIframes();

// Setup MutationObserver for dynamic detection
setupObserver();

// Setup polling for internal iframe navigation
setupPolling();
