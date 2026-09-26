// ============================================
// PostgreSQL Database Adapter
// ============================================
// Implements unified interface for PostgreSQL databases.

const { Pool } = require('pg');

const QUERY_TIMEOUT_MS = 5000;
const MAX_RESULT_ROWS = 100;

class PostgresAdapter {
  constructor(rawUrl, options = {}) {
    this.rawUrl = rawUrl.trim();
    this.type = 'postgres';
    this.name = 'PostgreSQL';
    this.options = options;
    this.pool = null;
    this.initPool();
  }

  initPool() {
    const isNeon = this.rawUrl.includes('neon.tech');
    this.pool = new Pool({
      connectionString: this.rawUrl,
      ssl: isNeon || this.rawUrl.includes('sslmode=require')
        ? { rejectUnauthorized: false }
        : false,
      connectionTimeoutMillis: 7000,
    });
  }

  parseDetails() {
    try {
      const parsed = new URL(this.rawUrl);
      return {
        host: parsed.hostname || 'localhost',
        port: parsed.port || '5432',
        databaseName: parsed.pathname ? parsed.pathname.replace(/^\//, '') : 'postgres',
      };
    } catch {
      const match = this.rawUrl.match(/@([^:/]+)(?::(\d+))?\/([^?]+)/);
      if (match) {
        return { host: match[1], port: match[2] || '5432', databaseName: match[3] };
      }
      return { host: 'unknown', port: '5432', databaseName: 'postgres' };
    }
  }

  async testConnection() {
    const client = await this.pool.connect();
    try {
      const dbRes = await client.query('SELECT current_database() AS db_name, version() AS version;');
      const dbName = dbRes.rows[0]?.db_name || 'postgres';

      const tablesRes = await client.query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
          AND table_type = 'BASE TABLE' 
        ORDER BY table_name;
      `);

      const tables = tablesRes.rows.map((r) => r.table_name);
      const details = this.parseDetails();

      return {
        ok: true,
        type: this.type,
        name: this.name,
        databaseName: dbName || details.databaseName,
        host: details.host,
        port: details.port,
        tableCount: tables.length,
        tables,
        version: dbRes.rows[0]?.version || '',
      };
    } finally {
      client.release();
    }
  }

  async discoverSchema() {
    const client = await this.pool.connect();
    try {
      const schema = {
        tables: {},
        relationships: [],
      };

      // Columns
      const columnsResult = await client.query(`
        SELECT
          t.table_name,
          c.column_name,
          c.data_type
        FROM information_schema.tables t
        JOIN information_schema.columns c
          ON t.table_name = c.table_name
          AND t.table_schema = c.table_schema
        WHERE t.table_schema = 'public'
          AND t.table_type = 'BASE TABLE'
        ORDER BY t.table_name, c.ordinal_position;
      `);

      for (const row of columnsResult.rows) {
        const tableName = row.table_name;
        if (!schema.tables[tableName]) {
          schema.tables[tableName] = {
            columns: {},
            primaryKeys: [],
          };
        }
        schema.tables[tableName].columns[row.column_name] = row.data_type;
      }

      // Primary keys
      const pkResult = await client.query(`
        SELECT
          tc.table_name,
          kcu.column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
        WHERE tc.table_schema = 'public'
          AND tc.constraint_type = 'PRIMARY KEY';
      `);

      for (const row of pkResult.rows) {
        if (schema.tables[row.table_name]) {
          schema.tables[row.table_name].primaryKeys.push(row.column_name);
        }
      }

      // Foreign keys
      const fkResult = await client.query(`
        SELECT
          tc.table_name AS from_table,
          kcu.column_name AS from_column,
          ccu.table_name AS to_table,
          ccu.column_name AS to_column
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
        JOIN information_schema.constraint_column_usage ccu
          ON ccu.constraint_name = tc.constraint_name
          AND ccu.table_schema = tc.table_schema
        WHERE tc.constraint_type = 'FOREIGN KEY'
          AND tc.table_schema = 'public';
      `);

      for (const row of fkResult.rows) {
        schema.relationships.push({
          from: `${row.from_table}.${row.from_column}`,
          to: `${row.to_table}.${row.to_column}`,
        });
      }

      return schema;
    } finally {
      client.release();
    }
  }

  async executeQuery(sql, options = {}) {
    const startTime = Date.now();
    const client = await this.pool.connect();

    try {
      await client.query(`SET statement_timeout = '${QUERY_TIMEOUT_MS}';`);
      const result = await client.query(sql);
      const executionTime = Date.now() - startTime;

      let finalColumns = [];
      let finalRows = [];

      if (result.fields && result.fields.length > 0) {
        finalColumns = result.fields.map((f) => f.name);
        finalRows = result.rows || [];
      }

      let rows = finalRows;
      let rowLimitApplied = false;

      if (rows.length > MAX_RESULT_ROWS) {
        rows = rows.slice(0, MAX_RESULT_ROWS);
        rowLimitApplied = true;
      }

      return {
        columns: finalColumns,
        rows,
        executionTime,
        totalRows: finalRows.length,
        rowCount: typeof result.rowCount === 'number' && finalRows.length === 0 ? result.rowCount : rows.length,
        affectedRows: typeof result.rowCount === 'number' ? result.rowCount : rows.length,
        rowLimitApplied,
      };
    } finally {
      client.release();
    }
  }

  async executeWrite(sql) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN;');
      const result = await client.query(sql);
      await client.query('COMMIT;');
      return {
        affectedRows: typeof result.rowCount === 'number' ? result.rowCount : 0,
        rowCount: typeof result.rowCount === 'number' ? result.rowCount : 0,
      };
    } catch (err) {
      await client.query('ROLLBACK;').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  async close() {
    if (this.pool) {
      await this.pool.end().catch(() => {});
      this.pool = null;
    }
  }
}

module.exports = { PostgresAdapter };
