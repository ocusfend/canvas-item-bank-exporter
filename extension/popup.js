const status = document.getElementById("status");
const bankBox = document.getElementById("bankBox");
const bankIdEl = document.getElementById("bankId");

function refresh() {
  chrome.runtime.sendMessage({ type: "REQUEST_BANK" }, (bank) => {
    if (!bank) {
      status.textContent = "No bank detected";
      bankBox.style.display = "none";
      return;
    }

    status.textContent = "Bank detected!";
    bankBox.style.display = "block";
    bankIdEl.textContent = bank.id;
  });
}

document.getElementById("refreshBtn").onclick = refresh;

refresh();
