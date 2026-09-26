// ============================================
// Table Workspace — live reads and direct edits
// ============================================
// Table names and column names are checked against the live schema.
// Values are literals inside a statement that then passes the local validator.
// The frontend never supplies SQL.

const { validateQuery } = require('../utils/sqlValidator');

function assertIdentifier(name) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(String(name || ''))) {
    throw new Error('Invalid table or column name.');
  }
  return String(name);
}

function quoteIdent(name, dbType) {
  const safe = assertIdentifier(name);
  return dbType === 'mysql' ? `\`${safe}\`` : `"${safe}"`;
}

function resolveTable(schema, requested) {
  const tableName = Object.keys(schema?.tables || {}).find(
    (name) => name.toLowerCase() === String(requested || '').toLowerCase()
  );
  if (!tableName) {
    throw new Error('That table is not in the connected database.');
  }
  return tableName;
}

function columnType(tableInfo, column) {
  return String(tableInfo.columns[column] || '').toLowerCase();
}

function isNumericType(type) {
  return /int|numeric|decimal|double|float|real|serial/.test(type);
}

function sqlLiteral(value, type) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'string' && value.trim() === '' && isNumericType(type)) return 'NULL';
  if (isNumericType(type)) {
    const num = Number(value);
    if (!Number.isFinite(num)) throw new Error(`"${value}" is not a valid number.`);
    return String(num);
  }
  if (/bool/.test(type)) {
    if (value === true || value === 'true') return 'TRUE';
    if (value === false || value === 'false') return 'FALSE';
  }
  return `'${String(value).replace(/'/g, "''")}'`;
}

function orderSql(dbType) {
  return dbType === 'sqlite' ? 'LIKE' : 'ILIKE';
}

async function browseTable(adapter, schema, { table, page = 1, limit = 50, sort = '', dir = 'asc', q = '' }) {
  const dbType = adapter.type || 'postgres';
  const tableName = resolveTable(schema, table);
  const tableInfo = schema.tables[tableName];
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 100);
  const safePage = Math.max(parseInt(page, 10) || 1, 1);
  const offset = (safePage - 1) * safeLimit;
  const columns = Object.keys(tableInfo.columns || {});
  const sortCol = columns.find((col) => col.toLowerCase() === String(sort || '').toLowerCase())
    || (tableInfo.primaryKeys || [])[0]
    || columns[0];
  const direction = String(dir).toLowerCase() === 'desc' ? 'DESC' : 'ASC';

  const textCols = columns.filter((col) => !isNumericType(columnType(tableInfo, col)));
  let where = '';
  const needle = String(q || '').trim().slice(0, 80).replace(/[%_']/g, '');
  if (needle && textCols.length > 0) {
    const like = orderSql(dbType);
    where = ` WHERE ${textCols.map((col) => `${quoteIdent(col, dbType)} ${like} '%${needle}%'`).join(' OR ')}`;
  }

  const quotedTable = quoteIdent(tableName, dbType);
  const countSql = `SELECT COUNT(*) AS count FROM ${quotedTable}${where}`;
  const dataSql = `SELECT * FROM ${quotedTable}${where} ORDER BY ${quoteIdent(sortCol, dbType)} ${direction} LIMIT ${safeLimit} OFFSET ${offset}`;

  const countCheck = validateQuery(countSql, schema, dbType, 'read');
  const dataCheck = validateQuery(dataSql, schema, dbType, 'read');
  if (!countCheck.valid) throw new Error(countCheck.error);
  if (!dataCheck.valid) throw new Error(dataCheck.error);

  const started = Date.now();
  const countResult = await adapter.executeQuery(countSql);
  const dataResult = await adapter.executeQuery(dataSql);
  const total = Number(countResult.rows?.[0]?.count ?? countResult.rows?.[0]?.COUNT ?? 0);

  return {
    table: tableName,
    columns: columns.map((name) => ({
      name,
      type: tableInfo.columns[name],
      nullable: tableInfo.nullable ? tableInfo.nullable[name] !== false : true,
      primaryKey: (tableInfo.primaryKeys || []).includes(name),
    })),
    primaryKeys: tableInfo.primaryKeys || [],
    rows: dataResult.rows || [],
    page: safePage,
    limit: safeLimit,
    total,
    sort: sortCol,
    dir: direction.toLowerCase(),
    executionTime: dataResult.executionTime || (Date.now() - started),
  };
}

async function applyDirectChange(adapter, schema, { action, table, primaryKey, changes, values }) {
  const dbType = adapter.type || 'postgres';
  const tableName = resolveTable(schema, table);
  const tableInfo = schema.tables[tableName];
  const known = new Set(Object.keys(tableInfo.columns || {}));
  const keys = tableInfo.primaryKeys || [];
  if ((action === 'update' || action === 'delete') && keys.length === 0) {
    throw new Error('This table has no primary key, so a single row cannot be edited safely.');
  }

  const quotedTable = quoteIdent(tableName, dbType);
  let sql = '';

  if (action === 'update') {
    const entries = Object.entries(changes || {}).filter(([col]) => known.has(col) && !keys.includes(col));
    if (entries.length === 0) throw new Error('No editable columns were provided.');
    const setSql = entries.map(([col, value]) => `${quoteIdent(col, dbType)} = ${sqlLiteral(value, columnType(tableInfo, col))}`).join(', ');
    const whereSql = keys.map((col) => {
      if (primaryKey?.[col] === undefined) throw new Error(`Primary key "${col}" is required.`);
      return `${quoteIdent(col, dbType)} = ${sqlLiteral(primaryKey[col], columnType(tableInfo, col))}`;
    }).join(' AND ');
    sql = `UPDATE ${quotedTable} SET ${setSql} WHERE ${whereSql}`;
  } else if (action === 'insert') {
    const entries = Object.entries(values || {}).filter(([col, value]) => known.has(col) && value !== undefined && value !== '');
    if (entries.length === 0) throw new Error('Enter at least one column value.');
    const cols = entries.map(([col]) => quoteIdent(col, dbType)).join(', ');
    const vals = entries.map(([col, value]) => sqlLiteral(value, columnType(tableInfo, col))).join(', ');
    sql = `INSERT INTO ${quotedTable} (${cols}) VALUES (${vals})`;
  } else if (action === 'delete') {
    const whereSql = keys.map((col) => {
      if (primaryKey?.[col] === undefined) throw new Error(`Primary key "${col}" is required.`);
      return `${quoteIdent(col, dbType)} = ${sqlLiteral(primaryKey[col], columnType(tableInfo, col))}`;
    }).join(' AND ');
    sql = `DELETE FROM ${quotedTable} WHERE ${whereSql}`;
  } else {
    throw new Error('Unsupported row action.');
  }

  const validation = validateQuery(sql, schema, dbType, 'write');
  if (!validation.valid) throw new Error(validation.error);

  const result = await adapter.executeWrite(sql);
  const affected = result.affectedRows ?? result.rowCount ?? 0;
  if ((action === 'update' || action === 'delete') && affected !== 1) {
    throw new Error(affected === 0
      ? 'No matching row was found. No database changes were made.'
      : `The statement matched ${affected} rows, so it was not applied as a single-row edit.`);
  }

  return {
    action,
    table: tableName,
    affectedRows: affected,
    sql,
  };
}

module.exports = {
  browseTable,
  applyDirectChange,
  resolveTable,
};
