// ============================================
// SQL & MQL Validator — 3-Layer Production Validation
// ============================================
// Day 4 Architecture:
//   Layer 1 — Syntax Validation: Balanced parens, quotes, well-formed statements.
//   Layer 2 — Schema Validation: Tables, columns, and foreign-key join relationships exist.
//   Layer 3 — Security Validation: Read-only SELECT/find/aggregate only, no multi-statements,
//             and blocking dangerous server/filesystem/execution functions.

// ── Layer 3: Forbidden Operations (DDL / DML Mutation) ──
// Forbidden for READ-ONLY mode
const FORBIDDEN_OPERATIONS = [
  'INSERT',
  'UPDATE',
  'DELETE',
  'DROP',
  'ALTER',
  'TRUNCATE',
  'CREATE',
  'GRANT',
  'REVOKE',
  'EXEC',
  'EXECUTE',
  'COPY',
  'REPLACE',
];

// Forbidden even in READ+WRITE mode (DDL/admin only)
const FORBIDDEN_DDL_OPERATIONS = [
  'DROP',
  'ALTER',
  'TRUNCATE',
  'CREATE',
  'GRANT',
  'REVOKE',
  'EXEC',
  'EXECUTE',
  'COPY',
];

// Allowed DML operations in READ+WRITE mode
const ALLOWED_WRITE_OPERATIONS = new Set(['SELECT', 'WITH', 'INSERT', 'UPDATE', 'DELETE']);

// ── Layer 3: Blocked Dangerous Functions by Database ────
const DANGEROUS_FUNCTIONS = {
  postgres: [
    'pg_read_file',
    'pg_read_binary_file',
    'pg_ls_dir',
    'pg_stat_file',
    'lo_import',
    'lo_export',
    'dblink',
    'dblink_connect',
    'dblink_exec',
    'current_setting',
    'set_config',
    'pg_terminate_backend',
    'pg_cancel_backend',
  ],
  mysql: [
    'load_file',
    'into outfile',
    'into dumpfile',
    'benchmark',
    'sleep',
    'system_user',
    'session_user',
  ],
  sqlite: [
    'attach',
    'detach',
    'writefile',
    'readfile',
    'edit',
    'load_extension',
    'fts3_tokenizer',
  ],
};

// ── Layer 3: System Catalogs / Protected Tables ────────
const SYSTEM_CATALOG_PATTERNS = [
  /\bpg_shadow\b/i,
  /\bpg_authid\b/i,
  /\bpg_user\b/i,
  /\bpg_roles\b/i,
  /\binformation_schema\b/i,
  /\bpg_catalog\b/i,
  /\bmysql\.\w+/i,
  /\bsqlite_master\b/i,
  /\bsqlite_schema\b/i,
];

// ── MongoDB Forbidden Operations ──────────────────────
const FORBIDDEN_MONGO_OPS = [
  'insert', 'insertone', 'insertmany',
  'update', 'updateone', 'updatemany',
  'delete', 'deleteone', 'deletemany', 'remove',
  'drop', 'dropdatabase', 'renamecollection',
  'bulkwrite', 'replaceone',
];

/**
 * Strips comments from SQL query.
 */
function stripComments(sql) {
  return (sql || '')
    .replace(/--.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .trim();
}

/**
 * Extracts table references from FROM and JOIN clauses.
 */
function extractAllTableReferences(sql) {
  const tables = new Set();
  const clean = stripComments(sql);

  // FROM table [alias] (supports optional quotes for mixed-case tables)
  const fromRegex = /\bFROM\s+["`]?([a-zA-Z0-9_]+)["`]?(?:\s+(?:AS\s+)?["`]?([a-zA-Z0-9_]+)["`]?)?/gi;
  let match;
  while ((match = fromRegex.exec(clean)) !== null) {
    tables.add(match[1]);
  }

  // JOIN table [alias] (supports optional quotes for mixed-case tables)
  const joinRegex = /\bJOIN\s+["`]?([a-zA-Z0-9_]+)["`]?(?:\s+(?:AS\s+)?["`]?([a-zA-Z0-9_]+)["`]?)?/gi;
  while ((match = joinRegex.exec(clean)) !== null) {
    tables.add(match[1]);
  }

  return Array.from(tables);
}

// ══════════════════════════════════════════════
// ─── Layer 1: Syntax Validation ──────────────
// ══════════════════════════════════════════════

/**
 * Validates syntax structure (parentheses balance, quotation balance, keywords).
 *
 * @param {string} query
 * @param {string} [dbType='postgres']
 * @returns {{ valid: boolean, error?: string }}
 */
function validateSyntax(query, dbType = 'postgres') {
  if (!query || typeof query !== 'string') {
    return { valid: false, error: 'Query must be a non-empty string.' };
  }

  const clean = stripComments(query);
  if (!clean) {
    return { valid: false, error: 'Empty query provided.' };
  }

  // Check balanced parentheses
  let parenCount = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;

  for (let i = 0; i < clean.length; i++) {
    const char = clean[i];
    if (char === "'" && clean[i - 1] !== '\\') {
      if (!inDoubleQuote) inSingleQuote = !inSingleQuote;
    } else if (char === '"' && clean[i - 1] !== '\\') {
      if (!inSingleQuote) inDoubleQuote = !inDoubleQuote;
    } else if (!inSingleQuote && !inDoubleQuote) {
      if (char === '(' || char === '[' || char === '{') parenCount++;
      if (char === ')' || char === ']' || char === '}') parenCount--;
      if (parenCount < 0) {
        return { valid: false, error: 'Syntax error: Unmatched closing bracket/parenthesis.' };
      }
    }
  }

  if (parenCount !== 0) {
    return { valid: false, error: 'Syntax error: Unbalanced brackets or parentheses.' };
  }
  if (inSingleQuote || inDoubleQuote) {
    return { valid: false, error: 'Syntax error: Unclosed quotation mark.' };
  }

  if (dbType === 'mongodb' || clean.startsWith('db.')) {
    if (!clean.startsWith('db.') || !clean.includes('.')) {
      return { valid: false, error: 'Syntax error: MongoDB queries must start with db.<collection>.' };
    }
    return { valid: true };
  }

  // Relational SQL syntax checks
  const statements = clean.split(';').map((s) => s.trim()).filter(Boolean);
  if (statements.length > 1) {
    return { valid: false, error: 'Multiple SQL statements are not allowed. Please submit one query at a time.' };
  }

  const stmt = statements[0];
  const firstWordMatch = stmt.match(/^(\w+)\b/i);
  if (!firstWordMatch) {
    return { valid: false, error: 'Invalid SQL statement format.' };
  }

  const firstWord = firstWordMatch[1].toUpperCase();
  if (firstWord !== 'SELECT' && firstWord !== 'WITH') {
    return { valid: false, error: `Syntax check: Only SELECT queries are allowed. Found "${firstWord}".` };
  }

  return { valid: true };
}

/**
 * Validates write-mode SQL syntax (allows INSERT/UPDATE/DELETE but not DDL).
 *
 * @param {string} query
 * @param {string} [dbType='postgres']
 * @returns {{ valid: boolean, error?: string }}
 */
function validateSyntaxWrite(query, dbType = 'postgres') {
  if (!query || typeof query !== 'string') {
    return { valid: false, error: 'Query must be a non-empty string.' };
  }

  const clean = stripComments(query);
  if (!clean) {
    return { valid: false, error: 'Empty query provided.' };
  }

  // Check balanced parentheses
  let parenCount = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  for (let i = 0; i < clean.length; i++) {
    const char = clean[i];
    if (char === "'" && clean[i - 1] !== '\\') {
      if (!inDoubleQuote) inSingleQuote = !inSingleQuote;
    } else if (char === '"' && clean[i - 1] !== '\\') {
      if (!inSingleQuote) inDoubleQuote = !inDoubleQuote;
    } else if (!inSingleQuote && !inDoubleQuote) {
      if (char === '(' || char === '[') parenCount++;
      if (char === ')' || char === ']') parenCount--;
      if (parenCount < 0) {
        return { valid: false, error: 'Syntax error: Unmatched closing bracket/parenthesis.' };
      }
    }
  }
  if (parenCount !== 0) {
    return { valid: false, error: 'Syntax error: Unbalanced brackets or parentheses.' };
  }
  if (inSingleQuote || inDoubleQuote) {
    return { valid: false, error: 'Syntax error: Unclosed quotation mark.' };
  }

  const statements = clean.split(';').map((s) => s.trim()).filter(Boolean);
  if (statements.length > 1) {
    return { valid: false, error: 'Multiple SQL statements are not allowed. Please submit one operation at a time.' };
  }

  const stmt = statements[0];
  const firstWordMatch = stmt.match(/^(\w+)\b/i);
  if (!firstWordMatch) {
    return { valid: false, error: 'Invalid SQL statement format.' };
  }

  const firstWord = firstWordMatch[1].toUpperCase();
  if (!ALLOWED_WRITE_OPERATIONS.has(firstWord)) {
    return { valid: false, error: `Write mode: Only SELECT, INSERT, UPDATE, and DELETE are allowed. Found "${firstWord}".` };
  }

  return { valid: true };
}

// ══════════════════════════════════════════════
// ─── Layer 2: Schema Validation ──────────────
// ══════════════════════════════════════════════

/**
 * Validates that all referenced tables and columns exist in schema.
 *
 * @param {string} query
 * @param {object} schema - { tables: {}, relationships: [] }
 * @param {string} [dbType='postgres']
 * @returns {{ valid: boolean, error?: string }}
 */
function validateSchema(query, schema, dbType = 'postgres') {
  if (!schema || !schema.tables) return { valid: true };

  const clean = stripComments(query);
  const knownTables = new Set(Object.keys(schema.tables).map((t) => t.toLowerCase()));

  if (dbType === 'mongodb' || clean.startsWith('db.')) {
    const match = clean.match(/^db\.([a-zA-Z0-9_]+)\./);
    if (match) {
      const coll = match[1].toLowerCase();
      if (!knownTables.has(coll)) {
        return {
          valid: false,
          error: `Collection "${match[1]}" does not exist in your database. Available collections: ${Array.from(knownTables).join(', ')}.`,
        };
      }
    }
    return { valid: true };
  }

  // Relational SQL Table Checks
  const referencedTables = extractAllTableReferences(clean);
  for (const tbl of referencedTables) {
    if (!knownTables.has(tbl.toLowerCase())) {
      return {
        valid: false,
        error: `Table "${tbl}" is not recognized in your database. Available tables: ${Array.from(knownTables).join(', ')}.`,
      };
    }
  }

  // Column verification for qualified columns: e.g. table.col or alias.col
  const qualifiedColRegex = /(?:["`]?([a-zA-Z0-9_]+)["`]?)\.(?:["`]?([a-zA-Z0-9_]+)["`]?)/g;
  let colMatch;
  while ((colMatch = qualifiedColRegex.exec(clean)) !== null) {
    const prefix = colMatch[1].toLowerCase();
    const colName = colMatch[2].toLowerCase();

    // Skip special aliases or keywords
    if (['db', 'public', 'avg', 'sum', 'count', 'min', 'max'].includes(prefix)) continue;

    // If prefix is a known table name, verify column exists on it
    if (knownTables.has(prefix)) {
      const tableInfo = schema.tables[prefix] || Object.values(schema.tables).find((_, idx) => Object.keys(schema.tables)[idx].toLowerCase() === prefix);
      if (tableInfo && tableInfo.columns) {
        const colExists = Object.keys(tableInfo.columns).some((c) => c.toLowerCase() === colName);
        if (!colExists && colName !== '*') {
          return {
            valid: false,
            error: `Column "${colMatch[2]}" does not exist on table "${colMatch[1]}".`,
          };
        }
      }
    }
  }

  return { valid: true };
}

// ══════════════════════════════════════════════
// ─── Layer 3: Security Validation ────────────
// ══════════════════════════════════════════════

/**
 * Validates read-only execution, destructive query prevention, and function blocking.
 *
 * @param {string} query
 * @param {string} [dbType='postgres']
 * @returns {{ valid: boolean, error?: string }}
 */
function validateSecurity(query, dbType = 'postgres') {
  const clean = stripComments(query);
  const lower = clean.toLowerCase();

  // 1. MongoDB Security
  if (dbType === 'mongodb' || clean.startsWith('db.')) {
    for (const op of FORBIDDEN_MONGO_OPS) {
      const regex = new RegExp(`\\.${op}\\b`, 'i');
      if (regex.test(clean)) {
        return {
          valid: false,
          error: `Security restriction: Mutation operation "${op}" is not allowed. Only read-only operations (find, aggregate, count) are permitted.`,
        };
      }
    }

    if (lower.includes('$out') || lower.includes('$merge')) {
      return {
        valid: false,
        error: 'Security restriction: Aggregation export stages ($out, $merge) are not permitted.',
      };
    }

    if (lower.includes('$where') || lower.includes('mapreduce')) {
      return {
        valid: false,
        error: 'Security restriction: Arbitrary code execution ($where, mapReduce) is not permitted.',
      };
    }

    return { valid: true };
  }

  // 2. Relational SQL Security
  // Multiple statements check
  const statements = clean.split(';').map((s) => s.trim()).filter(Boolean);
  if (statements.length > 1) {
    return {
      valid: false,
      error: 'Security restriction: Only read-only SELECT queries are allowed. Modification operations are not permitted.',
    };
  }

  const stmt = statements[0] || clean;

  // Enforce SELECT / WITH (read-only mode)
  const firstWordMatch = stmt.match(/^(\w+)\b/i);
  const firstWord = firstWordMatch ? firstWordMatch[1].toUpperCase() : '';
  if (firstWord !== 'SELECT' && firstWord !== 'WITH') {
    return {
      valid: false,
      error: 'Security restriction: Only read-only SELECT queries are allowed. Modification operations are not permitted.',
    };
  }

  // Forbidden DDL / DML operations anywhere in statement
  for (const op of FORBIDDEN_OPERATIONS) {
    const dangerousRegex = new RegExp(
      `\\b${op}\\s+(TABLE|INTO|FROM|SET|DATABASE|INDEX|SCHEMA|FUNCTION|VIEW)\\b`,
      'i'
    );
    if (dangerousRegex.test(stmt) || (new RegExp(`^${op}\\b`, 'i').test(stmt))) {
      return {
        valid: false,
        error: `Security restriction: Only read-only SELECT queries are allowed. Modification operations are not permitted.`,
      };
    }
  }

  // System catalogs protection
  for (const pattern of SYSTEM_CATALOG_PATTERNS) {
    if (pattern.test(stmt)) {
      return {
        valid: false,
        error: 'Security restriction: Access to system catalogs is not permitted.',
      };
    }
  }

  // Block dangerous database-specific functions
  const funcsToBlock = [
    ...(DANGEROUS_FUNCTIONS[dbType] || []),
    ...(DANGEROUS_FUNCTIONS.postgres),
    ...(DANGEROUS_FUNCTIONS.mysql),
    ...(DANGEROUS_FUNCTIONS.sqlite),
  ];

  for (const fn of funcsToBlock) {
    const fnRegex = new RegExp(`\\b${fn}\\s*\\(`, 'i');
    if (fnRegex.test(stmt) || lower.includes(fn.toLowerCase())) {
      return {
        valid: false,
        error: `Security restriction: Dangerous function or keyword "${fn}" is blocked.`,
      };
    }
  }

  return { valid: true };
}

// ══════════════════════════════════════════════
// ─── Unified 3-Layer Validation Pipeline ─────
// ══════════════════════════════════════════════

/**
 * Universal 3-layer validator for SQL and MQL queries.
 *
 * @param {string} query
 * @param {object} [schema=null]
 * @param {string} [dbType='postgres']
 * @param {string} [mode='read'] - 'read' (SELECT only) or 'write' (SELECT+INSERT+UPDATE+DELETE)
 * @returns {{ valid: boolean, layer?: number, error?: string }}
 */
function sqlHasWhereClause(sql) {
  const withoutLiterals = String(sql || '')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""');
  return /\bWHERE\b/i.test(withoutLiterals);
}

function validateQuery(query, schema = null, dbType = 'postgres', mode = 'read', options = {}) {
  if (mode === 'write') {
    return validateQueryWrite(query, schema, dbType, options);
  }
  if (mode === 'ddl') {
    return validateQueryDDL(query, schema, dbType);
  }

  // Layer 1: Syntax
  const syntaxCheck = validateSyntax(query, dbType);
  if (!syntaxCheck.valid) {
    return { valid: false, layer: 1, error: syntaxCheck.error };
  }

  // Layer 2: Schema
  if (schema) {
    const schemaCheck = validateSchema(query, schema, dbType);
    if (!schemaCheck.valid) {
      return { valid: false, layer: 2, error: schemaCheck.error };
    }
  }

  // Layer 3: Security
  const securityCheck = validateSecurity(query, dbType);
  if (!securityCheck.valid) {
    return { valid: false, layer: 3, error: securityCheck.error };
  }

  return { valid: true };
}

/**
 * Write-mode validation: allows SELECT + DML (INSERT/UPDATE/DELETE) but blocks DDL.
 */
function validateQueryWrite(query, schema, dbType, options = {}) {
  const clean = stripComments(query || '');

  // Multi-statement block
  const stmts = clean.split(';').map((s) => s.trim()).filter(Boolean);
  if (stmts.length > 1) {
    return { valid: false, layer: 1, error: 'Multiple SQL statements are not allowed. Submit one operation at a time.' };
  }

  const stmt = stmts[0] || clean;
  const firstWordMatch = stmt.match(/^(\w+)\b/i);
  const firstWord = firstWordMatch ? firstWordMatch[1].toUpperCase() : '';

  if (!ALLOWED_WRITE_OPERATIONS.has(firstWord)) {
    return { valid: false, layer: 1, error: `Only SELECT, INSERT, UPDATE, and DELETE are allowed. Found "${firstWord}".` };
  }

  // DDL block
  for (const op of FORBIDDEN_DDL_OPERATIONS) {
    if (new RegExp(`\\b${op}\\b`, 'i').test(stmt)) {
      return {
        valid: false,
        layer: 3,
        error: `Security restriction: "${op}" is not permitted. Only SELECT, INSERT, UPDATE, and DELETE are allowed.`,
      };
    }
  }

  // System catalogs
  for (const pattern of SYSTEM_CATALOG_PATTERNS) {
    if (pattern.test(stmt)) {
      return { valid: false, layer: 3, error: 'Security restriction: Access to system catalogs is not permitted.' };
    }
  }

  // Dangerous functions
  const allDangerousFuncs = [
    ...(DANGEROUS_FUNCTIONS[dbType] || []),
    ...DANGEROUS_FUNCTIONS.postgres,
    ...DANGEROUS_FUNCTIONS.mysql,
    ...DANGEROUS_FUNCTIONS.sqlite,
  ];
  for (const fn of allDangerousFuncs) {
    if (new RegExp(`\\b${fn}\\s*\\(`, 'i').test(stmt) || stmt.toLowerCase().includes(fn.toLowerCase())) {
      return { valid: false, layer: 3, error: `Security restriction: Dangerous function "${fn}" is blocked.` };
    }
  }

  // Schema validation for write operations
  if (schema && schema.tables) {
    const knownTables = new Set(Object.keys(schema.tables).map((t) => t.toLowerCase()));
    let targetTable = null;
    if (firstWord === 'INSERT') {
      const m = stmt.match(/INSERT\s+INTO\s+["`]?([a-zA-Z0-9_]+)["`]?/i);
      if (m) targetTable = m[1];
    } else if (firstWord === 'UPDATE') {
      const m = stmt.match(/UPDATE\s+["`]?([a-zA-Z0-9_]+)["`]?\b/i);
      if (m) targetTable = m[1];
    } else if (firstWord === 'DELETE') {
      const m = stmt.match(/DELETE\s+FROM\s+["`]?([a-zA-Z0-9_]+)["`]?/i);
      if (m) targetTable = m[1];
    } else if (firstWord === 'SELECT') {
      // Re-use existing schema check for SELECT
      const schemaCheck = validateSchema(query, schema, dbType);
      if (!schemaCheck.valid) return { valid: false, layer: 2, error: schemaCheck.error };
    }
    if (targetTable && !knownTables.has(targetTable.toLowerCase())) {
      return {
        valid: false,
        layer: 2,
        error: `Table "${targetTable}" does not exist. Available tables: ${Array.from(knownTables).join(', ')}.`,
      };
    }
  }

  if ((firstWord === 'UPDATE' || firstWord === 'DELETE') && !sqlHasWhereClause(stmt) && !options.allowMass) {
    return {
      valid: false,
      layer: 3,
      error: `${firstWord} without a WHERE clause is not allowed. Name the rows to change, or explicitly request a mass ${firstWord.toLowerCase()}.`,
    };
  }

  return { valid: true };
}

const ALLOWED_DDL_OPS = new Set(['CREATE', 'ALTER', 'DROP', 'TRUNCATE']);

/**
 * DDL-mode validation: allows CREATE, ALTER, DROP, TRUNCATE with strict safety checks.
 */
function validateQueryDDL(query, schema, dbType = 'postgres') {
  const clean = stripComments(query || '');

  // Check balanced parentheses & quotes
  let parenCount = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  for (let i = 0; i < clean.length; i++) {
    const char = clean[i];
    if (char === "'" && clean[i - 1] !== '\\') {
      if (!inDoubleQuote) inSingleQuote = !inSingleQuote;
    } else if (char === '"' && clean[i - 1] !== '\\') {
      if (!inSingleQuote) inDoubleQuote = !inDoubleQuote;
    } else if (!inSingleQuote && !inDoubleQuote) {
      if (char === '(' || char === '[') parenCount++;
      if (char === ')' || char === ']') parenCount--;
      if (parenCount < 0) {
        return { valid: false, layer: 1, error: 'Syntax error: Unmatched closing bracket/parenthesis.' };
      }
    }
  }
  if (parenCount !== 0) {
    return { valid: false, layer: 1, error: 'Syntax error: Unbalanced brackets or parentheses.' };
  }
  if (inSingleQuote || inDoubleQuote) {
    return { valid: false, layer: 1, error: 'Syntax error: Unclosed quotation mark.' };
  }

  // Multi-statement block: never allow multiple statements in one DDL call
  const stmts = clean.split(';').map((s) => s.trim()).filter(Boolean);
  if (stmts.length > 1) {
    return { valid: false, layer: 1, error: 'Multiple SQL statements are not allowed. Submit one DDL operation at a time.' };
  }

  const stmt = stmts[0] || clean;
  const firstWordMatch = stmt.match(/^(\w+)\b/i);
  const firstWord = firstWordMatch ? firstWordMatch[1].toUpperCase() : '';

  if (!ALLOWED_DDL_OPS.has(firstWord)) {
    return { valid: false, layer: 1, error: `Only CREATE, ALTER, DROP, and TRUNCATE are allowed in DDL mode. Found "${firstWord}".` };
  }

  // System catalogs protection (e.g. DROP TABLE pg_shadow is completely blocked!)
  for (const pattern of SYSTEM_CATALOG_PATTERNS) {
    if (pattern.test(stmt)) {
      return { valid: false, layer: 3, error: 'Security restriction: Access to or modification of system catalogs is strictly prohibited.' };
    }
  }

  // Block dangerous database-specific functions
  const allDangerousFuncs = [
    ...(DANGEROUS_FUNCTIONS[dbType] || []),
    ...DANGEROUS_FUNCTIONS.postgres,
    ...DANGEROUS_FUNCTIONS.mysql,
    ...DANGEROUS_FUNCTIONS.sqlite,
  ];
  for (const fn of allDangerousFuncs) {
    if (new RegExp(`\\b${fn}\\s*\\(`, 'i').test(stmt) || stmt.toLowerCase().includes(fn.toLowerCase())) {
      return { valid: false, layer: 3, error: `Security restriction: Dangerous function "${fn}" is blocked.` };
    }
  }

  return { valid: true };
}

/**
 * Legacy compatibility functions
 */
function validateSQL(sql, schema = null) {
  return validateQuery(sql, schema, 'postgres');
}

function validateMongoQuery(query, schema = null) {
  return validateQuery(query, schema, 'mongodb');
}

module.exports = {
  validateSyntax,
  validateSyntaxWrite,
  validateSchema,
  validateSecurity,
  validateQuery,
  validateQueryWrite,
  validateQueryDDL,
  validateSQL,
  validateMongoQuery,
  sqlHasWhereClause,
  extractAllTableReferences,
};
