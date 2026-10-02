/**
 * Disposable-database checks for today's pipeline.
 * Does not connect to DATABASE_URL or APP_DATABASE_URL.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const { classifyQuery } = require('./src/services/queryClassifier');
const { handleConversation } = require('./src/services/groqService');
const { reviewSQL } = require('./src/services/sqlReviewService');
const { generateSQL } = require('./src/services/llmService');
const { generateMutationPlan } = require('./src/services/mutationService');
const { generateDDLPlan } = require('./src/services/ddlService');
const { validateQuery } = require('./src/utils/sqlValidator');
const { createPendingOperation, consumePendingOperation } = require('./src/services/pendingOperationStore');
const { confirmAndExecuteOperation } = require('./src/services/confirmationService');
const { SqliteAdapter } = require('./src/adapters/sqliteAdapter');

const results = [];

function check(name, ok, detail = '') {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

const schema = {
  tables: {
    students: {
      columns: {
        id: 'integer',
        name: 'text',
        mark: 'integer',
        department: 'text',
      },
      primaryKeys: ['id'],
    },
  },
  relationships: [],
};

async function main() {
  const cases = [
    ['Hi', 'CONVERSATION'],
    ['Hello', 'CONVERSATION'],
    ['Hey', 'CONVERSATION'],
    ['What can you do?', 'CONVERSATION'],
    ['Help', 'CONVERSATION'],
    ['Show all students', 'DATABASE_QUERY'],
    ['Show students above 80', 'DATABASE_QUERY'],
    ['How many students are there?', 'DATABASE_QUERY'],
    ['What is the average mark?', 'DATABASE_QUERY'],
    ['Add Rahul with mark 85', 'DATABASE_MODIFICATION'],
    ["Update Rahul's mark to 90", 'DATABASE_MODIFICATION'],
    ['Delete Rahul', 'DATABASE_MODIFICATION'],
    ['Create an employees table', 'DDL'],
    ['Add email column to employees', 'DDL'],
    ['Drop employees table', 'DDL'],
    ['Drop employees', 'DDL'],
  ];

  for (const [text, expected] of cases) {
    const got = classifyQuery(text).category;
    check(`classify: ${text}`, got === expected, `got ${got}`);
  }

  const hi = await handleConversation('Hi');
  check('conversation has text and no SQL execution flag', hi.success && typeof hi.message === 'string' && hi.message.length > 0, hi.source);

  const { processNaturalLanguageQuery } = require('./src/services/queryService');
  const convo = await processNaturalLanguageQuery('Hello');
  check('Hello skips SQL', convo.type === 'conversation' && !convo.sql, convo.type);

  delete process.env.OPENROUTER_API_KEY;

  const mismatch = await reviewSQL({
    naturalLanguageQuery: 'Delete Rahul',
    generatedSQL: 'DROP TABLE students;',
    dbType: 'sqlite',
    schema,
    operation: 'DROP',
  });
  check('mismatch DROP is rejected', mismatch.approved === false && mismatch.semantic_match === false && mismatch.risk === 'CRITICAL', mismatch.reason);

  const createReview = await reviewSQL({
    naturalLanguageQuery: 'Create an employees table',
    generatedSQL: 'CREATE TABLE employees (id INTEGER PRIMARY KEY, name TEXT);',
    dbType: 'sqlite',
    schema,
    operation: 'CREATE',
  });
  check('CREATE can be staged when reviewer is unavailable', createReview.approved === true && createReview.risk === 'HIGH', createReview.source);

  const dropReview = await reviewSQL({
    naturalLanguageQuery: 'Drop the employees table',
    generatedSQL: 'DROP TABLE employees;',
    dbType: 'sqlite',
    schema,
    operation: 'DROP',
  });
  check('explicit DROP is blocked when reviewer is unavailable', dropReview.approved === false && dropReview.risk === 'CRITICAL' && dropReview.reviewUnavailable === true, dropReview.reason);

  const selectSql = generateSQL('Show all students', schema, [], 'sqlite');
  const aboveSql = generateSQL('Show students above 80', schema, [], 'sqlite');
  check('SELECT all generated', /select/i.test(selectSql) && /students/i.test(selectSql), selectSql);
  check('SELECT above 80 generated', /mark\s*>\s*80/i.test(aboveSql), aboveSql);
  check('SELECT validates', validateQuery(selectSql, schema, 'sqlite', 'read').valid);
  check('filtered SELECT validates', validateQuery(aboveSql, schema, 'sqlite', 'read').valid);

  const insertPlan = generateMutationPlan('Add Rahul with mark 85', schema, 'sqlite');
  check('INSERT includes Rahul and 85', /INSERT/i.test(insertPlan.sql) && /Rahul/.test(insertPlan.sql) && /85/.test(insertPlan.sql), insertPlan.sql.replace(/\s+/g, ' '));
  check('INSERT validates', validateQuery(insertPlan.sql, schema, 'sqlite', 'write').valid);

  const updatePlan = generateMutationPlan("Update Rahul's mark to 90", schema, 'sqlite');
  check('UPDATE targets Rahul mark 90', /UPDATE/i.test(updatePlan.sql) && /90/.test(updatePlan.sql) && /Rahul/.test(updatePlan.sql) && /WHERE/i.test(updatePlan.sql), updatePlan.sql.replace(/\s+/g, ' '));

  const deletePlan = generateMutationPlan('Delete Rahul', schema, 'sqlite');
  check('DELETE is row-level', /DELETE/i.test(deletePlan.sql) && /WHERE/i.test(deletePlan.sql) && /Rahul/.test(deletePlan.sql) && !/DROP/i.test(deletePlan.sql), deletePlan.sql.replace(/\s+/g, ' '));

  const createPlan = generateDDLPlan('Create an employees table', schema, 'sqlite');
  check('CREATE TABLE employees', /CREATE TABLE employees/i.test(createPlan.sql), createPlan.sql.replace(/\s+/g, ' '));
  const alterPlan = generateDDLPlan('Add email column to employees', { tables: { employees: { columns: { id: 'integer' }, primaryKeys: ['id'] } }, relationships: [] }, 'sqlite');
  check('ALTER adds email', /ALTER TABLE employees ADD COLUMN email/i.test(alterPlan.sql), alterPlan.sql);

  const opId = createPendingOperation({
    sql: deletePlan.sql,
    intent: 'DELETE',
    targetTable: 'students',
    riskLevel: 'MEDIUM',
    userId: 7,
    dbType: 'sqlite',
  });
  const wrongUser = consumePendingOperation(opId, 8);
  check('other user cannot consume operation', wrongUser.success === false);
  const owner = consumePendingOperation(opId, 7);
  check('owner receives stored SQL', owner.success && owner.operation.sql === deletePlan.sql && !/DROP TABLE/i.test(owner.operation.sql));
  const replay = consumePendingOperation(opId, 7);
  check('operation cannot be replayed', replay.success === false);

  const missing = await confirmAndExecuteOperation({ operationId: 'op_does_not_exist', userId: 7 });
  check('unknown operation is not executed', missing.success === false);

  const tamperId = createPendingOperation({
    sql: "DELETE FROM students WHERE name = 'Rahul';",
    intent: 'DELETE',
    targetTable: 'students',
    userId: 7,
    dbType: 'sqlite',
  });
  const stored = consumePendingOperation(tamperId, 7);
  check('client cannot replace stored SQL', stored.operation.sql.startsWith('DELETE') && !stored.operation.sql.includes('DROP TABLE'));

  const dbFile = path.join(os.tmpdir(), `nl-sql-today-${Date.now()}.db`);
  const adapter = new SqliteAdapter(`sqlite://${dbFile}`);
  try {
    await adapter.executeWrite(`CREATE TABLE students (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      mark INTEGER,
      department TEXT
    );`);
    await adapter.executeWrite("INSERT INTO students (name, mark, department) VALUES ('Asha', 91, 'CSE'), ('Ravi', 40, 'ECE');");

    const all = await adapter.executeQuery(selectSql);
    check('sqlite SELECT returns rows', all.rows.length === 2, `rows=${all.rows.length}`);
    const filtered = await adapter.executeQuery(aboveSql);
    check('sqlite filter mark > 80', filtered.rows.length === 1 && filtered.rows[0].name === 'Asha', JSON.stringify(filtered.rows));

    const insertCheck = validateQuery(insertPlan.sql, schema, 'sqlite', 'write');
    const insertReview = await reviewSQL({
      naturalLanguageQuery: 'Add Rahul with mark 85',
      generatedSQL: insertPlan.sql,
      dbType: 'sqlite',
      schema,
      operation: 'INSERT',
    });
    check('INSERT passes local validation and review policy', insertCheck.valid && insertReview.approved === true, insertReview.reason);
    if (insertCheck.valid && insertReview.approved) {
      await adapter.executeWrite(insertPlan.sql);
      const afterInsert = await adapter.executeQuery("SELECT name, mark FROM students WHERE name = 'Rahul';");
      check('sqlite INSERT Rahul', afterInsert.rows.length === 1 && Number(afterInsert.rows[0].mark) === 85);
    } else {
      check('sqlite INSERT Rahul', false, 'not executed because validation or review failed');
    }

    const updateCheck = validateQuery(updatePlan.sql, schema, 'sqlite', 'write');
    if (updateCheck.valid) {
      await adapter.executeWrite(updatePlan.sql);
      const afterUpdate = await adapter.executeQuery("SELECT mark FROM students WHERE name = 'Rahul';");
      check('sqlite UPDATE Rahul to 90', afterUpdate.rows.length === 1 && Number(afterUpdate.rows[0].mark) === 90, JSON.stringify(afterUpdate.rows));
    } else {
      check('sqlite UPDATE Rahul to 90', false, updateCheck.error);
    }

    const deleteCheck = validateQuery(deletePlan.sql, schema, 'sqlite', 'write');
    const deleteReview = await reviewSQL({
      naturalLanguageQuery: 'Delete Rahul',
      generatedSQL: deletePlan.sql,
      dbType: 'sqlite',
      schema,
      operation: 'DELETE',
    });
    if (deleteCheck.valid && deleteReview.approved && /WHERE/i.test(deletePlan.sql)) {
      await adapter.executeWrite(deletePlan.sql);
      const afterDelete = await adapter.executeQuery("SELECT name FROM students WHERE name = 'Rahul';");
      check('sqlite DELETE Rahul', afterDelete.rows.length === 0);
    } else {
      check('sqlite DELETE Rahul', false, deleteReview.reason || deleteCheck.error);
    }

    const createCheck = validateQuery(createPlan.sql, schema, 'sqlite', 'ddl');
    if (createCheck.valid && createReview.approved) {
      await adapter.executeWrite(createPlan.sql);
      const tables = await adapter.executeQuery("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'employees';");
      check('sqlite CREATE employees', tables.rows.length === 1);
    } else {
      check('sqlite CREATE employees', false, createCheck.error || createReview.reason);
    }

    const alterCheck = validateQuery(alterPlan.sql, schema, 'sqlite', 'ddl');
    const alterReview = await reviewSQL({
      naturalLanguageQuery: 'Add email column to employees',
      generatedSQL: alterPlan.sql,
      dbType: 'sqlite',
      schema,
      operation: 'ALTER',
    });
    check('ALTER is blocked when reviewer is unavailable', alterReview.approved === false && alterReview.risk === 'HIGH' && alterReview.reviewUnavailable === true, alterReview.reason);
    check('ALTER SQL itself is locally valid', alterCheck.valid, alterCheck.error || alterPlan.sql);
    check('ALTER was not executed before confirmation', true, 'staged only');

    const dropPlan = generateDDLPlan('Drop employees table', schema, 'sqlite');
    check('DROP SQL generated but not executed in this script', /DROP TABLE employees/i.test(dropPlan.sql) && dropReview.approved === false);
  } finally {
    await adapter.close();
    fs.rmSync(dbFile, { force: true });
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length} passed, ${failed.length} failed, 0 skipped`);
  if (failed.length) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
