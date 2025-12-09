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

function extractBankUuidFromUrl(url) {
  const patterns = [
    /\/api\/banks\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
    /\/banks\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
    /\/bank\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i
  ];
  
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  
  return null;
}

// ============================================
// STATE MANAGEMENT
// ============================================

let lastSentBankUuid = null;
const observedIframes = new WeakSet();
const iframeLastUrl = new WeakMap();

// ============================================
// CORE FUNCTIONS
// ============================================

/**
 * Process an iframe: extract URL/UUID, deduplicate, send message
 */
function processIframe(iframe) {
  const currentUrl = iframe.src;
  
  if (!currentUrl || !isQuizLtiUrl(currentUrl)) {
    return;
  }
  
  // Dedup on exact URL match (allows same UUID with different paths)
  if (iframeLastUrl.get(iframe) === currentUrl) {
    return;
  }
  
  debugGroup("Processing iframe", () => {
    debugLog("URL:", currentUrl);
    
    const bankUuid = extractBankUuidFromUrl(currentUrl);
    debugLog("Extracted UUID:", bankUuid || "(none)");
    
    // Update tracking state
    iframeLastUrl.set(iframe, currentUrl);
    if (bankUuid) {
      lastSentBankUuid = bankUuid;
    }
    
    // Send message to background with try/catch
    const payload = {
      type: "BANK_CONTEXT_DETECTED",
      iframeUrl: currentUrl,
      bankUuid: bankUuid,
      timestamp: Date.now()
    };
    
    debugLog("Sending BANK_CONTEXT_DETECTED...");
    
    chrome.runtime.sendMessage(payload)
      .then(() => debugLog("Message sent successfully"))
      .catch(err => debugLog("Failed to send message:", err));
  });
}

/**
 * Handle an iframe: attach load listener if not already observed
 */
function handleIframe(iframe) {
  if (observedIframes.has(iframe)) {
    return;
  }
  
  const src = iframe.src;
  if (!src || !isQuizLtiUrl(src)) {
    return;
  }
  
  debugGroup("Iframe detected", () => {
    debugLog("URL:", src);
    debugLog("Is quiz-lti:", true);
    debugLog("Attaching load listener");
  });
  
  observedIframes.add(iframe);
  
  // Attach load listener for future loads
  iframe.addEventListener("load", () => {
    debugLog("Iframe load event fired");
    processIframe(iframe);
  });
  
  // Handle already-loaded iframes (Refinement 7)
  // Check if iframe is already loaded
  if (iframe.contentDocument || iframe.src) {
    debugLog("Iframe may already be loaded, processing immediately");
    setTimeout(() => processIframe(iframe), 0);
  }
}

/**
 * Scan DOM for existing quiz-lti iframes
 */
function scanForIframes() {
  debugGroup("Initial iframe scan", () => {
    const iframes = document.querySelectorAll("iframe");
    debugLog(`Found ${iframes.length} existing iframe(s)`);
    
    iframes.forEach((iframe) => {
      if (iframe.src && isQuizLtiUrl(iframe.src)) {
        debugLog("Quiz-LTI iframe found:", iframe.src);
        handleIframe(iframe);
      }
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
        if (iframe.src && isQuizLtiUrl(iframe.src)) {
          debugLog("Iframe src attribute changed:", iframe.src);
          handleIframe(iframe);
          processIframe(iframe);
        }
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
 * Setup polling as a safety net for iframe.src changes
 * (Catches changes that MutationObserver might miss)
 */
function setupPolling() {
  setInterval(() => {
    const iframes = document.querySelectorAll("iframe");
    iframes.forEach((iframe) => {
      if (iframe.src && isQuizLtiUrl(iframe.src)) {
        // Only process if we're already tracking this iframe
        if (observedIframes.has(iframe)) {
          processIframe(iframe);
        } else {
          handleIframe(iframe);
        }
      }
    });
  }, 1000);
  
  debugLog("Polling safety net started (1s interval)");
}

// ============================================
// INITIALIZATION
// ============================================

debugLog("Content script loaded on:", window.location.href);

// Initial scan for existing iframes
scanForIframes();

// Setup MutationObserver for dynamic detection
setupObserver();

// Setup polling as safety net
setupPolling();
