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
    // === Classic Quiz Question Bank detection ===
    // Patterns: /courses/:courseId/question_banks/:bankId
    const classicWithCourse = url.match(/\/courses\/(\d+)\/question_banks\/(\d+)/);
    if (classicWithCourse) {
      return { 
        id: classicWithCourse[2], 
        type: "classic", 
        courseId: classicWithCourse[1] 
      };
    }
    
    // Shared question bank (no course context)
    const classicShared = url.match(/\/question_banks\/(\d+)/);
    if (classicShared && !url.includes('/api/')) {
      return { 
        id: classicShared[1], 
        type: "classic", 
        courseId: null 
      };
    }
    
    // === New Quiz Item Bank detection ===
    // Dynamic API base extraction - handles all regional variants
    // Matches: /api/banks/123, /quiz-lti-eu-prod/api/banks/123, /learnosity_proxy/api/banks/123
    const apiBaseMatch = url.match(/(.*\/api\/?)banks\/(\d+)/);
    if (apiBaseMatch) {
      emitApiBase(apiBaseMatch[1]);
      return { id: Number(apiBaseMatch[2]), type: "item_bank" };
    }

    // Fallback: shared_banks pattern
    const sharedMatch = url.match(/shared_banks.*entity_id=(\d+)/);
    if (sharedMatch) return { id: Number(sharedMatch[1]), type: "item_bank" };

    return null;
  }
  
  // Page-load detection for Classic banks
  (function detectClassicBankOnLoad() {
    const pathname = window.location.pathname;
    
    const courseMatch = pathname.match(/\/courses\/(\d+)\/question_banks\/(\d+)/);
    if (courseMatch) {
      sendBank({ id: courseMatch[2], type: "classic", courseId: courseMatch[1] });
      return;
    }
    
    const sharedMatch = pathname.match(/\/question_banks\/(\d+)/);
    if (sharedMatch) {
      sendBank({ id: sharedMatch[1], type: "classic", courseId: null });
    }
  })();

  // -------- BEARER TOKEN CAPTURE & STORAGE --------
  let lastSentToken = null;
  // Store tokens with their authType: { token: string, authType: string | null, isJWT: boolean, capturedAt: number }
  // CRITICAL: Use window-level storage to persist across script re-injections
  if (!window.__canvasExporterTokens) {
    window.__canvasExporterTokens = new Map();
  }
  const capturedTokens = window.__canvasExporterTokens;
  
  // -------- RESPONSE CACHING --------
  // Cache successful API responses to avoid needing to replay with expired tokens
  // CRITICAL: Use window-level storage to persist across script re-injections
  if (!window.__canvasExporterCache) {
    window.__canvasExporterCache = new Map();
  }
  const responseCache = window.__canvasExporterCache;
  const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
  
  // Log persistence status
  console.log("%c[CanvasExporter] Cache persistence:", "color:#9c27b0", 
    "tokens:", capturedTokens.size, 
    "cached responses:", responseCache.size);

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

  // Find the right token for a URL - accept any JWT token (don't reject based on age)
  function findTokenForUrl(url) {
    const now = Date.now();
    
    try {
      const urlObj = new URL(url);
      const host = urlObj.origin;
      
      // First, try exact domain match for any JWT
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
    
    // Cache successful API responses for quiz endpoints - capture EVERYTHING
    if (response.ok && (url.includes('/api/') || url.includes('/banks/') || url.includes('/items') || url.includes('/entries'))) {
      try {
        const clonedResponse = response.clone();
        const data = await clonedResponse.json();
        responseCache.set(url, { data, timestamp: Date.now() });
        console.log("%c[CanvasExporter] Cached response for:", "color:#00bcd4", url.slice(0, 100));
        
        // Also cache individual entries from list responses immediately
        // Handle both array responses and {total, entries: [...]} object responses
        if (url.includes('/bank_entries')) {
          const entriesArray = data.entries || (Array.isArray(data) ? data : null);
          if (entriesArray && entriesArray.length > 0) {
            cacheIndividualEntries(url, entriesArray);
            console.log("%c[CanvasExporter] Pre-cached", "color:#00bcd4", entriesArray.length, "individual entries from", url.includes('search') ? 'search' : 'list');
          }
        }
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
      // Handle Canvas bank_entries response format: {total, entries: [...]}
      const items = data.entries || (Array.isArray(data) ? data : [data]);
      results.push(...items);
      
      console.log("%c[CanvasExporter] Paginated fetch got", "color:#00bcd4", items.length, "items from", url.slice(0, 80));
      
      const linkHeader = response.headers.get('Link');
      const links = parseLinkHeader(linkHeader);
      url = links.next || null;
    }
    
    return results;
  }

  // Listen for API fetch requests from content script
  window.addEventListener("CanvasExporter_FetchRequest", async (e) => {
    const { requestId, url, paginated } = e.detail;
    
    // CRITICAL: Only respond if this frame has captured tokens
    // This prevents multiple frames from responding and ensures we use the correct session
    if (capturedTokens.size === 0) {
      console.log("[CanvasExporter] No tokens in this frame, ignoring fetch request");
      return; // Silently ignore - another frame with tokens should handle it
    }
    
    console.log("[CanvasExporter] Page context fetch request (has tokens):", { requestId, url: url.slice(0, 80), paginated });
    console.log("[CanvasExporter] Available tokens:", [...capturedTokens.keys()]);
    
    try {
      // CACHE-FIRST STRATEGY: Check cache and return immediately if found
      const cached = findCachedResponse(url);
      if (cached) {
        console.log("%c[CanvasExporter] ★ CACHE HIT - returning immediately:", "color:#00bcd4;font-weight:bold", url.slice(0, 120));
        console.log("[CanvasExporter] Cache age:", Math.round(cached.age / 1000), "seconds");

        let responseData = cached.data;

        // CRITICAL FIX:
        // Canvas search responses look like: { total, entries, filters }
        // Fresh paginated fetches return an array.
        // Cache must match fresh fetch format.
        if (paginated && responseData && typeof responseData === "object" && !Array.isArray(responseData)) {
          // Normalize to an array of entries
          responseData = responseData.entries || [];
          console.log("[CanvasExporter] Extracted", responseData.length, "entries from cached object for paginated request");
        }

        window.dispatchEvent(new CustomEvent("CanvasExporter_FetchResponse", {
          detail: { requestId, success: true, data: responseData }
        }));
        return; // CRITICAL: Stop here, don't make network call
      }
      
      // No cache - must make network request
      console.log("%c[CanvasExporter] Cache MISS - attempting network fetch:", "color:#ff9800", url.slice(0, 80));
      
      // Find the right token for this URL (accept any available token)
      const tokenInfo = findTokenForUrl(url);
      
      if (!tokenInfo || !tokenInfo.token) {
        // No token available - this will likely fail
        console.error("%c[CanvasExporter] ✗ No token available! Network request will likely fail.", "color:#f44336;font-weight:bold");
        console.error("[CanvasExporter] Please refresh the Canvas page to capture a fresh token.");
        throw new Error("TOKEN_EXPIRED: No valid authentication token available. Please refresh the Canvas page and try again.");
      }
      
      const headers = { 
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      };
      
      // JWT tokens (eyJ...) go without "Bearer" prefix, just like Canvas does
      if (tokenInfo.isJWT) {
        headers['Authorization'] = tokenInfo.token; // No "Bearer" prefix for JWT
        if (tokenInfo.authType) {
          headers['Authtype'] = tokenInfo.authType; // Include Authtype header
        }
        console.log("[CanvasExporter] Using JWT token (age:", Math.round((Date.now() - tokenInfo.capturedAt) / 1000), "seconds)");
      } else {
        // Non-JWT tokens use Bearer prefix
        headers['Authorization'] = `Bearer ${tokenInfo.token}`;
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
        
        if (response.status === 401) {
          console.error("%c[CanvasExporter] ✗ HTTP 401 Unauthorized - token expired!", "color:#f44336;font-weight:bold");
          throw new Error("TOKEN_EXPIRED: Authentication failed (401). Please refresh the Canvas page and try again.");
        }
        
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

  // ------------------------------------------------------
  // BATCH EXPORT: Bank List Page Detection
  // ------------------------------------------------------

  // Wait for Canvas AJAX content to load before scraping
  async function waitForBankElements(maxWaitMs = 5000) {
    const startTime = Date.now();
    
    while (Date.now() - startTime < maxWaitMs) {
      const banks = document.querySelectorAll('.question_bank[id^="question_bank_"]:not(#question_bank_blank)');
      if (banks.length > 0) {
        // Extra wait to ensure all banks are loaded
        await new Promise(r => setTimeout(r, 200));
        return document.querySelectorAll('.question_bank[id^="question_bank_"]:not(#question_bank_blank)');
      }
      await new Promise(r => setTimeout(r, 100));
    }
    
    return document.querySelectorAll('.question_bank[id^="question_bank_"]:not(#question_bank_blank)');
  }

  function scrapeBankListFromDivs(bankDivs, courseId) {
    const banks = [];
    
    bankDivs.forEach(div => {
      const idMatch = div.id?.match(/question_bank_(\d+)/);
      if (!idMatch) return;
      
      const bankId = idMatch[1];
      const titleEl = div.querySelector('.header_content a.title');
      const title = titleEl?.textContent?.trim() || `Bank ${bankId}`;
      
      // Localize-insensitive: extract first number (works with "12 Questions", "12 Preguntas", etc.)
      const contentDiv = div.querySelector('.content > div:first-child');
      const text = contentDiv?.textContent || "0";
      const countMatch = text.match(/(\d+)/);
      const questionCount = countMatch ? parseInt(countMatch[1], 10) : 0;
      
      banks.push({
        id: bankId,
        title,
        questionCount,
        courseId,
        type: 'classic'
      });
    });
    
    return banks;
  }

  // Detect bank list page on load
  async function detectBankListOnLoad() {
    const pathname = window.location.pathname;
    
    // Match: /courses/:courseId/question_banks (exactly, not /question_banks/:id)
    const listMatch = pathname.match(/^\/courses\/(\d+)\/question_banks\/?$/);
    if (!listMatch) return;
    
    const courseId = listMatch[1];
    
    // Wait for DOM to be ready (Canvas AJAX)
    if (document.readyState !== 'complete') {
      await new Promise(r => window.addEventListener('load', r, { once: true }));
    }
    
    // Wait for bank elements to appear
    const bankDivs = await waitForBankElements();
    
    const banks = scrapeBankListFromDivs(bankDivs, courseId);
    
    if (banks.length > 0) {
      // Sort deterministically by title
      banks.sort((a, b) => a.title.localeCompare(b.title));
      
      console.log("%c[CanvasExporter] Bank list page detected:", "color:#9c27b0;font-weight:bold", banks.length, "banks");
      window.dispatchEvent(new CustomEvent("CanvasExporter_BankListDetected", { 
        detail: { courseId, banks } 
      }));
    }
  }

  // Call bank list detection
  detectBankListOnLoad();

  console.log("[CanvasExporter] Phase 4 page script active (JWT capture + batch export enabled)");
})();
