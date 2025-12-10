function refreshBank() {
  chrome.runtime.sendMessage({ type: "CANVAS_EXPORTER_GET_BANK" }, (res) => {
    const el = document.getElementById("bank");

    if (!res || !res.bank) {
      el.innerHTML = "<span class='sub'>No bank detected</span>";
      return;
    }

    el.innerHTML = `
      <div class="bank">Bank ${res.bank}</div>
      <div class="sub">Detected from LTI / API traffic</div>
    `;
  });
}

document.getElementById("refresh").addEventListener("click", refreshBank);

refreshBank();
