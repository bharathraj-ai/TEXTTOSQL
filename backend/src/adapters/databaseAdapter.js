// ============================================
// Database Adapter Factory & Protocol Detection
// ============================================
// Detects database type from URL protocol and instantiates
// the appropriate adapter (PostgreSQL, MySQL, SQLite, MongoDB).

const { PostgresAdapter } = require('./postgresAdapter');
const { MysqlAdapter } = require('./mysqlAdapter');
const { SqliteAdapter } = require('./sqliteAdapter');
const { MongoAdapter } = require('./mongoAdapter');

// Supported database types
const DB_TYPES = {
  POSTGRES: 'postgres',
  MYSQL: 'mysql',
  SQLITE: 'sqlite',
  MONGODB: 'mongodb',
};

/**
 * Detect database type from connection string
 * @param {string} rawUrl 
 * @returns {'postgres'|'mysql'|'sqlite'|'mongodb'}
 */
function detectDatabaseType(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') {
    throw new Error('Connection URL is required.');
  }

  const trimmed = rawUrl.trim().toLowerCase();

  if (trimmed.startsWith('mongodb://') || trimmed.startsWith('mongodb+srv://')) {
    return DB_TYPES.MONGODB;
  }

  if (trimmed.startsWith('mysql://') || trimmed.startsWith('mariadb://')) {
    return DB_TYPES.MYSQL;
  }

  if (trimmed.startsWith('sqlite://') || trimmed.startsWith('sqlite:') ||
      trimmed.endsWith('.db') || trimmed.endsWith('.sqlite') || trimmed.endsWith('.sqlite3')) {
    return DB_TYPES.SQLITE;
  }

  if (trimmed.startsWith('postgres://') || trimmed.startsWith('postgresql://')) {
    return DB_TYPES.POSTGRES;
  }

  throw new Error(
    'Unsupported database protocol. Supported types: ' +
    'PostgreSQL (postgresql://), MySQL (mysql://), SQLite (sqlite://), or MongoDB (mongodb:// or mongodb+srv://)'
  );
}

/**
 * Factory to create an adapter instance for a connection string
 * @param {string} rawUrl 
 * @param {object} [options] 
 * @returns {object} Database adapter instance
 */
function createAdapter(rawUrl, options = {}) {
  const type = detectDatabaseType(rawUrl);

  switch (type) {
    case DB_TYPES.POSTGRES:
      return new PostgresAdapter(rawUrl, options);
    case DB_TYPES.MYSQL:
      return new MysqlAdapter(rawUrl, options);
    case DB_TYPES.SQLITE:
      return new SqliteAdapter(rawUrl, options);
    case DB_TYPES.MONGODB:
      return new MongoAdapter(rawUrl, options);
    default:
      throw new Error(`Unsupported database type: ${type}`);
  }
}

module.exports = {
  DB_TYPES,
  detectDatabaseType,
  createAdapter,
};
