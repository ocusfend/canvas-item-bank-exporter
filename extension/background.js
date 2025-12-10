// ============================================================================
// background.js — Phase 4
// Central bank-state store + metadata fetcher
// ============================================================================

console.log("[CanvasExporter BG] Background loaded.");

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({
    currentBankId: null,
    currentBankInfo: null,
    debug: false,
  });
});

// Fetch bank metadata ---------------------------------------------------------

async function fetchBankInfo(bankId) {
  if (!bankId) return null;

  try {
    // NOTE — No host is hardcoded; Canvas API URLs come from content script sniffing
    // The content script only sends the bankId; we reconstruct per domain here.
    //
    // We MUST detect the active tab’s origin, because Canvas APIs are origin-specific.

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url) return null;

    const url = new URL(tab.url);
    const apiEndpoint = `${url.origin.replace("instructure.com", "quiz-api-sin-prod.instructure.com")}/api/banks/${bankId}`;

    console.log("[CanvasExporter BG] Fetching bank metadata:", apiEndpoint);

    const res = await fetch(apiEndpoint, { credentials: "include" });
    if (!res.ok) {
      console.warn("[CanvasExporter BG] Metadata fetch failed:", res.status);
      return null;
    }

    const json = await res.json();
    return {
      id: json.id,
      title: json.title || "Untitled Bank",
      description: json.description || "",
    };
  } catch (err) {
    console.error("[CanvasExporter BG] Error fetching bank info:", err);
    return null;
  }
}

// Message handling ------------------------------------------------------------

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "BANK_CONTEXT_DETECTED") {
    console.log("[CanvasExporter BG] Bank detected:", msg.bankId, "via", msg.source);

    // Update current bank ID
    chrome.storage.local.set({ currentBankId: msg.bankId });

    // Fetch metadata in background
    fetchBankInfo(msg.bankId).then((info) => {
      if (info) {
        chrome.storage.local.set({ currentBankInfo: info });

        // Broadcast to popup or devtools
        chrome.runtime.sendMessage({
          type: "BANK_INFO_UPDATED",
          info,
        });
      }
    });

    sendResponse(true);
    return true; // indicates async response
  }
});
