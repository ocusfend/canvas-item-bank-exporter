// Canvas New Quizzes Item Bank Exporter - Utility Functions

export const DEBUG = true;

/**
 * Debug logging with prefix
 */
export function debugLog(...args) {
  if (DEBUG) console.log("[CanvasExporter]", ...args);
}

/**
 * Debug grouping for cleaner logs
 */
export function debugGroup(label, fn) {
  if (DEBUG) {
    console.group(`[CanvasExporter] ${label}`);
    try {
      fn();
    } finally {
      console.groupEnd();
    }
  } else {
    fn();
  }
}

/**
 * Check if URL is a valid quiz-lti domain
 * Validates hostname contains "quiz-lti" AND ends with ".instructure.com"
 */
export function isQuizLtiUrl(url) {
  try {
    const hostname = new URL(url).hostname;
    return hostname.includes("quiz-lti") && hostname.endsWith(".instructure.com");
  } catch {
    return false;
  }
}

/**
 * Extract bank ID from URL using path-specific patterns
 * Supports both UUID format and numeric IDs (e.g., /banks/3387)
 * Matches: /api/banks/<ID>, /banks/<ID>, /bank/<ID>
 */
export function extractBankIdFromUrl(url) {
  const patterns = [
    // UUID patterns
    /\/api\/banks\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
    /\/banks\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
    /\/bank\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
    // Numeric ID patterns (e.g., /banks/3387)
    /\/api\/banks\/(\d+)/i,
    /\/banks\/(\d+)/i,
    /\/bank\/(\d+)/i
  ];
  
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  
  return null;
}

// Keep old name as alias for backwards compatibility
export const extractBankUuidFromUrl = extractBankIdFromUrl;
