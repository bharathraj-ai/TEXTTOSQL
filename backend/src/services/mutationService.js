// ============================================
// Mutation Service — Safe CRUD SQL Generation
// ============================================
// Day 4: Generates INSERT / UPDATE / DELETE SQL
// from natural language questions using the live schema.
//
// Rules:
//  - Never generates DROP, ALTER, TRUNCATE, CREATE
//  - UPDATE without WHERE → flagged as HIGH RISK
//  - DELETE without WHERE → flagged as HIGH RISK
//  - All values are parameterized where possible
//  - Schema-validated: only known tables and columns used

// ── Write-operation intent patterns ─────────────────────
const INSERT_PATTERNS = [
  /\b(add|insert|create|register|enroll|put|place|record|save|store|include|new)\b/i,
];
const UPDATE_PATTERNS = [
  /\b(update|change|modify|set|edit|correct|fix|adjust|rename|move|transfer|bump)\b/i,
];
const DELETE_PATTERNS = [
  /\b(delete|remove|erase|eliminate|purge|expel|kick\s+out)\b/i,
];

/**
 * Detect which write intent (INSERT/UPDATE/DELETE) a question represents.
 * Returns null if not a write intent.
 *
 * @param {string} question
 * @returns {'INSERT'|'UPDATE'|'DELETE'|null}
 */
function detectWriteIntent(question) {
  const q = question.trim().toLowerCase();

  // Exact SQL keyword at start → direct passthrough
  if (/^insert\b/i.test(q)) return 'INSERT';
  if (/^update\b/i.test(q)) return 'UPDATE';
  if (/^delete\b/i.test(q)) return 'DELETE';

  if (DELETE_PATTERNS.some((p) => p.test(q))) return 'DELETE';
  if (UPDATE_PATTERNS.some((p) => p.test(q))) return 'UPDATE';
  if (INSERT_PATTERNS.some((p) => p.test(q))) return 'INSERT';
  return null;
}

// ── String value extraction helpers ──────────────────────

/**
 * Extract named entity values from a question using schema columns.
 * e.g. "named Rahul" → { name: 'Rahul' }
 * e.g. "with mark 85" → { mark: 85 }
 *
 * @param {string} question
 * @param {object} tableSchema - { columns: { colName: colType } }
 * @returns {object} - { colName: value }
 */
const INSERT_COMMAND_WORDS = new Set([
  'insert', 'add', 'create', 'register', 'put', 'save', 'store', 'include',
  'the', 'a', 'an', 'row', 'rows', 'record', 'records', 'entry', 'of', 'into',
  'please', 'give', 'with', 'to', 'in', 'from', 'and', 'new', 'named', 'called', 'set',
  'values', 'value', 'table',
]);

function formatTextValue(raw) {
  const text = String(raw || '').trim().replace(/^['"]|['"]$/g, '').trim();
  if (/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(text)) return text;
  if (/^null$/i.test(text)) return null;
  return text.split(/\s+/).filter(Boolean).map((word) => {
    if (/^[a-z]{2,4}$/.test(word)) return word.toUpperCase();
    if (word === word.toLowerCase()) return word.charAt(0).toUpperCase() + word.slice(1);
    return word;
  }).join(' ');
}

function parseNumericExpression(raw) {
  const text = String(raw || '')
    .trim()
    .replace(/[₹$,]/g, '')
    .replace(/\s+rupees?$/i, '')
    .trim();
  const match = text.match(/^(\d+(?:\.\d+)?)\s*(cr|crores?|lakhs?|lacs?|millions?|thousand|k)?$/i);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return null;
  const unit = (match[2] || '').toLowerCase();
  if (unit === 'cr' || unit.startsWith('crore')) return amount * 10000000;
  if (unit.startsWith('lakh') || unit.startsWith('lac')) return amount * 100000;
  if (unit.startsWith('million')) return amount * 1000000;
  if (unit === 'k' || unit === 'thousand') return amount * 1000;
  return amount;
}

function isAutoColumn(col, tableSchema) {
  const type = String(tableSchema.columns?.[col] || '').toLowerCase();
  const defaults = tableSchema.defaults || {};
  const identity = tableSchema.identity || {};
  const defaultValue = defaults[col] == null ? '' : String(defaults[col]);
  if (identity[col]) return true;
  if (/nextval|serial|identity/i.test(defaultValue) || type.includes('serial')) return true;
  const primaryKeys = tableSchema.primaryKeys || [];
  return primaryKeys.includes(col) && (col === 'id' || /int|serial/.test(type));
}

function columnHasDefault(col, tableSchema) {
  const defaults = tableSchema.defaults || {};
  return defaults[col] != null && String(defaults[col]).trim() !== '';
}

function insertableColumns(tableSchema, options = {}) {
  return Object.keys(tableSchema.columns || {}).filter((col) => {
    if (isAutoColumn(col, tableSchema)) return false;
    if (!options.includeDefaults && columnHasDefault(col, tableSchema)) return false;
    return true;
  });
}

function columnLabels(tableSchema) {
  const labels = [];
  const columns = tableSchema.columns || {};
  for (const col of Object.keys(columns)) {
    if (isAutoColumn(col, tableSchema)) continue;
    labels.push({ label: col.replace(/_/g, ' '), col });
    if (col.includes('_')) labels.push({ label: col, col });
    if (/email/i.test(col)) {
      labels.push({ label: 'contact email', col });
      labels.push({ label: 'email', col });
    }
    if (/^name$/i.test(col) || /_name$/i.test(col)) {
      labels.push({ label: 'named', col });
      labels.push({ label: 'called', col });
    }
    if (isNumericType(columns[col]) && /value|amount|price|cost|budget|salary|revenue/i.test(col)) {
      labels.push({ label: 'contract value', col });
      labels.push({ label: 'budget', col });
      labels.push({ label: 'amount', col });
    }
  }
  const seen = new Set();
  return labels
    .filter((item) => {
      const key = `${item.label.toLowerCase()}|${item.col}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => b.label.length - a.label.length);
}

function stripInsertCommand(question, tableName) {
  let text = String(question || '').trim();
  text = text.replace(/^(please\s+)/i, '');
  text = text.replace(/^(insert|add|create|register|put|save|store|include)\s+/i, '');
  text = text.replace(/^(?:a|an|the)\s+/i, '');
  text = text.replace(/^(?:row|record|entry|new)\s+/i, '');
  text = text.replace(/^(?:of|into|to|in)\s+/i, '');
  if (tableName) {
    const singular = tableName.replace(/s$/, '');
    text = text.replace(new RegExp(`\\b(?:to|into|in|from|a|an|the)?\\s*(${escapeRegex(tableName)}|${escapeRegex(singular)})\\b`, 'ig'), ' ');
  }
  text = text.replace(/\s+/g, ' ').trim();
  text = text.replace(/^(?:named|called)\s+/i, '');
  return text.trim();
}

function splitValuePieces(segment) {
  const text = segment.trim().replace(/^['"]|['"]$/g, '').trim();
  if (!text) return [];
  const email = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  if (email && email[0].length === text.length) return [text];
  const currency = text.match(/^(.+?)\s+((?:₹\s*)?\d+(?:\.\d+)?\s*(?:cr|crores?|lakhs?|lacs?|millions?|thousand|k)\b(?:\s+rupees)?)$/i);
  if (currency) return [currency[1].trim(), currency[2].trim()];
  return [text];
}

function classifyInsertPiece(piece) {
  const text = String(piece || '').trim().replace(/^['"]|['"]$/g, '').trim();
  if (/^null$/i.test(text)) return 'null';
  if (/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(text)) return 'email';
  if (parseNumericExpression(text) != null && /\d/.test(text)) return 'number';
  return 'text';
}

function coerceInsertValue(raw, col, tableSchema) {
  const text = String(raw || '').trim().replace(/^['"]|['"]$/g, '').trim();
  if (/^null$/i.test(text)) {
    if (tableSchema.nullable && tableSchema.nullable[col] === false) {
      throw new Error(`Column "${col}" does not allow NULL.`);
    }
    return null;
  }
  if (isNumericType(tableSchema.columns[col])) {
    const amount = parseNumericExpression(text);
    if (amount == null) {
      throw new Error(`"${text}" is not a valid number for column "${col}".`);
    }
    return amount;
  }
  return formatTextValue(text);
}

function extractValues(question, tableSchema, tableName = '') {
  const labels = columnLabels(tableSchema);
  let payload = stripInsertCommand(question, tableName);
  const explicit = {};

  for (const item of labels) {
    const pattern = new RegExp(`(?:^|\\s)(?:with\\s+)?${escapeRegex(item.label)}\\s*[:=]?\\s+((?:['"][^'"]+['"])|.+?)(?=\\s*,|\\s+and\\s+|\\s+with\\s+|$)`, 'i');
    const found = payload.match(pattern);
    if (!found || item.col in explicit) continue;
    explicit[item.col] = coerceInsertValue(found[1], item.col, tableSchema);
    payload = payload.replace(found[0], ' ');
  }

  const segments = payload.split(/\s*,\s*|\s+\band\b\s+/i).map((part) => part.trim()).filter(Boolean);
  const positional = [];
  for (const segment of segments) {
    for (const piece of splitValuePieces(segment)) {
      if (INSERT_COMMAND_WORDS.has(piece.toLowerCase())) continue;
      positional.push(piece);
    }
  }

  const values = { ...explicit };
  const pieces = positional.map((piece) => ({
    piece,
    kind: classifyInsertPiece(piece),
    used: false,
  }));

  function openColumns(predicate, includeDefaults) {
    return insertableColumns(tableSchema, { includeDefaults }).filter((col) => !(col in values) && predicate(col));
  }

  function assignKind(kind, predicate) {
    const queue = pieces.filter((item) => !item.used && item.kind === kind);
    const cols = openColumns(predicate, true);
    if (queue.length === 0 || cols.length === 0 || queue.length > cols.length) return;
    queue.forEach((item, index) => {
      values[cols[index]] = coerceInsertValue(item.piece, cols[index], tableSchema);
      item.used = true;
    });
  }

  assignKind('email', (col) => /email/i.test(col) && !isNumericType(tableSchema.columns[col]));
  assignKind('number', (col) => isNumericType(tableSchema.columns[col]));

  const remainingPieces = pieces.filter((item) => !item.used);
  const remainingColumns = openColumns(() => true, false);
  if (remainingPieces.length > remainingColumns.length) {
    throw new Error(
      `I found ${remainingPieces.length} values (${remainingPieces.map((item) => item.piece).join(', ')}) that do not fit the remaining columns: ${remainingColumns.join(', ')}.`
    );
  }
  remainingPieces.forEach((item, index) => {
    const col = remainingColumns[index];
    values[col] = coerceInsertValue(item.piece, col, tableSchema);
  });

  const missing = insertableColumns(tableSchema).filter((col) => {
    if (col in values) return false;
    return tableSchema.nullable && tableSchema.nullable[col] === false;
  });

  return { values, missing };
}

/**
 * Extract WHERE filter values from a question.
 * e.g. "where name = 'Rahul'" or "of Rahul" or "student Rahul"
 *
 * @param {string} question
 * @param {object} tableSchema
 * @returns {object} { col: value }
 */
function extractWhereValues(question, tableSchema) {
  const q = question;
  const where = {};
  const columns = tableSchema.columns || {};

  // Explicit WHERE clause (where name = 'X' or where name is 'X')
  const whereMatch = q.match(/\bwhere\s+(\w+)\s*(?:=|is)\s*['"]?([^'"\s,;]+)['"]?/i);
  if (whereMatch) {
    const col = findColumn(whereMatch[1], columns);
    if (col) {
      where[col] = coerceValue(whereMatch[2], columns[col]);
    }
  }

  // <Name>'s pattern: "update Rahul's mark to 90" or "TestCRUD's mark"
  const possessiveMatch = q.match(/\b([A-Za-z][A-Za-z0-9_-]{1,40})'s\b/i);
  if (possessiveMatch) {
    for (const col of Object.keys(columns)) {
      if (/name/i.test(col) && !(col in where)) {
        where[col] = possessiveMatch[1];
        break;
      }
    }
  }

  // "Delete Rahul" — proper name without an explicit WHERE clause
  const deleteNameMatch = q.match(/\b(?:delete|remove)\s+([A-Za-z][A-Za-z]{1,40})\b/i);
  if (deleteNameMatch) {
    const candidate = deleteNameMatch[1];
    const skipped = /^(student|students|record|row|all|table)$/i.test(candidate);
    if (!skipped) {
      for (const col of Object.keys(columns)) {
        if (/name/i.test(col) && !(col in where)) {
          where[col] = candidate;
          break;
        }
      }
    }
  }

  // "delete <Name> from <table>" pattern
  const deleteFromMatch = q.match(/\bdelete\s+(?:student\s+)?([A-Za-z][A-Za-z0-9_-]{1,40})\s+from\b/i);
  if (deleteFromMatch) {
    for (const col of Object.keys(columns)) {
      if (/name/i.test(col) && !(col in where)) {
        where[col] = deleteFromMatch[1];
        break;
      }
    }
  }

  // "for (student) <Name>" pattern
  const forMatch = q.match(/\bfor\s+(?:student\s+)?([A-Za-z][A-Za-z0-9_-]{1,40})\b/i);
  if (forMatch) {
    for (const col of Object.keys(columns)) {
      if (/name/i.test(col) && !(col in where)) {
        where[col] = forMatch[1];
        break;
      }
    }
  }

  // "named <X>" for WHERE name = 'X'
  const namedMatch = q.match(/\b(?:named?|called?)\s+([A-Za-z][A-Za-z0-9\s_-]{0,40}?)(?=\s+(?:with|to|in|from|at|and|\d)|,|$)/i);
  if (namedMatch) {
    for (const col of Object.keys(columns)) {
      if (/name/i.test(col) && !(col in where)) {
        const rawVal = namedMatch[1].trim();
        where[col] = rawVal.charAt(0).toUpperCase() + rawVal.slice(1);
        break;
      }
    }
  }

  // "of <Name>" pattern: "mark of Rahul" → WHERE name = 'Rahul'
  const ofMatch = q.match(/\bof\s+([A-Z][a-zA-Z]{1,40})\b/);
  if (ofMatch) {
    for (const col of Object.keys(columns)) {
      if (/name/i.test(col) && !(col in where)) {
        where[col] = ofMatch[1];
        break;
      }
    }
  }

  // Numeric filter: "where mark > 80", "with id 5"
  for (const [col, colType] of Object.entries(columns)) {
    if (isNumericType(colType) && col !== 'id') continue; // skip non-id numerics for WHERE
    if (col === 'id' || col.endsWith('_id')) {
      const idMatch = q.match(new RegExp(`\\b(?:id|${escapeRegex(col)})\\s*[=]?\\s*(\\d+)\\b`, 'i'));
      if (idMatch && !(col in where)) {
        where[col] = parseInt(idMatch[1], 10);
      }
    }
  }

  return where;
}

/**
 * Extract SET values for UPDATE (the new values to set).
 * e.g. "update mark to 90" → { mark: 90 }
 * e.g. "change name to Bob" → { name: 'Bob' }
 *
 * @param {string} question
 * @param {object} tableSchema
 * @returns {object}
 */
function extractSetValues(question, tableSchema) {
  const q = question;
  const set = {};
  const columns = tableSchema.columns || {};

  // Pattern: "<col> to <value>"
  for (const [col, colType] of Object.entries(columns)) {
    if (col === 'id' || col.endsWith('_id')) continue;
    const colWords = col.replace(/_/g, ' ');
    const colSingular = col.replace(/s$/, '');

    if (isNumericType(colType)) {
      // "set mark to 90", "update mark to 90", "mark to 90"
      const numTo = q.match(new RegExp(`\\b(?:${escapeRegex(col)}|${escapeRegex(colWords)}|${escapeRegex(colSingular)})\\s+to\\s+(\\d+(?:\\.\\d+)?)\\b`, 'i'));
      if (numTo) {
        set[col] = parseFloat(numTo[1]);
        continue;
      }
      // "set mark = 90"
      const numEq = q.match(new RegExp(`\\b(?:${escapeRegex(col)}|${escapeRegex(colWords)})\\s*=\\s*(\\d+(?:\\.\\d+)?)\\b`, 'i'));
      if (numEq) {
        set[col] = parseFloat(numEq[1]);
        continue;
      }
      // "set mark 90", "update mark 90"
      const numDirect = q.match(new RegExp(`\\b(?:set|update)\\s+(?:\\w+\\s+)?(?:${escapeRegex(col)}|${escapeRegex(colWords)})\\s*(?:to|=|:)?\\s*(\\d+(?:\\.\\d+)?)\\b`, 'i'));
      if (numDirect) {
        set[col] = parseFloat(numDirect[1]);
        continue;
      }
    } else {
      // "change name to Bob"
      const strTo = q.match(new RegExp(`\\b(?:${escapeRegex(col)}|${escapeRegex(colWords)}|${escapeRegex(colSingular)})\\s+to\\s+['\"]?([A-Za-z][\\w\\s]{0,40}?)['\"]?(?=\\s|$)`, 'i'));
      if (strTo) {
        const val = strTo[1].trim().replace(/['"]/g, '');
        if (val.length > 0) {
          set[col] = val.charAt(0).toUpperCase() + val.slice(1);
        }
        continue;
      }
      // "set name = 'Bob'"
      const strEq = q.match(new RegExp(`\\b(?:${escapeRegex(col)}|${escapeRegex(colWords)})\\s*=\\s*['\"]?([^'\"\\s,;]+)['\"]?\\b`, 'i'));
      if (strEq) {
        set[col] = strEq[1];
        continue;
      }
    }
  }

  return set;
}

// ── SQL Generation ────────────────────────────────────────

/**
 * Generate INSERT SQL from natural language.
 * @param {string} question
 * @param {string} targetTable
 * @param {object} tableSchema
 * @param {string} dbType
 * @returns {{ sql: string, values: object, warnings: string[] }}
 */
function sqlLiteral(value) {
  if (value === null) return 'NULL';
  if (typeof value === 'number') return String(value);
  return `'${String(value).replace(/'/g, "''")}'`;
}

function buildInsertSQL(question, targetTable, tableSchema, dbType = 'postgres') {
  const warnings = [];
  const extracted = extractValues(question, tableSchema, targetTable);
  const values = extracted.values || extracted;

  if (extracted.missing && extracted.missing.length > 0) {
    const known = Object.entries(values).map(([col, value]) => `${col} '${value}'`).join(', ');
    const missingList = extracted.missing.map((col) => `- ${col}`).join('\n');
    throw new Error(
      `I have ${known || 'part of this row'}, but these required fields are missing:\n${missingList}\nPlease provide them.`
    );
  }

  if (Object.keys(values).length === 0) {
    throw new Error(`Could not extract column values for INSERT into "${targetTable}". Please specify values like "add a student named Rahul with mark 85".`);
  }

  // Validate: reject unknown columns
  const knownCols = new Set(Object.keys(tableSchema.columns || {}));
  for (const col of Object.keys(values)) {
    if (!knownCols.has(col)) {
      throw new Error(`Column "${col}" does not exist in table "${targetTable}".`);
    }
  }

  const columnOrder = insertableColumns(tableSchema, { includeDefaults: true });
  const cols = columnOrder.filter((col) => col in values);
  const vals = cols.map((col) => values[col]);

  let sql;
  if (dbType === 'postgres') {
    const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
    sql = `INSERT INTO ${targetTable} (${cols.join(', ')})\nVALUES (${placeholders});`;
  } else if (dbType === 'mysql') {
    const placeholders = cols.map(() => '?').join(', ');
    sql = `INSERT INTO ${targetTable} (${cols.join(', ')})\nVALUES (${placeholders});`;
  } else {
    // SQLite — inline values as a preview (parameterized at execution time)
    const placeholders = cols.map(() => '?').join(', ');
    sql = `INSERT INTO ${targetTable} (${cols.join(', ')})\nVALUES (${placeholders});`;
  }

  // Readable SQL with actual values (for preview)
  const readableParts = vals.map((value) => sqlLiteral(value));
  const readableSQL = `INSERT INTO ${targetTable} (${cols.join(', ')})\nVALUES (${readableParts.join(', ')});`;

  const orderedValues = {};
  cols.forEach((col, index) => {
    orderedValues[col] = vals[index];
  });

  return {
    sql: readableSQL,
    paramSql: sql,
    params: vals,
    values: orderedValues,
    columnValues: orderedValues,
    warnings,
  };
}

/**
 * Generate UPDATE SQL from natural language.
 * @param {string} question
 * @param {string} targetTable
 * @param {object} tableSchema
 * @param {string} dbType
 * @returns {{ sql: string, riskLevel: string, warnings: string[], hasWhereClause: boolean }}
 */
function buildUpdateSQL(question, targetTable, tableSchema, dbType = 'postgres') {
  const warnings = [];

  const setValues = extractSetValues(question, tableSchema);
  const whereValues = extractWhereValues(question, tableSchema);

  if (Object.keys(setValues).length === 0) {
    throw new Error(`Could not determine what to update in "${targetTable}". Please specify like "update Rahul's mark to 90".`);
  }

  // Validate columns
  const knownCols = new Set(Object.keys(tableSchema.columns || {}));
  for (const col of Object.keys(setValues)) {
    if (!knownCols.has(col)) {
      throw new Error(`Column "${col}" does not exist in table "${targetTable}".`);
    }
  }
  for (const col of Object.keys(whereValues)) {
    if (!knownCols.has(col)) {
      delete whereValues[col]; // Remove invalid WHERE col silently
    }
  }

  const hasWhereClause = Object.keys(whereValues).length > 0;
  const riskLevel = hasWhereClause ? 'NORMAL' : 'HIGH';

  if (!hasWhereClause) {
    warnings.push('No WHERE clause detected. This UPDATE will affect ALL rows in the table.');
  }

  // Build readable SQL
  const setClauses = Object.entries(setValues).map(([col, val]) => {
    return typeof val === 'string' ? `${col} = '${val}'` : `${col} = ${val}`;
  });

  let whereClause = '';
  if (hasWhereClause) {
    const whereParts = Object.entries(whereValues).map(([col, val]) => {
      return typeof val === 'string' ? `${col} = '${val}'` : `${col} = ${val}`;
    });
    whereClause = `\nWHERE ${whereParts.join(' AND ')}`;
  }

  const sql = `UPDATE ${targetTable}\nSET ${setClauses.join(', ')}${whereClause};`;

  return { sql, setValues, whereValues, hasWhereClause, riskLevel, warnings };
}

/**
 * Generate DELETE SQL from natural language.
 * @param {string} question
 * @param {string} targetTable
 * @param {object} tableSchema
 * @param {string} dbType
 * @returns {{ sql: string, riskLevel: string, warnings: string[], hasWhereClause: boolean }}
 */
function buildDeleteSQL(question, targetTable, tableSchema, dbType = 'postgres') {
  const warnings = [];
  const whereValues = extractWhereValues(question, tableSchema);

  // Validate WHERE columns
  const knownCols = new Set(Object.keys(tableSchema.columns || {}));
  for (const col of Object.keys(whereValues)) {
    if (!knownCols.has(col)) {
      delete whereValues[col];
    }
  }

  const hasWhereClause = Object.keys(whereValues).length > 0;
  const riskLevel = hasWhereClause ? 'NORMAL' : 'HIGH';

  if (!hasWhereClause) {
    warnings.push(`No WHERE clause detected. This DELETE will remove ALL records from "${targetTable}".`);
  }

  let sql;
  if (hasWhereClause) {
    const whereParts = Object.entries(whereValues).map(([col, val]) => {
      return typeof val === 'string' ? `${col} = '${val}'` : `${col} = ${val}`;
    });
    sql = `DELETE FROM ${targetTable}\nWHERE ${whereParts.join(' AND ')};`;
  } else {
    sql = `DELETE FROM ${targetTable};`;
  }

  return { sql, whereValues, hasWhereClause, riskLevel, warnings };
}

/**
 * Find the best table for a write operation.
 * @param {string} question
 * @param {object} schema - { tables: {} }
 * @returns {string|null}
 */
function findTargetTable(question, schema) {
  const q = question.toLowerCase();
  const tables = Object.keys(schema.tables || {});

  let bestMatch = null;
  let bestScore = -1;

  for (const table of tables) {
    const tableInfo = schema.tables[table] || {};
    const singular = table.replace(/ies$/, 'y').replace(/es$/, '').replace(/s$/, '');
    let score = 0;

    // Direct entity match (e.g. 'add a student', 'update students', 'delete student', 'insert into students')
    const directActionRegex = new RegExp(`\\b(?:add(?:\\s+(?:a|an))?|insert(?:\\s+into)?|update|delete(?:\\s+from)?|new)\\s+(\\w+\\s+)?(${escapeRegex(table)}|${escapeRegex(singular)})\\b`, 'i');
    if (directActionRegex.test(q)) {
      score += 100;
    }

    const tableRegex = new RegExp(`\\b(${escapeRegex(table)}|${escapeRegex(singular)})\\b`, 'i');
    const match = q.match(tableRegex);
    if (match) {
      score += 50 - Math.min(match.index, 40); // earlier in sentence = higher score
      score += Math.min(table.length, 10);
    }

    // Count matching columns in table
    const cols = Object.keys(tableInfo.columns || {});
    for (const col of cols) {
      if (col === 'id' || col.endsWith('_id')) continue;
      const colRegex = new RegExp(`\\b${escapeRegex(col)}\\b`, 'i');
      if (colRegex.test(q)) {
        score += 10;
      }
    }

    if (score > 0 && score > bestScore) {
      bestScore = score;
      bestMatch = table;
    }
  }

  // Column-based inference: if a column name appears in the question,
  // infer the table from that column (e.g. 'update mark' -> students.mark -> students)
  if (!bestMatch) {
    for (const [table, tableInfo] of Object.entries(schema.tables || {})) {
      const cols = Object.keys(tableInfo.columns || {});
      for (const col of cols) {
        if (col === 'id' || col.endsWith('_id')) continue;
        const colSingular = col.replace(/s$/, '');
        const colReadable = col.replace(/_/g, ' ');
        const colRegex = new RegExp(`\\b(${escapeRegex(col)}|${escapeRegex(colSingular)}|${escapeRegex(colReadable)})\\b`, 'i');
        if (colRegex.test(q)) {
          bestMatch = table;
          break;
        }
      }
      if (bestMatch) break;
    }
  }

  // A single table, or the only table with a name column, is a safe fallback
  // for requests like "Delete Rahul" that name a person but not the table.
  if (!bestMatch && tables.length === 1) {
    return tables[0];
  }
  if (!bestMatch) {
    const withName = tables.filter((table) =>
      Object.keys(schema.tables[table]?.columns || {}).some((col) => /name/i.test(col))
    );
    if (withName.length === 1 && /\b[A-Za-z]{2,}\b/.test(question)) {
      return withName[0];
    }
  }

  // Fuzzy fallback on table names
  if (!bestMatch && tables.length > 0) {
    const qWords = q.split(/\s+/);
    for (const table of tables) {
      const sing = table.replace(/s$/, '');
      for (const word of qWords) {
        if (word.length > 3 && (levenshtein(word, table) <= 2 || levenshtein(word, sing) <= 2)) {
          bestMatch = table;
          break;
        }
      }
      if (bestMatch) break;
    }
  }

  return bestMatch;
}

/**
 * Main entry: Generate a write operation plan from natural language.
 *
 * @param {string} question
 * @param {object} schema - Full schema { tables: {}, relationships: [] }
 * @param {string} [dbType='postgres']
 * @returns {{
 *   intent: 'INSERT'|'UPDATE'|'DELETE',
 *   targetTable: string,
 *   sql: string,
 *   riskLevel: 'NORMAL'|'HIGH',
 *   warnings: string[],
 *   hasWhereClause: boolean,
 *   estimatedRows: number|null
 * }}
 */
function generateMutationPlan(question, schema, dbType = 'postgres') {
  // DDL check: DROP, ALTER, TRUNCATE, CREATE are never allowed
  const DDL_BLOCK = /^(drop|truncate|alter|create|grant|revoke)\b/i;
  if (DDL_BLOCK.test(question.trim())) {
    throw new Error('No write intent detected. Use "add", "update", or "delete" keywords.');
  }

  const intent = detectWriteIntent(question);
  if (!intent) {
    throw new Error('No write intent detected. Use "add", "update", or "delete" keywords.');
  }

  const targetTable = findTargetTable(question, schema);
  if (!targetTable) {
    const tableList = Object.keys(schema.tables || {}).join(', ');
    throw new Error(`Could not identify a target table. Available tables: ${tableList}.`);
  }

  const tableSchema = schema.tables[targetTable];
  if (!tableSchema) {
    throw new Error(`Table "${targetTable}" not found in schema.`);
  }

  let result;
  if (intent === 'INSERT') {
    result = buildInsertSQL(question, targetTable, tableSchema, dbType);
    return {
      intent,
      targetTable,
      sql: result.sql,
      columnValues: result.columnValues || result.values || null,
      riskLevel: 'NORMAL',
      warnings: result.warnings || [],
      hasWhereClause: true, // INSERT doesn't need WHERE
      estimatedRows: 1,
    };
  } else if (intent === 'UPDATE') {
    result = buildUpdateSQL(question, targetTable, tableSchema, dbType);
    return {
      intent,
      targetTable,
      sql: result.sql,
      riskLevel: result.riskLevel,
      warnings: result.warnings,
      hasWhereClause: result.hasWhereClause,
      estimatedRows: null, // computed later via row count query
    };
  } else {
    // DELETE
    result = buildDeleteSQL(question, targetTable, tableSchema, dbType);
    return {
      intent,
      targetTable,
      sql: result.sql,
      riskLevel: result.riskLevel,
      warnings: result.warnings,
      hasWhereClause: result.hasWhereClause,
      estimatedRows: null,
    };
  }
}

// ── Validation: Write SQL security check ─────────────────

const ALLOWED_WRITE_OPS = new Set(['INSERT', 'UPDATE', 'DELETE']);
const FORBIDDEN_WRITE_OPS = ['DROP', 'ALTER', 'TRUNCATE', 'CREATE', 'GRANT', 'REVOKE', 'EXEC', 'EXECUTE', 'COPY'];

/**
 * Validates that a write SQL statement is safe to execute.
 * - Must be INSERT, UPDATE, or DELETE only
 * - No DDL or dangerous ops
 * - No multi-statement
 * - Schema-validated table
 *
 * @param {string} sql
 * @param {object} schema
 * @param {string} dbType
 * @returns {{ valid: boolean, error?: string }}
 */
function validateWriteSQL(sql, schema, dbType = 'postgres') {
  if (!sql || typeof sql !== 'string') {
    return { valid: false, error: 'SQL statement is required.' };
  }

  // Strip comments
  const clean = sql.replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '').trim();

  // Multi-statement check
  const stmts = clean.split(';').map((s) => s.trim()).filter(Boolean);
  if (stmts.length > 1) {
    return { valid: false, error: 'Multiple SQL statements are not allowed. Submit one write operation at a time.' };
  }

  const stmt = stmts[0] || clean;
  const firstWordMatch = stmt.match(/^(\w+)\b/i);
  if (!firstWordMatch) {
    return { valid: false, error: 'Invalid SQL statement format.' };
  }

  const firstWord = firstWordMatch[1].toUpperCase();

  // Must be a write operation
  if (!ALLOWED_WRITE_OPS.has(firstWord)) {
    return { valid: false, error: `Only INSERT, UPDATE, and DELETE are allowed in Read+Write mode. Found "${firstWord}".` };
  }

  // Forbidden DDL
  for (const op of FORBIDDEN_WRITE_OPS) {
    if (new RegExp(`\\b${op}\\b`, 'i').test(stmt)) {
      return { valid: false, error: `Security restriction: "${op}" is not allowed in write mode.` };
    }
  }

  // System catalog protection
  const SYSTEM_CATALOG_PATTERNS = [
    /\bpg_shadow\b/i, /\bpg_authid\b/i, /\bpg_user\b/i, /\bpg_roles\b/i,
    /\binformation_schema\b/i, /\bpg_catalog\b/i, /\bmysql\.\w+/i,
    /\bsqlite_master\b/i, /\bsqlite_schema\b/i,
  ];
  for (const pattern of SYSTEM_CATALOG_PATTERNS) {
    if (pattern.test(stmt)) {
      return { valid: false, error: 'Security restriction: Access to system catalogs is not permitted.' };
    }
  }

  // Validate target table exists in schema
  if (schema && schema.tables) {
    const knownTables = new Set(Object.keys(schema.tables).map((t) => t.toLowerCase()));

    let targetTable = null;
    if (firstWord === 'INSERT') {
      const intoMatch = stmt.match(/INSERT\s+INTO\s+["`]?([a-zA-Z0-9_]+)["`]?/i);
      if (intoMatch) targetTable = intoMatch[1];
    } else if (firstWord === 'UPDATE') {
      const updateMatch = stmt.match(/UPDATE\s+["`]?([a-zA-Z0-9_]+)["`]?\b/i);
      if (updateMatch) targetTable = updateMatch[1];
    } else if (firstWord === 'DELETE') {
      const fromMatch = stmt.match(/DELETE\s+FROM\s+["`]?([a-zA-Z0-9_]+)["`]?/i);
      if (fromMatch) targetTable = fromMatch[1];
    }

    if (targetTable && !knownTables.has(targetTable.toLowerCase())) {
      return {
        valid: false,
        error: `Table "${targetTable}" does not exist. Available tables: ${Array.from(knownTables).join(', ')}.`,
      };
    }
  }

  return { valid: true };
}

/**
 * Execute a write SQL statement within a transaction.
 * Returns affected row count and operation details.
 *
 * @param {string} sql
 * @param {object} adapter - Database adapter
 * @param {string} dbType
 * @returns {Promise<{ affectedRows: number, operation: string }>}
 */
async function executeWriteSQL(sql, adapter, dbType) {
  const clean = sql.replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '').trim();
  const firstWordMatch = clean.match(/^(\w+)\b/i);
  const operation = firstWordMatch ? firstWordMatch[1].toUpperCase() : 'UNKNOWN';

  // Use adapter-level transaction execution if available
  if (typeof adapter.executeWrite === 'function') {
    const res = await adapter.executeWrite(clean);
    return {
      affectedRows: res.affectedRows ?? res.rowCount ?? 0,
      operation,
    };
  }

  // Fallback
  if (dbType === 'postgres' || dbType === 'mysql' || dbType === 'sqlite') {
    const result = await adapter.executeQuery(clean);
    const affectedRows = result.affectedRows ?? result.rowCount ?? result.rows?.length ?? 0;
    return { affectedRows, operation };
  } else {
    throw new Error(`Write operations are not supported for database type: ${dbType}`);
  }
}

/**
 * Estimate the number of rows affected by an UPDATE/DELETE.
 * Converts the SQL to a COUNT query to estimate impact.
 *
 * @param {string} sql - The UPDATE or DELETE statement
 * @param {object} adapter
 * @param {string} dbType
 * @returns {Promise<number|null>}
 */
async function estimateAffectedRows(sql, adapter, dbType) {
  if (dbType === 'mongodb') return null;

  const clean = sql.replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '').trim();
  const firstWord = (clean.match(/^(\w+)\b/i) || [])[1]?.toUpperCase();

  if (firstWord !== 'UPDATE' && firstWord !== 'DELETE') return null;

  try {
    let countSQL;
    if (firstWord === 'UPDATE') {
      // Extract table and WHERE clause
      const tableMatch = clean.match(/UPDATE\s+["'`]?(\w+)["'`]?\s+SET\s+.+?(?:WHERE\s+(.+))?$/is);
      if (!tableMatch) return null;
      const table = tableMatch[1];
      const where = tableMatch[2];
      countSQL = where
        ? `SELECT COUNT(*) AS estimated_count FROM ${table} WHERE ${where.replace(/;$/, '')}`
        : `SELECT COUNT(*) AS estimated_count FROM ${table}`;
    } else {
      // DELETE
      const tableMatch = clean.match(/DELETE\s+FROM\s+["'`]?(\w+)["'`]?(?:\s+WHERE\s+(.+))?/is);
      if (!tableMatch) return null;
      const table = tableMatch[1];
      const where = tableMatch[2];
      countSQL = where
        ? `SELECT COUNT(*) AS estimated_count FROM ${table} WHERE ${where.replace(/;$/, '')}`
        : `SELECT COUNT(*) AS estimated_count FROM ${table}`;
    }

    const result = await adapter.executeQuery(countSQL + ';');
    if (result && result.rows && result.rows.length > 0) {
      const row = result.rows[0];
      const count = row.estimated_count ?? row['COUNT(*)'] ?? row.count ?? null;
      return count !== null ? parseInt(count, 10) : null;
    }
  } catch {
    // Estimation failed — not critical
  }
  return null;
}

// ── Utility functions ─────────────────────────────────────

function escapeRegex(str) {
  return (str || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isNumericType(colType) {
  if (!colType) return false;
  const t = colType.toLowerCase();
  return t.includes('int') || t.includes('num') || t.includes('float') ||
         t.includes('double') || t.includes('decimal') || t.includes('real') ||
         t.includes('serial') || t.includes('money') || t.includes('numeric');
}

function findColumn(name, columns) {
  const lower = name.toLowerCase();
  for (const col of Object.keys(columns)) {
    if (col.toLowerCase() === lower || col.toLowerCase().replace(/_/g, ' ') === lower) {
      return col;
    }
  }
  return null;
}

function coerceValue(val, colType) {
  if (isNumericType(colType)) {
    const n = parseFloat(val);
    return isNaN(n) ? val : n;
  }
  return val;
}

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

module.exports = {
  detectWriteIntent,
  generateMutationPlan,
  validateWriteSQL,
  executeWriteSQL,
  estimateAffectedRows,
  findTargetTable,
  parseNumericExpression,
};
