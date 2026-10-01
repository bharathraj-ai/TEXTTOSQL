// ============================================
// Formatting Helpers for Database Values
// ============================================

/**
 * Checks if a column represents a currency / monetary amount.
 */
export function isCurrencyColumn(colName, colType = '') {
  const name = String(colName || '').toLowerCase();
  const type = String(colType || '').toLowerCase();
  if (/money|currency/.test(type)) return true;
  return /budget|revenue|price|amount|salary|cost|fee|total_amount|balance|spend|value/.test(name);
}

/**
 * Checks if a column represents status / state.
 */
export function isStatusColumn(colName) {
  const name = String(colName || '').toLowerCase();
  return /status|state|condition/.test(name);
}

/**
 * Formats currency values in a clean, human-readable format.
 * Defaults to INR (₹) or USD based on prefix, default to ₹ for rupees.
 */
export function formatCurrency(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return String(value ?? '');
  
  // Format as Indian Rupee style
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(num);
}

/**
 * Formats a compact currency (e.g. ₹4.2L or ₹42L).
 */
export function formatCompactCurrency(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return String(value ?? '');
  
  if (Math.abs(num) >= 10000000) {
    return `₹${(num / 10000000).toFixed(1).replace(/\.0$/, '')}Cr`;
  }
  if (Math.abs(num) >= 100000) {
    return `₹${(num / 100000).toFixed(1).replace(/\.0$/, '')}L`;
  }
  if (Math.abs(num) >= 1000) {
    return `₹${(num / 1000).toFixed(1).replace(/\.0$/, '')}K`;
  }
  return `₹${num.toLocaleString('en-IN')}`;
}

/**
 * Formats standard numeric values with commas and tabular spacing.
 */
export function formatNumber(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return String(value ?? '');
  return new Intl.NumberFormat('en-IN').format(num);
}

/**
 * Formats date/timestamp values cleanly.
 */
export function formatDate(value) {
  if (value == null || value === '') return '';
  const text = String(value);
  const stored = text.match(/^(\d{4}-\d{2}-\d{2})/);
  if (stored) return stored[1];
  const d = new Date(text);
  if (isNaN(d.getTime())) return text;
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

/**
 * Checks if a string is a recognized status keyword.
 */
export function getStatusStyle(value) {
  const str = String(value || '').trim().toLowerCase();
  if (['active', 'completed', 'success', 'approved', 'paid', 'open'].includes(str)) {
    return { className: 'status-active', label: capitalize(str) };
  }
  if (['pending', 'in_progress', 'processing', 'review', 'running'].includes(str)) {
    return { className: 'status-pending', label: capitalize(str.replace('_', ' ')) };
  }
  if (['inactive', 'failed', 'cancelled', 'rejected', 'closed', 'deleted'].includes(str)) {
    return { className: 'status-inactive', label: capitalize(str) };
  }
  return null;
}

function capitalize(s) {
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1);
}
