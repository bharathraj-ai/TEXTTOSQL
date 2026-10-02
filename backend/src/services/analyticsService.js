// ============================================
// Table Analytics — database aggregations
// ============================================
// The frontend sends a table name. This service builds the SQL.
// Statistics come from COUNT/MIN/MAX/AVG/SUM/GROUP BY, not from a page of rows.

const { validateQuery } = require('../utils/sqlValidator');
const { resolveTable } = require('./tableWorkspaceService');

const DISTRIBUTION_LIMIT = 10;
const TIMELINE_LIMIT = 24;
const MAX_DISTRIBUTION_COLUMNS = 8;

function assertIdentifier(name) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(String(name || ''))) {
    const error = new Error('Invalid table or column name.');
    error.statusCode = 400;
    throw error;
  }
  return String(name);
}

function quoteIdent(name, dbType) {
  const safe = assertIdentifier(name);
  return dbType === 'mysql' ? `\`${safe}\`` : `"${safe}"`;
}

function columnKind(name, type, primaryKeys) {
  const dataType = String(type || '').toLowerCase();
  if (/json|blob|bytea|binary/.test(dataType)) return 'other';
  if (/bool/.test(dataType)) return 'categorical';
  if (/date|time|timestamp|datetime/.test(dataType)) return 'date';
  if (/int|numeric|decimal|float|double|real|serial|money|number/.test(dataType)) {
    const isIdentifier = (primaryKeys || []).some((key) => key.toLowerCase() === String(name).toLowerCase())
      && /^(id|_id)$/i.test(name);
    return isIdentifier ? 'identifier' : 'numeric';
  }
  return 'categorical';
}

function field(row, name) {
  if (!row) return undefined;
  if (Object.prototype.hasOwnProperty.call(row, name)) return row[name];
  const match = Object.keys(row).find((key) => key.toLowerCase() === String(name).toLowerCase());
  return match ? row[match] : undefined;
}

function asNumber(value) {
  if (value == null || value === '') return null;
  const num = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(num) ? num : null;
}

function asDateText(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function sqlNumber(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    throw new Error('Unable to calculate analytics.');
  }
  return String(num);
}

function monthExpression(dbType, quotedColumn) {
  if (dbType === 'sqlite') return `strftime('%Y-%m', ${quotedColumn})`;
  if (dbType === 'mysql') return `DATE_FORMAT(${quotedColumn}, '%Y-%m')`;
  return `to_char(date_trunc('month', ${quotedColumn}), 'YYYY-MM')`;
}

function unsupported(dbType) {
  const error = new Error(
    dbType === 'mongodb'
      ? 'Analytics are not available for MongoDB connections.'
      : `Analytics are not available for ${dbType || 'this database'}.`,
  );
  error.statusCode = 400;
  error.code = 'ANALYTICS_UNSUPPORTED';
  return error;
}

async function runSelect(adapter, schema, sql) {
  const dbType = adapter.type || 'postgres';
  const check = validateQuery(sql, schema, dbType, 'read');
  if (!check.valid) {
    const error = new Error('Unable to calculate analytics.');
    error.statusCode = 400;
    throw error;
  }
  const result = await adapter.executeQuery(sql);
  return result?.rows || [];
}

function pickColumns(columns, kind, patterns, limit) {
  const matches = columns.filter((column) => column.kind === kind);
  const ranked = [...matches].sort((left, right) => {
    const score = (column) => {
      const index = patterns.findIndex((pattern) => pattern.test(column.name));
      return index === -1 ? patterns.length + 1 : index;
    };
    return score(left) - score(right);
  });
  return ranked.slice(0, limit);
}

function histogramBins(min, max) {
  if (min === max) {
    return [{ start: min, end: max, last: true }];
  }
  const span = max - min;
  const step = span / 5;
  return Array.from({ length: 5 }, (_, index) => {
    const start = min + (index * step);
    const end = index === 4 ? max : min + ((index + 1) * step);
    return { start, end, last: index === 4 };
  });
}

function formatBinLabel(start, end) {
  const compact = (value) => {
    const num = Number(value);
    if (!Number.isFinite(num)) return '0';
    if (Math.abs(num) >= 1000) return String(Math.round(num));
    return String(Math.round(num * 100) / 100);
  };
  return `${compact(start)}–${compact(end)}`;
}

async function computeTableAnalytics(adapter, schema, requestedTable) {
  if (!adapter) {
    const error = new Error('Database not connected.');
    error.statusCode = 400;
    throw error;
  }
  const dbType = adapter.type || 'postgres';
  if (!['postgres', 'sqlite', 'mysql'].includes(dbType)) {
    throw unsupported(dbType);
  }
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(String(requestedTable || ''))) {
    const error = new Error('Choose a table from the sidebar.');
    error.statusCode = 400;
    throw error;
  }

  const tableName = resolveTable(schema, requestedTable);
  const tableInfo = schema.tables[tableName];
  const primaryKeys = tableInfo.primaryKeys || [];
  const quotedTable = quoteIdent(tableName, dbType);
  const described = Object.entries(tableInfo.columns || {}).map(([name, type], index) => ({
    index,
    name,
    dataType: String(type || 'text'),
    kind: columnKind(name, type, primaryKeys),
    quoted: quoteIdent(name, dbType),
  }));

  const selects = ['COUNT(*) AS total_rows'];
  described.forEach((column) => {
    const alias = (suffix) => quoteIdent(`c${column.index}_${suffix}`, dbType);
    selects.push(`COUNT(${column.quoted}) AS ${alias('nonnull')}`);
    if (column.kind === 'numeric') {
      selects.push(`MIN(${column.quoted}) AS ${alias('min')}`);
      selects.push(`MAX(${column.quoted}) AS ${alias('max')}`);
      selects.push(`AVG(${column.quoted}) AS ${alias('avg')}`);
      selects.push(`SUM(${column.quoted}) AS ${alias('sum')}`);
    }
    if (column.kind === 'categorical' || column.kind === 'identifier') {
      selects.push(`COUNT(DISTINCT ${column.quoted}) AS ${alias('distinct')}`);
    }
    if (column.kind === 'date') {
      selects.push(`MIN(${column.quoted}) AS ${alias('earliest')}`);
      selects.push(`MAX(${column.quoted}) AS ${alias('latest')}`);
    }
  });

  const summaryRows = await runSelect(
    adapter,
    schema,
    `SELECT ${selects.join(', ')} FROM ${quotedTable}`,
  );
  const summary = summaryRows[0] || {};
  const totalRows = asNumber(field(summary, 'total_rows')) || 0;

  const columns = described.map((column) => {
    const nonNull = asNumber(field(summary, `c${column.index}_nonnull`)) || 0;
    const base = {
      name: column.name,
      dataType: column.dataType,
      type: column.kind === 'identifier' ? 'identifier' : column.kind,
      count: nonNull,
      nullCount: Math.max(totalRows - nonNull, 0),
    };
    if (column.kind === 'numeric') {
      return {
        ...base,
        min: asNumber(field(summary, `c${column.index}_min`)),
        max: asNumber(field(summary, `c${column.index}_max`)),
        avg: asNumber(field(summary, `c${column.index}_avg`)),
        sum: asNumber(field(summary, `c${column.index}_sum`)),
      };
    }
    if (column.kind === 'date') {
      return {
        ...base,
        earliest: asDateText(field(summary, `c${column.index}_earliest`)),
        latest: asDateText(field(summary, `c${column.index}_latest`)),
      };
    }
    if (column.kind === 'categorical' || column.kind === 'identifier') {
      return {
        ...base,
        distinctCount: asNumber(field(summary, `c${column.index}_distinct`)) || 0,
        distribution: [],
      };
    }
    return base;
  });

  const distributionTargets = totalRows === 0
    ? []
    : pickColumns(described, 'categorical', [/category|status|type|department|role/i, /name/i], MAX_DISTRIBUTION_COLUMNS);

  for (const column of distributionTargets) {
    const rows = await runSelect(
      adapter,
      schema,
      `SELECT ${column.quoted} AS bucket, COUNT(*) AS bucket_count FROM ${quotedTable} WHERE ${column.quoted} IS NOT NULL GROUP BY ${column.quoted} ORDER BY COUNT(*) DESC LIMIT ${DISTRIBUTION_LIMIT}`,
    );
    const target = columns.find((item) => item.name === column.name);
    target.distribution = rows.map((row) => ({
      value: field(row, 'bucket') == null ? '' : String(field(row, 'bucket')),
      count: asNumber(field(row, 'bucket_count')) || 0,
    }));
  }

  const numericTarget = totalRows === 0
    ? null
    : pickColumns(described, 'numeric', [/value|amount|mark|score|price|salary|cost|budget/i], 1)[0] || null;
  let histogram = null;
  let numericComparison = null;
  if (numericTarget) {
    const stats = columns.find((item) => item.name === numericTarget.name);
    if (stats && stats.min != null && stats.max != null) {
      numericComparison = {
        column: numericTarget.name,
        points: [
          { label: 'Min', value: stats.min },
          { label: 'Avg', value: stats.avg },
          { label: 'Max', value: stats.max },
        ],
      };
      const bins = histogramBins(stats.min, stats.max);
      const binSelects = bins.map((bin, index) => {
        const endOperator = bin.last ? '<=' : '<';
        return `SUM(CASE WHEN ${numericTarget.quoted} >= ${sqlNumber(bin.start)} AND ${numericTarget.quoted} ${endOperator} ${sqlNumber(bin.end)} THEN 1 ELSE 0 END) AS ${quoteIdent(`bin_${index}`, dbType)}`;
      });
      const binRows = await runSelect(
        adapter,
        schema,
        `SELECT ${binSelects.join(', ')} FROM ${quotedTable} WHERE ${numericTarget.quoted} IS NOT NULL`,
      );
      const binRow = binRows[0] || {};
      histogram = {
        column: numericTarget.name,
        bins: bins.map((bin, index) => ({
          label: formatBinLabel(bin.start, bin.end),
          count: asNumber(field(binRow, `bin_${index}`)) || 0,
        })),
      };
    }
  }

  const dateTarget = totalRows === 0
    ? null
    : pickColumns(described, 'date', [/created/i, /date|time|updated/i], 1)[0] || null;
  let timeline = null;
  if (dateTarget) {
    const bucket = monthExpression(dbType, dateTarget.quoted);
    const rows = await runSelect(
      adapter,
      schema,
      `SELECT ${bucket} AS bucket, COUNT(*) AS bucket_count FROM ${quotedTable} WHERE ${dateTarget.quoted} IS NOT NULL GROUP BY ${bucket} ORDER BY ${bucket} DESC LIMIT ${TIMELINE_LIMIT}`,
    );
    timeline = {
      column: dateTarget.name,
      points: rows.map((row) => ({
        label: field(row, 'bucket') == null ? '' : String(field(row, 'bucket')),
        count: asNumber(field(row, 'bucket_count')) || 0,
      })).reverse(),
    };
  }

  const categoryChartColumn = distributionTargets
    .map((column) => columns.find((item) => item.name === column.name))
    .find((column) => column?.distribution?.length) || null;
  const insights = [`${tableName} contains ${totalRows} rows.`];
  if (categoryChartColumn?.distribution?.[0]) {
    const top = categoryChartColumn.distribution[0];
    insights.push(`"${top.value}" is the most common ${categoryChartColumn.name} (${top.count} rows).`);
  }
  const sparse = columns.find((column) => column.nullCount > 0 && column.type !== 'identifier');
  if (sparse) {
    insights.push(`${sparse.name} has ${sparse.nullCount} null values and ${sparse.count} non-null values.`);
  }
  const latestColumn = columns.find((column) => column.type === 'date' && column.latest);
  if (latestColumn) {
    insights.push(`Latest ${latestColumn.name} is ${latestColumn.latest}.`);
  }

  const latestRecord = columns
    .filter((column) => column.type === 'date' && column.latest)
    .map((column) => column.latest)
    .sort()
    .pop() || null;

  return {
    table: tableName,
    dbType,
    scope: 'all_rows',
    totalRows,
    summary: {
      numericColumns: columns.filter((column) => column.type === 'numeric').length,
      categoricalColumns: columns.filter((column) => column.type === 'categorical').length,
      dateColumns: columns.filter((column) => column.type === 'date').length,
      latestRecord,
    },
    columns,
    charts: {
      histogram,
      numericComparison,
      category: categoryChartColumn
        ? { column: categoryChartColumn.name, distribution: categoryChartColumn.distribution }
        : null,
      timeline,
    },
    insights,
  };
}

module.exports = {
  computeTableAnalytics,
  columnKind,
  quoteIdent,
  monthExpression,
};
