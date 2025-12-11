console.log("[CanvasExporter] Content script booting (Phase 5)…");

// ========== CLASSIC QUIZ PARSING (runs in DOM context) ==========
// These functions are duplicated here because content scripts can't use ES modules
// and DOMParser is not available in the service worker background script

const CLASSIC_TYPE_MAP = {
  'multiple_choice_question': 'MC',
  'true_false_question': 'TF',
  'multiple_answers_question': 'MR',
  'short_answer_question': 'SA',
  'fill_in_multiple_blanks_question': 'FIMB',
  'multiple_dropdowns_question': 'MDD',
  'matching_question': 'MAT',
  'numerical_question': 'NUM',
  'calculated_question': 'CALC',
  'essay_question': 'ESS',
  'file_upload_question': 'FU',
  'text_only_question': 'TB'
};

function normalizeType(canvasType, isClassic = false) {
  if (isClassic) {
    return CLASSIC_TYPE_MAP[canvasType] || canvasType?.toUpperCase() || 'UNKNOWN';
  }
  return canvasType?.toUpperCase() || 'UNKNOWN';
}

function normalizeBlankId(id) {
  if (!id) return null;
  return id.trim().replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase();
}

function cleanHtml(html) {
  if (!html) return '';
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  tmp.querySelectorAll('.drag_handle, .links, script, .screenreader-only, .hidden, [aria-hidden="true"]').forEach(e => e.remove());
  return tmp.innerHTML.trim();
}

function htmlToText(html) {
  if (!html) return null;
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  return tmp.textContent?.trim() || null;
}

async function hashQuestion(question) {
  const data = JSON.stringify({
    type: question.type,
    body: question.body,
    answers: question.answers
  });
  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(data));
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

function generateCanvasSignature(doc) {
  const indicators = {
    // Fix: Also check for authenticity_token input (Canvas uses this)
    hasCsrfToken: !!doc.querySelector('meta[name="csrf-token"]') || 
                  !!doc.querySelector('input[name="authenticity_token"]'),
    hasNewRceEditor: !!doc.querySelector('[data-rce-wrapper]'),
    hasInstui: !!doc.querySelector('[class*="__instructure"]'),
    questionHolderClass: !!doc.querySelector('.question_holder'),
    answerWrapperClass: !!doc.querySelector('.answers_wrapper')
  };
  
  let domVersion = 'unknown';
  if (indicators.hasCsrfToken && indicators.questionHolderClass) {
    domVersion = indicators.hasInstui ? '2022+' : '2020+';
  }
  
  return { domVersion, indicators, extractedAt: new Date().toISOString() };
}

class ExportWarnings {
  constructor() { this.warnings = []; }
  add(questionId, message, severity = 'warn') {
    this.warnings.push({ questionId, message, severity, timestamp: new Date().toISOString() });
    console.warn(`[Classic Parse] Q${questionId}: ${message}`);
  }
  toArray() { return this.warnings.length > 0 ? this.warnings : null; }
}

function parseClassicBankHtml(html) {
  const warnings = new ExportWarnings();
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  
  if (doc.querySelector('#login_form') || doc.body?.textContent?.includes('Log In')) {
    throw new Error('Authentication required - please log into Canvas first');
  }
  
  // Fix: Remove noscript elements before parsing to avoid selecting wrong h1
  doc.querySelectorAll('noscript').forEach(el => el.remove());
  
  const canvasSignature = generateCanvasSignature(doc);
  // Fix: Use more specific selector for bank title, avoiding noscript content
  const titleEl = doc.querySelector('.quiz-header .displaying h1') || 
                  doc.querySelector('.quiz-header h1') ||
                  doc.querySelector('#breadcrumbs + div h1') ||
                  doc.querySelector('h1:not(noscript h1)') || 
                  doc.querySelector('.page-title');
  const bankTitle = titleEl?.textContent?.trim() || 'Untitled Bank';
  const groups = extractQuestionGroups(doc);
  
  const questionHolders = doc.querySelectorAll(
    '.question_holder:not([style*="display: none"]):not(#question_template):not(#question_teaser_blank)'
  );
  const questions = [];
  
  questionHolders.forEach((holder, idx) => {
    try {
      const question = extractClassicQuestion(holder, idx, warnings);
      if (question && question.type !== 'UNKNOWN') questions.push(question);
    } catch (e) {
      warnings.add(`idx_${idx}`, `Failed to parse: ${e.message}`, 'error');
    }
  });
  
  return { bankTitle, questions, groups, canvasSignature, warnings: warnings.toArray() };
}

function extractQuestionGroups(doc) {
  const groupDivs = doc.querySelectorAll('.assessment_question_group, .question_group');
  const groups = [];
  
  groupDivs.forEach((groupDiv, idx) => {
    const titleEl = groupDiv.querySelector('.group_name, .name');
    const pickCountEl = groupDiv.querySelector('.pick_count');
    const questionIds = [];
    
    groupDiv.querySelectorAll('.question_holder').forEach(holder => {
      const qDiv = holder.querySelector('.display_question');
      const idMatch = qDiv?.id?.match(/question_(\d+)/);
      if (idMatch) questionIds.push(idMatch[1]);
    });
    
    if (questionIds.length > 0) {
      groups.push({
        id: `group_${idx}`,
        title: titleEl?.textContent?.trim() || `Group ${idx + 1}`,
        pickCount: parseInt(pickCountEl?.textContent?.trim()) || questionIds.length,
        questionIds
      });
    }
  });
  
  return groups.length > 0 ? groups : null;
}

function extractClassicQuestion(holder, index, warnings) {
  const questionDiv = holder.querySelector('.display_question.question');
  if (!questionDiv) return null;
  if (questionDiv.id === 'question_new' || questionDiv.id === 'question_blank') return null;
  
  const typeSpan = questionDiv.querySelector('.question_type');
  const rawType = typeSpan?.textContent?.trim() || extractTypeFromClass(questionDiv.className);
  if (!rawType || rawType === 'unknown') {
    warnings.add(`idx_${index}`, 'Could not determine question type');
    return null;
  }
  
  const mappedType = normalizeType(rawType, true);
  const idMatch = questionDiv.id?.match(/question_(\d+)/);
  const questionId = idMatch ? idMatch[1] : `q_${index}`;
  const uuid = crypto.randomUUID();
  
  const assessmentIdEl = questionDiv.querySelector('.assessment_question_id');
  const assessmentId = assessmentIdEl?.textContent?.trim() || questionId;
  
  const nameEl = questionDiv.querySelector('.question_name');
  const title = nameEl?.textContent?.trim() || `Question ${index + 1}`;
  
  const pointsEl = questionDiv.querySelector('.question_points');
  const points = rawType === 'text_only_question' ? 0 : (parseFloat(pointsEl?.textContent?.trim()) || 1);
  
  const textareaEl = questionDiv.querySelector('.textarea_question_text');
  const renderedEl = questionDiv.querySelector('.question_text.user_content');
  const bodyRaw = textareaEl?.value?.trim() || textareaEl?.textContent?.trim() || renderedEl?.innerHTML?.trim() || '';
  const body = cleanHtml(bodyRaw);
  const bodyText = htmlToText(bodyRaw);
  
  const blanks = extractBlanks(questionDiv, rawType);
  const answers = extractClassicAnswers(questionDiv, rawType, questionId, warnings);
  const calculatedData = rawType === 'calculated_question' ? extractCalculatedQuestionData(questionDiv) : null;
  const feedback = extractFeedback(questionDiv);
  const migratableToNewQuizzes = determineMigratability(rawType, answers, calculatedData);
  
  const question = {
    id: questionId, uuid, assessmentId, type: mappedType, originalType: rawType,
    title, points, body, bodyRaw, bodyText, answers, feedback, migratableToNewQuizzes
  };
  
  if (blanks) question.blanks = blanks;
  if (calculatedData) question.calculatedData = calculatedData;
  if (rawType === 'text_only_question') question.isInformational = true;
  
  return question;
}

function extractTypeFromClass(className) {
  const match = className?.match(/(\w+)_question/);
  return match ? `${match[1]}_question` : 'unknown';
}

function determineMigratability(type, answers, calculatedData) {
  if (['calculated_question'].includes(type)) return false;
  if (type === 'numerical_question' && answers?.some(a => a.numericalType === 'approximate')) return false;
  return true;
}

function extractBlanks(questionDiv, questionType) {
  if (!['fill_in_multiple_blanks_question', 'multiple_dropdowns_question'].includes(questionType)) return null;
  const blankSelect = questionDiv.querySelector('.blank_id_select');
  if (!blankSelect) return null;
  const blanks = [];
  blankSelect.querySelectorAll('option').forEach(option => {
    const blankId = normalizeBlankId(option.value);
    if (blankId) blanks.push(blankId);
  });
  return blanks.length > 0 ? blanks : null;
}

function extractClassicAnswers(questionDiv, questionType, questionId, warnings) {
  if (questionType === 'matching_question') return extractMatchingPairs(questionDiv, questionId, warnings);
  
  const answerDivs = questionDiv.querySelectorAll('.answers_wrapper .answer:not(#answer_template)');
  const answers = [];
  
  answerDivs.forEach((answerDiv, idx) => {
    if (answerDiv.id === 'answer_template') return;
    
    const idEl = answerDiv.querySelector("span.hidden.id, span[class*='id']");
    const answerId = idEl?.textContent?.trim() || answerDiv.id?.replace('answer_', '') || `a_${idx}`;
    
    const blankIdEl = answerDiv.querySelector('.blank_id');
    const blankIdFromClass = answerDiv.className.match(/answer_for_(\w+)/)?.[1];
    const rawBlankId = blankIdEl?.textContent?.trim();
    const effectiveBlankId = (rawBlankId && rawBlankId !== 'none') ? normalizeBlankId(rawBlankId) : (blankIdFromClass ? normalizeBlankId(blankIdFromClass) : null);
    
    const isCorrect = answerDiv.classList.contains('correct_answer') || answerDiv.querySelector('.answer_weight')?.textContent?.trim() === '100';
    const weightEl = answerDiv.querySelector('.answer_weight');
    const weight = parseInt(weightEl?.textContent?.trim()) || (isCorrect ? 100 : 0);
    
    if (questionType === 'numerical_question') {
      const numericalAnswer = extractNumericalAnswer(answerDiv, answerId, questionId, warnings);
      if (numericalAnswer) answers.push({ ...numericalAnswer, correct: isCorrect, weight });
    } else {
      const textEl = answerDiv.querySelector('.answer_text');
      const htmlEl = answerDiv.querySelector('.answer_html');
      const textRaw = htmlEl?.innerHTML?.trim() || textEl?.textContent?.trim() || '';
      const text = cleanHtml(textRaw);
      
      const feedbackEl = answerDiv.querySelector('.answer_comments .comment_html');
      const answerFeedback = feedbackEl ? cleanHtml(feedbackEl.innerHTML) : null;
      
      const answer = { id: answerId, text, textRaw, correct: isCorrect, weight };
      if (effectiveBlankId) answer.blankId = effectiveBlankId;
      if (answerFeedback) answer.feedback = answerFeedback;
      answers.push(answer);
    }
  });
  
  return answers;
}

function extractMatchingPairs(questionDiv, questionId, warnings) {
  const pairs = [];
  const distractors = [];
  const matchHolders = questionDiv.querySelectorAll('.answers_wrapper .answer, .matching_answer_container');
  
  matchHolders.forEach((holder, idx) => {
    const leftEl = holder.querySelector('.answer_match_left, .left_side');
    const rightEl = holder.querySelector('.answer_match_right, .right_side');
    const matchIdEl = holder.querySelector('.match_id');
    
    // Fix: Extract clean text, checking for .correct_answer span inside right side
    const leftText = leftEl?.textContent?.trim() || '';
    const correctAnswerSpan = rightEl?.querySelector('.correct_answer');
    const rightText = correctAnswerSpan?.textContent?.trim() || rightEl?.textContent?.trim() || '';
    
    // Skip if both sides empty
    if (!leftText && !rightText) return;
    
    // Distractor if only right side has content
    if (!leftText && rightText) {
      distractors.push({ id: `distractor_${idx}`, text: rightText });
      return;
    }
    
    pairs.push({
      id: `match_${idx}`,
      left: leftText,
      right: rightText,
      matchId: matchIdEl?.textContent?.trim() || null
    });
  });
  
  if (pairs.length === 0) warnings.add(questionId, 'No matching pairs found');
  
  // Return object with pairs and optional distractors for matching questions
  return { type: 'matching', pairs, distractors: distractors.length > 0 ? distractors : null };
}

function extractNumericalAnswer(answerDiv, answerId, questionId, warnings) {
  // Fix: Use Canvas's actual class names for numerical answer elements
  const exactEl = answerDiv.querySelector('.answer_exact, .numerical_answer_exact, .exact_answer');
  const marginEl = answerDiv.querySelector('.answer_error_margin, .numerical_answer_margin, .error_margin');
  const startEl = answerDiv.querySelector('.answer_range_start, .numerical_answer_start, .start_range');
  const endEl = answerDiv.querySelector('.answer_range_end, .numerical_answer_end, .end_range');
  const approxEl = answerDiv.querySelector('.answer_approximate, .numerical_answer_approximate, .approximate_answer');
  const precisionEl = answerDiv.querySelector('.answer_precision, .numerical_answer_precision, .precision');
  
  // Fix: Determine type from visible numerical answer div
  const hasExactVisible = answerDiv.querySelector('.numerical_exact_answer:not([style*="display:none"]):not([style*="display: none"])');
  const hasRangeVisible = answerDiv.querySelector('.numerical_range_answer:not([style*="display:none"]):not([style*="display: none"])');
  const hasPrecisionVisible = answerDiv.querySelector('.numerical_precision_answer:not([style*="display:none"]):not([style*="display: none"])');
  
  let numericalType = 'unknown';
  let value = null, margin = null, start = null, end = null, precision = null;
  
  // Try to detect type from visible container first
  if (hasExactVisible || exactEl?.textContent?.trim()) {
    numericalType = 'exact';
    value = parseFloat(exactEl?.textContent?.trim()) || 0;
    margin = parseFloat(marginEl?.textContent?.trim()) || 0;
  } else if (hasRangeVisible || (startEl?.textContent?.trim() && endEl?.textContent?.trim())) {
    numericalType = 'range';
    start = parseFloat(startEl?.textContent?.trim()) || 0;
    end = parseFloat(endEl?.textContent?.trim()) || 0;
  } else if (hasPrecisionVisible || approxEl?.textContent?.trim()) {
    numericalType = 'approximate';
    value = parseFloat(approxEl?.textContent?.trim()) || 0;
    precision = parseInt(precisionEl?.textContent?.trim()) || 0;
  }
  
  if (numericalType === 'unknown') {
    warnings.add(questionId, `Could not determine numerical answer type for answer ${answerId}`);
    return null;
  }
  
  return { id: answerId, numericalType, value, margin, start, end, precision };
}

function extractCalculatedQuestionData(questionDiv) {
  const variables = [];
  
  // Fix: Use Canvas's actual table structure for variable definitions
  const variableTable = questionDiv.querySelector('.variable_definitions tbody, .variables_table tbody');
  if (variableTable) {
    variableTable.querySelectorAll('tr').forEach(row => {
      const cells = row.querySelectorAll('td');
      const nameCell = row.querySelector('td.name') || cells[0];
      const minCell = row.querySelector('td.min') || cells[1];
      const maxCell = row.querySelector('td.max') || cells[2];
      const scaleCell = row.querySelector('td.scale') || cells[3];
      
      const name = nameCell?.textContent?.trim();
      if (name) {
        variables.push({
          name,
          min: parseFloat(minCell?.textContent?.trim()) || 0,
          max: parseFloat(maxCell?.textContent?.trim()) || 100,
          scale: parseInt(scaleCell?.textContent?.trim()) || 0
        });
      }
    });
  } else {
    // Fallback: try individual variable divs
    questionDiv.querySelectorAll('.variable_definition, .variable').forEach(varDiv => {
      const nameEl = varDiv.querySelector('.variable_name, .name');
      const minEl = varDiv.querySelector('.variable_min, .min');
      const maxEl = varDiv.querySelector('.variable_max, .max');
      const scaleEl = varDiv.querySelector('.variable_scale, .decimal_places');
      
      if (nameEl?.textContent?.trim()) {
        variables.push({
          name: nameEl.textContent.trim(),
          min: parseFloat(minEl?.textContent?.trim()) || 0,
          max: parseFloat(maxEl?.textContent?.trim()) || 100,
          scale: parseInt(scaleEl?.textContent?.trim()) || 0
        });
      }
    });
  }
  
  // Fix: Extract formulas from .formulas_list or formula definition elements
  const formulas = [];
  const formulasList = questionDiv.querySelector('.formulas_list');
  if (formulasList) {
    formulasList.querySelectorAll('div, span, li').forEach(el => {
      const formula = el.textContent?.trim();
      if (formula && !el.querySelector('div, span, li')) formulas.push(formula);
    });
  }
  // Fallback: single formula element
  const formulaEl = questionDiv.querySelector('.formula_definition, .formula');
  const singleFormula = formulaEl?.textContent?.trim();
  if (singleFormula && formulas.length === 0) formulas.push(singleFormula);
  
  const toleranceEl = questionDiv.querySelector('.answer_tolerance, .tolerance');
  const tolerance = parseFloat(toleranceEl?.textContent?.trim()) || 0;
  
  const decimalEl = questionDiv.querySelector('.formula_decimal_places, .decimal_places_value');
  const decimalPlaces = parseInt(decimalEl?.textContent?.trim()) || 0;
  
  // Fix: Extract solutions from equation_combinations table
  const solutions = [];
  const combinationsTable = questionDiv.querySelector('.equation_combinations, .combinations_table');
  if (combinationsTable) {
    const headerCells = combinationsTable.querySelectorAll('thead th');
    const varNames = Array.from(headerCells)
      .map(th => th.textContent?.trim())
      .filter(n => n && n.toLowerCase() !== 'answer');
    
    combinationsTable.querySelectorAll('tbody tr').forEach((row, idx) => {
      const cells = row.querySelectorAll('td');
      const inputs = {};
      varNames.forEach((varName, i) => {
        if (cells[i]) inputs[varName] = parseFloat(cells[i].textContent?.trim()) || 0;
      });
      const answerCell = row.querySelector('td.final_answer') || cells[cells.length - 1];
      const output = answerCell ? parseFloat(answerCell.textContent?.trim()) : null;
      solutions.push({ id: `sol_${idx}`, inputs, output });
    });
  } else {
    // Fallback: try individual solution divs
    questionDiv.querySelectorAll('.combination, .generated_solution').forEach((solDiv, idx) => {
      const inputs = {};
      solDiv.querySelectorAll('.variable_value, .var_value').forEach(varVal => {
        const name = varVal.getAttribute('data-variable') || varVal.className.match(/var_(\w+)/)?.[1];
        if (name) inputs[name] = parseFloat(varVal.textContent.trim());
      });
      
      const outputEl = solDiv.querySelector('.answer, .result');
      const output = outputEl ? parseFloat(outputEl.textContent.trim()) : null;
      
      if (Object.keys(inputs).length > 0 || output !== null) {
        solutions.push({ id: `sol_${idx}`, inputs, output });
      }
    });
  }
  
  return { variables, formulas, formula: formulas[0] || null, tolerance, decimalPlaces, solutions };
}

function extractFeedback(questionDiv) {
  const correctEl = questionDiv.querySelector('.correct_comments .comment_html, .correct_feedback');
  const incorrectEl = questionDiv.querySelector('.incorrect_comments .comment_html, .incorrect_feedback');
  const neutralEl = questionDiv.querySelector('.neutral_comments .comment_html, .general_feedback');
  
  return {
    correct: correctEl ? cleanHtml(correctEl.innerHTML) : null,
    incorrect: incorrectEl ? cleanHtml(incorrectEl.innerHTML) : null,
    neutral: neutralEl ? cleanHtml(neutralEl.innerHTML) : null
  };
}

// ========== END CLASSIC QUIZ PARSING ==========

// Inject page script so we can patch fetch/XHR in page JS environment
const s = document.createElement("script");
s.src = chrome.runtime.getURL("inject.js");
document.documentElement.appendChild(s);
s.remove();

// Listen for bank detection events from inject.js
window.addEventListener("CanvasExporter_BankDetected", (e) => {
  chrome.runtime.sendMessage({
    type: "BANK_DETECTED",
    bank: e.detail,
  });
});

// Listen for API base detection events from inject.js
window.addEventListener("CanvasExporter_ApiBaseDetected", (e) => {
  chrome.runtime.sendMessage({
    type: "API_BASE_DETECTED",
    apiBase: e.detail.apiBase,
  });
});

// Listen for bearer token detection from inject.js
window.addEventListener("CanvasExporter_AuthDetected", (e) => {
  const { bearerToken, apiDomain } = e.detail;
  if (bearerToken) {
    console.log("[CanvasExporter] Forwarding bearer token to background:", apiDomain);
    chrome.runtime.sendMessage({
      type: "AUTH_DETECTED",
      bearerToken,
      apiDomain,
    });
  }
});

// ========== API PROXY VIA PAGE CONTEXT ==========
// Route API calls through inject.js (page context) to bypass CORS

const pendingRequests = new Map();

function fetchViaPage(url, paginated = false) {
  return new Promise((resolve, reject) => {
    const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    
    // Set timeout to avoid hanging forever
    const timeout = setTimeout(() => {
      pendingRequests.delete(requestId);
      reject(new Error("Request timed out after 30s"));
    }, 30000);
    
    pendingRequests.set(requestId, { 
      resolve: (data) => {
        clearTimeout(timeout);
        resolve(data);
      }, 
      reject: (err) => {
        clearTimeout(timeout);
        reject(err);
      }
    });
    
    console.log("[CanvasExporter] Dispatching fetch request to page context:", { requestId, url, paginated });
    
    window.dispatchEvent(new CustomEvent("CanvasExporter_FetchRequest", {
      detail: { requestId, url, paginated }
    }));
  });
}

// Listen for responses from inject.js (page context)
window.addEventListener("CanvasExporter_FetchResponse", (e) => {
  const { requestId, success, data, error } = e.detail;
  console.log("[CanvasExporter] Received fetch response from page context:", { requestId, success });
  
  const pending = pendingRequests.get(requestId);
  if (pending) {
    pendingRequests.delete(requestId);
    if (success) {
      pending.resolve(data);
    } else {
      pending.reject(new Error(error));
    }
  }
});

// ========== MESSAGE HANDLERS FOR BACKGROUND SCRIPT ==========

// Track if this frame has responded to prevent duplicate responses
let hasRespondedToRequest = new Set();

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Handle Classic HTML parsing (runs in DOM context where DOMParser is available)
  if (msg.type === "PARSE_CLASSIC_HTML") {
    try {
      console.log("[CanvasExporter] Parsing Classic HTML in content script context...");
      const result = parseClassicBankHtml(msg.html);
      
      // Hash questions asynchronously
      (async () => {
        const questionsWithHashes = [];
        for (const q of result.questions) {
          const hash = await hashQuestion(q);
          questionsWithHashes.push({ ...q, hash });
        }
        result.questions = questionsWithHashes;
        sendResponse({ success: true, data: result });
      })();
    } catch (error) {
      console.error("[CanvasExporter] Parse error:", error);
      sendResponse({ success: false, error: error.message });
    }
    return true; // Keep channel open for async response
  }
  
  // Handle HTML page fetch requests (for Classic Quiz banks)
  if (msg.type === "FETCH_HTML") {
    fetch(msg.url, { credentials: 'include' })
      .then(response => {
        if (response.redirected && response.url.includes('/login')) {
          throw new Error('Authentication required - please log into Canvas');
        }
        if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        return response.text();
      })
      .then(html => {
        if (html.includes('id="login_form"') || html.includes('Log In to Canvas')) {
          throw new Error('Session expired - please log into Canvas');
        }
        sendResponse({ success: true, html });
      })
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
  
  // Handle FETCH messages - ALL frames can respond, but only the one with tokens will
  // The page context (inject.js) will check if it has tokens before responding
  if (msg.type === "FETCH_API" || msg.type === "FETCH_PAGINATED") {
    const requestKey = `${msg.type}:${msg.url}`;
    
    // Prevent this frame from responding twice to the same request
    if (hasRespondedToRequest.has(requestKey)) {
      console.log("[CanvasExporter] Already handled this request, skipping");
      return false;
    }
    
    const isTopFrame = window === window.top;
    console.log(`[CanvasExporter] ${msg.type} request (${isTopFrame ? 'top' : 'iframe'}):`, msg.url.substring(0, 80));
    
    // Route through page context - inject.js will check if it has tokens
    fetchViaPage(msg.url, msg.type === "FETCH_PAGINATED")
      .then(data => {
        hasRespondedToRequest.add(requestKey);
        // Clear after 5 seconds to allow retries
        setTimeout(() => hasRespondedToRequest.delete(requestKey), 5000);
        sendResponse({ success: true, data });
      })
      .catch(error => {
        // Only send error response if we're the top frame (fallback)
        // Iframes should silently fail to let other frames try
        if (isTopFrame || error.message.includes('TOKEN_EXPIRED')) {
          hasRespondedToRequest.add(requestKey);
          setTimeout(() => hasRespondedToRequest.delete(requestKey), 5000);
          sendResponse({ success: false, error: error.message });
        }
      });
    return true; // Keep channel open for async response
  }
});

console.log("[CanvasExporter] Content script ready - API calls will route through page context");
