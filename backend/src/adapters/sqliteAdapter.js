// ============================================
// SQLite Database Adapter
// ============================================
// Implements unified interface for SQLite databases.

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const MAX_RESULT_ROWS = 100;

class SqliteAdapter {
  constructor(rawUrl, options = {}) {
    this.rawUrl = rawUrl.trim();
    this.type = 'sqlite';
    this.name = 'SQLite';
    this.options = options;
    this.filePath = this.resolvePath();
    this.db = null;
  }

  resolvePath() {
    let clean = this.rawUrl;
    if (clean.startsWith('sqlite://')) {
      clean = clean.replace(/^sqlite:\/\//, '');
    } else if (clean.startsWith('sqlite:')) {
      clean = clean.replace(/^sqlite:/, '');
    }

    if (clean === ':memory:' || clean === '') {
      return ':memory:';
    }

    return path.resolve(clean);
  }

  getDb() {
    if (!this.db) {
      this.db = new sqlite3.Database(this.filePath);
    }
    return this.db;
  }

  parseDetails() {
    return {
      host: 'local',
      port: 'file',
      databaseName: path.basename(this.filePath) || 'sqlite.db',
    };
  }

  async testConnection() {
    const db = this.getDb();
    const details = this.parseDetails();

    return new Promise((resolve, reject) => {
      db.all(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name;",
        (err, rows) => {
          if (err) return reject(new Error(`SQLite connection failed: ${err.message}`));
          const tables = (rows || []).map((r) => r.name);
          resolve({
            ok: true,
            type: this.type,
            name: this.name,
            databaseName: details.databaseName,
            host: details.host,
            port: details.port,
            tableCount: tables.length,
            tables,
            version: '3.x',
          });
        }
      );
    });
  }

  async discoverSchema() {
    const db = this.getDb();

    return new Promise((resolve, reject) => {
      db.all(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name;",
        async (err, tableRows) => {
          if (err) return reject(err);

          const schema = {
            tables: {},
            relationships: [],
          };

          const tables = (tableRows || []).map((r) => r.name);

          for (const tableName of tables) {
            schema.tables[tableName] = {
              columns: {},
              primaryKeys: [],
            };

            await new Promise((resCol, rejCol) => {
              db.all(`PRAGMA table_info("${tableName}");`, (colErr, cols) => {
                if (colErr) return rejCol(colErr);
                for (const col of cols || []) {
                  schema.tables[tableName].columns[col.name] = (col.type || 'TEXT').toLowerCase();
                  if (col.pk > 0) {
                    schema.tables[tableName].primaryKeys.push(col.name);
                  }
                }
                resCol();
              });
            });

            await new Promise((resFk, rejFk) => {
              db.all(`PRAGMA foreign_key_list("${tableName}");`, (fkErr, fks) => {
                if (fkErr) return rejFk(fkErr);
                for (const fk of fks || []) {
                  schema.relationships.push({
                    from: `${tableName}.${fk.from}`,
                    to: `${fk.table}.${fk.to}`,
                  });
                }
                resFk();
              });
            });
          }

          resolve(schema);
        }
      );
    });
  }

  async executeQuery(sql, options = {}) {
    const db = this.getDb();
    const startTime = Date.now();

    return new Promise((resolve, reject) => {
      let isSettled = false;
      const timer = setTimeout(() => {
        if (!isSettled) {
          isSettled = true;
          try { db.interrupt(); } catch {}
          reject(new Error('Query execution timed out. The query took too long to execute.'));
        }
      }, 5000);

      db.all(sql, (err, rows) => {
        clearTimeout(timer);
        if (isSettled) return;
        isSettled = true;

        const executionTime = Date.now() - startTime;
        if (err) return reject(err);

        const allRows = rows || [];
        const columns = allRows.length > 0 ? Object.keys(allRows[0]) : [];
        let finalRows = allRows;
        let rowLimitApplied = false;

        if (finalRows.length > MAX_RESULT_ROWS) {
          finalRows = finalRows.slice(0, MAX_RESULT_ROWS);
          rowLimitApplied = true;
        }

        resolve({
          columns,
          rows: finalRows,
          executionTime,
          totalRows: allRows.length,
          rowCount: finalRows.length,
          affectedRows: finalRows.length,
          rowLimitApplied,
        });
      });
    });
  }

  async executeWrite(sql) {
    const db = this.getDb();
    return new Promise((resolve, reject) => {
      db.run(sql, function (err) {
        if (err) return reject(err);
        resolve({
          affectedRows: this.changes || 0,
          rowCount: this.changes || 0,
        });
      });
    });
  }

  async close() {
    if (this.db) {
      await new Promise((resolve) => this.db.close(() => resolve()));
      this.db = null;
    }
  }
}

module.exports = { SqliteAdapter };
