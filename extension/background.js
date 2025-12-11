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
      let raw = await fetchAllEntries(apiBase, bankId);
      
      // DEFENSIVE NORMALIZATION:
      // If inject.js ever returns wrapped data (e.g., { total, entries: [...] }),
      // ensure exporter always receives an array.
      if (Array.isArray(raw)) {
        entries = raw;
      } else if (raw && typeof raw === "object" && raw.entries) {
        console.log("[CanvasExporter] Normalizing wrapped response to array");
        entries = raw.entries;
      } else {
        console.warn("[CanvasExporter] Unexpected response shape, defaulting to empty array");
        entries = [];
      }
      console.log("[CanvasExporter] Normalized entries:", entries.length);
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

// Helper to strip HTML tags from text
function stripHtml(html) {
  return (html || '').replace(/<[^>]*>/g, '').trim();
}

function transformItemToJSON(item) {
  const canvasType = item.question_type || item.interaction_type;
  const qbType = mapCanvasTypeToQBType(canvasType);

  // Debug logging for answer extraction
  console.log(`[Transform] Item ${item.id}: canvasType="${canvasType}" → qbType="${qbType}"`);
  console.log(`[Transform] Item ${item.id} data:`, {
    hasInteractionData: !!item.interaction_data,
    hasScoringData: !!item.scoring_data,
    scoringValue: item.scoring_data?.value,
    choicesCount: item.interaction_data?.choices?.length || 0,
    hasAnswers: !!item.answers,
    hasChoices: !!item.choices
  });

  const body = item.question_text || item.stimulus || item.item_body || item.body || '';
  let points = typeof item.points_possible === 'number' ? item.points_possible : 1;

  let answers = [];

  // Multiple Choice / Multiple Response
  if (qbType === 'MC' || qbType === 'MR') {
    const choices = item.interaction_data?.choices || [];
    const scoringValue = item.scoring_data?.value;
    let correctIds = new Set();
    if (Array.isArray(scoringValue)) {
      correctIds = new Set(scoringValue);
    } else if (typeof scoringValue === 'string') {
      correctIds = new Set([scoringValue]);
    }
    answers = choices.map((choice, idx) => ({
      id: choice.id || `choice_${idx}`,
      text: stripHtml(choice.item_body || choice.text || choice.html || choice.body || ''),
      correct: correctIds.has(choice.id)
    }));
  }
  // True/False
  else if (qbType === 'TF') {
    const trueText = stripHtml(item.interaction_data?.true_choice) || 'True';
    const falseText = stripHtml(item.interaction_data?.false_choice) || 'False';
    const correctIsTrue = item.scoring_data?.value === true;
    answers = [
      { id: 'true', text: trueText, correct: !!correctIsTrue },
      { id: 'false', text: falseText, correct: !correctIsTrue }
    ];
  }
  // Short Answer / Fill-in-blank
  else if (qbType === 'SA') {
    const scoringValue = item.scoring_data?.value;
    if (Array.isArray(scoringValue)) {
      // Check if it's complex fill-blank (array of objects) or simple short answer (array of strings)
      if (scoringValue.length > 0 && typeof scoringValue[0] === 'object') {
        // Complex fill-blank with multiple blanks
        answers = scoringValue.map((blank, idx) => ({
          id: blank.id || `blank_${idx}`,
          text: blank.scoring_data?.blank_text ||
                (Array.isArray(blank.scoring_data?.value) ? blank.scoring_data.value.join(' | ') : ''),
          correct: true
        }));
      } else {
        // Simple short answer - array of acceptable string answers
        answers = scoringValue.map((answer, idx) => ({
          id: `answer_${idx}`,
          text: String(answer),
          correct: true
        }));
      }
    } else if (typeof scoringValue === 'string' && scoringValue) {
      // Single string answer
      answers = [{ id: 'answer_0', text: scoringValue, correct: true }];
    }
  }
  // Text Block / Passage
  else if (qbType === 'PASSAGE') {
    // Passages don't have answers, just content
    answers = [];
  }
  // File Upload
  else if (qbType === 'FU') {
    // File uploads don't have answers
    answers = [];
  }
  // Essay
  else if (qbType === 'ESS') {
    // Essays are manually graded, no correct answer
    answers = [];
  }
  // Numeric
  else if (qbType === 'NUM') {
    // scoring_data.value is an array of answer objects: [{id, type, value}]
    const scoringValue = item.scoring_data?.value;
    
    if (Array.isArray(scoringValue) && scoringValue.length > 0) {
      // Extract answers from array - each item has {id, type, value}
      answers = scoringValue.map((answer, idx) => ({
        id: answer.id || `numeric_${idx}`,
        text: String(answer.value ?? ''),  // The actual numeric answer
        correct: true,
        type: answer.type || 'exactResponse'  // 'exactResponse' or 'marginOfError'
      }));
    } else if (typeof scoringValue === 'number' || typeof scoringValue === 'string') {
      // Fallback for simple numeric value (legacy format)
      answers = [{
        id: 'numeric_answer',
        text: String(scoringValue),
        correct: true
      }];
    } else {
      answers = [];
    }
  }

  // Matching - scoring_data.value is {questionId: "answerText"}
  else if (qbType === 'MAT') {
    const scoringValue = item.scoring_data?.value;
    const questions = item.interaction_data?.questions || [];
    
    if (scoringValue && typeof scoringValue === 'object' && !Array.isArray(scoringValue)) {
      // Build answer pairs from questions and scoring data
      answers = questions.map((q, idx) => ({
        id: q.id || `q_${idx}`,
        questionText: stripHtml(q.item_body || q.body || q.text || ''),
        answerText: scoringValue[q.id] || '',
        correct: true
      }));
    } else {
      answers = [];
    }
  }
  // Categorization - scoring_data.value is {categoryId: [answerIds]}
  else if (qbType === 'CAT') {
    const scoringValue = item.scoring_data?.value;
    const categories = item.interaction_data?.categories || [];
    const choices = item.interaction_data?.choices || [];
    
    if (scoringValue && typeof scoringValue === 'object' && !Array.isArray(scoringValue)) {
      // Build category-answer mappings
      answers = categories.map((cat, idx) => {
        const answerIds = scoringValue[cat.id] || [];
        const answerTexts = answerIds.map(id => {
          const choice = choices.find(c => c.id === id);
          return stripHtml(choice?.item_body || choice?.body || id);
        });
        return {
          id: cat.id || `cat_${idx}`,
          categoryText: stripHtml(cat.item_body || cat.body || cat.text || ''),
          answers: answerTexts,
          correct: true
        };
      });
    } else {
      answers = [];
    }
  }
  // Ordering - scoring_data.value is array of IDs in correct order
  else if (qbType === 'ORD') {
    const scoringValue = item.scoring_data?.value;
    const choices = item.interaction_data?.choices || [];
    
    if (Array.isArray(scoringValue)) {
      // Map IDs to their text in correct order
      answers = scoringValue.map((id, idx) => {
        const choice = choices.find(c => c.id === id);
        return {
          id: id,
          text: stripHtml(choice?.item_body || choice?.body || choice?.text || id),
          position: idx + 1,
          correct: true
        };
      });
    } else {
      answers = [];
    }
  }
  // Hot Spot - scoring_data.value is array of {id, type, coordinates}
  else if (qbType === 'HS') {
    const scoringValue = item.scoring_data?.value;
    
    if (Array.isArray(scoringValue)) {
      answers = scoringValue.map((hotspot, idx) => ({
        id: hotspot.id || `hotspot_${idx}`,
        type: hotspot.type || 'unknown',  // 'square', 'circle', 'polygon'
        coordinates: hotspot.coordinates || null,
        correct: true
      }));
    } else if (scoringValue && typeof scoringValue === 'object') {
      // Single hotspot object
      answers = [{
        id: scoringValue.id || 'hotspot_0',
        type: scoringValue.type || 'unknown',
        coordinates: scoringValue.coordinates || null,
        correct: true
      }];
    } else {
      answers = [];
    }
  }
  // Formula - scoring_data has variables and generated solutions
  else if (qbType === 'FORM') {
    const scoringValue = item.scoring_data?.value;
    const variables = item.scoring_data?.variables || [];
    const solutions = item.scoring_data?.generated_solutions || [];
    
    if (Array.isArray(solutions) && solutions.length > 0) {
      answers = solutions.map((sol, idx) => ({
        id: `solution_${idx}`,
        inputs: sol.inputs || {},
        output: String(sol.output ?? ''),
        correct: true
      }));
    } else if (scoringValue !== undefined && scoringValue !== null) {
      // Single formula answer
      answers = [{
        id: 'formula_answer',
        text: String(scoringValue),
        correct: true
      }];
    } else {
      answers = [];
    }
  }

  // Fallback: legacy answer formats
  const noAnswerTypes = ['PASSAGE', 'FU', 'ESS', 'NUM', 'MAT', 'CAT', 'ORD', 'HS', 'FORM'];
  if (answers.length === 0 && !noAnswerTypes.includes(qbType)) {
    console.log(`[Transform] Item ${item.id}: Using fallback answer extraction`);
    const baseAnswers = item.answers || item.choices || [];
    answers = baseAnswers.map((answer, idx) => ({
      id: answer.id || `answer_${idx}`,
      text: stripHtml(answer.text || answer.html || answer.body || ''),
      correct: answer.weight > 0 || answer.correct === true
    }));
  }

  // Log final extraction result
  console.log(`[Transform] Item ${item.id}: Extracted ${answers.length} answers`, 
    answers.map(a => ({ id: a.id, correct: a.correct, textPreview: a.text?.substring(0, 30) })));

  return {
    id: item.id,
    type: qbType,
    originalType: canvasType,
    entryType: item.entry_type || 'Item',
    title: item.title || item.question_name || 'Untitled',
    body,
    points,
    answers,
    allowedFiles: item.interaction_data?.allowed_files || null,
    // Essay settings
    essaySettings: qbType === 'ESS' ? {
      spellCheck: item.properties?.spell_check ?? false,
      showWordCount: item.properties?.show_word_count ?? false,
      wordLimit: item.properties?.word_limit ?? false,
      wordLimitMin: item.properties?.word_limit_min ?? null,
      wordLimitMax: item.properties?.word_limit_max ?? null
    } : null,
    // Numeric settings (margin of error and detailed answer config)
    numericSettings: qbType === 'NUM' ? {
      answers: Array.isArray(item.scoring_data?.value) 
        ? item.scoring_data.value.map(a => ({
            id: a.id,
            type: a.type,  // 'exactResponse' or 'marginOfError'
            value: a.value,
            margin: a.margin ?? null,
            marginType: a.margin_type ?? null
          }))
        : null,
      marginOfError: item.scoring_data?.margin_of_error ?? null,
      marginType: item.scoring_data?.margin_type ?? null
    } : null,
    // Matching settings
    matchingSettings: qbType === 'MAT' ? {
      questions: (item.interaction_data?.questions || []).map(q => ({
        id: q.id,
        text: stripHtml(q.item_body || q.body || ''),
        answerText: stripHtml(q.answer_body || q.answer?.body || '')
      })),
      shuffleQuestions: item.properties?.shuffle_rules?.questions?.shuffled ?? false,
      scoringAlgorithm: item.scoring_algorithm || 'PartialDeep'
    } : null,
    // Categorization settings
    categorizationSettings: qbType === 'CAT' ? {
      categories: (item.interaction_data?.categories || []).map(c => ({
        id: c.id,
        text: stripHtml(c.item_body || c.body || '')
      })),
      choices: (item.interaction_data?.choices || []).map(c => ({
        id: c.id,
        text: stripHtml(c.item_body || c.body || '')
      })),
      scoringAlgorithm: item.scoring_algorithm || 'Categorization',
      scoreMethod: item.scoring_data?.score_method || 'all_or_nothing'
    } : null,
    // Ordering settings
    orderingSettings: qbType === 'ORD' ? {
      topLabel: item.interaction_data?.top_label || null,
      bottomLabel: item.interaction_data?.bottom_label || null,
      choices: (item.interaction_data?.choices || []).map(c => ({
        id: c.id,
        text: stripHtml(c.item_body || c.body || '')
      }))
    } : null,
    // Hot Spot settings
    hotSpotSettings: qbType === 'HS' ? {
      imageUrl: item.interaction_data?.image_url || null,
      hotspotsCount: item.interaction_data?.hotspots_count || 0
    } : null,
    // Formula settings
    formulaSettings: qbType === 'FORM' ? {
      variables: (item.scoring_data?.variables || []).map(v => ({
        name: v.name,
        min: v.min,
        max: v.max,
        precision: v.precision ?? 0
      })),
      marginOfError: item.scoring_data?.margin_of_error ?? 0,
      marginType: item.scoring_data?.margin_type || 'absolute',
      answerCount: item.scoring_data?.answer_count ?? 1,
      formula: item.scoring_data?.formula || null
    } : null,
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
    
    // Handle Stimulus entries (Text Blocks vs Unsupported Stimulus)
    if (entry.entry_type === 'Stimulus' || entry.entry?.stimulus_type) {
      const stimulusEntry = entry.entry || entry;
      const isPassage = stimulusEntry.passage === true;
      
      const item = {
        ...stimulusEntry,
        bank_entry_id: entry.id,
        entry_type: 'Stimulus',
        // passage: true → 'text-block' (supported)
        // passage: false → 'stimulus' (unsupported)
        question_type: isPassage ? 'text-block' : 'stimulus'
      };
      items.push(item);
      itemTitle = item.title;
      sendItemProgress(i + 1, total, itemTitle);
      continue;
    }
    
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
