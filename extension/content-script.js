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
