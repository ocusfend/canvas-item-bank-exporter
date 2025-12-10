import { 
  isSupported, mapCanvasTypeToQBType,
  sanitizeFilename, debugLog,
  normalizeApiBase, API_BASE_CANDIDATES, summarizeSkippedItems
} from './utils.js';

// ========== STATE ==========
let latestBank = null;
let detectedApiBase = null;
let capturedTokens = new Map();

// ========== TOKEN DOMAIN MATCHING ==========
function findTokenForUrl(url) {
  debugLog("AUTH", `Looking for token for: ${url}`);
  debugLog("AUTH", `Available tokens: ${capturedTokens.size}`);
  
  if (capturedTokens.size === 0) {
    debugLog("AUTH", "No tokens stored!");
    return null;
  }
  
  // Log all stored domains
  for (const [domain, auth] of capturedTokens) {
    debugLog("AUTH", `  Stored domain: ${domain} (token: ${auth.bearerToken?.substring(0, 20)}...)`);
  }
  
  try {
    const urlObj = new URL(url);
    const targetHost = urlObj.hostname;
    
    // First try exact match
    for (const [domain, auth] of capturedTokens) {
      try {
        const authHost = new URL(domain).hostname;
        if (authHost === targetHost) {
          debugLog("AUTH", `Exact token match for ${targetHost}`);
          return auth.bearerToken;
        }
      } catch (e) {
        continue;
      }
    }
    
    // Try quiz-lti to quiz-api mapping
    for (const [domain, auth] of capturedTokens) {
      try {
        const authHost = new URL(domain).hostname;
        
        if (targetHost.includes('quiz-api') && authHost.includes('quiz-lti')) {
          const ltiMatch = authHost.match(/^(.+?)\.quiz-lti-(.+)\.instructure\.com$/);
          const apiMatch = targetHost.match(/^(.+?)\.quiz-api-(.+)\.instructure\.com$/);
          
          if (ltiMatch && apiMatch && ltiMatch[1] === apiMatch[1] && ltiMatch[2] === apiMatch[2]) {
            debugLog("AUTH", `Matched quiz-lti token for ${targetHost}`);
            return auth.bearerToken;
          }
        }
        
        // Also try reverse: quiz-api token for quiz-api URL
        if (targetHost.includes('quiz-api') && authHost.includes('quiz-api')) {
          debugLog("AUTH", `Matched quiz-api token for ${targetHost}`);
          return auth.bearerToken;
        }
      } catch (e) {
        continue;
      }
    }
    
    // Fallback: any quiz-related token for quiz-api URL
    if (targetHost.includes('quiz-api')) {
      for (const [domain, auth] of capturedTokens) {
        if (domain.includes('quiz-lti') || domain.includes('quiz-api')) {
          debugLog("AUTH", `Fallback quiz token for ${targetHost}`);
          return auth.bearerToken;
        }
      }
    }
    
    // Last resort: use first available token
    if (capturedTokens.size > 0) {
      const firstToken = capturedTokens.values().next().value;
      debugLog("AUTH", `Using first available token for ${targetHost}`);
      return firstToken.bearerToken;
    }
  } catch (e) {
    debugLog("AUTH", `Token lookup error: ${e.message}`);
  }
  
  return null;
}

// ========== DIRECT API FETCH (Using background's stored tokens) ==========
async function directApiFetch(url) {
  const token = findTokenForUrl(url);
  
  if (!token) {
    throw new Error('TOKEN_EXPIRED: No valid authentication token available');
  }
  
  debugLog("FETCH", `Direct fetch: ${url.substring(0, 80)}...`);
  
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    mode: 'cors',
    credentials: 'omit'
  });
  
  if (response.status === 401 || response.status === 403) {
    throw new Error('TOKEN_EXPIRED: Authentication failed');
  }
  
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
  
  return response.json();
}

async function directPaginatedFetch(url) {
  const allResults = [];
  let currentUrl = url;
  let pageCount = 0;
  const MAX_PAGES = 50;
  
  while (currentUrl && pageCount < MAX_PAGES) {
    pageCount++;
    debugLog("PAGE", `Fetching page ${pageCount}: ${currentUrl.substring(0, 60)}...`);
    
    const token = findTokenForUrl(currentUrl);
    if (!token) {
      throw new Error('TOKEN_EXPIRED: No valid authentication token available');
    }
    
    const response = await fetch(currentUrl, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      mode: 'cors',
      credentials: 'omit'
    });
    
    if (response.status === 401 || response.status === 403) {
      throw new Error('TOKEN_EXPIRED: Authentication failed');
    }
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json();
    
    // Handle array response
    if (Array.isArray(data)) {
      allResults.push(...data);
    } else if (data.data && Array.isArray(data.data)) {
      allResults.push(...data.data);
    } else if (data.items && Array.isArray(data.items)) {
      allResults.push(...data.items);
    } else {
      allResults.push(data);
    }
    
    // Check for next page in Link header
    const linkHeader = response.headers.get('Link');
    currentUrl = null;
    
    if (linkHeader) {
      const nextMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
      if (nextMatch) {
        currentUrl = nextMatch[1];
      }
    }
    
    // Also check for next in response body
    if (!currentUrl && data.meta?.next) {
      currentUrl = data.meta.next;
    }
  }
  
  debugLog("PAGE", `Pagination complete: ${allResults.length} total items from ${pageCount} pages`);
  return allResults;
}

async function trySequentialDirect(fetchers) {
  const errors = [];
  for (const fetcher of fetchers) {
    try {
      return await fetcher();
    } catch (e) {
      errors.push(e.message);
      // If token expired, don't try other endpoints - they'll all fail
      if (e.message.includes('TOKEN_EXPIRED')) {
        throw e;
      }
      continue;
    }
  }
  throw new Error(`All API endpoints failed: ${errors.join(', ')}`);
}

// ========== MESSAGE HANDLERS ==========
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.type) {
    case "BANK_DETECTED":
      latestBank = msg.bank;
      debugLog("BANK", `Bank stored: ${msg.bank.id}`);
      break;

    case "API_BASE_DETECTED":
      detectedApiBase = normalizeApiBase(msg.apiBase);
      debugLog("API", `Base path detected: ${detectedApiBase}`);
      break;

    case "AUTH_DETECTED":
      capturedTokens.set(msg.apiDomain, {
        bearerToken: msg.bearerToken,
        timestamp: Date.now()
      });
      debugLog("AUTH", `Token stored for ${msg.apiDomain} (${capturedTokens.size} total)`);
      break;

    case "REQUEST_BANK":
      sendResponse({ 
        bank: latestBank, 
        apiBase: detectedApiBase,
        hasAuth: capturedTokens.size > 0,
        authCount: capturedTokens.size,
        authDomains: Array.from(capturedTokens.keys())
      });
      break;

    case "EXPORT_BANK":
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const activeTabId = tabs[0]?.id;
        if (activeTabId) {
          exportBank(msg.bankId, activeTabId);
        } else {
          sendError(null, "No active tab found. Please ensure you're on a Canvas quiz page.");
        }
      });
      break;
  }
});

// ========== PROGRESS MESSAGING ==========
function sendProgress(tabId, step, message) {
  chrome.runtime.sendMessage({ channel: "export", type: "progress", step, message });
  debugLog("PROG", `[${step}/4] ${message}`);
}

function sendItemProgress(current, total, itemTitle) {
  chrome.runtime.sendMessage({ 
    channel: "export", 
    type: "item-progress", 
    current, 
    total, 
    itemTitle 
  });
}

function sendComplete(tabId, message, skippedItems = []) {
  chrome.runtime.sendMessage({ 
    channel: "export", 
    type: "complete", 
    message,
    skippedItems
  });
  debugLog("DONE", message);
}

function sendError(tabId, error) {
  chrome.runtime.sendMessage({ channel: "export", type: "error", error });
  debugLog("ERR", error);
}

// ========== API BASE RESOLUTION ==========
async function resolveApiBase(tabId, bankId) {
  if (detectedApiBase) {
    debugLog("API", `Using detected base: ${detectedApiBase}`);
    return detectedApiBase;
  }
  
  for (const domain of capturedTokens.keys()) {
    if (domain.includes('quiz-lti')) {
      const apiBase = domain.replace('quiz-lti', 'quiz-api') + '/api/';
      debugLog("API", `Derived API base from token: ${apiBase}`);
      return apiBase;
    }
  }
  
  debugLog("API", "No detected base, probing candidates...");
  
  for (const candidate of API_BASE_CANDIDATES) {
    try {
      const testUrl = `${candidate}banks/${bankId}`;
      await authenticatedFetch(testUrl);
      debugLog("API", `Found working base: ${candidate}`);
      detectedApiBase = candidate;
      return candidate;
    } catch (e) {
      continue;
    }
  }
  
  return "/api/";
}

// ========== EXPORT PIPELINE ==========
async function exportBank(bankId, tabId) {
  console.time("export");
  
  if (!tabId) {
    sendError(null, "No active tab found.");
    return;
  }
  
  try {
    // Validate we have tokens before starting
    if (capturedTokens.size === 0) {
      sendError(tabId, "🔑 No authentication tokens captured. Please refresh the Canvas page and try again.");
      return;
    }
    
    debugLog("AUTH", `Starting export with ${capturedTokens.size} captured tokens`);
    
    // Step 1: Resolve API base
    sendProgress(tabId, 1, "Detecting API endpoint...");
    const apiBase = await resolveApiBase(tabId, bankId);
    
    // Step 2: Fetch bank metadata (now using direct fetch)
    sendProgress(tabId, 1, "Fetching bank metadata...");
    const bank = await fetchBankMetadata(apiBase, bankId);
    debugLog("BANK", `Bank title: ${bank.title || bank.name || bankId}`);
    
    // Step 3: Fetch all items (now using direct fetch)
    sendProgress(tabId, 2, "Fetching items...");
    let entries;
    try {
      entries = await fetchAllEntries(apiBase, bankId);
    } catch (e) {
      // Check for token expiration errors
      if (e.message.includes('TOKEN_EXPIRED') || e.message.includes('401')) {
        sendError(tabId, "⏰ Authentication expired. Please refresh the Canvas page and click Export again within 30 seconds of page load.");
        return;
      }
      throw e;
    }
    
    // Debug: Log what we actually got
    console.log("[Export Debug] entries count:", entries.length);
    console.log("[Export Debug] first entry:", entries[0]);
    console.log("[Export Debug] first entry.entry:", entries[0]?.entry);
    debugLog("FETCH", `Found ${entries.length} entries`);
    
    // Validate that we actually got items
    if (!entries || entries.length === 0) {
      sendError(tabId, "📭 No items found. Please ensure you're on a Canvas Item Bank page with questions.");
      return;
    }
    
    // Step 4: Process items (now using direct fetch)
    sendProgress(tabId, 3, `Processing ${entries.length} items...`);
    const itemDefinitions = await fetchItemDefinitions(apiBase, bankId, entries);
    
    // Categorize items
    const { supported, unsupported } = categorizeItems(itemDefinitions);
    
    if (unsupported.length > 0) {
      debugLog("SKIP", `Skipping ${unsupported.length} items: ${summarizeSkippedItems(unsupported)}`);
    }
    
    // Step 5: Generate JSON and download
    sendProgress(tabId, 4, "Creating JSON file...");
    const jsonData = generateJSONExport(bank, supported, unsupported);
    
    const filename = sanitizeFilename(bank.title || bank.name || `bank_${bankId}`) + "_export.json";
    const jsonString = JSON.stringify(jsonData, null, 2);
    // Convert to base64 data URL (works in MV3 service workers)
    const base64 = btoa(unescape(encodeURIComponent(jsonString)));
    const dataUrl = `data:application/json;base64,${base64}`;
    
    chrome.downloads.download({
      url: dataUrl,
      filename: filename,
      saveAs: true
    });
    
    sendComplete(
      tabId, 
      `Export complete! ${supported.length} questions exported.`,
      unsupported.map(i => ({ id: i.id, type: i.question_type || i.interaction_type }))
    );
    
  } catch (error) {
    console.error("[Export Error]", error);
    // Provide user-friendly error messages
    if (error.message.includes('TOKEN_EXPIRED') || error.message.includes('401')) {
      sendError(tabId, "⏰ Authentication expired. Please refresh the Canvas page and click Export again within 30 seconds of page load.");
    } else if (error.message.includes('All API endpoints failed')) {
      sendError(tabId, "🔌 Could not connect to Canvas API. Please refresh the page and try again.");
    } else {
      sendError(tabId, error.message);
    }
  }
  
  console.timeEnd("export");
}

// ========== JSON EXPORT GENERATION ==========
function generateJSONExport(bank, supported, unsupported) {
  return {
    exportVersion: "1.0",
    exportedAt: new Date().toISOString(),
    bank: {
      id: bank.id,
      title: bank.title || bank.name || `Bank ${bank.id}`,
    },
    summary: {
      totalItems: supported.length + unsupported.length,
      exportedItems: supported.length,
      skippedItems: unsupported.length
    },
    items: supported.map(item => transformItemToJSON(item)),
    skipped: unsupported.map(item => ({
      id: item.id,
      title: item.title || item.question_name || 'Untitled',
      type: item.question_type || item.interaction_type || 'unknown',
      reason: 'Unsupported question type'
    }))
  };
}

function transformItemToJSON(item) {
  const qbType = mapCanvasTypeToQBType(item.question_type || item.interaction_type);
  const answers = item.answers || item.choices || [];
  
  return {
    id: item.id,
    type: qbType,
    originalType: item.question_type || item.interaction_type,
    title: item.title || item.question_name || 'Untitled',
    body: item.question_text || item.stimulus || item.item_body || item.body || '',
    points: item.points_possible || item.scoring_data?.value || 1,
    answers: answers.map((answer, idx) => ({
      id: answer.id || `answer_${idx}`,
      text: answer.text || answer.html || answer.body || '',
      correct: answer.weight > 0 || answer.correct === true
    })),
    feedback: {
      correct: item.correct_comments || item.feedback?.correct || '',
      incorrect: item.incorrect_comments || item.feedback?.incorrect || '',
      neutral: item.neutral_comments || item.feedback?.neutral || ''
    }
  };
}

// ========== API FUNCTIONS (Direct fetch using background's tokens) ==========
async function fetchBankMetadata(apiBase, bankId) {
  return trySequentialDirect([
    () => directApiFetch(`${apiBase}banks/${bankId}`),
    () => directApiFetch(`${apiBase}item_banks/${bankId}`)
  ]);
}

async function fetchAllEntries(apiBase, bankId) {
  return trySequentialDirect([
    () => directPaginatedFetch(`${apiBase}banks/${bankId}/bank_entries/search`),
    () => directPaginatedFetch(`${apiBase}banks/${bankId}/bank_entries`),
    () => directPaginatedFetch(`${apiBase}banks/${bankId}/items`),
    () => directPaginatedFetch(`${apiBase}item_banks/${bankId}/items`)
  ]);
}

async function fetchItemDefinitions(apiBase, bankId, entries) {
  const items = [];
  const total = entries.length;
  
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    let itemTitle = null;
    
    if (entry.entry && entry.entry.id) {
      const item = {
        ...entry.entry,
        bank_entry_id: entry.id,
        question_type: entry.entry.interaction_type?.slug || entry.entry.user_response_type
      };
      items.push(item);
      itemTitle = item.title;
    }
    else if (entry.interaction_data || entry.item_body || entry.answers) {
      const item = {
        ...entry,
        question_type: entry.interaction_type?.slug || entry.interaction_type || entry.user_response_type
      };
      items.push(item);
      itemTitle = item.title;
    }
    else if (entry.item_id || entry.id) {
      const itemId = entry.item_id || entry.id;
      try {
        const item = await trySequentialDirect([
          () => directApiFetch(`${apiBase}banks/${bankId}/bank_entries/${entry.id}`),
          () => directApiFetch(`${apiBase}items/${itemId}`)
        ]);
        
        if (item.entry && item.entry.id) {
          const extractedItem = {
            ...item.entry,
            bank_entry_id: item.id,
            question_type: item.entry.interaction_type?.slug || item.entry.user_response_type
          };
          items.push(extractedItem);
          itemTitle = extractedItem.title;
        } else {
          const extractedItem = {
            ...item,
            question_type: item.interaction_type?.slug || item.interaction_type || item.user_response_type
          };
          items.push(extractedItem);
          itemTitle = extractedItem.title;
        }
      } catch (e) {
        debugLog("WARN", `Could not fetch item ${itemId}: ${e.message}`);
      }
    }
    
    sendItemProgress(i + 1, total, itemTitle);
  }
  
  return items;
}

function categorizeItems(items) {
  const supported = [];
  const unsupported = [];
  
  for (const item of items) {
    const questionType = item.question_type || 
                         item.interaction_type?.slug || 
                         item.interaction_type;
    
    if (isSupported(questionType)) {
      supported.push({ ...item, question_type: questionType });
    } else {
      unsupported.push({ ...item, question_type: questionType });
      debugLog("SKIP", `Unsupported: ${questionType} (ID: ${item.id})`);
    }
  }
  
  return { supported, unsupported };
}
