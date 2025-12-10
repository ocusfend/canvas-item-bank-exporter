import { 
  apiFetch, trySequential, paginatedFetch, asyncPool,
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

// ========== STATE ==========
let latestBank = null;
let detectedApiBase = null;

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

    case "REQUEST_BANK":
      sendResponse({ bank: latestBank, apiBase: detectedApiBase });
      break;

    case "EXPORT_BANK":
      exportBank(msg.bankId, sender.tab?.id);
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
async function resolveApiBase(bankId) {
  if (detectedApiBase) {
    debugLog("API", `Using detected base: ${detectedApiBase}`);
    return detectedApiBase;
  }
  
  debugLog("API", "No detected base, probing candidates...");
  
  for (const candidate of API_BASE_CANDIDATES) {
    try {
      const testUrl = `${candidate}banks/${bankId}`;
      debugLog("API", `Probing: ${testUrl}`);
      
      // Use GET with timeout instead of HEAD (some Canvas endpoints reject HEAD)
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);
      
      const response = await fetch(testUrl, { 
        credentials: 'include', 
        mode: 'cors',
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (response.ok) {
        debugLog("API", `Found working base: ${candidate}`);
        detectedApiBase = candidate;
        return candidate;
      }
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
  
  try {
    // Step 1: Resolve API base
    sendProgress(tabId, 1, "Detecting API endpoint...");
    const apiBase = await resolveApiBase(bankId);
    
    // Step 2: Fetch bank metadata
    sendProgress(tabId, 1, "Fetching bank metadata...");
    const bank = await fetchBankMetadata(apiBase, bankId);
    debugLog("BANK", `Bank title: ${bank.title || bank.name || bankId}`);
    
    // Step 3: Fetch all items
    sendProgress(tabId, 2, "Fetching items (this may take a moment)...");
    const entries = await fetchAllEntries(apiBase, bankId);
    debugLog("FETCH", `Found ${entries.length} entries`);
    
    // Step 4: Fetch item definitions with timing
    sendProgress(tabId, 3, `Processing ${entries.length} items...`);
    const itemDefinitions = await fetchItemDefinitions(apiBase, bankId, entries);
    
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

// ========== API FUNCTIONS ==========
async function fetchBankMetadata(apiBase, bankId) {
  return trySequential([
    () => apiFetch(`${apiBase}banks/${bankId}`),
    () => apiFetch(`${apiBase}item_banks/${bankId}`)
  ]);
}

async function fetchAllEntries(apiBase, bankId) {
  return trySequential([
    () => paginatedFetch(`${apiBase}banks/${bankId}/items`),
    () => paginatedFetch(`${apiBase}banks/${bankId}/bank_entries`),
    () => paginatedFetch(`${apiBase}item_banks/${bankId}/items`)
  ]);
}

async function fetchItemDefinitions(apiBase, bankId, entries) {
  const itemIds = entries.map(e => e.id || e.item_id || e.entry_id);
  
  return asyncPool(10, itemIds, async (itemId) => {
    console.time(`item_${itemId}`);
    
    const result = await trySequential([
      () => apiFetch(`${apiBase}items/${itemId}`),
      () => apiFetch(`${apiBase}banks/${bankId}/items/${itemId}`),
      () => apiFetch(`${apiBase}banks/${bankId}/bank_entries/${itemId}`)
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
