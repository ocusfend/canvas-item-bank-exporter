// ============================================
// Learnosity Hook Script (injected into iframe)
// Intercepts BOTH outgoing and incoming messages
// Phase 3.1 - Bidirectional postMessage interception
// ============================================

(function() {
  const DEBUG = true;
  const HOOK_SIGNATURE_OUTGOING = "__canvasExporterBridge";
  const HOOK_SIGNATURE_INCOMING = "__canvasExporterBridgeIncoming";

  function log(...args) {
    if (DEBUG) console.log("[CanvasExporter:LearnosityHook]", ...args);
  }

  log("Hook script loaded in:", window.location.href);

  // Detect if this is a Learnosity environment
  const isLikelyLearnosity = (() => {
    try {
      return (
        window.location.hostname.includes("learnosity") ||
        typeof window.LearnosityItems !== "undefined" ||
        typeof window.LearnosityAssess !== "undefined" ||
        typeof window.LearnosityAuthor !== "undefined" ||
        document.querySelector('[class*="learnosity"]') !== null
      );
    } catch {
      return false;
    }
  })();

  if (!isLikelyLearnosity) {
    log("Not a Learnosity iframe → aborting hook");
    return;
  }

  log("Learnosity environment detected ✓");

  // Prevent double-injection
  if (window.__canvasExporterHookInstalled) {
    log("Hook already installed → skipping");
    return;
  }
  window.__canvasExporterHookInstalled = true;

  // --------------------------------------------
  // REFINEMENT D: Intercept OUTGOING postMessages
  // (Learnosity → Canvas)
  // --------------------------------------------
  const originalParentPostMessage = window.parent.postMessage.bind(window.parent);

  window.parent.postMessage = function(message, targetOrigin, transfer) {
    // Forward wrapped version to parent for our extension
    try {
      const wrappedMessage = {
        [HOOK_SIGNATURE_OUTGOING]: true,
        direction: "outgoing",
        innerMessage: message,
        originalTargetOrigin: targetOrigin,
        sourceUrl: window.location.href,
        timestamp: Date.now()
      };
      
      log("Intercepted OUTGOING postMessage:", message);
      
      // Send wrapped version (for extension to catch)
      originalParentPostMessage(wrappedMessage, "*");
    } catch (err) {
      log("Outgoing forwarding error:", err);
    }

    // Call original to maintain normal behavior
    return originalParentPostMessage(message, targetOrigin, transfer);
  };

  log("Outgoing postMessage hook installed ✓");

  // --------------------------------------------
  // REFINEMENT D: Intercept INCOMING messages
  // (Canvas → Learnosity)
  // --------------------------------------------
  window.addEventListener("message", (event) => {
    // Don't re-wrap our own wrapped messages
    if (event.data && (event.data[HOOK_SIGNATURE_OUTGOING] || event.data[HOOK_SIGNATURE_INCOMING])) {
      return;
    }

    try {
      const wrappedMessage = {
        [HOOK_SIGNATURE_INCOMING]: true,
        direction: "incoming",
        innerMessage: event.data,
        sourceOrigin: event.origin,
        sourceUrl: window.location.href,
        timestamp: Date.now()
      };
      
      log("Intercepted INCOMING message from:", event.origin);
      
      // Forward to parent for extension to catch
      originalParentPostMessage(wrappedMessage, "*");
    } catch (err) {
      log("Incoming forwarding error:", err);
    }
  });

  log("Incoming message hook installed ✓");
  log("Full bidirectional hook active");
})();
