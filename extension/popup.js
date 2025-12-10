// ============================================================================
// popup.js — Phase 4
// Live UI updates for detected item bank
// ============================================================================

const bankTitleEl = document.getElementById("bank-title");
const bankIdEl = document.getElementById("bank-id");
const bankBox = document.getElementById("bank-box");

const debugToggle = document.getElementById("debug-toggle");

// ---------------------------------------------------------------------------
// Load stored state on popup open
// ---------------------------------------------------------------------------

chrome.storage.local.get(["currentBankId", "currentBankInfo", "debug"], (s) => {
  updateBankUI(s.currentBankId, s.currentBankInfo);
  debugToggle.checked = s.debug === true;
});

// ---------------------------------------------------------------------------
// Debug Mode toggle
// ---------------------------------------------------------------------------

debugToggle.addEventListener("change", () => {
  chrome.storage.local.set({ debug: debugToggle.checked });
});

// ---------------------------------------------------------------------------
// UI update function
// ---------------------------------------------------------------------------

function updateBankUI(bankId, info) {
  if (!bankId) {
    bankTitleEl.textContent = "No bank detected";
    bankIdEl.textContent = "Navigate to an Item Bank in Canvas";
    bankBox.classList.add("empty");
    return;
  }

  bankBox.classList.remove("empty");

  bankTitleEl.textContent = info?.title || "Untitled Bank";
  bankIdEl.textContent = `Bank ID: ${bankId}`;
}

// ---------------------------------------------------------------------------
// Real-time messages from background
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "BANK_INFO_UPDATED") {
    updateBankUI(msg.info.id, msg.info);
  }
});
