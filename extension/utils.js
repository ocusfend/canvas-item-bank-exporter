// ============================================================================
// Canvas Item Bank Exporter - Utility Module (Phase 4)
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
    "VALID": "color:#607d8b;font-weight:bold"
  };
  
  const style = colors[category] || "color:#757575";
  console.log(`%c[${category}] ${message}`, style);
}

// ========== API HELPERS ==========
export function normalizeApiBase(apiBase) {
  if (!apiBase) return "/api/";
  return apiBase.endsWith('/') ? apiBase : apiBase + '/';
}

export async function apiFetch(url) {
  debugLog("FETCH", url);
  const response = await fetch(url, { 
    credentials: 'include',
    mode: 'cors'
  });
  if (!response.ok) throw new Error(`API error: ${response.status}`);
  return response.json();
}

export async function trySequential(fetchers) {
  for (const fetcher of fetchers) {
    try {
      return await fetcher();
    } catch (e) {
      debugLog("ERR", `Endpoint failed, trying next: ${e.message}`);
      continue;
    }
  }
  throw new Error("All API endpoints failed");
}

export async function paginatedFetch(baseUrl) {
  const allItems = [];
  let url = baseUrl;
  let page = 1;
  const maxPages = 100;
  
  while (url && page <= maxPages) {
    debugLog("FETCH", `Page ${page}: ${url}`);
    const response = await fetch(url, { credentials: 'include', mode: 'cors' });
    
    if (!response.ok) throw new Error(`Pagination error: ${response.status}`);
    
    const data = await response.json();
    const items = Array.isArray(data) ? data : (data.items || data.entries || []);
    
    if (items.length === 0) break;
    allItems.push(...items);
    
    const linkHeader = response.headers.get('Link');
    const nextLink = parseLinkHeader(linkHeader)?.next;
    
    if (nextLink) {
      url = nextLink;
    } else if (items.length >= 50) {
      page++;
      const separator = baseUrl.includes('?') ? '&' : '?';
      url = `${baseUrl}${separator}page=${page}`;
    } else {
      break;
    }
  }
  
  debugLog("FETCH", `Total items fetched: ${allItems.length}`);
  return allItems;
}

function parseLinkHeader(header) {
  if (!header) return null;
  const links = {};
  header.split(',').forEach(part => {
    const match = part.match(/<([^>]+)>;\s*rel="([^"]+)"/);
    if (match) links[match[2]] = match[1];
  });
  return links;
}

export async function asyncPool(concurrency, items, fn) {
  const results = [];
  const executing = [];
  
  for (const item of items) {
    const p = Promise.resolve().then(() => fn(item));
    results.push(p);
    
    if (items.length >= concurrency) {
      const e = p.then(() => executing.splice(executing.indexOf(e), 1));
      executing.push(e);
      if (executing.length >= concurrency) {
        await Promise.race(executing);
      }
    }
  }
  return Promise.all(results);
}

// ========== QUESTION TYPE MAPPING ==========
export const CANVAS_TO_QB_TYPE_MAP = {
  'multiple_choice_question': 'MC',
  'true_false_question': 'TF',
  'multiple_answers_question': 'MR',
  'short_answer_question': 'SA',
  'essay_question': 'ESS',
  'numerical_question': 'NUM',
  'choice': 'MC',
  'true-false': 'TF',
  'multi-answer': 'MR',
  'essay': 'ESS',
  'numeric': 'NUM'
};

export const SUPPORTED_TYPES = ['MC', 'MR', 'TF', 'SA', 'ESS', 'NUM'];

export const SKIP_TYPES = [
  'calculated_question', 'fill_in_multiple_blanks_question',
  'matching_question', 'multiple_dropdowns_question',
  'hot_spot_question', 'file_upload_question', 'text_only_question',
  'categorization', 'ordering', 'hot-spot', 'fill-blank'
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

export function sanitizeIdentifier(id) {
  let sanitized = String(id)
    .replace(/[^a-zA-Z0-9_.-]/g, '_')
    .replace(/^([^a-zA-Z_])/, '_$1');
  
  return sanitized || `item_${Date.now()}`;
}

// ========== XML HELPERS ==========
export function escapeXML(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function validateXML(xmlString, filename) {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlString, "application/xml");
    const parseError = doc.querySelector("parsererror");
    
    if (parseError) {
      debugLog("VALID", `❌ Invalid XML in ${filename}: ${parseError.textContent}`);
      return false;
    }
    
    debugLog("VALID", `✅ Valid XML: ${filename}`);
    return true;
  } catch (e) {
    debugLog("ERR", `XML validation error for ${filename}: ${e.message}`);
    return false;
  }
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

export function generateSkippedReport(unsupported) {
  const lines = [
    "SKIPPED ITEMS REPORT",
    "====================",
    "",
    `Total skipped: ${unsupported.length}`,
    "",
    "These question types are not supported for QTI export:",
    ""
  ];
  
  const typeCounts = {};
  for (const item of unsupported) {
    const type = item.question_type || item.interaction_type || 'unknown';
    typeCounts[type] = (typeCounts[type] || 0) + 1;
  }
  
  for (const [type, count] of Object.entries(typeCounts)) {
    lines.push(`  • ${type}: ${count} item(s)`);
  }
  
  lines.push("");
  lines.push("Individual items:");
  lines.push("");
  
  for (const item of unsupported) {
    const title = item.question_name || item.title || item.id;
    const type = item.question_type || item.interaction_type;
    lines.push(`  - ID: ${item.id} | Type: ${type} | Title: ${title}`);
  }
  
  lines.push("");
  lines.push("To include these items, consider converting them to supported types");
  lines.push("in Canvas before re-exporting.");
  
  return lines.join("\n");
}

// ========== QTI 2.1 GENERATION ==========
export function generateItemXML(item) {
  const qbType = mapCanvasTypeToQBType(item.question_type || item.interaction_type);
  const questionId = `item_${sanitizeIdentifier(item.id)}`;
  
  switch (qbType) {
    case 'MC':
    case 'TF':
      return generateChoiceItemXML(item, questionId, 1);
    case 'MR':
      return generateChoiceItemXML(item, questionId, 0);
    case 'SA':
    case 'ESS':
      return generateTextItemXML(item, questionId, qbType);
    case 'NUM':
      return generateNumericalItemXML(item, questionId);
    default:
      debugLog("SKIP", `No XML generator for type: ${qbType}`);
      return null;
  }
}

function generateChoiceItemXML(item, questionId, maxChoices) {
  const answers = item.answers || item.choices || [];
  const questionText = item.question_text || item.stimulus || item.body || '';
  const title = escapeXML(item.question_name || item.title || questionText.substring(0, 50));
  
  let choicesXml = '';
  let correctIdentifiers = [];
  
  answers.forEach((answer, idx) => {
    const identifier = `choice_${idx + 1}`;
    const text = answer.text || answer.html || answer.body || '';
    const isCorrect = answer.weight > 0 || answer.correct === true;
    
    if (isCorrect) correctIdentifiers.push(identifier);
    
    choicesXml += `
      <simpleChoice identifier="${identifier}">
        <p>${escapeXML(text)}</p>
      </simpleChoice>`;
  });
  
  const correctResponseXml = correctIdentifiers.map(id => `<value>${id}</value>`).join('\n        ');
  const cardinality = maxChoices === 1 ? 'single' : 'multiple';
  
  return `<?xml version="1.0" encoding="UTF-8"?>
<assessmentItem xmlns="http://www.imsglobal.org/xsd/imsqti_v2p1"
    identifier="${questionId}"
    title="${title}"
    adaptive="false"
    timeDependent="false">
  <responseDeclaration identifier="RESPONSE" cardinality="${cardinality}" baseType="identifier">
    <correctResponse>
      ${correctResponseXml}
    </correctResponse>
  </responseDeclaration>
  <outcomeDeclaration identifier="SCORE" cardinality="single" baseType="float">
    <defaultValue><value>0</value></defaultValue>
  </outcomeDeclaration>
  <itemBody>
    <choiceInteraction responseIdentifier="RESPONSE" shuffle="false" maxChoices="${maxChoices}">
      <prompt>${escapeXML(questionText)}</prompt>
      ${choicesXml}
    </choiceInteraction>
  </itemBody>
  <responseProcessing template="https://www.imsglobal.org/question/qti_v2p1/rptemplates/match_correct"/>
</assessmentItem>`;
}

function generateTextItemXML(item, questionId, qbType) {
  const questionText = item.question_text || item.stimulus || item.body || '';
  const title = escapeXML(item.question_name || item.title || questionText.substring(0, 50));
  const expectedLines = qbType === 'ESS' ? 15 : 1;
  
  return `<?xml version="1.0" encoding="UTF-8"?>
<assessmentItem xmlns="http://www.imsglobal.org/xsd/imsqti_v2p1"
    identifier="${questionId}"
    title="${title}"
    adaptive="false"
    timeDependent="false">
  <responseDeclaration identifier="RESPONSE" cardinality="single" baseType="string"/>
  <outcomeDeclaration identifier="SCORE" cardinality="single" baseType="float">
    <defaultValue><value>0</value></defaultValue>
  </outcomeDeclaration>
  <itemBody>
    <extendedTextInteraction responseIdentifier="RESPONSE" expectedLines="${expectedLines}">
      <prompt>${escapeXML(questionText)}</prompt>
    </extendedTextInteraction>
  </itemBody>
</assessmentItem>`;
}

function generateNumericalItemXML(item, questionId) {
  const questionText = item.question_text || item.stimulus || item.body || '';
  const title = escapeXML(item.question_name || item.title || questionText.substring(0, 50));
  const answer = item.answers?.[0];
  const correctValue = answer?.exact || answer?.numerical_answer_id || 0;
  const tolerance = answer?.margin || answer?.tolerance || 0;
  const figures = String(tolerance).split('.')[1]?.length || 0;
  
  return `<?xml version="1.0" encoding="UTF-8"?>
<assessmentItem xmlns="http://www.imsglobal.org/xsd/imsqti_v2p1"
    identifier="${questionId}"
    title="${title}"
    adaptive="false"
    timeDependent="false">
  <responseDeclaration identifier="RESPONSE" cardinality="single" baseType="float">
    <correctResponse>
      <value>${correctValue}</value>
    </correctResponse>
  </responseDeclaration>
  <outcomeDeclaration identifier="SCORE" cardinality="single" baseType="float">
    <defaultValue><value>0</value></defaultValue>
  </outcomeDeclaration>
  <itemBody>
    <textEntryInteraction responseIdentifier="RESPONSE">
      <prompt>${escapeXML(questionText)}</prompt>
    </textEntryInteraction>
  </itemBody>
  <responseProcessing>
    <responseCondition>
      <responseIf>
        <equalRounded roundingMode="decimalPlaces" figures="${figures}">
          <variable identifier="RESPONSE"/>
          <baseValue baseType="float">${correctValue}</baseValue>
        </equalRounded>
        <setOutcomeValue identifier="SCORE">
          <baseValue baseType="float">1</baseValue>
        </setOutcomeValue>
      </responseIf>
    </responseCondition>
  </responseProcessing>
</assessmentItem>`;
}

export function generateManifestXML(bank, items) {
  const bankId = sanitizeFilename(bank.title || bank.name || bank.id);
  
  let resourcesXml = items.map(item => `
    <resource identifier="item_${sanitizeIdentifier(item.id)}" type="imsqti_item_xmlv2p1" href="items/item_${sanitizeIdentifier(item.id)}.xml">
      <file href="items/item_${sanitizeIdentifier(item.id)}.xml"/>
    </resource>`).join('');
  
  return `<?xml version="1.0" encoding="UTF-8"?>
<manifest xmlns="http://www.imsglobal.org/xsd/imscp_v1p1"
    xmlns:imsmd="http://www.imsglobal.org/xsd/imsmd_v1p2"
    identifier="MANIFEST-${escapeXML(bankId)}">
  <metadata>
    <schema>QTI Package</schema>
    <schemaversion>2.1</schemaversion>
    <imsmd:lom>
      <imsmd:general>
        <imsmd:title>
          <imsmd:string>${escapeXML(bank.title || bank.name || 'Exported Bank')}</imsmd:string>
        </imsmd:title>
      </imsmd:general>
    </imsmd:lom>
  </metadata>
  <organizations/>
  <resources>
    <resource identifier="assessment" type="imsqti_assessment_xmlv2p1" href="assessment.xml">
      <file href="assessment.xml"/>
    </resource>
    ${resourcesXml}
  </resources>
</manifest>`;
}

export function generateAssessmentXML(bank, items) {
  const bankId = sanitizeFilename(bank.title || bank.name || bank.id);
  
  const itemRefs = items.map(item => 
    `<assessmentItemRef identifier="item_${sanitizeIdentifier(item.id)}" href="items/item_${sanitizeIdentifier(item.id)}.xml"/>`
  ).join('\n      ');
  
  return `<?xml version="1.0" encoding="UTF-8"?>
<assessmentTest xmlns="http://www.imsglobal.org/xsd/imsqti_v2p1"
    identifier="test_${escapeXML(bankId)}"
    title="${escapeXML(bank.title || bank.name || 'Exported Assessment')}">
  <testPart identifier="part1" navigationMode="linear" submissionMode="individual">
    <assessmentSection identifier="section1" title="Main Section" visible="true">
      ${itemRefs}
    </assessmentSection>
  </testPart>
</assessmentTest>`;
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
