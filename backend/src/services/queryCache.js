// ============================================
// Query Cache — User-Isolated In-Memory Cache
// ============================================
// Day 4 Component: Caches identical query results per user.
//
// STRICT MULTI-USER ISOLATION:
//   - Cache keys are strictly partitioned by userId and database identifier.
//   - Cache entries are NEVER shared across different users.
//   - Results automatically expire after TTL (default: 60s).
//   - Flushed upon user logout, disconnect, or schema invalidation.

const crypto = require('crypto');

// Map: userId -> Map<cacheKeyHash, { data, expiresAt }>
const userCacheStore = new Map();

const DEFAULT_TTL_MS = 60 * 1000; // 60 seconds

/**
 * Builds a deterministic hash key for a query.
 */
function buildKey(userId, dbIdentifier, question) {
  const normUser = userId ? String(userId) : 'guest';
  const normDb = dbIdentifier || 'default';
  const normQ = (question || '').toLowerCase().trim().replace(/\s+/g, ' ');
  return crypto.createHash('sha256').update(`${normUser}:${normDb}:${normQ}`).digest('hex');
}

/**
 * Retrieves a cached query result if present and not expired.
 *
 * @param {number|string} userId
 * @param {string} dbIdentifier
 * @param {string} question
 * @returns {object|null} Cached response or null
 */
function getCachedQuery(userId, dbIdentifier, question) {
  const uid = userId ? String(userId) : 'guest';
  const userMap = userCacheStore.get(uid);
  if (!userMap) return null;

  const key = buildKey(uid, dbIdentifier, question);
  const entry = userMap.get(key);
  if (!entry) return null;

  if (Date.now() > entry.expiresAt) {
    userMap.delete(key);
    return null;
  }

  console.log(`[CACHE] Hit for user [${uid}] question: "${question.slice(0, 40)}..."`);
  return { ...entry.data, fromCache: true };
}

/**
 * Caches a query result for a specific user.
 *
 * @param {number|string} userId
 * @param {string} dbIdentifier
 * @param {string} question
 * @param {object} data
 * @param {number} [ttlMs=DEFAULT_TTL_MS]
 */
function setCachedQuery(userId, dbIdentifier, question, data, ttlMs = DEFAULT_TTL_MS) {
  const uid = userId ? String(userId) : 'guest';
  if (!userCacheStore.has(uid)) {
    userCacheStore.set(uid, new Map());
  }

  const userMap = userCacheStore.get(uid);
  const key = buildKey(uid, dbIdentifier, question);

  // Keep map size reasonable (max 100 queries per user)
  if (userMap.size > 100) {
    const oldestKey = userMap.keys().next().value;
    userMap.delete(oldestKey);
  }

  userMap.set(key, {
    data,
    expiresAt: Date.now() + ttlMs,
  });
}

/**
 * Flushes all cached queries for a specific user.
 *
 * @param {number|string} userId
 */
function invalidateUserCache(userId) {
  const uid = userId ? String(userId) : 'guest';
  userCacheStore.delete(uid);
  console.log(`[CACHE] Flushed query cache for user [${uid}]`);
}

/**
 * Clears the entire cache store (useful for testing).
 */
function clearAllCache() {
  userCacheStore.clear();
}

module.exports = {
  getCachedQuery,
  setCachedQuery,
  invalidateUserCache,
  clearAllCache,
};
