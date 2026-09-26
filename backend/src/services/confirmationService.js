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

const jwt = require('jsonwebtoken');
const { getDatabaseSchema, invalidateUserSchemaCache } = require('./schemaService');
const { getUserAdapter } = require('./connectionManager');
const { executeWriteSQL } = require('./mutationService');
const { validateQuery } = require('../utils/sqlValidator');
const { logQuery } = require('./auditService');
const { consumePendingOperation, getPendingOperation } = require('./pendingOperationStore');

const JWT_SECRET = process.env.JWT_SECRET || 'nl_sql_jwt_secret_key_super_secure_2026_production_v2';

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
  if (message.includes('syntax error')) return `SQL syntax error: ${message}`;
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

  // ── 1. Check Server-Side Pending Operation Store First ─
  // (Directives 31 & 32: Immutable server-side SQL storage)
  const consumed = consumePendingOperation(rawId, userId);
  if (consumed.success && consumed.operation) {
    const op = consumed.operation;
    sql = op.sql;
    intent = op.intent;
    targetTable = op.targetTable;
    opDbType = op.dbType;
    opUserId = op.userId;
    console.log(`[CONFIRM] Consumed pending operation [${rawId}] for table "${targetTable}"`);
  } else {
    // ── 2. Fallback to JWT Confirmation Token ─────────────
    try {
      const payload = jwt.verify(rawId, JWT_SECRET);
      sql = payload.sql;
      intent = payload.intent || 'UNKNOWN';
      targetTable = payload.targetTable || 'unknown';
      opDbType = payload.dbType || 'postgres';
      opUserId = payload.userId;

      // User isolation check for JWT payload
      if (opUserId !== null && String(opUserId) !== String(userId)) {
        console.error(`[CONFIRM] User isolation violation: tokenUser=${opUserId} reqUser=${userId}`);
        return {
          success: false,
          statusCode: 403,
          type: 'mutation_error',
          error: 'Operation not authorized for this user.',
        };
      }
    } catch (jwtErr) {
      return {
        success: false,
        statusCode: 400,
        type: 'mutation_error',
        error: jwtErr.name === 'TokenExpiredError'
          ? 'Confirmation window has expired (5 minutes). Please stage the operation again.'
          : 'Invalid or expired confirmation token.',
      };
    }
  }

  // ── 3. Resolve Database Adapter ───────────────────────
  let adapter;
  try {
    adapter = await getUserAdapter(userId);
  } catch (adapterErr) {
    return {
      success: false,
      statusCode: 400,
      type: 'mutation_error',
      error: 'Database not connected.',
    };
  }

  const actualDbType = adapter.type || opDbType || 'postgres';
  const isDDL = ['CREATE', 'ALTER', 'DROP', 'TRUNCATE'].includes(intent.toUpperCase());

  // ── 4. Final Security Check (Before Execution) ────────
  const schema = await getDatabaseSchema(false, adapter, userId);
  const validation = validateQuery(sql, schema, actualDbType, isDDL ? 'ddl' : 'write');
  if (!validation.valid) {
    console.error(`[CONFIRM] Final validation failed: ${validation.error}`);
    return {
      success: false,
      statusCode: 400,
      type: 'mutation_error',
      error: validation.error,
    };
  }

  console.log(`[CONFIRM] Executing ${intent} on ${targetTable} (${actualDbType})...`);
  console.log(`[CONFIRM] SQL: ${sql}`);

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
    console.error(`[CONFIRM] Execution failed: ${execErr.message}`);
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
