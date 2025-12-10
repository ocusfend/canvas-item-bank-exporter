(function () {
  console.log("[CanvasExporter] Initialization starting…");

  // Global state for API base detection
  window.CanvasExporter_Global = window.CanvasExporter_Global || {
    apiBase: null,
    detectedBankId: null
  };

  const isToolIframe = window.frameElement && window.location.href.includes("/external_tools/");

  if (!isToolIframe) {
    console.log("[CanvasExporter] Not inside tool iframe — observers disabled.");
  } else {
    console.log("[CanvasExporter] Inside tool iframe — observers enabled.");
  }

  let detectedBank = null;
  let lastSent = null;
  let lastSentApiBase = null;

  function sendBank(bank) {
    if (!bank) return;
    if (lastSent && lastSent.id === bank.id) return;
    lastSent = bank;

    console.log("%c[CanvasExporter] Bank detected:", "color:#9c27b0;font-weight:bold", bank);

    window.dispatchEvent(new CustomEvent("CanvasExporter_BankDetected", { detail: bank }));
  }

  function emitApiBase(apiBase) {
    // Normalize trailing slash
    const normalizedBase = apiBase.endsWith('/') ? apiBase : apiBase + '/';
    
    if (lastSentApiBase === normalizedBase) return;
    lastSentApiBase = normalizedBase;
    window.CanvasExporter_Global.apiBase = normalizedBase;
    
    console.log("%c[CanvasExporter] API base detected:", "color:#ff9800;font-weight:bold", normalizedBase);
    
    window.dispatchEvent(new CustomEvent("CanvasExporter_ApiBaseDetected", { 
      detail: { apiBase: normalizedBase } 
    }));
  }

  function tryParseBank(url) {
    // Dynamic API base extraction - handles all regional variants
    // Matches: /api/banks/123, /quiz-lti-eu-prod/api/banks/123, /learnosity_proxy/api/banks/123
    const apiBaseMatch = url.match(/(.*\/api\/?)banks\/(\d+)/);
    if (apiBaseMatch) {
      emitApiBase(apiBaseMatch[1]);
      return { id: Number(apiBaseMatch[2]) };
    }

    // Fallback: shared_banks pattern
    const sharedMatch = url.match(/shared_banks.*entity_id=(\d+)/);
    if (sharedMatch) return { id: Number(sharedMatch[1]) };

    return null;
  }

  // -------- LAUNCH TOKEN CAPTURE --------
  let lastSentToken = null;

  function emitLaunchToken(launchToken, apiDomain) {
    const key = `${apiDomain}:${launchToken.slice(0, 20)}`;
    if (lastSentToken === key) return;
    lastSentToken = key;

    console.log("%c[CanvasExporter] Launch token captured for:", "color:#4caf50;font-weight:bold", apiDomain);

    window.dispatchEvent(new CustomEvent("CanvasExporter_AuthDetected", {
      detail: { launchToken, apiDomain }
    }));
  }

  // -------- FETCH PATCH --------
  const origFetch = window.fetch;
  window.fetch = async function (input, init = {}) {
    const url = input?.toString?.() || input?.url || "";
    const bank = tryParseBank(url);
    if (bank) sendBank(bank);

    // Capture launch_token from URL parameters
    if (url.includes('quiz-api') || url.includes('quiz-lti')) {
      try {
        const urlObj = new URL(url, window.location.origin);
        const launchToken = urlObj.searchParams.get('launch_token');
        
        if (launchToken) {
          emitLaunchToken(launchToken, urlObj.origin);
        }
      } catch (e) {
        // Ignore URL parsing errors
      }
    }

    return origFetch.apply(this, arguments);
  };
  console.log("[CanvasExporter] fetch() patched with launch token capture");

  // -------- XHR PATCH --------
  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    const bank = tryParseBank(url);
    if (bank) sendBank(bank);

    return origOpen.call(this, method, url, ...rest);
  };
  console.log("[CanvasExporter] XHR patched");

  // ========== API FETCH HANDLER (PAGE CONTEXT) ==========
  // This runs in the actual page context, so it has access to the page's
  // authenticated session and cookies - bypassing CORS issues

  function parseLinkHeader(header) {
    if (!header) return {};
    const links = {};
    const parts = header.split(',');
    for (const part of parts) {
      const match = part.match(/<([^>]+)>;\s*rel="([^"]+)"/);
      if (match) links[match[2]] = match[1];
    }
    return links;
  }

  async function paginatedFetchInPage(baseUrl) {
    const results = [];
    let url = baseUrl;
    
    while (url) {
      const response = await fetch(url, { credentials: 'include' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      
      const data = await response.json();
      results.push(...(Array.isArray(data) ? data : [data]));
      
      const linkHeader = response.headers.get('Link');
      const links = parseLinkHeader(linkHeader);
      url = links.next || null;
    }
    
    return results;
  }

  // Listen for API fetch requests from content script
  window.addEventListener("CanvasExporter_FetchRequest", async (e) => {
    const { requestId, url, paginated } = e.detail;
    console.log("[CanvasExporter] Page context fetch request:", { requestId, url, paginated });
    
    try {
      let data;
      if (paginated) {
        data = await paginatedFetchInPage(url);
      } else {
        const response = await fetch(url, { credentials: 'include' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        data = await response.json();
      }
      
      console.log("[CanvasExporter] Page context fetch success:", { requestId, dataLength: Array.isArray(data) ? data.length : 1 });
      
      window.dispatchEvent(new CustomEvent("CanvasExporter_FetchResponse", {
        detail: { requestId, success: true, data }
      }));
    } catch (error) {
      console.error("[CanvasExporter] Page context fetch error:", { requestId, error: error.message });
      
      window.dispatchEvent(new CustomEvent("CanvasExporter_FetchResponse", {
        detail: { requestId, success: false, error: error.message }
      }));
    }
  });

  console.log("[CanvasExporter] API fetch handler registered");

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
    safeObserve(document.body, () => {
      const el = document.querySelector("[data-testid='item-bank-title'], h1");
      if (el) {
        const m = el.textContent?.match(/\b(\d+)\b/);
        if (m) sendBank({ id: Number(m[1]) });
      }
    });

    console.log("[CanvasExporter] MutationObserver running");
  }

  console.log("[CanvasExporter] Phase 4 page script active");
})();
