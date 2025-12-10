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
  // Store tokens with their authType: { token: string, authType: string | null, isJWT: boolean, capturedAt: number }
  const capturedTokens = new Map();
  
  // -------- RESPONSE CACHING --------
  // Cache successful API responses to avoid needing to replay with expired tokens
  const responseCache = new Map(); // { url -> { data, timestamp } }
  const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  // Smart cache lookup with URL normalization
  function findCachedResponse(url) {
    const now = Date.now();
    
    // Exact match first
    const exact = responseCache.get(url);
    if (exact && (now - exact.timestamp) < CACHE_TTL_MS) {
      console.log("%c[CanvasExporter] Cache exact hit:", "color:#00bcd4", url.slice(0, 80));
      return { data: exact.data, age: now - exact.timestamp };
    }
    
    // Try base URL match (strip query params)
    const baseUrl = url.split('?')[0];
    
    // Check if any cached URL matches this base
    for (const [cachedUrl, cached] of responseCache.entries()) {
      if ((now - cached.timestamp) < CACHE_TTL_MS) {
        const cachedBase = cachedUrl.split('?')[0];
        // Match if: requesting /bank_entries and cache has /bank_entries/search
        // OR: requesting /bank_entries/search and cache has /bank_entries
        if (cachedBase === baseUrl || 
            cachedBase.startsWith(baseUrl + '/search') ||
            baseUrl.startsWith(cachedBase + '/search') ||
            cachedBase.replace('/search', '') === baseUrl.replace('/search', '')) {
          console.log("%c[CanvasExporter] Cache fuzzy hit:", "color:#00bcd4", cachedUrl.slice(0, 80), "for", url.slice(0, 80));
          return { data: cached.data, age: now - cached.timestamp };
        }
      }
    }
    
    return null;
  }

  // Cache individual entries from list responses
  function cacheIndividualEntries(url, data) {
    if (!Array.isArray(data)) return;
    
    // Extract base URL for entries (e.g., /banks/123/bank_entries)
    const baseMatch = url.match(/(.*\/bank_entries)/);
    if (!baseMatch) return;
    
    const baseUrl = baseMatch[1].replace('/search', '');
    const now = Date.now();
    
    for (const entry of data) {
      if (entry.id) {
        const entryUrl = `${baseUrl}/${entry.id}`;
        responseCache.set(entryUrl, { data: entry, timestamp: now });
      }
      // Also cache by item ID if available
      if (entry.entry?.id) {
        const itemUrl = baseUrl.replace('/bank_entries', '/items') + `/${entry.entry.id}`;
        responseCache.set(itemUrl, { data: entry.entry, timestamp: now });
      }
    }
    console.log("%c[CanvasExporter] Cached", "color:#00bcd4", data.length, "individual entries from list");
  }

  function emitBearerToken(bearerToken, apiDomain, source, authType = null) {
    const isJWT = bearerToken.startsWith('eyJ');
    const key = `${apiDomain}:${bearerToken.slice(0, 20)}`;
    if (lastSentToken === key) return;
    lastSentToken = key;

    const tokenInfo = { token: bearerToken, authType, isJWT, capturedAt: Date.now() };

    // Store the token for our own API calls
    capturedTokens.set(apiDomain, tokenInfo);
    
    // Also store with domain pattern matching for quiz-api
    // quiz-lti tokens work for quiz-api endpoints
    if (apiDomain.includes('quiz-lti')) {
      const apiDomain2 = apiDomain.replace('quiz-lti', 'quiz-api');
      capturedTokens.set(apiDomain2, tokenInfo);
      console.log("%c[CanvasExporter] Token also mapped to:", "color:#4caf50", apiDomain2);
    }
    
    // Also map quiz-api back to quiz-lti
    if (apiDomain.includes('quiz-api')) {
      const ltiDomain = apiDomain.replace('quiz-api', 'quiz-lti');
      capturedTokens.set(ltiDomain, tokenInfo);
      console.log("%c[CanvasExporter] Token also mapped to:", "color:#4caf50", ltiDomain);
    }

    console.log("%c[CanvasExporter] ✓ Token captured & stored!", "color:#4caf50;font-weight:bold;font-size:14px");
    console.log("%c  Source:", "color:#4caf50", source);
    console.log("%c  Domain:", "color:#4caf50", apiDomain);
    console.log("%c  Is JWT:", "color:#4caf50", isJWT);
    console.log("%c  Authtype:", "color:#4caf50", authType || "(none)");
    console.log("%c  Token preview:", "color:#4caf50", bearerToken.slice(0, 80) + "...");
    console.log("%c  Stored domains:", "color:#4caf50", [...capturedTokens.keys()]);

    window.dispatchEvent(new CustomEvent("CanvasExporter_AuthDetected", {
      detail: { bearerToken, apiDomain, authType, isJWT }
    }));
  }

  // Find the right token for a URL - prioritize fresh JWT tokens
  function findTokenForUrl(url) {
    const FRESH_THRESHOLD = 30000; // 30 seconds
    const now = Date.now();
    
    try {
      const urlObj = new URL(url);
      const host = urlObj.origin;
      
      // First, try to find a FRESH JWT token (captured within last 30 seconds)
      for (const [domain, tokenInfo] of capturedTokens) {
        if (tokenInfo.isJWT && (now - tokenInfo.capturedAt) < FRESH_THRESHOLD) {
          // Check domain match for quiz endpoints
          if (host.includes('quiz-api') || host.includes('quiz-lti')) {
            const hostMatch = host.match(/quiz-(?:api|lti)[.-]([^.]+)/);
            const domainMatch = domain.match(/quiz-(?:api|lti)[.-]([^.]+)/);
            if (hostMatch && domainMatch && hostMatch[1] === domainMatch[1]) {
              console.log("[CanvasExporter] Found FRESH JWT match for region:", hostMatch[1], "age:", now - tokenInfo.capturedAt, "ms");
              return tokenInfo;
            }
          }
          // If target matches domain exactly
          if (domain === host) {
            console.log("[CanvasExporter] Found FRESH exact JWT match for:", host);
            return tokenInfo;
          }
        }
      }
      
      // Second, try exact domain match for any JWT
      if (capturedTokens.has(host)) {
        const tokenInfo = capturedTokens.get(host);
        if (tokenInfo.isJWT) {
          console.log("[CanvasExporter] Found exact JWT match for:", host, "age:", now - tokenInfo.capturedAt, "ms");
          return tokenInfo;
        }
      }
      
      // Third, look for any JWT token that matches quiz-api domain pattern
      for (const [domain, tokenInfo] of capturedTokens) {
        if (tokenInfo.isJWT) {
          if (host.includes('quiz-api') || host.includes('quiz-lti')) {
            const hostMatch = host.match(/quiz-(?:api|lti)[.-]([^.]+)/);
            const domainMatch = domain.match(/quiz-(?:api|lti)[.-]([^.]+)/);
            if (hostMatch && domainMatch && hostMatch[1] === domainMatch[1]) {
              console.log("[CanvasExporter] Found JWT match for region:", hostMatch[1], "age:", now - tokenInfo.capturedAt, "ms");
              return tokenInfo;
            }
          }
        }
      }
      
      // Fallback to any JWT token
      for (const [domain, tokenInfo] of capturedTokens) {
        if (tokenInfo.isJWT) {
          console.log("[CanvasExporter] Using fallback JWT from:", domain, "age:", now - tokenInfo.capturedAt, "ms");
          return tokenInfo;
        }
      }
      
      // If no JWT, try exact match for non-JWT
      if (capturedTokens.has(host)) {
        return capturedTokens.get(host);
      }
      
      // Find quiz-api → quiz-lti mapping for non-JWT
      for (const [domain, tokenInfo] of capturedTokens) {
        if (host.includes('quiz-api') && domain.includes('quiz-lti')) {
          const hostMatch = host.match(/quiz-api[.-]([^.]+)/);
          const domainMatch = domain.match(/quiz-lti[.-]([^.]+)/);
          if (hostMatch && domainMatch && hostMatch[1] === domainMatch[1]) {
            return tokenInfo;
          }
        }
      }
      
      // Fallback to any token
      for (const [domain, tokenInfo] of capturedTokens) {
        return tokenInfo;
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

    // Capture Authorization headers BEFORE making the request
    const headers = init?.headers;
    let authHeader = null;
    let authType = null;
    
    if (headers) {
      if (typeof headers.get === 'function') {
        authHeader = headers.get('Authorization') || headers.get('authorization');
        authType = headers.get('Authtype') || headers.get('authtype');
      } else if (typeof headers === 'object') {
        authHeader = headers.Authorization || headers.authorization;
        authType = headers.Authtype || headers.authtype;
      }
    }
    
    // Capture JWT tokens (start with eyJ) - these are the full tokens Canvas uses
    if (authHeader && typeof authHeader === 'string') {
      let token = authHeader;
      
      // Strip "Bearer " prefix if present
      if (token.startsWith('Bearer ')) {
        token = token.replace('Bearer ', '');
      }
      
      // Prioritize JWT tokens (start with eyJ)
      if (token.startsWith('eyJ')) {
        console.log("%c[CanvasExporter] ★ JWT Authorization detected!", "color:#e91e63;font-weight:bold;font-size:14px");
        console.log("%c  URL:", "color:#e91e63", url.slice(0, 100));
        console.log("%c  Authtype:", "color:#e91e63", authType || "(none)");
        
        try {
          const urlObj = new URL(url, window.location.origin);
          emitBearerToken(token, urlObj.origin, "JWT Authorization header", authType);
        } catch (e) {
          console.warn("[CanvasExporter] Failed to extract JWT:", e);
        }
      } else if (token.length > 20) {
        // Also capture non-JWT tokens as fallback
        console.log("%c[CanvasExporter] Non-JWT Authorization header detected", "color:#ff9800");
        try {
          const urlObj = new URL(url, window.location.origin);
          emitBearerToken(token, urlObj.origin, "Authorization header", authType);
        } catch (e) {
          console.warn("[CanvasExporter] Failed to extract token:", e);
        }
      }
    }

    // Make the actual request
    const response = await origFetch.apply(this, arguments);
    
    // Cache successful API responses for quiz endpoints
    if (response.ok && (url.includes('/api/banks/') || url.includes('/api/items') || url.includes('/api/entries'))) {
      try {
        const clonedResponse = response.clone();
        const data = await clonedResponse.json();
        responseCache.set(url, { data, timestamp: Date.now() });
        console.log("%c[CanvasExporter] Cached response for:", "color:#00bcd4", url.slice(0, 100));
      } catch (e) {
        // Ignore cache errors
      }
    }

    // Capture SDK token from /sdk_token endpoint response (fallback)
    if (url.includes('/sdk_token') || url.includes('sdk_token?')) {
      console.log("%c[CanvasExporter] sdk_token endpoint detected!", "color:#ff9800;font-weight:bold");
      
      try {
        const urlObj = new URL(url, window.location.origin);
        const apiDomain = urlObj.origin;
        
        // Clone response to read without consuming
        const clonedResponse = response.clone();
        const data = await clonedResponse.json();
        
        // Canvas SDK token response contains a "token" field
        if (data.token) {
          emitBearerToken(data.token, apiDomain, "sdk_token response", null);
        }
      } catch (e) {
        console.warn("[CanvasExporter] Failed to parse sdk_token response:", e);
      }
    }

    return response;
  };
  console.log("[CanvasExporter] fetch() patched with JWT token capture");

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
      // Check cache first using smart lookup (handles URL variations like /search)
      const cached = findCachedResponse(url);
      if (cached) {
        console.log("%c[CanvasExporter] ★ Cache HIT for:", "color:#00bcd4;font-weight:bold", url.slice(0, 80));
        console.log("[CanvasExporter] Cache age:", Math.round(cached.age / 1000), "seconds");
        
        window.dispatchEvent(new CustomEvent("CanvasExporter_FetchResponse", {
          detail: { requestId, success: true, data: cached.data }
        }));
        return;
      }
      
      // Find the right token for this URL
      const tokenInfo = findTokenForUrl(url);
      
      const headers = { 
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      };
      
      if (tokenInfo && tokenInfo.token) {
        // JWT tokens (eyJ...) go without "Bearer" prefix, just like Canvas does
        if (tokenInfo.isJWT) {
          headers['Authorization'] = tokenInfo.token; // No "Bearer" prefix for JWT
          if (tokenInfo.authType) {
            headers['Authtype'] = tokenInfo.authType; // Include Authtype header
          }
          console.log("[CanvasExporter] Using JWT token with Authtype:", tokenInfo.authType);
        } else {
          // Non-JWT tokens use Bearer prefix
          headers['Authorization'] = `Bearer ${tokenInfo.token}`;
        }
        console.log("[CanvasExporter] Token applied for:", url.slice(0, 80));
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
      
      // Cache the response
      responseCache.set(url, { data, timestamp: Date.now() });
      
      // Also cache individual entries for later lookups
      cacheIndividualEntries(url, data);
      
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

  console.log("[CanvasExporter] Phase 4 page script active (JWT capture enabled)");
})();
