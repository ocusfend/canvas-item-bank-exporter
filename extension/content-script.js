// Canvas New Quizzes Item Bank Exporter - Content Script
// Phase 3.3 - Production-grade detection with all guards

// ============================================
// REFINEMENT #9: SINGLE-LOAD GUARD
// Prevents duplicate listeners on hot reload
// ============================================

// Normalize stale flags from previous loads (Chrome hot reload quirk)
// Using explicit undefined checks to avoid Chrome DevTools ??= parsing bug
if (window.__CanvasExporterLoaded === undefined) {
  window.__CanvasExporterLoaded = false;
}
if (window.__CanvasExporterSkip === undefined) {
  window.__CanvasExporterSkip = false;
}

// Prevent duplicate listeners on hot reload
if (window.__CanvasExporterLoaded) {
  console.log("[CanvasExporter] Already loaded, skipping duplicate init");
  window.__CanvasExporterSkip = true;
} else {
  window.__CanvasExporterLoaded = true;
  window.__CanvasExporterSkip = false;  // Required to avoid illegal return state
}

if (!window.__CanvasExporterSkip) {

// ============================================
// DEBUG SYSTEM (Dynamic Toggle)
// Refinement #1: Dynamic DEBUG_ENABLED via storage
// Refinement #5: Reset counter every 2s for better flow
// ============================================

let DEBUG_ENABLED = false;
const DEBUG_MAX = 50;
let debugCount = 0;

// Load debug preference from storage on init
chrome.storage.local.get("debug", (result) => {
  DEBUG_ENABLED = result.debug === true;
  if (DEBUG_ENABLED) console.log("[CanvasExporter] Debug mode: ON");
});

// Listen for debug toggle changes from popup
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.debug) {
    DEBUG_ENABLED = changes.debug.newValue === true;
    console.log("[CanvasExporter] Debug mode:", DEBUG_ENABLED ? "ON" : "OFF");
  }
});

// Refinement #5: Reset every 2s instead of 5s
setInterval(() => { debugCount = 0; }, 2000);

function debugLog(...args) {
  if (!DEBUG_ENABLED) return;
  if (debugCount < DEBUG_MAX) {
    debugCount++;
    console.log("[CanvasExporter]", ...args);
  }
}

// Refinement #1.2: Use groupCollapsed instead of group
function debugGroup(label, fn) {
  if (!DEBUG_ENABLED) {
    fn();
    return;
  }
  if (debugCount < DEBUG_MAX) {
    debugCount++;
    console.groupCollapsed(`[CanvasExporter] ${label}`);
    try {
      fn();
    } finally {
      console.groupEnd();
    }
  } else {
    fn();
  }
}

// ============================================
// REFINEMENT #17: INTERNAL EVENT EMISSION SYSTEM
// Centralized event dispatch for future extensibility
// ============================================

function emit(eventType, detail) {
  document.dispatchEvent(new CustomEvent("CanvasExporter:" + eventType, { detail }));
  debugLog(`Event emitted: ${eventType}`, detail);
}

// ============================================
// REFINEMENT #14: CONFIRMED-ACTIVE IFRAME MAP (CAIM)
// Prevents processing ghost/phantom iframes
// ============================================

const confirmedIframes = new WeakMap();

function verifyIframe(iframe) {
  if (!confirmedIframes.get(iframe)) {
    confirmedIframes.set(iframe, true);
    debugLog("Iframe verified active:", iframe.src || "(no src)");
  }
}

function isVerifiedIframe(iframe) {
  return confirmedIframes.get(iframe) === true;
}

// ============================================
// REFINEMENT #15: POSTMESSAGE DEBOUNCER
// Prevents burst processing during Canvas re-render cycles
// ============================================

let lastMessageTime = 0;

function shouldDebounceMessage() {
  const now = performance.now();
  if (now - lastMessageTime < 25) return true;
  lastMessageTime = now;
  return false;
}

// ============================================
// REFINEMENT #18: MUTATION LOOP GUARD
// Prevents responding to thrashing attribute changes
// ============================================

let lastMutationTime = 0;

function shouldIgnoreMutation() {
  const now = performance.now();
  if (now - lastMutationTime < 10) return true;
  lastMutationTime = now;
  return false;
}

// ============================================
// URL UTILITIES
// ============================================

function isQuizLtiUrl(url) {
  try {
    if (!url || url.startsWith("blob:")) return false;
    const hostname = new URL(url).hostname;
    return hostname.includes("quiz-lti") && hostname.endsWith(".instructure.com");
  } catch {
    return false;
  }
}

const BANK_URL_PATTERNS = [
  /\/banks\/([^/?#]+)/i,
  /\/bank_entries\/([^/?#]+)/i,
  /\/bank_entries\/new/i,
  /\/build\/([0-9]+)/i
];

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
// REFINEMENT #7: SMARTER BANK PAGE DETECTION
// Prevents premature context reset on non-quiz-lti routes
// ============================================

const BANK_URL_HINTS = [
  "quiz-lti",
  "item_banks",
  "question-banks",
  "banks"
];

function isLikelyBankPage(url) {
  return BANK_URL_HINTS.some(hint => url.includes(hint));
}

function checkAndResetBankContext() {
  if (!isLikelyBankPage(window.location.href)) {
    chrome.storage.session.remove("lastDetectedBank").catch(() => {});
    debugLog("Bank context cleared - navigated away from bank page");
  }
}

// Check on load and on history changes
checkAndResetBankContext();
window.addEventListener("popstate", checkAndResetBankContext);

// ============================================
// REFINEMENT #16: LEARNOSITY FINGERPRINT DETECTION
// Future-proof against API shape changes
// ============================================

function hasLearnosityFingerprint(data) {
  if (!data || typeof data !== "object") return false;
  const likelyKeys = ["activity_id", "session_id", "user_id", "type", "meta", "resource_id"];
  const keys = Object.keys(data);
  const matchCount = keys.filter(k => likelyKeys.includes(k)).length;
  return matchCount >= 2;
}

// ============================================
// MESSAGE CLASSIFICATION
// Phase 3.3: Enhanced with fingerprinting + anomaly detection
// ============================================

function classifyMessage(event) {
  if (event.origin === "null") {
    debugLog("Ignoring null-origin postMessage");
    return null;
  }

  let data = event.data;
  if (!data || typeof data !== "object") return null;

  // Unpack nested JSON strings
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

  const isCanvas = hostname === "instructure.com" || hostname.endsWith(".instructure.com");
  const isPMF = 
    hostname.endsWith(".canvaslms.com") || 
    hostname.endsWith(".cloudfront.net") ||
    hostname.endsWith(".lrn.io");

  // Enhanced Learnosity detection with fingerprinting
  const hasLearnosityShape = (() => {
    try {
      // Check fingerprint first (faster)
      if (hasLearnosityFingerprint(data)) return true;
      if (hasLearnosityFingerprint(data?.data)) return true;
      
      // Fall back to string matching
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

  // Refinement #3: Origin anomaly detector
  if (DEBUG_ENABLED && !isCanvas && !isPMF && hasLearnosityShape) {
    console.warn("[CanvasExporter] Suspicious Learnosity-shaped message from unexpected origin:", event.origin);
  }

  return {
    isCanvas,
    isPMF,
    hasLearnosityShape,
    data
  };
}

// ============================================
// UUID EXTRACTION
// ============================================

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
// Phase 3.3: With cleanup utilities
// ============================================

let lastIframeUuid = null;
let lastMessageUuid = null;
let lastIframeCheck = 0;

const MAX_RECENT_BANKS = 10;
let recentBankUuids = [];

const iframeLastUrl = new WeakMap();
const trackedIframes = [];

// Refinement #2: Clean recent banks (dedupe + cap)
function cleanRecentBanks() {
  recentBankUuids = [...new Set(recentBankUuids)].slice(0, MAX_RECENT_BANKS);
}

function trackRecentBankUuid(uuid) {
  const isNew = !recentBankUuids.includes(uuid);
  
  // Remove if exists (for LRU bump)
  recentBankUuids = recentBankUuids.filter(u => u !== uuid);
  
  // Add to front
  recentBankUuids.unshift(uuid);
  
  // Clean up
  cleanRecentBanks();
  
  return isNew;
}

// ============================================
// SMART POLLING (Refinement #5.2)
// Only activates when no observations for 3+ seconds
// ============================================

let lastObservationTime = Date.now();
let pollingActive = false;

function markObservation() {
  lastObservationTime = Date.now();
}

function setupSmartPolling() {
  setInterval(() => {
    const timeSinceObservation = Date.now() - lastObservationTime;
    
    if (timeSinceObservation < 3000) {
      if (pollingActive) {
        debugLog("Polling paused - recent observations detected");
        pollingActive = false;
      }
      return;
    }
    
    if (!pollingActive) {
      debugLog("Polling activated - no recent observations");
      pollingActive = true;
    }
    
    trackedIframes.forEach((iframe) => {
      if (!document.contains(iframe)) return;
      if (!isVerifiedIframe(iframe)) return;
      
      const url = getInternalIframeUrl(iframe);
      if (!url) return;
      if (iframeLastUrl.get(iframe) === url) return;
      
      debugLog("Polling detected URL change:", url);
      handleIframeUrlChange(iframe, url);
    });
  }, 1000);
  
  debugLog("Smart polling initialized (fallback mode)");
}

// ============================================
// IFRAME URL DETECTION (Signal A)
// ============================================

function safeProcessIframe(iframe) {
  const now = Date.now();
  if (now - lastIframeCheck < 200) return;
  lastIframeCheck = now;
  processIframe(iframe);
}

function handleIframeUrlChange(iframe, url) {
  if (!url || !isQuizLtiUrl(url)) return;
  
  if (iframeLastUrl.get(iframe) === url) return;
  iframeLastUrl.set(iframe, url);
  
  markObservation();
  
  debugGroup("Iframe URL change detected", () => {
    debugLog("URL:", url);
    
    const uuid = extractBankIdFromQuizLtiUrl(url);
    
    if (!uuid) {
      debugLog("No bank ID in URL");
      return;
    }
    
    debugLog("Extracted UUID:", uuid);
    
    if (lastIframeUuid === uuid) {
      debugLog("Duplicate iframe UUID → ignoring");
      return;
    }
    lastIframeUuid = uuid;
    
    const isNew = trackRecentBankUuid(uuid);
    debugLog("New bank:", isNew);
    
    const message = {
      type: "BANK_CONTEXT_DETECTED",
      source: "iframe",
      mode: "url",
      uuid: uuid,
      iframeUrl: url,
      timestamp: Date.now()
    };
    
    emit("bankDetected", message);
    
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        debugLog("Runtime error:", chrome.runtime.lastError.message);
        return;
      }
      debugLog("Forwarded to background ✓");
    });
  });
}

function processIframe(iframe) {
  const internalUrl = getInternalIframeUrl(iframe);
  const currentUrl = internalUrl || iframe.src;
  
  if (currentUrl) {
    handleIframeUrlChange(iframe, currentUrl);
  }
}

function handleIframe(iframe) {
  if (trackedIframes.includes(iframe)) return;
  
  debugGroup("Iframe detected", () => {
    debugLog("src:", iframe.src || "(empty)");
  });
  
  trackedIframes.push(iframe);
  
  // Verify after a short delay to filter ghost iframes
  setTimeout(() => {
    if (document.contains(iframe) && (iframe.src || getInternalIframeUrl(iframe))) {
      verifyIframe(iframe);
      markObservation();
    }
  }, 100);
  
  iframe.addEventListener("load", () => {
    debugLog("Iframe load event fired");
    verifyIframe(iframe);
    markObservation();
    setTimeout(() => safeProcessIframe(iframe), 50);
  });
  
  setTimeout(() => {
    if (isVerifiedIframe(iframe)) {
      safeProcessIframe(iframe);
    }
  }, 50);
}

function scanForIframes() {
  debugGroup("Initial iframe scan", () => {
    const iframes = document.querySelectorAll("iframe");
    debugLog(`Found ${iframes.length} existing iframe(s)`);
    iframes.forEach(handleIframe);
  });
}

// ============================================
// BODY WAITER (Canvas hydration safety)
// ============================================

function waitForBody(callback, retries = 40) {
  // Stronger check: body must exist AND be a valid Node
  if (document.body && document.body instanceof Node) {
    callback();
    return;
  }
  if (retries <= 0) {
    console.error("[CanvasExporter] ERROR: document.body never became available.");
    return;
  }
  setTimeout(() => waitForBody(callback, retries - 1), 50);
}

// ============================================
// MUTATION OBSERVER
// Phase 3.3: With micro-optimizations and loop guard
// ============================================

function setupObserver() {
  // Sanity guard for document.body
  if (!document.body) {
    console.error("[CanvasExporter] setupObserver called without document.body");
    return;
  }
  
  const observer = new MutationObserver((mutations) => {
    if (shouldIgnoreMutation()) return;
    
    for (const mutation of mutations) {
      try {
        if (mutation.type === "childList") {
          mutation.addedNodes.forEach((node) => {
            // Micro-optimization: skip non-element nodes
            if (node.nodeType !== Node.ELEMENT_NODE) return;
            
            if (node.nodeName === "IFRAME") {
              handleIframe(node);
              markObservation();
            } else if (node.querySelectorAll) {
              const iframes = node.querySelectorAll("iframe");
              if (iframes.length > 0) {
                iframes.forEach(handleIframe);
                markObservation();
              }
            }
          });
        }
        
        if (mutation.type === "attributes" && mutation.target.nodeName === "IFRAME") {
          const iframe = mutation.target;
          debugLog("Iframe attribute changed:", mutation.attributeName);
          markObservation();
          setTimeout(() => safeProcessIframe(iframe), 50);
        }
      } catch (err) {
        console.error("[CanvasExporter] Observer error:", err);
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

// ============================================
// POSTMESSAGE LISTENER (Signals B & C)
// Phase 3.3: With debouncer and fingerprinting
// ============================================

function setupPostMessageListener() {
  window.addEventListener("message", (event) => {
    // Refinement #15: Debounce burst messages
    if (shouldDebounceMessage()) {
      debugLog("Debounced postMessage burst");
      return;
    }
    
    if (DEBUG_ENABLED && debugCount < DEBUG_MAX) {
      console.groupCollapsed("[CanvasExporter] postMessage received");
    }
    
    try {
      if (event.source === window && window.top === window) {
        debugLog("Ignoring top-window self-message");
        return;
      }
      
      const m = classifyMessage(event);
      
      if (!m) {
        debugLog("Classifier returned null → ignoring");
        return;
      }
      
      debugLog("Origin:", event.origin);
      debugLog("Is Canvas:", m.isCanvas);
      debugLog("Is PMF:", m.isPMF);
      debugLog("Has Learnosity shape:", m.hasLearnosityShape);
      
      if (!m.isCanvas && !m.isPMF) {
        debugLog("Ignoring – unknown or untrusted origin");
        return;
      }
      
      const payload = m.data;
      
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
      
      if (lastMessageUuid === uuid) {
        debugLog("Duplicate message UUID → ignoring");
        return;
      }
      lastMessageUuid = uuid;
      
      markObservation();
      
      const isNew = trackRecentBankUuid(uuid);
      debugLog("New bank:", isNew);
      debugLog("Recent banks:", recentBankUuids);
      
      const message = {
        type: "BANK_CONTEXT_DETECTED",
        source: m.isPMF ? "pmf" : "postMessage",
        mode: "payload",
        uuid: uuid,
        origin: event.origin,
        rawMessage: payload,
        timestamp: Date.now()
      };
      
      emit("bankDetected", message);
      
      chrome.runtime.sendMessage(message, (res) => {
        if (chrome.runtime.lastError) {
          debugLog("Runtime error:", chrome.runtime.lastError.message);
        } else {
          debugLog("Forwarded:", res);
        }
      });
      
    } finally {
      if (DEBUG_ENABLED && debugCount < DEBUG_MAX) {
        console.groupEnd();
      }
    }
  });
  
  debugLog("postMessage listener started (Phase 3.3)");
}

// ============================================
// INITIALIZATION
// Refinement #6: Delayed start for Canvas hydration
// ============================================

console.log("[CanvasExporter] Content script loaded (Phase 3.3)");

// Setup postMessage listener FIRST to catch early messages
setupPostMessageListener();

// Refinement #6: Delay observer and polling for Canvas hydration
setTimeout(() => {
  scanForIframes();
  
  // Only attach observer once body exists
  waitForBody(() => {
    setupObserver();
  });
}, 75);

setTimeout(() => {
  setupSmartPolling();
}, 150);

} // End of skip guard
