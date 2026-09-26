require('dotenv').config();

const API_BASE = 'http://localhost:5000/api/auth';

async function testAuth() {
  console.log('🚀 Starting Authentication Verification Tests...\n');

  const testEmail = `test_user_${Date.now()}@example.com`;
  const testPassword = 'SecurePassword123!';
  const testName = 'Test User';
  let authToken = '';

  try {
    // ── TEST 1: Register New User ──
    console.log('----------------------------------------------------');
    console.log(`TEST 1: Registering user "${testEmail}"`);
    const regRes = await fetch(`${API_BASE}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: testName, email: testEmail, password: testPassword }),
    });
    const regData = await regRes.json();
    console.log('Status:', regRes.status);
    console.log('Response:', regData);

    if (regRes.status !== 201 || !regData.success || !regData.token) {
      throw new Error('Registration failed: ' + JSON.stringify(regData));
    }
    authToken = regData.token;
    console.log('✅ TEST 1 PASSED: User registered successfully with JWT');

    // ── TEST 2: Reject Duplicate Email ──
    console.log('\n----------------------------------------------------');
    console.log('TEST 2: Attempting duplicate registration');
    const dupRes = await fetch(`${API_BASE}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: testName, email: testEmail, password: testPassword }),
    });
    const dupData = await dupRes.json();
    console.log('Status:', dupRes.status);
    console.log('Response:', dupData);

    if (dupRes.status !== 400 || dupData.success) {
      throw new Error('Duplicate registration was not blocked!');
    }
    console.log('✅ TEST 2 PASSED: Duplicate registration correctly rejected');

    // ── TEST 3: Login with Correct Password ──
    console.log('\n----------------------------------------------------');
    console.log('TEST 3: Logging in with correct credentials');
    const loginRes = await fetch(`${API_BASE}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail, password: testPassword }),
    });
    const loginData = await loginRes.json();
    console.log('Status:', loginRes.status);
    console.log('Response:', loginData);

    if (loginRes.status !== 200 || !loginData.success || !loginData.token) {
      throw new Error('Login failed: ' + JSON.stringify(loginData));
    }
    authToken = loginData.token;
    console.log('✅ TEST 3 PASSED: Login successful and returned JWT');

    // ── TEST 4: Login with Incorrect Password ──
    console.log('\n----------------------------------------------------');
    console.log('TEST 4: Logging in with wrong password');
    const wrongRes = await fetch(`${API_BASE}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testEmail, password: 'WrongPassword' }),
    });
    const wrongData = await wrongRes.json();
    console.log('Status:', wrongRes.status);
    console.log('Response:', wrongData);

    if (wrongRes.status !== 401 || wrongData.success) {
      throw new Error('Invalid password was not rejected!');
    }
    console.log('✅ TEST 4 PASSED: Invalid password rejected with 401');

    // ── TEST 5: Verify GET /api/auth/me with Valid Token ──
    console.log('\n----------------------------------------------------');
    console.log('TEST 5: Fetching current profile via /api/auth/me');
    const meRes = await fetch(`${API_BASE}/me`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`,
      },
    });
    const meData = await meRes.json();
    console.log('Status:', meRes.status);
    console.log('Response:', meData);

    if (meRes.status !== 200 || !meData.success || meData.user.email !== testEmail) {
      throw new Error('/api/auth/me failed: ' + JSON.stringify(meData));
    }
    console.log('✅ TEST 5 PASSED: Profile retrieved accurately with token');

    // ── TEST 6: Verify GET /api/auth/me with Missing / Bad Token ──
    console.log('\n----------------------------------------------------');
    console.log('TEST 6: Accessing /api/auth/me without token');
    const badRes = await fetch(`${API_BASE}/me`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });
    const badData = await badRes.json();
    console.log('Status:', badRes.status);
    console.log('Response:', badData);

    if (badRes.status !== 401 || badData.success) {
      throw new Error('Unauthorized access was allowed!');
    }
    console.log('✅ TEST 6 PASSED: Unauthorized request rejected with 401');

    console.log('\n====================================================');
    console.log('🎉 ALL 6/6 AUTHENTICATION TESTS PASSED!');
    console.log('====================================================\n');
  } catch (err) {
    console.error('\n❌ Auth tests failed:', err);
    process.exit(1);
  }
}

testAuth();
