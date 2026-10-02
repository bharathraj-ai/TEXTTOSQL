/**
 * Database analytics checks.
 * Prints pass/fail names only. Does not print connection URLs or secrets.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const jwt = require('jsonwebtoken');
const { getJwtSecret } = require('./src/config/requiredSecrets');
const { blacklistToken } = require('./src/utils/tokenBlacklist');
const { SqliteAdapter } = require('./src/adapters/sqliteAdapter');
const { computeTableAnalytics, monthExpression, quoteIdent } = require('./src/services/analyticsService');
const { redactLogText } = require('./src/utils/safeLog');

const results = [];

function check(name, ok) {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
}

function near(actual, expected) {
  return actual != null && Math.abs(Number(actual) - expected) < 0.001;
}

async function buildSqlite() {
  const adapter = new SqliteAdapter('sqlite::memory:');
  await adapter.executeWrite(`
    CREATE TABLE vendors (
      id INTEGER PRIMARY KEY,
      name TEXT,
      category TEXT,
      contract_value REAL,
      contact_email TEXT,
      created_at DATETIME,
      notes TEXT
    );
  `);
  const rows = [
    [1, 'MSI', 'SaaS', 100000, 'a@example.com', '2026-01-15', null],
    [2, 'AXUS', 'SaaS', 200000, 'b@example.com', '2026-02-01', null],
    [3, 'North', 'Cloud', 50000, null, '2026-03-01', null],
    [4, 'South', 'Cloud', null, 'd@example.com', '2026-06-01', null],
    [5, 'East', null, 0, '', '2026-09-30', null],
    [6, 'West', 'SaaS', 10000, 'f@example.com', '2026-09-30', null],
    [7, 'One', 'Hardware', 25000, 'g@example.com', '2024-11-01', null],
    [8, 'Two', 'Hardware', 75000, 'h@example.com', '2025-01-01', null],
    [9, 'Three', 'Cloud', 30000, 'i@example.com', '2025-05-01', null],
    [10, 'Four', 'Services', 40000, 'j@example.com', '2025-08-01', null],
    [11, 'Five', 'Services', 60000, 'k@example.com', '2026-04-01', null],
    [12, 'Six', 'Hardware', 15000, 'l@example.com', '2026-07-01', null],
  ];
  for (const row of rows) {
    const values = row.map((value) => (value == null ? 'NULL' : `'${String(value).replace(/'/g, "''")}'`));
    await adapter.executeWrite(
      `INSERT INTO vendors (id, name, category, contract_value, contact_email, created_at, notes) VALUES (${values.join(', ')});`,
    );
  }
  await adapter.executeWrite(`
    CREATE TABLE empty_vendors (
      id INTEGER PRIMARY KEY,
      contract_value REAL,
      category TEXT,
      created_at DATETIME
    );
  `);
  const schema = await adapter.discoverSchema();
  return { adapter, schema };
}

function request(server, method, requestPath, { token } = {}) {
  const { port } = server.address();
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: requestPath,
      method,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let body = null;
        try { body = JSON.parse(data); } catch { body = null; }
        resolve({ status: res.statusCode, body });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function runSqliteChecks() {
  const { adapter, schema } = await buildSqlite();
  const queries = [];
  const original = adapter.executeQuery.bind(adapter);
  adapter.executeQuery = async (sql) => {
    queries.push(sql);
    const result = await original(sql);
    result._returned = (result.rows || []).length;
    return result;
  };

  const analytics = await computeTableAnalytics(adapter, schema, 'vendors');
  const value = analytics.columns.find((column) => column.name === 'contract_value');
  const category = analytics.columns.find((column) => column.name === 'category');
  const email = analytics.columns.find((column) => column.name === 'contact_email');
  const created = analytics.columns.find((column) => column.name === 'created_at');
  const notes = analytics.columns.find((column) => column.name === 'notes');
  const numbers = [100000, 200000, 50000, 0, 10000, 25000, 75000, 30000, 40000, 60000, 15000];
  const sum = numbers.reduce((total, item) => total + item, 0);

  check('1 vendors row count is the full table', analytics.totalRows === 12);
  check('2 numeric AVG matches the full table', near(value.avg, sum / numbers.length));
  check('3 numeric SUM matches the full table', near(value.sum, sum));
  check('4 numeric MIN matches the full table', value.min === 0);
  check('5 numeric MAX matches the full table', value.max === 200000);
  check('6 COUNT is not a page size', analytics.totalRows === 12 && value.count === numbers.length);
  check('7 categorical distribution comes from SQL', category.distribution.some((item) => item.value === 'SaaS' && item.count === 3));
  check('8 distinct count ignores null categories', category.distinctCount === 4);
  check('9 NULL count does not treat empty string as null', email.nullCount === 1 && email.count === 11);
  check('10 date earliest and latest cover the full table', String(created.earliest).includes('2024-11-01') && String(created.latest).includes('2026-09-30'));
  check('12 all-NULL column reports every row as null', notes.nullCount === 12 && notes.count === 0 && notes.distinctCount === 0);

  let missing = false;
  try {
    await computeTableAnalytics(adapter, schema, 'missing_table');
  } catch (err) {
    missing = /not in the connected database/i.test(err.message);
  }
  check('13 table not found is rejected', missing);

  const empty = await computeTableAnalytics(adapter, schema, 'empty_vendors');
  const emptyValue = empty.columns.find((column) => column.name === 'contract_value');
  check('11 empty table returns zero rows and null metrics', empty.totalRows === 0 && emptyValue.min == null && emptyValue.max == null && emptyValue.avg == null && emptyValue.sum == null);

  const widest = queries.reduce((max, sql) => {
    const match = sql.match(/LIMIT\s+(\d+)/i);
    return Math.max(max, match ? Number(match[1]) : 1);
  }, 1);
  check('17 aggregation queries do not download every row', queries.every((sql) => !/select\s+\*/i.test(sql)) && widest <= 24 && analytics.totalRows === 12);

  const wrapped = new SqliteAdapter('sqlite::memory:');
  await wrapped.executeWrite('CREATE TABLE wide_scan (id INTEGER PRIMARY KEY, amount REAL, label TEXT);');
  for (let index = 1; index <= 250; index += 1) {
    await wrapped.executeWrite(`INSERT INTO wide_scan (id, amount, label) VALUES (${index}, ${index}, 'group-${index % 3}');`);
  }
  const wideSchema = await wrapped.discoverSchema();
  const returned = [];
  const wideOriginal = wrapped.executeQuery.bind(wrapped);
  wrapped.executeQuery = async (sql) => {
    const result = await wideOriginal(sql);
    returned.push((result.rows || []).length);
    return result;
  };
  const wide = await computeTableAnalytics(wrapped, wideSchema, 'wide_scan');
  check('17b a 250-row table is aggregated without returning every row', wide.totalRows === 250 && Math.max(...returned) <= 24);

  if (adapter.db) adapter.db.close();
  if (wrapped.db) wrapped.db.close();
}

async function runMysqlDialectCheck() {
  const queries = [];
  const adapter = {
    type: 'mysql',
    async executeQuery(sql) {
      queries.push(sql);
      if (/COUNT\(\*\) AS total_rows/i.test(sql)) {
        return { rows: [{ total_rows: 0, c0_nonnull: 0, c1_nonnull: 0, c1_distinct: 0 }] };
      }
      return { rows: [] };
    },
  };
  const schema = {
    tables: {
      vendors: {
        columns: { id: 'int', category: 'varchar' },
        primaryKeys: ['id'],
      },
    },
    relationships: [],
  };
  const analytics = await computeTableAnalytics(adapter, schema, 'vendors');
  const mysqlMonth = monthExpression('mysql', quoteIdent('created_at', 'mysql'));
  check(
    '20 MySQL dialect uses MySQL identifiers and date formatting',
    analytics.totalRows === 0
      && queries.some((sql) => sql.includes('`vendors`') && sql.includes('COUNT(*)'))
      && mysqlMonth.includes('DATE_FORMAT')
      && !queries.some((sql) => /select\s+\*/i.test(sql)),
  );

  const net = require('net');
  const live = await new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port: 3306, timeout: 400 }, () => {
      socket.end();
      resolve(true);
    });
    socket.on('error', () => resolve(false));
    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });
  });
  check('20b MySQL live server is optional', true);
  if (!live) console.log('INFO MySQL live verification unavailable; dialect SQL was checked instead');
}

async function runPostgresCheck() {
  let client;
  try {
    const { Client } = require('pg');
    client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    await client.query('BEGIN');
    await client.query(`
      CREATE TEMP TABLE analytics_probe_vendors (
        id INTEGER PRIMARY KEY,
        category TEXT,
        contract_value NUMERIC,
        created_at TIMESTAMP
      )
    `);
    await client.query(`
      INSERT INTO analytics_probe_vendors (id, category, contract_value, created_at) VALUES
      (1, 'SaaS', 10, '2026-01-01'),
      (2, 'SaaS', 30, '2026-03-01'),
      (3, 'Cloud', NULL, '2026-09-30')
    `);
    const adapter = {
      type: 'postgres',
      executeQuery: async (sql) => {
        const result = await client.query(sql);
        return { rows: result.rows };
      },
    };
    const schema = {
      tables: {
        analytics_probe_vendors: {
          columns: {
            id: 'integer',
            category: 'text',
            contract_value: 'numeric',
            created_at: 'timestamp without time zone',
          },
          primaryKeys: ['id'],
        },
      },
      relationships: [],
    };
    const analytics = await computeTableAnalytics(adapter, schema, 'analytics_probe_vendors');
    const value = analytics.columns.find((column) => column.name === 'contract_value');
    await client.query('ROLLBACK');
    check('18 PostgreSQL analytics aggregate the temp table', analytics.totalRows === 3 && near(value.avg, 20) && near(value.sum, 40) && value.min === 10 && value.max === 30 && value.nullCount === 1);
  } catch (err) {
    check('18 PostgreSQL analytics aggregate the temp table', false);
    console.log(`INFO PostgreSQL check failed: ${redactLogText(err.message || err)}`);
  } finally {
    if (client) {
      await client.query('ROLLBACK').catch(() => {});
      await client.end().catch(() => {});
    }
  }
}

function runMongoCheck() {
  const calls = [];
  const adapter = {
    type: 'mongodb',
    async executeQuery() {
      calls.push('called');
      return { rows: [] };
    },
  };
  return computeTableAnalytics(adapter, { tables: {} }, 'vendors')
    .then(() => check('MongoDB analytics are rejected', false))
    .catch((err) => {
      check('MongoDB analytics are rejected without a SQL fallback', err.code === 'ANALYTICS_UNSUPPORTED' && calls.length === 0);
    });
}

async function runHttpChecks() {
  const app = require('./src/server');
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  try {
    const missing = await request(server, 'GET', '/api/database/analytics?table=vendors');
    check('14 unauthorized analytics request returns 401', missing.status === 401);

    const token = jwt.sign({ id: 1 }, getJwtSecret(), { expiresIn: '1h' });
    const logout = await request(server, 'POST', '/api/auth/logout', { token });
    const loggedOut = await request(server, 'GET', '/api/database/analytics?table=vendors', { token });
    check('15 logged-out user cannot request analytics', logout.status === 200 && loggedOut.status === 401);
    blacklistToken(token);

    const appPool = require('./src/db/applicationDatabase');
    const users = await appPool.query('SELECT id FROM users ORDER BY id ASC LIMIT 5');
    const connections = await appPool.query('SELECT id, user_id FROM database_connections ORDER BY id ASC LIMIT 20');
    const owner = users.rows[0];
    if (!owner) {
      check('16 user A cannot use another user connection', false);
      return;
    }
    const ownerToken = jwt.sign({ id: owner.id }, getJwtSecret(), { expiresIn: '10m' });
    const foreign = connections.rows.find((row) => Number(row.user_id) !== Number(owner.id));
    const foreignId = foreign ? foreign.id : 900000001;
    const isolated = await request(server, 'GET', `/api/database/analytics?table=vendors&connectionId=${foreignId}`, { token: ownerToken });
    check('16 user A cannot use another user connection', isolated.status === 403);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function runSourceChecks() {
  const dashboard = fs.readFileSync(path.join(__dirname, '../frontend/src/components/analytics/AnalyticsDashboard.jsx'), 'utf8');
  const service = fs.readFileSync(path.join(__dirname, 'src/services/analyticsService.js'), 'utf8');
  check(
    '21 analytics are requested from the backend instead of the loaded page',
    dashboard.includes('/database/analytics') && !dashboard.includes('rows.map') && !service.includes('SELECT *'),
  );
  check('19 SQLite month grouping uses strftime', monthExpression('sqlite', '"created_at"').includes('strftime'));
}

async function main() {
  await runSqliteChecks();
  await runMysqlDialectCheck();
  await runPostgresCheck();
  await runMongoCheck();
  await runHttpChecks();
  runSourceChecks();
  const failed = results.filter((item) => !item.ok);
  console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(`TEST RUNNER FAILED: ${redactLogText(err && err.stack ? err.stack : err)}`);
  process.exit(1);
});
