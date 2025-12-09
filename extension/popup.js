// Canvas New Quizzes Item Bank Exporter - Popup Script
// Phase 3.3 - Bank context display + debug toggle + refresh

document.addEventListener("DOMContentLoaded", async () => {
  const bankStatusEl = document.getElementById("bankStatus");
  const refreshBtn = document.getElementById("refreshBtn");
  const debugToggleEl = document.getElementById("debugToggle");
  const exportBtn = document.getElementById("exportBtn");

  // ==========================================
  // BANK CONTEXT DISPLAY
  // ==========================================

  function renderBankInfo(bank) {
    if (!bank || !bank.uuid) {
      bankStatusEl.className = "status-card none";
      bankStatusEl.innerHTML = `
        <div class="uuid">No bank detected</div>
        <div class="meta">Navigate to an Item Bank in Canvas</div>
      `;
      exportBtn.disabled = true;
      return;
    }

    const sourceLabels = {
      iframe: "🖼️ iframe",
      postMessage: "📨 postMessage",
      pmf: "🔀 PMF"
    };

    const sourceLabel = sourceLabels[bank.source] || bank.source;
    const modeLabel = bank.mode === "url" ? "URL" : "Payload";
    const modeBadgeClass = bank.mode === "url" ? "url" : "payload";
    const timeAgo = getTimeAgo(bank.timestamp);

    bankStatusEl.className = "status-card detected";
    bankStatusEl.innerHTML = `
      <div class="uuid">${bank.uuid}</div>
      <div class="meta">
        <span class="meta-item">${sourceLabel}</span>
        <span class="meta-badge ${modeBadgeClass}">${modeLabel}</span>
        <span class="meta-item">${timeAgo}</span>
      </div>
    `;
    exportBtn.disabled = false;
  }

  function getTimeAgo(timestamp) {
    if (!timestamp) return "";
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 5) return "just now";
    if (seconds < 60) return `${seconds}s ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
  }

  async function loadBankContext() {
    try {
      const result = await chrome.storage.session.get("lastDetectedBank");
      renderBankInfo(result.lastDetectedBank);
    } catch (err) {
      console.error("Failed to load bank context:", err);
      renderBankInfo(null);
    }
  }

  // Initial load
  await loadBankContext();

  // Refresh button handler (Refinement #8)
  refreshBtn.addEventListener("click", async () => {
    refreshBtn.textContent = "⏳";
    await loadBankContext();
    setTimeout(() => {
      refreshBtn.textContent = "🔄";
    }, 300);
  });

  // Listen for live updates while popup is open
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "BANK_CONTEXT_DETECTED") {
      renderBankInfo(msg);
    }
  });

  // ==========================================
  // DEBUG TOGGLE
  // ==========================================

  // Load current debug state
  try {
    const result = await chrome.storage.local.get("debug");
    debugToggleEl.checked = result.debug === true;
  } catch (err) {
    console.error("Failed to load debug state:", err);
  }

  // Handle toggle changes
  debugToggleEl.addEventListener("change", async () => {
    const enabled = debugToggleEl.checked;
    try {
      await chrome.storage.local.set({ debug: enabled });
      console.log("Debug mode:", enabled ? "ON" : "OFF");
    } catch (err) {
      console.error("Failed to save debug state:", err);
    }
  });

  // ==========================================
  // EXPORT BUTTON (Placeholder for Phase 4)
  // ==========================================

  exportBtn.addEventListener("click", () => {
    alert("Export functionality coming in Phase 4!");
  });
});
