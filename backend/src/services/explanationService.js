// ============================================
// Explanation Service — SQL → Plain English
// ============================================
// Analyzes SQL queries (both Read and Write) to generate
// short, plain-English explanations of what the query does.

/**
 * Generate a plain-English explanation of a SQL query.
 *
 * @param {string} sql - The SQL query to explain
 * @param {string} question - The original user question (for context)
 * @returns {string} A short explanation
 */
function generateExplanation(sql, question) {
  if (!sql || typeof sql !== 'string') {
    return 'No query to explain.';
  }

  const trimmed = sql.trim();

  // ── A. Handle Multi-Statement CREATE + INSERT ────────
  const hasCreate = /\bCREATE\s+TABLE\b/i.test(trimmed);
  const hasInsert = /\bINSERT\s+INTO\b/i.test(trimmed);
  const hasUpdate = /\bUPDATE\b/i.test(trimmed);
  const hasDelete = /\bDELETE\s+FROM\b/i.test(trimmed);

  if (hasCreate && hasInsert) {
    const tableMatch = trimmed.match(/\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/i);
    const tbl = tableMatch ? tableMatch[1] : 'the table';
    return `The query creates the "${tbl}" table (if it does not already exist) and inserts initial records into it.`;
  }

  // ── B. Handle CREATE TABLE ───────────────────────────
  if (hasCreate) {
    const tableMatch = trimmed.match(/\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/i);
    const tbl = tableMatch ? tableMatch[1] : 'the table';
    return `The query creates a new database table named "${tbl}".`;
  }

  // ── C. Handle INSERT ─────────────────────────────────
  if (hasInsert) {
    const tableMatch = trimmed.match(/\bINSERT\s+INTO\s+(\w+)/i);
    const tbl = tableMatch ? tableMatch[1] : 'the table';
    return `The query inserts new record(s) into the "${tbl}" table.`;
  }

  // ── D. Handle UPDATE ─────────────────────────────────
  if (hasUpdate) {
    const tableMatch = trimmed.match(/\bUPDATE\s+(\w+)/i);
    const tbl = tableMatch ? tableMatch[1] : 'the table';
    const whereMatch = trimmed.match(/\bWHERE\s+(.+?)(?:;|$)/is);
    const condition = whereMatch ? ` where ${parseWhereClause(whereMatch[1].trim())}` : '';
    return `The query updates records in the "${tbl}" table${condition}.`;
  }

  // ── E. Handle DELETE ─────────────────────────────────
  if (hasDelete) {
    const tableMatch = trimmed.match(/\bDELETE\s+FROM\s+(\w+)/i);
    const tbl = tableMatch ? tableMatch[1] : 'the table';
    const whereMatch = trimmed.match(/\bWHERE\s+(.+?)(?:;|$)/is);
    const condition = whereMatch ? ` where ${parseWhereClause(whereMatch[1].trim())}` : '';
    return `The query deletes records from the "${tbl}" table${condition}.`;
  }

  // ── F. Handle SELECT Queries ─────────────────────────
  const parts = [];
  const tables = extractTablesFromSQL(sql);
  const mainTable = tables[0] || 'the table';

  // Detect JOINs
  const hasJoin = /\bJOIN\b/i.test(sql);
  if (hasJoin) {
    const joinTables = extractJoinTables(sql);
    if (joinTables.length > 0) {
      parts.push(`joins ${joinTables.join(', ')} together`);
    }
  }

  // Detect aggregation
  const hasCount = /\bCOUNT\s*\(/i.test(sql);
  const hasAvg = /\bAVG\s*\(/i.test(sql);
  const hasMax = /\bMAX\s*\(/i.test(sql);
  const hasMin = /\bMIN\s*\(/i.test(sql);
  const hasSum = /\bSUM\s*\(/i.test(sql);

  if (hasCount) parts.push('counts the number of records');
  if (hasAvg) parts.push('calculates the average');
  if (hasMax) parts.push('finds the maximum value');
  if (hasMin) parts.push('finds the minimum value');
  if (hasSum) parts.push('calculates the sum');

  // Detect GROUP BY
  const groupByMatch = sql.match(/GROUP\s+BY\s+([^;]+?)(?:\s+ORDER|\s+HAVING|\s+LIMIT|;|$)/i);
  if (groupByMatch) {
    const groupCols = groupByMatch[1].trim().replace(/,/g, ', ');
    parts.push(`groups results by ${cleanColumnName(groupCols)}`);
  }

  // Detect WHERE
  const whereMatch = sql.match(/WHERE\s+(.+?)(?:\s+GROUP|\s+ORDER|\s+LIMIT|;|$)/i);
  if (whereMatch) {
    const conditions = parseWhereClause(whereMatch[1].trim());
    if (conditions) {
      parts.push(`filters where ${conditions}`);
    }
  }

  // Detect ORDER BY
  const orderByMatch = sql.match(/ORDER\s+BY\s+([^;]+?)(?:\s+LIMIT|;|$)/i);
  if (orderByMatch) {
    const orderStr = orderByMatch[1].trim();
    const isDesc = /\bDESC\b/i.test(orderStr);
    const isAsc = /\bASC\b/i.test(orderStr);
    const orderCol = orderStr.replace(/\s+(ASC|DESC)\b/gi, '').trim();
    const direction = isDesc ? 'highest to lowest' : (isAsc ? 'lowest to highest' : 'in order');
    parts.push(`sorts by ${cleanColumnName(orderCol)} from ${direction}`);
  }

  // Detect LIMIT
  const limitMatch = sql.match(/LIMIT\s+(\d+)/i);
  if (limitMatch) {
    const limit = parseInt(limitMatch[1], 10);
    if (limit === 1) {
      parts.push('returns only the top result');
    } else {
      parts.push(`returns the first ${limit} results`);
    }
  }

  // Detect DISTINCT
  if (/\bSELECT\s+DISTINCT\b/i.test(sql)) {
    parts.push('removes duplicate values');
  }

  // Detect ILIKE / LIKE
  if (/\bILIKE\b/i.test(sql) || /\bLIKE\b/i.test(sql)) {
    parts.push('uses pattern matching to search');
  }

  // Build the explanation
  if (parts.length === 0) {
    if (/SELECT\s+\*/i.test(sql)) {
      return `The query retrieves all records from the ${mainTable} table.`;
    }
    return `The query retrieves data from the ${mainTable} table.`;
  }

  const explanation = `The query ${parts.join(', ')}.`;
  return explanation.charAt(0).toUpperCase() + explanation.slice(1);
}

// ── Helper: Extract table names from SQL ──────────────
function extractTablesFromSQL(sql) {
  const tables = [];
  const fromMatch = sql.match(/\bFROM\s+(\w+)/i);
  if (fromMatch) tables.push(fromMatch[1]);
  return tables;
}

// ── Helper: Extract JOIN table names ──────────────────
function extractJoinTables(sql) {
  const tables = new Set();
  const fromMatch = sql.match(/\bFROM\s+(\w+)/i);
  if (fromMatch) tables.add(fromMatch[1]);

  const joinRegex = /\bJOIN\s+(\w+)/gi;
  let match;
  while ((match = joinRegex.exec(sql)) !== null) {
    tables.add(match[1]);
  }

  return Array.from(tables);
}

// ── Helper: Parse WHERE clause into readable text ─────
function parseWhereClause(whereStr) {
  let readable = whereStr
    .replace(/\bAND\b/gi, 'and')
    .replace(/\bOR\b/gi, 'or')
    .replace(/\bILIKE\b/gi, 'matches')
    .replace(/\bLIKE\b/gi, 'matches')
    .replace(/>=/g, 'is at least')
    .replace(/<=/g, 'is at most')
    .replace(/>/g, 'is greater than')
    .replace(/</g, 'is less than')
    .replace(/!=/g, 'is not')
    .replace(/=/g, 'is')
    .replace(/'/g, '"');

  return readable.trim();
}

// ── Helper: Clean column references ───────────────────
function cleanColumnName(name) {
  return name.replace(/\b\w+\./g, '');
}

module.exports = { generateExplanation };
