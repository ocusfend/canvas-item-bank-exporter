// Canvas New Quizzes Item Bank Exporter - Content Script

// ============================================
// INLINE UTILITIES (MV3 content scripts can't import ES modules)
// ============================================

const DEBUG = true;

function debugLog(...args) {
  if (DEBUG) console.log("[CanvasExporter]", ...args);
}

function debugGroup(label, fn) {
  if (DEBUG) {
    console.group(`[CanvasExporter] ${label}`);
    try {
      fn();
    } finally {
      console.groupEnd();
    }
  } else {
    fn();
  }
}

function isQuizLtiUrl(url) {
  try {
    const hostname = new URL(url).hostname;
    return hostname.includes("quiz-lti") && hostname.endsWith(".instructure.com");
  } catch {
    return false;
  }
}

/**
 * Extract bank ID from URL - supports both UUID and numeric IDs
 */
function extractBankIdFromUrl(url) {
  const patterns = [
    // UUID patterns
    /\/api\/banks\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
    /\/banks\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
    /\/bank\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
    // Numeric ID patterns (e.g., /banks/3387)
    /\/api\/banks\/(\d+)/i,
    /\/banks\/(\d+)/i,
    /\/bank\/(\d+)/i
  ];
  
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
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
    // Cross-origin access blocked - expected until iframe fully loads
    return null;
  }
}

// ============================================
// POSTMESSAGE ORIGIN VALIDATION
// ============================================

const ALLOWED_ORIGIN_PATTERNS = [
  /\.instructure\.com$/,
  /quiz-lti.*\.instructure\.com$/
];

function isAllowedOrigin(origin) {
  try {
    const { hostname } = new URL(origin);
    return ALLOWED_ORIGIN_PATTERNS.some(pattern => pattern.test(hostname));
  } catch {
    return false;
  }
}

/**
 * Check if origin is from Learnosity or Instructure domains
 * Refinement E.1: Uses .endsWith() for strict subdomain validation
 * Prevents false positives like malicious-learnosity.com.attacker.io
 */
function isLearnosityOrInstructureOrigin(origin) {
  try {
    const { hostname } = new URL(origin);
    return (
      hostname === "learnosity.com" ||
      hostname.endsWith(".learnosity.com") ||
      hostname === "instructure.com" ||
      hostname.endsWith(".instructure.com")
    );
  } catch {
    return false;
  }
}

/**
 * Check if an iframe is likely a Learnosity iframe
 */
function isLearnosityIframe(iframe) {
  const src = iframe.src || "";
  return (
    src.includes("learnosity.com") ||
    src.includes("assess.learnosity") ||
    src.includes("items.learnosity") ||
    src.includes("authorapi.learnosity") ||
    src.includes("questionsapi.learnosity")
  );
}

/**
 * Check if message likely comes from Learnosity/Canvas LTI
 * Reduces noise from Canvas UI messages (resize, analytics, routing)
 */
function isLikelyLearnosityMessage(data) {
  if (!data || typeof data !== "object") return false;
  
  // Learnosity messages typically include one of these properties
  return !!(
    data.subject ||           // LTI message subject
    data.data ||              // Canvas-wrapped payload
    data.resource_id ||       // Learnosity resource identifier
    data.session_id ||        // Learnosity session
    data.bankId ||            // Direct bank ID
    data.bank_id              // Alternative format
  );
}

/**
 * Extract first UUID found anywhere in an object (via JSON serialization)
 * Returns null for circular objects or non-serializable data
 */
function extractUuidFromObject(obj) {
  if (!obj || typeof obj !== "object") return null;
  
  const uuidRegex = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
  
  let json;
  try {
    json = JSON.stringify(obj);
  } catch {
    // Cannot extract UUID from circular or non-serializable object
    return null;
  }
  
  const match = json.match(uuidRegex);
  return match ? match[1] : null;
}

/**
 * Extract bank UUID using bank-specific patterns
 * Refinement F: Handles bank_*, bank/, bank: prefixed UUIDs
 * These patterns are more reliable indicators of actual bank UUIDs
 */
function extractBankUuidFromObject(obj) {
  if (!obj || typeof obj !== "object") return null;
  
  let json;
  try {
    json = JSON.stringify(obj);
  } catch {
    return null;
  }
  
  // Bank-specific patterns (more reliable)
  const bankPatterns = [
    /bank[_/:]([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
    /"bankId"\s*:\s*"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"/i,
    /"bank_id"\s*:\s*"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"/i,
    /"resource_id"\s*:\s*"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"/i
  ];
  
  for (const pattern of bankPatterns) {
    const match = json.match(pattern);
    if (match) return match[1];
  }
  
  // Fall back to generic UUID extraction
  return extractUuidFromObject(obj);
}

// ============================================
// STATE MANAGEMENT
// ============================================

let lastSentBankId = null;
const iframeLastUrl = new WeakMap();
// Use array to track iframes (WeakSet can't be iterated for polling)
const trackedIframes = [];

// postMessage deduplication
let lastPostMessageBankUuid = null;

// Store last 5 unique bank UUIDs for multi-bank session support
const recentBankUuids = [];
const MAX_RECENT_BANKS = 5;

/**
 * Track a bank UUID in the recent list (max 5)
 * Returns true if this is a new UUID, false if already seen
 */
function trackRecentBankUuid(uuid) {
  if (recentBankUuids.includes(uuid)) {
    return false; // Already tracked
  }
  
  recentBankUuids.unshift(uuid); // Add to front
  if (recentBankUuids.length > MAX_RECENT_BANKS) {
    recentBankUuids.pop(); // Remove oldest
  }
  
  return true; // New UUID
}

// ============================================
// CORE FUNCTIONS
// ============================================

/**
 * Process an iframe URL change: extract ID, deduplicate, send message
 */
function handleIframeUrlChange(iframe, url) {
  if (!url || !isQuizLtiUrl(url)) return;
  
  // Dedup on exact URL match
  if (iframeLastUrl.get(iframe) === url) return;
  iframeLastUrl.set(iframe, url);
  
  const bankId = extractBankIdFromUrl(url);
  
  debugGroup("Iframe URL change detected", () => {
    debugLog("URL:", url);
    debugLog("Extracted bank ID:", bankId || "(none)");
    
    // Update last sent ID
    if (bankId) {
      lastSentBankId = bankId;
    }
    
    // Send message to background
    const payload = {
      type: "BANK_CONTEXT_DETECTED",
      source: "iframe",
      iframeUrl: url,
      bankUuid: bankId, // Keep property name for backwards compatibility
      timestamp: Date.now()
    };
    
    debugLog("Sending BANK_CONTEXT_DETECTED...");
    
    chrome.runtime.sendMessage(payload)
      .then(() => debugLog("Message sent successfully"))
      .catch(err => debugLog("Failed to send message:", err));
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
 * Request background to inject hook script into Learnosity iframe
 * Refinement G: Background will use webNavigation to find exact frameIds
 */
function requestLearnosityHookInjection(iframe) {
  if (!isLearnosityIframe(iframe)) return;
  
  // Mark iframe to prevent duplicate injection requests
  if (iframe.dataset.canvasExporterHookRequested) return;
  iframe.dataset.canvasExporterHookRequested = "true";
  
  debugGroup("Requesting Learnosity hook injection", () => {
    debugLog("Iframe src:", iframe.src);
    
    chrome.runtime.sendMessage({
      type: "INJECT_LEARNOSITY_HOOK",
      iframeSrc: iframe.src
    }, (response) => {
      if (chrome.runtime.lastError) {
        debugLog("Injection request error:", chrome.runtime.lastError.message);
        return;
      }
      debugLog("Injection response:", response);
    });
  });
}

/**
 * Handle an iframe: track it and attach load listener
 */
function handleIframe(iframe) {
  // Check if already tracked
  if (trackedIframes.includes(iframe)) {
    return;
  }
  
  debugGroup("Iframe detected", () => {
    debugLog("src:", iframe.src || "(empty)");
    debugLog("Is Learnosity:", isLearnosityIframe(iframe));
    debugLog("Tracking iframe for internal URL detection");
  });
  
  // Track this iframe
  trackedIframes.push(iframe);
  
  // Request Learnosity hook injection if applicable
  requestLearnosityHookInjection(iframe);
  
  // Attach load listener for future loads
  iframe.addEventListener("load", () => {
    debugLog("Iframe load event fired");
    // Re-check for Learnosity after load (src may have changed)
    requestLearnosityHookInjection(iframe);
    // Small delay to allow internal navigation to complete
    setTimeout(() => processIframe(iframe), 100);
  });
  
  // Process immediately in case already loaded
  setTimeout(() => processIframe(iframe), 0);
}

/**
 * Scan DOM for existing iframes (observe ALL iframes, filter by internal URL)
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
            // Also check children of added nodes
            if (node.querySelectorAll) {
              node.querySelectorAll("iframe").forEach(handleIframe);
            }
          });
        }
        
        // Check for attribute changes on iframes (src changes)
        if (mutation.type === "attributes" && mutation.target.nodeName === "IFRAME") {
          const iframe = mutation.target;
          debugLog("Iframe attribute changed:", mutation.attributeName);
          // Re-check for Learnosity after src change
          requestLearnosityHookInjection(iframe);
          // Process after attribute change
          setTimeout(() => processIframe(iframe), 100);
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
      // Skip if iframe was removed from DOM
      if (!document.contains(iframe)) return;
      
      const url = getInternalIframeUrl(iframe);
      if (!url) return;
      
      // Check if URL changed since last poll
      if (iframeLastUrl.get(iframe) === url) return;
      
      debugLog("Polling detected URL change:", url);
      handleIframeUrlChange(iframe, url);
    });
  }, 1000);
  
  debugLog("Polling started (1s interval for internal URL changes)");
}

// ============================================
// BRIDGE MESSAGE HANDLING (Phase 3.1)
// ============================================

/**
 * Handle messages forwarded from injected Learnosity hook
 * Refinement E: Validates origin using .endsWith() for security
 * Refinement F: Uses bank-specific UUID extraction patterns
 * Refinement F.1: debugTiming.latency is for debugging only (cross-frame clock skew)
 */
function handleBridgeMessage(event, bridgeData) {
  const direction = bridgeData.direction || "unknown";
  
  if (DEBUG) console.groupCollapsed(`[CanvasExporter] Learnosity bridge message (${direction})`);
  
  try {
    // Refinement E.1: Validate origin with .endsWith() for strict subdomain matching
    if (!isLearnosityOrInstructureOrigin(event.origin)) {
      debugLog("Bridge message from untrusted origin → ignoring");
      debugLog("Origin was:", event.origin);
      return;
    }
    debugLog("Origin validated ✓:", event.origin);
    
    const payload = bridgeData.innerMessage;
    debugLog("Direction:", direction);
    debugLog("Inner message:", payload);
    debugLog("Source URL:", bridgeData.sourceUrl);
    
    if (!payload || typeof payload !== "object") {
      debugLog("Inner message not an object → ignoring");
      return;
    }
    
    // Refinement F: Use bank-specific extraction first, fall back to generic
    let uuid = 
      extractBankUuidFromObject(payload) ||
      extractBankUuidFromObject(payload?.data) ||
      extractUuidFromObject(payload) ||
      extractUuidFromObject(payload?.data) ||
      null;
    
    // Reject partial UUIDs
    if (!uuid || uuid.length < 36) {
      debugLog("No valid UUID in bridge message → ignoring");
      return;
    }
    
    debugLog("Extracted UUID:", uuid);
    
    // Deduplicate
    if (lastPostMessageBankUuid === uuid) {
      debugLog("Duplicate UUID → ignoring");
      return;
    }
    lastPostMessageBankUuid = uuid;
    
    // Track in recent banks
    const isNewBank = trackRecentBankUuid(uuid);
    debugLog("New bank in session:", isNewBank);
    debugLog("Recent banks:", recentBankUuids);
    
    // Forward to background
    // Refinement F.1: latency calculated from cross-frame timestamps is for debugging only
    // Do not use for correctness logic due to potential clock skew between frames
    const message = {
      type: "BANK_CONTEXT_DETECTED",
      source: "learnosity-bridge",
      direction: direction,
      bankUuid: uuid,
      origin: event.origin,
      sourceUrl: bridgeData.sourceUrl,
      rawMessage: payload,
      timestamp: Date.now(),
      debugTiming: {
        hookTimestamp: bridgeData.timestamp,
        receivedAt: Date.now(),
        // Note: latency may be inaccurate due to cross-frame clock skew - debug use only
        latency: Date.now() - bridgeData.timestamp
      }
    };
    
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        debugLog("Runtime error:", chrome.runtime.lastError.message);
        return;
      }
      debugLog("Forwarded to background ✓", response);
    });
    
  } finally {
    if (DEBUG) console.groupEnd();
  }
}

// ============================================
// POSTMESSAGE LISTENER (Cross-origin detection)
// ============================================

function setupPostMessageListener() {
  window.addEventListener("message", (event) => {
    if (DEBUG) console.groupCollapsed("[CanvasExporter] postMessage received");
    
    try {
      // 1. Ignore top-window self-messages (prevent extension loops)
      if (event.source === window && window.top === window) {
        debugLog("Ignoring top-window self-message");
        return;
      }
      
      debugLog("Origin:", event.origin);
      debugLog("Data type:", typeof event.data);
      
      // 2. Handle Learnosity bridge messages (from injected hook) - PRIORITY
      if (event.data && (event.data.__canvasExporterBridge === true || 
                         event.data.__canvasExporterBridgeIncoming === true)) {
        debugLog("Bridge message signature detected ✓");
        handleBridgeMessage(event, event.data);
        return;
      }
      
      debugLog("Data:", event.data);
      
      // 3. Validate origin - only accept messages from instructure.com domains
      if (!isAllowedOrigin(event.origin)) {
        debugLog("Ignored – disallowed origin");
        return;
      }
      debugLog("Origin allowed ✓");
      
      // 4. Skip string messages (some LTI messages come as JSON strings)
      if (typeof event.data === "string") {
        debugLog("Ignored – string message");
        return;
      }
      
      // 5. Skip non-object messages
      if (!event.data || typeof event.data !== "object") {
        debugLog("Ignored – non-object message");
        return;
      }
      
      // 6. Early filter: check if message resembles Learnosity
      if (!isLikelyLearnosityMessage(event.data)) {
        debugLog("Message does not resemble Learnosity → skipping early");
        return;
      }
      debugLog("Likely Learnosity message ✓");
      
      // 7. Extract UUID using bank-specific patterns first (Refinement F)
      let uuid = 
        extractBankUuidFromObject(event.data) ||
        extractBankUuidFromObject(event.data?.data) ||
        extractUuidFromObject(event.data) ||
        extractUuidFromObject(event.data?.data) ||
        null;
      
      // 8. Reject partial UUIDs (must be full 36-char UUID)
      if (!uuid || uuid.length < 36) {
        debugLog("No valid UUID found (or partial match) → ignoring");
        return;
      }
      debugLog("Extracted UUID:", uuid);
      
      // 9. Deduplicate - don't send same UUID twice in a row
      if (lastPostMessageBankUuid === uuid) {
        debugLog("Duplicate UUID → ignoring");
        return;
      }
      lastPostMessageBankUuid = uuid;
      
      // 10. Track in recent banks list (for multi-bank session support)
      const isNewBank = trackRecentBankUuid(uuid);
      debugLog("New bank in session:", isNewBank);
      debugLog("Recent banks:", recentBankUuids);
      
      // 11. Forward to background worker
      const payload = {
        type: "BANK_CONTEXT_DETECTED",
        source: "postMessage",
        bankUuid: uuid,
        origin: event.origin,
        rawMessage: event.data,
        timestamp: Date.now()
      };
      
      chrome.runtime.sendMessage(payload, (response) => {
        // Check for runtime errors
        if (chrome.runtime.lastError) {
          debugLog("Runtime error:", chrome.runtime.lastError.message);
          return;
        }
        debugLog("Forwarded to background ✓", response);
      });
      
    } finally {
      if (DEBUG) console.groupEnd();
    }
  });
  
  debugLog("postMessage listener started");
}

// ============================================
// INITIALIZATION
// ============================================

debugLog("Content script loaded on:", window.location.href);

// Setup postMessage listener FIRST to catch early Learnosity boot messages
setupPostMessageListener();

// Initial scan for existing iframes
scanForIframes();

// Setup MutationObserver for dynamic detection
setupObserver();

// Setup polling for internal iframe navigation
setupPolling();
