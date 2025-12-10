(function () {
  console.log("[CanvasExporter] Initialization starting…");

  // ------------------------------------------------------
  //  Detect whether we are inside the Canvas tool iframe
  // ------------------------------------------------------
  const isToolIframe = window.frameElement && window.location.href.includes("/external_tools/");

  if (!isToolIframe) {
    console.log("[CanvasExporter] Not inside tool iframe — observers disabled.");
  } else {
    console.log("[CanvasExporter] Inside tool iframe — observers enabled.");
  }

  let detectedBank = null;
  let lastSent = null;

  function sendBank(bank) {
    if (!bank) return;
    if (lastSent && lastSent.id === bank.id) return; // avoid spam
    lastSent = bank;

    console.log("[CanvasExporter] Bank detected:", bank);

    window.dispatchEvent(new CustomEvent("CanvasExporter_BankDetected", { detail: bank }));
  }

  function tryParseBank(url) {
    // Match /api/banks/{id}
    const bankMatch = url.match(/\/api\/banks\/(\d+)/);
    if (bankMatch) return { id: Number(bankMatch[1]) };

    // Match shared_banks?entity_id=<id>
    const sharedMatch = url.match(/shared_banks.*entity_id=(\d+)/);
    if (sharedMatch) return { id: Number(sharedMatch[1]) };

    return null;
  }

  // -------- FETCH PATCH --------
  const origFetch = window.fetch;
  window.fetch = async function (...args) {
    const url = args[0]?.toString() || "";
    const bank = tryParseBank(url);
    if (bank) sendBank(bank);

    return origFetch.apply(this, args);
  };
  console.log("[CanvasExporter] fetch() patched");

  // -------- XHR PATCH --------
  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    const bank = tryParseBank(url);
    if (bank) sendBank(bank);

    return origOpen.call(this, method, url, ...rest);
  };
  console.log("[CanvasExporter] XHR patched");

  // ------------------------------------------------------
  // SAFE MUTATION OBSERVER — ONLY INSIDE TOOL IFRAME
  // ------------------------------------------------------

  function safeObserve(target, callback) {
    if (!(target instanceof Node)) {
      console.warn("[CanvasExporter] MutationObserver skipped — target not a Node:", target);
      return { disconnect() {} };
    }
    const obs = new MutationObserver(callback);
    obs.observe(target, { subtree: true, childList: true });
    return obs;
  }

  if (isToolIframe) {
    // Mutation observer for UI-based detection
    safeObserve(document.body, () => {
      const el = document.querySelector("[data-testid='item-bank-title'], h1");
      if (el) {
        const m = el.textContent?.match(/\b(\d+)\b/);
        if (m) sendBank({ id: Number(m[1]) });
      }
    });

    console.log("[CanvasExporter] MutationObserver running");
  }

  console.log("[CanvasExporter] Phase 3.4 page script active");
})();
