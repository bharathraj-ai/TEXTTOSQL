// ============================================
// Multi-Database Test Suite
// ============================================
// Tests:
//   1. Protocol auto-detection (Postgres, MySQL, SQLite, MongoDB)
//   2. SQLite adapter in-memory (connect, schema, query)
//   3. MongoDB MQL query generation (find, aggregate, count)
//   4. MongoDB query validation (read-only enforcement, blocking mutations)
//   5. Live PostgreSQL database queries (backward compatibility)
//   6. QueryService routing with dbType returned

require('dotenv').config();
const { detectDatabaseType, createAdapter } = require('./src/adapters/databaseAdapter');
const { generateSQL } = require('./src/services/llmService');
const { validateQuery } = require('./src/utils/sqlValidator');
const { SqliteAdapter } = require('./src/adapters/sqliteAdapter');
const http = require('http');

let passed = 0;
let failed = 0;

function assert(title, condition, extra = '') {
  if (condition) {
    console.log(`  ✅ PASS: ${title} ${extra ? `(${extra})` : ''}`);
    passed++;
  } else {
    console.log(`  ❌ FAIL: ${title} ${extra ? `(${extra})` : ''}`);
    failed++;
  }
}

async function runTests() {
  console.log('═'.repeat(60));
  console.log('  MULTI-DATABASE SUPPORT TEST SUITE');
  console.log('═'.repeat(60));

  // ── 1. Protocol Detection ───────────────────────────
  console.log('\n--- 1. Protocol Auto-Detection ---');
  assert(
    'Detect PostgreSQL (postgresql://)',
    detectDatabaseType('postgresql://user:pass@localhost:5432/test') === 'postgres'
  );
  assert(
    'Detect PostgreSQL (postgres://)',
    detectDatabaseType('postgres://user:pass@localhost:5432/test') === 'postgres'
  );
  assert(
    'Detect MySQL (mysql://)',
    detectDatabaseType('mysql://root:secret@localhost:3306/mydb') === 'mysql'
  );
  assert(
    'Detect SQLite (sqlite://)',
    detectDatabaseType('sqlite:///var/data/app.db') === 'sqlite'
  );
  assert(
    'Detect SQLite (file path .sqlite)',
    detectDatabaseType('/home/user/data.sqlite') === 'sqlite'
  );
  assert(
    'Detect MongoDB (mongodb://)',
    detectDatabaseType('mongodb://localhost:27017/mytestdb') === 'mongodb'
  );
  assert(
    'Detect MongoDB (mongodb+srv://)',
    detectDatabaseType('mongodb+srv://user:pass@cluster0.mongodb.net/production') === 'mongodb'
  );

  // ── 2. SQLite Adapter (In-Memory) ───────────────────
  console.log('\n--- 2. SQLite In-Memory Database ---');
  const sqlite = new SqliteAdapter('sqlite::memory:');
  try {
    const db = sqlite.getDb();
    await new Promise((resolve, reject) => {
      db.run(
        'CREATE TABLE employees (id INTEGER PRIMARY KEY, name TEXT, department TEXT, salary NUMERIC);',
        (err) => (err ? reject(err) : resolve())
      );
    });
    await new Promise((resolve, reject) => {
      db.run(
        "INSERT INTO employees (name, department, salary) VALUES ('Alice', 'Engineering', 95000), ('Bob', 'Design', 80000);",
        (err) => (err ? reject(err) : resolve())
      );
    });

    const testRes = await sqlite.testConnection();
    assert('SQLite testConnection()', testRes.ok === true && testRes.tables.includes('employees'));

    const schema = await sqlite.discoverSchema();
    assert(
      'SQLite discoverSchema()',
      schema.tables.employees &&
        schema.tables.employees.columns.name &&
        schema.tables.employees.columns.salary
    );

    const queryRes = await sqlite.executeQuery('SELECT * FROM employees WHERE salary > 85000;');
    assert(
      'SQLite executeQuery()',
      queryRes.rows.length === 1 && queryRes.rows[0].name === 'Alice',
      `Found ${queryRes.rows.length} rows`
    );
  } finally {
    await sqlite.close();
  }

  // ── 3. MongoDB MQL Generation ───────────────────────
  console.log('\n--- 3. MongoDB MQL Generation (SLM) ---');
  const mongoSchema = {
    tables: {
      students: {
        columns: {
          _id: 'string',
          name: 'character varying',
          department: 'character varying',
          mark: 'numeric',
          age: 'integer',
        },
        primaryKeys: ['_id'],
      },
    },
    relationships: [],
  };

  // Find all
  const qAll = 'Show all students';
  const mqlAll = generateSQL(qAll, mongoSchema, [], 'mongodb');
  assert('MongoDB MQL: find all', mqlAll.includes('db.students.find({})'), mqlAll);

  // Filter
  const qFilter = 'Show students with marks above 80';
  const mqlFilter = generateSQL(qFilter, mongoSchema, ['FILTER'], 'mongodb');
  assert(
    'MongoDB MQL: filter $gt',
    mqlFilter.includes('db.students.find') && mqlFilter.includes('$gt') && mqlFilter.includes('80'),
    mqlFilter
  );

  // Count
  const qCount = 'How many students are there';
  const mqlCount = generateSQL(qCount, mongoSchema, ['COUNT'], 'mongodb');
  assert(
    'MongoDB MQL: countDocuments',
    mqlCount.includes('countDocuments'),
    mqlCount
  );

  // Group by average
  const qAvgGroup = 'Show average mark for each department';
  const mqlAvg = generateSQL(qAvgGroup, mongoSchema, ['AVERAGE', 'GROUP_BY'], 'mongodb');
  assert(
    'MongoDB MQL: aggregate $avg with $group',
    mqlAvg.includes('aggregate') && mqlAvg.includes('$avg') && mqlAvg.includes('$department'),
    mqlAvg
  );

  // ── 4. MongoDB Query Guardrails ─────────────────────
  console.log('\n--- 4. MongoDB Read-Only Guardrails ---');
  assert(
    'Valid read-only find passes',
    validateQuery('db.students.find({ mark: { $gt: 80 } })', mongoSchema, 'mongodb').valid === true
  );
  assert(
    'Valid read-only aggregate passes',
    validateQuery('db.students.aggregate([ { $group: { _id: "$department" } } ])', mongoSchema, 'mongodb').valid === true
  );
  assert(
    'Forbidden deleteMany is blocked',
    validateQuery('db.students.deleteMany({})', mongoSchema, 'mongodb').valid === false
  );
  assert(
    'Forbidden drop is blocked',
    validateQuery('db.students.drop()', mongoSchema, 'mongodb').valid === false
  );
  assert(
    'Forbidden insertOne is blocked',
    validateQuery('db.students.insertOne({ name: "Hacker" })', mongoSchema, 'mongodb').valid === false
  );
  assert(
    'Forbidden $out aggregation stage is blocked',
    validateQuery('db.students.aggregate([ { $out: "backup" } ])', mongoSchema, 'mongodb').valid === false
  );

  // ── 5. Live PostgreSQL Backend Endpoint ─────────────
  console.log('\n--- 5. Live PostgreSQL Backend Routing ---');
  await new Promise((resolve) => {
    const req = http.request(
      'http://localhost:5000/api/query',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => {
          try {
            const data = JSON.parse(raw);
            assert(
              'Live query returns dbType = postgres',
              data.success === true && data.dbType === 'postgres',
              `dbType: ${data.dbType}`
            );
          } catch (e) {
            assert('Live query', false, e.message);
          }
          resolve();
        });
      }
    );
    req.write(JSON.stringify({ question: 'Show all students' }));
    req.end();
  });

  console.log('\n' + '═'.repeat(60));
  console.log(`  RESULTS: ${passed} PASSED, ${failed} FAILED (TOTAL: ${passed + failed})`);
  console.log('═'.repeat(60));

  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
