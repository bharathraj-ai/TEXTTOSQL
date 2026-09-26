// ============================================
// Schema Service — Auto-discover Database Schema
// ============================================
// Queries PostgreSQL information_schema to automatically
// discover tables, columns, data types, PKs, FKs, and
// relationships. Caches results in memory.
//
// Day 3: Added getSchemaSummary(), getRelevantSchema(),
// and generateSuggestions() for schema-aware AI queries.

const pool = require('../db/database');

// In-memory cache keyed by userId or 'default'
const schemaCache = new Map();

/**
 * Retrieve the full database schema from PostgreSQL metadata.
 * Caches the result in memory for subsequent calls.
 *
 * @param {boolean} forceRefresh - Force a fresh query instead of using cache
 * @param {object} [targetPool] - Specific database pool to inspect
 * @param {number|string} [userId] - User ID for caching
 * @returns {Promise<{ tables: object, relationships: object[] }>}
 */
async function getDatabaseSchema(forceRefresh = false, targetPool = null, userId = null) {
  const cacheKey = userId ? String(userId) : 'default';

  if (!forceRefresh && schemaCache.has(cacheKey)) {
    return schemaCache.get(cacheKey);
  }

  // Check if targetPool is an adapter implementing discoverSchema
  if (targetPool && typeof targetPool.discoverSchema === 'function') {
    console.log(`[SCHEMA] Discovering database schema via adapter for [${cacheKey}]...`);
    const schema = await targetPool.discoverSchema();
    if (!schema.tables) schema.tables = {};
    if (!schema.relationships) schema.relationships = [];
    schemaCache.set(cacheKey, schema);
    const tableNames = Object.keys(schema.tables);
    console.log(`[SCHEMA] Discovered ${tableNames.length} tables/collections for [${cacheKey}]: ${tableNames.join(', ')}`);
    console.log(`[SCHEMA] Discovered ${schema.relationships.length} relationships`);
    return schema;
  }

  const queryPool = targetPool || pool;
  console.log(`[SCHEMA] Discovering database schema for [${cacheKey}]...`);

  const schema = {
    tables: {},
    relationships: [],
  };

  // ── 1. Discover tables and columns ──────────────────
  const columnsResult = await queryPool.query(`
    SELECT
      t.table_name,
      c.column_name,
      c.data_type,
      c.is_nullable,
      c.column_default
    FROM information_schema.tables t
    JOIN information_schema.columns c
      ON t.table_name = c.table_name
      AND t.table_schema = c.table_schema
    WHERE t.table_schema = 'public'
      AND t.table_type = 'BASE TABLE'
    ORDER BY t.table_name, c.ordinal_position;
  `);

  for (const row of columnsResult.rows) {
    const tableName = row.table_name;

    if (!schema.tables[tableName]) {
      schema.tables[tableName] = {
        columns: {},
        primaryKeys: [],
      };
    }

    schema.tables[tableName].columns[row.column_name] = row.data_type;
  }

  // ── 2. Discover primary keys ────────────────────────
  const pkResult = await queryPool.query(`
    SELECT
      tc.table_name,
      kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    WHERE tc.table_schema = 'public'
      AND tc.constraint_type = 'PRIMARY KEY'
    ORDER BY tc.table_name, kcu.ordinal_position;
  `);

  for (const row of pkResult.rows) {
    if (schema.tables[row.table_name]) {
      schema.tables[row.table_name].primaryKeys.push(row.column_name);
    }
  }

  // ── 3. Discover foreign key relationships ───────────
  const fkResult = await queryPool.query(`
    SELECT
      kcu.table_name AS from_table,
      kcu.column_name AS from_column,
      ccu.table_name AS to_table,
      ccu.column_name AS to_column
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON tc.constraint_name = ccu.constraint_name
      AND tc.table_schema = ccu.table_schema
    WHERE tc.table_schema = 'public'
      AND tc.constraint_type = 'FOREIGN KEY';
  `);

  for (const row of fkResult.rows) {
    schema.relationships.push({
      from: `${row.from_table}.${row.from_column}`,
      to: `${row.to_table}.${row.to_column}`,
    });
  }

  // ── Cache and log ───────────────────────────────────
  schemaCache.set(cacheKey, schema);

  const tableNames = Object.keys(schema.tables);
  console.log(`[SCHEMA] Discovered ${tableNames.length} tables for [${cacheKey}]: ${tableNames.join(', ')}`);
  console.log(`[SCHEMA] Discovered ${schema.relationships.length} relationships`);

  return schema;
}

function invalidateUserSchemaCache(userId) {
  const cacheKey = userId ? String(userId) : 'default';
  schemaCache.delete(cacheKey);
  console.log(`[SCHEMA] Invalidated schema cache for [${cacheKey}]`);
}

/**
 * Get a flat list of table names from the schema.
 * @returns {Promise<string[]>}
 */
async function getTableNames() {
  const schema = await getDatabaseSchema();
  return Object.keys(schema.tables);
}

/**
 * Get column names for a specific table.
 * @param {string} tableName
 * @returns {Promise<string[]>}
 */
async function getColumnNames(tableName) {
  const schema = await getDatabaseSchema();
  if (!schema.tables[tableName]) return [];
  return Object.keys(schema.tables[tableName].columns);
}

/**
 * Build a formatted schema string for prompt context.
 * @returns {Promise<string>}
 */
async function getSchemaPromptText() {
  const schema = await getDatabaseSchema();
  return formatSchemaForPrompt(schema);
}

// ══════════════════════════════════════════════
// ─── Day 3: Schema Summary ─────────────────
// ══════════════════════════════════════════════

/**
 * Generate a compact, LLM-friendly schema summary.
 * Includes PK/FK annotations for each column.
 *
 * Example output:
 *   TABLE customers
 *   Columns:
 *   - id: integer [PK]
 *   - name: character varying
 *   - email: character varying
 *
 * @param {object} schema - Full schema object (or will be fetched)
 * @returns {string}
 */
function formatSchemaForPrompt(schema) {
  if (!schema || !schema.tables) return '';

  // Build FK lookup: "table.column" → "target_table.target_column"
  const fkLookup = {};
  for (const rel of schema.relationships) {
    fkLookup[rel.from] = rel.to;
  }

  let text = '';

  for (const [tableName, tableInfo] of Object.entries(schema.tables)) {
    text += `TABLE ${tableName}\nColumns:\n`;

    for (const [colName, colType] of Object.entries(tableInfo.columns)) {
      const annotations = [];
      if (tableInfo.primaryKeys.includes(colName)) {
        annotations.push('PK');
      }
      const fkKey = `${tableName}.${colName}`;
      if (fkLookup[fkKey]) {
        annotations.push(`FK → ${fkLookup[fkKey]}`);
      }

      const tag = annotations.length > 0 ? ` [${annotations.join(', ')}]` : '';
      text += `- ${colName}: ${colType}${tag}\n`;
    }

    text += '\n';
  }

  if (schema.relationships.length > 0) {
    text += 'Relationships:\n';
    for (const rel of schema.relationships) {
      text += `  ${rel.from} → ${rel.to}\n`;
    }
  }

  return text.trim();
}

/**
 * Get a compact schema summary for a user's connected database.
 *
 * @param {number|string} [userId]
 * @param {object} [targetPool]
 * @returns {Promise<string>}
 */
async function getSchemaSummary(userId = null, targetPool = null) {
  const schema = await getDatabaseSchema(false, targetPool, userId);
  return formatSchemaForPrompt(schema);
}

// ══════════════════════════════════════════════
// ─── Day 3: Relevant Schema Selection ───────
// ══════════════════════════════════════════════

/**
 * Given a natural-language question and the full schema,
 * select only the tables that are likely relevant.
 *
 * Uses keyword/table-name matching + FK relationship traversal.
 * If no tables match, returns the full schema (safer fallback).
 *
 * @param {string} question
 * @param {object} fullSchema
 * @returns {object} - Filtered schema { tables, relationships }
 */
function getRelevantSchema(question, fullSchema) {
  if (!fullSchema || !fullSchema.tables) return fullSchema;

  const q = question.toLowerCase();
  const matchedTables = new Set();
  const tableNames = Object.keys(fullSchema.tables);

  // ── 1. Direct table name matching ───────────────────
  for (const table of tableNames) {
    const singular = table.replace(/s$/, '').replace(/ies$/, 'y').replace(/es$/, '');
    if (q.includes(table.toLowerCase()) || q.includes(singular.toLowerCase())) {
      matchedTables.add(table);
    }
  }

  // ── 2. Column name matching (for ambiguous queries) ──
  for (const [table, info] of Object.entries(fullSchema.tables)) {
    for (const col of Object.keys(info.columns)) {
      // Match meaningful column names (skip id, created_at, etc.)
      if (col.length > 3 && !['created_at', 'updated_at'].includes(col)) {
        const colWords = col.split('_');
        for (const word of colWords) {
          if (word.length > 3 && q.includes(word)) {
            matchedTables.add(table);
          }
        }
      }
    }
  }

  // ── 3. FK relationship traversal ────────────────────
  // If we matched "orders", also include "customers" if orders.customer_id → customers.id
  const additionalTables = new Set();
  for (const rel of fullSchema.relationships) {
    const [fromTable] = rel.from.split('.');
    const [toTable] = rel.to.split('.');
    if (matchedTables.has(fromTable) && !matchedTables.has(toTable)) {
      additionalTables.add(toTable);
    }
    if (matchedTables.has(toTable) && !matchedTables.has(fromTable)) {
      additionalTables.add(fromTable);
    }
  }
  for (const t of additionalTables) {
    matchedTables.add(t);
  }

  // ── 4. Fallback: return full schema if nothing matched ──
  if (matchedTables.size === 0) {
    return fullSchema;
  }

  // ── 5. Build filtered schema ────────────────────────
  const filtered = {
    tables: {},
    relationships: [],
  };

  for (const table of matchedTables) {
    if (fullSchema.tables[table]) {
      filtered.tables[table] = fullSchema.tables[table];
    }
  }

  for (const rel of fullSchema.relationships) {
    const [fromTable] = rel.from.split('.');
    const [toTable] = rel.to.split('.');
    if (matchedTables.has(fromTable) || matchedTables.has(toTable)) {
      filtered.relationships.push(rel);
    }
  }

  console.log(`[SCHEMA] Relevant tables for question: ${Array.from(matchedTables).join(', ')}`);
  return filtered;
}

module.exports = {
  getDatabaseSchema,
  getTableNames,
  getColumnNames,
  getSchemaPromptText,
  invalidateUserSchemaCache,
  getSchemaSummary,
  getRelevantSchema,
  formatSchemaForPrompt,
};
