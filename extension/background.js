import { 
  asyncPool,
  isSupported, generateItemXML, generateManifestXML, generateAssessmentXML,
  sanitizeFilename, sanitizeIdentifier, validateXML, debugLog,
  normalizeApiBase, API_BASE_CANDIDATES, summarizeSkippedItems, generateSkippedReport
} from './utils.js';

// ========== JSZIP LOADER ==========
let JSZip = null;
let jsZipLoadError = null;

async function loadJSZip() {
  if (JSZip) return JSZip;
  if (jsZipLoadError) throw jsZipLoadError;
  
  try {
    const module = await import('./jszip.mjs');
    JSZip = module.default || module;
    
    if (typeof JSZip !== 'function') {
      throw new Error('JSZip loaded but is not a constructor');
    }
    
    debugLog("ZIP", "JSZip loaded successfully");
    return JSZip;
  } catch (error) {
    jsZipLoadError = new Error(`Failed to load JSZip: ${error.message}`);
    debugLog("ERR", jsZipLoadError.message);
    throw jsZipLoadError;
  }
}

// ========== TAB-BASED API FETCH (via content script) ==========
async function apiFetchViaTab(tabId, url) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, { type: "FETCH_API", url }, response => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else if (response?.success) {
        resolve(response.data);
      } else {
        reject(new Error(response?.error || "Fetch failed"));
      }
    });
  });
}

async function paginatedFetchViaTab(tabId, url) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, { type: "FETCH_PAGINATED", url }, response => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else if (response?.success) {
        resolve(response.data);
      } else {
        reject(new Error(response?.error || "Fetch failed"));
      }
    });
  });
}

async function trySequentialViaTab(tabId, fetchers) {
  for (const fetcher of fetchers) {
    try {
      return await fetcher(tabId);
    } catch (e) {
      continue;
    }
  }
  throw new Error("All API endpoints failed");
}

// ========== STATE ==========
let latestBank = null;
let detectedApiBase = null;
let capturedAuth = null;

// ========== AUTHENTICATED FETCH (CORS-free from background) ==========
async function authenticatedFetch(url) {
  const headers = {
    'Accept': 'application/json',
  };
  
  if (capturedAuth?.authorization) {
    headers['Authorization'] = capturedAuth.authorization;
  }
  
  debugLog("FETCH", `Auth fetch: ${url}`);
  
  const response = await fetch(url, {
    method: 'GET',
    headers,
    mode: 'cors',
    credentials: 'omit'
  });
  
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
  
  return response.json();
}

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

async function authenticatedPaginatedFetch(baseUrl) {
  const results = [];
  let url = baseUrl;
  
  const headers = {
    'Accept': 'application/json',
  };
  
  if (capturedAuth?.authorization) {
    headers['Authorization'] = capturedAuth.authorization;
  }
  
  while (url) {
    debugLog("FETCH", `Paginated fetch: ${url}`);
    
    const response = await fetch(url, {
      method: 'GET',
      headers,
      mode: 'cors',
      credentials: 'omit'
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json();
    results.push(...(Array.isArray(data) ? data : [data]));
    
    const linkHeader = response.headers.get('Link');
    const links = parseLinkHeader(linkHeader);
    url = links.next || null;
  }
  
  return results;
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
      capturedAuth = {
        authorization: msg.authorization,
        apiDomain: msg.apiDomain
      };
      debugLog("AUTH", `Auth token captured for ${msg.apiDomain}`);
      break;

    case "REQUEST_BANK":
      sendResponse({ 
        bank: latestBank, 
        apiBase: detectedApiBase,
        hasAuth: !!capturedAuth 
      });
      break;

    case "EXPORT_BANK":
      // Popup doesn't have sender.tab, so we need to find the active tab
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
  debugLog("PROG", `[${step}/6] ${message}`);
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
  // Check if we have a captured auth domain to use as base
  if (capturedAuth?.apiDomain) {
    const authBase = capturedAuth.apiDomain + '/api/';
    debugLog("API", `Using auth domain as base: ${authBase}`);
    return authBase;
  }
  
  if (detectedApiBase) {
    debugLog("API", `Using detected base: ${detectedApiBase}`);
    return detectedApiBase;
  }
  
  debugLog("API", "No detected base, probing candidates...");
  
  for (const candidate of API_BASE_CANDIDATES) {
    try {
      const testUrl = `${candidate}banks/${bankId}`;
      debugLog("API", `Probing: ${testUrl}`);
      
      await authenticatedFetch(testUrl);
      debugLog("API", `Found working base: ${candidate}`);
      detectedApiBase = candidate;
      return candidate;
    } catch (e) {
      continue;
    }
  }
  
  debugLog("API", "All probes failed, using default /api/");
  return "/api/";
}

// ========== EXPORT PIPELINE ==========
async function exportBank(bankId, tabId) {
  console.time("export");
  
  if (!tabId) {
    sendError(null, "No active tab found. Please ensure you're on a Canvas quiz page.");
    return;
  }
  
  try {
    // Step 1: Resolve API base
    sendProgress(tabId, 1, "Detecting API endpoint...");
    const apiBase = await resolveApiBase(tabId, bankId);
    
    // Step 2: Fetch bank metadata
    sendProgress(tabId, 1, "Fetching bank metadata...");
    const bank = await fetchBankMetadata(tabId, apiBase, bankId);
    debugLog("BANK", `Bank title: ${bank.title || bank.name || bankId}`);
    
    // Step 3: Fetch all items
    sendProgress(tabId, 2, "Fetching items (this may take a moment)...");
    const entries = await fetchAllEntries(tabId, apiBase, bankId);
    debugLog("FETCH", `Found ${entries.length} entries`);
    
    // Step 4: Fetch item definitions with timing
    sendProgress(tabId, 3, `Processing ${entries.length} items...`);
    const itemDefinitions = await fetchItemDefinitions(tabId, apiBase, bankId, entries);
    
    // Step 5: Filter supported types
    sendProgress(tabId, 4, "Validating question types...");
    const { supported, unsupported } = categorizeItems(itemDefinitions);
    
    if (unsupported.length > 0) {
      debugLog("SKIP", `Skipping ${unsupported.length} items: ${summarizeSkippedItems(unsupported)}`);
    }
    
    // Step 6: Generate QTI package with validation
    sendProgress(tabId, 5, "Generating QTI XML...");
    const qtiPackage = generateQTIPackage(bank, supported, unsupported);
    
    // Step 7: Create ZIP
    sendProgress(tabId, 6, "Creating ZIP file...");
    const zipBlob = await createZipFile(qtiPackage);
    
    // Trigger download
    const filename = sanitizeFilename(bank.title || bank.name || `bank_${bankId}`) + "_export.zip";
    const url = URL.createObjectURL(zipBlob);
    
    chrome.downloads.download({
      url: url,
      filename: filename,
      saveAs: true
    }, () => {
      URL.revokeObjectURL(url);
    });
    
    sendComplete(
      tabId, 
      `Export complete! ${supported.length} questions exported.`,
      unsupported.map(i => ({ id: i.id, type: i.question_type || i.interaction_type }))
    );
    
  } catch (error) {
    console.error("[Export Error]", error);
    sendError(tabId, error.message);
  }
  
  console.timeEnd("export");
}

// ========== DIRECT FETCH HELPERS (using captured auth) ==========
async function trySequentialDirect(fetchers) {
  const errors = [];
  for (const fetcher of fetchers) {
    try {
      return await fetcher();
    } catch (e) {
      errors.push(e.message);
      continue;
    }
  }
  throw new Error(`All API endpoints failed: ${errors.join(', ')}`);
}

// ========== API FUNCTIONS (now using direct authenticated fetch) ==========
async function fetchBankMetadata(tabId, apiBase, bankId) {
  return trySequentialDirect([
    () => authenticatedFetch(`${apiBase}banks/${bankId}`),
    () => authenticatedFetch(`${apiBase}item_banks/${bankId}`)
  ]);
}

async function fetchAllEntries(tabId, apiBase, bankId) {
  return trySequentialDirect([
    () => authenticatedPaginatedFetch(`${apiBase}banks/${bankId}/items`),
    () => authenticatedPaginatedFetch(`${apiBase}banks/${bankId}/bank_entries`),
    () => authenticatedPaginatedFetch(`${apiBase}item_banks/${bankId}/items`)
  ]);
}

async function fetchItemDefinitions(tabId, apiBase, bankId, entries) {
  const itemIds = entries.map(e => e.id || e.item_id || e.entry_id);
  
  return asyncPool(10, itemIds, async (itemId) => {
    console.time(`item_${itemId}`);
    
    const result = await trySequentialDirect([
      () => authenticatedFetch(`${apiBase}items/${itemId}`),
      () => authenticatedFetch(`${apiBase}banks/${bankId}/items/${itemId}`),
      () => authenticatedFetch(`${apiBase}banks/${bankId}/bank_entries/${itemId}`)
    ]);
    
    console.timeEnd(`item_${itemId}`);
    return result;
  });
}

function categorizeItems(items) {
  const supported = [];
  const unsupported = [];
  
  for (const item of items) {
    if (isSupported(item.question_type || item.interaction_type)) {
      supported.push(item);
    } else {
      unsupported.push(item);
      debugLog("SKIP", `Unsupported: ${item.question_type || item.interaction_type} (ID: ${item.id})`);
    }
  }
  
  return { supported, unsupported };
}

function generateQTIPackage(bank, supported, unsupported) {
  const manifest = generateManifestXML(bank, supported);
  const assessment = generateAssessmentXML(bank, supported);
  
  validateXML(manifest, "imsmanifest.xml");
  validateXML(assessment, "assessment.xml");
  
  const items = [];
  for (const item of supported) {
    const xml = generateItemXML(item);
    if (xml) {
      const filename = `item_${sanitizeIdentifier(item.id)}.xml`;
      if (validateXML(xml, filename)) {
        items.push({ filename, content: xml });
      } else {
        debugLog("ERR", `Invalid XML for item ${item.id}, skipping`);
      }
    }
  }
  
  const skippedReport = unsupported.length > 0 
    ? generateSkippedReport(unsupported) 
    : null;
  
  return { manifest, assessment, items, skippedReport };
}

async function createZipFile(qtiPackage) {
  const JSZipConstructor = await loadJSZip();
  const zip = new JSZipConstructor();
  
  zip.file("imsmanifest.xml", qtiPackage.manifest);
  zip.file("assessment.xml", qtiPackage.assessment);
  
  for (const item of qtiPackage.items) {
    zip.file(`items/${item.filename}`, item.content);
  }
  
  if (qtiPackage.skippedReport) {
    zip.file("skipped_items.txt", qtiPackage.skippedReport);
  }
  
  return await zip.generateAsync({ type: "blob" });
}
