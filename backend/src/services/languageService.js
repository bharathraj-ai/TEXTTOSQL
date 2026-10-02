// ============================================
// Language service — Tamil, Tanglish, and mixed requests
// ============================================
// Turns a user sentence into a structured intent and an English
// request the existing local SQL pipeline already understands.
// This module does not generate executable SQL and does not
// connect to a database or an AI provider.

const { parseNumericExpression } = require('./mutationService');

const TAMIL_SCRIPT = /[\u0B80-\u0BFF]/;
const TANGLISH_MARKERS = /\b(ku|kku|mela|mele|keela|kudu|kudunga|kaatu|kaattu|pannu|panni|illa|illatha|irukku|irukkura|irukkuravanga|vanguna|oda|ellarayum|adhigama|kammi|vida)\b|\b(?:ah|la)\b/i;
const ENGLISH_COMMANDS = /\b(show|list|display|select|update|delete|drop|insert|truncate|alter|table)\b/i;

const TAMIL_GLOSSES = [
  [/ராஹுலின்/g, "Rahul's"],
  [/ராஹுலை/g, 'Rahul'],
  [/ராஹுல்/g, 'Rahul'],
  [/விற்பனையாளர்களின்/g, 'vendors'],
  [/விற்பனையாளர்களை/g, 'vendors'],
  [/விற்பனையாளர்கள்/g, 'vendors'],
  [/விற்பனையாளர்/g, 'vendor'],
  [/மாணவர்களை/g, 'students'],
  [/மாணவர்கள்/g, 'students'],
  [/மாணவர்/g, 'student'],
  [/மதிப்பெண்ணை/g, 'mark'],
  [/மதிப்பெண்/g, 'mark'],
  [/பட்டியலை/g, 'list'],
  [/பட்டியல்/g, 'list'],
  [/காட்டுங்கள்/g, 'show'],
  [/காட்டு/g, 'show'],
  [/நீக்கு/g, 'delete'],
  [/மாற்று/g, 'update'],
  [/மேல்/g, 'mela'],
  [/கீழ்/g, 'keela'],
  [/இல்லாத/g, 'illatha'],
  [/இல்லை/g, 'illa'],
  [/இருக்கிற/g, 'irukkura'],
  [/அனைவரையும்/g, 'ellarayum'],
  [/எல்லோரையும்/g, 'ellarayum'],
  [/பெற்ற/g, ' '],
  [/ஆக/g, 'to'],
];

const STOPWORDS = new Set([
  'ku', 'kku', 'mela', 'mele', 'keela', 'kudu', 'kudunga', 'kaatu', 'kaattu',
  'pannu', 'panni', 'pannunga', 'illa', 'illatha', 'irukku', 'irukkura',
  'irukkuravanga', 'irukura', 'vanguna', 'ah', 'la', 'oda', 'ellarayum', 'ellam',
  'adhigama', 'kammi', 'vida', 'show', 'list', 'display', 'table', 'the', 'a',
  'an', 'update', 'delete', 'drop', 'to', 'from', 'where', 'and', 'of', 'is',
  'all', 'rows', 'users', 'equal', 'above', 'below', 'with', 'in', 'on',
]);

const COMPARISONS = [
  { re: /(\d+(?:\.\d+)?)\s+ku\s+mela\b/i, operator: '>' },
  { re: /(\d+(?:\.\d+)?)\s+vida\s+adhigama\b/i, operator: '>' },
  { re: /(\d+(?:\.\d+)?)\s+ku\s+keela\b/i, operator: '<' },
  { re: /(\d+(?:\.\d+)?)\s+vida\s+kammi\b/i, operator: '<' },
  { re: /(\d+(?:\.\d+)?)\s+ku\s+equal\b/i, operator: '=' },
  { re: /(\d+(?:\.\d+)?)\s+ah\s+irukku\b/i, operator: '=' },
  { re: /\b(?:above|greater than|more than|over)\s+(\d+(?:\.\d+)?)/i, operator: '>' },
  { re: /\b(?:below|less than|under)\s+(\d+(?:\.\d+)?)/i, operator: '<' },
];

function detectLanguage(text) {
  const hasTamil = TAMIL_SCRIPT.test(text);
  const latinWords = text.replace(TAMIL_SCRIPT, ' ').match(/[A-Za-z]{2,}/g) || [];
  const hasTanglish = TANGLISH_MARKERS.test(text);
  if (hasTamil && latinWords.length > 0) return 'mixed';
  if (hasTamil) return 'tamil';
  if (hasTanglish && ENGLISH_COMMANDS.test(text)) return 'mixed';
  if (hasTanglish) return 'tanglish';
  return 'english';
}

function glossTamil(text) {
  let next = text.replace(/([0-9]+(?:\.[0-9]+)?)க்கு/g, '$1 ku');
  for (const [pattern, replacement] of TAMIL_GLOSSES) {
    next = next.replace(pattern, ` ${replacement} `);
  }
  return next.replace(/\s+/g, ' ').trim();
}

function expandNumbers(text) {
  return text.replace(
    /(\d+(?:\.\d+)?)\s*(cr|crores?|lakhs?|lacs?|millions?|thousand|k)\b(?:\s+rupees)?/gi,
    (full) => {
      const value = parseNumericExpression(full.replace(/\s+rupees$/i, ''));
      return value == null ? full : String(value);
    }
  );
}

function prepareText(text) {
  return expandNumbers(
    glossTamil(text)
      .replace(/(\d)\s*-\s*ku\b/gi, '$1 ku')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

function normalizeAmount(raw) {
  return parseNumericExpression(raw);
}

function operatorPhrase(operator) {
  if (operator === '>') return 'greater than';
  if (operator === '<') return 'less than';
  if (operator === '=') return 'equal to';
  if (operator === 'IS NULL') return 'null';
  if (operator === 'IS NOT NULL') return 'not null';
  return operator;
}

function tokensOf(text) {
  return text.split(/\s+/).filter(Boolean);
}

function contentTokens(text) {
  return tokensOf(text.toLowerCase()).filter((token) => !STOPWORDS.has(token) && !/^\d+(?:\.\d+)?$/.test(token));
}

function columnNear(text, matchIndex, matchLength) {
  const before = text.slice(0, matchIndex).trim().split(/\s+/).filter(Boolean);
  const after = text.slice(matchIndex + matchLength).trim().split(/\s+/).filter(Boolean);
  const afterColumn = after.find((token) => !STOPWORDS.has(token.toLowerCase()) && !/^\d/.test(token));
  if (afterColumn && !/^(students|vendors|users)$/i.test(afterColumn)) return afterColumn.toLowerCase();
  const beforeWords = [];
  for (let index = before.length - 1; index >= 0 && beforeWords.length < 2; index -= 1) {
    const token = before[index];
    if (STOPWORDS.has(token.toLowerCase()) || /^\d/.test(token)) break;
    if (/^(students|vendors|users)$/i.test(token)) break;
    beforeWords.unshift(token);
  }
  return beforeWords.join(' ').toLowerCase() || null;
}

function findComparison(text) {
  for (const pattern of COMPARISONS) {
    const match = pattern.re.exec(text);
    if (!match) continue;
    return {
      operator: pattern.operator,
      value: Number(match[1]),
      column_hint: columnNear(text, match.index, match[0].length),
    };
  }
  return null;
}

function findNullCondition(text) {
  const missing = text.match(/\b([a-z][a-z0-9_]*)\s+illa(?:tha)?\b/i);
  if (missing && !STOPWORDS.has(missing[1].toLowerCase())) {
    return { column_hint: missing[1].toLowerCase(), operator: 'IS NULL', value: null };
  }
  const present = text.match(/\b([a-z][a-z0-9_]*)\s+irukkura\b/i);
  if (present && !STOPWORDS.has(present[1].toLowerCase())) {
    return { column_hint: present[1].toLowerCase(), operator: 'IS NOT NULL', value: null };
  }
  return null;
}

function findTableHint(text, reserved = []) {
  const reservedSet = new Set(reserved.filter(Boolean).map((item) => item.toLowerCase()));
  const token = contentTokens(text).find((item) => !reservedSet.has(item) && item !== 'database');
  return token || null;
}

function baseResult(language) {
  return {
    language,
    intent: null,
    status: 'ok',
    mass: false,
    entities: {
      table_hint: null,
      conditions: [],
      assignments: null,
    },
    normalized_request: null,
    message: null,
    options: [],
  };
}

function clarify(language, message, options = []) {
  return {
    ...baseResult(language),
    status: 'clarification',
    message,
    options,
    normalized_request: null,
  };
}

function buildRequest(result) {
  const table = result.entities.table_hint;
  const condition = result.entities.conditions[0];
  const assignmentColumn = result.entities.assignments ? Object.keys(result.entities.assignments)[0] : null;
  const assignmentValue = assignmentColumn ? result.entities.assignments[assignmentColumn] : null;
  if (result.intent === 'DROP') {
    if (table === 'database') return 'Drop database';
    return table ? `Drop the ${table} table` : 'Drop table';
  }
  if (result.intent === 'TRUNCATE') return table ? `Truncate the ${table} table` : 'Truncate table';
  if (result.intent === 'ALTER') return table ? `Alter the ${table} table` : 'Alter table';
  if (result.intent === 'UPDATE') {
    const name = condition && condition.column_hint === 'name' ? condition.value : null;
    if (name && assignmentColumn) return `Update ${name}'s ${assignmentColumn} to ${assignmentValue}`;
    if (assignmentColumn && table) return `Update ${table} set ${assignmentColumn} to ${assignmentValue}`;
    if (assignmentColumn) return `Update ${assignmentColumn} to ${assignmentValue}`;
    return 'Update record';
  }
  if (result.intent === 'DELETE') {
    if (result.mass && table) return `Delete all rows from ${table}`;
    if (condition && condition.column_hint === 'name') return `Delete ${condition.value}`;
    return table ? `Delete from ${table}` : 'Delete record';
  }
  if (result.intent === 'INSERT') return table ? `Insert a row into ${table}` : 'Insert a row';
  if (!condition) return table ? `Show ${table}` : 'Show records';
  if (condition.operator === 'IS NULL' || condition.operator === 'IS NOT NULL') {
    return `Show ${table || 'records'} where ${condition.column_hint} is ${operatorPhrase(condition.operator)}`;
  }
  return `Show ${table || 'records'} where ${condition.column_hint} is ${operatorPhrase(condition.operator)} ${condition.value}`;
}

function singular(name) {
  const lower = String(name || '').toLowerCase();
  return lower.endsWith('s') && !lower.endsWith('ss') ? lower.slice(0, -1) : lower;
}

function matchSchemaNames(hint, names) {
  if (!hint) return [];
  const target = hint.toLowerCase().replace(/_/g, ' ');
  const targetSingular = singular(target);
  const exact = names.filter((name) => {
    const spaced = name.toLowerCase().replace(/_/g, ' ');
    return spaced === target || singular(spaced) === targetSingular;
  });
  if (exact.length > 0) return exact;
  return names.filter((name) => {
    const parts = name.toLowerCase().replace(/_/g, ' ').split(' ');
    return parts.includes(target) || parts.includes(targetSingular);
  });
}

function schemaTables(schema) {
  return Object.keys(schema?.tables || {});
}

function tablesContaining(schema, hint) {
  return schemaTables(schema).filter((table) =>
    matchSchemaNames(hint, Object.keys(schema.tables[table].columns || {})).length > 0
  );
}

function schemaColumns(schema, tableName) {
  if (tableName && schema?.tables?.[tableName]) return Object.keys(schema.tables[tableName].columns || {});
  const columns = [];
  for (const table of schemaTables(schema)) {
    for (const column of Object.keys(schema.tables[table].columns || {})) {
      columns.push(column);
    }
  }
  return columns;
}

function applySchema(result, schema) {
  if (!schema || result.language === 'english' || result.status !== 'ok') return result;
  const tables = schemaTables(schema);
  let tableMatches = matchSchemaNames(result.entities.table_hint, tables);
  if (tableMatches.length === 0) {
    const hint = result.entities.assignments
      ? Object.keys(result.entities.assignments)[0]
      : result.entities.conditions.find((condition) => condition.column_hint && condition.column_hint !== 'name')?.column_hint;
    const owners = hint ? tablesContaining(schema, hint) : [];
    if (owners.length === 1) tableMatches = owners;
  }
  if (tableMatches.length > 1) {
    return {
      ...result,
      status: 'ambiguous',
      message: `More than one table matches "${result.entities.table_hint}". Which table should be used?`,
      options: tableMatches,
      normalized_request: null,
    };
  }
  const table = tableMatches[0] || result.entities.table_hint;
  const columnPool = schemaColumns(schema, tableMatches[0] || null);
  const nextConditions = [];
  for (const condition of result.entities.conditions) {
    if (!condition.column_hint || condition.column_hint === 'name') {
      nextConditions.push(condition);
      continue;
    }
    const matches = matchSchemaNames(condition.column_hint, columnPool);
    if (matches.length > 1) {
      return {
        ...result,
        status: 'ambiguous',
        message: `More than one column matches "${condition.column_hint}". Which column should be used?`,
        options: matches,
        normalized_request: null,
      };
    }
    nextConditions.push({ ...condition, column_hint: matches[0] || condition.column_hint });
  }
  let assignments = result.entities.assignments;
  if (assignments) {
    const column = Object.keys(assignments)[0];
    const matches = matchSchemaNames(column, columnPool);
    if (matches.length > 1) {
      return {
        ...result,
        status: 'ambiguous',
        message: `More than one column matches "${column}". Which column should be used?`,
        options: matches,
        normalized_request: null,
      };
    }
    assignments = { [matches[0] || column]: assignments[column] };
  }
  const resolved = {
    ...result,
    entities: {
      ...result.entities,
      table_hint: table,
      conditions: nextConditions,
      assignments,
    },
  };
  resolved.normalized_request = buildRequest(resolved);
  return resolved;
}

function analyzeLanguage(text, schema = null) {
  const original = String(text || '').trim();
  const language = detectLanguage(original);
  if (!original) return { ...baseResult('english'), normalized_request: '' };
  if (language === 'english') {
    return { ...baseResult('english'), normalized_request: original };
  }

  const prepared = prepareText(original);
  const lower = prepared.toLowerCase();
  const result = baseResult(language);

  if (/\bdrop\b/.test(lower) && /\bdatabase\b/.test(lower)) {
    result.intent = 'DROP';
    result.entities.table_hint = 'database';
    result.normalized_request = buildRequest(result);
    return result;
  }

  if (/\bdrop\b/.test(lower)) {
    result.intent = 'DROP';
    result.entities.table_hint = findTableHint(lower, ['drop']);
    result.normalized_request = buildRequest(result);
    return applySchema(result, schema);
  }

  if (/\btable\b/.test(lower) && /\bdelete\b/.test(lower) && !/\b(row|rows|ellarayum)\b/.test(lower)) {
    const table = findTableHint(lower, ['delete']);
    return clarify(
      language,
      table
        ? `Do you want to delete rows from ${table}, or drop the ${table} table?`
        : 'Do you want to delete rows, or drop the table?',
      table ? [`Delete rows from ${table}`, `Drop the ${table} table`] : ['Delete rows', 'Drop the table']
    );
  }

  if (/\btruncate\b/.test(lower)) {
    result.intent = 'TRUNCATE';
    result.entities.table_hint = findTableHint(lower);
    result.normalized_request = buildRequest(result);
    return applySchema(result, schema);
  }

  if (/\balter\b/.test(lower)) {
    result.intent = 'ALTER';
    result.entities.table_hint = findTableHint(lower);
    result.normalized_request = buildRequest(result);
    return applySchema(result, schema);
  }

  if (/\b(update|set)\b/.test(lower) || /\boda\b/.test(lower) && /\b\d/.test(lower) && /\b(ah|to)\b/.test(lower)) {
    result.intent = 'UPDATE';
    const possessive = prepared.match(/\b([A-Za-z][A-Za-z0-9]*)'s\s+([a-z][a-z0-9_]*)\s+(?:to\s+)?(\d+(?:\.\d+)?)/i)
      || prepared.match(/\b([A-Za-z][A-Za-z0-9]*)\s+oda\s+([a-z][a-z0-9_]*)\s+(\d+(?:\.\d+)?)/i);
    if (possessive) {
      result.entities.assignments = { [possessive[2].toLowerCase()]: Number(possessive[3]) };
      result.entities.conditions = [{ column_hint: 'name', operator: '=', value: possessive[1] }];
    } else {
      const bare = prepared.match(/\b([a-z][a-z0-9_]*)\s+ah\s+(\d+(?:\.\d+)?)\s+update\b/i)
        || prepared.match(/\b([a-z][a-z0-9_]*)\s+(\d+(?:\.\d+)?)\s+(?:ah\s+)?update\b/i);
      if (bare && !STOPWORDS.has(bare[1].toLowerCase())) {
        result.entities.assignments = { [bare[1].toLowerCase()]: Number(bare[2]) };
      }
    }
    result.entities.table_hint = findTableHint(lower, [
      possessive && possessive[1].toLowerCase(),
      possessive && possessive[2].toLowerCase(),
      result.entities.assignments && Object.keys(result.entities.assignments)[0],
    ]);
    result.normalized_request = buildRequest(result);
    return applySchema(result, schema);
  }

  if (/\bellarayum\b/.test(lower) && /\bdelete\b/.test(lower)) {
    result.intent = 'DELETE';
    result.mass = true;
    result.entities.table_hint = findTableHint(lower, ['delete']);
    result.normalized_request = buildRequest(result);
    return applySchema(result, schema);
  }

  if (/\bdelete\b/.test(lower)) {
    result.intent = 'DELETE';
    const named = prepared.match(/\b([A-Za-z][A-Za-z0-9]*)\s+ah\s+delete\b/i)
      || prepared.match(/\bdelete\s+([A-Za-z][A-Za-z0-9]*)\b/i);
    if (named && !STOPWORDS.has(named[1].toLowerCase()) && !/^(students|vendors|table|rows)$/i.test(named[1])) {
      result.entities.conditions = [{ column_hint: 'name', operator: '=', value: named[1] }];
    }
    result.entities.table_hint = findTableHint(lower, [named && named[1].toLowerCase(), 'delete']);
    result.normalized_request = buildRequest(result);
    return applySchema(result, schema);
  }

  if (/\b(insert|add)\b/.test(lower)) {
    result.intent = 'INSERT';
    result.entities.table_hint = findTableHint(lower);
    result.normalized_request = buildRequest(result);
    return applySchema(result, schema);
  }

  result.intent = 'SELECT';
  const comparison = findComparison(lower);
  const nullCondition = findNullCondition(lower);
  if (comparison) result.entities.conditions.push(comparison);
  if (nullCondition) result.entities.conditions.push(nullCondition);
  const reserved = result.entities.conditions.map((condition) => condition.column_hint);
  result.entities.table_hint = findTableHint(lower, reserved);
  result.normalized_request = buildRequest(result);
  return applySchema(result, schema);
}

module.exports = {
  analyzeLanguage,
  detectLanguage,
  normalizeAmount,
};
