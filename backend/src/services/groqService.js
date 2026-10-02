// ============================================
// Groq Service — Conversational AI Layer
// ============================================
// Provides fast, natural language conversational responses for
// greetings, help, and general questions using Groq.
//
// STRICT DIRECTIVES:
//   1. NEVER executes SQL.
//   2. NEVER queries or accesses the database.
//   3. NEVER receives or exposes database credentials, passwords, or tokens.
//   4. Handles timeout and API failures gracefully with built-in fallback.
//   5. GROQ_API_KEY is read from environment and never hardcoded or logged.

const GROQ_API_URL = process.env.GROQ_URL || 'https://api.groq.com/openai/v1/chat/completions';
const DEFAULT_GROQ_MODEL = 'openai/gpt-oss-20b';
const RETIRED_GROQ_MODELS = {
  'llama-3.3-70b-versatile': DEFAULT_GROQ_MODEL,
  'llama-3.1-8b-instant': DEFAULT_GROQ_MODEL,
};

function resolveGroqModel() {
  const configured = String(process.env.GROQ_MODEL || DEFAULT_GROQ_MODEL).trim() || DEFAULT_GROQ_MODEL;
  const replacement = RETIRED_GROQ_MODELS[configured];
  if (replacement) {
    console.warn(`[GROQ] Configured model ${configured} is retired. Using ${replacement}.`);
    return replacement;
  }
  return configured;
}

function groqTimeoutMs() {
  const timeout = parseInt(process.env.GROQ_TIMEOUT_MS || '15000', 10);
  return Number.isFinite(timeout) && timeout > 0 ? timeout : 15000;
}

function safeProviderError(err) {
  const secret = String(process.env.GROQ_API_KEY || '');
  let text = String(err && err.message ? err.message : err || 'Groq request failed');
  if (secret) text = text.split(secret).join('[redacted]');
  return text
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, '[redacted]')
    .slice(0, 180);
}

const SYSTEM_CONVERSATION_PROMPT = `You are the friendly, professional conversational assistant for an enterprise Natural Language to SQL & Multi-Database platform.
Your role:
- Warmly greet users and introduce what this application does.
- Explain capabilities: converting natural language questions into safe SQL/MQL queries for PostgreSQL, MySQL, SQLite, and MongoDB.
- Explain that users can ask read questions ("Show students above 80", "Average mark by department"), or request safe modifications ("Add a student", "Update mark") which require explicit review and confirmation.
- Answer user queries politely, concisely, and clearly.
- NEVER generate, format, or suggest raw SQL queries in conversational mode. If the user asks a database question, gently invite them to ask about their data in the main console.
- NEVER request or expose system passwords, connection strings, or credentials.`;

/**
 * Fallback conversational responder when Groq API key is absent or network fails.
 */
function getLocalConversationalFallback(message) {
  const lower = (message || '').toLowerCase();

  if (/who\s+are\s+you|what\s+are\s+you/i.test(lower)) {
    return "I am your AI Database Assistant! I translate your natural language questions into safe SQL queries and execute them against your connected database (PostgreSQL, MySQL, SQLite, or MongoDB).";
  }

  if (/what\s+can\s+you\s+do|capabilities|features|help/i.test(lower)) {
    return "Here is what I can do for you:\n" +
      "1. 🔍 Query Data: Ask questions like \"Show all students\", \"Average mark by department\", or \"Top 5 students\".\n" +
      "2. ✏️ Safe Modifications: Add, update, or delete records with mandatory safety review and confirmation.\n" +
      "3. 🗄️ Multi-Database: Connect to PostgreSQL, MySQL, SQLite, or MongoDB with full user isolation.\n" +
      "4. 🛡️ AI Safety Review: All modifications and queries are checked against semantic mismatch and risk policies.";
  }

  if (/explain\s+what\s+this\s+(app|application|system|tool)\s+does/i.test(lower)) {
    return "This application is an AI-powered Multi-Database Assistant. It enables you to interact with databases using plain English instead of writing complex SQL manually. It features 3-layer SQL validation, OpenRouter safety review, and user isolation to keep your data secure.";
  }

  return "Hello! I am your AI Database Assistant. How can I help you explore or manage your database today? You can ask me questions about your data, or ask for help with queries.";
}

/**
 * Handle a conversational message using Groq.
 *
 * @param {string} userMessage - User greeting or conversation text
 * @returns {Promise<{
 *   success: boolean,
 *   message: string,
 *   source: 'groq'|'local_fallback',
 *   model?: string
 * }>}
 */
async function handleConversation(userMessage) {
  const apiKey = process.env.GROQ_API_KEY || '';
  const model = resolveGroqModel();

  if (!apiKey || apiKey.trim().length === 0) {
    console.log('[GROQ] LOCAL FALLBACK: GROQ_API_KEY is not configured.');
    return {
      success: true,
      message: getLocalConversationalFallback(userMessage),
      source: 'local_fallback',
    };
  }

  try {
    let lastError = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), groqTimeoutMs());
      try {
        const response = await fetch(GROQ_API_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: 'system', content: SYSTEM_CONVERSATION_PROMPT },
              { role: 'user', content: String(userMessage || '').slice(0, 2000) },
            ],
            temperature: 0.6,
            max_tokens: 300,
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          const error = new Error(`Groq API returned HTTP ${response.status}`);
          error.status = response.status;
          throw error;
        }

        const data = await response.json();
        const reply = data?.choices?.[0]?.message?.content?.trim();
        if (!reply) {
          throw new Error('Empty message content returned from Groq.');
        }

        console.log(`[GROQ] PROVIDER RESPONSE model=${model}`);
        return {
          success: true,
          message: reply,
          source: 'groq',
          model,
        };
      } catch (err) {
        lastError = err;
        const retryable = err.name === 'AbortError' || err.status === 429;
        if (retryable && attempt === 0) {
          console.warn('[GROQ] Provider attempt timed out or was rate limited. Retrying once.');
          continue;
        }
        break;
      } finally {
        clearTimeout(timer);
      }
    }

    console.warn(`[GROQ] LOCAL FALLBACK after provider failure: ${safeProviderError(lastError)}`);
    return {
      success: true,
      message: getLocalConversationalFallback(userMessage),
      source: 'local_fallback',
    };
  } catch (err) {
    console.warn(`[GROQ] LOCAL FALLBACK after provider failure: ${safeProviderError(err)}`);
    return {
      success: true,
      message: getLocalConversationalFallback(userMessage),
      source: 'local_fallback',
    };
  }
}

function groqConfiguration() {
  return {
    configured: Boolean(process.env.GROQ_API_KEY && String(process.env.GROQ_API_KEY).trim()),
    model: resolveGroqModel(),
  };
}

module.exports = {
  handleConversation,
  groqConfiguration,
  getLocalConversationalFallback,
};
