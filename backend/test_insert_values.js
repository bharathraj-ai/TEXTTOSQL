/**
 * Natural-language INSERT value mapping.
 * Uses a fixture schema and does not connect to a database.
 */
const { generateMutationPlan } = require('./src/services/mutationService');
const { classifyQuery, QUERY_CATEGORIES } = require('./src/services/queryClassifier');

const vendorsSchema = {
  tables: {
    vendors: {
      columns: {
        id: 'integer',
        name: 'character varying',
        category: 'character varying',
        contract_value: 'numeric',
        contact_email: 'character varying',
        created_at: 'timestamp without time zone',
      },
      nullable: {
        id: false,
        name: false,
        category: false,
        contract_value: false,
        contact_email: false,
        created_at: false,
      },
      defaults: {
        id: "nextval('vendors_id_seq'::regclass)",
        created_at: 'CURRENT_TIMESTAMP',
      },
      identity: { id: true },
      primaryKeys: ['id'],
    },
  },
  relationships: [],
};

const nullableNameSchema = {
  tables: {
    vendors: {
      ...vendorsSchema.tables.vendors,
      nullable: {
        ...vendorsSchema.tables.vendors.nullable,
        name: true,
      },
    },
  },
  relationships: [],
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

function plan(question, schema = vendorsSchema) {
  return generateMutationPlan(question, schema, 'postgres');
}

function valuesOf(question, schema) {
  return plan(question, schema).columnValues;
}

const scopedSchema = {
  tables: {
    ...vendorsSchema.tables,
    students: {
      columns: { id: 'integer', name: 'character varying', mark: 'numeric' },
      primaryKeys: ['id'],
    },
  },
  relationships: [],
};
const defaultedValueSchema = {
  tables: {
    vendors: {
      ...vendorsSchema.tables.vendors,
      nullable: {
        ...vendorsSchema.tables.vendors.nullable,
        category: true,
        contract_value: true,
        contact_email: true,
        created_at: true,
      },
      defaults: {
        id: "nextval('vendors_id_seq'::regclass)",
        contract_value: '0',
        created_at: 'now()',
      },
    },
  },
  relationships: [],
};
const withDefault = valuesOf('insert the row of msi, msi office 1 cr, bharathraj@gmail.com from vendors', defaultedValueSchema);
check('defaulted amount still mapped', withDefault.name === 'MSI' && withDefault.category === 'MSI Office' && withDefault.contract_value === 10000000 && withDefault.contact_email === 'bharathraj@gmail.com' && !('created_at' in withDefault) && !('id' in withDefault), JSON.stringify(withDefault));

const scoped = valuesOf('insert the row of msi, msi office 1 cr, bharathraj@gmail.com from vendors', scopedSchema);
check('scoped table values', scoped.name === 'MSI' && scoped.category === 'MSI Office' && scoped.contract_value === 10000000 && scoped.contact_email === 'bharathraj@gmail.com', JSON.stringify(scoped));

const row = valuesOf('insert the row of msi, msi office 1 cr, bharathraj@gmail.com');
check('test 1 name', row.name === 'MSI', JSON.stringify(row));
check('test 1 category', row.category === 'MSI Office', JSON.stringify(row));
check('test 1 amount', row.contract_value === 10000000, JSON.stringify(row));
check('test 1 email', row.contact_email === 'bharathraj@gmail.com', JSON.stringify(row));
check('test 1 skips id', !('id' in row) && !('created_at' in row), JSON.stringify(row));
const rowSql = plan('insert the row of msi, msi office 1 cr, bharathraj@gmail.com').sql;
check('test 1 sql', /INSERT INTO vendors/i.test(rowSql) && /10000000/.test(rowSql) && /bharathraj@gmail.com/.test(rowSql) && !/'The'/.test(rowSql), rowSql);

const explicit = valuesOf('add vendor named Dell, category Hardware, contract value 500000, email dell@example.com');
check('test 2 name', explicit.name === 'Dell', JSON.stringify(explicit));
check('test 2 category', explicit.category === 'Hardware', JSON.stringify(explicit));
check('test 2 amount', explicit.contract_value === 500000, JSON.stringify(explicit));
check('test 2 email', explicit.contact_email === 'dell@example.com', JSON.stringify(explicit));

const crore = valuesOf('insert MSI, MSI Office, 1 crore, bharathraj@gmail.com');
check('test 3 amount', crore.contract_value === 10000000 && crore.name === 'MSI' && crore.category === 'MSI Office', JSON.stringify(crore));

const quoted = valuesOf('insert vendor name "MSI", category "MSI Office", contract value "1 crore", contact email "bharathraj@gmail.com"');
check('test 4 quoted', quoted.name === 'MSI' && quoted.category === 'MSI Office' && quoted.contract_value === 10000000 && quoted.contact_email === 'bharathraj@gmail.com', JSON.stringify(quoted));

let missingMessage = '';
try {
  plan('add MSI to vendors');
} catch (err) {
  missingMessage = err.message;
}
check('test 5 no sql', /missing/i.test(missingMessage) && /category/.test(missingMessage) && /contract_value/.test(missingMessage) && /contact_email/.test(missingMessage), missingMessage);

const nullRow = valuesOf('insert NULL, Hardware, 500000, test@example.com', nullableNameSchema);
check('test 6 null', nullRow.name === null && nullRow.category === 'Hardware' && nullRow.contract_value === 500000, JSON.stringify(nullRow));
check('test 6 sql null', /\bNULL\b/.test(plan('insert NULL, Hardware, 500000, test@example.com', nullableNameSchema).sql));

let rejectedNull = '';
try {
  plan('insert NULL, Hardware, 500000, test@example.com');
} catch (err) {
  rejectedNull = err.message;
}
check('test 6 rejects null name', /does not allow NULL/i.test(rejectedNull), rejectedNull);

const student = plan('add a student named Rahul with mark 85', {
  tables: {
    students: {
      columns: { id: 'integer', name: 'character varying', mark: 'numeric', department: 'character varying' },
      primaryKeys: ['id'],
    },
  },
  relationships: [],
});
check('existing student insert', student.targetTable === 'students' && /Rahul/.test(student.sql) && /85/.test(student.sql), student.sql);

const lakh = parseAmount('5 lakh');
function parseAmount(text) {
  return valuesOf(`insert MSI, Hardware, ${text}, a@b.com`).contract_value;
}
const axusQuestion = 'add row of axus , axus office , 1 lakh,bharathraj999@gmail.com';
check('add row classified as modification', classifyQuery(axusQuestion).category === QUERY_CATEGORIES.DATABASE_MODIFICATION, classifyQuery(axusQuestion).category);
const axus = valuesOf(`${axusQuestion} from vendors`);
check('add row name', axus.name === 'AXUS', JSON.stringify(axus));
check('add row category', axus.category === 'AXUS Office', JSON.stringify(axus));
check('add row lakh', axus.contract_value === 100000, JSON.stringify(axus));
check('add row email', axus.contact_email === 'bharathraj999@gmail.com', JSON.stringify(axus));

check('5 lakh', parseAmount('5 lakh') === 500000, String(parseAmount('5 lakh')));
check('2.5 crore', parseAmount('2.5 crore') === 25000000, String(parseAmount('2.5 crore')));

if (failed > 0) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log('\nAll insert value checks passed');
