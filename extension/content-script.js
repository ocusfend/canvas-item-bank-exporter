// ============================================================================
// Canvas Exporter — Phase 3.4
// Inject Page-World Monitoring Script + Relay Bank Events
// ============================================================================

console.log("%c[CanvasExporter] Content script booting…", "color:#9c27b0;font-weight:bold");

// Inject page script into DOM so that fetch/XHR patch runs in PAGE WORLD.
(function inject() {
  const script = document.createElement("script");
  script.src = chrome.runtime.getURL("page-injected.js");
  document.documentElement.appendChild(script);
  script.remove();
})();

// Listen for bank detections emitted by the page script.
window.addEventListener("CanvasExporter:bankDetected", (event) => {
  const detail = event.detail;
  console.log("%c[CanvasExporter] Bank detected:", "color:#4caf50;font-weight:bold", detail);

  chrome.runtime.sendMessage({
    type: "BANK_CONTEXT_DETECTED",
    uuid: detail.uuid,
    source: detail.source,
    timestamp: Date.now(),
  });
});
