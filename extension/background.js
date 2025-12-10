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
// Helper to check if a token looks like a JWT
function isJwtToken(token) {
  return token && token.startsWith('eyJ');
}

function findTokenForUrl(url) {
  debugLog("AUTH", `Looking for token for: ${url}`);
  debugLog("AUTH", `Available tokens: ${capturedTokens.size}`);
  
  if (capturedTokens.size === 0) {
    debugLog("AUTH", "No tokens stored!");
    return null;
  }
  
  // Log all stored domains with token type
  for (const [domain, auth] of capturedTokens) {
    const tokenType = isJwtToken(auth.bearerToken) ? 'JWT' : 'Session';
    debugLog("AUTH", `  Stored: ${domain} (${tokenType}: ${auth.bearerToken?.substring(0, 20)}...)`);
  }
  
  try {
    const urlObj = new URL(url);
    const targetHost = urlObj.hostname;
    
    // PRIORITY 1: For quiz-api URLs, prefer quiz-lti NON-JWT tokens first
    // These session tokens (starting with rq_) are the valid auth tokens
    if (targetHost.includes('quiz-api')) {
      for (const [domain, auth] of capturedTokens) {
        if (domain.includes('quiz-lti') && !isJwtToken(auth.bearerToken)) {
          debugLog("AUTH", `✓ Using quiz-lti session token for ${targetHost}`);
          return auth.bearerToken;
        }
      }
    }
    
    // PRIORITY 2: Exact domain match, but skip JWT tokens for quiz-api
    for (const [domain, auth] of capturedTokens) {
      try {
        const authHost = new URL(domain).hostname;
        if (authHost === targetHost) {
          // For quiz-api, skip JWT tokens as they don't work
          if (targetHost.includes('quiz-api') && isJwtToken(auth.bearerToken)) {
            debugLog("AUTH", `Skipping JWT token for ${targetHost}`);
            continue;
          }
          debugLog("AUTH", `✓ Exact token match for ${targetHost}`);
          return auth.bearerToken;
        }
      } catch (e) {
        continue;
      }
    }
    
    // PRIORITY 3: Quiz-lti to quiz-api cross-domain mapping (non-JWT preferred)
    if (targetHost.includes('quiz-api')) {
      for (const [domain, auth] of capturedTokens) {
        if (domain.includes('quiz-lti')) {
          debugLog("AUTH", `✓ Using quiz-lti token for quiz-api: ${targetHost}`);
          return auth.bearerToken;
        }
      }
    }
    
    // PRIORITY 4: Any non-JWT token
    for (const [domain, auth] of capturedTokens) {
      if (!isJwtToken(auth.bearerToken)) {
        debugLog("AUTH", `✓ Using non-JWT fallback token for ${targetHost}`);
        return auth.bearerToken;
      }
    }
    
    // Last resort: use first available token (even if JWT)
    if (capturedTokens.size > 0) {
      const firstToken = capturedTokens.values().next().value;
      debugLog("AUTH", `⚠ Using first available token (may be JWT) for ${targetHost}`);
      return firstToken.bearerToken;
    }
  } catch (e) {
    debugLog("AUTH", `Token lookup error: ${e.message}`);
  }
  
  return null;
}

// ========== PAGE CONTEXT API FETCH (Routes through content script to page context) ==========
// This uses the page's authenticated session and cookies - bypassing CORS issues

async function apiFetchViaTab(tabId, url) {
  debugLog("FETCH", `Page context fetch: ${url.substring(0, 80)}...`);
  
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Request timed out after 30s'));
    }, 30000);
    
    chrome.tabs.sendMessage(tabId, { type: "FETCH_API", url }, (response) => {
      clearTimeout(timeout);
      
      if (chrome.runtime.lastError) {
        reject(new Error(`Tab communication failed: ${chrome.runtime.lastError.message}`));
        return;
      }
      
      if (!response) {
        reject(new Error('No response from content script'));
        return;
      }
      
      if (response.success) {
        resolve(response.data);
      } else {
        reject(new Error(response.error || 'Unknown error'));
      }
    });
  });
}

async function paginatedFetchViaTab(tabId, url) {
  debugLog("FETCH", `Page context paginated fetch: ${url.substring(0, 80)}...`);
  
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Paginated request timed out after 60s'));
    }, 60000);
    
    chrome.tabs.sendMessage(tabId, { type: "FETCH_PAGINATED", url }, (response) => {
      clearTimeout(timeout);
      
      if (chrome.runtime.lastError) {
        reject(new Error(`Tab communication failed: ${chrome.runtime.lastError.message}`));
        return;
      }
      
      if (!response) {
        reject(new Error('No response from content script'));
        return;
      }
      
      if (response.success) {
        resolve(response.data);
      } else {
        reject(new Error(response.error || 'Unknown error'));
      }
    });
  });
}

// Try multiple API endpoints sequentially until one succeeds
async function trySequentialViaTab(tabId, fetchers) {
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

// Store current tabId for API functions
let currentExportTabId = null;

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
  
  // Store tabId for API functions to use
  currentExportTabId = tabId;
  
  try {
    // We no longer require tokens in background - they're in the page context
    debugLog("AUTH", `Starting export (tokens are in page context)`);
    
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

// ========== API FUNCTIONS (Page context fetch using session cookies) ==========
async function fetchBankMetadata(apiBase, bankId) {
  return trySequentialViaTab(currentExportTabId, [
    () => apiFetchViaTab(currentExportTabId, `${apiBase}banks/${bankId}`),
    () => apiFetchViaTab(currentExportTabId, `${apiBase}item_banks/${bankId}`)
  ]);
}

async function fetchAllEntries(apiBase, bankId) {
  return trySequentialViaTab(currentExportTabId, [
    () => paginatedFetchViaTab(currentExportTabId, `${apiBase}banks/${bankId}/bank_entries/search`),
    () => paginatedFetchViaTab(currentExportTabId, `${apiBase}banks/${bankId}/bank_entries`),
    () => paginatedFetchViaTab(currentExportTabId, `${apiBase}banks/${bankId}/items`),
    () => paginatedFetchViaTab(currentExportTabId, `${apiBase}item_banks/${bankId}/items`)
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
        const item = await trySequentialViaTab(currentExportTabId, [
          () => apiFetchViaTab(currentExportTabId, `${apiBase}banks/${bankId}/bank_entries/${entry.id}`),
          () => apiFetchViaTab(currentExportTabId, `${apiBase}items/${itemId}`)
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
