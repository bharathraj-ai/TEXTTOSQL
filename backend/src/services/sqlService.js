// ============================================
// SQL Service — Read-Only Execute with Timeout & Limits
// ============================================
// Day 3: Enforces read-only SELECT execution.
// Timeout (5s), result row limit (100 rows).

const pool = require('../db/database');
const { validateQuery } = require('../utils/sqlValidator');
const { logSafeSql, safeErrorMessage } = require('../utils/safeLog');

// Configuration
const QUERY_TIMEOUT_MS = 5000;
const MAX_RESULT_ROWS = 100;

/**
 * Validate and execute a read-only query across any database adapter with timeout and row limits.
 *
 * @param {string|object} sql - The SQL or MQL query to execute
 * @param {object} [schema] - Optional schema for validation
 * @param {object} [targetPool] - Specific database adapter or pool
 * @returns {Promise<object>} Execution results
 * @throws {Error} If validation fails or query errors
 */
async function executeSQL(sql, schema = null, targetPool = null) {
  const dbType = targetPool?.type || 'postgres';

  // Step 1: Validate query (read-only)
  const validation = validateQuery(sql, schema, dbType);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  // Step 2: If targetPool is an adapter implementing executeQuery, delegate to it
  if (targetPool && typeof targetPool.executeQuery === 'function') {
    return targetPool.executeQuery(sql);
  }

  // Fallback for legacy raw PostgreSQL pools
  const startTime = Date.now();
  const activePool = targetPool || pool;

  try {
    const client = await activePool.connect();

    try {
      // Set statement timeout for this session
      await client.query(`SET statement_timeout = '${QUERY_TIMEOUT_MS}';`);

      // Execute the actual query
      const result = await client.query(sql);
      const executionTime = Date.now() - startTime;

      // Step 3: Process results
      let finalColumns = [];
      let finalRows = [];

      if (result.fields && result.fields.length > 0) {
        finalColumns = result.fields.map((field) => field.name);
        finalRows = result.rows || [];
      }

      // Step 4: Apply row limit
      let rows = finalRows;
      let rowLimitApplied = false;

      if (rows.length > MAX_RESULT_ROWS) {
        rows = rows.slice(0, MAX_RESULT_ROWS);
        rowLimitApplied = true;
      }

      console.log(`[DATABASE] SELECT | Rows returned: ${rows.length} | ${executionTime}ms`);

      return {
        columns: finalColumns,
        rows,
        executionTime,
        totalRows: finalRows.length,
        rowCount: finalRows.length,
        rowLimitApplied,
      };
    } finally {
      client.release();
    }
  } catch (err) {
    const executionTime = Date.now() - startTime;

    if (err.message.includes('statement timeout') || err.message.includes('canceling statement')) {
      console.error(`[DATABASE] Query timed out after ${executionTime}ms`);
      throw new Error('Query execution timed out. The query took too long to execute.');
    }

    console.error(`[DATABASE] Query error: ${safeErrorMessage(err)}`);
    logSafeSql('[DATABASE] Failed SQL:', sql);
    throw err;
  }
}

module.exports = { executeSQL };
