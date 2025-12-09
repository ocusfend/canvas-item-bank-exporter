// Canvas New Quizzes Item Bank Exporter - Popup Script

document.addEventListener("DOMContentLoaded", () => {
  const pingBtn = document.getElementById("pingBtn");
  const responseEl = document.getElementById("response");

  pingBtn.addEventListener("click", async () => {
    responseEl.textContent = "Sending PING...";

    try {
      const response = await chrome.runtime.sendMessage({ type: "PING" });
      
      if (chrome.runtime.lastError) {
        throw new Error(chrome.runtime.lastError.message);
      }

      responseEl.textContent = JSON.stringify(response, null, 2);
    } catch (error) {
      responseEl.textContent = JSON.stringify({
        error: error.message || "Failed to communicate with background"
      }, null, 2);
    }
  });
});
