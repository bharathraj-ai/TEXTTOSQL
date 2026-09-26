// ============================================
// Query Classifier — Lightweight Fast Intent Classifier
// ============================================
// Classifies incoming user questions into:
//   1. CONVERSATION — Greetings, FAQs, help, capabilities ("Hi", "Hello", "Who are you?", "What can you do?", etc.)
//   2. DATABASE_QUERY — Read-only analytical queries ("Show students", "Average mark", "Top 5", etc.)
//   3. DATABASE_MODIFICATION — DML write queries ("Add Rahul", "Update mark to 90", "Delete Rahul", etc.)
//   4. DDL — Data Definition Language ("Create employees table", "Alter table", "Drop table", "Truncate", etc.)
//   5. UNKNOWN — Unclear questions
//
// Fast and deterministic: Does NOT waste expensive LLM calls simply to identify obvious greetings.

const QUERY_CATEGORIES = {
  CONVERSATION: 'CONVERSATION',
  DATABASE_QUERY: 'DATABASE_QUERY',
  DATABASE_MODIFICATION: 'DATABASE_MODIFICATION',
  DDL: 'DDL',
  UNKNOWN: 'UNKNOWN',
};

// Conversational greetings and meta questions
const GREETING_PATTERNS = [
  /^(hi|hello|hey|hiya|howdy|hola|greetings|good\s+(morning|afternoon|evening|day))\b/i,
  /^who\s+are\s+you\b/i,
  /^what\s+can\s+you\s+do\b/i,
  /^what\s+is\s+this\s+(app|application|system|tool)\b/i,
  /^explain\s+what\s+this\s+(app|application|system|tool)\s+does\b/i,
  /^how\s+do\s+i\s+use\s+(this|you)\b/i,
  /^(help|commands|options|capabilities|features)\b/i,
  /^tell\s+me\s+about\s+yourself\b/i,
  /^thanks|thank\s+you\b/i,
];

// DDL (Data Definition Language) patterns
const DDL_PATTERNS = [
  /\bcreate\s+table\b/i,
  /\bcreate\s+(?:an?\s+)?[a-z0-9_]+\s+table\b/i,
  /\bdrop\s+table\b/i,
  /\bdrop\s+(?:the\s+)?[a-z0-9_]+\s+table\b/i,
  /\bdrop\s+[a-z0-9_]+\b/i,
  /\bdrop\s+database\b/i,
  /\bdrop\s+schema\b/i,
  /\btruncate\s+(table\s+)?/i,
  /\balter\s+table\b/i,
  /\bcreate\s+index\b/i,
  /\bdrop\s+index\b/i,
  /^(create|alter|drop|truncate)\s+[a-zA-Z0-9_]+\s+(table)?\b/i,
  /\b(add\s+column|drop\s+column|modify\s+column|rename\s+column|rename\s+table)\b/i,
  /\badd\s+(?:an?\s+)?[a-z0-9_]+\s+column\b/i,
];

// DML (Data Manipulation Language) modification patterns
const DML_PATTERNS = [
  /^(insert|update|delete)\b/i,
  /\binsert\s+into\b/i,
  /\bdelete\s+from\b/i,
  /\b(add|insert|register|enroll|record|save|create\s+a\s+new|new)\s+[a-zA-Z0-9_]+\s+(named?|with|in)\b/i,
  /\badd\s+[a-zA-Z0-9_]+\s+with\b/i,
  /\bupdate\s+[a-zA-Z0-9_]+('s)?\s+(mark|score|email|name|status|salary|price|age|department)\b/i,
  /\bupdate\s+[a-zA-Z0-9_]+\s+set\b/i,
  /\bset\s+[a-zA-Z0-9_]+\s+(to|=)\b/i,
  /\b(delete|remove|erase|purge)\s+[a-zA-Z0-9_]+\s+(from|named?|where|with)?\b/i,
  /\bdelete\s+student\b/i,
  /\bdelete\s+[A-Z][a-z]+\b/, // e.g. "delete Rahul"
];

// Read queries
const READ_QUERY_PATTERNS = [
  /\b(show|display|list|find|get|fetch|select|view|retrieve)\b/i,
  /\b(how\s+many|count|total|number\s+of)\b/i,
  /\b(average|avg|mean|sum|minimum|min|maximum|max|highest|lowest)\b/i,
  /\b(top\s+\d+|bottom\s+\d+|first\s+\d+|last\s+\d+)\b/i,
  /\b(order\s+by|group\s+by|sorted\s+by|filter\s+by)\b/i,
  /\b(who\s+has|which\s+department|what\s+is\s+the)\b/i,
];

/**
 * Classifies a user's natural language input.
 *
 * @param {string} input - User query string
 * @returns {{
 *   category: 'CONVERSATION'|'DATABASE_QUERY'|'DATABASE_MODIFICATION'|'DDL'|'UNKNOWN',
 *   confidence: number,
 *   reason: string
 * }}
 */
function classifyQuery(input) {
  if (!input || typeof input !== 'string') {
    return {
      category: QUERY_CATEGORIES.UNKNOWN,
      confidence: 0,
      reason: 'Empty input',
    };
  }

  const q = input.trim();
  const lower = q.toLowerCase();

  // 1. Check for Conversational / Greeting
  for (const pattern of GREETING_PATTERNS) {
    if (pattern.test(lower)) {
      return {
        category: QUERY_CATEGORIES.CONVERSATION,
        confidence: 0.95,
        reason: 'Detected conversational greeting or general assistance request.',
      };
    }
  }

  // 2. Check for DDL operations
  for (const pattern of DDL_PATTERNS) {
    if (pattern.test(lower)) {
      return {
        category: QUERY_CATEGORIES.DDL,
        confidence: 0.95,
        reason: 'Detected database schema definition (DDL) operation.',
      };
    }
  }

  // 3. Check for Database Modification (DML)
  for (const pattern of DML_PATTERNS) {
    if (pattern.test(q)) {
      return {
        category: QUERY_CATEGORIES.DATABASE_MODIFICATION,
        confidence: 0.90,
        reason: 'Detected database record modification (INSERT/UPDATE/DELETE).',
      };
    }
  }

  // 4. Check for Database Query (SELECT)
  for (const pattern of READ_QUERY_PATTERNS) {
    if (pattern.test(lower)) {
      return {
        category: QUERY_CATEGORIES.DATABASE_QUERY,
        confidence: 0.90,
        reason: 'Detected data retrieval query.',
      };
    }
  }

  // Fallback heuristic: If starts with SQL keyword
  if (/^select\b/i.test(q)) {
    return {
      category: QUERY_CATEGORIES.DATABASE_QUERY,
      confidence: 1.0,
      reason: 'Raw SELECT SQL statement detected.',
    };
  }

  if (/^(insert|update|delete)\b/i.test(q)) {
    return {
      category: QUERY_CATEGORIES.DATABASE_MODIFICATION,
      confidence: 1.0,
      reason: 'Raw DML statement detected.',
    };
  }

  if (/^(create|alter|drop|truncate)\b/i.test(q)) {
    return {
      category: QUERY_CATEGORIES.DDL,
      confidence: 1.0,
      reason: 'Raw DDL statement detected.',
    };
  }

  // Default to DATABASE_QUERY if it mentions any common nouns
  return {
    category: QUERY_CATEGORIES.DATABASE_QUERY,
    confidence: 0.60,
    reason: 'Defaulted to database query based on general sentence structure.',
  };
}

module.exports = {
  classifyQuery,
  QUERY_CATEGORIES,
};
