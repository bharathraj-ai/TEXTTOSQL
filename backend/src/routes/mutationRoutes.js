// ============================================
// Mutation Routes — POST /api/mutation
// ============================================
// Stages and confirms write/DDL operations.
// Confirmation uses a server-side operationId.
// Client-supplied SQL is ignored.

const express = require('express');
const jwt = require('jsonwebtoken');
const { getReviewLogs } = require('../services/auditService');
const { reviewSQL } = require('../services/sqlReviewService');
const { stageNaturalLanguageOperation } = require('../services/operationPipeline');
const { confirmAndExecuteOperation } = require('../services/confirmationService');

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || 'nl_sql_jwt_secret_key_super_secure_2026_production_v2';

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

function sendResult(res, result) {
  const statusCode = result.statusCode || (result.success ? 200 : 400);
  const { statusCode: _statusCode, ...body } = result;
  return res.status(statusCode).json(body);
}

/**
 * POST /api/mutation/stage
 * Body: { question: string }
 * Returns operationId when confirmation is allowed. Does not execute SQL.
 */
router.post('/mutation/stage', async (req, res) => {
  try {
    const question = req.body?.question || req.body?.query;
    if (!question || typeof question !== 'string' || question.trim().length === 0) {
      return res.status(400).json({
        success: false,
        type: 'mutation_error',
        error: 'Please enter a question describing what you want to do.',
      });
    }

    const userId = extractUserId(req);
    const result = await stageNaturalLanguageOperation(question, userId, {
      currentTable: req.body?.currentTable,
      connectionId: req.body?.connectionId,
    });
    return sendResult(res, result);
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
 * Body: { operationId: string }
 * Retrieves the stored operation. Does not execute SQL from the request body.
 */
router.post('/mutation/confirm', async (req, res) => {
  try {
    const operationId = req.body?.operationId;
    const confirmationToken = req.body?.confirmationToken;
    const clientSql = req.body?.sql;

    if (clientSql && !operationId && !confirmationToken) {
      return res.status(400).json({
        success: false,
        type: 'mutation_error',
        error: 'Raw SQL cannot be executed from the client. Confirm with the server-issued operationId.',
      });
    }

    if (!operationId && !confirmationToken) {
      return res.status(400).json({
        success: false,
        type: 'mutation_error',
        error: 'operationId is required.',
      });
    }

    const userId = extractUserId(req);
    const result = await confirmAndExecuteOperation({
      operationId: operationId || null,
      confirmationToken: operationId ? null : confirmationToken,
      confirmationText: req.body?.confirmationText || '',
      userId,
    });
    return sendResult(res, result);
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
 * Reviews SQL. This endpoint does not execute SQL.
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
      error: 'Review failed.',
    });
  }
});

/**
 * GET /api/audit/reviews
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
    return res.status(500).json({ success: false, error: 'Failed to load review history.' });
  }
});

module.exports = router;
