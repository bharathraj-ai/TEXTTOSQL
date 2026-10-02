/**
 * Live MySQL verification.
 * Uses a disposable local server. Does not print passwords or connection URLs.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const { MysqlAdapter } = require('./src/adapters/mysqlAdapter');
const { getDatabaseSchema } = require('./src/services/schemaService');
const { generateSQL } = require('./src/services/llmService');
const { generateMutationPlan } = require('./src/services/mutationService');
const { computeTableAnalytics } = require('./src/services/analyticsService');
const { validateQuery } = require('./src/utils/sqlValidator');
const { testRawConnection, getUserAdapter } = require('./src/services/connectionManager');
const { redactLogText } = require('./src/utils/safeLog');

const TEST_PASSWORD = 'intella_test_pw';
const TEST_URL = process.env.MYSQL_TEST_URL || `mysql://root:${TEST_PASSWORD}@127.0.0.1:3307/intella_mysql_test`;

const results = [];

function check(name, ok) {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
}

function near(actual, expected) {
  return actual != null && Math.abs(Number(actual) - expected) < 0.02;
}

async function seed(adapter) {
  const statements = [
    'DROP TABLE IF EXISTS bulk_metrics',
    'DROP TABLE IF EXISTS students',
    'DROP TABLE IF EXISTS courses',
    'DROP TABLE IF EXISTS departments',
    'DROP TABLE IF EXISTS vendors',
    `CREATE TABLE departments (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(100) NOT NULL
    )`,
    `CREATE TABLE courses (
      id INT AUTO_INCREMENT PRIMARY KEY,
      title VARCHAR(100) NOT NULL,
      department_id INT NULL,
      CONSTRAINT fk_courses_dept FOREIGN KEY (department_id) REFERENCES departments(id)
    )`,
    `CREATE TABLE students (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      mark INT NULL,
      department VARCHAR(100) NULL,
      course_id INT NULL,
      CONSTRAINT fk_students_course FOREIGN KEY (course_id) REFERENCES courses(id)
    )`,
    `CREATE TABLE vendors (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      category VARCHAR(100) NULL,
      contract_value DECIMAL(14,2) NULL,
      contact_email VARCHAR(255) NULL,
      created_at DATETIME NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `INSERT INTO departments (name) VALUES ('CSE'), ('ECE')`,
    `INSERT INTO courses (title, department_id) VALUES ('Databases', 1), ('Networks', 2)`,
    `INSERT INTO students (name, mark, department, course_id) VALUES
      ('Asha', 91, 'CSE', 1),
      ('Rahul', 70, 'ECE', 2),
      ('Priya', 78, 'CSE', 1),
      ('Ravi', 85, 'AIDS', NULL)`,
    `INSERT INTO vendors (name, category, contract_value, contact_email, created_at) VALUES
      ('North', 'SaaS', 100000, 'a@example.com', '2026-01-15 10:00:00'),
      ('South', 'SaaS', 200000, 'b@example.com', '2026-02-01 10:00:00'),
      ('East', 'Cloud', 50000, NULL, '2026-03-01 10:00:00'),
      ('West', 'Cloud', NULL, '', '2026-06-01 10:00:00'),
      ('Central', NULL, 0, 'e@example.com', '2026-09-30 10:00:00'),
      ('Orbit', 'Hardware', 25000, 'f@example.com', '2024-11-01 10:00:00'),
      ('Pulse', 'Hardware', 75000, 'g@example.com', '2025-01-01 10:00:00'),
      ('Nimbus', 'Services', 40000, 'h@example.com', '2025-08-01 10:00:00')`,
    `CREATE TABLE bulk_metrics (
      id INT AUTO_INCREMENT PRIMARY KEY,
      amount DECIMAL(12,2) NOT NULL,
      label VARCHAR(40) NOT NULL,
      created_at DATETIME NOT NULL
    )`,
  ];
  for (const sql of statements) {
    await adapter.executeWrite(sql);
  }
  for (let index = 1; index <= 250; index += 1) {
    const month = String((index % 12) + 1).padStart(2, '0');
    await adapter.executeWrite(
      `INSERT INTO bulk_metrics (amount, label, created_at) VALUES (${index}, 'group-${index % 3}', '2025-${month}-01 00:00:00')`,
    );
  }
}

async function main() {
  const adapter = new MysqlAdapter(TEST_URL);
  const queries = [];
  const originalQuery = adapter.executeQuery.bind(adapter);
  adapter.executeQuery = async (sql) => {
    queries.push(String(sql));
    const result = await originalQuery(sql);
    result._returned = (result.rows || []).length;
    return result;
  };

  try {
    const connected = await adapter.testConnection();
    check('connection succeeds', connected.ok === true && connected.type === 'mysql' && connected.databaseName === 'intella_mysql_test');

    await seed(adapter);
    queries.length = 0;

    const schema = await getDatabaseSchema(true, adapter, 'mysql-live-test');
    const vendor = schema.tables.vendors;
    const student = schema.tables.students;
    const course = schema.tables.courses;
    const discoveredTables = ['vendors', 'students', 'courses', 'departments', 'bulk_metrics']
      .every((name) => schema.tables[name]);
    const vendorTypes = vendor
      && /int/i.test(vendor.columns.id)
      && /decimal/i.test(vendor.columns.contract_value)
      && /datetime/i.test(vendor.columns.created_at)
      && /varchar/i.test(vendor.columns.category);
    const keys = (vendor?.primaryKeys || []).includes('id')
      && vendor.identity?.id === true
      && vendor.nullable?.category === true
      && vendor.nullable?.name === false
      && vendor.defaults?.created_at != null;
    const foreignKey = (schema.relationships || []).some((item) => item.from === 'courses.department_id' && item.to === 'departments.id')
      && (schema.relationships || []).some((item) => item.from === 'students.course_id' && item.to === 'courses.id');
    check('schema discovery finds tables, types, keys, nullability, defaults, and foreign keys', discoveredTables && vendorTypes && keys && foreignKey && student && course);

    const selectSql = generateSQL('Show students with marks above 80', schema, [], 'mysql');
    const selectResult = await originalQuery(selectSql);
    const selectedNames = (selectResult.rows || []).map((row) => row.name).sort();
    check('SELECT students above 80 executes', /select/i.test(selectSql) && /`students`/i.test(selectSql) && /`mark`\s*>\s*80/i.test(selectSql) && selectedNames.join(',') === 'Asha,Ravi');

    const insertPlan = generateMutationPlan('insert the row of MSI, MSI Office, 1 cr, bharathraj@gmail.com from vendors', schema, 'mysql');
    const insertSql = insertPlan.sql;
    const insertOk = /INSERT INTO vendors/i.test(insertSql)
      && /'MSI'/.test(insertSql)
      && /'MSI Office'/.test(insertSql)
      && /10000000/.test(insertSql)
      && /bharathraj@gmail.com/.test(insertSql)
      && !/\bid\b/i.test(insertSql.split('VALUES')[0]);
    await adapter.executeWrite(insertSql);
    const inserted = await originalQuery("SELECT name, category, contract_value, contact_email FROM vendors WHERE contact_email = 'bharathraj@gmail.com'");
    const insertedRow = inserted.rows[0];
    check('INSERT MSI row is stored with crore conversion and without an explicit id', insertOk && insertedRow && insertedRow.name === 'MSI' && insertedRow.category === 'MSI Office' && Number(insertedRow.contract_value) === 10000000 && insertedRow.contact_email === 'bharathraj@gmail.com');

    const updatePlan = generateMutationPlan("Update Rahul's mark to 90 from students", schema, 'mysql');
    const updateSql = updatePlan.sql;
    const unsafeUpdate = validateQuery('UPDATE students SET mark = 90;', schema, 'mysql', 'write');
    await adapter.executeWrite(updateSql);
    const updated = await originalQuery("SELECT mark FROM students WHERE name = 'Rahul'");
    check('UPDATE Rahul executes and UPDATE without WHERE is rejected', /UPDATE students/i.test(updateSql) && /SET mark = 90/i.test(updateSql) && /WHERE name = 'Rahul'/i.test(updateSql) && Number(updated.rows[0]?.mark) === 90 && unsafeUpdate.valid === false);

    const deletePlan = generateMutationPlan('Delete Rahul from students', schema, 'mysql');
    const deleteSql = deletePlan.sql;
    const bareDelete = validateQuery('DELETE FROM students;', schema, 'mysql', 'write');
    const massAllowed = validateQuery('DELETE FROM students;', schema, 'mysql', 'write', { allowMass: true });
    await adapter.executeWrite(deleteSql);
    const remainingRahul = await originalQuery("SELECT name FROM students WHERE name = 'Rahul'");
    check('DELETE Rahul executes and a bare DELETE is rejected unless mass confirmation allows it', /DELETE FROM students/i.test(deleteSql) && /WHERE name = 'Rahul'/i.test(deleteSql) && remainingRahul.rows.length === 0 && bareDelete.valid === false && massAllowed.valid === true);

    queries.length = 0;
    const analytics = await computeTableAnalytics(adapter, schema, 'vendors');
    const value = analytics.columns.find((column) => column.name === 'contract_value');
    const category = analytics.columns.find((column) => column.name === 'category');
    const email = analytics.columns.find((column) => column.name === 'contact_email');
    const created = analytics.columns.find((column) => column.name === 'created_at');
    const numbers = [100000, 200000, 50000, 0, 25000, 75000, 40000, 10000000];
    const sum = numbers.reduce((total, item) => total + item, 0);
    const usesMysqlSql = queries.some((sql) => sql.includes('`vendors`') && sql.includes('COUNT(*)'))
      && queries.some((sql) => sql.includes('DATE_FORMAT') && sql.includes('LIMIT 24'))
      && queries.some((sql) => /GROUP BY `category`/i.test(sql) && /LIMIT 10/i.test(sql))
      && !queries.some((sql) => /date_trunc|to_char|strftime/i.test(sql));
    check('analytics COUNT AVG SUM MIN MAX run on MySQL', analytics.totalRows === 9 && value.count === 8 && near(value.sum, sum) && near(value.avg, sum / 8) && value.min === 0 && Number(value.max) === 10000000 && usesMysqlSql);
    check('NULL is distinct from an empty string', email.nullCount === 1 && email.count === 8);
    check('category distribution is limited and counted in MySQL', category.distinctCount === 5 && category.distribution.some((item) => item.value === 'SaaS' && item.count === 2) && category.distribution.length <= 10);
    check('date earliest, latest, and monthly buckets use MySQL types', String(created.earliest).includes('2024-11-01') && String(created.latest).includes('2026-09-30') && analytics.charts.timeline && analytics.charts.timeline.points.length > 0 && analytics.charts.timeline.points.length <= 24 && analytics.charts.timeline.points.every((point) => /^\d{4}-\d{2}$/.test(point.label)));

    const textColumn = schema.tables.vendors.columns.name;
    check('a text column is not treated as a date', !/date|time/i.test(String(textColumn)) && analytics.columns.find((column) => column.name === 'name').type === 'categorical');

    queries.length = 0;
    const bulk = await computeTableAnalytics(adapter, schema, 'bulk_metrics');
    const returnedRows = queries.map((sql) => sql);
    check('250-row analytics does not download the table', bulk.totalRows === 250 && !returnedRows.some((sql) => /select\s+\*/i.test(sql)) && queries.filter((sql) => /LIMIT\s+(\d+)/i.test(sql)).every((sql) => Number(sql.match(/LIMIT\s+(\d+)/i)[1]) <= 24));

    const payload = JSON.stringify(analytics);
    check('analytics payload contains no connection URL or password', !payload.includes(TEST_PASSWORD) && !payload.includes('mysql://'));

    let isolated = false;
    try {
      await getUserAdapter(null);
    } catch (err) {
      isolated = err.statusCode === 401;
    }
    check('missing user does not fall back to another database', isolated);

    let unknownTable = false;
    try {
      await computeTableAnalytics(adapter, schema, 'not_a_table');
    } catch (err) {
      unknownTable = /not in the connected database/i.test(err.message);
    }
    let arbitrarySql = false;
    try {
      await computeTableAnalytics(adapter, schema, 'SELECT * FROM vendors');
    } catch (err) {
      arbitrarySql = err.statusCode === 400;
    }
    check('unknown table and arbitrary SQL are rejected', unknownTable && arbitrarySql);

    const logs = [];
    const originalError = console.error;
    console.error = (...args) => logs.push(args.join(' '));
    let badLoginSafe = false;
    try {
      await testRawConnection(TEST_URL.replace(TEST_PASSWORD, 'wrong-password'));
    } catch (err) {
      const text = String(err.message || '');
      badLoginSafe = /connection failed/i.test(text) && !text.includes('wrong-password') && !text.includes('mysql://');
    }
    let unreachableSafe = false;
    try {
      await testRawConnection('mysql://root:wrong-password@127.0.0.1:3999/missing_db');
    } catch (err) {
      const text = String(err.message || '');
      unreachableSafe = /connection failed/i.test(text) && !text.includes('wrong-password') && !text.includes('mysql://');
    }
    console.error = originalError;
    check('invalid credentials and unreachable server stay free of secrets', badLoginSafe && unreachableSafe && !logs.join('\n').includes('wrong-password'));

    let invalidColumnSafe = false;
    try {
      await originalQuery('SELECT missing_column FROM students');
    } catch (err) {
      const text = String(err.message || '');
      invalidColumnSafe = /missing_column|unknown column/i.test(text) && !text.includes(TEST_PASSWORD) && !text.includes('mysql://');
    }
    let malformedSafe = false;
    try {
      await originalQuery('SELEC FROM students');
    } catch (err) {
      const text = String(err.message || '');
      malformedSafe = /sql|syntax/i.test(text) && !text.includes(TEST_PASSWORD) && !text.includes('mysql://');
    }
    check('invalid column and malformed SQL errors omit credentials', invalidColumnSafe && malformedSafe);

    const slowStarted = Date.now();
    let timedOut = false;
    try {
      const slow = await originalQuery('SELECT BENCHMARK(500000000, SHA1(RAND())) AS n');
      const elapsed = Date.now() - slowStarted;
      const stoppedEarly = Number(slow.rows?.[0]?.n) === 0 && elapsed < 7000 && elapsed > 3000;
      timedOut = stoppedEarly;
    } catch (err) {
      const text = redactLogText(err.message || '');
      const elapsed = Date.now() - slowStarted;
      timedOut = elapsed < 7000 && !text.includes(TEST_PASSWORD) && !text.includes('mysql://');
    }
    check('a long SELECT is stopped by the MySQL execution limit', timedOut);

    await adapter.close();
    check('connection cleanup closes the pool', adapter.pool == null);
  } finally {
    if (adapter.pool) await adapter.close().catch(() => {});
  }

  const failed = results.filter((item) => !item.ok);
  console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(`TEST RUNNER FAILED: ${redactLogText(err && err.stack ? err.stack : err)}`);
  process.exit(1);
});
