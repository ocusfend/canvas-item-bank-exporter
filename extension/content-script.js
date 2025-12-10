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

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "FETCH_API") {
    console.log("[CanvasExporter] FETCH_API request:", msg.url);
    fetchViaPage(msg.url, false)
      .then(data => sendResponse({ success: true, data }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true; // Keep channel open for async response
  }
  
  if (msg.type === "FETCH_PAGINATED") {
    console.log("[CanvasExporter] FETCH_PAGINATED request:", msg.url);
    fetchViaPage(msg.url, true)
      .then(data => sendResponse({ success: true, data }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
});

console.log("[CanvasExporter] Content script ready - API calls will route through page context");
