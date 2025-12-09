// Canvas New Quizzes Item Bank Exporter - Background Service Worker

console.log("[CanvasExporter] Extension initialized");

// Verify webNavigation is available (needed for frame detection in Phase 3.1)
if (chrome.webNavigation) {
  console.log("[CanvasExporter] webNavigation API available ✓");
} else {
  console.warn("[CanvasExporter] webNavigation API not available - frame detection limited");
}

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
  
  // Handle Learnosity hook injection requests (Phase 3.1)
  if (message.type === "INJECT_LEARNOSITY_HOOK") {
    console.groupCollapsed("[CanvasExporter] Learnosity hook injection requested");
    console.log("From tab:", sender.tab?.id);
    console.log("Frame ID:", sender.frameId);
    console.log("Iframe src:", message.iframeSrc);
    
    if (!sender.tab?.id) {
      console.error("No tab ID available for injection");
      console.groupEnd();
      sendResponse({ status: "ERROR", error: "No tab ID" });
      return true;
    }
    
    // Refinement G: Use webNavigation to find exact Learnosity frameIds
    chrome.webNavigation.getAllFrames({ tabId: sender.tab.id })
      .then((frames) => {
        const learnosityFrames = frames.filter(frame => 
          frame.url && frame.url.includes("learnosity.com")
        );
        
        console.log("Total frames in tab:", frames.length);
        console.log("Learnosity frames found:", learnosityFrames.length);
        
        if (learnosityFrames.length === 0) {
          console.log("No Learnosity frames found yet - may still be loading");
          console.groupEnd();
          return;
        }
        
        // Inject into each Learnosity frame (Refinement G: targeted injection)
        const frameIds = learnosityFrames.map(f => f.frameId);
        console.log("Injecting into frameIds:", frameIds);
        console.log("Frame URLs:", learnosityFrames.map(f => f.url));
        
        return chrome.scripting.executeScript({
          target: {
            tabId: sender.tab.id,
            frameIds: frameIds
          },
          files: ["learnosity-hook.js"],
          world: "MAIN"  // Refinement A: Run in page context to intercept postMessage
        });
      })
      .then((results) => {
        if (results) {
          console.log("Hook injection successful");
          console.log("Injection results:", results);
        }
        console.groupEnd();
      })
      .catch((err) => {
        // Refinement H: Graceful CSP fallback
        console.warn("Hook injection failed:", err.message);
        console.log("This may be due to:");
        console.log("  - CSP restrictions on the Learnosity iframe");
        console.log("  - Frame not yet fully loaded");
        console.log("  - Permission not granted for learnosity.com");
        console.log("Falling back to postMessage-only detection (Phase 3 fallback)");
        console.groupEnd();
      });
    
    sendResponse({ status: "INJECTION_REQUESTED" });
    return true;
  }
  
  // Handle bank context detection (Phase 2, 3 & 3.1)
  if (message.type === "BANK_CONTEXT_DETECTED") {
    const sourceEmoji = {
      "iframe": "🖼️",
      "postMessage": "📨",
      "learnosity-bridge": "🌉"
    };
    
    const emoji = sourceEmoji[message.source] || "❓";
    const direction = message.direction ? ` (${message.direction})` : "";
    
    console.groupCollapsed(`[CanvasExporter] ${emoji} BANK_CONTEXT_DETECTED${direction}`);
    console.log("Bank UUID:", message.bankUuid);
    console.log("Source:", message.source || "iframe");
    if (message.direction) {
      console.log("Direction:", message.direction);
    }
    console.log("Origin:", message.origin || "(not provided)");
    if (message.sourceUrl) {
      console.log("Source URL:", message.sourceUrl);
    }
    console.log("Timestamp:", new Date(message.timestamp).toISOString());
    if (message.debugTiming) {
      // Refinement F.1: Note that latency may be inaccurate due to cross-frame clock skew
      console.log("Debug timing (latency may be inaccurate due to clock skew):", message.debugTiming);
    }
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
