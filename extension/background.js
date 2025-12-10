// ============================================================================
// Canvas Exporter — Background Service Worker (Phase 4)
// ============================================================================

let currentBankId = null;

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "BANK_DETECTED") {
    currentBankId = msg.bankId;

    chrome.storage.local.set({ currentBankId });

    return;
  }
});

// Popup requests the last known bank ID
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "GET_BANK_ID") {
    chrome.storage.local.get("currentBankId", (res) => {
      sendResponse({ bankId: res.currentBankId || null });
    });
    return true; // keep channel open
  }
});
