// Canvas New Quizzes Item Bank Exporter - Background Service Worker

console.log("Extension initialized");

// Listen for messages from popup and content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "PING") {
    console.log("Received PING from:", sender.tab ? `content script (tab ${sender.tab.id})` : "popup");
    sendResponse({
      status: "PONG",
      timestamp: Date.now()
    });
  }
  
  // Return true to indicate we will send a response asynchronously (if needed in future)
  return true;
});
