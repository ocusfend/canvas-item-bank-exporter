// ============================================================================
// Canvas Item Bank Exporter - Utility Module (JSON Export)
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

// ========== QUESTION TYPE MAPPING ==========
export const CANVAS_TO_QB_TYPE_MAP = {
  'multiple_choice_question': 'MC',
  'true_false_question': 'TF',
  'multiple_answers_question': 'MR',
  'short_answer_question': 'SA',
  'essay_question': 'ESS',
  'numerical_question': 'NUM',
  'file_upload_question': 'FU',
  'choice': 'MC',
  'true-false': 'TF',
  'multi-answer': 'MR',
  'essay': 'ESS',
  'numeric': 'NUM',
  // Rich fill-in-blank types - treat as short answer
  'rich-fill-blank': 'SA',
  'fill-blank': 'SA',
  // File upload support
  'file-upload': 'FU',
  // Text block/passage support
  'text-block': 'PASSAGE'
};

export const SUPPORTED_TYPES = ['MC', 'MR', 'TF', 'SA', 'ESS', 'NUM', 'FU', 'PASSAGE'];

export const SKIP_TYPES = [
  // Legacy Canvas formats
  'calculated_question', 'fill_in_multiple_blanks_question',
  'matching_question', 'multiple_dropdowns_question',
  'hot_spot_question', 'text_only_question',
  // New Quiz API slugs
  'categorization', 'ordering', 'hot-spot',
  'formula', 'matching',
  'stimulus'  // For passage: false Stimulus entries
];

export function mapCanvasTypeToQBType(canvasType) {
  return CANVAS_TO_QB_TYPE_MAP[canvasType] || null;
}

export function isSupported(canvasType) {
  const qbType = mapCanvasTypeToQBType(canvasType);
  return qbType && SUPPORTED_TYPES.includes(qbType);
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
