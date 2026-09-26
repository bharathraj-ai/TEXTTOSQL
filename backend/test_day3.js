// ============================================
// Day 3 — Comprehensive Test Suite
// ============================================
// Tests:
//   1. Query processing with Database A (students)
//   2. Filtering, aggregation, group by, ordering
//   3. Clarification flow (ambiguous questions)
//   4. Clarify endpoint resolution
//   5. Unsupported question rejection
//   6. Secret/credential request rejection
//   7. Security enforcement (blocking DELETE, DROP, UPDATE, DDL)
//   8. Schema-aware dynamic suggestions
//   9. Schema summary and discovery
//  10. Arbitrary schema adaptability (Database B structure)

require('dotenv').config();
const http = require('http');

const API_BASE = 'http://localhost:5000';

function post(path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const url = new URL(path, API_BASE);
    const req = http.request(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
          ...headers,
        },
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => (raw += chunk));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(raw) });
          } catch {
            resolve({ status: res.statusCode, body: raw });
          }
        });
      }
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function get(path, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, API_BASE);
    const req = http.request(
      url,
      {
        method: 'GET',
        headers,
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => (raw += chunk));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(raw) });
          } catch {
            resolve({ status: res.statusCode, body: raw });
          }
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

async function runTests() {
  console.log('═'.repeat(60));
  console.log('  DAY 3 — ENGINE & SECURITY TEST SUITE');
  console.log('═'.repeat(60));

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

  // ── 1. Basic SELECT ─────────────────────────────────
  console.log('\n--- 1. Natural Language Queries (Database A) ---');
  {
    const res = await post('/api/query', { question: 'Show all students' });
    assert(
      'Show all students',
      res.body.success === true && res.body.sql && res.body.sql.includes('FROM students'),
      res.body.sql
    );
  }

  // ── 2. Filter query ─────────────────────────────────
  {
    const res = await post('/api/query', { question: 'Show students with marks above 80' });
    assert(
      'Filter: marks above 80',
      res.body.success === true && res.body.sql && res.body.sql.includes('mark > 80'),
      res.body.sql
    );
  }

  // ── 3. Average mark ─────────────────────────────────
  {
    const res = await post('/api/query', { question: 'What is the average mark of students' });
    assert(
      'Aggregate: average mark',
      res.body.success === true && res.body.sql && res.body.sql.includes('AVG(mark)'),
      res.body.sql
    );
  }

  // ── 4. Group By query ───────────────────────────────
  {
    const res = await post('/api/query', { question: 'Show average mark for each department' });
    assert(
      'Group By: average mark per department',
      res.body.success === true &&
        res.body.sql &&
        res.body.sql.includes('GROUP BY department') &&
        res.body.sql.includes('AVG(mark)'),
      res.body.sql
    );
  }

  // ── 5. Count query ──────────────────────────────────
  {
    const res = await post('/api/query', { question: 'How many students are enrolled' });
    assert(
      'Count query',
      res.body.success === true && res.body.sql && res.body.sql.includes('COUNT(*)'),
      res.body.sql
    );
  }

  // ── 6. Ambiguity Detection ──────────────────────────
  console.log('\n--- 2. Ambiguity Detection & Clarification ---');
  let ambiguityOptions = [];
  {
    const res = await post('/api/query', { question: 'Show the best students' });
    ambiguityOptions = res.body.options || [];
    assert(
      'Ambiguous question requires clarification',
      res.body.type === 'clarification_required' &&
        Array.isArray(res.body.options) &&
        res.body.options.length > 0,
      `Options: ${JSON.stringify(res.body.options)}`
    );
  }

  // ── 7. Clarification Resolution ─────────────────────
  {
    const selected = ambiguityOptions.length > 0 ? ambiguityOptions[0] : 'Highest mark';
    const res = await post('/api/query/clarify', {
      originalQuestion: 'Show the best students',
      selectedOption: selected,
    });
    assert(
      'Clarification resolution succeeds',
      res.body.success === true && res.body.sql && res.body.rows && res.body.rows.length > 0,
      `SQL: ${res.body.sql} | Rows: ${res.body.rows ? res.body.rows.length : 0}`
    );
  }

  // ── 8. Unsupported Question ─────────────────────────
  console.log('\n--- 3. Guardrails & Rejections ---');
  {
    const res = await post('/api/query', { question: 'What is the weather in Tokyo?' });
    assert(
      'Unsupported non-database question rejected',
      res.body.type === 'unsupported_question' && res.body.success === false,
      res.body.message
    );
  }

  // ── 9. Secret Request Rejection ─────────────────────
  {
    const res = await post('/api/query', { question: 'What is the database password?' });
    assert(
      'Secret/credential request blocked',
      res.body.success === false && res.body.error && res.body.error.includes('credentials'),
      res.body.error
    );
  }

  // ── 10. Security: Raw DELETE blocked ────────────────
  console.log('\n--- 4. Security Enforcement ---');
  {
    const res = await post('/api/query', { question: 'DELETE FROM students WHERE id = 1' });
    assert(
      'Raw DELETE query blocked',
      res.body.success === false &&
        (res.body.error.includes('Only read-only SELECT') ||
         res.body.error.includes('Only SELECT queries are allowed') ||
         res.body.error.includes('Modification operations')),
      res.body.error
    );
  }

  // ── 11. Security: Natural Language DELETE blocked ───
  {
    const res = await post('/api/query', { question: 'Delete all students' });
    assert(
      'Natural language delete blocked',
      res.body.success === false &&
        (res.body.error.includes('Only read-only SELECT') ||
         res.body.error.includes('Modification operations')),
      res.body.error
    );
  }

  // ── 12. Security: DROP TABLE blocked ────────────────
  {
    const res = await post('/api/query', { question: 'DROP TABLE students;' });
    assert(
      'Raw DROP TABLE blocked',
      res.body.success === false &&
        (res.body.error.includes('Only read-only SELECT') ||
         res.body.error.includes('Modification operations') ||
         res.body.error.includes('DROP')),
      res.body.error
    );
  }

  // ── 13. Security: Multi-statement SQL Injection ────
  {
    const res = await post('/api/query', { question: 'SELECT * FROM students; DROP TABLE students;' });
    assert(
      'Multi-statement injection blocked',
      res.body.success === false &&
        (res.body.error.includes('Multiple SQL statements') ||
         res.body.error.includes('Only read-only SELECT') ||
         res.body.error.includes('DROP')),
      res.body.error
    );
  }

  // ── 14. Suggestions endpoint ────────────────────────
  console.log('\n--- 5. Schema Suggestions ---');
  {
    const res = await get('/api/query/suggestions');
    assert(
      'Dynamic query suggestions generated',
      res.body.success === true && Array.isArray(res.body.suggestions) && res.body.suggestions.length > 0,
      `Count: ${res.body.suggestions ? res.body.suggestions.length : 0}`
    );
  }

  // ── 15. Arbitrary Database Schema B Test ────────────
  console.log('\n--- 6. Arbitrary Schema Adaptability (Database B) ---');
  {
    // Test that the SLM generates correct SQL for Database B schema without hardcoding
    const { generateSQL } = require('./src/services/llmService');
    const { classifyIntent } = require('./src/services/intentService');

    const businessSchema = {
      tables: {
        customers: {
          columns: {
            id: 'integer',
            name: 'character varying',
            email: 'character varying',
            country: 'character varying',
            created_at: 'timestamp without time zone',
          },
          primaryKeys: ['id'],
        },
        orders: {
          columns: {
            id: 'integer',
            customer_id: 'integer',
            total_amount: 'numeric',
            status: 'character varying',
            order_date: 'timestamp without time zone',
          },
          primaryKeys: ['id'],
        },
        products: {
          columns: {
            id: 'integer',
            name: 'character varying',
            price: 'numeric',
            category: 'character varying',
          },
          primaryKeys: ['id'],
        },
      },
      relationships: [
        { from: 'orders.customer_id', to: 'customers.id' },
      ],
    };

    // Test B1: Total revenue
    const q1 = 'What is the total revenue from orders?';
    const intent1 = classifyIntent(q1, businessSchema);
    const sql1 = generateSQL(q1, businessSchema, intent1.intents);
    assert(
      'Database B: Total revenue on orders',
      sql1 && (sql1.includes('SUM(total_amount)') || sql1.includes('orders')),
      sql1
    );

    // Test B2: Products by category
    const q2 = 'Show average price for each category';
    const intent2 = classifyIntent(q2, businessSchema);
    const sql2 = generateSQL(q2, businessSchema, intent2.intents);
    assert(
      'Database B: Average price by category on products',
      sql2 && sql2.includes('GROUP BY category') && (sql2.includes('AVG(price)') || sql2.includes('price')),
      sql2
    );

    // Test B3: Top customers by spending
    const q3 = 'Show top 5 orders by amount';
    const intent3 = classifyIntent(q3, businessSchema);
    const sql3 = generateSQL(q3, businessSchema, intent3.intents);
    assert(
      'Database B: Top 5 orders by amount',
      sql3 && sql3.includes('ORDER BY total_amount DESC') && sql3.includes('LIMIT 5'),
      sql3
    );
  }

  console.log('\n' + '═'.repeat(60));
  console.log(`  RESULTS: ${passed} PASSED, ${failed} FAILED (TOTAL: ${passed + failed})`);
  console.log('═'.repeat(60));

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
