// ============================================
// Express Server — Entry Point
// ============================================

require('dotenv').config();

const { assertRequiredSecrets } = require('./config/requiredSecrets');
try {
  assertRequiredSecrets();
} catch (err) {
  console.error(`[STARTUP] ${err.message}`);
  process.exit(1);
}

const express = require('express');
const cors = require('cors');
const authRoutes = require('./routes/authRoutes');
const queryRoutes = require('./routes/queryRoutes');
const databaseRoutes = require('./routes/databaseRoutes');
const mutationRoutes = require('./routes/mutationRoutes');

const app = express();
const PORT = process.env.PORT || 5000;

// ── Middleware ────────────────────────────────
app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like curl) or any localhost origin
    if (!origin || origin.startsWith('http://localhost')) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json());

// ── Routes ────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/database', databaseRoutes);
app.use('/api', queryRoutes);
app.use('/api', mutationRoutes);

// ── Health Check ──────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── Start Server ──────────────────────────────
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`\n🚀 Server running on http://localhost:${PORT}`);
    console.log(`🔐 Auth endpoints: /api/auth/register, /api/auth/login, /api/auth/me`);
    console.log(`📡 Query endpoint:    POST /api/query`);
    console.log(`✅ Confirm endpoint:  POST /api/query/confirm`);
    console.log(`✏️  Mutation endpoints: POST /api/mutation/stage | POST /api/mutation/confirm`);
    console.log(`❤️  Health check:      GET  http://localhost:${PORT}/health`);
    const { groqConfiguration } = require('./services/groqService');
    const { openRouterConfiguration } = require('./services/sqlReviewService');
    const groq = groqConfiguration();
    const review = openRouterConfiguration();
    console.log(`Groq: ${groq.configured ? 'configured' : 'not configured'}`);
    console.log(`OpenRouter: ${review.enabled ? 'enabled' : 'disabled'}, ${review.configured ? 'configured' : 'not configured'}, budget USD ${review.maxBudgetUsd}\n`);
  });
}

module.exports = app;
