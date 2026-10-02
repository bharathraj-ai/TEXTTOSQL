/**
 * Proves workspace edits and @vendor confirmation change a real SQLite file.
 * Does not use the application database or a mock result set.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const holder = { adapter: null };
const connectionManager = require('./src/services/connectionManager');
const originalGetUserAdapter = connectionManager.getUserAdapter;
connectionManager.getUserAdapter = async function patchedGetUserAdapter(userId) {
  if (holder.adapter && Number(userId) === 9001) return holder.adapter;
  return originalGetUserAdapter(userId);
};

const { SqliteAdapter } = require('./src/adapters/sqliteAdapter');
const { browseTable, applyDirectChange } = require('./src/services/tableWorkspaceService');
const { stageNaturalLanguageOperation } = require('./src/services/operationPipeline');
const { confirmAndExecuteOperation } = require('./src/services/confirmationService');
const { reviewSQL } = require('./src/services/sqlReviewService');

const USER_ID = 9001;
const results = [];

function check(name, ok, detail = '') {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

async function marks(adapter) {
  const result = await adapter.executeQuery('SELECT id, name, mark, department FROM students ORDER BY id;');
  return result.rows;
}

async function confirm(staged) {
  if (!staged.operationId) throw new Error(staged.error || 'No operation was staged.');
  return confirmAndExecuteOperation({
    operationId: staged.operationId,
    userId: USER_ID,
    confirmationText: staged.confirmPhrase || '',
  });
}

async function main() {
  const dbFile = path.join(os.tmpdir(), `nl-sql-workspace-${Date.now()}.db`);
  const adapter = new SqliteAdapter(`sqlite://${dbFile}`);
  holder.adapter = adapter;

  try {
    await adapter.executeWrite(`CREATE TABLE students (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      mark INTEGER,
      department TEXT
    );`);
    await adapter.executeWrite(`INSERT INTO students (name, mark, department) VALUES
      ('Arun', 85, 'CSE'),
      ('Ravi', 91, 'AIDS'),
      ('Priya', 78, 'CSE'),
      ('Ravi', 70, 'ECE');`);

    let schema = await adapter.discoverSchema();
    const page = await browseTable(adapter, schema, { table: 'students', page: 1, limit: 50 });
    check('live table page contains both Ravi rows', page.total === 4 && page.rows.filter((row) => row.name === 'Ravi').length === 2, `total=${page.total}`);

    const ambiguous = await stageNaturalLanguageOperation("@vendor change Ravi's mark to 95", USER_ID, { currentTable: 'students' });
    const beforeAmbiguous = await marks(adapter);
    check('multiple Ravi rows are not updated', ambiguous.type === 'needs_disambiguation' && !ambiguous.operationId, ambiguous.error || ambiguous.type);
    check('marks unchanged after ambiguous request', beforeAmbiguous.filter((row) => row.name === 'Ravi').map((row) => row.mark).join(',') === '91,70', JSON.stringify(beforeAmbiguous));

    const duplicate = page.rows.find((row) => row.name === 'Ravi' && Number(row.mark) === 70);
    await applyDirectChange(adapter, schema, {
      action: 'delete',
      table: 'students',
      primaryKey: { id: duplicate.id },
    });

    const ravi = (await browseTable(adapter, schema, { table: 'students', page: 1, limit: 50 })).rows.find((row) => row.name === 'Ravi');
    await applyDirectChange(adapter, schema, {
      action: 'update',
      table: 'students',
      primaryKey: { id: ravi.id },
      changes: { mark: 95 },
    });
    const afterDirect = await marks(adapter);
    check('direct edit writes 95 into the sqlite file', afterDirect.some((row) => row.name === 'Ravi' && Number(row.mark) === 95), JSON.stringify(afterDirect));

    const IntellaUpdate = await stageNaturalLanguageOperation("@Intella change Ravi's mark to 88", USER_ID, { currentTable: 'students' });
    check('Intella update is staged, not executed yet', IntellaUpdate.type === 'confirmation_required' && /UPDATE/i.test(IntellaUpdate.sql), IntellaUpdate.sql || IntellaUpdate.error);
    const still95 = await marks(adapter);
    check('database still has 95 before confirmation', still95.some((row) => row.name === 'Ravi' && Number(row.mark) === 95));
    const updateResult = await confirm(IntellaUpdate);
    const afterIntella = await marks(adapter);
    check('confirmed Intella update writes 88', updateResult.success && afterIntella.some((row) => row.name === 'Ravi' && Number(row.mark) === 88), updateResult.error || JSON.stringify(afterIntella));

    const insertStaged = await stageNaturalLanguageOperation('@Intella add Karthik from CSE with mark 88', USER_ID, { currentTable: 'students' });
    const insertResult = await confirm(insertStaged);
    const afterInsert = await marks(adapter);
    check('confirmed Intella insert adds Karthik', insertResult.success && afterInsert.some((row) => row.name === 'Karthik' && row.department === 'CSE' && Number(row.mark) === 88), insertStaged.sql || insertResult.error);

    const deleteStaged = await stageNaturalLanguageOperation('@Intella delete Karthik', USER_ID, { currentTable: 'students' });
    const deleteResult = await confirm(deleteStaged);
    const afterDelete = await marks(adapter);
    check('confirmed Intella delete removes Karthik', deleteResult.success && !afterDelete.some((row) => row.name === 'Karthik'), deleteStaged.sql || deleteResult.error);

    const mismatch = await reviewSQL({
      naturalLanguageQuery: '@Intella delete Rahul',
      generatedSQL: 'DROP TABLE students;',
      dbType: 'sqlite',
      schema,
      operation: 'DROP',
    });
    const stillThere = await adapter.executeQuery("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'students';");
    check('delete request with DROP SQL is blocked', mismatch.approved === false && mismatch.semantic_match === false, mismatch.reason);
    check('blocked DROP did not remove students', stillThere.rows.length === 1);

    schema = await adapter.discoverSchema();
    const alterStaged = await stageNaturalLanguageOperation('@Intella add an email column to students', USER_ID, { currentTable: 'students' });
    check('Intella DDL is staged', alterStaged.type === 'confirmation_required' && /ALTER TABLE students/i.test(alterStaged.sql), alterStaged.sql || alterStaged.error);
    const alterResult = await confirm(alterStaged);
    const afterAlter = await adapter.discoverSchema();
    check('confirmed ALTER adds email on the sqlite file', alterResult.success && Object.prototype.hasOwnProperty.call(afterAlter.tables.students.columns, 'email'), alterResult.error || JSON.stringify(afterAlter.tables.students.columns));

    const dropStaged = await stageNaturalLanguageOperation('@Intella drop students', USER_ID, { currentTable: 'students' });
    const refused = await confirmAndExecuteOperation({
      operationId: dropStaged.operationId,
      userId: USER_ID,
      confirmationText: 'delete',
    });
    const tableStill = await adapter.executeQuery("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'students';");
    check('DROP without the typed phrase is refused', refused.success === false && tableStill.rows.length === 1, refused.error);
    const dropped = await confirmAndExecuteOperation({
      operationId: dropStaged.operationId,
      userId: USER_ID,
      confirmationText: dropStaged.confirmPhrase,
    });
    const tableGone = await adapter.executeQuery("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'students';");
    check('typed DROP phrase removes the disposable table', dropped.success && tableGone.rows.length === 0, dropped.error || dropStaged.confirmPhrase);
  } finally {
    await adapter.close();
    fs.rmSync(dbFile, { force: true });
  }

  const failed = results.filter((item) => !item.ok);
  console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
