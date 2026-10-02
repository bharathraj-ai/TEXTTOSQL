// ============================================
// MySQL / MariaDB Database Adapter
// ============================================
// Implements unified interface for MySQL and MariaDB databases.

const mysql = require('mysql2/promise');
const { redactLogText } = require('../utils/safeLog');

const QUERY_TIMEOUT_MS = 5000;
const MAX_RESULT_ROWS = 100;

class MysqlAdapter {
  constructor(rawUrl, options = {}) {
    this.rawUrl = rawUrl.trim();
    this.type = 'mysql';
    this.name = 'MySQL';
    this.options = options;
    this.pool = null;
    this.initPool();
  }

  initPool() {
    this.pool = mysql.createPool({
      uri: this.rawUrl,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      connectTimeout: 7000,
    });
  }

  parseDetails() {
    try {
      const parsed = new URL(this.rawUrl);
      return {
        host: parsed.hostname || 'localhost',
        port: parsed.port || '3306',
        databaseName: parsed.pathname ? parsed.pathname.replace(/^\//, '') : 'mysql',
      };
    } catch {
      const match = this.rawUrl.match(/@([^:/]+)(?::(\d+))?\/([^?]+)/);
      if (match) {
        return { host: match[1], port: match[2] || '3306', databaseName: match[3] };
      }
      return { host: 'unknown', port: '3306', databaseName: 'mysql' };
    }
  }

  async testConnection() {
    const connection = await this.pool.getConnection();
    try {
      const [dbRows] = await connection.query('SELECT DATABASE() AS db_name, VERSION() AS version;');
      const dbName = dbRows[0]?.db_name || this.parseDetails().databaseName;
      const version = dbRows[0]?.version || '';

      const [tablesRows] = await connection.query(`
        SELECT TABLE_NAME AS table_name 
        FROM information_schema.TABLES 
        WHERE TABLE_SCHEMA = DATABASE() 
          AND TABLE_TYPE = 'BASE TABLE' 
        ORDER BY TABLE_NAME;
      `);

      const tables = tablesRows.map((r) => r.table_name);
      const details = this.parseDetails();

      return {
        ok: true,
        type: this.type,
        name: this.name,
        databaseName: dbName,
        host: details.host,
        port: details.port,
        tableCount: tables.length,
        tables,
        version,
      };
    } finally {
      connection.release();
    }
  }

  async discoverSchema() {
    const connection = await this.pool.getConnection();
    try {
      const schema = {
        tables: {},
        relationships: [],
      };

      // Columns
      const [columns] = await connection.query(`
        SELECT
          TABLE_NAME AS table_name,
          COLUMN_NAME AS column_name,
          DATA_TYPE AS data_type,
          IS_NULLABLE AS is_nullable,
          COLUMN_DEFAULT AS column_default,
          COLUMN_KEY AS column_key,
          EXTRA AS extra
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
        ORDER BY TABLE_NAME, ORDINAL_POSITION;
      `);

      for (const row of columns) {
        const tableName = row.table_name;
        if (!schema.tables[tableName]) {
          schema.tables[tableName] = {
            columns: {},
            nullable: {},
            defaults: {},
            identity: {},
            primaryKeys: [],
          };
        }
        const tableInfo = schema.tables[tableName];
        tableInfo.columns[row.column_name] = row.data_type;
        tableInfo.nullable[row.column_name] = String(row.is_nullable || '').toUpperCase() === 'YES';
        if (row.column_default != null && String(row.column_default) !== '') {
          tableInfo.defaults[row.column_name] = String(row.column_default);
        }
        if (/auto_increment/i.test(String(row.extra || ''))) {
          tableInfo.identity[row.column_name] = true;
        }
        if (row.column_key === 'PRI') {
          tableInfo.primaryKeys.push(row.column_name);
        }
      }

      // Foreign Keys
      const [fks] = await connection.query(`
        SELECT
          TABLE_NAME AS from_table,
          COLUMN_NAME AS from_column,
          REFERENCED_TABLE_NAME AS to_table,
          REFERENCED_COLUMN_NAME AS to_column
        FROM information_schema.KEY_COLUMN_USAGE
        WHERE TABLE_SCHEMA = DATABASE()
          AND REFERENCED_TABLE_NAME IS NOT NULL;
      `);

      for (const fk of fks) {
        schema.relationships.push({
          from: `${fk.from_table}.${fk.from_column}`,
          to: `${fk.to_table}.${fk.to_column}`,
        });
      }

      return schema;
    } finally {
      connection.release();
    }
  }

  async executeQuery(sql, options = {}) {
    const startTime = Date.now();
    const connection = await this.pool.getConnection();

    try {
      // Set query timeout if supported
      try {
        await connection.query(`SET max_execution_time = ${QUERY_TIMEOUT_MS};`);
      } catch {
        // Some older MySQL versions or MariaDB may ignore or not have max_execution_time
      }

      let rows;
      let fields;
      try {
        [rows, fields] = await connection.query(sql);
      } catch (err) {
        throw mysqlSafeError(err);
      }
      const executionTime = Date.now() - startTime;

      let finalColumns = [];
      let finalRows = [];

      if (fields && fields.length > 0) {
        finalColumns = fields.map((f) => f.name);
      } else if (Array.isArray(rows) && rows.length > 0) {
        finalColumns = Object.keys(rows[0]);
      }

      finalRows = Array.isArray(rows) ? rows : [];

      let limitedRows = finalRows;
      let rowLimitApplied = false;

      if (limitedRows.length > MAX_RESULT_ROWS) {
        limitedRows = limitedRows.slice(0, MAX_RESULT_ROWS);
        rowLimitApplied = true;
      }

      return {
        columns: finalColumns,
        rows: limitedRows,
        executionTime,
        totalRows: finalRows.length,
        rowCount: limitedRows.length,
        affectedRows: rows?.affectedRows ?? limitedRows.length,
        rowLimitApplied,
      };
    } finally {
      connection.release();
    }
  }

  async executeWrite(sql) {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [result] = await connection.query(sql);
      await connection.commit();
      return {
        affectedRows: result.affectedRows ?? 0,
        rowCount: result.affectedRows ?? 0,
      };
    } catch (err) {
      await connection.rollback().catch(() => {});
      throw mysqlSafeError(err);
    } finally {
      connection.release();
    }
  }

  async close() {
    if (this.pool) {
      await this.pool.end().catch(() => {});
      this.pool = null;
    }
  }
}

function mysqlSafeError(err) {
  const text = redactLogText(err && err.message ? err.message : err);
  const safe = new Error(text || 'MySQL query failed.');
  safe.code = err && err.code;
  return safe;
}

module.exports = { MysqlAdapter };
