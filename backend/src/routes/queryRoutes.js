// ============================================
// Query Routes — POST /api/query (Day 3)
// ============================================
// Endpoints:
//   POST /api/query          — Main query pipeline
//   POST /api/query/clarify  — Continue after clarification
//   GET  /api/query/suggestions — Schema-aware suggestions

const express = require('express');
const { processNaturalLanguageQuery, processClarifiedQuery, getQuerySuggestions, previewQuery } = require('../services/queryService');
const { getAuditLogs } = require('../services/auditService');
const { confirmAndExecuteOperation } = require('../services/confirmationService');

const router = express.Router();

const jwt = require('jsonwebtoken');
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
 * POST /api/query
 * Main query endpoint.
 */
router.post('/query', async (req, res) => {
  try {
    const question = req.body?.question || req.body?.query;

    if (!question || typeof question !== 'string' || question.trim().length === 0) {
      return res.status(400).json({
        success: false,
        type: 'query_error',
        error: 'Please enter a question.',
      });
    }

    const userId = extractUserId(req);
    const result = await processNaturalLanguageQuery(question, userId, {
      currentTable: req.body?.currentTable,
      connectionId: req.body?.connectionId,
    });

    const statusCode = result.statusCode || (result.success ? 200 : 400);
    const { statusCode: _statusCode, ...body } = result;
    return res.status(statusCode).json(body);

  } catch (err) {
    console.error('[ROUTE] Unexpected error:', err.message);
    return res.status(500).json({
      success: false,
      type: 'query_error',
      error: 'An unexpected error occurred. Please try again.',
    });
  }
});

/**
 * POST /api/query/confirm
 * Executes a previously staged operation by server-side operationId.
 * Ignores any SQL supplied by the client.
 */
router.post('/query/confirm', async (req, res) => {
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
    const statusCode = result.statusCode || (result.success ? 200 : 400);
    const { statusCode: _statusCode, ...body } = result;
    return res.status(statusCode).json(body);
  } catch (err) {
    console.error('[ROUTE] Confirm error:', err.message);
    return res.status(500).json({
      success: false,
      type: 'mutation_error',
      error: 'An unexpected error occurred. Please try again.',
    });
  }
});

/**
 * POST /api/query/preview
 * Previews query plan and generated SQL without executing.
 */
router.post('/query/preview', async (req, res) => {
  try {
    const { question } = req.body;
    if (!question || typeof question !== 'string' || question.trim().length === 0) {
      return res.status(400).json({ success: false, error: 'Question is required for preview.' });
    }
    const userId = extractUserId(req);
    const result = await previewQuery(question, userId);
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/query/clarify
 * Continue a query after the user selects a clarification option.
 * Body: { originalQuestion, selectedOption }
 */
router.post('/query/clarify', async (req, res) => {
  try {
    const { originalQuestion, selectedOption } = req.body;

    if (!originalQuestion || !selectedOption) {
      return res.status(400).json({
        success: false,
        type: 'query_error',
        error: 'Original question and selected option are required.',
      });
    }

    const userId = extractUserId(req);
    const result = await processClarifiedQuery(originalQuestion, selectedOption, userId);

    const statusCode = result.success ? 200 : 400;
    return res.status(statusCode).json(result);

  } catch (err) {
    console.error('[ROUTE] Clarify error:', err.message);
    return res.status(500).json({
      success: false,
      type: 'query_error',
      error: 'An unexpected error occurred. Please try again.',
    });
  }
});

/**
 * GET /api/query/suggestions
 * Get schema-aware query suggestions.
 */
router.get('/query/suggestions', async (req, res) => {
  try {
    const userId = extractUserId(req);
    const suggestions = await getQuerySuggestions(userId);

    return res.json({
      success: true,
      suggestions,
    });
  } catch (err) {
    console.error('[ROUTE] Suggestions error:', err.message);
    return res.json({
      success: true,
      suggestions: [],
    });
  }
});

/**
 * GET /api/query/audit
 * Retrieves audit log metadata for user.
 */
router.get('/query/audit', async (req, res) => {
  try {
    const userId = extractUserId(req);
    const logs = getAuditLogs({ userId, limit: 50 });
    return res.json({ success: true, logs });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
