// ============================================
// Auth Middleware — JWT Verification (Day 4)
// ============================================
// Protects endpoints by verifying the JWT Bearer token.
// Day 4 changes:
//   - Checks token blacklist (logout revocation)
//   - Fails fast if JWT_SECRET is not configured
//   - Attaches authenticated user to req.user

const jwt = require('jsonwebtoken');
const appPool = require('../db/applicationDatabase');
const { isBlacklisted } = require('../utils/tokenBlacklist');
const { getJwtSecret } = require('../config/requiredSecrets');

async function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      error: 'Authentication required. Please log in.',
    });
  }

  const token = authHeader.split(' ')[1];

  // ── Day 4: Check token blacklist (logout revocation) ──
  if (isBlacklisted(token)) {
    return res.status(401).json({
      success: false,
      error: 'Session has been invalidated. Please log in again.',
    });
  }

  try {
    const decoded = jwt.verify(token, getJwtSecret());

    // Verify user exists in application database
    const userResult = await appPool.query(
      'SELECT id, name, email FROM users WHERE id = $1',
      [decoded.id]
    );

    if (userResult.rows.length === 0) {
      return res.status(401).json({
        success: false,
        error: 'User account not found. Please log in again.',
      });
    }

    req.user = userResult.rows[0];
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        error: 'Session expired. Please log in again.',
      });
    }
    return res.status(401).json({
      success: false,
      error: 'Invalid authentication token.',
    });
  }
}

module.exports = authMiddleware;
