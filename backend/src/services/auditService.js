// ============================================
// Audit Service — Day 4 Security Logging
// ============================================
// Tracks query execution events for observability,
// security monitoring, and compliance.
//
// STRICT PRIVACY GUARANTEES:
//   - NEVER logs passwords, connection strings, URLs, or raw credentials.
//   - Hashes generated SQL/MQL queries (SHA-256) rather than storing sensitive parameters.
//   - User-scoped access for security auditing.

const crypto = require('crypto');

// In-memory circular audit buffer (last 500 records)
const MAX_AUDIT_LOGS = 500;
const auditLogs = [];

/**
 * Hashes a SQL or MQL string using SHA-256 for audit privacy.
 */
function hashQuery(query) {
  if (!query || typeof query !== 'string') return null;
  return crypto.createHash('sha256').update(query.trim()).digest('hex').slice(0, 16);
}

/**
 * Records an audit entry.
 *
 * @param {object} entry
 * @param {number|string} entry.userId
 * @param {string} entry.databaseType
 * @param {string} entry.queryType - e.g. 'SELECT', 'MQL_FIND', 'AGGREGATE'
 * @param {string} [entry.query] - Will be hashed; never stored raw if contains literals
 * @param {boolean} entry.success
 * @param {number} entry.executionTimeMs
 * @param {number} [entry.rowCount=0]
 * @param {string} [entry.errorType=null]
 */
function logQuery({
  userId,
  databaseType,
  queryType,
  query,
  success,
  executionTimeMs,
  rowCount = 0,
  errorType = null,
}) {
  const auditRecord = {
    id: `aud_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    userId: userId ? Number(userId) : 'guest',
    databaseType: databaseType || 'unknown',
    timestamp: new Date().toISOString(),
    queryType: queryType || 'SELECT',
    sqlHash: hashQuery(query),
    success: Boolean(success),
    executionTimeMs: Math.round(executionTimeMs || 0),
    rowCount: rowCount ?? 0,
    errorType: errorType || null,
  };

  auditLogs.unshift(auditRecord);

  if (auditLogs.length > MAX_AUDIT_LOGS) {
    auditLogs.pop();
  }

  return auditRecord;
}

/**
 * Retrieves audit logs, optionally filtered by userId.
 *
 * @param {object} [filter]
 * @param {number|string} [filter.userId]
 * @param {number} [filter.limit=50]
 * @returns {Array<object>}
 */
function getAuditLogs({ userId = null, limit = 50 } = {}) {
  let records = auditLogs;
  if (userId) {
    const uid = Number(userId);
    records = records.filter((r) => r.userId === uid);
  }
  return records.slice(0, limit);
}

// In-memory circular review audit buffer (last 500 records)
const MAX_REVIEW_LOGS = 500;
const reviewLogs = [];

/**
 * Sanitize SQL for audit log: redact string/number literals so no sensitive row data is stored.
 */
function sanitizeSqlForAudit(sql) {
  if (!sql || typeof sql !== 'string') return '';
  return sql
    .replace(/'(?:[^'\\]|\\.)*'/g, "'[REDACTED]'")
    .replace(/"(?:[^"\\]|\\.)*"/g, '"[REDACTED]"')
    .replace(/\b\d{4,}\b/g, '[NUMERIC]');
}

/**
 * Records a safety review audit entry.
 * STRICT PRIVACY: NEVER stores passwords, connection URLs, keys, tokens, or raw table rows.
 *
 * @param {object} entry
 * @param {number|string} entry.userId
 * @param {string} entry.databaseType
 * @param {string} entry.operation
 * @param {string} entry.riskLevel - 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
 * @param {boolean} entry.approved
 * @param {string} entry.validationReason
 * @param {string} entry.executionStatus - e.g. 'STAGED', 'BLOCKED', 'EXECUTED', 'CANCELLED'
 * @param {string} [entry.sql]
 */
function logReviewAudit({
  userId,
  databaseType,
  operation,
  riskLevel,
  approved,
  validationReason,
  executionStatus,
  sql,
}) {
  const record = {
    id: `rev_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    user_id: userId ? Number(userId) : 'guest',
    timestamp: new Date().toISOString(),
    database_type: databaseType || 'unknown',
    operation: operation || 'UNKNOWN',
    risk_level: riskLevel || 'UNKNOWN',
    approved: Boolean(approved),
    validation_reason: validationReason || '',
    execution_status: executionStatus || (approved ? 'APPROVED' : 'BLOCKED'),
    sql_hash: hashQuery(sql),
    sql_sanitized: sanitizeSqlForAudit(sql),
  };

  reviewLogs.unshift(record);
  if (reviewLogs.length > MAX_REVIEW_LOGS) {
    reviewLogs.pop();
  }
  return record;
}

/**
 * Retrieves review audit logs, optionally filtered by userId.
 */
function getReviewLogs({ userId = null, limit = 50 } = {}) {
  let records = reviewLogs;
  if (userId) {
    const uid = Number(userId);
    records = records.filter((r) => r.user_id === uid);
  }
  return records.slice(0, limit);
}

/**
 * Clears the review audit buffer.
 */
function clearReviewLogs() {
  reviewLogs.length = 0;
}

/**
 * Clears the audit buffer (primarily for testing and cleanups).
 */
function clearAuditLogs() {
  auditLogs.length = 0;
  reviewLogs.length = 0;
}

module.exports = {
  logQuery,
  getAuditLogs,
  clearAuditLogs,
  hashQuery,
  logReviewAudit,
  getReviewLogs,
  clearReviewLogs,
  sanitizeSqlForAudit,
};

