// ============================================
// Mutation Routes — POST /api/mutation (Day 4)
// ============================================
// Provides safe CRUD write operations with
// mandatory confirmation before execution.
//
// Endpoints:
//   POST /api/mutation/stage    — Generate SQL plan + request confirmation
//   POST /api/mutation/confirm  — Execute the confirmed SQL
//   GET  /api/mutation/estimate — Estimate affected rows before confirm

const express = require('express');
const jwt = require('jsonwebtoken');
const { getDatabaseSchema } = require('../services/schemaService');
const { getUserAdapter } = require('../services/connectionManager');
const { generateMutationPlan, validateWriteSQL, executeWriteSQL, estimateAffectedRows } = require('../services/mutationService');
const { detectWriteType, isDDLMutation } = require('../services/intentService');
const { validateQuery } = require('../utils/sqlValidator');
const { logQuery, logReviewAudit, getReviewLogs } = require('../services/auditService');
const { reviewSQL, classifyLocalRisk } = require('../services/sqlReviewService');

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || 'nl_sql_jwt_secret_key_super_secure_2026_production_v2';

/**
 * Extract userId from Bearer token (optional auth).
 */
function extractUserId(req) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      const token = authHeader.split(' ')[1];
      const decoded = jwt.verify(token, JWT_SECRET);
      return decoded.id;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Sanitize error messages — never expose DB credentials.
 */
function sanitizeMutationError(message) {
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
 * POST /api/mutation/stage
 * Generates a write operation plan from natural language.
 * Does NOT execute the SQL — returns it for user confirmation.
 *
 * Body: { question: string, mode: 'write' }
 * Response: {
 *   success: true,
 *   intent: 'INSERT'|'UPDATE'|'DELETE',
 *   targetTable: string,
 *   sql: string,
 *   riskLevel: 'NORMAL'|'HIGH',
 *   warnings: string[],
 *   estimatedRows: number|null,
 *   requiresConfirmation: true,
 *   confirmationToken: string  // opaque string to pass back to /confirm
 * }
 */
router.post('/mutation/stage', async (req, res) => {
  const startTime = Date.now();
  try {
    const { question } = req.body;

    if (!question || typeof question !== 'string' || question.trim().length === 0) {
      return res.status(400).json({
        success: false,
        type: 'mutation_error',
        error: 'Please enter a question describing what you want to do.',
      });
    }

    const trimmed = question.trim();
    const userId = extractUserId(req);

    console.log(`\n${'═'.repeat(50)}`);
    console.log(`[MUTATION STAGE] User: ${userId || 'guest'} | Question: "${trimmed}"`);

    // ── DDL check: always blocked ──────────────────────
    if (isDDLMutation(trimmed)) {
      logQuery({ userId, databaseType: 'unknown', queryType: 'DDL_BLOCKED', query: trimmed, success: false, executionTimeMs: Date.now() - startTime, errorType: 'ddl_blocked' });
      return res.status(403).json({
        success: false,
        type: 'mutation_error',
        error: 'DDL operations (DROP, ALTER, TRUNCATE, CREATE) are not permitted. Only SELECT, INSERT, UPDATE, and DELETE are supported.',
      });
    }

    // ── Detect write intent ────────────────────────────
    const writeIntent = detectWriteType(trimmed);
    if (!writeIntent) {
      return res.status(400).json({
        success: false,
        type: 'mutation_error',
        error: 'This question does not appear to be a write operation. Use "add", "update", or "delete" keywords, or use the Read-Only mode for SELECT queries.',
      });
    }

    // ── Get adapter + schema ──────────────────────────
    let adapter;
    try {
      adapter = await getUserAdapter(userId);
    } catch (err) {
      return res.status(400).json({
        success: false,
        type: 'mutation_error',
        error: 'Database not connected. Please connect a database first.',
      });
    }

    const dbType = adapter.type || 'postgres';

    if (dbType === 'mongodb') {
      return res.status(400).json({
        success: false,
        type: 'mutation_error',
        error: 'Write operations for MongoDB are not yet supported via natural language. Use the MongoDB shell directly.',
      });
    }

    const schema = await getDatabaseSchema(false, adapter, userId);
    if (!schema || Object.keys(schema.tables || {}).length === 0) {
      return res.status(400).json({
        success: false,
        type: 'mutation_error',
        error: 'No tables found in the connected database.',
      });
    }

    // ── Generate mutation plan ─────────────────────────
    let plan;
    try {
      plan = generateMutationPlan(trimmed, schema, dbType);
    } catch (planErr) {
      console.error('[MUTATION STAGE] Plan error:', planErr.message);
      return res.status(400).json({
        success: false,
        type: 'mutation_error',
        error: planErr.message,
      });
    }

    // ── Validate the generated SQL ──────────────────────
    const validation = validateQuery(plan.sql, schema, dbType, 'write');
    if (!validation.valid) {
      console.error('[MUTATION STAGE] Validation failed:', validation.error);
      return res.status(400).json({
        success: false,
        type: 'mutation_error',
        error: validation.error,
        layer: validation.layer,
      });
    }

    // ── OpenRouter Semantic SQL Reviewer & Risk Assessment ─
    let review = null;
    try {
      review = await reviewSQL({
        naturalLanguageQuery: trimmed,
        generatedSQL: plan.sql,
        dbType,
        schema,
        operation: plan.intent,
        userId,
      });
    } catch (revErr) {
      console.warn('[MUTATION STAGE] Review error:', revErr.message);
    }

    const combinedRisk = review?.risk || plan.riskLevel || 'MEDIUM';
    const isApproved = Boolean(review?.approved);

    // ── Estimate affected rows (UPDATE/DELETE) ─────────
    let estimatedRows = plan.estimatedRows;
    if ((writeIntent === 'UPDATE' || writeIntent === 'DELETE') && estimatedRows === null) {
      try {
        estimatedRows = await estimateAffectedRows(plan.sql, adapter, dbType);
      } catch {
        estimatedRows = null;
      }
    }

    // ── Build confirmation token ───────────────────────
    // Issued ONLY if approved by safety review!
    // "Do not provide a normal confirmation button when the safety review rejects the query."
    let confirmationToken = null;
    if (isApproved) {
      const confirmPayload = {
        sql: plan.sql,
        userId: userId || null,
        intent: plan.intent,
        targetTable: plan.targetTable,
        dbType,
        ts: Date.now(),
      };
      confirmationToken = jwt.sign(confirmPayload, JWT_SECRET, { expiresIn: '5m' });
    }

    const responsePayload = {
      success: true,
      type: 'mutation_staged',
      intent: plan.intent,
      targetTable: plan.targetTable,
      sql: plan.sql,
      riskLevel: plan.riskLevel || 'NORMAL',
      warnings: plan.warnings,
      hasWhereClause: plan.hasWhereClause,
      estimatedRows,
      dbType,
      requiresConfirmation: true,
      canConfirm: isApproved,
      confirmationToken,
      review: review || {
        approved: true,
        risk: combinedRisk,
        operation: plan.intent,
        semantic_match: true,
        issues: [],
        reason: 'Local validation passed.',
      },
    };

    console.log(`[MUTATION STAGE] Staged ${plan.intent} on ${plan.targetTable} | Risk: ${combinedRisk} | Approved: ${isApproved}`);
    console.log('═'.repeat(50));

    return res.json(responsePayload);

  } catch (err) {
    console.error('[MUTATION STAGE] Unexpected error:', err.message);
    return res.status(500).json({
      success: false,
      type: 'mutation_error',
      error: 'An unexpected error occurred while preparing the operation.',
    });
  }
});

/**
 * POST /api/mutation/confirm
 * Executes a previously staged write operation after user confirmation.
 *
 * Body: { confirmationToken: string }
 * Response: {
 *   success: true,
 *   operation: 'INSERT'|'UPDATE'|'DELETE',
 *   table: string,
 *   affectedRows: number,
 *   sql: string,
 *   message: string
 * }
 */
router.post('/mutation/confirm', async (req, res) => {
  const startTime = Date.now();
  try {
    const { confirmationToken } = req.body;

    if (!confirmationToken || typeof confirmationToken !== 'string') {
      return res.status(400).json({
        success: false,
        type: 'mutation_error',
        error: 'Confirmation token is required.',
      });
    }

    const requestUserId = extractUserId(req);

    // ── Verify + decode the confirmation token ─────────
    let payload;
    try {
      payload = jwt.verify(confirmationToken, JWT_SECRET);
    } catch (err) {
      return res.status(400).json({
        success: false,
        type: 'mutation_error',
        error: err.name === 'TokenExpiredError'
          ? 'Confirmation window expired (5 minutes). Please stage the operation again.'
          : 'Invalid confirmation token.',
      });
    }

    const { sql, userId: tokenUserId, intent, targetTable, dbType } = payload;

    // ── User isolation check ───────────────────────────
    // The token's userId must match the requesting user's id.
    if (tokenUserId !== null && requestUserId !== null && tokenUserId !== requestUserId) {
      console.error(`[MUTATION CONFIRM] User isolation violation: token=${tokenUserId} request=${requestUserId}`);
      return res.status(403).json({
        success: false,
        type: 'mutation_error',
        error: 'Operation not authorized for this user.',
      });
    }

    console.log(`\n${'═'.repeat(50)}`);
    console.log(`[MUTATION CONFIRM] User: ${requestUserId || 'guest'} | ${intent} on ${targetTable}`);
    console.log(`[MUTATION CONFIRM] SQL: ${sql}`);

    // ── Get adapter ────────────────────────────────────
    let adapter;
    try {
      adapter = await getUserAdapter(requestUserId);
    } catch (err) {
      return res.status(400).json({
        success: false,
        type: 'mutation_error',
        error: 'Database not connected.',
      });
    }

    const actualDbType = adapter.type || dbType || 'postgres';

    // ── Final security validation ──────────────────────
    const schema = await getDatabaseSchema(false, adapter, requestUserId);
    const validation = validateQuery(sql, schema, actualDbType, 'write');
    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        type: 'mutation_error',
        error: validation.error,
      });
    }

    // ── Execute write with transaction ─────────────────
    let execResult;
    try {
      execResult = await executeWriteSQL(sql, adapter, actualDbType);
    } catch (execErr) {
      console.error('[MUTATION CONFIRM] Execution error:', execErr.message);
      logQuery({
        userId: requestUserId,
        databaseType: actualDbType,
        queryType: `${intent}_FAILED`,
        query: sql,
        success: false,
        executionTimeMs: Date.now() - startTime,
        errorType: 'write_execution_failed',
      });
      return res.status(400).json({
        success: false,
        type: 'mutation_error',
        error: sanitizeMutationError(execErr.message),
      });
    }

    const executionTimeMs = Date.now() - startTime;
    logQuery({
      userId: requestUserId,
      databaseType: actualDbType,
      queryType: intent,
      query: sql,
      success: true,
      executionTimeMs,
      rowCount: execResult.affectedRows,
    });

    const messages = {
      INSERT: `Successfully inserted ${execResult.affectedRows} row(s) into ${targetTable}.`,
      UPDATE: `Successfully updated ${execResult.affectedRows} row(s) in ${targetTable}.`,
      DELETE: `Successfully deleted ${execResult.affectedRows} row(s) from ${targetTable}.`,
    };

    console.log(`[MUTATION CONFIRM] ✅ ${intent} complete | Affected rows: ${execResult.affectedRows} | ${executionTimeMs}ms`);
    console.log('═'.repeat(50));

    return res.json({
      success: true,
      type: 'mutation_result',
      operation: intent,
      table: targetTable,
      affectedRows: execResult.affectedRows,
      sql,
      dbType: actualDbType,
      executionTime: executionTimeMs,
      message: messages[intent] || `Operation completed on ${targetTable}.`,
    });

  } catch (err) {
    console.error('[MUTATION CONFIRM] Unexpected error:', err.message);
    return res.status(500).json({
      success: false,
      type: 'mutation_error',
      error: 'An unexpected error occurred while executing the operation.',
    });
  }
});

/**
 * POST /api/review
 * Standalone endpoint to run AI safety review on any SQL query.
 * Body: { naturalLanguageQuery, generatedSQL, dbType, schema, operation }
 */
router.post('/review', async (req, res) => {
  try {
    const { naturalLanguageQuery, generatedSQL, dbType, schema, operation } = req.body;
    if (!generatedSQL || typeof generatedSQL !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'generatedSQL is required for review.',
      });
    }

    const userId = extractUserId(req);
    const review = await reviewSQL({
      naturalLanguageQuery: naturalLanguageQuery || '',
      generatedSQL,
      dbType: dbType || 'postgres',
      schema: schema || null,
      operation: operation || null,
      userId,
    });

    return res.json({
      success: true,
      review,
    });
  } catch (err) {
    console.error('[ROUTE /api/review] Error:', err.message);
    return res.status(500).json({
      success: false,
      error: err.message || 'Review failed.',
    });
  }
});

/**
 * GET /api/audit/reviews
 * Retrieves safe safety review audit logs (zero credentials, sanitized SQL).
 */
router.get('/audit/reviews', async (req, res) => {
  try {
    const userId = extractUserId(req);
    const limit = parseInt(req.query.limit || '50', 10);
    const logs = getReviewLogs({ userId, limit });
    return res.json({
      success: true,
      count: logs.length,
      logs,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;

