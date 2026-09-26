// ============================================
// Database Connection (pg Pool)
// ============================================
// Uses a connection pool for efficient PostgreSQL access.
// Reads DATABASE_URL from .env — never hardcode credentials.

const { Pool } = require('pg');

function formatDbError(err) {
  if (!err) return 'Unknown error';
  if (err.errors && Array.isArray(err.errors)) {
    return err.errors.map(e => e.message || e.code).join('; ') || err.message || err.code;
  }
  return err.message || err.code || String(err);
}

const isNeon = Boolean(process.env.DATABASE_URL && process.env.DATABASE_URL.includes('neon.tech'));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isNeon || (process.env.DATABASE_URL && process.env.DATABASE_URL.includes('sslmode='))
    ? { rejectUnauthorized: false }
    : false,
  connectionTimeoutMillis: 15000,
});

// Test the connection on startup with retry for serverless cold starts (e.g. Neon)
async function testConnection(retries = 2, delayMs = 2000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await pool.query('SELECT NOW()');
      console.log('✅ Connected to PostgreSQL');
      return;
    } catch (err) {
      if (attempt < retries) {
        console.warn(`⏳ Initial DB connection attempt ${attempt} failed (${formatDbError(err)}). Retrying in ${delayMs / 1000}s...`);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      } else {
        console.error('❌ Database connection failed:', formatDbError(err));
      }
    }
  }
}

testConnection();

module.exports = pool;

