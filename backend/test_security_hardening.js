/**
 * Security hardening checks.
 * Prints pass/fail names only. Does not print SQL values, tokens, or connection URLs.
 */
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const jwt = require('jsonwebtoken');
const { getJwtSecret } = require('./src/config/requiredSecrets');
const { blacklistToken } = require('./src/utils/tokenBlacklist');
const { validateQuery } = require('./src/utils/sqlValidator');
const {
  createPendingOperation,
  claimPendingOperation,
  failPendingOperation,
  completePendingOperation,
  getPendingOperation,
} = require('./src/services/pendingOperationStore');
const connectionManager = require('./src/services/connectionManager');
const { invalidateUserSchemaCache } = require('./src/services/schemaService');
const { SqliteAdapter } = require('./src/adapters/sqliteAdapter');
const { redactSql, redactLogText, logSafeSql } = require('./src/utils/safeLog');

const results = [];

function check(name, ok) {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
}

function request(server, method, requestPath, { token, body } = {}) {
  const { port } = server.address();
  const payload = body ? JSON.stringify(body) : null;
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: requestPath,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(data); } catch { parsed = null; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function runStartup(env) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'intella-secret-'));
  return spawnSync(process.execPath, ['-e', `require(${JSON.stringify(path.join(__dirname, 'src/server.js'))});`], {
    cwd: dir,
    env: { PATH: process.env.PATH || '', HOME: process.env.HOME || '', ...env },
    timeout: 20000,
    encoding: 'utf8',
  });
}

async function runHttpChecks(server) {
  const missingQuery = await request(server, 'POST', '/api/query', { body: { question: 'show students' } });
  check('1 unauthenticated SELECT returns 401', missingQuery.status === 401);

  const missingMutation = await request(server, 'POST', '/api/mutation/stage', { body: { question: 'delete one student' } });
  check('2 unauthenticated mutation returns 401', missingMutation.status === 401);

  const invalid = await request(server, 'POST', '/api/query', {
    token: 'not-a-valid-token',
    body: { question: 'show students' },
  });
  check('3 invalid JWT returns 401', invalid.status === 401);

  const expiredToken = jwt.sign({ id: 1, exp: Math.floor(Date.now() / 1000) - 60 }, getJwtSecret());
  const expired = await request(server, 'POST', '/api/query', {
    token: expiredToken,
    body: { question: 'show students' },
  });
  check('4 expired JWT returns 401', expired.status === 401);

  const liveToken = jwt.sign({ id: 1 }, getJwtSecret(), { expiresIn: '1h' });
  const logout = await request(server, 'POST', '/api/auth/logout', { token: liveToken });
  const loggedOutQuery = await request(server, 'POST', '/api/query', {
    token: liveToken,
    body: { question: 'show students' },
  });
  const loggedOutMutation = await request(server, 'POST', '/api/mutation/stage', {
    token: liveToken,
    body: { question: 'delete one student' },
  });
  const loggedOutMe = await request(server, 'GET', '/api/auth/me', { token: liveToken });
  const loggedOutDb = await request(server, 'GET', '/api/database/status', { token: liveToken });
  check(
    '5 logged-out JWT returns 401 on query, mutation, auth, and database routes',
    logout.status === 200
      && loggedOutQuery.status === 401
      && loggedOutMutation.status === 401
      && loggedOutMe.status === 401
      && loggedOutDb.status === 401,
  );

  const blacklisted = jwt.sign({ id: 1 }, getJwtSecret(), { expiresIn: '1h' });
  blacklistToken(blacklisted);
  const blacklistedQuery = await request(server, 'POST', '/api/query', {
    token: blacklisted,
    body: { question: 'show students' },
  });
  check('5b blacklisted JWT returns 401', blacklistedQuery.status === 401);
}

async function runIsolationChecks() {
  let missingUserRejected = false;
  try {
    await connectionManager.getUserAdapter(null);
  } catch (err) {
    missingUserRejected = err.statusCode === 401;
  }
  check('6 missing user does not fall back to the application database', missingUserRejected);

  let unknownUserRejected = false;
  try {
    await connectionManager.getUserAdapter(900000001);
  } catch (err) {
    const text = String(err.message || '');
    unknownUserRejected = err.statusCode === 400
      && !/postgres(ql)?:\/\//i.test(text)
      && !/password/i.test(text);
  }
  check('6b user without a saved connection is rejected', unknownUserRejected);

  const appPool = require('./src/db/applicationDatabase');
  const saved = await appPool.query(
    'SELECT id, user_id FROM database_connections ORDER BY id ASC LIMIT 20',
  );
  const rows = saved.rows || [];
  if (rows.length === 0) {
    check('7 user A cannot access user B connection', false);
    return;
  }

  const owner = rows[0];
  const other = rows.find((row) => Number(row.user_id) !== Number(owner.user_id));
  const outsiderId = other ? Number(other.user_id) : 900000001;
  let isolated = false;
  try {
    await connectionManager.assertUserConnection(outsiderId, Number(owner.id));
  } catch (err) {
    isolated = err.statusCode === 403;
  }
  check('7 user A cannot access user B connection', isolated);

  let ownConnection = false;
  try {
    const own = await connectionManager.getUserAdapter(Number(owner.user_id));
    ownConnection = Boolean(own && own.type);
  } catch {
    ownConnection = false;
  }
  check('6c authenticated user resolves only a saved connection', ownConnection);
}

function runSecretChecks() {
  const missingJwt = runStartup({ ENCRYPTION_KEY: 'test-encryption-key' });
  const jwtOutput = `${missingJwt.stdout || ''}\n${missingJwt.stderr || ''}`;
  check(
    '8 missing JWT_SECRET fails startup',
    missingJwt.status === 1 && jwtOutput.includes('JWT_SECRET is required') && !jwtOutput.includes('nl_sql_jwt_secret'),
  );

  const missingEncryption = runStartup({ JWT_SECRET: 'test-jwt-secret' });
  const encryptionOutput = `${missingEncryption.stdout || ''}\n${missingEncryption.stderr || ''}`;
  check(
    '9 missing ENCRYPTION_KEY fails startup',
    missingEncryption.status === 1 && encryptionOutput.includes('ENCRYPTION_KEY is required'),
  );

  const encryptionChild = spawnSync(process.execPath, ['-e', `
    const { encrypt } = require(${JSON.stringify(path.join(__dirname, 'src/utils/encryption.js'))});
    encrypt('value');
  `], {
    cwd: fs.mkdtempSync(path.join(os.tmpdir(), 'intella-enc-')),
    env: { PATH: process.env.PATH || '', HOME: process.env.HOME || '' },
    encoding: 'utf8',
    timeout: 15000,
  });
  const encryptionChildOutput = `${encryptionChild.stdout || ''}\n${encryptionChild.stderr || ''}`;
  check(
    '9b encryption refuses to run without ENCRYPTION_KEY',
    encryptionChild.status !== 0 && encryptionChildOutput.includes('ENCRYPTION_KEY is required'),
  );
}

function runValidatorChecks() {
  const update = validateQuery('UPDATE students SET mark = 90;', null, 'postgres', 'write');
  const updateWhere = validateQuery("UPDATE students SET mark = 90 WHERE name = 'Rahul';", null, 'postgres', 'write');
  const updateLiteral = validateQuery("UPDATE students SET name = 'where is this';", null, 'postgres', 'write');
  check('10 UPDATE without WHERE is rejected', update.valid === false && updateWhere.valid === true && updateLiteral.valid === false);

  const del = validateQuery('DELETE FROM students;', null, 'postgres', 'write');
  const delWhere = validateQuery("DELETE FROM students WHERE name = 'Rahul';", null, 'postgres', 'write');
  check('11 DELETE without WHERE is rejected', del.valid === false && delWhere.valid === true);
}

async function runConfirmationChecks() {
  const userId = 424242;
  const adapter = new SqliteAdapter('sqlite::memory:');
  await adapter.executeWrite('CREATE TABLE students (id INTEGER PRIMARY KEY, name TEXT, mark INTEGER);');
  const original = connectionManager.getUserAdapter;
  connectionManager.getUserAdapter = async () => adapter;
  const { confirmAndExecuteOperation } = require('./src/services/confirmationService');
  invalidateUserSchemaCache(userId);

  try {
    const failingId = createPendingOperation({
      sql: 'UPDATE students SET mark = 1 WHERE missing_column = 1;',
      intent: 'UPDATE',
      targetTable: 'students',
      userId,
      dbType: 'sqlite',
    });
    const failed = await confirmAndExecuteOperation({ operationId: failingId, userId });
    const afterFail = getPendingOperation(failingId);
    const retry = await confirmAndExecuteOperation({ operationId: failingId, userId });
    const afterRetry = getPendingOperation(failingId);
    check(
      '12 failed confirmation stays retryable with the same SQL',
      failed.success === false
        && failed.retryable === true
        && afterFail && afterFail.status === 'FAILED'
        && afterFail.sql.includes('missing_column')
        && retry.success === false
        && afterRetry && afterRetry.status === 'FAILED',
    );

    const successId = createPendingOperation({
      sql: "INSERT INTO students (name, mark) VALUES ('Rahul', 85);",
      intent: 'INSERT',
      targetTable: 'students',
      userId,
      dbType: 'sqlite',
    });
    const logs = [];
    const originalLog = console.log;
    console.log = (...args) => { logs.push(args.join(' ')); };
    let first;
    let second;
    try {
      first = await confirmAndExecuteOperation({ operationId: successId, userId });
      second = await confirmAndExecuteOperation({ operationId: successId, userId });
    } finally {
      console.log = originalLog;
    }
    const logged = logs.join('\n');
    const done = getPendingOperation(successId);
    check(
      '13 successful confirmation cannot run a second time',
      first.success === true && second.success === false && done && done.status === 'SUCCESS',
    );
    check(
      '14 SQL values are not printed in confirmation logs',
      !logged.includes('Rahul') && /INSERT INTO students \(name, mark\) VALUES \(\?, \?\)/i.test(logged),
    );
  } finally {
    connectionManager.getUserAdapter = original;
    invalidateUserSchemaCache(userId);
    if (adapter.db) adapter.db.close();
  }

  const redacted = redactSql("INSERT INTO users(name,email) VALUES('Bharath','bharath@example.com');");
  const captured = [];
  const originalLog = console.log;
  console.log = (...args) => { captured.push(args.join(' ')); };
  logSafeSql('[TEST]', "INSERT INTO users(name,email) VALUES('Bharath','bharath@example.com');");
  console.log = originalLog;
  const logText = captured.join('\n');
  check(
    '14b SQL redaction removes literal values',
    !redacted.includes('Bharath')
      && !redacted.includes('bharath@example.com')
      && redacted.includes('?')
      && !logText.includes('bharath@example.com'),
  );

  const leaked = "connect ENOTFOUND db.internal.example.com password=supersecret postgresql://user:supersecret@db.internal.example.com/app";
  const safe = redactLogText(leaked);
  const dbSource = fs.readFileSync(path.join(__dirname, 'src/db/database.js'), 'utf8');
  const appSource = fs.readFileSync(path.join(__dirname, 'src/db/applicationDatabase.js'), 'utf8');
  check(
    '15 DB password and URL are redacted and connection logs use the redactor',
    !safe.includes('supersecret')
      && !safe.includes('db.internal.example.com')
      && !safe.includes('postgresql://')
      && dbSource.includes('safeErrorMessage')
      && appSource.includes('safeErrorMessage'),
  );
}

async function main() {
  runSecretChecks();
  runValidatorChecks();

  const app = require('./src/server');
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });

  try {
    await runHttpChecks(server);
    await runIsolationChecks();
    await runConfirmationChecks();
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  const failed = results.filter((item) => !item.ok);
  console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(`TEST RUNNER FAILED: ${redactLogText(err && err.stack ? err.stack : err)}`);
  process.exit(1);
});
