/**
 * Schema retrieval confidence tests.
 * Uses a fixture schema so the checks do not connect to a database.
 */
const { getRelevantSchema, shouldGenerateSQL } = require('./src/services/schemaService');
const { generateSQL } = require('./src/services/llmService');
const { classifyIntent } = require('./src/services/intentService');

const schema = {
  tables: {
    courses: {
      columns: { id: 'integer', course_name: 'varchar', department: 'varchar', credits: 'integer' },
      primaryKeys: ['id'],
    },
    database_connections: {
      columns: { id: 'integer', user_id: 'integer', connection_name: 'varchar', encrypted_url: 'text', created_at: 'timestamp' },
      primaryKeys: ['id'],
    },
    department: {
      columns: { id: 'integer', name: 'varchar' },
      primaryKeys: ['id'],
    },
    enrollments: {
      columns: { id: 'integer', student_id: 'integer', course_id: 'integer', grade: 'varchar' },
      primaryKeys: ['id'],
    },
    students: {
      columns: { id: 'integer', name: 'varchar', department: 'varchar', age: 'integer', mark: 'numeric' },
      primaryKeys: ['id'],
    },
    users: {
      columns: { id: 'integer', name: 'varchar', email: 'varchar', password_hash: 'varchar', created_at: 'timestamp' },
      primaryKeys: ['id'],
    },
  },
  relationships: [
    { from: 'enrollments.student_id', to: 'students.id' },
    { from: 'enrollments.course_id', to: 'courses.id' },
    { from: 'database_connections.user_id', to: 'users.id' },
  ],
};

const auditSchema = {
  tables: {
    ...schema.tables,
    audit_logs: {
      columns: { id: 'integer', action: 'varchar', details: 'text' },
      primaryKeys: ['id'],
    },
  },
  relationships: schema.relationships,
};

let failed = 0;

function check(name, condition, detail) {
  if (condition) {
    console.log(`PASS  ${name}`);
    return;
  }
  failed += 1;
  console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
}

function decide(question, source = schema) {
  const retrieval = getRelevantSchema(question, source);
  let sql = null;
  if (shouldGenerateSQL(retrieval)) {
    const intent = classifyIntent(question, source);
    sql = generateSQL(
      question,
      { tables: retrieval.tables, relationships: retrieval.relationships },
      intent.intents,
      'postgres',
    );
  }
  return { retrieval, sql };
}

const studentsMark = decide('Show students with marks above 80');
check('students mark status', studentsMark.retrieval.status === 'FOUND', studentsMark.retrieval.status);
check('students mark table', studentsMark.retrieval.matchedTables.includes('students'), studentsMark.retrieval.matchedTables.join(','));
check('students mark sql', /FROM students/i.test(studentsMark.sql || '') && /mark\s*>\s*80/i.test(studentsMark.sql || ''), studentsMark.sql);
check('students mark hides app tables', !studentsMark.retrieval.tables.users && !studentsMark.retrieval.tables.database_connections);

const average = decide('What is the average mark?');
check('average status', average.retrieval.status === 'FOUND', average.retrieval.status);
check('average table', average.retrieval.matchedTables.includes('students'), average.retrieval.matchedTables.join(','));
check('average sql', /AVG\(mark\)/i.test(average.sql || '') && /FROM students/i.test(average.sql || ''), average.sql);

const departments = decide('How many departments are there?');
check('departments status', departments.retrieval.status === 'FOUND', departments.retrieval.status);
check('departments table', departments.retrieval.matchedTables.includes('department'), departments.retrieval.matchedTables.join(','));
check('departments sql', /COUNT\(\*\)/i.test(departments.sql || '') && /FROM department/i.test(departments.sql || ''), departments.sql);

const enrolled = decide('Show students enrolled in each course');
check('enrolled status', enrolled.retrieval.status === 'FOUND', enrolled.retrieval.status);
check(
  'enrolled tables',
  ['students', 'courses'].every((table) => enrolled.retrieval.matchedTables.includes(table))
    && enrolled.retrieval.relatedTables.includes('enrollments'),
  `matched=${enrolled.retrieval.matchedTables.join(',')} related=${enrolled.retrieval.relatedTables.join(',')}`,
);
check('enrolled sql', /JOIN/i.test(enrolled.sql || '') && /students/i.test(enrolled.sql || '') && /courses/i.test(enrolled.sql || ''), enrolled.sql);

const vendors = decide('List vendors');
check('vendors status', vendors.retrieval.status === 'NOT_FOUND', vendors.retrieval.status);
check('vendors no sql', vendors.sql === null, vendors.sql);
check('vendors no schema', Object.keys(vendors.retrieval.tables).length === 0);
check('vendors message', /vendors/i.test(vendors.retrieval.message), vendors.retrieval.message);

const audit = decide('Show audit logs');
check('audit status', audit.retrieval.status === 'NOT_FOUND', audit.retrieval.status);
check('audit no sql', audit.sql === null, audit.sql);
check('audit message', /audit logs/i.test(audit.retrieval.message), audit.retrieval.message);

const duplicates = decide('Find duplicate names');
check('duplicates status', duplicates.retrieval.status === 'AMBIGUOUS', duplicates.retrieval.status);
check('duplicates no sql', duplicates.sql === null, duplicates.sql);
check(
  'duplicates options',
  ['students', 'users', 'department', 'courses', 'database_connections'].every((table) => duplicates.retrieval.matchedTables.includes(table)),
  duplicates.retrieval.matchedTables.join(','),
);
check('duplicates message', /name/i.test(duplicates.retrieval.message) && /which table/i.test(duplicates.retrieval.message), duplicates.retrieval.message);

const followUp = decide('Find duplicate names in students');
check('follow-up status', followUp.retrieval.status === 'FOUND', followUp.retrieval.status);
check('follow-up table', followUp.retrieval.matchedTables.includes('students') && followUp.retrieval.matchedTables.length === 1, followUp.retrieval.matchedTables.join(','));
check('follow-up sql', /FROM students/i.test(followUp.sql || ''), followUp.sql);

const overview = decide('What tables are in my database?');
check('overview status', overview.retrieval.status === 'GENERAL_SCHEMA', overview.retrieval.status);
check('overview confidence', overview.retrieval.confidence === 1);
check('overview full schema', overview.retrieval.matchedTables.length === 6, overview.retrieval.matchedTables.join(','));
check('overview no guessed sql', overview.sql === null, overview.sql);

const allStudents = decide('Show all students');
check('all students status', allStudents.retrieval.status === 'FOUND');
check('all students sql', /FROM students/i.test(allStudents.sql || ''), allStudents.sql);

const allCourses = decide('Show all courses');
check('all courses status', allCourses.retrieval.status === 'FOUND');
check('all courses sql', /FROM courses/i.test(allCourses.sql || ''), allCourses.sql);

const auditForms = ['Show audit logs', 'Show audit log', 'Show audit_logs', 'Show AuditLogs'];
for (const question of auditForms) {
  const result = decide(question, auditSchema);
  check(`normalization ${question}`, result.retrieval.status === 'FOUND' && result.retrieval.matchedTables.includes('audit_logs'), `${result.retrieval.status} ${result.retrieval.matchedTables.join(',')}`);
}

if (failed > 0) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}

console.log('\nAll schema retrieval checks passed');
