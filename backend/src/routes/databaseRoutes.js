// ============================================
// Database Routes — Dynamic User Database Management
// ============================================
// Handles testing, connecting, inspecting, and disconnecting
// user-provided databases.

const express = require('express');
const authMiddleware = require('../middleware/authMiddleware');
const {
  testRawConnection,
  setUserConnection,
  removeUserConnection,
  getUserStatus,
  getUserAdapter,
  getUserPool,
} = require('../services/connectionManager');
const {
  invalidateUserSchemaCache,
  getDatabaseSchema,
  getSchemaSummary,
} = require('../services/schemaService');

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
    console.error('[DATABASE_ROUTE] Status error:', err.message);
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
    console.error('[DATABASE_ROUTE] Test error:', err.message);
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
    console.error('[DATABASE_ROUTE] Connect error:', err.message);
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
    console.error('[DATABASE_ROUTE] Connect default error:', err.message);
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
    console.error('[DATABASE_ROUTE] Disconnect error:', err.message);
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
    console.error('[DATABASE_ROUTE] Schema error:', err.message);
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve database schema.',
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
    console.error('[DATABASE_ROUTE] Summary error:', err.message);
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve schema summary.',
    });
  }
});

module.exports = router;
