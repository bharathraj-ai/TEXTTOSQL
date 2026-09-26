// ============================================
// Connection Manager — Multi-Database Adapter Pools
// ============================================
// Manages multi-user database connections dynamically.
// Supports PostgreSQL, MySQL, SQLite, and MongoDB.
// Caches adapter instances, verifies connectivity, and encrypts URLs.

const appPool = require('../db/applicationDatabase');
const defaultPool = require('../db/database');
const { encrypt, decrypt } = require('../utils/encryption');
const { createAdapter, detectDatabaseType } = require('../adapters/databaseAdapter');
const { PostgresAdapter } = require('../adapters/postgresAdapter');
const { invalidateUserSchemaCache } = require('./schemaService');
const { invalidateUserCache } = require('./queryCache');

// In-memory cache of user database adapters
// Key: userId -> Value: { adapter, connectionName, databaseName, host, dbType }
const userAdapters = new Map();

// Default system adapter (PostgreSQL)
let defaultSystemAdapter = null;
function getDefaultAdapter() {
  if (!defaultSystemAdapter) {
    const defaultUrl = process.env.DATABASE_URL || 'postgresql://localhost:5432/postgres';
    defaultSystemAdapter = new PostgresAdapter(defaultUrl);
  }
  return defaultSystemAdapter;
}

/**
 * Safely parse database details without exposing credentials
 * @param {string} rawUrl 
 * @returns {{ host: string, databaseName: string, port: string, dbType: string }}
 */
function parseDatabaseDetails(rawUrl) {
  try {
    const dbType = detectDatabaseType(rawUrl);

    if (dbType === 'sqlite') {
      const dbName = rawUrl.replace(/^sqlite:\/\//, '').replace(/^sqlite:/, '') || 'sqlite.db';
      return { host: 'local', port: 'file', databaseName: dbName, dbType };
    }

    if (dbType === 'mongodb') {
      const match = rawUrl.match(/\/([^/?]+)(?:\?|$)/);
      const dbName = match ? match[1] : 'admin';
      const hostMatch = rawUrl.match(/@([^/:?]+)/);
      return {
        host: hostMatch ? hostMatch[1] : 'mongodb-cluster',
        port: rawUrl.startsWith('mongodb+srv') ? 'srv' : '27017',
        databaseName: dbName,
        dbType,
      };
    }

    const parsed = new URL(rawUrl);
    return {
      host: parsed.hostname || 'localhost',
      port: parsed.port || (dbType === 'mysql' ? '3306' : '5432'),
      databaseName: parsed.pathname ? parsed.pathname.replace(/^\//, '') : (dbType === 'mysql' ? 'mysql' : 'postgres'),
      dbType,
    };
  } catch {
    return { host: 'unknown', port: 'unknown', databaseName: 'database', dbType: 'unknown' };
  }
}

/**
 * Test a raw connection string across any supported database type
 * @param {string} rawUrl 
 * @returns {Promise<object>} Connection metadata and table/collection list
 */
async function testRawConnection(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') {
    throw new Error('Database URL is required.');
  }

  const trimmed = rawUrl.trim();
  const dbType = detectDatabaseType(trimmed);
  const adapter = createAdapter(trimmed);

  try {
    const result = await adapter.testConnection();
    return {
      ...result,
      dbType,
    };
  } catch (err) {
    throw new Error(`Database connection failed: ${err.message}`);
  } finally {
    await adapter.close().catch(() => {});
  }
}

/**
 * Get active database adapter for a specific user.
 * Falls back to default system PostgreSQL adapter if no user connection is configured.
 * 
 * @param {number|string} userId 
 * @returns {Promise<object>} Database adapter instance
 */
async function getUserAdapter(userId) {
  if (!userId) {
    return getDefaultAdapter();
  }

  const uid = Number(userId);

  // Return cached adapter if available
  if (userAdapters.has(uid)) {
    return userAdapters.get(uid).adapter;
  }

  // Look up in database_connections
  const res = await appPool.query(
    'SELECT connection_name, encrypted_url FROM database_connections WHERE user_id = $1 ORDER BY id DESC LIMIT 1',
    [uid]
  );

  if (res.rows.length === 0) {
    return getDefaultAdapter();
  }

  const { connection_name, encrypted_url } = res.rows[0];
  let rawUrl;
  try {
    rawUrl = decrypt(encrypted_url);
  } catch (err) {
    console.error(`[CONN] Failed to decrypt connection for user ${uid}:`, err.message);
    return getDefaultAdapter();
  }

  const adapter = createAdapter(rawUrl);
  const details = parseDatabaseDetails(rawUrl);

  userAdapters.set(uid, {
    adapter,
    connectionName: connection_name,
    databaseName: details.databaseName,
    host: details.host,
    dbType: details.dbType,
  });

  return adapter;
}

/**
 * Legacy compatibility wrapper: returns adapter.pool for PostgreSQL or the adapter itself
 */
async function getUserPool(userId) {
  const adapter = await getUserAdapter(userId);
  return adapter.pool || adapter;
}

/**
 * Save and activate a user database connection (any supported type)
 * 
 * @param {number|string} userId 
 * @param {string} connectionName 
 * @param {string} rawUrl 
 * @returns {Promise<object>} Connection metadata
 */
async function setUserConnection(userId, connectionName, rawUrl) {
  const uid = Number(userId);
  const trimmed = rawUrl.trim();

  // 1. Verify connection before saving
  const testInfo = await testRawConnection(trimmed);

  // 2. Encrypt URL
  const encryptedUrl = encrypt(trimmed);
  const connName = connectionName?.trim() || testInfo.databaseName || `${testInfo.name} Database`;

  // 3. Close existing cached adapter if present
  if (userAdapters.has(uid)) {
    const existing = userAdapters.get(uid);
    await existing.adapter.close().catch(() => {});
    userAdapters.delete(uid);
  }

  // 4. Save/update database_connections
  const existingConn = await appPool.query(
    'SELECT id FROM database_connections WHERE user_id = $1 ORDER BY id DESC LIMIT 1',
    [uid]
  );

  let connectionId;
  if (existingConn.rows.length > 0) {
    connectionId = existingConn.rows[0].id;
    await appPool.query(
      'UPDATE database_connections SET connection_name = $1, encrypted_url = $2, created_at = CURRENT_TIMESTAMP WHERE id = $3',
      [connName, encryptedUrl, connectionId]
    );
  } else {
    const inserted = await appPool.query(
      'INSERT INTO database_connections (user_id, connection_name, encrypted_url) VALUES ($1, $2, $3) RETURNING id',
      [uid, connName, encryptedUrl]
    );
    connectionId = inserted.rows[0].id;
  }

  // 5. Instantiate and cache new active adapter
  const adapter = createAdapter(trimmed);
  userAdapters.set(uid, {
    adapter,
    connectionName: connName,
    databaseName: testInfo.databaseName,
    host: testInfo.host,
    dbType: testInfo.dbType,
  });

  console.log(`[CONN] User ${uid} connected to ${testInfo.name} (${testInfo.databaseName})`);

  return {
    connectionName: connName,
    databaseName: testInfo.databaseName,
    host: testInfo.host,
    port: testInfo.port,
    dbType: testInfo.dbType,
    name: testInfo.name,
    tableCount: testInfo.tableCount,
    tables: testInfo.tables,
    connectionId,
  };
}

/**
 * Clean up user session: close open connection pool and flush caches.
 */
async function cleanupUserSession(userId) {
  if (!userId) return;
  const uid = Number(userId);

  if (userAdapters.has(uid)) {
    const item = userAdapters.get(uid);
    await item.adapter.close().catch(() => {});
    userAdapters.delete(uid);
  }

  invalidateUserSchemaCache(uid);
  invalidateUserCache(uid);
  console.log(`[CONN] Cleaned up session and caches for user ${uid}`);
}

/**
 * Remove and disconnect a user database connection
 * 
 * @param {number|string} userId 
 */
async function removeUserConnection(userId) {
  const uid = Number(userId);
  await cleanupUserSession(uid);
  await appPool.query('DELETE FROM database_connections WHERE user_id = $1', [uid]);
  console.log(`[CONN] User ${uid} disconnected custom database`);
}

/**
 * Get current database connection status for user
 * 
 * @param {number|string} userId 
 * @returns {Promise<object>}
 */
async function getUserStatus(userId) {
  if (!userId) {
    return { connected: false };
  }

  const uid = Number(userId);

  const res = await appPool.query(
    'SELECT id, connection_name, encrypted_url, created_at FROM database_connections WHERE user_id = $1 ORDER BY id DESC LIMIT 1',
    [uid]
  );

  if (res.rows.length === 0) {
    return {
      connected: false,
      connectionName: '',
      databaseName: '',
      host: '',
      dbType: '',
      tableCount: 0,
      tables: [],
    };
  }

  const row = res.rows[0];
  try {
    const rawUrl = decrypt(row.encrypted_url);
    const details = parseDatabaseDetails(rawUrl);

    // Get active adapter and discover tables
    const adapter = await getUserAdapter(uid);
    let tables = [];
    try {
      const schema = await adapter.discoverSchema();
      tables = Object.keys(schema.tables || {});
    } catch {
      // Ignore transient error
    }

    return {
      connected: true,
      connectionName: row.connection_name || details.databaseName,
      databaseName: details.databaseName,
      host: details.host,
      dbType: details.dbType,
      tableCount: tables.length,
      tables,
      connectionId: row.id,
      createdAt: row.created_at,
    };
  } catch (err) {
    console.error(`[CONN] Status check error for user ${uid}:`, err.message);
    return {
      connected: false,
      error: 'Failed to access saved database connection.',
    };
  }
}

/**
 * Confirm the signed-in user owns the saved connection, then return its adapter.
 * A missing connectionId uses that user's latest saved connection.
 */
async function assertUserConnection(userId, connectionId = null) {
  const uid = Number(userId);
  if (!uid) {
    const err = new Error('Authentication required.');
    err.statusCode = 401;
    throw err;
  }

  const params = [uid];
  let sql = 'SELECT id FROM database_connections WHERE user_id = $1';
  if (connectionId !== null && connectionId !== undefined && connectionId !== '') {
    sql += ' AND id = $2';
    params.push(Number(connectionId));
  }
  sql += ' ORDER BY id DESC LIMIT 1';

  const res = await appPool.query(sql, params);
  if (res.rows.length === 0) {
    const err = new Error('Database connection was not found for this account.');
    err.statusCode = 403;
    throw err;
  }

  const adapter = await getUserAdapter(uid);
  return { adapter, connectionId: res.rows[0].id };
}

module.exports = {
  testRawConnection,
  getUserAdapter,
  getUserPool,
  setUserConnection,
  removeUserConnection,
  cleanupUserSession,
  getUserStatus,
  parseDatabaseDetails,
  assertUserConnection,
};
