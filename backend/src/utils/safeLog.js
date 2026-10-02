// Redaction helpers for logs. Never print secrets or literal SQL values.

function redactLogText(value) {
  return String(value || '')
    .replace(/(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|sqlite):\/\/\S+/gi, '[redacted-url]')
    .replace(/\b(?:password|passwd|pwd)\s*[:=]\s*\S+/gi, 'password=[redacted]')
    .replace(/([?&]password=)[^&\s]+/gi, '$1[redacted]')
    .replace(/\b(?:eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+)\b/g, '[redacted-jwt]')
    .replace(/\b(?:sk|pk|rk)-[A-Za-z0-9_-]{8,}\b/g, '[redacted-key]')
    .replace(/ENOTFOUND\s+\S+/gi, 'ENOTFOUND [redacted-host]')
    .replace(/EAI_AGAIN\s+\S+/gi, 'EAI_AGAIN [redacted-host]')
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[redacted-host]')
    .replace(/\b[a-z0-9][a-z0-9.-]*\.(?:neon\.tech|amazonaws\.com|com|net|org|io)\b/gi, '[redacted-host]');
}

function redactSql(sql) {
  const text = String(sql || '').trim();
  if (!text) return '';
  const operation = (text.match(/^(\w+)/) || [, 'SQL'])[1].toUpperCase();
  const tableMatch = text.match(/\b(?:INTO|UPDATE|FROM|TABLE)\s+["'`]?([A-Za-z_][\w]*)/i);
  const table = tableMatch ? tableMatch[1] : 'unknown';

  if (operation === 'INSERT') {
    const columnMatch = text.match(/\(([^)]+)\)\s*VALUES/i);
    const columns = columnMatch
      ? columnMatch[1].split(',').map((column) => column.trim()).filter(Boolean)
      : [];
    const placeholders = columns.length ? columns.map(() => '?').join(', ') : '?';
    const columnList = columns.length ? ` (${columns.join(', ')})` : '';
    return `INSERT INTO ${table}${columnList} VALUES (${placeholders})`;
  }

  if (operation === 'UPDATE') {
    return `UPDATE ${table} SET [columns] WHERE [redacted]`;
  }

  if (operation === 'DELETE') {
    return `DELETE FROM ${table} WHERE [redacted]`;
  }

  return text
    .replace(/'(?:[^'\\]|\\.)*'/g, '?')
    .replace(/"(?:[^"\\]|\\.)*"/g, '?')
    .replace(/\b\d+(?:\.\d+)?\b/g, '?');
}

function logSafeSql(label, sql) {
  console.log(`${label} ${redactSql(sql)}`);
}

function safeErrorMessage(err) {
  return redactLogText(err && err.message ? err.message : err)
    .replace(/'(?:[^'\\]|\\.)*'/g, '?');
}

module.exports = {
  redactLogText,
  redactSql,
  logSafeSql,
  safeErrorMessage,
};
