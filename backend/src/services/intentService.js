// ============================================
// Intent Service — Question Classification
// ============================================
// Day 3: Classifies natural-language questions into
// query intents before SQL generation. Detects ambiguous
// and unsupported questions to avoid bad SQL.

// ── Intent Types ──────────────────────────────────────
const INTENT = {
  SELECT: 'SELECT',
  FILTER: 'FILTER',
  AGGREGATION: 'AGGREGATION',
  GROUP_BY: 'GROUP_BY',
  SORT: 'SORT',
  JOIN: 'JOIN',
  TOP_N: 'TOP_N',
  COUNT: 'COUNT',
  AVERAGE: 'AVERAGE',
  SUM: 'SUM',
  MIN: 'MIN',
  MAX: 'MAX',
  COMPARISON: 'COMPARISON',
  INSERT: 'INSERT',
  UPDATE: 'UPDATE',
  DELETE: 'DELETE',
  UNKNOWN: 'UNKNOWN',
};

// ── Non-database question patterns ────────────────────
const UNSUPPORTED_PATTERNS = [
  /\b(weather|temperature|climate|forecast)\b/i,
  /\b(news|headlines|current events)\b/i,
  /\b(stock|share price|market)\b/i,
  /\b(recipe|cooking|food preparation)\b/i,
  /\b(translate|translation)\b/i,
  /\b(joke|riddle|fun fact)\b/i,
  /\b(who is|biography|born|died)\b/i,
  /\b(capital of|population of|area of)\b/i,
  /\b(calculate|math|equation|solve)\b/i,
  /\b(write me|generate code|programming)\b/i,
  /\b(what time|current time|date today)\b/i,
  /\b(how to|tutorial|explain how)\b/i,
  /\b(opinion|think about|feel about)\b/i,
];

// ── Ambiguous adjective patterns ──────────────────────
const AMBIGUOUS_TERMS = {
  'best': ['Highest total spending', 'Most orders', 'Highest rated', 'Highest mark/score'],
  'worst': ['Lowest spending', 'Fewest orders', 'Lowest rated', 'Lowest mark/score'],
  'top': null, // "top" followed by a number is fine (TOP_N), otherwise ambiguous
  'important': ['Highest revenue', 'Most orders', 'Longest relationship'],
  'popular': ['Most ordered', 'Most purchased', 'Most reviewed', 'Most enrollments'],
  'active': ['Most recent orders', 'Most orders', 'Most logins'],
  'inactive': ['No orders in last 30 days', 'No orders in last 90 days', 'Never ordered'],
  'good': ['High rating', 'High spending', 'Many orders'],
  'bad': ['Low rating', 'Many complaints', 'Many returns'],
  'recent': ['Today', 'Last 7 days', 'Last 30 days'],
  'old': ['Oldest by creation date', 'Oldest by age', 'Least recently active'],
  'big': ['Highest value', 'Largest quantity', 'Most items'],
  'large': ['Highest total amount', 'Largest quantity', 'Highest value'],
  'largest': ['Highest total amount', 'Largest quantity', 'Highest value'],
  'small': ['Lowest value', 'Smallest quantity', 'Fewest items'],
};

// ── Secret/credential patterns ────────────────────────
const SECRET_PATTERNS = [
  'password', 'api key', 'api_key', 'apikey', 'secret',
  'database_url', 'database url', 'connection string',
  'credentials', 'token', 'env variable', 'environment variable',
  '.env', 'private key',
];

// ── DDL-level mutation patterns (always blocked regardless of mode) ──
const DDL_MUTATION_PATTERNS = [
  /^(drop|truncate|alter|create|grant|revoke)\b/i,
  /\b(drop\s+table|drop\s+database|truncate\s+table|alter\s+table|grant\s+|revoke\s+)\b/i,
  /\b(drop\s+all|clear\s+table)\b/i,
];

// ── DML write patterns (allowed only in Read+Write mode) ──
const INSERT_PATTERNS = [
  /^insert\b/i,
  /\binsert\s+into\b/i,
  /\b(add|insert|register|enroll|record|save|create\s+a|add\s+a|put\s+a|include\s+a|new\s+\w+\s+named?)\b/i,
];
const UPDATE_PATTERNS = [
  /^update\b/i,
  /\b(update|change|modify|set|edit|correct|fix|adjust|rename|bump)\b/i,
];
const DELETE_PATTERNS = [
  /^delete\b/i,
  /\bdelete\s+from\b/i,
  /\b(delete|remove|erase|eliminate|purge|expel)\b/i,
  /\b(remove\s+all|delete\s+all)\b/i,
];

// Legacy combined check used by read-only mode
const MUTATION_PATTERNS = [
  ...DDL_MUTATION_PATTERNS,
  ...INSERT_PATTERNS,
  ...UPDATE_PATTERNS,
  ...DELETE_PATTERNS,
];

/**
 * Classify a question's intent. Returns an object with:
 * - intents: string[] — detected intent types
 * - isAmbiguous: boolean
 * - ambiguousDetail: { term, message, options } | null
 * - isUnsupported: boolean
 * - isSecretRequest: boolean
 * - isMutation: boolean
 *
 * @param {string} question
 * @param {object} schema - The user's database schema
 * @returns {object}
 */
function classifyIntent(question, schema) {
  const q = question.toLowerCase().trim();
  const result = {
    intents: [],
    isAmbiguous: false,
    ambiguousDetail: null,
    isUnsupported: false,
    isSecretRequest: false,
    isMutation: false,
  };

  // ── 0. Mutation check ───────────────────────────────
  if (MUTATION_PATTERNS.some((p) => p.test(q))) {
    result.isMutation = true;
    return result;
  }

  // ── 1. Secret request check ─────────────────────────
  if (SECRET_PATTERNS.some((p) => q.includes(p))) {
    result.isSecretRequest = true;
    return result;
  }

  // ── 2. Unsupported question check ───────────────────
  const hasSchemaReference = hasAnySchemaReference(q, schema);
  if (!hasSchemaReference && UNSUPPORTED_PATTERNS.some((p) => p.test(q))) {
    result.isUnsupported = true;
    return result;
  }

  // ── 3. Ambiguity check ──────────────────────────────
  for (const [term, defaultOptions] of Object.entries(AMBIGUOUS_TERMS)) {
    if (defaultOptions === null) continue; // Skip non-ambiguous terms

    const termRegex = new RegExp(`\\b${term}\\b`, 'i');
    if (termRegex.test(q)) {
      // Check if there's enough context to disambiguate
      const hasNumericQualifier = /\b\d+\b/.test(q);
      const hasSpecificColumn = hasColumnReference(q, schema);
      const hasDateQualifier = /\b(last\s+\d+\s+days?|today|yesterday|this\s+month|last\s+month|this\s+year)\b/i.test(q);

      if (!hasNumericQualifier && !hasSpecificColumn && !hasDateQualifier) {
        // Find what entity they're asking about
        const entity = findEntityInQuestion(q, schema) || 'items';
        const dynamicOptions = term === 'recent' ? defaultOptions : getAmbiguityOptions(term, entity, schema, defaultOptions);

        result.isAmbiguous = true;
        result.ambiguousDetail = {
          term,
          message: term === 'recent' ? 'How recent?' : `How should "${term} ${entity}" be measured?`,
          options: dynamicOptions,
        };
        break;
      }
    }
  }

  // ── 4. Intent classification ────────────────────────
  // COUNT
  if (/\b(how many|count|number of|total number)\b/i.test(q)) {
    result.intents.push(INTENT.COUNT);
  }

  // AVERAGE
  if (/\b(average|avg|mean)\b/i.test(q)) {
    result.intents.push(INTENT.AVERAGE);
  }

  // SUM
  if (/\b(total|sum|combined|altogether)\b/i.test(q) &&
      /\b(revenue|sales|amount|spending|value|cost|price|salary|income|order)\b/i.test(q)) {
    result.intents.push(INTENT.SUM);
  }

  // MAX (only when asking for maximum value/price, NOT when sorting items)
  if (/\b(maximum|max|highest|largest|biggest|most expensive)\b/i.test(q) &&
      !/\btop\s+\d+/i.test(q)) {
    result.intents.push(INTENT.MAX);
  }

  // MIN
  if (/\b(lowest|minimum|min|smallest|cheapest|least expensive)\b/i.test(q)) {
    result.intents.push(INTENT.MIN);
  }

  // TOP_N
  if (/\btop\s+\d+/i.test(q) || /\bfirst\s+\d+/i.test(q) ||
      /\bbottom\s+\d+/i.test(q) || /\blast\s+\d+/i.test(q) ||
      /\blowest\s+\d+/i.test(q) || /\bbest\b/i.test(q)) {
    result.intents.push(INTENT.TOP_N);
  }

  // GROUP_BY
  if (/\b(by|per|each|every|group|for each|per each|breakdown)\b/i.test(q) &&
      (result.intents.includes(INTENT.COUNT) ||
       result.intents.includes(INTENT.AVERAGE) ||
       result.intents.includes(INTENT.SUM) ||
       /\b(department|category|month|year|city|country|status|type|region)\b/i.test(q))) {
    result.intents.push(INTENT.GROUP_BY);
  }

  // AGGREGATION (general catch-all for aggregate queries)
  if (result.intents.includes(INTENT.COUNT) ||
      result.intents.includes(INTENT.AVERAGE) ||
      result.intents.includes(INTENT.SUM) ||
      result.intents.includes(INTENT.MAX) ||
      result.intents.includes(INTENT.MIN)) {
    result.intents.push(INTENT.AGGREGATION);
  }

  // SORT
  if (/\b(order by|sort|sorted|ordered|rank|ranking|ascending|descending|asc|desc|best|worst|top|highest|lowest)\b/i.test(q)) {
    result.intents.push(INTENT.SORT);
  }

  // FILTER
  if (/\b(where|from|with|above|below|greater|less|more than|at least|between|equal|older|younger|before|after|since|until|in|at)\b/i.test(q) &&
      (/\b\d+\b/.test(q) || hasSpecificValue(q))) {
    result.intents.push(INTENT.FILTER);
  }

  // JOIN (mention of multiple tables or relational terms)
  if (hasMultipleTableReferences(q, schema) ||
      /\b(and their|along with|with their|together with)\b/i.test(q)) {
    result.intents.push(INTENT.JOIN);
  }

  // COMPARISON
  if (/\b(compare|comparison|versus|vs|difference between)\b/i.test(q)) {
    result.intents.push(INTENT.COMPARISON);
  }

  // SELECT (base intent — everything is a select in read-only mode)
  if (result.intents.length === 0) {
    result.intents.push(INTENT.SELECT);
  }

  return result;
}

// ── Helper Functions ──────────────────────────────────

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasAnySchemaReference(q, schema) {
  if (!schema || !schema.tables) return false;

  for (const table of Object.keys(schema.tables)) {
    const singular = table.replace(/s$/, '').replace(/ies$/, 'y').replace(/es$/, '');
    const tableRegex = new RegExp(`\\b(${escapeRegex(table)}|${escapeRegex(singular)})\\b`, 'i');
    if (tableRegex.test(q)) return true;

    // Check column names
    for (const col of Object.keys(schema.tables[table].columns)) {
      if (col.length > 3) {
        const colReadable = col.replace(/_/g, ' ');
        const colRegex = new RegExp(`\\b(${escapeRegex(col)}|${escapeRegex(colReadable)})\\b`, 'i');
        if (colRegex.test(q)) return true;
      }
    }
  }

  // Also check for general database terms
  if (/\b(show|list|get|find|display|select|query|fetch|retrieve|search)\b/i.test(q)) {
    return true;
  }

  return false;
}

/**
 * Checks if the question mentions a specific column or metric that disambiguates
 * an adjective (e.g. "by mark", "with highest salary", "spending over 100").
 * Excludes table names, entity names, and generic ID/meta words.
 */
function hasColumnReference(q, schema) {
  if (!schema || !schema.tables) return false;

  const tableNames = Object.keys(schema.tables);
  const skipWords = new Set([
    'id', 'date', 'type', 'status', 'name', 'code', 'all', 'the', 'each', 'every',
    'value', 'data', 'record', 'records', 'row', 'rows', 'item', 'items'
  ]);
  for (const t of tableNames) {
    skipWords.add(t.toLowerCase());
    skipWords.add(t.toLowerCase().replace(/s$/, ''));
  }

  for (const tableInfo of Object.values(schema.tables)) {
    for (const col of Object.keys(tableInfo.columns)) {
      const colClean = col.toLowerCase().replace(/_/g, ' ');
      // If the full column name appears as a whole word/phrase in question
      if (!skipWords.has(colClean) && colClean.length > 2) {
        const colRegex = new RegExp(`\\b${escapeRegex(colClean)}\\b`, 'i');
        if (colRegex.test(q)) return true;
      }

      // Check individual words in column name
      const colWords = col.split('_');
      for (const word of colWords) {
        const wLower = word.toLowerCase();
        if (wLower.length > 3 && !skipWords.has(wLower)) {
          const wordRegex = new RegExp(`\\b${escapeRegex(wLower)}\\b`, 'i');
          if (wordRegex.test(q)) return true;
        }
      }
    }
  }
  return false;
}

function hasSpecificValue(q) {
  // Check for quoted values, dates, or specific named values
  return /'[^']+'/i.test(q) ||
         /"[^"]+"/i.test(q) ||
         /\b\d{4}-\d{2}-\d{2}\b/.test(q) ||
         /\b(today|yesterday|last\s+(week|month|year|30 days|7 days|90 days))\b/i.test(q) ||
         /\b(chennai|mumbai|delhi|bangalore|kolkata|hyderabad)\b/i.test(q);
}

function findEntityInQuestion(q, schema) {
  if (!schema || !schema.tables) return null;

  for (const table of Object.keys(schema.tables)) {
    const singular = table.replace(/s$/, '').replace(/ies$/, 'y').replace(/es$/, '');
    const tableRegex = new RegExp(`\\b(${escapeRegex(table)}|${escapeRegex(singular)})\\b`, 'i');
    if (tableRegex.test(q)) {
      return table;
    }
  }
  return null;
}

function hasMultipleTableReferences(q, schema) {
  if (!schema || !schema.tables) return false;

  let matchCount = 0;
  for (const table of Object.keys(schema.tables)) {
    const singular = table.replace(/s$/, '').replace(/ies$/, 'y').replace(/es$/, '');
    const tableRegex = new RegExp(`\\b(${escapeRegex(table)}|${escapeRegex(singular)})\\b`, 'i');
    if (tableRegex.test(q)) {
      matchCount++;
    }
  }
  return matchCount >= 2;
}

/**
 * Generate smart, schema-aware ambiguity options based on entity table columns.
 */
function getAmbiguityOptions(term, entity, schema, defaultOptions) {
  if (entity && schema && schema.tables && schema.tables[entity]) {
    const tableInfo = schema.tables[entity];
    const prefix = term === 'worst' ? 'Lowest' : 'Highest';
    const dynamicOptions = [];

    // Check numeric columns in entity table
    for (const [col, type] of Object.entries(tableInfo.columns)) {
      const t = type.toLowerCase();
      const isNum = t.includes('int') || t.includes('numeric') || t.includes('decimal') || t.includes('float');
      if (isNum && !col.endsWith('_id') && col !== 'id') {
        const colTitle = col.replace(/_/g, ' ');
        dynamicOptions.push(`${prefix} ${colTitle}`);
      }
    }

    // Check relationships for counts (e.g. enrollments, orders)
    if (schema.relationships) {
      for (const rel of schema.relationships) {
        const [fromT] = rel.from.split('.');
        const [toT] = rel.to.split('.');
        if (toT === entity && fromT !== entity) {
          dynamicOptions.push(`Most ${fromT}`);
        }
      }
    }

    if (dynamicOptions.length > 0) {
      return dynamicOptions.slice(0, 4);
    }
  }

  return defaultOptions.map((opt) => `${opt}`);
}

/**
 * Detect specific write intent type for write-mode routing.
 * Returns 'INSERT', 'UPDATE', 'DELETE', or null.
 *
 * @param {string} question
 * @returns {'INSERT'|'UPDATE'|'DELETE'|null}
 */
function detectWriteType(question) {
  const q = question.trim().toLowerCase();

  // DDL — never allowed
  if (DDL_MUTATION_PATTERNS.some((p) => p.test(q))) return null;

  // Specific DML checks (order matters: delete before update)
  if (DELETE_PATTERNS.some((p) => p.test(q))) return 'DELETE';
  if (UPDATE_PATTERNS.some((p) => p.test(q))) return 'UPDATE';
  if (INSERT_PATTERNS.some((p) => p.test(q))) return 'INSERT';
  return null;
}

/**
 * Checks if a question is a DDL mutation (always blocked).
 */
function isDDLMutation(question) {
  const q = question.trim().toLowerCase();
  return DDL_MUTATION_PATTERNS.some((p) => p.test(q));
}

module.exports = {
  classifyIntent,
  detectWriteType,
  isDDLMutation,
  INTENT,
  DDL_MUTATION_PATTERNS,
  INSERT_PATTERNS,
  UPDATE_PATTERNS,
  DELETE_PATTERNS,
};
