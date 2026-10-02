// ============================================
// Pending Operation Store — SQL Tampering Prevention
// ============================================
// Stores validated database operations server-side so that
// confirmations reference an immutable operationId rather than
// trusting raw SQL sent from the client.
//
// Complies with Directive 31 & 32:
// - A malicious user cannot tamper with the SQL on the frontend
// - Server stores and retrieves the original, validated SQL
// - Operations expire after 5 minutes TTL
// - Consumed once (cannot be re-executed)

const crypto = require('crypto');

// In-memory store: operationId -> { id, sql, intent, targetTable, riskLevel, review, userId, dbType, createdAt, expiresAt }
const pendingOperations = new Map();

const OPERATION_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Store a newly validated and reviewed operation.
 *
 * @param {object} params
 * @param {string} params.sql - Original validated SQL
 * @param {string} params.intent - Operation intent (INSERT, UPDATE, DELETE, CREATE, ALTER, DROP, TRUNCATE)
 * @param {string} params.targetTable - Target table/collection
 * @param {string} params.riskLevel - LOW | MEDIUM | HIGH | CRITICAL
 * @param {object} [params.review] - AI review metadata
 * @param {number|string|null} [params.userId] - Authenticated user ID
 * @param {string} [params.dbType='postgres'] - Database dialect
 * @returns {string} operationId - Cryptographically secure unique operation ID
 */
function createPendingOperation({
  sql,
  intent,
  targetTable,
  riskLevel = 'MEDIUM',
  review = null,
  userId = null,
  dbType = 'postgres',
  confirmPhrase = null,
  allowMass = false,
}) {
  if (!sql || typeof sql !== 'string') {
    throw new Error('Valid SQL statement is required to create a pending operation.');
  }

  // Generate unique opaque operation ID
  const operationId = `op_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
  const now = Date.now();

  pendingOperations.set(operationId, {
    operationId,
    sql: sql.trim(),
    intent: (intent || 'UNKNOWN').toUpperCase(),
    targetTable: targetTable || 'unknown',
    riskLevel: (riskLevel || 'MEDIUM').toUpperCase(),
    review,
    userId: userId !== undefined && userId !== null ? String(userId) : null,
    dbType: dbType || 'postgres',
    confirmPhrase: confirmPhrase || null,
    allowMass: Boolean(allowMass),
    status: 'PENDING',
    createdAt: now,
    expiresAt: now + OPERATION_TTL_MS,
  });

  // Periodically prune expired
  pruneExpiredOperations();

  return operationId;
}

/**
 * Retrieve a pending operation without consuming it.
 *
 * @param {string} operationId
 * @returns {object|null}
 */
function getPendingOperation(operationId) {
  if (!operationId || !pendingOperations.has(operationId)) {
    return null;
  }

  const op = pendingOperations.get(operationId);
  if (Date.now() > op.expiresAt) {
    pendingOperations.delete(operationId);
    return null;
  }

  return { ...op };
}

function authorizeOperation(op, requestingUserId) {
  const reqUid = requestingUserId !== undefined && requestingUserId !== null ? String(requestingUserId) : null;
  if (op.userId !== null && op.userId !== reqUid) {
    return { success: false, statusCode: 403, error: 'Operation not authorized for this user.' };
  }
  return null;
}

/**
 * Claim a stored operation for execution.
 * PENDING and FAILED can be claimed. SUCCESS cannot be run again.
 * EXECUTING cannot be claimed a second time.
 * The stored SQL is never replaced by the caller.
 */
function claimPendingOperation(operationId, requestingUserId = null) {
  if (!operationId || typeof operationId !== 'string') {
    return { success: false, statusCode: 400, error: 'Operation ID is required for confirmation.' };
  }

  const op = pendingOperations.get(operationId);
  if (!op) {
    return { success: false, statusCode: 400, error: 'Operation not found or already executed.' };
  }

  if (Date.now() > op.expiresAt || op.status === 'EXPIRED') {
    op.status = 'EXPIRED';
    return { success: false, statusCode: 400, error: 'Confirmation window has expired (5 minutes). Please stage the operation again.' };
  }

  const unauthorized = authorizeOperation(op, requestingUserId);
  if (unauthorized) return unauthorized;

  if (op.status === 'SUCCESS') {
    return { success: false, statusCode: 400, error: 'This operation already ran and cannot be executed again.' };
  }
  if (op.status === 'EXECUTING') {
    return { success: false, statusCode: 409, error: 'This operation is already executing.' };
  }
  if (op.status === 'CANCELLED') {
    return { success: false, statusCode: 400, error: 'This operation was cancelled.' };
  }
  if (op.status !== 'PENDING' && op.status !== 'FAILED') {
    return { success: false, statusCode: 400, error: 'This operation cannot be executed.' };
  }

  op.status = 'EXECUTING';
  return { success: true, operation: { ...op } };
}

function completePendingOperation(operationId) {
  const op = pendingOperations.get(operationId);
  if (!op || op.status !== 'EXECUTING') return false;
  op.status = 'SUCCESS';
  return true;
}

function failPendingOperation(operationId) {
  const op = pendingOperations.get(operationId);
  if (!op || op.status !== 'EXECUTING') return false;
  op.status = 'FAILED';
  return true;
}

function cancelPendingOperation(operationId, requestingUserId = null) {
  const op = pendingOperations.get(operationId);
  if (!op) return { success: false, error: 'Operation not found.' };
  const unauthorized = authorizeOperation(op, requestingUserId);
  if (unauthorized) return unauthorized;
  if (op.status === 'SUCCESS' || op.status === 'EXECUTING') {
    return { success: false, error: 'This operation can no longer be cancelled.' };
  }
  op.status = 'CANCELLED';
  return { success: true };
}

/**
 * Backward-compatible claim. Does not delete the operation.
 * A second claim fails while the first claim is EXECUTING or after SUCCESS.
 */
function consumePendingOperation(operationId, requestingUserId = null) {
  return claimPendingOperation(operationId, requestingUserId);
}

/**
 * Prune all expired operations.
 */
function pruneExpiredOperations() {
  const now = Date.now();
  for (const [id, op] of pendingOperations.entries()) {
    if (now > op.expiresAt) {
      pendingOperations.delete(id);
    }
  }
}

module.exports = {
  createPendingOperation,
  getPendingOperation,
  claimPendingOperation,
  completePendingOperation,
  failPendingOperation,
  cancelPendingOperation,
  consumePendingOperation,
  pruneExpiredOperations,
};
