// ============================================
// LLM Service — Schema-agnostic rule-based SQL engine
// This is pattern and template generation, not a trained local model.
// ============================================
// Day 3: A fully local, zero-API SQL generation engine
// that works with ANY PostgreSQL schema. No hardcoded
// table/column names. Dynamically discovers entities
// from the user's schema and builds SQL accordingly.
//
// Capabilities:
//   - Tokenizes questions and matches against live schema
//   - Extracts tables, columns, values, operators
//   - Builds SQL using the matched schema entities
//   - Supports SELECT, FILTER, JOIN, GROUP BY, ORDER BY,
//     TOP N, COUNT, AVG, SUM, MIN, MAX, date filtering
//   - Generates plain-English explanations
//   - Generates schema-aware query suggestions
//   - Corrects failed SQL using levenshtein matching

// ── Secret Detection Patterns ─────────────────────────
const SECRET_PATTERNS = [
  'password', 'api key', 'api_key', 'apikey', 'secret',
  'database_url', 'database url', 'connection string',
  'credentials', 'token', 'env variable', 'environment variable',
  '.env', 'private key',
];

// ══════════════════════════════════════════════
// ─── Main Entry: Generate SQL ────────────────
// ══════════════════════════════════════════════

/**
 * Generate a PostgreSQL SELECT query from a natural-language question.
 * Entirely local — no API calls.
 *
 * @param {string} question - The user's input
 * @param {object} schema - { tables: { tableName: { columns: {}, primaryKeys: [] } }, relationships: [] }
 * @param {string[]} intents - Classified intents from intentService
 * @returns {string} - Generated SQL query
 */
function generateSQL(question, schema, intents = [], dbType = 'postgres') {
  if (!question || typeof question !== 'string') {
    throw new Error('No question provided.');
  }

  const trimmed = question.trim();
  const q = trimmed.toLowerCase();

  // ── Step 1: Reject secret requests ──────────────────
  if (isSecretRequest(q)) {
    throw new Error('I cannot provide system credentials, passwords, or environment variables.');
  }

  // ── Step 2: Detect raw query input ──────────────────
  if (dbType === 'mongodb') {
    if (trimmed.startsWith('db.')) {
      console.log(`[SLM] Direct MongoDB MQL detected: "${trimmed}"`);
      return trimmed;
    }
  } else if (isRawSQL(trimmed)) {
    console.log(`[SLM] Direct SQL detected: "${trimmed}"`);
    return trimmed.endsWith(';') ? trimmed : `${trimmed};`;
  }

  // ── Step 3: Extract schema entities from question ───
  const entities = extractSchemaEntities(q, schema);
  console.log(`[SLM] Entities:`, JSON.stringify(entities, null, 0));

  // ── Step 4: Build query from intents + entities ──────
  let query;
  if (dbType === 'mongodb') {
    query = buildMongoQuery(q, schema, entities, intents);
  } else {
    query = buildDynamicSQL(q, schema, entities, intents, dbType);
  }

  if (!query) {
    throw new Error('Unable to generate a valid query from the given question. Try rephrasing.');
  }

  return query;
}

// ══════════════════════════════════════════════
// ─── Schema Entity Extraction ────────────────
// ══════════════════════════════════════════════

/**
 * Extract relevant schema entities from a question by matching
 * against the actual database schema. Fully dynamic — no hardcoding.
 */
function extractSchemaEntities(q, schema) {
  const tables = Object.keys(schema.tables || {});
  const result = {
    matchedTables: [],       // Tables referenced in the question
    matchedColumns: [],      // { table, column, type } matches
    targetTable: null,       // Primary table for the query
    numericValue: null,      // Numeric threshold/filter value
    numericOperator: '>',    // Comparison operator
    stringValues: [],        // String filter values
    limit: null,             // LIMIT value
    sortDirection: null,     // ASC or DESC
    sortColumn: null,        // Column to sort by
    groupByColumn: null,     // Column to group by
    aggregateColumn: null,   // Column for aggregation
    aggregateFunction: null, // COUNT, AVG, SUM, MIN, MAX
    dateFilter: null,        // { interval, direction }
    joinTables: [],          // Tables that need to be joined
  };

  // ── 1. Match table names ────────────────────────────
  for (const table of tables) {
    const singular = makeSingular(table);
    const tableRegex = new RegExp(`\\b(${escapeRegex(table)}|${escapeRegex(singular)})\\b`, 'i');
    if (tableRegex.test(q)) {
      result.matchedTables.push(table);
    }
  }

  // If no table matched, try fuzzy matching
  if (result.matchedTables.length === 0) {
    for (const table of tables) {
      const words = q.split(/\s+/);
      for (const word of words) {
        if (word.length > 2 && levenshtein(word, table) <= 2) {
          result.matchedTables.push(table);
          break;
        }
        const sing = makeSingular(table);
        if (word.length > 2 && levenshtein(word, sing) <= 2) {
          result.matchedTables.push(table);
          break;
        }
      }
    }
  }

  // ── 2. Match column names across ALL tables ─────────
  for (const table of tables) {
    const tableInfo = schema.tables[table];
    if (!tableInfo) continue;

    for (const [col, colType] of Object.entries(tableInfo.columns)) {
      const colSingular = makeSingular(col);
      const colPlural = col.endsWith('s') ? col : `${col}s`;
      const colReadable = col.replace(/_/g, ' ');
      const colRegex = new RegExp(`\\b(${escapeRegex(col)}|${escapeRegex(colSingular)}|${escapeRegex(colPlural)}|${escapeRegex(colReadable)})\\b`, 'i');

      if (colRegex.test(q)) {
        result.matchedColumns.push({ table, column: col, type: colType });
      } else {
        const colWords = col.split('_').filter((w) => w.length > 3);
        for (const word of colWords) {
          const wSingular = makeSingular(word);
          const wPlural = word.endsWith('s') ? word : `${word}s`;
          const wordRegex = new RegExp(`\\b(${escapeRegex(word)}|${escapeRegex(wSingular)}|${escapeRegex(wPlural)})\\b`, 'i');
          if (wordRegex.test(q)) {
            result.matchedColumns.push({ table, column: col, type: colType });
            break;
          }
        }
      }
    }
  }

  // ── 3. Numeric values and operators ─────────────────
  const numMatch = q.match(
    /(?:above|greater than|more than|higher than|over|>=?|at least)\s*(\d+(?:\.\d+)?)/i
  );
  if (numMatch) {
    result.numericValue = parseFloat(numMatch[1]);
    result.numericOperator = '>';
  }

  const numMatchBelow = q.match(
    /(?:below|less than|lower than|under|<=?|at most)\s*(\d+(?:\.\d+)?)/i
  );
  if (numMatchBelow) {
    result.numericValue = parseFloat(numMatchBelow[1]);
    result.numericOperator = '<';
  }

  const numMatchEquals = q.match(
    /(?:equal to|equals?|exactly|is)\s+(\d+(?:\.\d+)?)\b/i
  );
  if (!result.numericValue && numMatchEquals) {
    result.numericValue = parseFloat(numMatchEquals[1]);
    result.numericOperator = '=';
  }

  if (!result.numericValue) {
    const standaloneNum = q.match(/\b(\d+(?:\.\d+)?)\b/);
    if (standaloneNum && !/top\s+\d+/i.test(q) && !/first\s+\d+/i.test(q) &&
        !/bottom\s+\d+/i.test(q) && !/last\s+\d+/i.test(q) &&
        !/limit\s+\d+/i.test(q)) {
      if (/\b(above|below|over|under|greater|less|more|higher|lower|than|least|most)\b/i.test(q)) {
        result.numericValue = parseFloat(standaloneNum[1]);
      }
    }
  }

  // ── 4. String filter values ─────────────────────────
  const quotedMatches = q.match(/['"]([^'"]+)['"]/g);
  if (quotedMatches) {
    result.stringValues = quotedMatches.map((m) => m.replace(/['"]/g, ''));
  }

  const fromMatch = q.match(/\bfrom\s+([a-z]+(?:\s+[a-z]+)?)\b/i);
  if (fromMatch && !tables.some((t) => fromMatch[1].toLowerCase() === t)) {
    const potentialValue = fromMatch[1].trim();
    if (potentialValue.length > 1 && !/\b(the|table|database)\b/i.test(potentialValue)) {
      result.stringValues.push(potentialValue);
    }
  }

  // ── 5. LIMIT (Top/Bottom N) ─────────────────────────
  const limitMatch = q.match(/\b(?:top|first|limit)\s+(\d+)/i);
  if (limitMatch) {
    result.limit = parseInt(limitMatch[1], 10);
  }
  const bottomMatch = q.match(/\b(?:bottom|last|lowest)\s+(\d+)/i);
  if (bottomMatch) {
    result.limit = parseInt(bottomMatch[1], 10);
    result.sortDirection = 'ASC';
  }
  // Default limit for "best" / "top" / "highest" without explicit number
  if (!result.limit && /\b(best|top|highest|lowest|most popular)\b/i.test(q)) {
    result.limit = 10;
  }

  // ── 6. Sort direction ───────────────────────────────
  if (!result.sortDirection) {
    if (/\b(descending|desc|highest|most|largest|top|best)\b/i.test(q)) {
      result.sortDirection = 'DESC';
    } else if (/\b(ascending|asc|lowest|least|smallest|first|worst)\b/i.test(q)) {
      result.sortDirection = 'ASC';
    }
  }

  // ── 7. Aggregate function detection ─────────────────
  if (/\b(count|how many|number of|total number)\b/i.test(q)) {
    result.aggregateFunction = 'COUNT';
  } else if (/\b(average|avg|mean)\b/i.test(q)) {
    result.aggregateFunction = 'AVG';
  } else if (/\b(total|sum)\b/i.test(q) &&
             /\b(revenue|sales|amount|spending|value|cost|price|salary|income|order)\b/i.test(q)) {
    result.aggregateFunction = 'SUM';
  } else if (/\b(maximum|max)\b/i.test(q) || (/\b(highest|largest|biggest)\b/i.test(q) && /\b(what is the|find the|get the)\b/i.test(q))) {
    result.aggregateFunction = 'MAX';
  } else if (/\b(minimum|min)\b/i.test(q) || (/\b(lowest|smallest|cheapest)\b/i.test(q) && /\b(what is the|find the|get the)\b/i.test(q))) {
    result.aggregateFunction = 'MIN';
  }

  // ── 8. Intelligent Target Table Scoring ─────────────
  const tableScores = {};
  for (const table of tables) {
    let score = 0;
    const tableInfo = schema.tables[table];
    if (!tableInfo) continue;

    // Direct table match
    if (result.matchedTables.includes(table)) {
      score += 15;
    }

    // Matched columns for this table
    const tableMatchedCols = result.matchedColumns.filter((mc) => mc.table === table);
    score += tableMatchedCols.length * 10;

    // Bonus for having numeric column matching aggregate function
    if (result.aggregateFunction && result.aggregateFunction !== 'COUNT') {
      const hasNumericCol = tableMatchedCols.some((mc) => isNumericType(mc.type));
      if (hasNumericCol) {
        score += 25;
      } else {
        // Table has any numeric column
        for (const [col, type] of Object.entries(tableInfo.columns)) {
          if (isNumericType(type) && !tableInfo.primaryKeys.includes(col) && !col.endsWith('_id')) {
            score += 5;
            break;
          }
        }
      }
    }

    // Bonus if table has a column matching group-by keywords
    if (/\b(by|per|each|every|for each|group)\b/i.test(q)) {
      for (const col of Object.keys(tableInfo.columns)) {
        const colRegex = new RegExp(`\\b${escapeRegex(col)}\\b`, 'i');
        if (colRegex.test(q)) {
          score += 15;
          break;
        }
      }
    }

    tableScores[table] = score;
  }

  let bestTable = null;
  let maxScore = -1;
  for (const [table, score] of Object.entries(tableScores)) {
    if (score > maxScore) {
      maxScore = score;
      bestTable = table;
    }
  }

  result.targetTable = (maxScore > 0 ? bestTable : (result.matchedTables[0] || tables[0] || null));

  // ── 9. Find the best aggregate/sort column ──────────
  if (result.aggregateFunction || result.sortDirection) {
    result.aggregateColumn = findBestNumericColumn(q, result.matchedColumns, schema, result.targetTable);
  }

  // ── 10. Group by detection ──────────────────────────
  if (/\b(by|per|each|every|for each|group)\b/i.test(q) && result.aggregateFunction) {
    result.groupByColumn = findBestGroupByColumn(q, schema, result.targetTable, result.matchedColumns);
  }

  // ── 11. Sort column ─────────────────────────────────
  if (result.sortDirection && !result.sortColumn) {
    result.sortColumn = result.aggregateColumn || findBestNumericColumn(q, result.matchedColumns, schema, result.targetTable);
  }

  // ── 12. Date filter detection ───────────────────────
  const dateMatch = q.match(/\b(?:last|past)\s+(\d+)\s+(days?|weeks?|months?|years?)\b/i);
  if (dateMatch) {
    result.dateFilter = {
      type: 'last_n_days',
      value: parseInt(dateMatch[1], 10),
      unit: dateMatch[2].replace(/s$/, '').toUpperCase(),
    };
  } else if (/\blast\s+week\b/i.test(q) || /\blast\s+7\s+days\b/i.test(q)) {
    result.dateFilter = { type: 'last_n_days', value: 7, unit: 'DAY' };
  } else if (/\blast\s+30\s+days\b/i.test(q)) {
    result.dateFilter = { type: 'last_n_days', value: 30, unit: 'DAY' };
  } else if (/\btoday\b/i.test(q)) {
    result.dateFilter = { type: 'today', value: 0, unit: 'DAY' };
  } else if (/\byesterday\b/i.test(q)) {
    result.dateFilter = { type: 'yesterday', value: 1, unit: 'DAY' };
  } else if (/\bthis\s+month\b/i.test(q)) {
    result.dateFilter = { type: 'this_month', value: 1, unit: 'MONTH', thisperiod: true };
  } else if (/\blast\s+month\b/i.test(q)) {
    result.dateFilter = { type: 'last_month', value: 1, unit: 'MONTH' };
  } else if (/\bthis\s+year\b/i.test(q)) {
    result.dateFilter = { type: 'this_year', value: 1, unit: 'YEAR', thisperiod: true };
  }

  // ── 13. Detect join requirements ────────────────────
  if (result.matchedTables.length >= 2) {
    result.joinTables = result.matchedTables.filter((t) => t !== result.targetTable);
  } else if (result.matchedTables.length === 1) {
    if (/\b(and their|with their|along with|together)\b/i.test(q)) {
      for (const rel of schema.relationships) {
        const [fromT] = rel.from.split('.');
        const [toT] = rel.to.split('.');
        if (fromT === result.targetTable && !result.joinTables.includes(toT)) {
          result.joinTables.push(toT);
        }
        if (toT === result.targetTable && !result.joinTables.includes(fromT)) {
          result.joinTables.push(fromT);
        }
      }
    }
  }

  return result;
}

// ══════════════════════════════════════════════
// ─── Dynamic SQL Builder ─────────────────────
// ══════════════════════════════════════════════

function formatIdentifier(name, dbType = 'postgres') {
  if (!name || name === '*') return name;
  if ((name.startsWith('"') && name.endsWith('"')) || (name.startsWith('`') && name.endsWith('`'))) {
    return name;
  }
  if (dbType === 'mysql') {
    return `\`${name}\``;
  }
  // For postgres / sqlite:
  // If the identifier contains uppercase characters or special characters, quote it with double quotes!
  if (/[A-Z]/.test(name) || /[^a-z0-9_]/.test(name)) {
    return `"${name}"`;
  }
  return name;
}

function formatAvg(aggCol, dbType = 'postgres') {
  const colExpr = formatIdentifier(aggCol, dbType);
  if (dbType === 'mysql' || dbType === 'sqlite') {
    return `ROUND(AVG(${colExpr}), 2)`;
  }
  return `ROUND(AVG(${colExpr})::numeric, 2)`;
}

function buildDatabaseDateExpression(dateFilter, dateCol, dbType = 'postgres') {
  if (!dateFilter || !dateCol) return null;
  const colExpr = formatIdentifier(dateCol, dbType);
  const val = dateFilter.value ?? 0;
  const type = dateFilter.type;

  if (type === 'today' || (val === 0 && dateFilter.unit === 'DAY')) {
    if (dbType === 'sqlite') return `${colExpr} >= date('now', 'start of day')`;
    return `${colExpr} >= CURRENT_DATE`;
  }

  if (type === 'yesterday' || (val === 1 && dateFilter.unit === 'DAY' && !dateFilter.thisperiod)) {
    if (dbType === 'postgres') return `${colExpr} >= CURRENT_DATE - INTERVAL '1 day' AND ${colExpr} < CURRENT_DATE`;
    if (dbType === 'mysql') return `${colExpr} >= CURRENT_DATE - INTERVAL 1 DAY AND ${colExpr} < CURRENT_DATE`;
    if (dbType === 'sqlite') return `${colExpr} >= date('now', '-1 day', 'start of day') AND ${colExpr} < date('now', 'start of day')`;
  }

  if (type === 'this_month') {
    if (dbType === 'postgres') return `${colExpr} >= DATE_TRUNC('month', CURRENT_DATE)`;
    if (dbType === 'mysql') return `${colExpr} >= DATE_FORMAT(CURRENT_DATE, '%Y-%m-01')`;
    if (dbType === 'sqlite') return `${colExpr} >= date('now', 'start of month')`;
  }

  if (type === 'last_month') {
    if (dbType === 'postgres') return `${colExpr} >= DATE_TRUNC('month', CURRENT_DATE - INTERVAL '1 month') AND ${colExpr} < DATE_TRUNC('month', CURRENT_DATE)`;
    if (dbType === 'mysql') return `${colExpr} >= DATE_FORMAT(CURRENT_DATE - INTERVAL 1 MONTH, '%Y-%m-01') AND ${colExpr} < DATE_FORMAT(CURRENT_DATE, '%Y-%m-01')`;
    if (dbType === 'sqlite') return `${colExpr} >= date('now', 'start of month', '-1 month') AND ${colExpr} < date('now', 'start of month')`;
  }

  if (type === 'this_year') {
    if (dbType === 'postgres') return `${colExpr} >= DATE_TRUNC('year', CURRENT_DATE)`;
    if (dbType === 'mysql') return `${colExpr} >= DATE_FORMAT(CURRENT_DATE, '%Y-01-01')`;
    if (dbType === 'sqlite') return `${colExpr} >= date('now', 'start of year')`;
  }

  // Range (e.g. last 7 days, last 30 days)
  const days = val || 30;
  if (dbType === 'postgres') {
    return `${colExpr} >= CURRENT_DATE - INTERVAL '${days} days'`;
  }
  if (dbType === 'mysql') {
    return `${colExpr} >= CURRENT_DATE - INTERVAL ${days} DAY`;
  }
  if (dbType === 'sqlite') {
    return `${colExpr} >= datetime('now', '-${days} days')`;
  }

  return `${colExpr} >= CURRENT_DATE - INTERVAL '${days} days'`;
}

/**
 * Build SQL dynamically based on extracted entities and intents.
 * Works with any schema — no hardcoded table/column names.
 */
function buildDynamicSQL(q, schema, entities, intents, dbType = 'postgres') {
  const table = entities.targetTable;
  if (!table || !schema.tables[table]) {
    // Last resort: use first table
    const firstTable = Object.keys(schema.tables)[0];
    if (!firstTable) return null;
    entities.targetTable = firstTable;
    return buildSelectAll(firstTable, schema, dbType);
  }

  const tableInfo = schema.tables[table];
  const columns = Object.keys(tableInfo.columns);
  const alias = table.charAt(0);
  const qTable = formatIdentifier(table, dbType);

  // ── COUNT with GROUP BY ─────────────────────────────
  if (entities.aggregateFunction === 'COUNT' && entities.groupByColumn) {
    const groupCol = entities.groupByColumn;
    const qGroupCol = formatIdentifier(groupCol, dbType);
    const needsJoin = !columns.includes(groupCol);

    if (needsJoin) {
      const joinInfo = findJoinForColumn(groupCol, table, schema, dbType);
      if (joinInfo) {
        return `SELECT ${joinInfo.alias}.${qGroupCol}, COUNT(*) AS count FROM ${qTable} ${alias} JOIN ${formatIdentifier(joinInfo.table, dbType)} ${joinInfo.alias} ON ${joinInfo.onClause} GROUP BY ${joinInfo.alias}.${qGroupCol} ORDER BY count DESC;`;
      }
    }

    return `SELECT ${qGroupCol}, COUNT(*) AS count FROM ${qTable} GROUP BY ${qGroupCol} ORDER BY count DESC;`;
  }

  // ── COUNT ───────────────────────────────────────────
  if (entities.aggregateFunction === 'COUNT') {
    const where = buildWhereClause(q, entities, tableInfo, table, schema, dbType);
    return `SELECT COUNT(*) AS count FROM ${qTable}${where};`;
  }

  // ── AVG with GROUP BY ──────────────────────────────
  if (entities.aggregateFunction === 'AVG' && entities.groupByColumn) {
    const aggCol = entities.aggregateColumn || findFirstNumericColumn(tableInfo);
    if (!aggCol) return buildSelectAll(table, schema, dbType);
    const avgExpr = formatAvg(aggCol, dbType);
    const qGroupCol = formatIdentifier(entities.groupByColumn, dbType);
    return `SELECT ${qGroupCol}, ${avgExpr} AS average_${aggCol} FROM ${qTable} GROUP BY ${qGroupCol} ORDER BY average_${aggCol} DESC;`;
  }

  // ── AVG ─────────────────────────────────────────────
  if (entities.aggregateFunction === 'AVG') {
    const aggCol = entities.aggregateColumn || findFirstNumericColumn(tableInfo);
    if (!aggCol) return buildSelectAll(table, schema, dbType);
    const where = buildWhereClause(q, entities, tableInfo, table, schema, dbType);
    const avgExpr = formatAvg(aggCol, dbType);
    return `SELECT ${avgExpr} AS average_${aggCol} FROM ${qTable}${where};`;
  }

  // ── SUM with GROUP BY ──────────────────────────────
  if (entities.aggregateFunction === 'SUM' && entities.groupByColumn) {
    const aggCol = entities.aggregateColumn || findFirstNumericColumn(tableInfo);
    if (!aggCol) return buildSelectAll(table, schema, dbType);
    const qGroupCol = formatIdentifier(entities.groupByColumn, dbType);
    const qAggCol = formatIdentifier(aggCol, dbType);
    return `SELECT ${qGroupCol}, SUM(${qAggCol}) AS total_${aggCol} FROM ${qTable} GROUP BY ${qGroupCol} ORDER BY total_${aggCol} DESC;`;
  }

  // ── SUM ─────────────────────────────────────────────
  if (entities.aggregateFunction === 'SUM') {
    const aggCol = entities.aggregateColumn || findFirstNumericColumn(tableInfo);
    if (!aggCol) return buildSelectAll(table, schema, dbType);
    const where = buildWhereClause(q, entities, tableInfo, table, schema, dbType);
    const qAggCol = formatIdentifier(aggCol, dbType);
    return `SELECT SUM(${qAggCol}) AS total_${aggCol} FROM ${qTable}${where};`;
  }

  // ── MAX ─────────────────────────────────────────────
  if (entities.aggregateFunction === 'MAX') {
    const aggCol = entities.aggregateColumn || findFirstNumericColumn(tableInfo);
    if (!aggCol) return buildSelectAll(table, schema, dbType);
    const where = buildWhereClause(q, entities, tableInfo, table, schema, dbType);
    const qAggCol = formatIdentifier(aggCol, dbType);
    return `SELECT MAX(${qAggCol}) AS max_${aggCol} FROM ${qTable}${where};`;
  }

  // ── MIN ─────────────────────────────────────────────
  if (entities.aggregateFunction === 'MIN') {
    const aggCol = entities.aggregateColumn || findFirstNumericColumn(tableInfo);
    if (!aggCol) return buildSelectAll(table, schema, dbType);
    const where = buildWhereClause(q, entities, tableInfo, table, schema, dbType);
    const qAggCol = formatIdentifier(aggCol, dbType);
    return `SELECT MIN(${qAggCol}) AS min_${aggCol} FROM ${qTable}${where};`;
  }

  // ── JOIN query ──────────────────────────────────────
  if (entities.joinTables.length > 0 || intents.includes('JOIN')) {
    return buildJoinQuery(q, entities, schema, dbType);
  }

  // ── TOP N / BOTTOM N ────────────────────────────────
  if (entities.limit && (intents.includes('TOP_N') || /\b(top|first|bottom|last|lowest)\s+\d+/i.test(q))) {
    const sortCol = entities.sortColumn || entities.aggregateColumn || findFirstNumericColumn(tableInfo);
    const dir = entities.sortDirection || 'DESC';
    const where = buildWhereClause(q, entities, tableInfo, table, schema, dbType);

    // Check if we need a join for TOP N with aggregation (e.g., "top 5 customers by revenue")
    if (/\b(by|based on)\b/i.test(q) && entities.joinTables.length === 0) {
      // Check if the sort column might be in a related table
      const joinForTopN = buildTopNWithJoin(q, entities, schema, dir, dbType);
      if (joinForTopN) return joinForTopN;
    }

    if (sortCol) {
      return `SELECT * FROM ${qTable}${where} ORDER BY ${formatIdentifier(sortCol, dbType)} ${dir} LIMIT ${entities.limit};`;
    }
    return `SELECT * FROM ${qTable}${where} LIMIT ${entities.limit};`;
  }

  // ── SORT ────────────────────────────────────────────
  if (entities.sortDirection && (intents.includes('SORT') || /\b(order|sort|rank)\b/i.test(q))) {
    const sortCol = entities.sortColumn || entities.aggregateColumn || findFirstNumericColumn(tableInfo);
    const where = buildWhereClause(q, entities, tableInfo, table, schema, dbType);
    if (sortCol) {
      return `SELECT * FROM ${qTable}${where} ORDER BY ${formatIdentifier(sortCol, dbType)} ${entities.sortDirection} LIMIT 100;`;
    }
  }

  // ── FILTER ──────────────────────────────────────────
  const where = buildWhereClause(q, entities, tableInfo, table, schema, dbType);
  if (where) {
    const rawSort = entities.sortColumn || findFirstNumericColumn(tableInfo) || columns[0];
    const orderBy = entities.sortDirection
      ? ` ORDER BY ${formatIdentifier(rawSort, dbType)} ${entities.sortDirection}`
      : '';
    return `SELECT * FROM ${qTable}${where}${orderBy} LIMIT 100;`;
  }

  // ── Date filter ─────────────────────────────────────
  if (entities.dateFilter) {
    const dateCol = findDateColumn(tableInfo);
    if (dateCol) {
      const dateExpr = buildDatabaseDateExpression(entities.dateFilter, dateCol, dbType);
      if (dateExpr) {
        return `SELECT * FROM ${qTable} WHERE ${dateExpr} LIMIT 100;`;
      }
    }
  }

  // ── Detected sort with no filter (largest, highest, recent) ─
  if (entities.sortDirection && entities.sortColumn) {
    return `SELECT * FROM ${qTable} ORDER BY ${formatIdentifier(entities.sortColumn, dbType)} ${entities.sortDirection} LIMIT ${entities.limit || 100};`;
  }

  // ── Default: SELECT ALL ─────────────────────────────
  return buildSelectAll(table, schema, dbType);
}

// ══════════════════════════════════════════════
// ─── MongoDB Query Builder ───────────────────
// ══════════════════════════════════════════════

/**
 * Build MongoDB Query Language (MQL) query from extracted entities and intents.
 */
function buildMongoQuery(q, schema, entities, intents) {
  const collection = entities.targetTable || Object.keys(schema.tables || {})[0];
  if (!collection) return 'db.items.find({})';

  const tableInfo = schema.tables[collection] || { columns: {} };
  const filter = {};

  // Numeric filter
  if (entities.numericValue !== null) {
    let numCol = null;
    for (const mc of entities.matchedColumns) {
      if (mc.table === collection && isNumericType(mc.type)) {
        numCol = mc.column;
        break;
      }
    }
    if (!numCol) numCol = findFirstNumericColumn(tableInfo);
    if (numCol) {
      const opMap = { '>': '$gt', '<': '$lt', '=': '$eq', '>=': '$gte', '<=': '$lte' };
      filter[numCol] = { [opMap[entities.numericOperator] || '$gt']: entities.numericValue };
    }
  }

  // String filter
  if (entities.stringValues.length > 0) {
    for (const val of entities.stringValues) {
      const textCol = findBestTextColumnForValue(val, q, tableInfo, collection, schema);
      if (textCol) {
        filter[textCol] = { $regex: val, $options: 'i' };
      }
    }
  }

  // 1. COUNT
  if (entities.aggregateFunction === 'COUNT') {
    if (entities.groupByColumn) {
      const groupField = `$${entities.groupByColumn}`;
      const pipeline = [
        ...(Object.keys(filter).length > 0 ? [{ $match: filter }] : []),
        { $group: { _id: groupField, count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ];
      return `db.${collection}.aggregate(${JSON.stringify(pipeline)})`;
    }
    return `db.${collection}.countDocuments(${JSON.stringify(filter)})`;
  }

  // 2. AVG, SUM, MIN, MAX with GROUP BY
  if (entities.aggregateFunction && entities.groupByColumn) {
    const aggCol = entities.aggregateColumn || findFirstNumericColumn(tableInfo) || 'value';
    const groupField = `$${entities.groupByColumn}`;
    const op = entities.aggregateFunction === 'AVG' ? '$avg'
      : entities.aggregateFunction === 'SUM' ? '$sum'
      : entities.aggregateFunction === 'MAX' ? '$max' : '$min';
    const fieldName = `${entities.aggregateFunction.toLowerCase()}_${aggCol}`;

    const pipeline = [
      ...(Object.keys(filter).length > 0 ? [{ $match: filter }] : []),
      { $group: { _id: groupField, [fieldName]: { [op]: `$${aggCol}` } } },
      { $sort: { [fieldName]: -1 } },
    ];
    return `db.${collection}.aggregate(${JSON.stringify(pipeline)})`;
  }

  // 3. AVG, SUM, MIN, MAX (overall aggregation)
  if (entities.aggregateFunction) {
    const aggCol = entities.aggregateColumn || findFirstNumericColumn(tableInfo) || 'value';
    const op = entities.aggregateFunction === 'AVG' ? '$avg'
      : entities.aggregateFunction === 'SUM' ? '$sum'
      : entities.aggregateFunction === 'MAX' ? '$max' : '$min';
    const fieldName = `${entities.aggregateFunction.toLowerCase()}_${aggCol}`;

    const pipeline = [
      ...(Object.keys(filter).length > 0 ? [{ $match: filter }] : []),
      { $group: { _id: null, [fieldName]: { [op]: `$${aggCol}` } } },
    ];
    return `db.${collection}.aggregate(${JSON.stringify(pipeline)})`;
  }

  // 4. FIND with SORT & LIMIT
  const sort = {};
  if (entities.sortDirection) {
    const sortCol = entities.sortColumn || entities.aggregateColumn || findFirstNumericColumn(tableInfo);
    if (sortCol) {
      sort[sortCol] = entities.sortDirection === 'ASC' ? 1 : -1;
    }
  }

  const limit = entities.limit || 100;
  let queryStr = `db.${collection}.find(${JSON.stringify(filter)})`;
  if (Object.keys(sort).length > 0) {
    queryStr += `.sort(${JSON.stringify(sort)})`;
  }
  queryStr += `.limit(${limit})`;

  return queryStr;
}

// ══════════════════════════════════════════════
// ─── SQL Builder Helpers ─────────────────────
// ══════════════════════════════════════════════

function buildSelectAll(table, schema, dbType = 'postgres') {
  const qTable = formatIdentifier(table, dbType);
  return `SELECT * FROM ${qTable} LIMIT 100;`;
}

function buildWhereClause(q, entities, tableInfo, table, schema, dbType = 'postgres') {
  const conditions = [];
  const columns = Object.keys(tableInfo.columns);

  // ── Numeric filter ──────────────────────────────────
  if (entities.numericValue !== null) {
    // Find the best numeric column to filter on
    let filterCol = null;

    // Check matched columns for numeric type
    for (const mc of entities.matchedColumns) {
      if (mc.table === table && isNumericType(mc.type)) {
        filterCol = mc.column;
        break;
      }
    }

    // Fallback: first numeric column
    if (!filterCol) {
      filterCol = findFirstNumericColumn(tableInfo);
    }

    if (filterCol) {
      conditions.push(`${formatIdentifier(filterCol, dbType)} ${entities.numericOperator} ${entities.numericValue}`);
    }
  }

  // ── String filter ───────────────────────────────────
  if (entities.stringValues.length > 0) {
    for (const val of entities.stringValues) {
      // Find the best text column to filter on
      const textCol = findBestTextColumnForValue(val, q, tableInfo, table, schema);
      if (textCol) {
        conditions.push(`${formatIdentifier(textCol, dbType)} ILIKE '%${escapeSQLString(val)}%'`);
      }
    }
  }

  // ── Date filter ─────────────────────────────────────
  if (entities.dateFilter) {
    const dateCol = findDateColumn(tableInfo);
    if (dateCol) {
      const dateExpr = buildDatabaseDateExpression(entities.dateFilter, dateCol, dbType);
      if (dateExpr) {
        conditions.push(dateExpr);
      }
    }
  }

  if (conditions.length === 0) return '';
  return ` WHERE ${conditions.join(' AND ')}`;
}

function buildJoinQuery(q, entities, schema, dbType = 'postgres') {
  const mainTable = entities.targetTable;
  if (!mainTable) return null;

  const alias = mainTable.charAt(0);
  const joins = [];
  const usedAliases = new Set([alias]);

  // Find join paths for each target table
  const tablesToJoin = entities.joinTables.length > 0
    ? entities.joinTables
    : findRelatedTables(mainTable, schema);

  for (const joinTable of tablesToJoin) {
    if (joinTable === mainTable) continue;

    let joinAlias = joinTable.charAt(0);
    // Deduplicate aliases
    let counter = 2;
    while (usedAliases.has(joinAlias)) {
      joinAlias = joinTable.charAt(0) + counter;
      counter++;
    }
    usedAliases.add(joinAlias);

    // Find FK relationship
    const joinClause = findJoinClause(mainTable, joinTable, schema, alias, joinAlias, dbType);
    if (joinClause) {
      joins.push(`JOIN ${formatIdentifier(joinTable, dbType)} ${joinAlias} ON ${joinClause}`);
    }
  }

  if (joins.length === 0) {
    // No FK found, try through intermediate junction tables
    for (const joinTable of tablesToJoin) {
      const indirectJoin = findIndirectJoin(mainTable, joinTable, schema, alias);
      if (indirectJoin) {
        joins.push(...indirectJoin.joins);
        break;
      }
    }
  }

  if (joins.length === 0) {
    if (entities.joinTables.length > 0) {
      throw new Error('This question cannot be safely answered because no relationship exists between the requested tables.');
    }
    return buildSelectAll(mainTable, schema, dbType);
  }

  let projection = `${alias}.*`;
  const validCols = entities.matchedColumns.filter((mc) =>
    (mc.table === mainTable || tablesToJoin.includes(mc.table)) &&
    schema.tables[mc.table]?.columns[mc.column]
  );
  if (validCols.length >= 2) {
    const projCols = validCols.map((mc) => {
      const tAlias = mc.table === mainTable ? alias : mc.table.charAt(0);
      return `${tAlias}.${formatIdentifier(mc.column, dbType)}`;
    });
    projection = Array.from(new Set(projCols)).join(', ');
  }

  const where = buildWhereClause(q, entities, schema.tables[mainTable], mainTable, schema, dbType);
  return `SELECT ${projection} FROM ${formatIdentifier(mainTable, dbType)} ${alias} ${joins.join(' ')}${where} LIMIT 100;`;
}

function buildTopNWithJoin(q, entities, schema, dir, dbType = 'postgres') {
  const mainTable = entities.targetTable;
  if (!mainTable) return null;

  // Look for aggregation keywords that imply a join
  const aggWords = q.match(/\b(revenue|sales|spending|orders?|purchases?|total)\b/i);
  if (!aggWords) return null;

  // Find a related table with numeric columns
  const relatedTables = findRelatedTables(mainTable, schema);
  for (const relTable of relatedTables) {
    const relInfo = schema.tables[relTable];
    if (!relInfo) continue;

    const numCol = findFirstNumericColumn(relInfo);
    if (!numCol) continue;

    const alias = mainTable.charAt(0);
    let relAlias = relTable.charAt(0);
    if (relAlias === alias) relAlias = relTable.charAt(0) + '2';

    const joinClause = findJoinClause(mainTable, relTable, schema, alias, relAlias, dbType);
    if (!joinClause) continue;

    const qNumCol = formatIdentifier(numCol, dbType);
    const qRelTable = formatIdentifier(relTable, dbType);
    const qMainTable = formatIdentifier(mainTable, dbType);

    // Find a display column (name, title, etc.)
    const nameCol = findNameColumn(schema.tables[mainTable]);
    const qNameCol = nameCol ? formatIdentifier(nameCol, dbType) : null;
    const selectCols = nameCol
      ? `${alias}.${qNameCol}, SUM(${relAlias}.${qNumCol}) AS total_${numCol}`
      : `${alias}.*, SUM(${relAlias}.${qNumCol}) AS total_${numCol}`;

    const pkCol = formatIdentifier(schema.tables[mainTable].primaryKeys[0] || 'id', dbType);
    const groupBy = nameCol
      ? `${alias}.${pkCol}, ${alias}.${qNameCol}`
      : `${alias}.${pkCol}`;

    return `SELECT ${selectCols} FROM ${qMainTable} ${alias} JOIN ${qRelTable} ${relAlias} ON ${joinClause} GROUP BY ${groupBy} ORDER BY total_${numCol} ${dir} LIMIT ${entities.limit || 10};`;
  }

  return null;
}

// ══════════════════════════════════════════════
// ─── Column/Table Finders ────────────────────
// ══════════════════════════════════════════════

function findFirstNumericColumn(tableInfo) {
  const metricPriority = [
    'mark', 'marks', 'score', 'grade', 'points',
    'total', 'total_amount', 'amount', 'revenue', 'sales',
    'price', 'unit_price', 'cost', 'salary', 'balance', 'value'
  ];
  for (const prio of metricPriority) {
    if (tableInfo.columns[prio] && isNumericType(tableInfo.columns[prio])) {
      return prio;
    }
  }

  for (const [col, type] of Object.entries(tableInfo.columns)) {
    if (isNumericType(type) && !tableInfo.primaryKeys.includes(col) && !col.endsWith('_id') && col !== 'age') {
      return col;
    }
  }
  // Fallback: any numeric column
  for (const [col, type] of Object.entries(tableInfo.columns)) {
    if (isNumericType(type) && !tableInfo.primaryKeys.includes(col) && !col.endsWith('_id')) {
      return col;
    }
  }
  return null;
}

function findDateColumn(tableInfo) {
  for (const [col, type] of Object.entries(tableInfo.columns)) {
    if (isDateType(type)) {
      return col;
    }
  }
  return null;
}

function findNameColumn(tableInfo) {
  const namePatterns = ['name', 'title', 'label', 'description', 'full_name', 'first_name', 'username', 'display_name'];
  for (const pattern of namePatterns) {
    if (tableInfo.columns[pattern]) return pattern;
  }
  // Fallback: first text column
  for (const [col, type] of Object.entries(tableInfo.columns)) {
    if (isTextType(type) && !col.endsWith('_id') && col !== 'id') {
      return col;
    }
  }
  return null;
}

function findBestNumericColumn(q, matchedColumns, schema, targetTable) {
  // Check if question mentions a specific column
  const numericMatched = matchedColumns.filter((mc) => isNumericType(mc.type) && mc.table === targetTable);
  if (numericMatched.length > 0) return numericMatched[0].column;

  // Check for common aggregation keywords
  if (!targetTable || !schema.tables[targetTable]) return null;
  const tableInfo = schema.tables[targetTable];

  // Match by keyword
  const keywordMap = {
    revenue: ['revenue', 'total', 'amount', 'price', 'subtotal'],
    sales: ['sales', 'total', 'amount', 'revenue'],
    spending: ['total', 'amount', 'spending', 'cost'],
    price: ['price', 'cost', 'amount', 'unit_price'],
    salary: ['salary', 'pay', 'wage', 'income'],
    mark: ['mark', 'score', 'grade', 'marks', 'points'],
    score: ['score', 'mark', 'grade', 'points', 'rating'],
    age: ['age'],
    quantity: ['quantity', 'qty', 'count', 'units'],
    order: ['total', 'amount', 'order_total', 'subtotal'],
    value: ['value', 'total', 'amount', 'price'],
  };

  for (const [keyword, colNames] of Object.entries(keywordMap)) {
    if (q.includes(keyword)) {
      for (const cn of colNames) {
        if (tableInfo.columns[cn] && isNumericType(tableInfo.columns[cn])) {
          return cn;
        }
      }
    }
  }

  return findFirstNumericColumn(tableInfo);
}

function findBestGroupByColumn(q, schema, targetTable, matchedColumns) {
  if (!targetTable || !schema.tables[targetTable]) return null;
  const tableInfo = schema.tables[targetTable];

  // Common group-by keywords
  const groupKeywords = [
    'department', 'category', 'status', 'type', 'city', 'country',
    'region', 'month', 'year', 'state', 'group', 'class', 'level',
    'brand', 'vendor', 'supplier', 'channel',
  ];

  // Check if any group keyword appears in the question AND matches a column
  for (const keyword of groupKeywords) {
    if (q.includes(keyword)) {
      // Exact match
      if (tableInfo.columns[keyword]) return keyword;
      // Partial match
      for (const col of Object.keys(tableInfo.columns)) {
        if (col.includes(keyword) || keyword.includes(col)) return col;
      }
    }
  }

  // Check matched columns for text type
  const textMatched = matchedColumns.filter(
    (mc) => mc.table === targetTable && isTextType(mc.type) && !mc.column.endsWith('_id')
  );
  if (textMatched.length > 0) return textMatched[0].column;

  // Fallback: first non-PK text column
  for (const [col, type] of Object.entries(tableInfo.columns)) {
    if (isTextType(type) && !tableInfo.primaryKeys.includes(col) && !col.endsWith('_id')) {
      return col;
    }
  }

  return null;
}

function findBestTextColumnForValue(value, q, tableInfo, table, schema) {
  // Look for column name hints in the question
  for (const [col, type] of Object.entries(tableInfo.columns)) {
    if (!isTextType(type)) continue;

    const colReadable = col.replace(/_/g, ' ');
    // Check if the column name appears in the question
    if (q.includes(col) || q.includes(colReadable)) {
      return col;
    }
    // Check common patterns like "from {city}" → city column
    const colWords = col.split('_');
    for (const word of colWords) {
      if (word.length > 2 && q.includes(word)) {
        return col;
      }
    }
  }

  // Fallback: first text column that's not an ID
  for (const [col, type] of Object.entries(tableInfo.columns)) {
    if (isTextType(type) && !col.endsWith('_id') && col !== 'id') {
      return col;
    }
  }

  return null;
}

function findRelatedTables(table, schema) {
  const related = new Set();
  for (const rel of schema.relationships) {
    const [fromT] = rel.from.split('.');
    const [toT] = rel.to.split('.');
    if (fromT === table) related.add(toT);
    if (toT === table) related.add(fromT);
  }
  return Array.from(related);
}

function findJoinClause(table1, table2, schema, alias1, alias2, dbType = 'postgres') {
  for (const rel of schema.relationships) {
    const [fromT, fromC] = rel.from.split('.');
    const [toT, toC] = rel.to.split('.');

    if (fromT === table1 && toT === table2) {
      return `${alias1}.${formatIdentifier(fromC, dbType)} = ${alias2}.${formatIdentifier(toC, dbType)}`;
    }
    if (fromT === table2 && toT === table1) {
      return `${alias2}.${formatIdentifier(fromC, dbType)} = ${alias1}.${formatIdentifier(toC, dbType)}`;
    }
  }
  return null;
}

function findJoinForColumn(column, mainTable, schema, dbType = 'postgres') {
  for (const [table, info] of Object.entries(schema.tables)) {
    if (table === mainTable) continue;
    if (info.columns[column]) {
      const alias = table.charAt(0);
      const mainAlias = mainTable.charAt(0);
      const joinClause = findJoinClause(mainTable, table, schema, mainAlias, alias, dbType);
      if (joinClause) {
        return { table, alias, onClause: joinClause };
      }
    }
  }
  return null;
}

function findIndirectJoin(table1, table2, schema, alias1) {
  // Find a junction table that connects table1 and table2
  const table1Related = new Map(); // junctionTable → { fromCol, toCol }
  const table2Related = new Map();

  for (const rel of schema.relationships) {
    const [fromT, fromC] = rel.from.split('.');
    const [toT, toC] = rel.to.split('.');

    if (toT === table1) table1Related.set(fromT, { fromCol: fromC, toCol: toC });
    if (toT === table2) table2Related.set(fromT, { fromCol: fromC, toCol: toC });
  }

  // Find common junction table
  for (const [junction, rel1] of table1Related) {
    if (table2Related.has(junction)) {
      const rel2 = table2Related.get(junction);
      const jAlias = junction.charAt(0);
      const t2Alias = table2.charAt(0) === alias1 ? table2.charAt(0) + '2' : table2.charAt(0);

      return {
        joins: [
          `JOIN ${junction} ${jAlias} ON ${alias1}.${rel1.toCol} = ${jAlias}.${rel1.fromCol}`,
          `JOIN ${table2} ${t2Alias} ON ${jAlias}.${rel2.fromCol} = ${t2Alias}.${rel2.toCol}`,
        ],
      };
    }
  }

  return null;
}

// ══════════════════════════════════════════════
// ─── SQL Correction ──────────────────────────
// ══════════════════════════════════════════════

/**
 * Attempt to correct a failed SQL query using error context.
 */
function correctSQL(originalQuestion, failedSQL, dbError, schema, dbType = 'postgres') {
  console.log(`[SLM] Attempting SQL correction...`);
  console.log(`[SLM] Error: ${dbError}`);

  // ── Column does not exist ───────────────────────────
  const colNotExist = dbError.match(/column "(\w+)" does not exist/i);
  if (colNotExist) {
    const badCol = colNotExist[1];
    const correctedCol = findClosestColumn(badCol, schema);
    if (correctedCol) {
      console.log(`[SLM] Correcting column "${badCol}" → "${correctedCol.column}"`);
      const replacement = formatIdentifier(correctedCol.column, dbType);
      const regex = new RegExp(`(?<!")\\b(${escapeRegex(badCol)}|${escapeRegex(correctedCol.column)})\\b(?!")`, 'gi');
      const fixedSQL = failedSQL.replace(regex, replacement);
      if (fixedSQL !== failedSQL) {
        return fixedSQL;
      }
      return failedSQL.replace(new RegExp(`\\b${escapeRegex(badCol)}\\b`, 'gi'), replacement);
    }
  }

  // ── Table does not exist ────────────────────────────
  const tableNotExist = dbError.match(/relation "(\w+)" does not exist/i);
  if (tableNotExist) {
    const badTable = tableNotExist[1];
    const correctedTable = findClosestTable(badTable, schema);
    if (correctedTable) {
      console.log(`[SLM] Correcting table "${badTable}" → "${correctedTable}"`);
      const replacement = formatIdentifier(correctedTable, dbType);
      const regex = new RegExp(`(?<!")\\b(${escapeRegex(badTable)}|${escapeRegex(correctedTable)})\\b(?!")`, 'gi');
      const fixedSQL = failedSQL.replace(regex, replacement);
      if (fixedSQL !== failedSQL) {
        return fixedSQL;
      }
      return failedSQL.replace(new RegExp(`\\b${escapeRegex(badTable)}\\b`, 'gi'), replacement);
    }
  }

  // ── Ambiguous column ────────────────────────────────
  if (dbError.toLowerCase().includes('ambiguous')) {
    const ambigCol = dbError.match(/column reference "(\w+)" is ambiguous/i);
    if (ambigCol) {
      const col = ambigCol[1];
      // Find which table it belongs to and qualify it
      for (const [table, info] of Object.entries(schema.tables)) {
        if (info.columns[col]) {
          const alias = table.charAt(0);
          // Add table alias qualification
          return failedSQL.replace(new RegExp(`\\b(?<!\\w\\.)${col}\\b`, 'gi'), `${alias}.${col}`);
        }
      }
    }
  }

  // ── GROUP BY error ──────────────────────────────────
  if (dbError.includes('must appear in the GROUP BY clause')) {
    const colMatch = dbError.match(/column "(?:\w+\.)?(\w+)"/i);
    if (colMatch) {
      const col = colMatch[1];
      const groupByMatch = failedSQL.match(/GROUP BY\s+(.+?)(?:\s+ORDER|\s+HAVING|\s+LIMIT|;|$)/i);
      if (groupByMatch) {
        const newGroupBy = `${groupByMatch[1].trim()}, ${col}`;
        return failedSQL.replace(groupByMatch[1], newGroupBy);
      }
    }
  }

  // ── Fallback: regenerate from scratch ───────────────
  try {
    return generateSQL(originalQuestion, schema, []);
  } catch (e) {
    return null;
  }
}

// ══════════════════════════════════════════════
// ─── Explanation Generator (Local) ───────────
// ══════════════════════════════════════════════

/**
 * Generate a plain-English explanation of a SQL query. Fully local.
 */
function generateExplanation(sql, question) {
  if (!sql || typeof sql !== 'string') return 'No query to explain.';

  if (sql.startsWith('db.')) {
    const colMatch = sql.match(/^db\.(\w+)/);
    const colName = colMatch ? colMatch[1] : 'collection';
    if (sql.includes('.aggregate')) {
      return `How the query works:\n1. Targets collection "${colName}".\n2. Executes aggregation pipeline to compute summary metrics.\n3. Sorts and returns results.`;
    }
    if (sql.includes('.countDocuments') || sql.includes('.count')) {
      return `How the query works:\n1. Targets collection "${colName}".\n2. Counts matching documents.`;
    }
    return `How the query works:\n1. Targets collection "${colName}".\n2. Filters documents matching criteria.\n3. Limits results to 100 documents.`;
  }

  const steps = [];
  const tables = [];

  const fromMatch = sql.match(/\bFROM\s+(\w+)/i);
  if (fromMatch) tables.push(fromMatch[1]);

  const joinRegex = /\bJOIN\s+(\w+)/gi;
  let m;
  while ((m = joinRegex.exec(sql)) !== null) {
    tables.push(m[1]);
  }

  if (tables.length > 1) {
    steps.push(`Joins ${tables[0]} with ${tables.slice(1).join(' and ')}.`);
  }

  const whereMatch = sql.match(/WHERE\s+(.+?)(?:\s+GROUP|\s+ORDER|\s+LIMIT|;|$)/i);
  if (whereMatch) {
    steps.push('Filters records based on conditions.');
  }

  const groupByMatch = sql.match(/GROUP\s+BY\s+([^;]+?)(?:\s+ORDER|\s+HAVING|\s+LIMIT|;|$)/i);
  if (groupByMatch) {
    const groupCols = groupByMatch[1].trim().replace(/\b\w+\./g, '').replace(/,\s*/g, ', ');
    steps.push(`Groups results by ${groupCols}.`);
  }

  if (/\bCOUNT\s*\(/i.test(sql)) steps.push('Counts matching records.');
  if (/\bAVG\s*\(/i.test(sql)) steps.push('Calculates average value.');
  if (/\bSUM\s*\(/i.test(sql)) steps.push('Calculates total sum.');
  if (/\bMAX\s*\(/i.test(sql)) steps.push('Finds maximum value.');
  if (/\bMIN\s*\(/i.test(sql)) steps.push('Finds minimum value.');

  const orderByMatch = sql.match(/ORDER\s+BY\s+([^;]+?)(?:\s+LIMIT|;|$)/i);
  if (orderByMatch) {
    const isDesc = /\bDESC\b/i.test(orderByMatch[1]);
    steps.push(`Sorts results ${isDesc ? 'descending' : 'ascending'}.`);
  }

  const limitMatch = sql.match(/LIMIT\s+(\d+)/i);
  if (limitMatch) {
    const limit = parseInt(limitMatch[1], 10);
    if (limit < 100) {
      steps.push(`Returns the top ${limit}.`);
    }
  }

  if (steps.length === 0) {
    const table = tables[0] || 'the table';
    steps.push(`Retrieves all records from ${table}.`);
  }

  return `How the query works:\n${steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}`;
}

// ══════════════════════════════════════════════
// ─── Schema-Aware Suggestions ────────────────
// ══════════════════════════════════════════════

/**
 * Generate query suggestions based on the user's schema.
 * No API call — builds them from table/column structure.
 */
function generateSuggestions(schema) {
  if (!schema || !schema.tables) return [];

  const suggestions = [];
  const tables = Object.keys(schema.tables);

  for (const table of tables) {
    const tableInfo = schema.tables[table];
    const cols = Object.keys(tableInfo.columns);
    const nameCol = findNameColumn(tableInfo);
    const numCol = findFirstNumericColumn(tableInfo);
    const dateCol = findDateColumn(tableInfo);
    const singular = makeSingular(table);

    // Basic: Show all
    suggestions.push(`Show all ${table}`);

    // Count
    suggestions.push(`How many ${table} are there?`);

    // Filter with numeric
    if (numCol) {
      suggestions.push(`Show ${table} with ${numCol.replace(/_/g, ' ')} above 50`);
      suggestions.push(`What is the average ${numCol.replace(/_/g, ' ')}?`);
    }

    // Sort
    if (numCol) {
      suggestions.push(`Show top 5 ${table} by ${numCol.replace(/_/g, ' ')}`);
    }

    // Date
    if (dateCol) {
      suggestions.push(`Show ${table} from the last 30 days`);
    }
  }

  // Add join suggestions if relationships exist
  if (schema.relationships.length > 0) {
    const rel = schema.relationships[0];
    const [fromT] = rel.from.split('.');
    const [toT] = rel.to.split('.');
    suggestions.push(`Show ${fromT} and their ${toT}`);
  }

  // Group by suggestions
  for (const table of tables) {
    const groupCol = findBestGroupByColumn('', schema, table, []);
    const numCol = findFirstNumericColumn(schema.tables[table]);
    if (groupCol && numCol) {
      suggestions.push(`Show total ${numCol.replace(/_/g, ' ')} by ${groupCol.replace(/_/g, ' ')}`);
      break; // Just one group-by suggestion
    }
  }

  // Deduplicate and limit
  const unique = [...new Set(suggestions)];
  return unique.slice(0, 8);
}

// ══════════════════════════════════════════════
// ─── Utility Functions ───────────────────────
// ══════════════════════════════════════════════

function isSecretRequest(q) {
  return SECRET_PATTERNS.some((p) => q.includes(p));
}

function isRawSQL(trimmed) {
  const sqlCommands = /^(SELECT|WITH|INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE)\b/i;
  if (sqlCommands.test(trimmed) &&
      !/\b(who|show|what|which|list|get|display|how many)\b/i.test(trimmed)) {
    return true;
  }
  return false;
}

function isNumericType(type) {
  const t = type.toLowerCase();
  return t.includes('int') || t.includes('numeric') || t.includes('decimal') ||
         t.includes('float') || t.includes('double') || t.includes('real') ||
         t.includes('money') || t.includes('serial') || t === 'bigint' ||
         t === 'smallint';
}

function isTextType(type) {
  const t = type.toLowerCase();
  return t.includes('char') || t.includes('text') || t.includes('varchar') ||
         t === 'character varying' || t === 'character';
}

function isDateType(type) {
  const t = type.toLowerCase();
  return t.includes('date') || t.includes('time') || t.includes('timestamp');
}

function makeSingular(word) {
  if (word.endsWith('ies')) return word.slice(0, -3) + 'y';
  if (word.endsWith('ses') || word.endsWith('xes') || word.endsWith('zes')) return word.slice(0, -2);
  if (word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeSQLString(str) {
  return str.replace(/'/g, "''");
}

function levenshtein(a, b) {
  const matrix = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }
  return matrix[a.length][b.length];
}

function findClosestColumn(badCol, schema) {
  let bestMatch = null;
  let bestScore = Infinity;
  for (const [tableName, tableInfo] of Object.entries(schema.tables)) {
    for (const colName of Object.keys(tableInfo.columns)) {
      const score = levenshtein(badCol.toLowerCase(), colName.toLowerCase());
      if (score < bestScore && score <= 3) {
        bestScore = score;
        bestMatch = { table: tableName, column: colName };
      }
    }
  }
  return bestMatch;
}

function findClosestTable(badTable, schema) {
  let bestMatch = null;
  let bestScore = Infinity;
  for (const tableName of Object.keys(schema.tables)) {
    const score = levenshtein(badTable.toLowerCase(), tableName.toLowerCase());
    if (score < bestScore && score <= 3) {
      bestScore = score;
      bestMatch = tableName;
    }
  }
  return bestMatch;
}

module.exports = {
  generateSQL,
  correctSQL,
  generateExplanation,
  generateSuggestions,
};
