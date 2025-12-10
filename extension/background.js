// ============================================================================
// Phase 3.4 Background
// ============================================================================

let currentBank = null;

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg.type === "CANVAS_EXPORTER_BANK") {
    currentBank = msg.bank;
    console.log("[CanvasExporter Background] Bank updated:", currentBank);
  }

  if (msg.type === "CANVAS_EXPORTER_GET_BANK") {
    reply({ bank: currentBank });
  }
});
