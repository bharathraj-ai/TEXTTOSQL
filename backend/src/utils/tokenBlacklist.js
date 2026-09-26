// ============================================
// Token Blacklist — In-Memory JWT Revocation
// ============================================
// Day 4: Implements a server-side token blacklist
// so that logged-out JWTs are immediately rejected.
//
// Uses an in-memory Set keyed by token jti/signature.
// On server restart, all sessions must re-login (acceptable for dev/staging).
// For production, replace with Redis or a database table.

const blacklist = new Set();

/**
 * Add a token to the blacklist.
 * Tokens are keyed by their full signature string.
 *
 * @param {string} token - Raw JWT string
 */
function blacklistToken(token) {
  if (token) blacklist.add(token);
}

/**
 * Check if a token has been blacklisted (i.e., logged out).
 *
 * @param {string} token - Raw JWT string
 * @returns {boolean}
 */
function isBlacklisted(token) {
  return blacklist.has(token);
}

/**
 * Clean up expired tokens periodically.
 * Since JWTs are self-describing, we can remove tokens that have already expired
 * from the blacklist to prevent unbounded growth.
 * Call this on a schedule (e.g., every hour).
 *
 * @param {string} jwtSecret - Secret to verify/decode tokens
 */
function pruneExpiredTokens(jwtSecret) {
  const jwt = require('jsonwebtoken');
  for (const token of blacklist) {
    try {
      jwt.verify(token, jwtSecret);
      // Still valid — keep it
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        // Token has naturally expired — remove from blacklist
        blacklist.delete(token);
      }
    }
  }
}

module.exports = {
  blacklistToken,
  isBlacklisted,
  pruneExpiredTokens,
};
