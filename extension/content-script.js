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

// ========== API PROXY FOR BACKGROUND SCRIPT ==========
// Background script cannot make authenticated requests, so we proxy them here

function parseLinkHeader(header) {
  if (!header) return {};
  const links = {};
  const parts = header.split(',');
  for (const part of parts) {
    const match = part.match(/<([^>]+)>;\s*rel="([^"]+)"/);
    if (match) links[match[2]] = match[1];
  }
  return links;
}

async function paginatedFetch(baseUrl) {
  const results = [];
  let url = baseUrl;
  
  while (url) {
    const response = await fetch(url, { credentials: 'include', mode: 'cors' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    
    const data = await response.json();
    results.push(...(Array.isArray(data) ? data : [data]));
    
    const linkHeader = response.headers.get('Link');
    const links = parseLinkHeader(linkHeader);
    url = links.next || null;
  }
  
  return results;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "FETCH_API") {
    fetch(msg.url, { credentials: 'include', mode: 'cors' })
      .then(response => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then(data => sendResponse({ success: true, data }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true; // Keep channel open for async response
  }
  
  if (msg.type === "FETCH_PAGINATED") {
    paginatedFetch(msg.url)
      .then(data => sendResponse({ success: true, data }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
});
