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
  
  // Handle bank context detection (Phase 2)
  if (message.type === "BANK_CONTEXT_DETECTED") {
    console.log("[CanvasExporter] Bank context detected:", message);
    
    // Store in session storage for future fetch operations (Phase 3)
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
