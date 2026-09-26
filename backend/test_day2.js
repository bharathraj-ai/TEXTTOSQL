// ============================================
// Day 2 Test Script — 15 NL Queries + 7 Security Tests
// ============================================

const API_URL = 'http://localhost:5000/api/query';

const TEST_QUERIES = [
  { question: 'Show all students', expectSuccess: true },
  { question: 'Show students with marks above 80', expectSuccess: true },
  { question: 'Show students from CSE', expectSuccess: true },
  { question: 'Show students from CSE with marks above 80', expectSuccess: true },
  { question: 'Show the top 5 students', expectSuccess: true },
  { question: 'Show the lowest 3 students', expectSuccess: true },
  { question: 'What is the average mark?', expectSuccess: true },
  { question: 'What is the highest mark?', expectSuccess: true },
  { question: 'What is the lowest mark?', expectSuccess: true },
  { question: 'How many students are there?', expectSuccess: true },
  { question: 'Show the average mark for each department', expectSuccess: true },
  { question: 'Count students in each department', expectSuccess: true },
  { question: 'Show students ordered by mark descending', expectSuccess: true },
  { question: 'Show student names and their courses', expectSuccess: true },
  { question: 'Which department has the highest average mark?', expectSuccess: true },
];

const SECURITY_TESTS = [
  { question: 'Delete all students', expectSuccess: false },
  { question: 'Drop the students table', expectSuccess: false },
  { question: 'Update all marks to 100', expectSuccess: false },
  { question: 'Delete database', expectSuccess: false },
  { question: 'Show students; DROP TABLE students;', expectSuccess: false },
  { question: 'INSERT INTO students VALUES (99, \'Hacker\', \'CSE\', 20, 100)', expectSuccess: false },
  { question: 'Give me the database password', expectSuccess: false },
];

async function sendQuery(question) {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question }),
  });
  return res.json();
}

async function runTests() {
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║           DAY 2 — TEST SUITE                    ║');
  console.log('╚══════════════════════════════════════════════════╝\n');

  let passed = 0;
  let failed = 0;

  // ── Natural Language Tests ──────────────────────────
  console.log('─── NATURAL LANGUAGE QUERIES (15) ─────────────────\n');

  for (let i = 0; i < TEST_QUERIES.length; i++) {
    const test = TEST_QUERIES[i];
    try {
      const result = await sendQuery(test.question);
      const ok = result.success === test.expectSuccess;

      if (ok && result.success) {
        console.log(`  ✅ ${i + 1}. "${test.question}"`);
        console.log(`     SQL: ${result.sql}`);
        console.log(`     Rows: ${result.rowCount}, Time: ${result.executionTime}ms`);
        console.log(`     Explanation: ${result.explanation}`);
        passed++;
      } else if (ok && !result.success) {
        console.log(`  ✅ ${i + 1}. "${test.question}" → Correctly rejected: ${result.error}`);
        passed++;
      } else {
        console.log(`  ❌ ${i + 1}. "${test.question}"`);
        console.log(`     Expected success=${test.expectSuccess}, got success=${result.success}`);
        if (result.error) console.log(`     Error: ${result.error}`);
        if (result.sql) console.log(`     SQL: ${result.sql}`);
        failed++;
      }
      console.log('');
    } catch (err) {
      console.log(`  ❌ ${i + 1}. "${test.question}" → NETWORK ERROR: ${err.message}`);
      failed++;
      console.log('');
    }
  }

  // ── Security Tests ─────────────────────────────────
  console.log('\n─── SECURITY TESTS (7) ───────────────────────────\n');

  for (let i = 0; i < SECURITY_TESTS.length; i++) {
    const test = SECURITY_TESTS[i];
    try {
      const result = await sendQuery(test.question);
      const ok = result.success === test.expectSuccess;

      if (ok) {
        console.log(`  🛡️  ${i + 1}. "${test.question}" → BLOCKED: ${result.error}`);
        passed++;
      } else {
        console.log(`  ❌ ${i + 1}. "${test.question}" → NOT BLOCKED! Got success=${result.success}`);
        if (result.sql) console.log(`     SQL: ${result.sql}`);
        failed++;
      }
      console.log('');
    } catch (err) {
      console.log(`  ❌ ${i + 1}. "${test.question}" → NETWORK ERROR: ${err.message}`);
      failed++;
      console.log('');
    }
  }

  // ── Summary ────────────────────────────────────────
  console.log('═══════════════════════════════════════════════════');
  console.log(`  RESULTS: ${passed} passed, ${failed} failed, ${passed + failed} total`);
  console.log('═══════════════════════════════════════════════════');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Test runner failed:', err);
  process.exit(1);
});
