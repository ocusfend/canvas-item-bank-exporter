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

  // -------- BEARER TOKEN CAPTURE & STORAGE --------
  let lastSentToken = null;
  const capturedTokens = new Map(); // Store tokens for our own API calls

  function emitBearerToken(bearerToken, apiDomain, source) {
    const key = `${apiDomain}:${bearerToken.slice(0, 20)}`;
    if (lastSentToken === key) return;
    lastSentToken = key;

    // Store the token for our own API calls
    capturedTokens.set(apiDomain, bearerToken);
    
    // Also store with domain pattern matching for quiz-api
    // quiz-lti tokens work for quiz-api endpoints
    if (apiDomain.includes('quiz-lti')) {
      const apiDomain2 = apiDomain.replace('quiz-lti', 'quiz-api');
      capturedTokens.set(apiDomain2, bearerToken);
      console.log("%c[CanvasExporter] Token also mapped to:", "color:#4caf50", apiDomain2);
    }

    console.log("%c[CanvasExporter] ✓ Bearer token captured & stored!", "color:#4caf50;font-weight:bold;font-size:14px");
    console.log("%c  Source:", "color:#4caf50", source);
    console.log("%c  Domain:", "color:#4caf50", apiDomain);
    console.log("%c  Token preview:", "color:#4caf50", bearerToken.slice(0, 50) + "...");
    console.log("%c  Stored domains:", "color:#4caf50", [...capturedTokens.keys()]);

    window.dispatchEvent(new CustomEvent("CanvasExporter_AuthDetected", {
      detail: { bearerToken, apiDomain }
    }));
  }

  // Find the right token for a URL
  function findTokenForUrl(url) {
    try {
      const urlObj = new URL(url);
      const host = urlObj.origin;
      
      // Exact match
      if (capturedTokens.has(host)) {
        return capturedTokens.get(host);
      }
      
      // Find quiz-api → quiz-lti mapping
      for (const [domain, token] of capturedTokens) {
        if (host.includes('quiz-api') && domain.includes('quiz-lti')) {
          // Match region prefixes (e.g., sin-prod, eu-prod)
          const hostMatch = host.match(/quiz-api[.-]([^.]+)/);
          const domainMatch = domain.match(/quiz-lti[.-]([^.]+)/);
          if (hostMatch && domainMatch && hostMatch[1] === domainMatch[1]) {
            return token;
          }
        }
      }
      
      // Fallback to any quiz-lti token
      for (const [domain, token] of capturedTokens) {
        if (domain.includes('quiz-lti')) {
          return token;
        }
      }
    } catch (e) {
      console.warn("[CanvasExporter] findTokenForUrl error:", e);
    }
    return null;
  }

  // -------- FETCH PATCH --------
  const origFetch = window.fetch;
  window.fetch = async function (input, init = {}) {
    const url = input?.toString?.() || input?.url || "";
    const bank = tryParseBank(url);
    if (bank) sendBank(bank);

    // Log all quiz-related API calls for debugging
    if (url.includes('quiz') || url.includes('/api/')) {
      console.log("%c[CanvasExporter] API call:", "color:#2196f3", url.slice(0, 100));
    }

    // Make the actual request first
    const response = await origFetch.apply(this, arguments);

    // Capture SDK token from /sdk_token endpoint response
    if (url.includes('/sdk_token') || url.includes('sdk_token?')) {
      console.log("%c[CanvasExporter] sdk_token endpoint detected!", "color:#ff9800;font-weight:bold");
      console.log("%c  URL:", "color:#ff9800", url);
      console.log("%c  Status:", "color:#ff9800", response.status);
      
      try {
        const urlObj = new URL(url, window.location.origin);
        const apiDomain = urlObj.origin;
        
        // Clone response to read without consuming
        const clonedResponse = response.clone();
        const data = await clonedResponse.json();
        
        console.log("%c  Response keys:", "color:#ff9800", Object.keys(data));
        
        // Canvas SDK token response contains a "token" field
        if (data.token) {
          emitBearerToken(data.token, apiDomain, "sdk_token response");
        } else {
          console.warn("[CanvasExporter] sdk_token response has no 'token' field:", data);
        }
      } catch (e) {
        console.warn("[CanvasExporter] Failed to parse sdk_token response:", e);
      }
    }
    
    // Also capture Authorization headers from any request Canvas makes
    const headers = init?.headers;
    let authHeader = null;
    
    if (headers) {
      if (typeof headers.get === 'function') {
        authHeader = headers.get('Authorization') || headers.get('authorization');
      } else if (typeof headers === 'object') {
        authHeader = headers.Authorization || headers.authorization;
      }
    }
    
    if (authHeader && typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
      console.log("%c[CanvasExporter] Authorization header detected!", "color:#e91e63;font-weight:bold");
      console.log("%c  URL:", "color:#e91e63", url.slice(0, 80));
      
      try {
        const token = authHeader.replace('Bearer ', '');
        const urlObj = new URL(url, window.location.origin);
        emitBearerToken(token, urlObj.origin, "Authorization header");
      } catch (e) {
        console.warn("[CanvasExporter] Failed to extract token from header:", e);
      }
    }

    return response;
  };
  console.log("[CanvasExporter] fetch() patched with SDK token capture (debug mode)");

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

  async function paginatedFetchWithToken(baseUrl, headers) {
    const results = [];
    let url = baseUrl;
    
    while (url) {
      const response = await fetch(url, { 
        method: 'GET',
        headers,
        credentials: 'omit' // No cookies - use token instead to avoid CORS wildcard conflict
      });
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
      // Find the right token for this URL
      const token = findTokenForUrl(url);
      
      const headers = { 'Accept': 'application/json' };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
        console.log("[CanvasExporter] Using captured token for:", url.slice(0, 80));
      } else {
        console.warn("[CanvasExporter] No token available for:", url);
      }
      
      let data;
      if (paginated) {
        data = await paginatedFetchWithToken(url, headers);
      } else {
        const response = await fetch(url, { 
          method: 'GET',
          headers,
          credentials: 'omit' // No cookies - use token instead
        });
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
