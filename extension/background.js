let currentBank = null;

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "BANK_CONTEXT_DETECTED") {
    currentBank = msg.uuid;
    chrome.storage.local.set({ currentBank });
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "POPUP_REQUEST_BANK") {
    sendResponse({ currentBank });
  }
});
