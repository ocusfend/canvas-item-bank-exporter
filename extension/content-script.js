console.log("[CanvasExporter] Content script booting (Phase 4)…");

// Inject page script so we can patch fetch/XHR in page JS environment
const s = document.createElement("script");
s.src = chrome.runtime.getURL("inject.js");
document.documentElement.appendChild(s);
s.remove();

// Listen for bank detection events from inject.js
window.addEventListener("CanvasExporter_BankDetected", (e) => {
  chrome.runtime.sendMessage({
    type: "BANK_DETECTED",
    bank: e.detail,
  });
});

// Listen for API base detection events from inject.js
window.addEventListener("CanvasExporter_ApiBaseDetected", (e) => {
  chrome.runtime.sendMessage({
    type: "API_BASE_DETECTED",
    apiBase: e.detail.apiBase,
  });
});

// Listen for bearer token detection from inject.js
window.addEventListener("CanvasExporter_AuthDetected", (e) => {
  const { bearerToken, apiDomain } = e.detail;
  if (bearerToken) {
    console.log("[CanvasExporter] Forwarding bearer token to background:", apiDomain);
    chrome.runtime.sendMessage({
      type: "AUTH_DETECTED",
      bearerToken,
      apiDomain,
    });
  }
});

// ========== API PROXY VIA PAGE CONTEXT ==========
// Route API calls through inject.js (page context) to bypass CORS

const pendingRequests = new Map();

function fetchViaPage(url, paginated = false) {
  return new Promise((resolve, reject) => {
    const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    
    // Set timeout to avoid hanging forever
    const timeout = setTimeout(() => {
      pendingRequests.delete(requestId);
      reject(new Error("Request timed out after 30s"));
    }, 30000);
    
    pendingRequests.set(requestId, { 
      resolve: (data) => {
        clearTimeout(timeout);
        resolve(data);
      }, 
      reject: (err) => {
        clearTimeout(timeout);
        reject(err);
      }
    });
    
    console.log("[CanvasExporter] Dispatching fetch request to page context:", { requestId, url, paginated });
    
    window.dispatchEvent(new CustomEvent("CanvasExporter_FetchRequest", {
      detail: { requestId, url, paginated }
    }));
  });
}

// Listen for responses from inject.js (page context)
window.addEventListener("CanvasExporter_FetchResponse", (e) => {
  const { requestId, success, data, error } = e.detail;
  console.log("[CanvasExporter] Received fetch response from page context:", { requestId, success });
  
  const pending = pendingRequests.get(requestId);
  if (pending) {
    pendingRequests.delete(requestId);
    if (success) {
      pending.resolve(data);
    } else {
      pending.reject(new Error(error));
    }
  }
});

// ========== MESSAGE HANDLERS FOR BACKGROUND SCRIPT ==========

// Track if this frame has responded to prevent duplicate responses
let hasRespondedToRequest = new Set();

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Handle FETCH messages - ALL frames can respond, but only the one with tokens will
  // The page context (inject.js) will check if it has tokens before responding
  if (msg.type === "FETCH_API" || msg.type === "FETCH_PAGINATED") {
    const requestKey = `${msg.type}:${msg.url}`;
    
    // Prevent this frame from responding twice to the same request
    if (hasRespondedToRequest.has(requestKey)) {
      console.log("[CanvasExporter] Already handled this request, skipping");
      return false;
    }
    
    const isTopFrame = window === window.top;
    console.log(`[CanvasExporter] ${msg.type} request (${isTopFrame ? 'top' : 'iframe'}):`, msg.url.substring(0, 80));
    
    // Route through page context - inject.js will check if it has tokens
    fetchViaPage(msg.url, msg.type === "FETCH_PAGINATED")
      .then(data => {
        hasRespondedToRequest.add(requestKey);
        // Clear after 5 seconds to allow retries
        setTimeout(() => hasRespondedToRequest.delete(requestKey), 5000);
        sendResponse({ success: true, data });
      })
      .catch(error => {
        // Only send error response if we're the top frame (fallback)
        // Iframes should silently fail to let other frames try
        if (isTopFrame || error.message.includes('TOKEN_EXPIRED')) {
          hasRespondedToRequest.add(requestKey);
          setTimeout(() => hasRespondedToRequest.delete(requestKey), 5000);
          sendResponse({ success: false, error: error.message });
        }
      });
    return true; // Keep channel open for async response
  }
});

console.log("[CanvasExporter] Content script ready - API calls will route through page context");
