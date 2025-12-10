function refresh() {
  chrome.runtime.sendMessage({ type: "POPUP_REQUEST_BANK" }, (res) => {
    const box = document.getElementById("bankBox");

    if (!res || !res.currentBank) {
      box.textContent = "No bank detected";
      return;
    }

    box.textContent = "Detected Bank ID: " + res.currentBank;
  });
}

document.getElementById("refresh").onclick = refresh;

refresh();
