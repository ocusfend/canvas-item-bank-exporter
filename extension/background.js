console.log("[CanvasExporter BG] Phase 3.4 background active");

let lastBank = null;
let lastUpdated = 0;

// Handle messages from content script
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg !== "object") return;

  if (msg.type === "BANK_CONTEXT_DETECTED") {
    lastBank = {
      uuid: msg.uuid,
      source: msg.source,
      timestamp: Date.now(),
      raw: msg,
    };
    lastUpdated = Date.now();

    console.log("[CanvasExporter BG] Bank detected:", lastBank);

    // Notify popup if open
    chrome.runtime.sendMessage({
      type: "BANK_UPDATE",
      bank: lastBank,
    });
  }

  if (msg.type === "POPUP_REQUEST_STATE") {
    sendResponse({ bank: lastBank });
  }
});
