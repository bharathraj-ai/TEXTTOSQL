// ============================================
// OpenRouter cost guard
// ============================================
// Server-side budget for the semantic reviewer.
// Client-supplied usage is ignored. A request that could exceed
// the remaining budget is refused before any network call.

const appPool = require('../db/applicationDatabase');

const DEFAULT_INPUT_USD_PER_MILLION = 0.5;
const DEFAULT_OUTPUT_USD_PER_MILLION = 3;

let usageStoreOverride = null;
let tableReady = null;

function roundMoney(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.round(number * 1e8) / 1e8;
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function isOpenRouterEnabled() {
  const raw = process.env.OPENROUTER_ENABLED;
  if (raw == null || String(raw).trim() === '') return true;
  return /^(1|true|yes|on)$/i.test(String(raw).trim());
}

function maxBudgetUsd() {
  return positiveNumber(process.env.OPENROUTER_MAX_BUDGET_USD ?? '0.80', 0.8);
}

function maxOutputTokens() {
  const requested = parseInt(process.env.OPENROUTER_MAX_OUTPUT_TOKENS || '200', 10);
  const value = Number.isFinite(requested) && requested > 0 ? requested : 200;
  return Math.min(value, 200);
}

function maxRequestsPerDay() {
  const requested = parseInt(process.env.OPENROUTER_MAX_REQUESTS_PER_DAY || '20', 10);
  return Number.isFinite(requested) && requested >= 0 ? requested : 20;
}

function inputUsdPerMillion() {
  return positiveNumber(process.env.OPENROUTER_INPUT_USD_PER_MILLION ?? DEFAULT_INPUT_USD_PER_MILLION, DEFAULT_INPUT_USD_PER_MILLION);
}

function outputUsdPerMillion() {
  return positiveNumber(process.env.OPENROUTER_OUTPUT_USD_PER_MILLION ?? DEFAULT_OUTPUT_USD_PER_MILLION, DEFAULT_OUTPUT_USD_PER_MILLION);
}

function estimateTokens(text) {
  return Math.max(1, Math.ceil(String(text || '').length / 4));
}

function estimateCostUsd(inputTokens, outputTokens) {
  const input = Math.max(0, Number(inputTokens) || 0);
  const output = Math.max(0, Number(outputTokens) || 0);
  return roundMoney((input / 1e6) * inputUsdPerMillion() + (output / 1e6) * outputUsdPerMillion());
}

function estimateMaxCostUsd(promptText) {
  return estimateCostUsd(estimateTokens(promptText), maxOutputTokens());
}

function emptyUsage() {
  return {
    request_count: 0,
    input_tokens: 0,
    output_tokens: 0,
    total_tokens: 0,
    estimated_cost_usd: 0,
  };
}

function normalizeUsage(row) {
  const usage = row || {};
  return {
    request_count: Number(usage.request_count) || 0,
    input_tokens: Number(usage.input_tokens) || 0,
    output_tokens: Number(usage.output_tokens) || 0,
    total_tokens: Number(usage.total_tokens) || 0,
    estimated_cost_usd: roundMoney(usage.estimated_cost_usd),
  };
}

function usageSnapshot(usage) {
  const current = normalizeUsage(usage);
  const budget = maxBudgetUsd();
  return {
    ...current,
    budget_usd: budget,
    remaining_budget_usd: roundMoney(Math.max(0, budget - current.estimated_cost_usd)),
    daily_request_limit: maxRequestsPerDay(),
  };
}

function finiteNonNegative(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return null;
  return number;
}

function parseProviderUsage(data) {
  const usage = data && typeof data === 'object' ? data.usage : null;
  if (!usage || typeof usage !== 'object' || Array.isArray(usage)) {
    return { malformed: true, inputTokens: 0, outputTokens: 0, totalTokens: 0, cost: null };
  }
  const inputTokens = finiteNonNegative(usage.prompt_tokens ?? usage.input_tokens);
  const outputTokens = finiteNonNegative(usage.completion_tokens ?? usage.output_tokens);
  const totalTokens = finiteNonNegative(usage.total_tokens);
  const cost = usage.cost == null ? null : finiteNonNegative(usage.cost);
  if (inputTokens == null || outputTokens == null || (usage.cost != null && cost == null)) {
    return { malformed: true, inputTokens: 0, outputTokens: 0, totalTokens: 0, cost: null };
  }
  return {
    malformed: false,
    inputTokens,
    outputTokens,
    totalTokens: totalTokens == null ? inputTokens + outputTokens : totalTokens,
    cost,
  };
}

function actualCharge(reservedCost, providerUsage) {
  if (!providerUsage || providerUsage.malformed) return reservedCost;
  const tokenCost = estimateCostUsd(providerUsage.inputTokens, providerUsage.outputTokens);
  const providerCost = providerUsage.cost == null ? tokenCost : providerUsage.cost;
  const combined = Math.max(tokenCost, providerCost);
  if (!Number.isFinite(combined) || combined < 0 || combined > maxBudgetUsd()) {
    return reservedCost;
  }
  return roundMoney(combined);
}

function createMemoryUsageStore(seed = {}) {
  const state = {
    ...emptyUsage(),
    ...normalizeUsage(seed),
  };
  return {
    async tryReserve({ reservedCost, dailyLimit, budgetUsd }) {
      if (state.request_count >= dailyLimit) {
        return { allowed: false, reason: 'daily_limit', usage: usageSnapshot(state) };
      }
      const nextCost = roundMoney(state.estimated_cost_usd + reservedCost);
      if (nextCost > budgetUsd) {
        return { allowed: false, reason: 'budget', usage: usageSnapshot(state) };
      }
      state.request_count += 1;
      state.estimated_cost_usd = nextCost;
      return {
        allowed: true,
        reason: 'reserved',
        reservedCost,
        usage: usageSnapshot(state),
      };
    },
    async recordActual({ reservedCost, inputTokens, outputTokens, totalTokens, actualCost }) {
      const charge = actualCost == null ? reservedCost : Math.max(0, actualCost);
      state.estimated_cost_usd = roundMoney(Math.max(0, state.estimated_cost_usd - reservedCost + charge));
      state.input_tokens += Math.max(0, Number(inputTokens) || 0);
      state.output_tokens += Math.max(0, Number(outputTokens) || 0);
      state.total_tokens += Math.max(0, Number(totalTokens) || 0);
      return usageSnapshot(state);
    },
    async readUsage() {
      return usageSnapshot(state);
    },
  };
}

function setUsageStore(store) {
  usageStoreOverride = store;
}

function clearUsageStore() {
  usageStoreOverride = null;
}

async function ensureUsageTable() {
  if (usageStoreOverride) return;
  if (!tableReady) {
    tableReady = appPool.query(`
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
    `).catch((err) => {
      tableReady = null;
      throw err;
    });
  }
  await tableReady;
}

const postgresUsageStore = {
  async tryReserve({ reservedCost, dailyLimit, budgetUsd }) {
    await ensureUsageTable();
    const client = await appPool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`
        INSERT INTO openrouter_usage ("date", request_count, input_tokens, output_tokens, total_tokens, estimated_cost_usd)
        VALUES (CURRENT_DATE, 0, 0, 0, 0, 0)
        ON CONFLICT ("date") DO NOTHING
      `);
      const updated = await client.query(`
        UPDATE openrouter_usage
        SET request_count = request_count + 1,
            estimated_cost_usd = estimated_cost_usd + $1::numeric,
            updated_at = CURRENT_TIMESTAMP
        WHERE "date" = CURRENT_DATE
          AND request_count < $2
          AND estimated_cost_usd + $1::numeric <= $3::numeric
        RETURNING request_count, input_tokens, output_tokens, total_tokens, estimated_cost_usd
      `, [reservedCost, dailyLimit, budgetUsd]);
      const current = updated.rowCount > 0
        ? updated
        : await client.query(`
            SELECT request_count, input_tokens, output_tokens, total_tokens, estimated_cost_usd
            FROM openrouter_usage
            WHERE "date" = CURRENT_DATE
          `);
      await client.query('COMMIT');
      const usage = usageSnapshot(current.rows[0]);
      if (updated.rowCount === 0) {
        const reason = usage.request_count >= dailyLimit ? 'daily_limit' : 'budget';
        return { allowed: false, reason, usage };
      }
      return { allowed: true, reason: 'reserved', reservedCost, usage };
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch (_rollbackErr) { /* already failing closed */ }
      throw err;
    } finally {
      client.release();
    }
  },
  async recordActual({ reservedCost, inputTokens, outputTokens, totalTokens, actualCost }) {
    await ensureUsageTable();
    const charge = actualCost == null ? reservedCost : Math.max(0, actualCost);
    const updated = await appPool.query(`
      UPDATE openrouter_usage
      SET input_tokens = input_tokens + $1,
          output_tokens = output_tokens + $2,
          total_tokens = total_tokens + $3,
          estimated_cost_usd = GREATEST(0, estimated_cost_usd - $4::numeric + $5::numeric),
          updated_at = CURRENT_TIMESTAMP
      WHERE "date" = CURRENT_DATE
      RETURNING request_count, input_tokens, output_tokens, total_tokens, estimated_cost_usd
    `, [
      Math.max(0, Number(inputTokens) || 0),
      Math.max(0, Number(outputTokens) || 0),
      Math.max(0, Number(totalTokens) || 0),
      reservedCost,
      charge,
    ]);
    return usageSnapshot(updated.rows[0]);
  },
  async readUsage() {
    await ensureUsageTable();
    const result = await appPool.query(`
      SELECT request_count, input_tokens, output_tokens, total_tokens, estimated_cost_usd
      FROM openrouter_usage
      WHERE "date" = CURRENT_DATE
    `);
    return usageSnapshot(result.rows[0]);
  },
};

function activeStore() {
  return usageStoreOverride || postgresUsageStore;
}

async function reserveReviewCall(promptText) {
  const reservedCost = estimateMaxCostUsd(promptText);
  const budgetUsd = maxBudgetUsd();
  const dailyLimit = maxRequestsPerDay();
  if (!isOpenRouterEnabled()) {
    return { allowed: false, reason: 'disabled', reservedCost, usage: await safeRead() };
  }
  if (reservedCost > budgetUsd) {
    return { allowed: false, reason: 'budget', reservedCost, usage: await safeRead() };
  }
  try {
    return await activeStore().tryReserve({ reservedCost, dailyLimit, budgetUsd });
  } catch (_err) {
    console.error('[OPENROUTER] request blocked reason=usage_store');
    return { allowed: false, reason: 'usage_store', reservedCost, usage: emptyUsage() };
  }
}

async function finalizeReviewCall(reservation, responseData) {
  if (!reservation || !reservation.allowed) return null;
  const parsed = parseProviderUsage(responseData);
  const charge = actualCharge(reservation.reservedCost, parsed);
  try {
    return await activeStore().recordActual({
      reservedCost: reservation.reservedCost,
      inputTokens: parsed.malformed ? 0 : parsed.inputTokens,
      outputTokens: parsed.malformed ? 0 : parsed.outputTokens,
      totalTokens: parsed.malformed ? 0 : parsed.totalTokens,
      actualCost: charge,
    });
  } catch (_err) {
    console.error('[OPENROUTER] usage update failed; reserved cost kept');
    return null;
  }
}

async function safeRead() {
  try {
    return await activeStore().readUsage();
  } catch (_err) {
    return usageSnapshot(emptyUsage());
  }
}

async function getUsageSummary() {
  return safeRead();
}

function logBudget(event, details) {
  const usage = details.usage || {};
  console.log(
    `[OPENROUTER] ${event} model=${details.model || ''} ` +
    `inputTokens=${details.inputTokens ?? usage.input_tokens ?? 0} ` +
    `outputTokens=${details.outputTokens ?? usage.output_tokens ?? 0} ` +
    `totalTokens=${details.totalTokens ?? usage.total_tokens ?? 0} ` +
    `estimatedCost=${details.estimatedCost ?? usage.estimated_cost_usd ?? 0} ` +
    `remainingBudget=${usage.remaining_budget_usd ?? ''} ` +
    `requestCount=${usage.request_count ?? ''}`
  );
}

module.exports = {
  isOpenRouterEnabled,
  maxBudgetUsd,
  maxOutputTokens,
  maxRequestsPerDay,
  estimateTokens,
  estimateCostUsd,
  estimateMaxCostUsd,
  parseProviderUsage,
  createMemoryUsageStore,
  setUsageStore,
  clearUsageStore,
  reserveReviewCall,
  finalizeReviewCall,
  getUsageSummary,
  logBudget,
  usageSnapshot,
};
