/**
 * Tamil, Tanglish, and mixed-language understanding.
 * The language service must not generate or execute SQL.
 */
const fs = require('fs');
const path = require('path');
const { analyzeLanguage, normalizeAmount } = require('./src/services/languageService');
const { generateSQL } = require('./src/services/llmService');
const { validateQuery } = require('./src/utils/sqlValidator');
const { generateMutationPlan } = require('./src/services/mutationService');
const { reviewSQL, clearMockReviewer } = require('./src/services/sqlReviewService');
const { createMemoryUsageStore, setUsageStore, clearUsageStore, getUsageSummary } = require('./src/services/openRouterCostGuard');

const results = [];

function check(name, ok, detail = '') {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${String(detail).slice(0, 160)}` : ''}`);
}

const schema = {
  tables: {
    students: {
      columns: { id: 'integer', name: 'text', mark: 'integer', email: 'text' },
      primaryKeys: ['id'],
    },
    vendors: {
      columns: { id: 'integer', name: 'text', contract_value: 'numeric', email: 'text' },
      primaryKeys: ['id'],
    },
  },
};

const ambiguousSchema = {
  tables: {
    exams: {
      columns: { id: 'integer', marks: 'integer', test_score: 'integer', final_score: 'integer' },
      primaryKeys: ['id'],
    },
  },
};

function condition(result, operator) {
  return (result.entities.conditions || []).find((item) => item.operator === operator);
}

async function main() {
  const source = fs.readFileSync(path.join(__dirname, 'src/services/languageService.js'), 'utf8');
  check('language service does not execute SQL or call a provider', !/\b(executeQuery|executeWrite|fetch\s*\(|reviewSQL|groq)\b/.test(source));

  const english = analyzeLanguage('Show students with marks above 80', schema);
  check('English stays English', english.language === 'english' && english.normalized_request === 'Show students with marks above 80');

  const tanglish = analyzeLanguage('80 ku mela mark vanguna students ah kudu', schema);
  const tanglishAbove = condition(tanglish, '>');
  check('Tanglish show students above 80', tanglish.language === 'tanglish' && tanglish.intent === 'SELECT' && tanglish.entities.table_hint === 'students' && tanglishAbove && tanglishAbove.column_hint === 'mark' && tanglishAbove.value === 80, tanglish.normalized_request);

  const mixedStudents = analyzeLanguage('students la mark 80 ku mela irukkuravanga kudu', schema);
  const mixedAbove = condition(mixedStudents, '>');
  check('Tanglish students la mark above 80', mixedStudents.intent === 'SELECT' && mixedStudents.entities.table_hint === 'students' && mixedAbove && mixedAbove.column_hint === 'mark' && mixedAbove.value === 80);

  const crore = analyzeLanguage('vendors la contract value 1 crore ku mela irukkuravanga kudu', schema);
  const croreCondition = condition(crore, '>');
  check('Tanglish vendors above 1 crore', crore.intent === 'SELECT' && crore.entities.table_hint === 'vendors' && croreCondition && /contract/.test(croreCondition.column_hint) && croreCondition.value === 10000000, crore.normalized_request);

  const tamilStudents = analyzeLanguage('80க்கு மேல் மதிப்பெண் பெற்ற மாணவர்களை காட்டு', schema);
  const tamilAbove = condition(tamilStudents, '>');
  check('Tamil show students above 80', tamilStudents.language === 'tamil' && tamilStudents.intent === 'SELECT' && tamilStudents.entities.table_hint === 'students' && tamilAbove && tamilAbove.column_hint === 'mark' && tamilAbove.value === 80, tamilStudents.normalized_request);

  const tamilVendors = analyzeLanguage('விற்பனையாளர்களின் பட்டியலை காட்டு', schema);
  check('Tamil show vendors', tamilVendors.language === 'tamil' && tamilVendors.intent === 'SELECT' && tamilVendors.entities.table_hint === 'vendors', tamilVendors.normalized_request);

  const mixedTable = analyzeLanguage('students table la mark 80 ku mela', schema);
  check('Mixed students table keeps the table and column', mixedTable.language === 'mixed' && mixedTable.entities.table_hint === 'students' && condition(mixedTable, '>')?.column_hint === 'mark' && condition(mixedTable, '>')?.value === 80);

  const update = analyzeLanguage('Rahul oda mark 90 ah update pannu', schema);
  check('Mixed update Rahul mark to 90', update.language === 'mixed' && update.intent === 'UPDATE' && update.entities.assignments && update.entities.assignments.mark === 90 && update.entities.conditions[0]?.value === 'Rahul' && update.entities.conditions[0]?.operator === '=', update.normalized_request);

  const nullStudents = analyzeLanguage('email illa students ah kudu', schema);
  const nullCondition = condition(nullStudents, 'IS NULL');
  check('Tanglish null email', nullStudents.intent === 'SELECT' && nullStudents.entities.table_hint === 'students' && nullCondition && nullCondition.column_hint === 'email');

  const removeRahul = analyzeLanguage('Rahul ah delete pannu', schema);
  check('Tanglish delete Rahul is a targeted delete', removeRahul.intent === 'DELETE' && removeRahul.mass === false && removeRahul.entities.conditions[0]?.column_hint === 'name' && removeRahul.entities.conditions[0]?.value === 'Rahul' && !removeRahul.sql);

  const dropTable = analyzeLanguage('students table ah drop pannu', schema);
  check('Drop table stays a DROP intent', dropTable.intent === 'DROP' && /drop the students table/i.test(dropTable.normalized_request) && !dropTable.sql);

  const mass = analyzeLanguage('students ellarayum delete pannu', schema);
  check('Mass delete stays a mass DELETE', mass.intent === 'DELETE' && mass.mass === true && /all rows/i.test(mass.normalized_request));

  const ambiguous = analyzeLanguage('score 80 ku mela kudu', ambiguousSchema);
  check('Ambiguous score columns are not guessed', ambiguous.status === 'ambiguous' && ambiguous.normalized_request == null && ambiguous.options.includes('test_score') && ambiguous.options.includes('final_score'));

  const unclearDelete = analyzeLanguage('students table ah delete pannu', schema);
  check('Deleting a table asks for clarification', unclearDelete.status === 'clarification' && unclearDelete.normalized_request == null);

  check('1 crore is 10000000', normalizeAmount('1 crore') === 10000000);
  check('50 lakh is 5000000', normalizeAmount('50 lakh') === 5000000);
  check('10k is 10000', normalizeAmount('10k') === 10000);

  const generated = generateSQL(tanglish.normalized_request, schema, [], 'postgres');
  check('Local SQL generator still builds the student filter', /students/i.test(generated) && />\s*80/.test(generated), generated);

  const nullSql = generateSQL(nullStudents.normalized_request, schema, [], 'postgres');
  check('Local SQL generator keeps an email IS NULL filter', /students/i.test(nullSql) && /email/i.test(nullSql) && /IS NULL/i.test(nullSql), nullSql);

  const unrestricted = analyzeLanguage('mark ah 90 update pannu', schema);
  const plan = generateMutationPlan(unrestricted.normalized_request, schema, 'postgres');
  const unrestrictedValidation = validateQuery(plan.sql, schema, 'postgres', 'write');
  check('Update without a target is still rejected by the local validator', unrestricted.intent === 'UPDATE' && unrestricted.entities.conditions.length === 0 && unrestrictedValidation.valid === false, plan.sql);

  const dropValidation = validateQuery('DROP TABLE students;', schema, 'postgres', 'write');
  const massValidation = validateQuery('DELETE FROM students;', schema, 'postgres', 'write');
  check('Local validator still rejects DROP and mass DELETE', dropValidation.valid === false && massValidation.valid === false);

  const originalFetch = global.fetch;
  let fetchCalled = false;
  global.fetch = async () => {
    fetchCalled = true;
    throw new Error('language service must not call the network');
  };
  setUsageStore(createMemoryUsageStore({ request_count: 2, estimated_cost_usd: 0.0011115 }));
  const before = await getUsageSummary();
  analyzeLanguage('80 ku mela mark vanguna students ah kudu', schema);
  const after = await getUsageSummary();
  check('Language understanding does not spend the OpenRouter budget', fetchCalled === false && after.request_count === before.request_count && after.estimated_cost_usd === before.estimated_cost_usd);
  global.fetch = originalFetch;
  clearUsageStore();

  const savedKey = process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  clearMockReviewer();
  const blocked = await reviewSQL({
    naturalLanguageQuery: 'Drop the students table',
    generatedSQL: 'DROP TABLE students;',
    dbType: 'postgres',
    schema,
    operation: 'DROP',
  });
  if (savedKey === undefined) delete process.env.OPENROUTER_API_KEY;
  else process.env.OPENROUTER_API_KEY = savedKey;
  check('OpenRouter failure still does not approve DROP', blocked.approved === false && blocked.reviewUnavailable === true);

  const failed = results.filter((row) => !row.ok);
  console.log(`\n${results.length - failed.length} passed, ${failed.length} failed, 0 skipped`);
  if (failed.length) process.exit(1);
}

main().catch((err) => {
  console.error(err && err.message ? err.message : err);
  process.exit(1);
});
