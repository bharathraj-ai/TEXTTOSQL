// ============================================
// Query Planner — Day 4 Architectural Component
// ============================================
// Builds a structured, non-executing execution plan for
// any natural-language question against a given schema.
//
// Determines:
//   - Intent (e.g., SELECT_ALL, FILTER, TOP_N, AGGREGATE, GROUP_BY, COUNT, etc.)
//   - Relevant tables / collections
//   - Required columns
//   - Filters
//   - Joins (foreign-key based only)
//   - Aggregations
//   - GroupBy
//   - OrderBy
//   - Limit
//   - Date conditions
//   - Confidence score
//
// The planner MUST NOT execute any queries.

const { classifyIntent } = require('./intentService');

/**
 * Normalizes words by stripping trailing 's', 'es', 'ies'.
 */
function toSingular(word) {
  if (!word || typeof word !== 'string') return '';
  const lower = word.toLowerCase();
  if (lower.endsWith('ies') && lower.length > 3) return lower.slice(0, -3) + 'y';
  if (lower.endsWith('es') && lower.length > 3) return lower.slice(0, -2);
  if (lower.endsWith('s') && !lower.endsWith('ss') && lower.length > 2) return lower.slice(0, -1);
  return lower;
}

/**
 * Escape regex special characters.
 */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Extracts date filter specification from text.
 */
function extractDateCondition(q) {
  if (/\btoday\b/i.test(q)) {
    return { type: 'today', unit: 'day', value: 0 };
  }
  if (/\byesterday\b/i.test(q)) {
    return { type: 'yesterday', unit: 'day', value: 1 };
  }
  const lastDaysMatch = q.match(/\blast\s+(\d+)\s+days?\b/i);
  if (lastDaysMatch) {
    return { type: 'last_n_days', unit: 'day', value: parseInt(lastDaysMatch[1], 10) };
  }
  if (/\blast\s+week\b/i.test(q) || /\blast\s+7\s+days\b/i.test(q)) {
    return { type: 'last_n_days', unit: 'day', value: 7 };
  }
  if (/\blast\s+month\b/i.test(q)) {
    return { type: 'last_month', unit: 'month', value: 1 };
  }
  if (/\bthis\s+month\b/i.test(q)) {
    return { type: 'this_month', unit: 'month', value: 0 };
  }
  if (/\bthis\s+year\b/i.test(q)) {
    return { type: 'this_year', unit: 'year', value: 0 };
  }
  if (/\blast\s+year\b/i.test(q)) {
    return { type: 'last_year', unit: 'year', value: 1 };
  }
  return null;
}

/**
 * Traverses relationships to find foreign key join path between two tables.
 */
function findRelationshipJoin(table1, table2, relationships = []) {
  for (const rel of relationships) {
    const [fromTbl, fromCol] = rel.from.split('.');
    const [toTbl, toCol] = rel.to.split('.');

    if (fromTbl.toLowerCase() === table1.toLowerCase() && toTbl.toLowerCase() === table2.toLowerCase()) {
      return `${fromTbl}.${fromCol} = ${toTbl}.${toCol}`;
    }
    if (fromTbl.toLowerCase() === table2.toLowerCase() && toTbl.toLowerCase() === table1.toLowerCase()) {
      return `${fromTbl}.${fromCol} = ${toTbl}.${toCol}`;
    }
  }

  // Check conventional naming: e.g. orders.customer_id = customers.id
  const sing1 = toSingular(table1);
  const sing2 = toSingular(table2);
  const conv1 = `${table1}.${sing2}_id = ${table2}.id`;
  const conv2 = `${table2}.${sing1}_id = ${table1}.id`;

  return conv1; // fallback conventional assumption
}

/**
 * Creates a formal query plan from a user's question and schema.
 *
 * @param {string} question
 * @param {object} schema - { tables: {}, relationships: [] }
 * @param {string} [dbType='postgres']
 * @returns {object} Query Plan
 */
function createQueryPlan(question, schema, dbType = 'postgres') {
  if (!question || typeof question !== 'string') {
    throw new Error('Valid natural language question is required for planning.');
  }

  const q = question.toLowerCase().trim();
  const allTables = Object.keys(schema?.tables || {});
  const relationships = schema?.relationships || [];

  // 1. Classify intent via intentService
  const intentAnalysis = classifyIntent(question, schema || { tables: {}, relationships: [] });
  const primaryIntents = intentAnalysis.intents || [];

  // 2. Discover referenced tables and columns
  const matchedTables = [];
  const matchedColumns = [];

  for (const tbl of allTables) {
    const singTbl = toSingular(tbl);
    const tblRegex = new RegExp(`\\b(${escapeRegex(tbl)}|${escapeRegex(singTbl)})\\b`, 'i');
    if (tblRegex.test(q)) {
      matchedTables.push(tbl);
    }
  }

  // Scan columns across all tables
  for (const [tblName, tblInfo] of Object.entries(schema?.tables || {})) {
    for (const [colName, colType] of Object.entries(tblInfo.columns || {})) {
      const singCol = toSingular(colName);
      const colReadable = colName.replace(/_/g, ' ');
      const colRegex = new RegExp(`\\b(${escapeRegex(colName)}|${escapeRegex(singCol)}|${escapeRegex(colReadable)})\\b`, 'i');

      if (colRegex.test(q)) {
        matchedColumns.push({
          table: tblName,
          column: colName,
          qualified: `${tblName}.${colName}`,
          type: colType,
        });
        if (!matchedTables.includes(tblName)) {
          matchedTables.push(tblName);
        }
      }
    }
  }

  // Fallback to first table if none detected
  if (matchedTables.length === 0 && allTables.length > 0) {
    matchedTables.push(allTables[0]);
  }

  const primaryTable = matchedTables[0] || (allTables.length > 0 ? allTables[0] : null);

  // 3. Determine primary intent
  let planIntent = 'SELECT_ALL';
  const topMatch = q.match(/\b(?:top|first|highest|best|largest)\s+(\d+)\b/i);
  const bottomMatch = q.match(/\b(?:bottom|last|lowest|worst)\s+(\d+)\b/i);

  if (topMatch || bottomMatch || primaryIntents.includes('TOP_N')) {
    planIntent = 'TOP_N';
  } else if (primaryIntents.includes('COUNT')) {
    planIntent = 'COUNT';
  } else if (primaryIntents.includes('AVERAGE')) {
    planIntent = 'AVERAGE';
  } else if (primaryIntents.includes('SUM')) {
    planIntent = 'SUM';
  } else if (primaryIntents.includes('MIN')) {
    planIntent = 'MIN';
  } else if (primaryIntents.includes('MAX')) {
    planIntent = 'MAX';
  } else if (primaryIntents.includes('GROUP_BY')) {
    planIntent = 'GROUP_BY';
  } else if (primaryIntents.includes('FILTER') || /\b(where|above|below|greater|less|equal|after|before)\b/i.test(q)) {
    planIntent = 'FILTER';
  }

  // 4. Determine aggregation function and column
  let aggregation = null;
  let aggColumn = null;

  if (primaryIntents.includes('COUNT') || /\b(count|how many|number of)\b/i.test(q)) {
    aggregation = 'COUNT';
  } else if (primaryIntents.includes('AVERAGE') || /\b(avg|average|mean)\b/i.test(q)) {
    aggregation = 'AVG';
  } else if (primaryIntents.includes('SUM') || /\b(sum|total|combined)\b/i.test(q)) {
    aggregation = 'SUM';
  } else if (primaryIntents.includes('MAX') || /\b(max|maximum|highest)\b/i.test(q)) {
    aggregation = 'MAX';
  } else if (primaryIntents.includes('MIN') || /\b(min|minimum|lowest)\b/i.test(q)) {
    aggregation = 'MIN';
  }

  // Find target numeric column for aggregations
  if (aggregation && aggregation !== 'COUNT') {
    const numCol = matchedColumns.find((c) => {
      const t = (c.type || '').toLowerCase();
      return t.includes('int') || t.includes('num') || t.includes('float') || t.includes('double') || t.includes('decimal') || t.includes('real');
    });
    if (numCol) {
      aggColumn = numCol.qualified;
    } else if (primaryTable && schema?.tables[primaryTable]) {
      // Find first numeric column on primary table
      for (const [cName, cType] of Object.entries(schema.tables[primaryTable].columns || {})) {
        const t = cType.toLowerCase();
        if (t.includes('int') || t.includes('num') || t.includes('float') || t.includes('double') || t.includes('decimal') || t.includes('real')) {
          aggColumn = `${primaryTable}.${cName}`;
          break;
        }
      }
    }
  }

  // 5. Determine GROUP BY
  const groupBy = [];
  if (/\b(by|per|each|for each|breakdown by)\s+([a-z_]+)\b/i.test(q)) {
    const match = q.match(/\b(by|per|each|for each|breakdown by)\s+([a-z_]+)\b/i);
    const term = match ? match[2] : null;
    if (term) {
      const found = matchedColumns.find((c) => c.column === term || toSingular(c.column) === toSingular(term));
      if (found) {
        groupBy.push(found.qualified);
      }
    }
  }

  // 6. Determine Filters
  const filters = [];
  const numOpMatch = q.match(/\b(above|greater than|more than|>|over)\s+(\d+(?:\.\d+)?)\b/i);
  const numBelowMatch = q.match(/\b(below|less than|under|<)\s+(\d+(?:\.\d+)?)\b/i);
  const numEqMatch = q.match(/\b(equal to|equals|=)\s+(\d+(?:\.\d+)?)\b/i);

  if (numOpMatch) {
    const col = matchedColumns.find((c) => c.table === primaryTable) || matchedColumns[0];
    if (col) {
      filters.push({ column: col.qualified, operator: '>', value: parseFloat(numOpMatch[2]) });
    }
  } else if (numBelowMatch) {
    const col = matchedColumns.find((c) => c.table === primaryTable) || matchedColumns[0];
    if (col) {
      filters.push({ column: col.qualified, operator: '<', value: parseFloat(numBelowMatch[2]) });
    }
  } else if (numEqMatch) {
    const col = matchedColumns.find((c) => c.table === primaryTable) || matchedColumns[0];
    if (col) {
      filters.push({ column: col.qualified, operator: '=', value: parseFloat(numEqMatch[2]) });
    }
  }

  // 7. Date Conditions
  const dateFilter = extractDateCondition(q);

  // 8. Determine Joins
  const joins = [];
  if (matchedTables.length > 1) {
    for (let i = 0; i < matchedTables.length - 1; i++) {
      const joinCond = findRelationshipJoin(matchedTables[i], matchedTables[i + 1], relationships);
      if (joinCond) {
        joins.push(joinCond);
      }
    }
  }

  // 9. Determine Columns to Project
  let columns = [];
  if (matchedColumns.length > 0) {
    columns = matchedColumns.map((c) => c.qualified);
  } else if (primaryTable && schema?.tables[primaryTable]) {
    columns = Object.keys(schema.tables[primaryTable].columns).slice(0, 5).map((c) => `${primaryTable}.${c}`);
  }

  // 10. Determine Limit and Sorting
  let limit = 100;
  let orderBy = null;

  if (topMatch) {
    limit = parseInt(topMatch[1], 10);
    const sortCol = aggColumn || (matchedColumns[0] ? matchedColumns[0].qualified : `${primaryTable}.id`);
    orderBy = `${sortCol} DESC`;
  } else if (bottomMatch) {
    limit = parseInt(bottomMatch[1], 10);
    const sortCol = aggColumn || (matchedColumns[0] ? matchedColumns[0].qualified : `${primaryTable}.id`);
    orderBy = `${sortCol} ASC`;
  } else if (/\b(highest|most|top|maximum)\b/i.test(q)) {
    const sortCol = aggColumn || (matchedColumns[0] ? matchedColumns[0].qualified : null);
    if (sortCol) orderBy = `${sortCol} DESC`;
  } else if (/\b(lowest|least|minimum|cheapest)\b/i.test(q)) {
    const sortCol = aggColumn || (matchedColumns[0] ? matchedColumns[0].qualified : null);
    if (sortCol) orderBy = `${sortCol} ASC`;
  }

  // 11. Concrete Confidence Calculation
  let confidence = 0.50; // base

  if (matchedTables.length > 0 && allTables.includes(matchedTables[0])) {
    confidence += 0.20; // identified real table
  }
  if (matchedColumns.length > 0) {
    confidence += 0.15; // identified real columns
  }
  if (joins.length > 0 || matchedTables.length === 1) {
    confidence += 0.10; // valid single table or resolved joins
  }
  if (planIntent !== 'UNKNOWN' && !intentAnalysis.isAmbiguous) {
    confidence += 0.05; // unambiguous intent
  }
  if (intentAnalysis.isAmbiguous) {
    confidence -= 0.35;
  }
  if (intentAnalysis.isUnsupported) {
    confidence = 0.10;
  }

  confidence = Math.min(0.99, Math.max(0.10, parseFloat(confidence.toFixed(2))));

  return {
    intent: planIntent,
    tables: matchedTables,
    columns,
    joins,
    filters,
    aggregation,
    aggColumn,
    groupBy,
    orderBy,
    limit,
    dateFilter,
    confidence,
    dbType,
  };
}

module.exports = {
  createQueryPlan,
  extractDateCondition,
};
