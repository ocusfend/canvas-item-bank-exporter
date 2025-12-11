// ============================================================================
// Canvas Quiz Bank Exporter - Utility Module (JSON Export)
// ============================================================================

export const DEBUG = true;

// API base candidates for probe fallback
export const API_BASE_CANDIDATES = [
  "/api/",
  "/learnosity_proxy/api/",
  "/quiz-lti-prod/api/",
  "/quiz-lti-us-prod/api/",
  "/quiz-lti-eu-prod/api/",
  "/quiz-lti-ap-southeast-prod/api/",
  "/quiz-lti-ca-central-prod/api/",
  "/quiz-lti-au-prod/api/"
];

// ========== STRUCTURED LOGGING ==========
export function debugLog(category, message) {
  if (!DEBUG) return;
  
  const colors = {
    "FETCH": "color:#4caf50;font-weight:bold",
    "SKIP":  "color:#ff9800;font-weight:bold",
    "ERR":   "color:#f44336;font-weight:bold",
    "API":   "color:#2196f3;font-weight:bold",
    "BANK":  "color:#9c27b0;font-weight:bold",
    "PROG":  "color:#00bcd4;font-weight:bold",
    "DONE":  "color:#8bc34a;font-weight:bold",
    "AUTH":  "color:#607d8b;font-weight:bold",
    "WARN":  "color:#ff9800;font-weight:bold"
  };
  
  const style = colors[category] || "color:#757575";
  console.log(`%c[${category}] ${message}`, style);
}

// ========== API HELPERS ==========
export function normalizeApiBase(apiBase) {
  if (!apiBase) return "/api/";
  return apiBase.endsWith('/') ? apiBase : apiBase + '/';
}

// ========== QUESTION TYPE MAPPING (NEW QUIZZES) ==========
export const CANVAS_TO_QB_TYPE_MAP = {
  // === MULTIPLE CHOICE / SELECTION ===
  'multiple_choice_question': 'MC',
  'choice': 'MC',
  'true_false_question': 'TF',
  'true-false': 'TF',
  'multiple_answers_question': 'MR',
  'multi-answer': 'MR',
  
  // === TEXT INPUT ===
  'short_answer_question': 'SA',
  'essay_question': 'ESS',
  'essay': 'ESS',
  'rich-fill-blank': 'SA',
  'fill-blank': 'SA',
  
  // === NUMERIC ===
  'numerical_question': 'NUM',
  'numeric': 'NUM',
  
  // === FILE UPLOAD ===
  'file_upload_question': 'FU',
  'file-upload': 'FU',
  
  // === MATCHING ===
  'matching_question': 'MAT',
  'matching': 'MAT',
  'match': 'MAT',
  
  // === CATEGORIZATION ===
  'categorization_question': 'CAT',
  'categorization': 'CAT',
  'categorize': 'CAT',
  
  // === ORDERING ===
  'ordering_question': 'ORD',
  'ordering': 'ORD',
  'order': 'ORD',
  
  // === HOT SPOT ===
  'hot_spot_question': 'HS',
  'hot-spot': 'HS',
  'hotspot': 'HS',
  
  // === FORMULA ===
  'formula_question': 'FORM',
  'formula': 'FORM',
  'calculated_question': 'FORM',
  
  // === PASSAGE / TEXT BLOCK ===
  'text-block': 'PASSAGE',
  'text_block': 'PASSAGE',
  'passage': 'PASSAGE',
  'stimulus': 'STIMULUS',
  
  // === EXPLICIT INCLUSION (Hot Spot variants) ===
  'explicit-constructed-response': 'ECR',
  'drag-drop': 'DD',
  'draw': 'DRAW',
  'highlight': 'HL',
  'cloze': 'CLOZE'
};

// ========== CLASSIC QUIZ TYPE MAPPING ==========
export const CLASSIC_TYPE_MAP = {
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

// Unified type normalizer - single source of truth
export function normalizeType(canvasType, isClassic = false) {
  if (isClassic) {
    return CLASSIC_TYPE_MAP[canvasType] || canvasType?.toUpperCase() || 'UNKNOWN';
  }
  return CANVAS_TO_QB_TYPE_MAP[canvasType] || canvasType?.toUpperCase() || 'UNKNOWN';
}

// All types are now exported - importing app decides what to accept
export const SUPPORTED_TYPES = ['MC', 'MR', 'TF', 'SA', 'ESS', 'NUM', 'FU', 'PASSAGE'];

// Deprecated - kept for reference only, no longer used for filtering
export const SKIP_TYPES = [];

export function mapCanvasTypeToQBType(canvasType) {
  // Return mapped type if known, otherwise return original type in uppercase
  return CANVAS_TO_QB_TYPE_MAP[canvasType] || canvasType?.toUpperCase() || 'UNKNOWN';
}

// All question types are now supported - no filtering
export function isSupported(canvasType) {
  return true;
}

// ========== SANITIZATION ==========
export function sanitizeFilename(name) {
  return String(name || 'export')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .substring(0, 50);
}

// ========== SKIPPED ITEMS REPORTING ==========
export function summarizeSkippedItems(unsupported) {
  const typeCounts = {};
  for (const item of unsupported) {
    const type = item.question_type || item.interaction_type || 'unknown';
    typeCounts[type] = (typeCounts[type] || 0) + 1;
  }
  return Object.entries(typeCounts)
    .map(([type, count]) => `${type} (${count})`)
    .join(', ');
}

// Legacy exports for backwards compatibility
export const extractBankIdFromUrl = (url) => {
  const patterns = [
    /\/api\/banks\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
    /\/banks\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
    /\/bank\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
    /\/api\/banks\/(\d+)/i,
    /\/banks\/(\d+)/i,
    /\/bank\/(\d+)/i
  ];
  
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  
  return null;
};

export const extractBankUuidFromUrl = extractBankIdFromUrl;

export function isQuizLtiUrl(url) {
  try {
    const hostname = new URL(url).hostname;
    return hostname.includes("quiz-lti") && hostname.endsWith(".instructure.com");
  } catch {
    return false;
  }
}

// ========== CLASSIC QUIZ PARSING UTILITIES ==========

// Normalize blank IDs for FIMB/MDD questions
export function normalizeBlankId(id) {
  if (!id) return null;
  return id.trim().replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase();
}

// Clean Canvas UI noise from HTML content
export function cleanHtml(html) {
  if (!html) return '';
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  tmp.querySelectorAll('.drag_handle, .links, script, .screenreader-only, .hidden, [aria-hidden="true"]').forEach(e => e.remove());
  return tmp.innerHTML.trim();
}

// Extract plain text from HTML
export function htmlToText(html) {
  if (!html) return null;
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  return tmp.textContent?.trim() || null;
}

// Generate SHA-256 hash for question integrity
export async function hashQuestion(question) {
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

// Generate Canvas DOM signature for version detection
export function generateCanvasSignature(doc) {
  const indicators = {
    hasCsrfToken: !!doc.querySelector('meta[name="csrf-token"]'),
    hasNewRceEditor: !!doc.querySelector('[data-rce-wrapper]'),
    hasInstui: !!doc.querySelector('[class*="__instructure"]'),
    questionHolderClass: !!doc.querySelector('.question_holder'),
    answerWrapperClass: !!doc.querySelector('.answers_wrapper')
  };
  
  let domVersion = 'unknown';
  if (indicators.hasCsrfToken && indicators.questionHolderClass) {
    domVersion = indicators.hasInstui ? '2022+' : '2020+';
  }
  
  return {
    domVersion,
    indicators,
    extractedAt: new Date().toISOString()
  };
}

// ========== WARNING COLLECTOR ==========
export class ExportWarnings {
  constructor() {
    this.warnings = [];
  }
  
  add(questionId, message, severity = 'warn') {
    this.warnings.push({
      questionId,
      message,
      severity,
      timestamp: new Date().toISOString()
    });
    console.warn(`[Classic Parse] Q${questionId}: ${message}`);
  }
  
  toArray() {
    return this.warnings.length > 0 ? this.warnings : null;
  }
}

// ========== CLASSIC QUIZ HTML PARSING ==========

export function parseClassicBankHtml(html, warnings = new ExportWarnings()) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  
  // Detect login redirect
  if (doc.querySelector('#login_form') || doc.body?.textContent?.includes('Log In')) {
    throw new Error('Authentication required - please log into Canvas first');
  }
  
  // Generate Canvas signature
  const canvasSignature = generateCanvasSignature(doc);
  
  // Extract bank title
  const titleEl = doc.querySelector('h1') || doc.querySelector('.page-title');
  const bankTitle = titleEl?.textContent?.trim() || 'Untitled Bank';
  
  // Extract question groups
  const groups = extractQuestionGroups(doc);
  
  // Extract all questions (skip templates)
  const questionHolders = doc.querySelectorAll(
    '.question_holder:not([style*="display: none"]):not(#question_template):not(#question_teaser_blank)'
  );
  const questions = [];
  
  questionHolders.forEach((holder, idx) => {
    try {
      const question = extractClassicQuestion(holder, idx, warnings);
      if (question && question.type !== 'UNKNOWN') {
        questions.push(question);
      }
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

export function extractClassicQuestion(holder, index, warnings) {
  const questionDiv = holder.querySelector('.display_question.question');
  if (!questionDiv) return null;
  
  // Skip template/blank questions
  if (questionDiv.id === 'question_new' || questionDiv.id === 'question_blank') return null;
  
  // Extract question type
  const typeSpan = questionDiv.querySelector('.question_type');
  const rawType = typeSpan?.textContent?.trim() || extractTypeFromClass(questionDiv.className);
  if (!rawType || rawType === 'unknown') {
    warnings.add(`idx_${index}`, 'Could not determine question type');
    return null;
  }
  
  const mappedType = normalizeType(rawType, true);
  
  // Extract question ID
  const idMatch = questionDiv.id?.match(/question_(\d+)/);
  const questionId = idMatch ? idMatch[1] : `q_${index}`;
  
  // Generate UUID for global uniqueness
  const uuid = crypto.randomUUID();
  
  // Extract assessment question ID
  const assessmentIdEl = questionDiv.querySelector('.assessment_question_id');
  const assessmentId = assessmentIdEl?.textContent?.trim() || questionId;
  
  // Extract title/name
  const nameEl = questionDiv.querySelector('.question_name');
  const title = nameEl?.textContent?.trim() || `Question ${index + 1}`;
  
  // Extract points
  const pointsEl = questionDiv.querySelector('.question_points');
  const points = rawType === 'text_only_question' ? 0 : 
                 (parseFloat(pointsEl?.textContent?.trim()) || 1);
  
  // Extract question text (raw AND cleaned)
  const textareaEl = questionDiv.querySelector('.textarea_question_text');
  const renderedEl = questionDiv.querySelector('.question_text.user_content');
  const bodyRaw = textareaEl?.value?.trim() || 
                  textareaEl?.textContent?.trim() || 
                  renderedEl?.innerHTML?.trim() || '';
  const body = cleanHtml(bodyRaw);
  const bodyText = htmlToText(bodyRaw);
  
  // Extract blanks for FIMB/MDD questions
  const blanks = extractBlanks(questionDiv, rawType);
  
  // Extract answers based on question type
  const answers = extractClassicAnswers(questionDiv, rawType, questionId, warnings);
  
  // Extract calculated question data
  const calculatedData = rawType === 'calculated_question' ? 
    extractCalculatedQuestionData(questionDiv) : null;
  
  // Extract feedback (normalized structure)
  const feedback = extractFeedback(questionDiv);
  
  // Determine migration compatibility
  const migratableToNewQuizzes = determineMigratability(rawType, answers, calculatedData);
  
  // Build question object
  const question = {
    id: questionId,
    uuid,
    assessmentId,
    type: mappedType,
    originalType: rawType,
    title,
    points,
    body,
    bodyRaw,
    bodyText,
    answers,
    feedback,
    migratableToNewQuizzes
  };
  
  // Add type-specific fields
  if (blanks) question.blanks = blanks;
  if (calculatedData) question.calculatedData = calculatedData;
  if (rawType === 'text_only_question') question.isInformational = true;
  
  return question;
}

function determineMigratability(type, answers, calculatedData) {
  const nonMigratableTypes = ['calculated_question'];
  if (nonMigratableTypes.includes(type)) return false;
  if (type === 'numerical_question') {
    const hasApproximate = answers?.some(a => a.numericalType === 'approximate');
    if (hasApproximate) return false;
  }
  return true;
}

function extractBlanks(questionDiv, questionType) {
  if (!['fill_in_multiple_blanks_question', 'multiple_dropdowns_question'].includes(questionType)) {
    return null;
  }
  
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
  // Matching questions use pairs structure
  if (questionType === 'matching_question') {
    return extractMatchingPairs(questionDiv, questionId, warnings);
  }
  
  const answerDivs = questionDiv.querySelectorAll('.answers_wrapper .answer:not(#answer_template)');
  const answers = [];
  
  answerDivs.forEach((answerDiv, idx) => {
    if (answerDiv.id === 'answer_template') return;
    
    // Get answer ID
    const idEl = answerDiv.querySelector("span.hidden.id, span[class*='id']");
    const answerId = idEl?.textContent?.trim() || 
                     answerDiv.id?.replace('answer_', '') || 
                     `a_${idx}`;
    
    // Get blank ID (normalized)
    const blankIdEl = answerDiv.querySelector('.blank_id');
    const blankIdFromClass = answerDiv.className.match(/answer_for_(\w+)/)?.[1];
    const rawBlankId = blankIdEl?.textContent?.trim();
    const effectiveBlankId = (rawBlankId && rawBlankId !== 'none') ? 
      normalizeBlankId(rawBlankId) : 
      (blankIdFromClass ? normalizeBlankId(blankIdFromClass) : null);
    
    // Check if correct
    const isCorrect = answerDiv.classList.contains('correct_answer') ||
      answerDiv.querySelector('.answer_weight')?.textContent?.trim() === '100';
    
    // Get answer weight
    const weightEl = answerDiv.querySelector('.answer_weight');
    const weight = parseInt(weightEl?.textContent?.trim()) || (isCorrect ? 100 : 0);
    
    if (questionType === 'numerical_question') {
      const numericalAnswer = extractNumericalAnswer(answerDiv, answerId, questionId, warnings);
      if (numericalAnswer) answers.push({ ...numericalAnswer, correct: isCorrect, weight });
    } else {
      // Standard answers (MC, TF, MR, SA, FIMB, MDD, ESS, FU)
      const answerTextEl = answerDiv.querySelector('.answer_text');
      const answerHtmlEl = answerDiv.querySelector('.answer_html');
      const shortAnswerInput = answerDiv.querySelector('.answer_type.short_answer input');
      
      const textRaw = answerTextEl?.textContent?.trim() || 
                      shortAnswerInput?.value?.trim() || '';
      const htmlRaw = answerHtmlEl?.innerHTML?.trim() || '';
      
      if (!textRaw && !htmlRaw) {
        return;
      }
      
      // Per-answer feedback (normalized)
      const commentEl = answerDiv.querySelector('.answer_comment');
      const commentHtmlEl = answerDiv.querySelector('.answer_comment_html');
      const feedbackHtml = cleanHtml(commentHtmlEl?.innerHTML || '');
      const feedbackText = commentEl?.textContent?.trim() || htmlToText(feedbackHtml);
      
      answers.push({
        id: answerId,
        text: textRaw,
        html: cleanHtml(htmlRaw) || null,
        correct: isCorrect,
        weight,
        blankId: effectiveBlankId,
        feedback: (feedbackHtml || feedbackText) ? { html: feedbackHtml || null, text: feedbackText || null } : null
      });
    }
  });
  
  return answers;
}

// Matching pairs extraction for cleaner structure
function extractMatchingPairs(questionDiv, questionId, warnings) {
  const answerDivs = questionDiv.querySelectorAll('.answers_wrapper .answer:not(#answer_template)');
  const pairs = [];
  const distractors = [];
  
  answerDivs.forEach((answerDiv, idx) => {
    if (answerDiv.id === 'answer_template') return;
    
    const idEl = answerDiv.querySelector("span.hidden.id");
    const answerId = idEl?.textContent?.trim() || `a_${idx}`;
    
    const leftEl = answerDiv.querySelector('.answer_match_left');
    const rightEl = answerDiv.querySelector('.answer_match_right .correct_answer');
    const matchIdEl = answerDiv.querySelector('.match_id');
    
    const leftText = leftEl?.textContent?.trim() || '';
    const rightText = rightEl?.textContent?.trim() || '';
    
    if (leftText && rightText) {
      pairs.push({
        id: answerId,
        left: leftText,
        right: rightText,
        matchId: matchIdEl?.textContent?.trim() || null
      });
    } else if (rightText && !leftText) {
      distractors.push({
        id: answerId,
        text: rightText
      });
    } else if (leftText && !rightText) {
      warnings.add(questionId, `Matching item "${leftText}" has no right-side match`);
    }
  });
  
  return {
    type: 'matching',
    pairs,
    distractors: distractors.length > 0 ? distractors : null
  };
}

// Improved numerical answer extraction with fallback detection
function extractNumericalAnswer(answerDiv, answerId, questionId, warnings) {
  const answerTypeEl = answerDiv.querySelector('.numerical_answer_type');
  const rawNumericalType = answerTypeEl?.textContent?.trim() || '';
  
  // Extract all possible values
  const exactEl = answerDiv.querySelector('.answer_exact');
  const marginEl = answerDiv.querySelector('.answer_error_margin');
  const rangeStartEl = answerDiv.querySelector('.answer_range_start');
  const rangeEndEl = answerDiv.querySelector('.answer_range_end');
  const precisionEl = answerDiv.querySelector('.answer_approximate');
  const precisionScaleEl = answerDiv.querySelector('.answer_precision');
  
  const exact = parseFloat(exactEl?.textContent?.trim());
  const margin = parseFloat(marginEl?.textContent?.trim()) || 0;
  const rangeStart = parseFloat(rangeStartEl?.textContent?.trim());
  const rangeEnd = parseFloat(rangeEndEl?.textContent?.trim());
  const precision = parseFloat(precisionEl?.textContent?.trim());
  const precisionScale = parseInt(precisionScaleEl?.textContent?.trim());
  
  // Determine numerical type
  let numericalType = 'exact';
  
  if (rawNumericalType.includes('range') || (!isNaN(rangeStart) && !isNaN(rangeEnd))) {
    numericalType = 'range';
  } else if (rawNumericalType.includes('precision') || rawNumericalType.includes('approximate') || !isNaN(precision)) {
    numericalType = 'approximate';
  } else if (margin > 0) {
    numericalType = 'exact_with_margin';
  } else if (!isNaN(exact)) {
    numericalType = 'exact';
  } else {
    warnings.add(questionId, `Could not determine numerical answer type; defaulting to 'exact'`);
  }
  
  return {
    id: answerId,
    numericalType,
    exact: !isNaN(exact) ? exact : null,
    margin,
    rangeStart: !isNaN(rangeStart) ? rangeStart : null,
    rangeEnd: !isNaN(rangeEnd) ? rangeEnd : null,
    precision: !isNaN(precision) ? precision : null,
    precisionScale: !isNaN(precisionScale) ? precisionScale : null
  };
}

function extractCalculatedQuestionData(questionDiv) {
  // Variables
  const variables = [];
  const varRows = questionDiv.querySelectorAll('.variable_definitions tbody tr');
  varRows.forEach(row => {
    const name = row.querySelector('.name')?.textContent?.trim();
    const min = parseFloat(row.querySelector('.min')?.textContent?.trim()) || 0;
    const max = parseFloat(row.querySelector('.max')?.textContent?.trim()) || 0;
    const scale = parseInt(row.querySelector('.scale')?.textContent?.trim()) || 0;
    if (name) variables.push({ name, min, max, decimalPlaces: scale });
  });
  
  // Formulas
  const formulas = [];
  const formulaDivs = questionDiv.querySelectorAll('.formulas_list div');
  formulaDivs.forEach(div => {
    const formula = div.textContent?.trim();
    if (formula) formulas.push(formula);
  });
  
  // Tolerance & decimal places
  const toleranceEl = questionDiv.querySelector('.answer_tolerance');
  const decimalEl = questionDiv.querySelector('.formula_decimal_places');
  
  // Solutions
  const solutions = [];
  const solutionRows = questionDiv.querySelectorAll('.equation_combinations tbody tr');
  const varHeaders = questionDiv.querySelectorAll('.equation_combinations thead th');
  solutionRows.forEach(row => {
    const cells = row.querySelectorAll('td');
    const varValues = {};
    cells.forEach((cell, i) => {
      if (i < cells.length - 1) {
        const varName = varHeaders[i]?.textContent?.trim();
        if (varName) varValues[varName] = parseFloat(cell.textContent?.trim()) || 0;
      } else {
        varValues._answer = parseFloat(cell.textContent?.trim()) || 0;
      }
    });
    if (Object.keys(varValues).length > 0) solutions.push(varValues);
  });
  
  return { 
    variables, 
    formulas, 
    tolerance: parseFloat(toleranceEl?.textContent?.trim()) || 0, 
    answerDecimalPlaces: parseInt(decimalEl?.textContent?.trim()) || 0, 
    solutions 
  };
}

// Normalized feedback structure
function extractFeedback(questionDiv) {
  const extractFeedbackPart = (htmlSelector, textSelector) => {
    const htmlEl = questionDiv.querySelector(htmlSelector);
    const textEl = questionDiv.querySelector(textSelector);
    const html = cleanHtml(htmlEl?.innerHTML || '');
    const text = textEl?.textContent?.trim() || htmlToText(html);
    if (!html && !text) return null;
    return { html: html || null, text: text || null };
  };
  
  const correct = extractFeedbackPart('.correct_comments_html', '.correct_comments');
  const incorrect = extractFeedbackPart('.incorrect_comments_html', '.incorrect_comments');
  const neutral = extractFeedbackPart('.neutral_comments_html', '.neutral_comments');
  
  if (!correct && !incorrect && !neutral) return null;
  return { correct, incorrect, neutral };
}

function extractTypeFromClass(className) {
  const typePatterns = [
    'multiple_choice_question', 'true_false_question', 'short_answer_question',
    'essay_question', 'matching_question', 'multiple_answers_question',
    'numerical_question', 'calculated_question', 'fill_in_multiple_blanks_question',
    'multiple_dropdowns_question', 'file_upload_question', 'text_only_question'
  ];
  
  for (const type of typePatterns) {
    if (className.includes(type)) return type;
  }
  return 'unknown';
}
