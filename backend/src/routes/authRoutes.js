// ============================================
// Auth Routes — Registration, Login & Profile
// ============================================
// Provides user authentication using bcrypt password
// hashing and JSON Web Tokens (JWT).

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const appPool = require('../db/applicationDatabase');
const authMiddleware = require('../middleware/authMiddleware');
const { blacklistToken, pruneExpiredTokens } = require('../utils/tokenBlacklist');

const router = express.Router();

// Fail fast if JWT_SECRET is not configured
if (!process.env.JWT_SECRET) {
  console.warn('[AUTH ROUTES] WARNING: JWT_SECRET not set. Authentication security is degraded.');
}
const JWT_SECRET = process.env.JWT_SECRET || 'nl_sql_jwt_secret_key_super_secure_2026_production_v2';
const TOKEN_EXPIRY = '7d';

// Periodically prune expired tokens from blacklist (every 4 hours)
setInterval(() => pruneExpiredTokens(JWT_SECRET), 4 * 60 * 60 * 1000);

/**
 * Helper: Generate JWT token for user
 */
function generateToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, name: user.name },
    JWT_SECRET,
    { expiresIn: TOKEN_EXPIRY }
  );
}

// ── POST /api/auth/register ───────────────────────────
router.post('/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Name, email, and password are required.',
      });
    }

    const trimmedName = name.trim();
    const trimmedEmail = email.trim().toLowerCase();

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        error: 'Password must be at least 6 characters long.',
      });
    }

    // Check if user already exists
    const existing = await appPool.query(
      'SELECT id FROM users WHERE email = $1',
      [trimmedEmail]
    );

    if (existing.rows.length > 0) {
      return res.status(400).json({
        success: false,
        error: 'An account with this email already exists.',
      });
    }

    // Hash password with bcrypt
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    // Insert user into application database
    const result = await appPool.query(
      'INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id, name, email, created_at',
      [trimmedName, trimmedEmail, passwordHash]
    );

    const newUser = result.rows[0];
    const token = generateToken(newUser);

    console.log(`[AUTH] Registered new user: ${newUser.email} (id: ${newUser.id})`);

    return res.status(201).json({
      success: true,
      message: 'Account created successfully.',
      token,
      user: {
        id: newUser.id,
        name: newUser.name,
        email: newUser.email,
      },
    });
  } catch (err) {
    console.error('[AUTH] Registration error:', err);
    return res.status(500).json({
      success: false,
      error: 'An error occurred during registration. Please try again.',
    });
  }
});

// ── POST /api/auth/login ──────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Email and password are required.',
      });
    }

    const trimmedEmail = email.trim().toLowerCase();

    // Find user in application database
    const result = await appPool.query(
      'SELECT id, name, email, password_hash FROM users WHERE email = $1',
      [trimmedEmail]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        success: false,
        error: 'Invalid email or password.',
      });
    }

    const user = result.rows[0];

    // Verify password with bcrypt
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(401).json({
        success: false,
        error: 'Invalid email or password.',
      });
    }

    const token = generateToken(user);
    console.log(`[AUTH] User logged in: ${user.email} (id: ${user.id})`);

    return res.json({
      success: true,
      message: 'Login successful.',
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
      },
    });
  } catch (err) {
    console.error('[AUTH] Login error:', err);
    return res.status(500).json({
      success: false,
      error: 'An error occurred during login. Please try again.',
    });
  }
});

const { cleanupUserSession } = require('../services/connectionManager');

// ── POST /api/auth/logout ─────────────────────────────
router.post('/logout', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      try {
        const decoded = jwt.verify(token, JWT_SECRET);
        if (decoded?.id) {
          await cleanupUserSession(decoded.id);
        }
        // ✔ Day 4: Immediately blacklist the token so it cannot be reused
        blacklistToken(token);
        console.log(`[AUTH] Token blacklisted on logout for user id: ${decoded?.id || 'unknown'}`);
      } catch {
        // Still blacklist the token even if it's expired or malformed
        blacklistToken(token);
      }
    }

    return res.json({
      success: true,
      message: 'Logged out successfully.',
    });
  } catch (err) {
    return res.json({ success: true, message: 'Logged out.' });
  }
});

// ── GET /api/auth/me ──────────────────────────────────
router.get('/me', authMiddleware, (req, res) => {
  return res.json({
    success: true,
    user: req.user,
  });
});

module.exports = router;
