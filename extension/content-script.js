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
// STATE MANAGEMENT
// ============================================

let lastSentBankId = null;
const iframeLastUrl = new WeakMap();
// Use array to track iframes (WeakSet can't be iterated for polling)
const trackedIframes = [];

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
 * Handle an iframe: track it and attach load listener
 */
function handleIframe(iframe) {
  // Check if already tracked
  if (trackedIframes.includes(iframe)) {
    return;
  }
  
  debugGroup("Iframe detected", () => {
    debugLog("src:", iframe.src || "(empty)");
    debugLog("Tracking iframe for internal URL detection");
  });
  
  // Track this iframe
  trackedIframes.push(iframe);
  
  // Attach load listener for future loads
  iframe.addEventListener("load", () => {
    debugLog("Iframe load event fired");
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
        // Process after attribute change
        setTimeout(() => processIframe(iframe), 100);
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
// INITIALIZATION
// ============================================

debugLog("Content script loaded on:", window.location.href);

// Initial scan for existing iframes
scanForIframes();

// Setup MutationObserver for dynamic detection
setupObserver();

// Setup polling for internal iframe navigation
setupPolling();
