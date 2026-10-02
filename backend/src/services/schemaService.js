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
        nullable: {},
        defaults: {},
        identity: {},
        primaryKeys: [],
      };
    }

    schema.tables[tableName].columns[row.column_name] = row.data_type;
    schema.tables[tableName].nullable[row.column_name] = row.is_nullable === 'YES';
    if (row.column_default) {
      schema.tables[tableName].defaults[row.column_name] = row.column_default;
      if (/nextval|identity/i.test(row.column_default)) {
        schema.tables[tableName].identity[row.column_name] = true;
      }
    }
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

const GENERIC_COLUMN_WORDS = new Set([
  'name', 'names', 'id', 'ids', 'status', 'created', 'updated', 'date', 'dates',
  'type', 'types', 'email', 'description', 'value', 'data', 'time', 'user', 'users',
]);

const QUESTION_STOPWORDS = new Set([
  'show', 'list', 'find', 'get', 'fetch', 'display', 'select', 'all', 'the', 'a', 'an',
  'me', 'my', 'of', 'in', 'on', 'for', 'with', 'from', 'please', 'what', 'is', 'are',
  'how', 'many', 'there', 'do', 'does', 'i', 'you', 'your', 'database', 'table', 'tables',
  'duplicate', 'duplicates', 'each', 'every', 'above', 'below', 'than', 'and', 'or', 'to',
  'into', 'where', 'who', 'which', 'their', 'this', 'that',
]);

function singularizeWord(word) {
  if (word.endsWith('ies') && word.length > 4) return `${word.slice(0, -3)}y`;
  if (/(sses|xes|zes|ches|shes)$/.test(word) && word.length > 4) return word.slice(0, -2);
  if (word.endsWith('s') && !word.endsWith('ss') && word.length > 3) return word.slice(0, -1);
  return word;
}

function pluralizeWord(word) {
  if (word.endsWith('y') && !/[aeiou]y$/.test(word)) return `${word.slice(0, -1)}ies`;
  if (/(s|x|z|ch|sh)$/.test(word)) return `${word}es`;
  if (word.endsWith('s')) return word;
  return `${word}s`;
}

function normalizeQuestion(question) {
  return String(question || '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function containsPhrase(text, phrase) {
  if (!text || !phrase) return false;
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|\\s)${escaped}(?:\\s|$)`).test(text);
}

function nameForms(name) {
  const spaced = String(name || '').replace(/[_-]+/g, ' ').toLowerCase().trim();
  const parts = spaced.split(/\s+/).filter(Boolean);
  const forms = new Set([spaced, spaced.replace(/\s+/g, '')]);
  if (parts.length) {
    const last = parts[parts.length - 1];
    const singular = singularizeWord(last);
    const plural = pluralizeWord(last);
    if (singular !== last) {
      const next = parts.slice(0, -1).concat(singular).join(' ');
      forms.add(next);
      forms.add(next.replace(/\s+/g, ''));
    }
    if (plural !== last) {
      const next = parts.slice(0, -1).concat(plural).join(' ');
      forms.add(next);
      forms.add(next.replace(/\s+/g, ''));
    }
  }
  return [...forms].filter((form) => form.length >= 3);
}

function isGeneralSchemaQuestion(question) {
  const q = normalizeQuestion(question);
  if (/\bwhat tables\b/.test(q) || /\bwhich tables\b/.test(q) || /\blist tables\b/.test(q) || /\bshow tables\b/.test(q)) {
    return true;
  }
  if (/\b(database|schema) structure\b/.test(q) || /\bshow me the database structure\b/.test(q)) {
    return true;
  }
  if (/\brelationships?\b/.test(q) && /\b(tables|database|schema)\b/.test(q)) {
    return true;
  }
  return false;
}

function tableWordForms(tableNames) {
  const forms = new Set();
  for (const table of tableNames) {
    for (const part of String(table).toLowerCase().split(/[_-]+/)) {
      if (part.length < 3) continue;
      forms.add(part);
      forms.add(singularizeWord(part));
      forms.add(pluralizeWord(part));
    }
  }
  return forms;
}

function relationshipEnds(rel) {
  return [String(rel.from || '').split('.')[0], String(rel.to || '').split('.')[0]];
}

function expandRelatedTables(primaryTables, relationships = []) {
  const primarySet = new Set(primaryTables);
  const related = new Set();
  const neighborsOf = (table) => {
    const neighbors = [];
    for (const rel of relationships) {
      const [fromTable, toTable] = relationshipEnds(rel);
      if (fromTable === table && toTable && !primarySet.has(toTable)) neighbors.push(toTable);
      if (toTable === table && fromTable && !primarySet.has(fromTable)) neighbors.push(fromTable);
    }
    return neighbors;
  };

  for (const table of primaryTables) {
    for (const neighbor of neighborsOf(table)) related.add(neighbor);
  }

  const junctions = [...related].filter((table) => {
    const ends = new Set();
    for (const rel of relationships) {
      const [fromTable, toTable] = relationshipEnds(rel);
      if (fromTable === table && toTable) ends.add(toTable);
      if (toTable === table && fromTable) ends.add(fromTable);
    }
    return ends.size >= 2;
  });

  for (const table of junctions) {
    for (const neighbor of neighborsOf(table)) related.add(neighbor);
  }

  for (const table of primaryTables) related.delete(table);
  return [...related];
}

function filterSchema(fullSchema, tableNames) {
  const selected = new Set(tableNames);
  const filtered = { tables: {}, relationships: [] };
  for (const table of selected) {
    if (fullSchema.tables[table]) filtered.tables[table] = fullSchema.tables[table];
  }
  for (const rel of fullSchema.relationships || []) {
    const [fromTable, toTable] = relationshipEnds(rel);
    if (selected.has(fromTable) || selected.has(toTable)) filtered.relationships.push(rel);
  }
  return filtered;
}

function requestedPhrase(question) {
  const tokens = normalizeQuestion(question)
    .split(' ')
    .filter((token) => token && !QUESTION_STOPWORDS.has(token) && token.length > 2);
  return tokens.join(' ');
}

function emptyRetrieval(status, extra = {}) {
  return {
    status,
    confidence: 0,
    matchedTables: [],
    relatedTables: [],
    requestedEntities: [],
    ambiguous: status === 'AMBIGUOUS',
    reason: '',
    message: '',
    options: [],
    tables: {},
    relationships: [],
    ...extra,
  };
}

/**
 * Score a question against the live schema.
 * Table-name matches outrank column matches. Foreign keys expand only
 * after a primary table is identified. A miss does not return every table.
 *
 * @param {string} question
 * @param {object} fullSchema
 * @returns {object}
 */
function getRelevantSchema(question, fullSchema) {
  if (!fullSchema || !fullSchema.tables) {
    return emptyRetrieval('NOT_FOUND', {
      reason: 'No schema is available.',
      message: 'No database schema is available for this question.',
    });
  }

  const tableNames = Object.keys(fullSchema.tables);
  const normalized = normalizeQuestion(question);

  if (isGeneralSchemaQuestion(question)) {
    return {
      status: 'GENERAL_SCHEMA',
      confidence: 1,
      matchedTables: tableNames,
      relatedTables: [],
      requestedEntities: [],
      ambiguous: false,
      reason: 'The question asks about the database structure.',
      message: '',
      options: [],
      tables: fullSchema.tables,
      relationships: fullSchema.relationships || [],
    };
  }

  const knownTableWords = tableWordForms(tableNames);
  const scores = {};
  const reasons = {};
  const genericHits = {};

  const note = (table, points, reason) => {
    scores[table] = (scores[table] || 0) + points;
    if (!reasons[table]) reasons[table] = [];
    reasons[table].push(reason);
  };

  for (const table of tableNames) {
    const spaced = table.toLowerCase().replace(/[_-]+/g, ' ');
    const compact = spaced.replace(/\s+/g, '');
    const exact = containsPhrase(normalized, spaced) || containsPhrase(normalized.replace(/\s+/g, ''), compact);
    if (exact) {
      note(table, 100, `table "${table}"`);
      continue;
    }
    const normalizedHit = nameForms(table).some((form) => containsPhrase(normalized, form));
    if (normalizedHit) note(table, 90, `normalized table "${table}"`);
  }

  for (const [table, info] of Object.entries(fullSchema.tables)) {
    for (const column of Object.keys(info.columns || {})) {
      const columnName = column.toLowerCase();
      if (columnName === 'id' || columnName === 'created_at' || columnName === 'updated_at') continue;
      const columnPhrase = columnName.replace(/[_-]+/g, ' ');
      const words = columnPhrase.split(' ').filter((word) => word.length > 3);
      const genericColumn = words.length > 0 && words.every((word) => GENERIC_COLUMN_WORDS.has(word) || GENERIC_COLUMN_WORDS.has(singularizeWord(word)));

      if (!genericColumn && (containsPhrase(normalized, columnPhrase) || containsPhrase(normalized, pluralizeWord(columnPhrase)))) {
        note(table, 40, `column "${column}"`);
        continue;
      }

      for (const word of words) {
        const singular = singularizeWord(word);
        const plural = pluralizeWord(word);
        const mentioned = containsPhrase(normalized, word) || containsPhrase(normalized, singular) || containsPhrase(normalized, plural);
        if (!mentioned) continue;
        if (knownTableWords.has(word) || knownTableWords.has(singular)) continue;
        if (GENERIC_COLUMN_WORDS.has(word) || GENERIC_COLUMN_WORDS.has(singular)) {
          note(table, 5, `generic column "${word}"`);
          if (!genericHits[singular]) genericHits[singular] = new Set();
          genericHits[singular].add(table);
        } else {
          note(table, 30, `column word "${word}"`);
        }
      }
    }
  }

  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const tableLevel = ranked.filter(([, score]) => score >= 90);
  const strongColumn = ranked.filter(([, score]) => score >= 30 && score < 90);

  if (tableLevel.length > 0) {
    const primary = tableLevel.map(([table]) => table);
    const related = expandRelatedTables(primary, fullSchema.relationships || []);
    const filtered = filterSchema(fullSchema, [...primary, ...related]);
    const confidence = tableLevel[0][1] >= 100 ? 0.95 : 0.92;
    console.log(`[SCHEMA] FOUND ${primary.join(', ')} related ${related.join(', ') || '(none)'}`);
    return {
      status: 'FOUND',
      confidence,
      matchedTables: primary,
      relatedTables: related,
      requestedEntities: primary,
      ambiguous: false,
      reason: reasons[primary[0]]?.[0] || 'Table match',
      message: '',
      options: [],
      tables: filtered.tables,
      relationships: filtered.relationships,
    };
  }

  if (strongColumn.length === 1) {
    const [table] = strongColumn[0];
    const related = expandRelatedTables([table], fullSchema.relationships || []);
    const filtered = filterSchema(fullSchema, [table, ...related]);
    console.log(`[SCHEMA] FOUND ${table} via column`);
    return {
      status: 'FOUND',
      confidence: strongColumn[0][1] >= 40 ? 0.8 : 0.7,
      matchedTables: [table],
      relatedTables: related,
      requestedEntities: [table],
      ambiguous: false,
      reason: reasons[table]?.[0] || 'Column match',
      message: '',
      options: [],
      tables: filtered.tables,
      relationships: filtered.relationships,
    };
  }

  if (strongColumn.length > 1) {
    const names = strongColumn.map(([table]) => table);
    const label = reasons[names[0]]?.find((item) => item.startsWith('column')) || 'column';
    return emptyRetrieval('AMBIGUOUS', {
      confidence: 0.42,
      matchedTables: names,
      requestedEntities: [label.replace(/^(column word|column) "/, '').replace(/"$/, '')],
      reason: `Column match is shared by ${names.join(', ')}`,
      message: `That request matches more than one table: ${names.join(', ')}. Which table should I check?`,
      options: names.map((table) => `${question.trim()} in ${table}`),
    });
  }

  const genericGroups = Object.entries(genericHits).filter(([, tables]) => tables.size > 1);
  if (genericGroups.length > 0) {
    const [word, tables] = genericGroups.sort((a, b) => b[1].size - a[1].size)[0];
    const names = [...tables];
    return emptyRetrieval('AMBIGUOUS', {
      confidence: 0.42,
      matchedTables: names,
      requestedEntities: [word],
      reason: `Column '${word}' exists in multiple tables`,
      message: `The column '${word}' exists in multiple tables. Which table should I check?`,
      options: names.map((table) => `${question.trim()} in ${table}`),
    });
  }

  const phrase = requestedPhrase(question);
  const label = phrase || 'that';
  return emptyRetrieval('NOT_FOUND', {
    requestedEntities: phrase ? [phrase] : [],
    reason: 'No matching table or column entity found',
    message: `I couldn't find a table or entity named '${label}' in the connected database.`,
  });
}

function shouldGenerateSQL(retrieval) {
  return Boolean(retrieval && retrieval.status === 'FOUND' && retrieval.tables && Object.keys(retrieval.tables).length > 0);
}

module.exports = {
  getDatabaseSchema,
  getTableNames,
  getColumnNames,
  getSchemaPromptText,
  invalidateUserSchemaCache,
  getSchemaSummary,
  getRelevantSchema,
  shouldGenerateSQL,
  formatSchemaForPrompt,
};
