// ============================================
// DDL Service — Schema Definition & Evolution
// ============================================
// Generates schema definition SQL (CREATE, ALTER, DROP, TRUNCATE)
// from natural language requests.
//
// RISK POLICIES:
//   - CREATE TABLE: HIGH risk
//   - ALTER TABLE: HIGH risk
//   - DROP TABLE / DROP DATABASE: CRITICAL risk
//   - TRUNCATE TABLE: CRITICAL risk
//
// All generated DDL operations REQUIRE strict AI safety review
// and explicit user confirmation before execution.

/**
 * Detect DDL operation intent: 'CREATE' | 'ALTER' | 'DROP' | 'TRUNCATE' | null
 *
 * @param {string} question
 * @returns {'CREATE'|'ALTER'|'DROP'|'TRUNCATE'|null}
 */
function detectDDLIntent(question) {
  const q = (question || '').trim().toLowerCase();

  if (/^(create\s+table|make\s+a\s+table|build\s+a\s+table|create\s+an?\s+\w+\s+table)\b/i.test(q)) {
    return 'CREATE';
  }
  if (/\bcreate\s+table\b/i.test(q)) return 'CREATE';

  if (/^(drop\s+table|remove\s+table|delete\s+table|drop\s+the\s+table)\b/i.test(q)) {
    return 'DROP';
  }
  if (/\bdrop\s+(?:the\s+)?([a-zA-Z0-9_]+)\s+table\b/i.test(q)) return 'DROP';
  if (/\bdrop\s+table\b/i.test(q)) return 'DROP';
  if (/\bdrop\s+(?:the\s+)?[a-z0-9_]+\b/i.test(q) && !/\b(column|index|database|schema)\b/i.test(q)) {
    return 'DROP';
  }

  if (/^(truncate\s+table|truncate|wipe\s+table|empty\s+table)\b/i.test(q)) {
    return 'TRUNCATE';
  }
  if (/\btruncate\b/i.test(q)) return 'TRUNCATE';

  if (/^(alter\s+table|add\s+column|drop\s+column|modify\s+column|rename\s+column|rename\s+table)\b/i.test(q)) {
    return 'ALTER';
  }
  if (/\balter\s+table\b/i.test(q)) return 'ALTER';
  if (/\badd\s+(?:an?\s+)?\w+\s+column\b/i.test(q)) return 'ALTER';

  return null;
}

/**
 * Extract target table name for DDL operation.
 */
function extractDDLTargetTable(question, schema = null) {
  const q = (question || '').trim();

  // Pattern: "drop the <tableName> table" or "drop <tableName> table"
  const dropMatch = q.match(/\bdrop\s+(?:the\s+)?([a-zA-Z0-9_]+)(?:\s+table)?\b/i);
  if (dropMatch && dropMatch[1] && !['the', 'table', 'database'].includes(dropMatch[1].toLowerCase())) {
    return dropMatch[1].toLowerCase();
  }

  // Pattern: "create (an?) <tableName> table"
  const createMatch = q.match(/\bcreate\s+(?:an?\s+)?([a-zA-Z0-9_]+)\s+table\b/i);
  if (createMatch) {
    return createMatch[1].toLowerCase();
  }

  // Pattern: "create table <tableName>"
  const createTableMatch = q.match(/\bcreate\s+table\s+["`]?([a-zA-Z0-9_]+)["`]?/i);
  if (createTableMatch) {
    return createTableMatch[1].toLowerCase();
  }

  // Pattern: "add <column> column to <tableName>"
  const alterToMatch = q.match(/\bto\s+(?:table\s+)?["`]?([a-zA-Z0-9_]+)["`]?/i);
  if (alterToMatch) {
    return alterToMatch[1].toLowerCase();
  }

  // Pattern: "truncate <table>"
  const truncMatch = q.match(/\btruncate\s+(?:table\s+)?["`]?([a-zA-Z0-9_]+)["`]?/i);
  if (truncMatch) {
    return truncMatch[1].toLowerCase();
  }

  // Match against known schema tables if available
  if (schema?.tables) {
    for (const table of Object.keys(schema.tables)) {
      const regex = new RegExp(`\\b${table}\\b`, 'i');
      if (regex.test(q)) {
        return table;
      }
    }
  }

  return 'new_table';
}

/**
 * Generate DDL statement from natural language query.
 *
 * @param {string} question
 * @param {object} [schema]
 * @param {string} [dbType='postgres']
 * @returns {{
 *   intent: 'CREATE'|'ALTER'|'DROP'|'TRUNCATE',
 *   targetTable: string,
 *   sql: string,
 *   riskLevel: 'HIGH'|'CRITICAL',
 *   warnings: string[],
 *   requiresConfirmation: true
 * }}
 */
function generateDDLPlan(question, schema = null, dbType = 'postgres') {
  const intent = detectDDLIntent(question);
  if (!intent) {
    throw new Error('No recognizable DDL operation found in question.');
  }

  const targetTable = extractDDLTargetTable(question, schema);
  const q = question.toLowerCase();
  const warnings = [];

  let sql = '';
  let riskLevel = 'HIGH';

  if (intent === 'CREATE') {
    riskLevel = 'HIGH';
    warnings.push(`This will create a new table "${targetTable}" in your database.`);

    // Extract columns or use sensible defaults
    const cols = [];
    if (dbType === 'postgres') {
      cols.push('id SERIAL PRIMARY KEY');
    } else if (dbType === 'sqlite') {
      cols.push('id INTEGER PRIMARY KEY AUTOINCREMENT');
    } else {
      cols.push('id INT AUTO_INCREMENT PRIMARY KEY');
    }

    if (/name/i.test(q)) cols.push('name VARCHAR(100) NOT NULL');
    if (/email/i.test(q)) cols.push('email VARCHAR(255) UNIQUE');
    if (/salary/i.test(q)) cols.push('salary NUMERIC(10, 2)');
    if (/department/i.test(q)) cols.push('department VARCHAR(100)');
    if (/role|title/i.test(q)) cols.push('role VARCHAR(100)');
    if (/mark|grade/i.test(q)) cols.push('mark NUMERIC(5, 2)');

    // If only id was added, add generic name and created_at columns
    if (cols.length === 1) {
      cols.push('name VARCHAR(100) NOT NULL');
      cols.push(dbType === 'sqlite' ? 'created_at DATETIME DEFAULT CURRENT_TIMESTAMP' : 'created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    }

    sql = `CREATE TABLE ${targetTable} (\n  ${cols.join(',\n  ')}\n);`;
  } else if (intent === 'ALTER') {
    riskLevel = 'HIGH';
    warnings.push(`This will modify the schema of table "${targetTable}".`);

    // Check for add column: e.g. "add email column to employees"
    const addColMatch = question.match(/\badd\s+(?:an?\s+)?([a-zA-Z0-9_]+)\s+column\b/i);
    const colName = addColMatch ? addColMatch[1].toLowerCase() : 'new_column';

    let colType = 'VARCHAR(255)';
    if (/int|number|count/i.test(colName)) colType = 'INTEGER';
    if (/salary|price|amount|mark/i.test(colName)) colType = 'NUMERIC(10, 2)';
    if (/date|time/i.test(colName)) colType = dbType === 'sqlite' ? 'DATETIME' : 'TIMESTAMP';

    sql = `ALTER TABLE ${targetTable} ADD COLUMN ${colName} ${colType};`;
  } else if (intent === 'DROP') {
    riskLevel = 'CRITICAL';
    warnings.push(`🚨 CRITICAL: This permanently removes table "${targetTable}" and all its records.`);
    warnings.push('This action cannot be undone.');

    sql = `DROP TABLE ${targetTable};`;
  } else if (intent === 'TRUNCATE') {
    riskLevel = 'CRITICAL';
    warnings.push(`⚠️ This permanently deletes ALL data in table "${targetTable}".`);
    warnings.push('Table structure will be kept, but all rows will be erased.');

    if (dbType === 'sqlite') {
      sql = `DELETE FROM ${targetTable};`;
    } else {
      sql = `TRUNCATE TABLE ${targetTable};`;
    }
  }

  return {
    intent,
    targetTable,
    sql,
    riskLevel,
    warnings,
    hasWhereClause: false,
    estimatedRows: null,
    requiresConfirmation: true,
  };
}

module.exports = {
  detectDDLIntent,
  extractDDLTargetTable,
  generateDDLPlan,
};
