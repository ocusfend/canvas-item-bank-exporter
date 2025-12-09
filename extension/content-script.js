// Canvas New Quizzes Item Bank Exporter - Content Script

console.log("[Canvas Exporter] Content script loaded on:", window.location.href);

// Send a PING message to background script to verify communication
chrome.runtime.sendMessage({ type: "PING" }, (response) => {
  if (chrome.runtime.lastError) {
    console.error("[Canvas Exporter] Error communicating with background:", chrome.runtime.lastError.message);
    return;
  }
  console.log("[Canvas Exporter] Received response from background:", response);
});
