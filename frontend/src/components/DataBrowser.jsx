import { useEffect, useMemo, useState } from 'react';

const PAGE_SIZE = 24;

function shortType(type, primaryKey) {
  const value = String(type || 'text').toLowerCase();
  if (primaryKey && (value.includes('int') || value.includes('serial'))) return 'serial';
  if (value.includes('character varying') || value.includes('varchar')) return 'varchar';
  if (value.includes('timestamp') || value.includes('datetime')) return 'timestamp';
  if (value.includes('int')) return 'int';
  if (value.includes('numeric') || value.includes('decimal') || value.includes('double')) return 'numeric';
  if (value.includes('bool')) return 'bool';
  if (value.includes('text')) return 'text';
  return value.split(' ')[0] || 'text';
}

function cellText(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export default function DataBrowser({
  token,
  schema,
  databaseName,
  queryColumns,
  queryRows,
  queryTime,
  onAddRecord,
}) {
  const tableNames = schema?.tables ? Object.keys(schema.tables) : [];
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState('');
  const [tab, setTab] = useState('data');
  const [browse, setBrowse] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterText, setFilterText] = useState('');
  const [sort, setSort] = useState({ key: '', dir: 'asc' });
  const [hidden, setHidden] = useState({});
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [page, setPage] = useState(0);
  const [showQuery, setShowQuery] = useState(false);

  useEffect(() => {
    if (queryRows && queryColumns) {
      setShowQuery(true);
      setTab('data');
      setPage(0);
      setFilterText('');
      setSort({ key: '', dir: 'asc' });
    }
  }, [queryRows, queryColumns, queryTime]);

  useEffect(() => {
    if (!selected && tableNames.length > 0 && !showQuery) {
      setSelected(tableNames[0]);
    }
  }, [tableNames, selected, showQuery]);

  useEffect(() => {
    if (!selected || !token || showQuery) return undefined;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const res = await fetch(
          `http://localhost:5000/api/database/browse?table=${encodeURIComponent(selected)}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        const data = await res.json();
        if (cancelled) return;
        if (!data.success) {
          setError(data.error || 'Could not load this table.');
          setBrowse(null);
        } else {
          setBrowse(data);
          setPage(0);
        }
      } catch {
        if (!cancelled) setError('Could not load this table.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [selected, token, showQuery]);

  const sourceColumns = showQuery
    ? (queryColumns || []).map((name) => ({ name, type: 'text', primaryKey: false }))
    : (browse?.columns || []);

  const sourceRows = showQuery ? (queryRows || []) : (browse?.rows || []);
  const elapsed = showQuery ? queryTime : browse?.executionTime;

  const visibleColumns = sourceColumns.filter((col) => !hidden[col.name]);

  const filteredRows = useMemo(() => {
    const needle = filterText.trim().toLowerCase();
    let next = sourceRows;
    if (needle) {
      next = next.filter((row) =>
        sourceColumns.some((col) => String(row[col.name] ?? '').toLowerCase().includes(needle))
      );
    }
    if (sort.key) {
      next = [...next].sort((a, b) => {
        const av = a[sort.key];
        const bv = b[sort.key];
        if (av == null && bv == null) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        const cmp = String(av).localeCompare(String(bv), undefined, { numeric: true });
        return sort.dir === 'asc' ? cmp : -cmp;
      });
    }
    return next;
  }, [sourceRows, sourceColumns, filterText, sort]);

  const pageCount = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = filteredRows.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);
  const start = filteredRows.length === 0 ? 0 : safePage * PAGE_SIZE + 1;
  const end = Math.min(filteredRows.length, (safePage + 1) * PAGE_SIZE);
  const shownTables = tableNames.filter((name) => name.toLowerCase().includes(search.trim().toLowerCase()));
  const structure = !showQuery && schema?.tables?.[selected];

  const chooseTable = (name) => {
    setShowQuery(false);
    setSelected(name);
    setTab('data');
    setHidden({});
    setFilterText('');
    setSort({ key: '', dir: 'asc' });
  };

  return (
    <div className="neon-browser">
      <aside className="neon-side">
        <div className="neon-side-head">
          <strong>Tables</strong>
        </div>
        <div className="neon-db-row">{databaseName || 'database'}</div>
        <div className="neon-schema-row">Schema <span>public</span></div>
        <input
          className="neon-search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search..."
        />
        <ul className="neon-table-list">
          {shownTables.map((name) => (
            <li key={name}>
              <button
                type="button"
                className={name === selected && !showQuery ? 'active' : ''}
                onClick={() => chooseTable(name)}
              >
                <span className="neon-table-icon" />
                {name}
              </button>
            </li>
          ))}
          {shownTables.length === 0 && <li className="neon-empty">No tables</li>}
        </ul>
      </aside>

      <section className="neon-main">
        <div className="neon-toolbar">
          <div className="neon-tabs">
            <button type="button" className={tab === 'data' ? 'on' : ''} onClick={() => setTab('data')}>DATA</button>
            <button type="button" className={tab === 'structure' ? 'on' : ''} onClick={() => setTab('structure')}>STRUCTURE</button>
          </div>
          <div className="neon-pager">
            <button type="button" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={safePage === 0}>‹</button>
            <button type="button" onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))} disabled={safePage >= pageCount - 1}>›</button>
          </div>
          <button type="button" className="neon-tool" onClick={() => setFilterOpen((v) => !v)}>Filters</button>
          <button
            type="button"
            className="neon-tool"
            onClick={() => {
              const key = sort.key || visibleColumns[0]?.name;
              if (!key) return;
              setSort((current) => ({
                key,
                dir: current.key === key && current.dir === 'asc' ? 'desc' : 'asc',
              }));
            }}
          >
            Sort
          </button>
          <button type="button" className="neon-tool" onClick={() => setColumnsOpen((v) => !v)}>Columns</button>
          <button
            type="button"
            className="neon-add"
            onClick={() => onAddRecord && onAddRecord(showQuery ? '' : selected)}
            disabled={!selected && !showQuery}
          >
            + Add record
          </button>
        </div>

        {filterOpen && (
          <input
            className="neon-filter"
            value={filterText}
            onChange={(e) => { setFilterText(e.target.value); setPage(0); }}
            placeholder="Filter rows..."
          />
        )}
        {columnsOpen && (
          <div className="neon-col-picker">
            {sourceColumns.map((col) => (
              <label key={col.name}>
                <input
                  type="checkbox"
                  checked={!hidden[col.name]}
                  onChange={() => setHidden((current) => ({ ...current, [col.name]: !current[col.name] }))}
                />
                {col.name}
              </label>
            ))}
          </div>
        )}

        {error && <div className="neon-error">{error}</div>}
        {loading && <div className="neon-loading">Loading rows...</div>}

        {tab === 'structure' && structure && (
          <div className="neon-grid-wrap">
            <table className="neon-grid">
              <thead>
                <tr>
                  <th>column</th>
                  <th>type</th>
                  <th>key</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(structure.columns || {}).map(([name, type]) => (
                  <tr key={name}>
                    <td>{name}</td>
                    <td className="neon-type">{shortType(type, (structure.primaryKeys || []).includes(name))}</td>
                    <td>{(structure.primaryKeys || []).includes(name) ? 'primary' : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {tab === 'data' && !loading && (
          <div className="neon-grid-wrap">
            <table className="neon-grid">
              <thead>
                <tr>
                  <th className="neon-check" />
                  {visibleColumns.map((col) => (
                    <th key={col.name}>
                      <button
                        type="button"
                        className="neon-col-btn"
                        onClick={() => setSort((current) => ({
                          key: col.name,
                          dir: current.key === col.name && current.dir === 'asc' ? 'desc' : 'asc',
                        }))}
                      >
                        <span>{col.name}</span>
                        <span className="neon-type">{shortType(col.type, col.primaryKey)}</span>
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pageRows.map((row, index) => (
                  <tr key={`${safePage}-${index}`}>
                    <td className="neon-check"><input type="checkbox" aria-label="Select row" /></td>
                    {visibleColumns.map((col) => {
                      const text = cellText(row[col.name]);
                      return (
                        <td key={col.name} className={text === null ? 'neon-null' : ''}>
                          {text === null ? 'NULL' : text}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                {pageRows.length === 0 && (
                  <tr>
                    <td className="neon-empty" colSpan={Math.max(visibleColumns.length + 1, 1)}>No rows</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        <footer className="neon-footer">
          <span>{elapsed != null ? `${elapsed}ms` : ''}</span>
          <span>{start}–{end} of {filteredRows.length}</span>
        </footer>
      </section>
    </div>
  );
}
