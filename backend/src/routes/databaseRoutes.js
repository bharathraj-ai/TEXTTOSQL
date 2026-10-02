// ============================================
// Database Routes — Dynamic User Database Management
// ============================================
// Handles testing, connecting, inspecting, and disconnecting
// user-provided databases.

const express = require('express');
const { safeErrorMessage } = require('../utils/safeLog');
const authMiddleware = require('../middleware/authMiddleware');
const {
  testRawConnection,
  setUserConnection,
  removeUserConnection,
  getUserStatus,
  getUserAdapter,
  getUserPool,
  assertUserConnection,
} = require('../services/connectionManager');
const { browseTable, applyDirectChange } = require('../services/tableWorkspaceService');
const { computeTableAnalytics } = require('../services/analyticsService');
const {
  invalidateUserSchemaCache,
  getDatabaseSchema,
  getSchemaSummary,
} = require('../services/schemaService');
const { validateQuery } = require('../utils/sqlValidator');

const router = express.Router();

// All database management routes require authentication
router.use(authMiddleware);

/**
 * GET /api/database/status
 * Get the currently connected database details for logged-in user
 */
router.get('/status', async (req, res) => {
  try {
    const status = await getUserStatus(req.user.id);
    return res.json({
      success: true,
      ...status,
    });
  } catch (err) {
    console.error('[DATABASE_ROUTE] Status error:', safeErrorMessage(err));
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve database status.',
    });
  }
});

/**
 * POST /api/database/test
 * Test connectivity and discover tables for a given connection string
 * Body: { databaseUrl: string }
 */
router.post('/test', async (req, res) => {
  try {
    const { databaseUrl } = req.body;

    if (!databaseUrl || typeof databaseUrl !== 'string' || databaseUrl.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Please provide a PostgreSQL connection URL.',
      });
    }

    const testResult = await testRawConnection(databaseUrl);
    return res.json({
      success: true,
      message: 'Connection successful!',
      ...testResult,
    });
  } catch (err) {
    console.error('[DATABASE_ROUTE] Test error:', safeErrorMessage(err));
    return res.status(400).json({
      success: false,
      error: err.message || 'Connection test failed.',
    });
  }
});

/**
 * POST /api/database/connect
 * Connect and save a user's PostgreSQL database
 * Body: { connectionName?: string, databaseUrl: string }
 */
router.post('/connect', async (req, res) => {
  try {
    const { connectionName, databaseUrl } = req.body;

    if (!databaseUrl || typeof databaseUrl !== 'string' || databaseUrl.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Please provide a PostgreSQL connection URL.',
      });
    }

    const connectionInfo = await setUserConnection(req.user.id, connectionName, databaseUrl);

    // Invalidate schema cache so new database schema is re-discovered
    if (invalidateUserSchemaCache) {
      invalidateUserSchemaCache(req.user.id);
    }

    return res.json({
      success: true,
      message: 'Database connected successfully.',
      ...connectionInfo,
    });
  } catch (err) {
    console.error('[DATABASE_ROUTE] Connect error:', safeErrorMessage(err));
    return res.status(400).json({
      success: false,
      error: err.message || 'Failed to connect to the database.',
    });
  }
});

/**
 * POST /api/database/connect-default
 * Quick-connect to default Neon sample database
 */
router.post('/connect-default', async (req, res) => {
  try {
    const defaultUrl = process.env.DATABASE_URL;
    if (!defaultUrl) {
      return res.status(500).json({
        success: false,
        error: 'System default database is not configured.',
      });
    }

    const connectionInfo = await setUserConnection(
      req.user.id,
      'Neon Sample DB (Students)',
      defaultUrl
    );

    if (invalidateUserSchemaCache) {
      invalidateUserSchemaCache(req.user.id);
    }

    return res.json({
      success: true,
      message: 'Connected to Neon Sample Database.',
      ...connectionInfo,
    });
  } catch (err) {
    console.error('[DATABASE_ROUTE] Connect default error:', safeErrorMessage(err));
    return res.status(400).json({
      success: false,
      error: err.message || 'Failed to connect to default database.',
    });
  }
});

/**
 * POST /api/database/disconnect
 * Disconnect and remove saved database connection
 */
router.post('/disconnect', async (req, res) => {
  try {
    await removeUserConnection(req.user.id);

    if (invalidateUserSchemaCache) {
      invalidateUserSchemaCache(req.user.id);
    }

    return res.json({
      success: true,
      message: 'Database disconnected.',
      connected: false,
    });
  } catch (err) {
    console.error('[DATABASE_ROUTE] Disconnect error:', safeErrorMessage(err));
    return res.status(500).json({
      success: false,
      error: 'Failed to disconnect database.',
    });
  }
});

/**
 * GET /api/database/schema
 * Retrieve the current database schema and summary for the authenticated user
 */
router.get('/schema', async (req, res) => {
  try {
    const adapter = await getUserAdapter(req.user.id);
    const schema = await getDatabaseSchema(false, adapter, req.user.id);
    const summary = await getSchemaSummary(req.user.id, adapter);

    return res.json({
      success: true,
      schema,
      summary,
      dbType: adapter.type,
    });
  } catch (err) {
    console.error('[DATABASE_ROUTE] Schema error:', safeErrorMessage(err));
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve database schema.',
    });
  }
});

/**
 * GET /api/database/browse?table=name
 * Read-only page of one table that already exists in the user's schema.
 * The table name is checked against the schema. Client SQL is not accepted.
 */
router.get('/browse', async (req, res) => {
  try {
    const requested = String(req.query.table || '').trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(requested)) {
      return res.status(400).json({
        success: false,
        error: 'Choose a table from the sidebar.',
      });
    }

    const adapter = await getUserAdapter(req.user.id);
    const schema = await getDatabaseSchema(false, adapter, req.user.id);
    const tableName = Object.keys(schema.tables || {}).find(
      (name) => name.toLowerCase() === requested.toLowerCase()
    );

    if (!tableName) {
      return res.status(404).json({
        success: false,
        error: 'That table is not in the connected database.',
      });
    }

    const dbType = adapter.type || 'postgres';
    const quoted = dbType === 'mysql' ? `\`${tableName}\`` : `"${tableName}"`;
    const sql = `SELECT * FROM ${quoted} LIMIT 100`;
    const validation = validateQuery(sql, schema, dbType, 'read');
    if (!validation.valid) {
      return res.status(400).json({ success: false, error: validation.error });
    }

    const started = Date.now();
    const result = await adapter.executeQuery(sql);
    const tableInfo = schema.tables[tableName];
    const columns = Object.entries(tableInfo.columns || {}).map(([name, type]) => ({
      name,
      type: typeof type === 'string' ? type : 'text',
      primaryKey: (tableInfo.primaryKeys || []).includes(name),
    }));

    return res.json({
      success: true,
      table: tableName,
      columns,
      rows: result.rows || [],
      executionTime: result.executionTime || (Date.now() - started),
      rowCount: (result.rows || []).length,
    });
  } catch (err) {
    console.error('[DATABASE_ROUTE] Browse error:', safeErrorMessage(err));
    return res.status(500).json({
      success: false,
      error: 'Could not load table data.',
    });
  }
});

/**
 * GET /api/database/summary
 * Retrieve a compact text summary of the current schema
 */
router.get('/summary', async (req, res) => {
  try {
    const adapter = await getUserAdapter(req.user.id);
    const summary = await getSchemaSummary(req.user.id, adapter);

    return res.json({
      success: true,
      summary,
      dbType: adapter.type,
    });
  } catch (err) {
    console.error('[DATABASE_ROUTE] Summary error:', safeErrorMessage(err));
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve schema summary.',
    });
  }
});

function analyticsError(err) {
  const message = String(err?.message || '');
  if (err?.statusCode === 401 || err?.statusCode === 403) {
    return { status: err.statusCode, error: message };
  }
  if (/not in the connected database/i.test(message)) {
    return { status: 404, error: 'That table is not in the connected database.' };
  }
  if (err?.statusCode === 400 && message) {
    return { status: 400, error: message };
  }
  return { status: 500, error: 'Unable to calculate analytics.' };
}

/**
 * GET /api/database/analytics?table=name&connectionId=
 * Aggregates the full table on the signed-in user's database.
 * The client sends a table name, never SQL.
 */
router.get('/analytics', async (req, res) => {
  try {
    if (req.query.sql || req.query.query) {
      return res.status(400).json({
        success: false,
        error: 'Choose a table from the sidebar.',
      });
    }
    const { adapter } = await assertUserConnection(req.user.id, req.query.connectionId);
    if (adapter.type === 'mongodb') {
      return res.status(400).json({
        success: false,
        error: 'Analytics are not available for MongoDB connections.',
      });
    }
    const schema = await getDatabaseSchema(false, adapter, req.user.id);
    const analytics = await computeTableAnalytics(adapter, schema, req.query.table);
    return res.json({ success: true, ...analytics });
  } catch (err) {
    const mapped = analyticsError(err);
    console.error('[DATABASE_ROUTE] Analytics error:', safeErrorMessage(err));
    return res.status(mapped.status).json({ success: false, error: mapped.error });
  }
});

/**
 * GET /api/database/tables/:table?page=1&limit=50&sort=&dir=asc&q=
 * Server-side page of a real table in the signed-in user's database.
 */
router.get('/tables/:table', async (req, res) => {
  try {
    const { adapter } = await assertUserConnection(req.user.id, req.query.connectionId);
    const schema = await getDatabaseSchema(false, adapter, req.user.id);
    const pageData = await browseTable(adapter, schema, {
      table: req.params.table,
      page: req.query.page,
      limit: req.query.limit,
      sort: req.query.sort,
      dir: req.query.dir,
      q: req.query.q,
    });
    return res.json({ success: true, connectionId: req.query.connectionId || null, ...pageData });
  } catch (err) {
    const status = err.statusCode || 400;
    return res.status(status).json({ success: false, error: err.message || 'Could not load table data.' });
  }
});

/**
 * POST /api/database/rows
 * Direct single-row insert, update, or delete. The client sends column values, not SQL.
 */
router.post('/rows', async (req, res) => {
  try {
    const { adapter } = await assertUserConnection(req.user.id, req.body?.connectionId);
    const schema = await getDatabaseSchema(false, adapter, req.user.id);
    const result = await applyDirectChange(adapter, schema, {
      action: req.body?.action,
      table: req.body?.table,
      primaryKey: req.body?.primaryKey,
      changes: req.body?.changes,
      values: req.body?.values,
    });
    return res.json({
      success: true,
      message: result.action === 'insert'
        ? '1 row inserted.'
        : result.action === 'delete'
          ? '1 row deleted.'
          : '1 row updated.',
      affectedRows: result.affectedRows,
      table: result.table,
    });
  } catch (err) {
    const status = err.statusCode || 400;
    return res.status(status).json({ success: false, error: err.message || 'The row change was not applied.' });
  }
});

module.exports = router;
