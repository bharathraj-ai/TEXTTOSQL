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
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
const GROQ_TIMEOUT_MS = parseInt(process.env.GROQ_TIMEOUT_MS || '5000', 10);

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

  if (!apiKey || apiKey.trim().length === 0) {
    console.log('[GROQ] GROQ_API_KEY not configured. Serving local conversational response.');
    return {
      success: true,
      message: getLocalConversationalFallback(userMessage),
      source: 'local_fallback',
    };
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), GROQ_TIMEOUT_MS);

    const response = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [
          { role: 'system', content: SYSTEM_CONVERSATION_PROMPT },
          { role: 'user', content: userMessage },
        ],
        temperature: 0.6,
        max_tokens: 300,
      }),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`Groq API returned HTTP ${response.status}: ${errText.slice(0, 100)}`);
    }

    const data = await response.json();
    const reply = data?.choices?.[0]?.message?.content?.trim();

    if (!reply) {
      throw new Error('Empty message content returned from Groq.');
    }

    return {
      success: true,
      message: reply,
      source: 'groq',
      model: GROQ_MODEL,
    };
  } catch (err) {
    console.warn(`[GROQ] Request failed or timed out: ${err.message}. Using graceful fallback.`);
    return {
      success: true,
      message: getLocalConversationalFallback(userMessage),
      source: 'local_fallback',
    };
  }
}

module.exports = {
  handleConversation,
};
