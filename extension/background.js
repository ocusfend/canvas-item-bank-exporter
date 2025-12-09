// Canvas New Quizzes Item Bank Exporter - Background Service Worker
// Phase 3.3 - Production-grade with stale protection and debug toggle

console.log("[CanvasExporter] Extension initialized (Phase 3.3)");

// ============================================
// DEBUG SYSTEM (Dynamic Toggle)
// ============================================

let DEBUG_ENABLED = false;

// Load debug preference
chrome.storage.local.get("debug", (result) => {
  DEBUG_ENABLED = result.debug === true;
  if (DEBUG_ENABLED) console.log("[CanvasExporter] Debug mode: ON");
});

// Listen for changes
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.debug) {
    DEBUG_ENABLED = changes.debug.newValue === true;
    console.log("[CanvasExporter] Debug mode:", DEBUG_ENABLED ? "ON" : "OFF");
  }
});

// ============================================
// MESSAGE HANDLER
// ============================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Handle PING messages (testing)
  if (message.type === "PING") {
    if (DEBUG_ENABLED) {
      console.log("[CanvasExporter] Received PING from:", sender.tab ? `content script (tab ${sender.tab.id})` : "popup");
    }
    sendResponse({ status: "PONG", timestamp: Date.now() });
    return true;
  }
  
  // Handle bank context detection (Phase 3.3)
  if (message.type === "BANK_CONTEXT_DETECTED") {
    const sourceEmoji = {
      "iframe": "🖼️",
      "postMessage": "📨",
      "pmf": "🔀"
    };
    
    const modeLabel = message.mode === "url" ? "[URL]" : "[PAYLOAD]";
    const emoji = sourceEmoji[message.source] || "❓";
    
    // Always log essential info (one-liner)
    console.log(`[CanvasExporter] ${emoji} Bank detected: ${message.uuid} (${message.source} ${modeLabel})`);
    
    // Detailed logs only in debug mode
    if (DEBUG_ENABLED) {
      console.groupCollapsed(`[CanvasExporter] ${emoji} BANK_CONTEXT_DETECTED ${modeLabel} - Details`);
      console.log("UUID:", message.uuid);
      console.log("Source:", message.source);
      console.log("Mode:", message.mode);
      console.log("Origin:", message.origin || "(not provided)");
      console.log("Timestamp:", new Date(message.timestamp).toISOString());
      if (message.rawMessage) {
        console.log("Raw message:", message.rawMessage);
      }
      if (message.iframeUrl) {
        console.log("Iframe URL:", message.iframeUrl);
      }
      console.groupEnd();
    }
    
    // Refinement #1: Stale message protection
    chrome.storage.session.get("lastDetectedBank").then((current) => {
      const existingTimestamp = current?.lastDetectedBank?.timestamp || 0;
      
      if (existingTimestamp > message.timestamp) {
        if (DEBUG_ENABLED) {
          console.log("[CanvasExporter] Ignoring stale bank context (older than current)");
        }
        return;
      }
      
      // Store the new bank context
      chrome.storage.session.set({ lastDetectedBank: message })
        .then(() => {
          if (DEBUG_ENABLED) {
            console.log("[CanvasExporter] Bank context stored");
          }
        })
        .catch((err) => console.error("[CanvasExporter] Storage error:", err));
    }).catch((err) => {
      console.error("[CanvasExporter] Failed to check existing bank:", err);
      // Store anyway if we can't check
      chrome.storage.session.set({ lastDetectedBank: message }).catch(() => {});
    });
    
    sendResponse({ status: "OK", received: true });
    return true;
  }
  
  // Handle GET_RECENT_BANKS request from popup
  if (message.type === "GET_RECENT_BANKS") {
    chrome.storage.session.get("lastDetectedBank").then((result) => {
      sendResponse({ 
        currentBank: result.lastDetectedBank || null
      });
    }).catch(() => {
      sendResponse({ currentBank: null });
    });
    return true;
  }
  
  return true;
});
