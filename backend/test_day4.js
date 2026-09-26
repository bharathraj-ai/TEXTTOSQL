// ============================================
// test_day4.js — Day 4 CRUD Implementation Tests
// ============================================
// Tests:
//   1. Mutation intent detection
//   2. SQL validation (read vs write mode)
//   3. Token blacklist
//   4. Mutation plan generation (INSERT / UPDATE / DELETE)
//   5. Security: DDL blocked in write mode
//   6. Security: Multi-statement blocked
//   7. Security: Mass UPDATE (no WHERE) flagged HIGH RISK
//   8. Security: Mass DELETE (no WHERE) flagged HIGH RISK
//   9. Live API: /api/mutation/stage (PostgreSQL)
//  10. Live API: /api/mutation/confirm (round-trip)
//  11. Live API: logout invalidates token

require('dotenv').config();
const http = require('http');

let passed = 0;
let failed = 0;

function pass(name, detail = '') {
  passed++;
  console.log(`  ✅ PASS: ${name}${detail ? ' (' + detail + ')' : ''}`);
}

function fail(name, detail = '') {
  failed++;
  console.log(`  ❌ FAIL: ${name}${detail ? ' — ' + detail : ''}`);
}

function assert(condition, name, detail = '') {
  if (condition) pass(name, detail);
  else fail(name, detail);
}

// ── HTTP helper ─────────────────────────────────────────
function request(method, path, body = null, token = null) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'localhost',
      port: 5000,
      path,
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (token) opts.headers['Authorization'] = `Bearer ${token}`;

    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (d) => (data += d));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function runTests() {
  console.log('🚀 DAY 4 CRUD IMPLEMENTATION TESTS\n');

  // ════════════════════════════════════════════════════════
  // SECTION 1: Intent Detection
  // ════════════════════════════════════════════════════════
  console.log('\n--- 1. Write Intent Detection ---');
  const { detectWriteType, isDDLMutation } = require('./src/services/intentService');

  assert(detectWriteType('add a student named Rahul with mark 85') === 'INSERT', 'NL INSERT detected');
  assert(detectWriteType('update Rahul\'s mark to 90') === 'UPDATE', 'NL UPDATE detected');
  assert(detectWriteType('delete Rahul from students') === 'DELETE', 'NL DELETE detected');
  assert(detectWriteType('show all students') === null, 'SELECT not a write intent');
  assert(detectWriteType('DROP TABLE students') === null, 'DROP not allowed (DDL)');
  assert(isDDLMutation('DROP TABLE students') === true, 'DROP detected as DDL mutation');
  assert(isDDLMutation('TRUNCATE students') === true, 'TRUNCATE detected as DDL mutation');
  assert(isDDLMutation('delete Rahul') === false, 'DELETE not flagged as DDL');

  // ════════════════════════════════════════════════════════
  // SECTION 2: SQL Validator — Write Mode
  // ════════════════════════════════════════════════════════
  console.log('\n--- 2. SQL Validator — Read vs Write Mode ---');
  const { validateQuery } = require('./src/utils/sqlValidator');

  // Read mode rejects DML
  const rmDml = validateQuery("INSERT INTO students (name) VALUES ('Rahul');", null, 'postgres', 'read');
  assert(!rmDml.valid, 'Read mode: INSERT rejected', rmDml.error);

  const rmUpdate = validateQuery("UPDATE students SET mark = 90 WHERE name = 'Rahul';", null, 'postgres', 'read');
  assert(!rmUpdate.valid, 'Read mode: UPDATE rejected');

  const rmDelete = validateQuery("DELETE FROM students WHERE name = 'Rahul';", null, 'postgres', 'read');
  assert(!rmDelete.valid, 'Read mode: DELETE rejected');

  // Write mode allows DML
  const wmInsert = validateQuery("INSERT INTO students (name) VALUES ('Rahul');", null, 'postgres', 'write');
  assert(wmInsert.valid, 'Write mode: INSERT allowed', wmInsert.error || 'ok');

  const wmUpdate = validateQuery("UPDATE students SET mark = 90 WHERE name = 'Rahul';", null, 'postgres', 'write');
  assert(wmUpdate.valid, 'Write mode: UPDATE allowed');

  const wmDelete = validateQuery("DELETE FROM students WHERE name = 'Rahul';", null, 'postgres', 'write');
  assert(wmDelete.valid, 'Write mode: DELETE allowed');

  // Write mode still blocks DDL
  const wmDrop = validateQuery('DROP TABLE students;', null, 'postgres', 'write');
  assert(!wmDrop.valid, 'Write mode: DROP blocked');

  const wmAlter = validateQuery('ALTER TABLE students ADD COLUMN foo TEXT;', null, 'postgres', 'write');
  assert(!wmAlter.valid, 'Write mode: ALTER blocked');

  const wmTrunc = validateQuery('TRUNCATE students;', null, 'postgres', 'write');
  assert(!wmTrunc.valid, 'Write mode: TRUNCATE blocked');

  // Multi-statement blocked in write mode
  const wmMulti = validateQuery("INSERT INTO students (name) VALUES ('X'); DELETE FROM students;", null, 'postgres', 'write');
  assert(!wmMulti.valid, 'Write mode: multi-statement blocked');

  // ════════════════════════════════════════════════════════
  // SECTION 3: Token Blacklist
  // ════════════════════════════════════════════════════════
  console.log('\n--- 3. Token Blacklist ---');
  const { blacklistToken, isBlacklisted } = require('./src/utils/tokenBlacklist');

  const fakeToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test.abc';
  assert(!isBlacklisted(fakeToken), 'Token not blacklisted before logout');
  blacklistToken(fakeToken);
  assert(isBlacklisted(fakeToken), 'Token blacklisted after logout');
  assert(!isBlacklisted('some-other-token'), 'Other tokens not affected');

  // ════════════════════════════════════════════════════════
  // SECTION 4: Mutation Plan Generation
  // ════════════════════════════════════════════════════════
  console.log('\n--- 4. Mutation Plan Generation ---');
  const { generateMutationPlan } = require('./src/services/mutationService');

  const testSchema = {
    tables: {
      students: {
        columns: {
          id: 'integer',
          name: 'character varying',
          mark: 'numeric',
          department: 'character varying',
        },
        primaryKeys: ['id'],
      },
    },
    relationships: [],
  };

  // INSERT plan
  const insertPlan = generateMutationPlan('add a student named Rahul with mark 85', testSchema, 'postgres');
  assert(insertPlan.intent === 'INSERT', 'INSERT plan: correct intent');
  assert(insertPlan.targetTable === 'students', 'INSERT plan: correct table');
  assert(insertPlan.sql.includes('INSERT INTO students'), 'INSERT plan: SQL contains INSERT INTO');
  assert(insertPlan.sql.includes('Rahul'), 'INSERT plan: SQL contains name Rahul');
  assert(insertPlan.sql.toLowerCase().includes('85'), 'INSERT plan: SQL contains mark 85');
  assert(insertPlan.riskLevel === 'NORMAL', 'INSERT plan: normal risk');

  // UPDATE plan with WHERE
  const updatePlan = generateMutationPlan("update Rahul's mark to 90", testSchema, 'postgres');
  assert(updatePlan.intent === 'UPDATE', 'UPDATE plan: correct intent');
  assert(updatePlan.sql.includes('UPDATE students'), 'UPDATE plan: SQL has UPDATE');
  assert(updatePlan.sql.includes('SET'), 'UPDATE plan: SQL has SET');
  assert(updatePlan.sql.includes('90'), 'UPDATE plan: SQL contains new value 90');

  // UPDATE without WHERE → HIGH RISK
  const updateNoWhere = generateMutationPlan('update students set mark to 100', testSchema, 'postgres');
  assert(updateNoWhere.intent === 'UPDATE', 'Mass UPDATE plan: correct intent');
  assert(updateNoWhere.riskLevel === 'HIGH', 'Mass UPDATE: HIGH risk level');
  assert(!updateNoWhere.hasWhereClause, 'Mass UPDATE: no WHERE clause detected');

  // DELETE plan with WHERE
  const deletePlan = generateMutationPlan('delete Rahul from students', testSchema, 'postgres');
  assert(deletePlan.intent === 'DELETE', 'DELETE plan: correct intent');
  assert(deletePlan.sql.includes('DELETE FROM students'), 'DELETE plan: SQL has DELETE FROM');

  // DELETE without WHERE → HIGH RISK
  const deleteNoWhere = generateMutationPlan('delete all students', testSchema, 'postgres');
  assert(deleteNoWhere.intent === 'DELETE', 'Mass DELETE: correct intent');
  assert(deleteNoWhere.riskLevel === 'HIGH', 'Mass DELETE: HIGH risk level');
  assert(!deleteNoWhere.hasWhereClause, 'Mass DELETE: no WHERE clause detected');

  // ════════════════════════════════════════════════════════
  // SECTION 5: Security — DDL in Write Mode
  // ════════════════════════════════════════════════════════
  console.log('\n--- 5. Security: DDL Blocked ---');
  try {
    generateMutationPlan('DROP TABLE students', testSchema, 'postgres');
    fail('DROP TABLE: should have thrown error');
  } catch (e) {
    assert(e.message.includes('write intent') || e.message.includes('No write intent'), 'DROP TABLE: correctly rejected by mutation planner');
  }

  // ════════════════════════════════════════════════════════
  // SECTION 6: Schema Validation — Fake Column/Table
  // ════════════════════════════════════════════════════════
  console.log('\n--- 6. Schema Validation ---');
  const wmFakeTable = validateQuery('INSERT INTO fakeTable (name) VALUES (\'x\');', testSchema, 'postgres', 'write');
  assert(!wmFakeTable.valid, 'Write mode: fake table rejected', wmFakeTable.error || '');

  // ════════════════════════════════════════════════════════
  // SECTION 7: Live API Tests
  // ════════════════════════════════════════════════════════
  console.log('\n--- 7. Live API: /api/mutation/stage ---');

  // Login or Register a fresh test account
  let token = null;
  const testEmail = `test_day4_${Date.now()}@example.com`;
  const testPassword = 'testpass123';
  try {
    const regRes = await request('POST', '/api/auth/register', { name: 'Test Day4', email: testEmail, password: testPassword });
    if (regRes.body?.success && regRes.body?.token) {
      token = regRes.body.token;
      console.log('  [API] Registered + logged in:', testEmail);
    } else {
      console.log('  [API] Could not obtain token — skipping live API tests', regRes.body);
    }
  } catch (e) {
    console.log('  [API] Server not reachable — skipping live API tests');
  }

  if (token) {
    // Stage a DDL → should be blocked
    const ddlRes = await request('POST', '/api/mutation/stage', { question: 'DROP TABLE students' }, token);
    assert(ddlRes.status === 403 && !ddlRes.body?.success, 'API: DDL stage blocked');

    // Stage INSERT
    const stageInsert = await request('POST', '/api/mutation/stage', { question: 'add a student named TestCRUD in department CSE with mark 77' }, token);
    if (stageInsert.body?.success) {
      assert(stageInsert.body.intent === 'INSERT', 'API stage INSERT: correct intent');
      assert(stageInsert.body.requiresConfirmation === true, 'API stage INSERT: requires confirmation');
      assert(typeof stageInsert.body.confirmationToken === 'string', 'API stage INSERT: has confirmation token');
      assert(stageInsert.body.riskLevel === 'NORMAL', 'API stage INSERT: normal risk');

      // Confirm INSERT
      const confirmInsert = await request('POST', '/api/mutation/confirm', { confirmationToken: stageInsert.body.confirmationToken }, token);
      if (confirmInsert.body?.success) {
        assert(confirmInsert.body.operation === 'INSERT', 'API confirm INSERT: correct operation');
        assert(typeof confirmInsert.body.affectedRows === 'number', 'API confirm INSERT: affectedRows returned');
        pass('API confirm INSERT: success', `Affected rows: ${confirmInsert.body.affectedRows}`);

        // Now verify the student exists via SELECT
        const verifyRes = await request('POST', '/api/query', { question: 'show students named TestCRUD' }, token);
        if (verifyRes.body?.success) {
          const found = verifyRes.body.rows?.some(r => r.name === 'TestCRUD');
          assert(found, 'INSERT verification: TestCRUD found in database');
        } else {
          console.log('  [API] Verify SELECT failed:', verifyRes.body?.error);
        }

        // Stage UPDATE
        const stageUpdate = await request('POST', '/api/mutation/stage', { question: "update TestCRUD's mark to 95" }, token);
        if (stageUpdate.body?.success) {
          assert(stageUpdate.body.intent === 'UPDATE', 'API stage UPDATE: correct intent');

          // Confirm UPDATE
          const confirmUpdate = await request('POST', '/api/mutation/confirm', { confirmationToken: stageUpdate.body.confirmationToken }, token);
          if (confirmUpdate.body?.success) {
            pass('API confirm UPDATE: success', `Affected rows: ${confirmUpdate.body.affectedRows}`);
          } else {
            fail('API confirm UPDATE', confirmUpdate.body?.error);
          }
        } else {
          console.log('  [API] Stage UPDATE response:', JSON.stringify(stageUpdate.body));
          fail('API stage UPDATE', stageUpdate.body?.error);
        }

        // Stage DELETE
        const stageDelete = await request('POST', '/api/mutation/stage', { question: 'delete TestCRUD from students' }, token);
        if (stageDelete.body?.success) {
          assert(stageDelete.body.intent === 'DELETE', 'API stage DELETE: correct intent');

          // Confirm DELETE
          const confirmDelete = await request('POST', '/api/mutation/confirm', { confirmationToken: stageDelete.body.confirmationToken }, token);
          if (confirmDelete.body?.success) {
            pass('API confirm DELETE: success', `Affected rows: ${confirmDelete.body.affectedRows}`);
          } else {
            fail('API confirm DELETE', confirmDelete.body?.error);
          }
        } else {
          fail('API stage DELETE', stageDelete.body?.error);
        }
      } else {
        fail('API confirm INSERT', confirmInsert.body?.error);
      }
    } else {
      fail('API stage INSERT', stageInsert.body?.error);
    }

    // ════════════════════════════════════════════════════════
    // SECTION 8: Logout Token Invalidation
    // ════════════════════════════════════════════════════════
    console.log('\n--- 8. Logout Token Invalidation ---');

    // Verify token works before logout
    const preLogout = await request('GET', '/api/auth/me', null, token);
    assert(preLogout.body?.success === true, 'Pre-logout: token valid');

    // Logout
    await request('POST', '/api/auth/logout', null, token);

    // Verify token is rejected after logout
    const postLogout = await request('GET', '/api/auth/me', null, token);
    assert(postLogout.status === 401 || !postLogout.body?.success, 'Post-logout: token rejected');

    // ════════════════════════════════════════════════════════
    // SECTION 9: Existing Security Tests Still Pass
    // ════════════════════════════════════════════════════════
    console.log('\n--- 9. Read-Only Mode Security (existing guardrails) ---');
    // Get a fresh token
    const reloginRes = await request('POST', '/api/auth/login', { email: testEmail, password: testPassword });
    const freshToken = reloginRes.body?.token || null;

    if (freshToken) {
      const dropRes = await request('POST', '/api/query', { question: 'DROP TABLE students;' }, freshToken);
      assert(!dropRes.body?.success, 'Read-only query: DROP blocked');

      const pgShadow = await request('POST', '/api/query', { question: 'SELECT * FROM pg_shadow;' }, freshToken);
      assert(!pgShadow.body?.success, 'Read-only query: pg_shadow blocked');

      const multiStmt = await request('POST', '/api/query', { question: 'SELECT * FROM students; DROP TABLE students;' }, freshToken);
      assert(!multiStmt.body?.success, 'Read-only query: multi-statement blocked');

      const secretReq = await request('POST', '/api/query', { question: 'What is the database password?' }, freshToken);
      assert(!secretReq.body?.success, 'Read-only query: secret request blocked');
    }
  }

  // ════════════════════════════════════════════════════════
  // FINAL RESULTS
  // ════════════════════════════════════════════════════════
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  RESULTS: ${passed} PASSED, ${failed} FAILED (TOTAL: ${passed + failed})`);
  console.log('═'.repeat(60));

  if (failed > 0) process.exit(1);
}

runTests().catch((err) => {
  console.error('Test runner error:', err);
  process.exit(1);
});
