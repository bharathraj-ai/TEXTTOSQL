// ============================================
// Confirmation Service — Secure Execution Engine
// ============================================
// Consumes and executes pending operations securely using server-stored
// state. Prevents SQL tampering and enforces user isolation.
//
// Complies with Directives 31 & 32:
//   - Client passes operationId, never arbitrary SQL.
//   - Server retrieves original validated SQL.
//   - Final security validation runs immediately before execution.
//   - Executes within transaction for DML, or direct statement for DDL.
//   - Invalidates schema cache for DDL operations.

const { getDatabaseSchema, invalidateUserSchemaCache } = require('./schemaService');
const connectionManager = require('./connectionManager');
const { executeWriteSQL } = require('./mutationService');
const { validateQuery } = require('../utils/sqlValidator');
const { logQuery } = require('./auditService');
const {
  claimPendingOperation,
  completePendingOperation,
  failPendingOperation,
  getPendingOperation,
} = require('./pendingOperationStore');
const { logSafeSql, safeErrorMessage } = require('../utils/safeLog');

/**
 * Sanitize error messages to prevent exposing database internals.
 */
function sanitizeError(message) {
  if (!message) return 'An unexpected database error occurred.';
  if (message.includes('connect') || message.includes('ECONNREFUSED')) {
    return 'Unable to connect to the database. Please try again.';
  }
  const colMatch = message.match(/column "(\w+)" does not exist/i);
  if (colMatch) return `Column "${colMatch[1]}" does not exist in the table.`;
  const tableMatch = message.match(/relation "(\w+)" does not exist/i);
  if (tableMatch) return `Table "${tableMatch[1]}" does not exist.`;
  if (message.includes('syntax error')) return 'SQL syntax error. The stored statement could not run.';
  if (message.includes('timed out') || message.includes('timeout')) return 'Query execution timed out.';
  if (message.includes('unique') || message.includes('duplicate')) {
    return 'A record with these values already exists (unique constraint violation).';
  }
  if (message.includes('foreign key') || message.includes('violates')) {
    return 'This operation violates a database constraint (foreign key or unique violation).';
  }
  return 'Database operation failed. Please verify the query and try again.';
}

/**
 * Execute a confirmed operation by operationId or confirmationToken.
 *
 * @param {object} params
 * @param {string} [params.operationId] - Server-stored operation ID
 * @param {string} [params.confirmationToken] - Token or operation ID
 * @param {number|string|null} [params.userId] - Authenticated user ID
 * @returns {Promise<object>} Result payload
 */
async function confirmAndExecuteOperation({ operationId, confirmationToken, userId = null, confirmationText = '' }) {
  const startTime = Date.now();
  const rawId = operationId || confirmationToken;

  if (!rawId || typeof rawId !== 'string') {
    return {
      success: false,
      statusCode: 400,
      type: 'mutation_error',
      error: 'Operation ID or confirmation token is required.',
    };
  }

  let sql = '';
  let intent = 'UNKNOWN';
  let targetTable = 'unknown';
  let opDbType = 'postgres';
  let opUserId = userId;

  const pending = getPendingOperation(rawId);
  if (pending?.confirmPhrase) {
    const typed = String(confirmationText || '').trim().toLowerCase();
    if (typed !== String(pending.confirmPhrase).toLowerCase()) {
      return {
        success: false,
        statusCode: 400,
        type: 'confirmation_required',
        error: `Type "${pending.confirmPhrase}" to confirm this operation.`,
        confirmPhrase: pending.confirmPhrase,
      };
    }
  }

  const claimed = claimPendingOperation(rawId, userId);
  if (!claimed.success || !claimed.operation) {
    return {
      success: false,
      statusCode: claimed.statusCode || 400,
      type: 'mutation_error',
      error: claimed.error || 'Operation not found or already executed.',
    };
  }

  const op = claimed.operation;
  sql = op.sql;
  intent = op.intent;
  targetTable = op.targetTable;
  opDbType = op.dbType;
  opUserId = op.userId;
  console.log(`[CONFIRM] Claimed operation=${intent} table=${targetTable}`);

  const releaseFailed = () => failPendingOperation(rawId);

  // ── 3. Resolve Database Adapter ───────────────────────
  let adapter;
  try {
    adapter = await connectionManager.getUserAdapter(userId);
  } catch (adapterErr) {
    releaseFailed();
    return {
      success: false,
      statusCode: adapterErr.statusCode === 401 ? 401 : 400,
      type: 'mutation_error',
      error: adapterErr.statusCode === 401 ? 'Authentication required.' : 'Database not connected.',
      retryable: adapterErr.statusCode !== 401,
      operationId: rawId,
    };
  }

  const actualDbType = adapter.type || opDbType || 'postgres';
  const isDDL = ['CREATE', 'ALTER', 'DROP', 'TRUNCATE'].includes(intent.toUpperCase());

  // ── 4. Final Security Check (Before Execution) ────────
  let schema;
  try {
    schema = await getDatabaseSchema(false, adapter, userId);
  } catch (schemaErr) {
    releaseFailed();
    console.error(`[CONFIRM] Schema lookup failed: ${safeErrorMessage(schemaErr)}`);
    return {
      success: false,
      statusCode: 400,
      type: 'mutation_error',
      error: 'Database not connected.',
      retryable: true,
      operationId: rawId,
    };
  }
  const validation = validateQuery(sql, schema, actualDbType, isDDL ? 'ddl' : 'write', {
    allowMass: Boolean(op.allowMass),
  });
  if (!validation.valid) {
    releaseFailed();
    console.error(`[CONFIRM] Final validation failed: ${validation.error}`);
    return {
      success: false,
      statusCode: 400,
      type: 'mutation_error',
      error: validation.error,
      retryable: true,
      operationId: rawId,
    };
  }

  console.log(`[CONFIRM] Executing ${intent} on ${targetTable} (${actualDbType})`);
  logSafeSql('[CONFIRM] SQL:', sql);

  // ── 5. Execute on Database ────────────────────────────
  let affectedRows = 0;
  try {
    if (isDDL && typeof adapter.executeWrite === 'function') {
      const execResult = await adapter.executeWrite(sql);
      affectedRows = execResult.affectedRows ?? execResult.rowCount ?? 0;
      invalidateUserSchemaCache(userId);
    } else if (isDDL) {
      const execResult = await adapter.executeQuery(sql);
      affectedRows = execResult.affectedRows ?? execResult.rowCount ?? 0;
      invalidateUserSchemaCache(userId);
    } else {
      const execResult = await executeWriteSQL(sql, adapter, actualDbType);
      affectedRows = execResult.affectedRows ?? 0;
    }
  } catch (execErr) {
    releaseFailed();
    console.error(`[CONFIRM] Execution failed: ${safeErrorMessage(execErr)}`);
    logQuery({
      userId,
      databaseType: actualDbType,
      queryType: `${intent}_FAILED`,
      query: sql,
      success: false,
      executionTimeMs: Date.now() - startTime,
      errorType: 'execution_failed',
    });
    return {
      success: false,
      statusCode: 400,
      type: 'mutation_error',
      error: sanitizeError(execErr.message),
      retryable: true,
      operationId: rawId,
    };
  }

  if (!completePendingOperation(rawId)) {
    return {
      success: false,
      statusCode: 409,
      type: 'mutation_error',
      error: 'This operation is already executing.',
    };
  }

  const executionTimeMs = Date.now() - startTime;
  logQuery({
    userId,
    databaseType: actualDbType,
    queryType: intent,
    query: sql,
    success: true,
    executionTimeMs,
    rowCount: affectedRows,
  });

  const messages = {
    INSERT: `Successfully inserted ${affectedRows} row(s) into ${targetTable}.`,
    UPDATE: `Successfully updated ${affectedRows} row(s) in ${targetTable}.`,
    DELETE: `Successfully deleted ${affectedRows} row(s) from ${targetTable}.`,
    CREATE: `Successfully created table ${targetTable}.`,
    ALTER: `Successfully altered schema for ${targetTable}.`,
    DROP: `Successfully dropped table ${targetTable}.`,
    TRUNCATE: `Successfully truncated table ${targetTable}.`,
  };

  console.log(`[CONFIRM] ✅ ${intent} completed successfully in ${executionTimeMs}ms`);

  return {
    success: true,
    statusCode: 200,
    type: 'mutation_result',
    operation: intent,
    table: targetTable,
    affectedRows,
    sql,
    dbType: actualDbType,
    executionTime: executionTimeMs,
    message: messages[intent] || `Operation ${intent} completed on ${targetTable}.`,
  };
}

module.exports = {
  confirmAndExecuteOperation,
};
