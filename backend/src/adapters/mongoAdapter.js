// ============================================
// MongoDB Database Adapter
// ============================================
// Implements unified interface for MongoDB (NoSQL).
// Samples collections to infer schema, supports find & aggregate queries,
// and transforms JSON documents into standardized tabular results.

const { MongoClient, ObjectId } = require('mongodb');

const QUERY_TIMEOUT_MS = 5000;
const MAX_RESULT_ROWS = 100;

class MongoAdapter {
  constructor(rawUrl, options = {}) {
    this.rawUrl = rawUrl.trim();
    this.type = 'mongodb';
    this.name = 'MongoDB';
    this.options = options;
    this.client = null;
    this.databaseName = this.extractDatabaseName();
  }

  extractDatabaseName() {
    try {
      const parsed = new URL(this.rawUrl);
      const name = parsed.pathname ? parsed.pathname.replace(/^\//, '').split('?')[0] : '';
      return name || 'admin';
    } catch {
      const match = this.rawUrl.match(/\/([^/?]+)(?:\?|$)/);
      return match ? match[1] : 'admin';
    }
  }

  async getClient() {
    if (!this.client) {
      this.client = new MongoClient(this.rawUrl, {
        serverSelectionTimeoutMS: 7000,
        connectTimeoutMS: 7000,
      });
      await this.client.connect();
    }
    return this.client;
  }

  parseDetails() {
    try {
      const parsed = new URL(this.rawUrl);
      return {
        host: parsed.hostname || 'cluster',
        port: parsed.port || (this.rawUrl.startsWith('mongodb+srv') ? 'srv' : '27017'),
        databaseName: this.databaseName,
      };
    } catch {
      return { host: 'mongodb-host', port: '27017', databaseName: this.databaseName };
    }
  }

  async testConnection() {
    const client = await this.getClient();
    const db = client.db(this.databaseName);

    // Ping
    await db.command({ ping: 1 });

    // List collections
    const collections = await db.listCollections().toArray();
    const collectionNames = collections
      .map((c) => c.name)
      .filter((name) => !name.startsWith('system.'));

    const details = this.parseDetails();

    return {
      ok: true,
      type: this.type,
      name: this.name,
      databaseName: this.databaseName,
      host: details.host,
      port: details.port,
      tableCount: collectionNames.length,
      tables: collectionNames,
      version: 'MongoDB 6.x/7.x',
    };
  }

  async discoverSchema() {
    const client = await this.getClient();
    const db = client.db(this.databaseName);

    const collections = await db.listCollections().toArray();
    const collectionNames = collections
      .map((c) => c.name)
      .filter((name) => !name.startsWith('system.'));

    const schema = {
      tables: {},
      relationships: [],
    };

    for (const colName of collectionNames) {
      schema.tables[colName] = {
        columns: { _id: 'string' },
        primaryKeys: ['_id'],
      };

      try {
        const col = db.collection(colName);
        // Sample documents to infer fields
        const sampleDocs = await col.find({}).limit(15).toArray();

        for (const doc of sampleDocs) {
          for (const [key, value] of Object.entries(doc)) {
            if (!schema.tables[colName].columns[key]) {
              schema.tables[colName].columns[key] = this.inferType(value);
            }
          }
        }
      } catch (err) {
        console.warn(`[MONGO] Could not sample collection ${colName}:`, err.message);
      }
    }

    // Infer potential relationships based on *_id field naming
    for (const [colName, info] of Object.entries(schema.tables)) {
      for (const field of Object.keys(info.columns)) {
        if (field.endsWith('_id') && field !== '_id') {
          const targetEntity = field.replace(/_id$/, '');
          // Check if target entity exists as collection or plural collection
          const candidates = [targetEntity, `${targetEntity}s`, `${targetEntity}es`];
          for (const cand of candidates) {
            if (schema.tables[cand] && cand !== colName) {
              schema.relationships.push({
                from: `${colName}.${field}`,
                to: `${cand}._id`,
              });
              break;
            }
          }
        }
      }
    }

    return schema;
  }

  inferType(val) {
    if (val === null || val === undefined) return 'character varying';
    if (val instanceof ObjectId) return 'string';
    if (val instanceof Date) return 'timestamp without time zone';
    if (typeof val === 'number') {
      return Number.isInteger(val) ? 'integer' : 'numeric';
    }
    if (typeof val === 'boolean') return 'boolean';
    if (Array.isArray(val)) return 'array';
    if (typeof val === 'object') return 'jsonb';
    return 'character varying';
  }

  /**
   * Execute a MongoDB query (find, aggregate, count)
   * Query can be:
   * 1. Structured query object: { collection, action, filter, projection, sort, limit, pipeline }
   * 2. Raw MQL string e.g. "db.students.find({ mark: { $gt: 80 } }).sort({ mark: -1 })"
   */
  async executeQuery(queryInput, options = {}) {
    const startTime = Date.now();
    const client = await this.getClient();
    const db = client.db(this.databaseName);

    const parsedQuery = typeof queryInput === 'string'
      ? this.parseMqlString(queryInput)
      : queryInput;

    const { collection: colName, action, filter = {}, sort = {}, limit = MAX_RESULT_ROWS, pipeline = [] } = parsedQuery;

    if (!colName) {
      throw new Error('MongoDB query must specify a target collection.');
    }

    const col = db.collection(colName);
    let rawDocs = [];

    if (action === 'aggregate' || pipeline.length > 0) {
      // Ensure read-only by validating aggregation stages
      const forbiddenStages = ['$out', '$merge'];
      for (const stage of pipeline) {
        const stageOp = Object.keys(stage)[0];
        if (forbiddenStages.includes(stageOp)) {
          throw new Error(`Security restriction: Aggregation stage "${stageOp}" is not permitted.`);
        }
      }

      // Add safety limit stage if not present
      const safePipeline = [...pipeline];
      const hasLimit = safePipeline.some((s) => s.$limit !== undefined);
      if (!hasLimit) {
        safePipeline.push({ $limit: MAX_RESULT_ROWS });
      }

      rawDocs = await col.aggregate(safePipeline, { maxTimeMS: QUERY_TIMEOUT_MS }).toArray();

    } else if (action === 'count' || action === 'countDocuments') {
      const count = await col.countDocuments(filter, { maxTimeMS: QUERY_TIMEOUT_MS });
      rawDocs = [{ count }];

    } else {
      // Standard find
      const cursor = col.find(filter, { maxTimeMS: QUERY_TIMEOUT_MS });
      if (Object.keys(sort).length > 0) {
        cursor.sort(sort);
      }
      cursor.limit(Math.min(limit || MAX_RESULT_ROWS, MAX_RESULT_ROWS));
      rawDocs = await cursor.toArray();
    }

    const executionTime = Date.now() - startTime;

    // Transform docs to standardized tabular rows and columns
    const columnsSet = new Set();
    for (const doc of rawDocs) {
      for (const k of Object.keys(doc)) {
        columnsSet.add(k);
      }
    }

    const columns = Array.from(columnsSet);
    const rows = rawDocs.map((doc) => {
      const row = {};
      for (const col of columns) {
        const val = doc[col];
        if (val === undefined || val === null) {
          row[col] = null;
        } else if (val instanceof ObjectId) {
          row[col] = val.toString();
        } else if (val instanceof Date) {
          row[col] = val.toISOString();
        } else if (typeof val === 'object') {
          row[col] = JSON.stringify(val);
        } else {
          row[col] = val;
        }
      }
      return row;
    });

    let limitedRows = rows;
    let rowLimitApplied = false;
    if (limitedRows.length > MAX_RESULT_ROWS) {
      limitedRows = limitedRows.slice(0, MAX_RESULT_ROWS);
      rowLimitApplied = true;
    }

    return {
      columns,
      rows: limitedRows,
      executionTime,
      totalRows: rows.length,
      rowCount: limitedRows.length,
      rowLimitApplied,
    };
  }

  /**
   * Parse a string like "db.students.find({ mark: { $gt: 80 } }).sort({ mark: -1 }).limit(10)"
   * into a structured query object.
   */
  parseMqlString(mql) {
    const trimmed = mql.trim();

    // Check for aggregate: db.col.aggregate([...])
    const aggMatch = trimmed.match(/^db\.(\w+)\.aggregate\(\s*(\[[\s\S]*\])\s*\)/i);
    if (aggMatch) {
      try {
        const pipeline = JSON.parse(this.cleanJson(aggMatch[2]));
        return { collection: aggMatch[1], action: 'aggregate', pipeline };
      } catch {
        return { collection: aggMatch[1], action: 'aggregate', pipeline: [] };
      }
    }

    // Check for count: db.col.countDocuments(...)
    const countMatch = trimmed.match(/^db\.(\w+)\.(?:countDocuments|count)\(\s*(\{[\s\S]*\}|)\s*\)/i);
    if (countMatch) {
      try {
        const filter = countMatch[2] ? JSON.parse(this.cleanJson(countMatch[2])) : {};
        return { collection: countMatch[1], action: 'count', filter };
      } catch {
        return { collection: countMatch[1], action: 'count', filter: {} };
      }
    }

    // Check for find: db.col.find(...)
    const findMatch = trimmed.match(/^db\.(\w+)\.find\(\s*(\{[\s\S]*?\}|)\s*\)/i);
    if (findMatch) {
      const collection = findMatch[1];
      let filter = {};
      let sort = {};
      let limit = MAX_RESULT_ROWS;

      if (findMatch[2]) {
        try {
          filter = JSON.parse(this.cleanJson(findMatch[2]));
        } catch {}
      }

      // Check for .sort(...)
      const sortMatch = trimmed.match(/\.sort\(\s*(\{[\s\S]*?\})\s*\)/);
      if (sortMatch) {
        try {
          sort = JSON.parse(this.cleanJson(sortMatch[1]));
        } catch {}
      }

      // Check for .limit(...)
      const limitMatch = trimmed.match(/\.limit\(\s*(\d+)\s*\)/);
      if (limitMatch) {
        limit = parseInt(limitMatch[1], 10);
      }

      return { collection, action: 'find', filter, sort, limit };
    }

    // Default fallback
    const firstWordMatch = trimmed.match(/^db\.(\w+)/);
    const colName = firstWordMatch ? firstWordMatch[1] : 'items';
    return { collection: colName, action: 'find', filter: {}, sort: {}, limit: 100 };
  }

  cleanJson(str) {
    // Allows unquoted keys in basic MQL representation
    return str
      .replace(/([{,]\s*)([a-zA-Z0-9_$]+)\s*:/g, '$1"$2":')
      .replace(/'/g, '"');
  }

  async close() {
    if (this.client) {
      await this.client.close().catch(() => {});
      this.client = null;
    }
  }
}

module.exports = { MongoAdapter };
