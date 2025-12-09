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
 * Extract bank UUID from URL using path-specific patterns
 * Matches: /api/banks/<UUID>, /banks/<UUID>, /bank/<UUID>
 */
export function extractBankUuidFromUrl(url) {
  const patterns = [
    /\/api\/banks\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
    /\/banks\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
    /\/bank\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i
  ];
  
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  
  return null;
}
