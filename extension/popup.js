document.addEventListener("DOMContentLoaded", () => {
  const el = document.getElementById("bank-status");
  const btn = document.getElementById("refresh");

  function update() {
    chrome.runtime.sendMessage({ type: "GET_BANK_ID" }, (res) => {
      const bankId = res?.bankId;

      if (!bankId) {
        el.textContent = "No bank detected";
        return;
      }

      el.textContent = `Bank ID: ${bankId}`;
    });
  }

  btn.addEventListener("click", update);
  update();
});
