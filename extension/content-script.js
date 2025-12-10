console.log("[CanvasExporter] Content script booting (Phase 3.4)…");

// Inject page script so we can patch fetch/XHR in page JS environment
const s = document.createElement("script");
s.src = chrome.runtime.getURL("inject.js");
document.documentElement.appendChild(s);
s.remove();

// Listen for events from inject.js
window.addEventListener("CanvasExporter_BankDetected", (e) => {
  chrome.runtime.sendMessage({
    type: "BANK_DETECTED",
    bank: e.detail,
  });
});
