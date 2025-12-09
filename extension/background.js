// Canvas New Quizzes Item Bank Exporter - Background Service Worker

console.log("[CanvasExporter] Extension initialized");

// Listen for messages from popup and content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Handle PING messages (Phase 1 - kept for testing)
  if (message.type === "PING") {
    console.log("[CanvasExporter] Received PING from:", sender.tab ? `content script (tab ${sender.tab.id})` : "popup");
    sendResponse({
      status: "PONG",
      timestamp: Date.now()
    });
    return true;
  }
  
  // Handle bank context detection (Phase 2 & 3)
  if (message.type === "BANK_CONTEXT_DETECTED") {
    // Use grouped logging for clarity
    console.groupCollapsed("[CanvasExporter] BANK_CONTEXT_DETECTED received");
    console.log("Bank UUID:", message.bankUuid);
    console.log("Source:", message.source || "iframe");
    console.log("Origin:", message.origin || "(not provided)");
    console.log("Timestamp:", new Date(message.timestamp).toISOString());
    if (message.rawMessage) {
      console.log("Raw message:", message.rawMessage);
    }
    if (message.iframeUrl) {
      console.log("Iframe URL:", message.iframeUrl);
    }
    console.groupEnd();
    
    // Store in session storage for future fetch operations
    chrome.storage.session.set({ lastDetectedBank: message })
      .then(() => {
        console.log("[CanvasExporter] Bank context stored in session storage");
      })
      .catch((err) => {
        console.error("[CanvasExporter] Failed to store bank context:", err);
      });
    
    sendResponse({ status: "OK", received: true });
    return true;
  }
  
  // Return true to indicate we may send a response asynchronously
  return true;
});
