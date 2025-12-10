function updateUI(bank) {
  const box = document.getElementById("bankStatus");

  if (!bank) {
    box.textContent = "No bank detected";
    return;
  }

  box.textContent = `Bank: ${bank.uuid}`;
}

document.getElementById("refresh").onclick = () => {
  chrome.runtime.sendMessage({ type: "POPUP_REQUEST_STATE" }, (res) => {
    updateUI(res?.bank || null);
  });
};

// Load on open
chrome.runtime.sendMessage({ type: "POPUP_REQUEST_STATE" }, (res) => {
  updateUI(res?.bank || null);
});

// Receive real-time updates
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "BANK_UPDATE") updateUI(msg.bank);
});
