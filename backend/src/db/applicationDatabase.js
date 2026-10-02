// ============================================
// Application Database — Users & Connections
// ============================================
// This connects to the system's own database (APP_DATABASE_URL),
// which stores user credentials and saved connection records.
// This is strictly separate from user-provided databases.

require('dotenv').config();
const { Pool } = require('pg');
const { safeErrorMessage } = require('../utils/safeLog');

function formatDbError(err) {
  if (!err) return 'Unknown error';
  if (err.errors && Array.isArray(err.errors)) {
    return safeErrorMessage(err.errors.map((e) => e.message || e.code).join('; ') || err.message || err.code);
  }
  return safeErrorMessage(err.message || err.code || String(err));
}

const appDbUrl = process.env.APP_DATABASE_URL || process.env.DATABASE_URL;

if (!appDbUrl) {
  console.warn('⚠️  Warning: APP_DATABASE_URL not set in environment variables.');
}

const isNeon = Boolean(appDbUrl && appDbUrl.includes('neon.tech'));

const appPool = new Pool({
  connectionString: appDbUrl,
  ssl: isNeon || (appDbUrl && appDbUrl.includes('sslmode='))
    ? { rejectUnauthorized: false }
    : false,
  connectionTimeoutMillis: 15000,
});

/**
 * Initialize application tables (users, database_connections)
 */
async function initAppDatabase(retries = 2, delayMs = 2000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const client = await appPool.connect();
      try {
        // 1. Users table
        await client.query(`
          CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            name VARCHAR(100) NOT NULL,
            email VARCHAR(255) UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          );
        `);

        // 2. Database connections metadata table
        await client.query(`
          CREATE TABLE IF NOT EXISTS database_connections (
            id SERIAL PRIMARY KEY,
            user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
            connection_name VARCHAR(100),
            encrypted_url TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          );
        `);

        await client.query(`
          CREATE TABLE IF NOT EXISTS openrouter_usage (
            id SERIAL PRIMARY KEY,
            "date" DATE NOT NULL UNIQUE,
            request_count INTEGER NOT NULL DEFAULT 0,
            input_tokens INTEGER NOT NULL DEFAULT 0,
            output_tokens INTEGER NOT NULL DEFAULT 0,
            total_tokens INTEGER NOT NULL DEFAULT 0,
            estimated_cost_usd NUMERIC(14, 8) NOT NULL DEFAULT 0,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
          );
        `);

        console.log('✅ Application database tables verified (users, database_connections, openrouter_usage)');
        return;
      } finally {
        client.release();
      }
    } catch (err) {
      if (attempt < retries) {
        console.warn(`⏳ Initializing app tables attempt ${attempt} failed (${formatDbError(err)}). Retrying in ${delayMs / 1000}s...`);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      } else {
        console.error('❌ Failed to initialize application database tables:', formatDbError(err));
      }
    }
  }
}

// Automatically verify/create tables on startup
initAppDatabase();

module.exports = appPool;
