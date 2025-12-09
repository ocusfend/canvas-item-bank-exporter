// Canvas New Quizzes Item Bank Exporter - Background Service Worker
// Phase 3.2 - Pure Canvas-visible signal detection

console.log("[CanvasExporter] Extension initialized (Phase 3.2)");

// Listen for messages from popup and content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Handle PING messages (testing)
  if (message.type === "PING") {
    console.log("[CanvasExporter] Received PING from:", sender.tab ? `content script (tab ${sender.tab.id})` : "popup");
    sendResponse({ status: "PONG", timestamp: Date.now() });
    return true;
  }
  
  // Handle bank context detection (Phase 3.2)
  if (message.type === "BANK_CONTEXT_DETECTED") {
    const sourceEmoji = {
      "iframe": "🖼️",
      "postMessage": "📨",
      "pmf": "🔀"
    };
    
    const modeLabel = message.mode === "url" ? "[URL]" : "[PAYLOAD]";
    const emoji = sourceEmoji[message.source] || "❓";
    
    console.groupCollapsed(`[CanvasExporter] ${emoji} BANK_CONTEXT_DETECTED ${modeLabel}`);
    console.log("UUID:", message.uuid);
    console.log("Source:", message.source);
    console.log("Mode:", message.mode);
    console.log("Origin:", message.origin || "(not provided)");
    console.log("Timestamp:", new Date(message.timestamp).toISOString());
    if (message.rawMessage) {
      console.log("Raw message:", message.rawMessage);
    }
    if (message.iframeUrl) {
      console.log("Iframe URL:", message.iframeUrl);
    }
    console.groupEnd();
    
    // Store in session storage
    chrome.storage.session.set({ lastDetectedBank: message })
      .then(() => console.log("[CanvasExporter] Bank context stored"))
      .catch((err) => console.error("[CanvasExporter] Storage error:", err));
    
    sendResponse({ status: "OK", received: true });
    return true;
  }
  
  return true;
});
