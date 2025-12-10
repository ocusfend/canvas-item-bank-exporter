let latestBank = null;

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "BANK_DETECTED") {
    latestBank = msg.bank;
    console.log("[Background] Bank stored:", msg.bank);
  }

  if (msg.type === "REQUEST_BANK") {
    sendResponse(latestBank);
  }
});
