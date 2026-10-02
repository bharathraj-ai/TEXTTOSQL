// ============================================
// Query Service — Main Orchestrator (Day 4)
// ============================================
// 12-Step Production Pipeline:
// 1. Validate Question Input
// 2. Resolve User Database Adapter (Multi-User Isolation)
// 3. Schema Discovery & Relevance Filtering
// 4. Intent Classification & Ambiguity Detection
// 5. Query Planning (Formal plan & confidence scoring)
// 6. User-Isolated Query Caching Check
// 7. Local rule-based SQL / MQL generation (not a trained model)
// 8. 3-Layer Validation (Syntax, Schema, Security)
// 9. Conservative EXPLAIN / Cost Check
// 10. Execution with 5-Second Timeout & 100-Row Limit
// 11. Error Recovery Loop (Max 2 Attempts)
// 12. Result Sanitization & Secret Redaction
// 13. Result Type Classification (SINGLE_VALUE, GROUPED_DATA, TIME_SERIES, TABULAR)
// 14. Concise Numbered Explanation Generation
// 15. Audit Logging (Zero Credentials Stored)
//
// Read queries use the local rule engine, then optional OpenRouter review.
// Conversation is handled by Groq and never touches the database.

const { getDatabaseSchema, getRelevantSchema, shouldGenerateSQL } = require('./schemaService');
const { generateSQL, correctSQL, generateExplanation, generateSuggestions } = require('./llmService');
const { executeSQL } = require('./sqlService');
const { validateQuery, validateSQL } = require('../utils/sqlValidator');
const { getUserAdapter } = require('./connectionManager');
const { classifyIntent } = require('./intentService');
const { createQueryPlan } = require('./queryPlanner');
const { logQuery } = require('./auditService');
const { getCachedQuery, setCachedQuery } = require('./queryCache');
const { reviewSQL } = require('./sqlReviewService');
const { classifyQuery, QUERY_CATEGORIES } = require('./queryClassifier');
const { analyzeLanguage } = require('./languageService');
const { handleConversation } = require('./groqService');
const { stageNaturalLanguageOperation } = require('./operationPipeline');
const { assertUserConnection } = require('./connectionManager');
const { logSafeSql, safeErrorMessage } = require('../utils/safeLog');

function stripIntellaaPrefix(text) {
  return String(text || '').replace(/^@Intellaa\s+/i, '').trim();
}

function withCurrentTable(question, currentTable, schema) {
  const names = Object.keys(schema?.tables || {});
  const real = names.find((name) => name.toLowerCase() === String(currentTable || '').toLowerCase());
  if (!real) return question;
  const mentioned = names.some((name) => new RegExp(`\\b${name}\\b`, 'i').test(question));
  return mentioned ? question : `${question} from ${real}`;
}

// Maximum correction attempts before giving up
const MAX_CORRECTION_ATTEMPTS = 2;

/**
 * Classifies result structure for Day 5 visualization readiness.
 */
function classifyResultType(columns, rows, plan) {
  if (!rows || rows.length === 0) return 'TABULAR';

  // 1. Single value: 1 row, 1 column
  if (rows.length === 1 && columns.length === 1) {
    return 'SINGLE_VALUE';
  }

  // 2. Time series: has date column + numeric metric
  const hasDateCol = columns.some((c) => /date|time|created_at|updated_at|day|month|year/i.test(c));
  const hasNumCol = columns.some((c) => /count|avg|average|sum|total|amount|revenue|price|score|mark/i.test(c));
  if (hasDateCol && hasNumCol) {
    return 'TIME_SERIES';
  }

  // 3. Grouped data: categorical grouping with numeric metric (e.g. department + avg_mark)
  if (plan?.groupBy?.length > 0 || (columns.length === 2 && hasNumCol)) {
    return 'GROUPED_DATA';
  }

  return 'TABULAR';
}

/**
 * Sanitizes returned rows: masks any leaked tokens, connection strings, or hashes,
 * and formats MongoDB BSON values into standard JSON.
 */
function sanitizeResultData(columns, rows) {
  if (!Array.isArray(rows)) return { columns: columns || [], rows: [] };

  const sanitizedRows = rows.map((row) => {
    if (!row || typeof row !== 'object') return row;
    const cleanRow = {};
    for (const [key, val] of Object.entries(row)) {
      // Sensitive column names
      if (/password|secret|token|hash|encrypted_url/i.test(key)) {
        cleanRow[key] = '[REDACTED]';
        continue;
      }
      // Sensitive string patterns
      if (typeof val === 'string') {
        if (
          /postgres(ql)?:\/\/|mongodb(\+srv)?:\/\/|mysql:\/\//i.test(val) ||
          /^eyJ[a-zA-Z0-9_-]{10,}\./.test(val) ||
          /^\$2[aby]\$[0-9]{2}\$[./A-Za-z0-9]{53}$/.test(val)
        ) {
          cleanRow[key] = '[REDACTED]';
          continue;
        }
      }
      // MongoDB BSON conversions
      if (val && typeof val === 'object') {
        if (typeof val.toHexString === 'function') {
          cleanRow[key] = val.toHexString();
          continue;
        }
        if (val instanceof Date) {
          cleanRow[key] = val.toISOString();
          continue;
        }
        if (typeof val.toString === 'function' && val._bsontype === 'Decimal128') {
          cleanRow[key] = parseFloat(val.toString());
          continue;
        }
      }
      cleanRow[key] = val;
    }
    return cleanRow;
  });

  return { columns: columns || [], rows: sanitizedRows };
}

/**
 * Conservative EXPLAIN cost check for relational queries.
 */
async function checkQueryCost(sql, adapter, dbType) {
  if (!sql || dbType === 'mongodb') return { safe: true };
  const clean = sql.replace(/;+\s*$/, '').trim();

  try {
    let explainSql = '';
    if (dbType === 'postgres') {
      explainSql = `EXPLAIN (FORMAT JSON) ${clean};`;
    } else if (dbType === 'mysql') {
      explainSql = `EXPLAIN ${clean};`;
    } else if (dbType === 'sqlite') {
      explainSql = `EXPLAIN QUERY PLAN ${clean};`;
    }

    if (!explainSql) return { safe: true };

    const explainResult = await adapter.executeQuery(explainSql);
    let warning = null;

    if (dbType === 'postgres' && explainResult.rows?.[0]?.[0]?.Plan) {
      const plan = explainResult.rows[0][0].Plan;
      const totalCost = plan['Total Cost'] || 0;
      if (totalCost > 100000) {
        warning = 'This query may scan a large amount of data.';
      }
    }

    return { safe: true, warning };
  } catch (err) {
    return { safe: true };
  }
}

/**
 * Process a natural language question end-to-end.
 *
 * @param {string} question - The user's input
 * @param {number|string} [userId] - Authenticated user ID
 * @returns {Promise<object>} - Structured response object
 */
async function processNaturalLanguageQuery(question, userId = null, options = {}) {
  const startTime = Date.now();

  // ── 1. Validate question ────────────────────────────
  if (!question || typeof question !== 'string' || question.trim().length === 0) {
    return {
      success: false,
      type: 'query_error',
      error: 'Please enter a question or SQL query.',
    };
  }

  const originalQuestion = stripIntellaaPrefix(question.trim());
  const languagePreview = analyzeLanguage(originalQuestion);
  if (languagePreview.status === 'clarification' || languagePreview.status === 'ambiguous') {
    return {
      success: false,
      type: 'clarification_required',
      message: languagePreview.message,
      options: languagePreview.options || [],
      language: languagePreview.language,
      normalizedRequest: languagePreview.normalized_request,
      sql: null,
    };
  }
  let trimmedQuestion = languagePreview.language === 'english'
    ? originalQuestion
    : languagePreview.normalized_request;
  console.log(`\n${'═'.repeat(50)}`);
  console.log(`[QUERY] User: ${userId} | Question length: ${originalQuestion.length}`);

  // ── 1b. Classify before any database or SQL work ──
  const classification = classifyQuery(trimmedQuestion);
  console.log(`[CLASSIFY] ${classification.category} (${classification.confidence})`);

  if (classification.category === QUERY_CATEGORIES.CONVERSATION) {
    const convo = await handleConversation(trimmedQuestion);
    return {
      success: true,
      type: 'conversation',
      category: QUERY_CATEGORIES.CONVERSATION,
      question: originalQuestion,
      language: languagePreview.language,
      normalizedRequest: null,
      message: convo.message,
      source: convo.source,
      model: convo.model || null,
      sql: null,
    };
  }

  if (
    classification.category === QUERY_CATEGORIES.DATABASE_MODIFICATION ||
    classification.category === QUERY_CATEGORIES.DDL
  ) {
    return stageNaturalLanguageOperation(originalQuestion, userId, {
      ...options,
      normalizedRequest: languagePreview.language === 'english' ? null : languagePreview.normalized_request,
    });
  }

  if (userId && options.connectionId) {
    try {
      await assertUserConnection(userId, options.connectionId);
    } catch (err) {
      return {
        success: false,
        statusCode: err.statusCode || 403,
        type: 'query_error',
        error: err.message,
      };
    }
  }

  // ── 2. Resolve user database adapter ───────────────
  let adapter;
  try {
    adapter = await getUserAdapter(userId);
  } catch (err) {
    console.error(`[ADAPTER] Error: ${safeErrorMessage(err)}`);
    return {
      success: false,
      statusCode: err.statusCode || 400,
      type: 'query_error',
      error: err.statusCode === 401
        ? 'Authentication required.'
        : 'Database not connected. Please connect a database first.',
    };
  }

  const dbType = adapter.type || 'postgres';
  const dbIdentifier = `${dbType}:${adapter.databaseName || 'default'}`;

  // ── 3. Check User-Isolated Query Cache ─────────────
  const cached = getCachedQuery(userId, dbIdentifier, trimmedQuestion);
  if (cached) {
    console.log(`[QUERY] Served from user query cache for [${userId}]`);
    return cached;
  }

  // ── 4. Get full database schema (cached) ────────────
  let fullSchema;
  try {
    fullSchema = await getDatabaseSchema(false, adapter, userId);
  } catch (err) {
    console.error('[SCHEMA] Error:', err.message);
    return {
      success: false,
      type: 'query_error',
      error: 'Unable to connect to the database. Please check your database connection.',
    };
  }

  const tableNames = Object.keys(fullSchema.tables || {});
  if (tableNames.length === 0) {
    return {
      success: false,
      type: 'query_error',
      error: 'No tables found in the connected database. Please verify your database has tables.',
    };
  }

  if (languagePreview.language !== 'english') {
    const resolved = analyzeLanguage(originalQuestion, fullSchema);
    if (resolved.status === 'clarification' || resolved.status === 'ambiguous') {
      return {
        success: false,
        type: 'clarification_required',
        message: resolved.message,
        options: resolved.options || [],
        language: resolved.language,
        normalizedRequest: resolved.normalized_request,
        sql: null,
      };
    }
    trimmedQuestion = resolved.normalized_request;
  }

  // ── 5. Classify intent & Guardrails ─────────────────
  const intentResult = classifyIntent(trimmedQuestion, fullSchema);
  console.log(`[INTENT] ${JSON.stringify(intentResult.intents)}`);

  // 5b. Mutation check
  if (intentResult.isMutation) {
    logQuery({
      userId,
      databaseType: dbType,
      queryType: 'MUTATION_BLOCKED',
      query: trimmedQuestion,
      success: false,
      executionTimeMs: Date.now() - startTime,
      errorType: 'mutation_blocked',
    });
    return {
      success: false,
      type: 'query_error',
      error: 'Security restriction: Only read-only SELECT queries are allowed. Modification operations are not permitted.',
    };
  }

  // 5c. Secret request check
  if (intentResult.isSecretRequest) {
    logQuery({
      userId,
      databaseType: dbType,
      queryType: 'SECRET_BLOCKED',
      query: trimmedQuestion,
      success: false,
      executionTimeMs: Date.now() - startTime,
      errorType: 'secret_blocked',
    });
    return {
      success: false,
      type: 'query_error',
      error: 'I cannot provide system credentials, passwords, or environment variables.',
    };
  }

  // 5d. Unsupported question check
  if (intentResult.isUnsupported) {
    return {
      success: false,
      type: 'unsupported_question',
      message: 'This question cannot be answered using the connected database. Try asking something about your data.',
    };
  }

  // 5e. Ambiguous question check
  if (intentResult.isAmbiguous && intentResult.ambiguousDetail) {
    console.log(`[INTENT] Ambiguous question: "${intentResult.ambiguousDetail.term}"`);
    return {
      success: false,
      type: 'clarification_required',
      message: intentResult.ambiguousDetail.message,
      options: intentResult.ambiguousDetail.options,
      originalQuestion: trimmedQuestion,
    };
  }

  // ── 6. Select relevant schema tables ────────────────
  const retrieval = getRelevantSchema(trimmedQuestion, fullSchema);
  console.log(`[SCHEMA] ${retrieval.status} confidence=${retrieval.confidence} tables=${(retrieval.matchedTables || []).join(', ') || '(none)'}`);

  if (retrieval.status === 'NOT_FOUND') {
    return {
      success: false,
      type: 'entity_not_found',
      status: 'NOT_FOUND',
      confidence: 0,
      requestedEntities: retrieval.requestedEntities,
      matchedTables: [],
      message: retrieval.message,
      error: retrieval.message,
      sql: null,
    };
  }

  if (retrieval.status === 'AMBIGUOUS') {
    return {
      success: false,
      type: 'clarification_required',
      status: 'AMBIGUOUS',
      confidence: retrieval.confidence,
      requestedEntities: retrieval.requestedEntities,
      matchedTables: retrieval.matchedTables,
      message: retrieval.message,
      options: retrieval.options,
      originalQuestion: trimmedQuestion,
      sql: null,
    };
  }

  if (retrieval.status === 'GENERAL_SCHEMA') {
    const names = Object.keys(fullSchema.tables || {});
    const relationshipCount = (fullSchema.relationships || []).length;
    return {
      success: true,
      type: 'schema_overview',
      status: 'GENERAL_SCHEMA',
      confidence: 1,
      matchedTables: names,
      sql: null,
      message: `Your connected database has ${names.length} tables: ${names.join(', ')}. ${relationshipCount} relationship${relationshipCount === 1 ? '' : 's'} were found.`,
    };
  }

  if (!shouldGenerateSQL(retrieval)) {
    return {
      success: false,
      type: 'entity_not_found',
      status: retrieval.status,
      confidence: retrieval.confidence || 0,
      message: retrieval.message || 'I could not identify a table for that question.',
      error: retrieval.message || 'I could not identify a table for that question.',
      sql: null,
    };
  }

  const relevantSchema = {
    tables: retrieval.tables,
    relationships: retrieval.relationships,
  };

  // ── 7. Build Query Plan (Formal Non-Executing Planner)
  let queryPlan;
  try {
    queryPlan = createQueryPlan(trimmedQuestion, relevantSchema, dbType);
    console.log(`[PLAN] Intent: ${queryPlan.intent} | Tables: ${queryPlan.tables.join(', ')} | Confidence: ${queryPlan.confidence}`);
  } catch (planErr) {
    console.warn(`[PLAN] Planning note: ${planErr.message}`);
  }

  // Confidence Check
  if (queryPlan && queryPlan.confidence < 0.35) {
    return {
      success: false,
      type: 'low_confidence',
      confidence: queryPlan.confidence,
      message: 'I need clarification before running this query.',
      plan: queryPlan,
    };
  }

  // ── 8. Generate Query (local rule-based engine) ─────
  let sql;
  try {
    sql = generateSQL(withCurrentTable(trimmedQuestion, options.currentTable, fullSchema), relevantSchema, intentResult.intents, dbType);
  } catch (err) {
    console.error('[SQL] Generation error:', err.message);
    logQuery({
      userId,
      databaseType: dbType,
      queryType: 'GENERATE_FAILED',
      query: trimmedQuestion,
      success: false,
      executionTimeMs: Date.now() - startTime,
      errorType: 'generation_error',
    });
    return {
      success: false,
      type: 'query_error',
      error: err.message || 'Failed to generate query from the given question.',
    };
  }

  logSafeSql(`[QUERY] Generated (${dbType}):`, sql);

  // ── 9. 3-Layer Validation (Syntax, Schema, Security) ─
  const validation = validateQuery(sql, fullSchema, dbType);
  if (!validation.valid) {
    console.log(`[VALIDATION] Layer ${validation.layer} FAILED: ${validation.error}`);
    logQuery({
      userId,
      databaseType: dbType,
      queryType: 'VALIDATION_FAILED',
      query: sql,
      success: false,
      executionTimeMs: Date.now() - startTime,
      errorType: `layer_${validation.layer}_validation_failed`,
    });
    return {
      success: false,
      type: 'query_error',
      error: validation.error,
      layer: validation.layer,
      sql,
      dbType,
    };
  }

  console.log('[VALIDATION] 3-Layer Checks PASSED');

  // ── 9.5 OpenRouter Semantic SQL Reviewer & Risk Assessment ─
  let safetyReview = null;
  try {
    safetyReview = await reviewSQL({
      naturalLanguageQuery: trimmedQuestion,
      generatedSQL: sql,
      dbType,
      schema: fullSchema,
      operation: 'SELECT',
      userId,
    });
  } catch (revErr) {
    console.warn(`[REVIEW] Note: ${revErr.message}`);
  }

  // If safety review rejected and fallback is not allowed, block execution!
  if (safetyReview && !safetyReview.approved && !safetyReview.fallbackAllowed) {
    console.log(`[REVIEW] Safety review REJECTED: ${safetyReview.reason}`);
    logQuery({
      userId,
      databaseType: dbType,
      queryType: 'SAFETY_REVIEW_REJECTED',
      query: sql,
      success: false,
      executionTimeMs: Date.now() - startTime,
      errorType: 'safety_review_rejected',
    });
    return {
      success: false,
      type: 'safety_review_rejected',
      error: safetyReview.reason || 'AI safety review rejected the generated SQL.',
      issues: safetyReview.issues || [],
      risk: safetyReview.risk || 'HIGH',
      sql,
      review: safetyReview,
    };
  }

  // ── 10. Conservative EXPLAIN Cost Check ─────────────
  const costCheck = await checkQueryCost(sql, adapter, dbType);

  // ── 11. Execute Query (with error recovery loop) ─────
  let result;
  let currentSQL = sql;
  let attempts = 0;
  let lastError = null;

  while (attempts <= MAX_CORRECTION_ATTEMPTS) {
    try {
      result = await executeSQL(currentSQL, fullSchema, adapter);
      lastError = null;
      break; // Success!
    } catch (err) {
      lastError = err;
      attempts++;

      console.log(`[DATABASE] Error (attempt ${attempts}): ${safeErrorMessage(err)}`);

      // Never retry on security rejections or timeouts
      if (
        err.message.includes('timed out') ||
        err.message.includes('not allowed') ||
        err.message.includes('not permitted') ||
        err.message.includes('not recognized')
      ) {
        break;
      }

      // Attempt correction if within max attempts
      if (attempts <= MAX_CORRECTION_ATTEMPTS) {
        console.log(`[CORRECTION] Attempt ${attempts} of ${MAX_CORRECTION_ATTEMPTS}...`);

        try {
          const correctedSQL = correctSQL(
            trimmedQuestion,
            currentSQL,
            err.message,
            fullSchema,
            dbType
          );

          if (correctedSQL && correctedSQL !== currentSQL) {
            logSafeSql('[CORRECTION] Corrected SQL:', correctedSQL);

            // Re-validate the corrected SQL through 3-layer validation
            const reValidation = validateQuery(correctedSQL, fullSchema, dbType);
            if (!reValidation.valid) {
              console.log(`[CORRECTION] Re-validation failed: ${reValidation.error}`);
              break;
            }

            currentSQL = correctedSQL;
            console.log('[CORRECTION] Re-validation PASSED');
          } else {
            console.log('[CORRECTION] No correction available');
            break;
          }
        } catch (correctionErr) {
          console.error('[CORRECTION] Error:', correctionErr.message);
          break;
        }
      }
    }
  }

  // Handle Failure
  if (lastError) {
    console.log(`[DATABASE] All attempts failed: ${safeErrorMessage(lastError)}`);
    logQuery({
      userId,
      databaseType: dbType,
      queryType: 'EXECUTION_FAILED',
      query: currentSQL,
      success: false,
      executionTimeMs: Date.now() - startTime,
      errorType: 'database_execution_failed',
    });

    const isTimeout = lastError.message.includes('timed out') || lastError.message.includes('timeout');
    if (isTimeout) {
      return {
        success: false,
        type: 'query_timeout',
        message: 'The query took too long to execute.',
      };
    }

    const safeError = sanitizeError(lastError.message);
    return {
      success: false,
      type: 'query_error',
      error: safeError,
      sql: currentSQL,
    };
  }

  // ── 12. Result Sanitization & Secret Redaction ───────
  const sanitized = sanitizeResultData(result.columns, result.rows);
  const resultType = classifyResultType(sanitized.columns, sanitized.rows, queryPlan);

  // ── 13. Generate Concise Numbered Explanation ────────
  const explanation = generateExplanation(currentSQL, trimmedQuestion);

  // ── 14. Audit Logging & User-Isolated Caching ────────
  const executionTimeMs = result.executionTime || (Date.now() - startTime);
  logQuery({
    userId,
    databaseType: dbType,
    queryType: queryPlan?.intent || 'SELECT',
    query: currentSQL,
    success: true,
    executionTimeMs,
    rowCount: sanitized.rows.length,
  });

  const responsePayload = {
    success: true,
    type: 'query_result',
    category: QUERY_CATEGORIES.DATABASE_QUERY,
    question: originalQuestion,
    language: languagePreview.language,
    normalizedRequest: trimmedQuestion,
    sql: currentSQL,
    dbType,
    explanation,
    columns: sanitized.columns,
    rows: sanitized.rows,
    executionTime: executionTimeMs,
    rowCount: sanitized.rows.length,
    confidence: queryPlan?.confidence ?? 0.90,
    resultType,
    warning: costCheck.warning || null,
    review: safetyReview ? {
      approved: safetyReview.approved,
      risk: safetyReview.risk,
      operation: safetyReview.operation,
      semantic_match: safetyReview.semantic_match,
      issues: safetyReview.issues,
      reason: safetyReview.reason,
      suggested_operation: safetyReview.suggested_operation,
      suggested_sql: safetyReview.suggested_sql,
      source: safetyReview.source,
    } : {
      approved: true,
      risk: 'LOW',
      operation: 'SELECT',
      semantic_match: true,
      issues: [],
      reason: 'Local validation passed.',
      source: 'local_validation',
    },
  };

  // Cache query result for this user (TTL 60s)
  setCachedQuery(userId, dbIdentifier, trimmedQuestion, responsePayload);

  console.log(`[COMPLETE] Rows: ${sanitized.rows.length}, ${executionTimeMs}ms DB, Type: ${resultType}`);
  console.log('═'.repeat(50));

  return responsePayload;
}

/**
 * Continue a query after user selects a clarification option.
 */
async function processClarifiedQuery(originalQuestion, selectedOption, userId = null) {
  let clarifiedQuestion;
  if (/today|yesterday|last \d+ days/i.test(selectedOption)) {
    clarifiedQuestion = `${originalQuestion} from ${selectedOption.toLowerCase()}`;
  } else {
    clarifiedQuestion = `${originalQuestion} (measured by: ${selectedOption})`;
  }
  console.log(`[CLARIFY] Original: "${originalQuestion}" → Clarified: "${clarifiedQuestion}"`);
  return processNaturalLanguageQuery(clarifiedQuestion, userId);
}

/**
 * Preview a query without executing it.
 */
async function previewQuery(question, userId = null) {
  if (!question || typeof question !== 'string') {
    return { success: false, error: 'Question is required for preview.' };
  }

  const adapter = await getUserAdapter(userId);
  const dbType = adapter.type || 'postgres';
  const fullSchema = await getDatabaseSchema(false, adapter, userId);
  const retrieval = getRelevantSchema(question, fullSchema);
  if (!shouldGenerateSQL(retrieval)) {
    return {
      success: false,
      status: retrieval.status,
      confidence: retrieval.confidence,
      matchedTables: retrieval.matchedTables,
      message: retrieval.message,
      options: retrieval.options,
      sql: null,
    };
  }
  const relevantSchema = {
    tables: retrieval.tables,
    relationships: retrieval.relationships,
  };
  const intentResult = classifyIntent(question, fullSchema);

  const plan = createQueryPlan(question, relevantSchema, dbType);
  const sql = generateSQL(question, relevantSchema, intentResult.intents, dbType);
  const validation = validateQuery(sql, fullSchema, dbType);
  const cost = await checkQueryCost(sql, adapter, dbType);

  return {
    success: true,
    database: dbType,
    tables: plan.tables,
    operation: 'Read-only',
    estimatedRows: cost.estimatedRows || null,
    warning: cost.warning || null,
    sql,
    plan,
    valid: validation.valid,
  };
}

/**
 * Get schema-aware query suggestions for the user.
 */
async function getQuerySuggestions(userId = null) {
  try {
    const adapter = await getUserAdapter(userId);
    const schema = await getDatabaseSchema(false, adapter, userId);
    return generateSuggestions(schema);
  } catch (err) {
    console.error('[SUGGESTIONS] Error:', err.message);
    return [];
  }
}

/**
 * Sanitize database error messages to avoid exposing internals.
 */
function sanitizeError(message) {
  if (!message) return 'An unexpected database error occurred.';

  if (message.includes('connect') || message.includes('ECONNREFUSED')) {
    return 'Unable to connect to the database. Please try again later.';
  }

  const colMatch = message.match(/column "(\w+)" does not exist/i);
  if (colMatch) {
    return `The query referenced a column "${colMatch[1]}" that does not exist in your database.`;
  }

  const tableMatch = message.match(/relation "(\w+)" does not exist/i);
  if (tableMatch) {
    return `The query referenced a table "${tableMatch[1]}" that does not exist in your database.`;
  }

  if (message.includes('timed out') || message.includes('timeout')) {
    return 'Query execution timed out. The query took too long to execute.';
  }

  if (message.includes('syntax error')) {
    return `Database syntax error: ${message}`;
  }

  return message;
}

module.exports = {
  processNaturalLanguageQuery,
  processClarifiedQuery,
  getQuerySuggestions,
  previewQuery,
};
