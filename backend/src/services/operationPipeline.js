// ============================================
// Operation Pipeline — Stage DML and DDL
// ============================================
// Generates SQL, validates it locally, reviews it, and stores
// an immutable pending operation. The client receives an operationId.
// It never sends SQL back for the server to execute blindly.

const { getDatabaseSchema } = require('./schemaService');
const { getUserAdapter } = require('./connectionManager');
const { generateMutationPlan, estimateAffectedRows } = require('./mutationService');
const { generateDDLPlan, detectDDLIntent } = require('./ddlService');
const { validateQuery } = require('../utils/sqlValidator');
const { reviewSQL } = require('./sqlReviewService');
const { createPendingOperation } = require('./pendingOperationStore');
const { classifyQuery, QUERY_CATEGORIES } = require('./queryClassifier');

function publicReview(review) {
  if (!review) return null;
  return {
    approved: review.approved,
    risk: review.risk,
    operation: review.operation,
    semantic_match: review.semantic_match,
    issues: review.issues || [],
    reason: review.reason,
    suggested_operation: review.suggested_operation || null,
    suggested_sql: review.suggested_sql || null,
    source: review.source || 'local_validation',
    reviewUnavailable: Boolean(review.reviewUnavailable),
  };
}

/**
 * Stage a natural-language modification or DDL request.
 * Does not execute SQL.
 *
 * @param {string} question
 * @param {number|string|null} userId
 * @returns {Promise<object>}
 */
async function stageNaturalLanguageOperation(question, userId = null, options = {}) {
  const trimmed = String(question || '').replace(/^@vendor\s+/i, '').trim();
  if (!trimmed) {
    return {
      success: false,
      statusCode: 400,
      type: 'mutation_error',
      error: 'Please enter a question describing what you want to do.',
    };
  }

  const classification = classifyQuery(trimmed);
  const ddlIntent = detectDDLIntent(trimmed);
  const isDDL = classification.category === QUERY_CATEGORIES.DDL || Boolean(ddlIntent);

  let adapter;
  try {
    adapter = await getUserAdapter(userId);
  } catch (err) {
    return {
      success: false,
      statusCode: 400,
      type: 'mutation_error',
      error: 'Database not connected. Please connect a database first.',
    };
  }

  const dbType = adapter.type || 'postgres';
  if (dbType === 'mongodb') {
    return {
      success: false,
      statusCode: 400,
      type: 'mutation_error',
      error: 'Write and schema changes are not supported for MongoDB through natural language.',
    };
  }

  let schema;
  try {
    schema = await getDatabaseSchema(false, adapter, userId);
  } catch (err) {
    return {
      success: false,
      statusCode: 400,
      type: 'mutation_error',
      error: 'Unable to read the database schema. Check the connection and try again.',
    };
  }

  const tableCount = Object.keys(schema?.tables || {}).length;
  if (!isDDL && tableCount === 0) {
    return {
      success: false,
      statusCode: 400,
      type: 'mutation_error',
      error: 'No tables found in the connected database.',
    };
  }

  let plan;
  try {
    const scoped = options.currentTable && schema?.tables
      && !Object.keys(schema.tables).some((name) => new RegExp(`\\b${name}\\b`, 'i').test(trimmed))
      ? `${trimmed} from ${options.currentTable}`
      : trimmed;
    plan = isDDL
      ? generateDDLPlan(trimmed, schema, dbType)
      : generateMutationPlan(scoped, schema, dbType);
  } catch (planErr) {
    return {
      success: false,
      statusCode: 400,
      type: 'mutation_error',
      error: planErr.message || 'Could not generate a database operation from that request.',
    };
  }

  const sqlOp = (plan.sql || '').trim().match(/^(\w+)/)?.[1]?.toUpperCase() || plan.intent;
  const validationMode = ['CREATE', 'ALTER', 'DROP', 'TRUNCATE'].includes(sqlOp) ? 'ddl' : 'write';
  const validation = validateQuery(plan.sql, schema, dbType, validationMode);
  if (!validation.valid) {
    return {
      success: false,
      statusCode: 400,
      type: 'validation_error',
      error: validation.error,
      layer: validation.layer,
      sql: plan.sql,
      intent: plan.intent,
      category: isDDL ? QUERY_CATEGORIES.DDL : QUERY_CATEGORIES.DATABASE_MODIFICATION,
    };
  }

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
    review = {
      approved: false,
      risk: plan.riskLevel === 'CRITICAL' ? 'CRITICAL' : 'HIGH',
      operation: plan.intent,
      semantic_match: false,
      issues: ['AI safety review failed unexpectedly.'],
      reason: 'AI safety review unavailable. The database operation was not executed.',
      source: 'local_security_layer',
      reviewUnavailable: true,
    };
  }

  const approved = Boolean(review?.approved);
  const risk = review?.risk || (plan.riskLevel === 'CRITICAL' ? 'CRITICAL' : plan.riskLevel === 'HIGH' ? 'HIGH' : 'MEDIUM');

  let estimatedRows = plan.estimatedRows ?? null;
  if (approved && (plan.intent === 'UPDATE' || plan.intent === 'DELETE') && estimatedRows == null) {
    try {
      estimatedRows = await estimateAffectedRows(plan.sql, adapter, dbType);
    } catch {
      estimatedRows = null;
    }
  }

  if (approved && (plan.intent === 'UPDATE' || plan.intent === 'DELETE')) {
    if (estimatedRows === 0) {
      return {
        success: false,
        statusCode: 400,
        type: 'no_match',
        error: 'No matching row was found. No database changes were made.',
        sql: plan.sql,
        intent: plan.intent,
        targetTable: plan.targetTable,
      };
    }
    const explicitMass = /\b(everyone|everybody|all\s+(rows|records|students|of them)|entire\s+table)\b/i.test(trimmed);
    if (estimatedRows > 1 && !explicitMass) {
      return {
        success: false,
        statusCode: 400,
        type: 'needs_disambiguation',
        error: `Multiple matching rows found. ${estimatedRows} rows would be changed. Specify an id, department, or another unique value.`,
        estimatedRows,
        sql: plan.sql,
        intent: plan.intent,
        targetTable: plan.targetTable,
      };
    }
  }

  const confirmPhrase = approved && (plan.intent === 'DROP' || plan.intent === 'TRUNCATE')
    ? `${plan.intent} ${plan.targetTable}`
    : null;

  let operationId = null;
  if (approved) {
    operationId = createPendingOperation({
      sql: plan.sql,
      intent: plan.intent,
      targetTable: plan.targetTable,
      riskLevel: risk,
      review: publicReview(review),
      userId,
      dbType,
      confirmPhrase,
    });
  }

  return {
    success: true,
    statusCode: 200,
    type: approved ? 'confirmation_required' : 'operation_blocked',
    category: isDDL ? QUERY_CATEGORIES.DDL : QUERY_CATEGORIES.DATABASE_MODIFICATION,
    question: trimmed,
    intent: plan.intent,
    targetTable: plan.targetTable,
    sql: plan.sql,
    riskLevel: risk,
    warnings: plan.warnings || [],
    hasWhereClause: plan.hasWhereClause,
    estimatedRows,
    dbType,
    requiresConfirmation: approved,
    canConfirm: approved,
    operationId,
    // Legacy field: value is the server operation id, never a client-supplied SQL string.
    confirmationToken: operationId,
    confirmPhrase,
    review: publicReview(review),
  };
}

module.exports = {
  stageNaturalLanguageOperation,
};
