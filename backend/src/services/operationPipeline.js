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
const { analyzeLanguage } = require('./languageService');

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
  const trimmed = String(question || '').replace(/^@Intellaa\s+/i, '').trim();
  if (!trimmed) {
    return {
      success: false,
      statusCode: 400,
      type: 'mutation_error',
      error: 'Please enter a question describing what you want to do.',
    };
  }

  const languagePreview = analyzeLanguage(trimmed);
  if (languagePreview.status === 'clarification' || languagePreview.status === 'ambiguous') {
    return {
      success: false,
      statusCode: 400,
      type: 'clarification_required',
      message: languagePreview.message,
      options: languagePreview.options || [],
      language: languagePreview.language,
      normalizedRequest: languagePreview.normalized_request,
      sql: null,
    };
  }
  const routeText = languagePreview.language === 'english'
    ? trimmed
    : (options.normalizedRequest || languagePreview.normalized_request || trimmed);
  const classification = classifyQuery(routeText);
  const ddlIntent = detectDDLIntent(routeText);
  const isDDL = classification.category === QUERY_CATEGORIES.DDL || Boolean(ddlIntent);

  let adapter;
  try {
    adapter = await getUserAdapter(userId);
  } catch (err) {
    return {
      success: false,
      statusCode: err.statusCode || 400,
      type: 'mutation_error',
      error: err.statusCode === 401
        ? 'Authentication required.'
        : 'Database not connected. Please connect a database first.',
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

  let workingQuestion = options.normalizedRequest || trimmed;
  const resolvedLanguage = analyzeLanguage(trimmed, schema);
  if (resolvedLanguage.language !== 'english') {
    if (resolvedLanguage.status === 'clarification' || resolvedLanguage.status === 'ambiguous') {
      return {
        success: false,
        statusCode: 400,
        type: 'clarification_required',
        message: resolvedLanguage.message,
        options: resolvedLanguage.options || [],
        language: resolvedLanguage.language,
        normalizedRequest: resolvedLanguage.normalized_request,
        sql: null,
      };
    }
    workingQuestion = resolvedLanguage.normalized_request;
  }

  let plan;
  try {
    const scoped = options.currentTable && schema?.tables
      && !Object.keys(schema.tables).some((name) => new RegExp(`\\b${name}\\b`, 'i').test(workingQuestion))
      ? `${workingQuestion} from ${options.currentTable}`
      : workingQuestion;
    plan = isDDL
      ? generateDDLPlan(workingQuestion, schema, dbType, options.currentTable)
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
  const explicitMass = /\b(everyone|everybody|all\s+(rows|records|students|of them)|entire\s+table)\b/i.test(workingQuestion);
  const allowMass = explicitMass
    && (plan.intent === 'UPDATE' || plan.intent === 'DELETE')
    && plan.hasWhereClause === false;
  const validation = validateQuery(plan.sql, schema, dbType, validationMode, { allowMass });
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
      naturalLanguageQuery: workingQuestion,
      generatedSQL: plan.sql,
      dbType,
      schema,
      operation: plan.intent,
      userId,
      columnValues: plan.columnValues || null,
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

  const confirmPhrase = approved && (plan.intent === 'DROP' || plan.intent === 'TRUNCATE' || allowMass)
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
      allowMass,
    });
  }

  return {
    success: true,
    statusCode: 200,
    type: approved ? 'confirmation_required' : 'operation_blocked',
    category: isDDL ? QUERY_CATEGORIES.DDL : QUERY_CATEGORIES.DATABASE_MODIFICATION,
    question: trimmed,
    language: resolvedLanguage.language,
    normalizedRequest: workingQuestion,
    intent: plan.intent,
    targetTable: plan.targetTable,
    sql: plan.sql,
    columnValues: plan.columnValues || null,
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
