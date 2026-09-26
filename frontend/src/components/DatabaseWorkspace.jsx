import { useCallback, useEffect, useState } from 'react';

const API = 'http://localhost:5000/api';

function rowKey(row, primaryKeys) {
  if (!primaryKeys?.length) return JSON.stringify(row);
  return primaryKeys.map((key) => row[key]).join('|');
}

export default function DatabaseWorkspace({ token, dbStatus, onAuthError }) {
  const [schema, setSchema] = useState(null);
  const [selected, setSelected] = useState('');
  const [tab, setTab] = useState('data');
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState('');
  const [dir, setDir] = useState('asc');
  const [filter, setFilter] = useState('');
  const [tableData, setTableData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [drafts, setDrafts] = useState({});
  const [editing, setEditing] = useState(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addValues, setAddValues] = useState({});
  const [menu, setMenu] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [chat, setChat] = useState('');
  const [messages, setMessages] = useState([]);
  const [pending, setPending] = useState(null);
  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState('');
  const [queryView, setQueryView] = useState(null);
  const [selectedRow, setSelectedRow] = useState('');

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };

  const loadSchema = useCallback(async () => {
    const res = await fetch(`${API}/database/schema`, { headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json();
    if (res.status === 401) {
      onAuthError?.(data.error);
      return;
    }
    if (data.success) {
      setSchema(data.schema);
      const names = Object.keys(data.schema?.tables || {});
      setSelected((current) => current || names[0] || '');
    }
  }, [token, onAuthError]);

  const loadTable = useCallback(async (tableName = selected, nextPage = page) => {
    if (!tableName) return;
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({
        page: String(nextPage),
        limit: '50',
        sort,
        dir,
        q: filter,
      });
      if (dbStatus.connectionId) params.set('connectionId', String(dbStatus.connectionId));
      const res = await fetch(`${API}/database/tables/${encodeURIComponent(tableName)}?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!data.success) {
        setError(data.error || 'Could not load this table.');
        setTableData(null);
      } else {
        setTableData(data);
        setQueryView(null);
      }
    } catch {
      setError('Could not load this table.');
    } finally {
      setLoading(false);
    }
  }, [selected, page, sort, dir, filter, token, dbStatus.connectionId]);

  useEffect(() => { loadSchema(); }, [loadSchema]);
  useEffect(() => { if (selected) loadTable(selected, page); }, [selected, page, sort, dir]);

  const columns = queryView?.columns || tableData?.columns || [];
  const rows = queryView?.rows || tableData?.rows || [];
  const primaryKeys = tableData?.primaryKeys || columns.filter((col) => col.primaryKey).map((col) => col.name);
  const structure = schema?.tables?.[selected];
  const total = queryView ? queryView.rows.length : (tableData?.total || 0);
  const limit = tableData?.limit || 50;
  const pageCount = Math.max(1, Math.ceil(total / limit));

  const saveDrafts = async () => {
    setBusy('Saving...');
    setError('');
    try {
      for (const [key, draft] of Object.entries(drafts)) {
        const row = rows.find((item) => rowKey(item, primaryKeys) === key);
        if (!row) continue;
        const primaryKey = {};
        primaryKeys.forEach((col) => { primaryKey[col] = row[col]; });
        const res = await fetch(`${API}/database/rows`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            connectionId: dbStatus.connectionId,
            action: 'update',
            table: selected,
            primaryKey,
            changes: draft.changes,
          }),
        });
        const data = await res.json();
        if (!data.success) throw new Error(data.error || 'Save failed.');
      }
      setDrafts({});
      setEditing(null);
      await loadTable(selected, page);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  };

  const insertRow = async () => {
    setBusy('Inserting...');
    setError('');
    try {
      const res = await fetch(`${API}/database/rows`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          connectionId: dbStatus.connectionId,
          action: 'insert',
          table: selected,
          values: addValues,
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Insert failed.');
      setAddOpen(false);
      setAddValues({});
      await loadTable(selected, 1);
      setPage(1);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  };

  const deleteRow = async () => {
    if (!deleteTarget) return;
    setBusy('Deleting...');
    setError('');
    try {
      const primaryKey = {};
      primaryKeys.forEach((col) => { primaryKey[col] = deleteTarget[col]; });
      const res = await fetch(`${API}/database/rows`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          connectionId: dbStatus.connectionId,
          action: 'delete',
          table: selected,
          primaryKey,
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Delete failed.');
      setDeleteTarget(null);
      await loadTable(selected, page);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  };

  const askVendor = async (event) => {
    event?.preventDefault();
    const query = chat.trim();
    if (!query || busy) return;
    setChat('');
    setMessages((list) => [...list, { role: 'you', text: query }]);
    setBusy('Understanding request...');
    setError('');
    try {
      const res = await fetch(`${API}/query`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          query,
          currentTable: selected,
          connectionId: dbStatus.connectionId,
        }),
      });
      const data = await res.json();
      if (data.type === 'conversation') {
        setMessages((list) => [...list, { role: 'vendor', text: data.message }]);
        setBusy('');
        return;
      }
      if (data.type === 'confirmation_required') {
        setPending(data);
        setConfirmText('');
        setMessages((list) => [...list, {
          role: 'vendor',
          text: `${data.intent} on ${data.targetTable || selected}. ${data.estimatedRows != null ? `${data.estimatedRows} row(s). ` : ''}Confirm before the database changes.`,
        }]);
        setBusy('');
        return;
      }
      if (!data.success || data.type === 'operation_blocked' || data.type === 'no_match' || data.type === 'needs_disambiguation' || data.type === 'validation_error') {
        setMessages((list) => [...list, { role: 'vendor', text: data.error || data.review?.reason || 'The request was blocked. No database changes were made.' }]);
        setBusy('');
        return;
      }
      if (data.type === 'query_result') {
        setQueryView({
          columns: (data.columns || []).map((name) => ({ name, type: 'text', primaryKey: false })),
          rows: data.rows || [],
        });
        setMessages((list) => [...list, { role: 'vendor', text: `${data.rowCount ?? data.rows?.length ?? 0} rows returned.` }]);
      }
    } catch {
      setMessages((list) => [...list, { role: 'vendor', text: 'The request could not be completed.' }]);
    } finally {
      setBusy('');
    }
  };

  const confirmPending = async () => {
    if (!pending?.operationId) return;
    if (pending.confirmPhrase && confirmText.trim().toLowerCase() !== pending.confirmPhrase.toLowerCase()) {
      setError(`Type "${pending.confirmPhrase}" to confirm.`);
      return;
    }
    setBusy('Executing...');
    try {
      const res = await fetch(`${API}/query/confirm`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          operationId: pending.operationId,
          confirmationText: confirmText,
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'The database was not changed.');
      setMessages((list) => [...list, { role: 'vendor', text: data.message || 'Database updated.' }]);
      setPending(null);
      setConfirmText('');
      await loadSchema();
      await loadTable(selected, page);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  };

  const unsaved = Object.entries(drafts);

  return (
    <div className="workspace">
      <header className="workspace-top">
        <strong>@vendor</strong>
        <span className="workspace-db"><i /> {dbStatus.databaseName || 'Database'}</span>
      </header>
      <div className="workspace-body">
        <aside className="workspace-tables">
          <div className="workspace-label">TABLES</div>
          <div className="workspace-db-name">▾ {dbStatus.databaseName || 'Database'}</div>
          <ul>
            {Object.keys(schema?.tables || {}).map((name) => (
              <li key={name}>
                <button
                  type="button"
                  className={name === selected && !queryView ? 'active' : ''}
                  onClick={() => { setSelected(name); setPage(1); setQueryView(null); setTab('data'); setDrafts({}); }}
                >
                  {name}
                </button>
              </li>
            ))}
          </ul>
        </aside>
        <section className="workspace-main">
          <div className="workspace-title-row">
            <h2>{queryView ? 'Query result' : (selected || 'Table')}</h2>
            <div className="workspace-tabs">
              <button type="button" className={tab === 'data' ? 'on' : ''} onClick={() => setTab('data')}>Data</button>
              <button type="button" className={tab === 'structure' ? 'on' : ''} onClick={() => setTab('structure')}>Structure</button>
            </div>
            <button type="button" className="workspace-refresh" onClick={() => { setQueryView(null); loadTable(selected, page); }}>Refresh</button>
            <button type="button" className="workspace-add" onClick={() => setAddOpen(true)}>+ Add Row</button>
          </div>

          <div className="workspace-tools">
            <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter" />
            <button type="button" onClick={() => { setPage(1); loadTable(selected, 1); }}>Apply</button>
            <span>{loading ? 'Loading...' : `${total} rows`}</span>
            <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Prev</button>
            <span>{page} / {pageCount}</span>
            <button type="button" disabled={page >= pageCount} onClick={() => setPage((p) => p + 1)}>Next</button>
          </div>

          {error && <div className="workspace-error">{error}</div>}
          {busy && <div className="workspace-busy">{busy}</div>}

          {unsaved.length > 0 && (
            <div className="workspace-unsaved">
              <strong>Unsaved change</strong>
              {unsaved.map(([key, draft]) => (
                <div key={key}>
                  {Object.entries(draft.changes).map(([col, value]) => (
                    <span key={col}>{col}: {draft.original[col]} → {value}</span>
                  ))}
                </div>
              ))}
              <button type="button" onClick={() => { setDrafts({}); setEditing(null); }}>Cancel</button>
              <button type="button" onClick={saveDrafts}>Save</button>
            </div>
          )}

          {tab === 'structure' && structure && (
            <div className="workspace-scroll">
              <table className="workspace-grid">
                <thead>
                  <tr><th>Column</th><th>Type</th><th>Nullable</th><th>Key</th></tr>
                </thead>
                <tbody>
                  {Object.entries(structure.columns || {}).map(([name, type]) => (
                    <tr key={name}>
                      <td>{name}</td>
                      <td>{type}</td>
                      <td>{structure.nullable?.[name] === false ? 'NO' : 'YES'}</td>
                      <td>{(structure.primaryKeys || []).includes(name) ? 'PK' : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {tab === 'data' && (
            <div className="workspace-scroll">
              <table className="workspace-grid">
                <thead>
                  <tr>
                    {columns.map((col) => (
                      <th key={col.name}>
                        <button
                          type="button"
                          onClick={() => {
                            setDir(sort === col.name && dir === 'asc' ? 'desc' : 'asc');
                            setSort(col.name);
                          }}
                        >
                          {col.name}
                        </button>
                      </th>
                    ))}
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const key = rowKey(row, primaryKeys);
                    return (
                      <tr key={key} className={selectedRow === key ? 'selected' : ''} onClick={() => setSelectedRow(key)}>
                        {columns.map((col) => {
                          const shown = drafts[key]?.changes?.[col.name] ?? row[col.name];
                          const isEdit = editing?.key === key && editing?.col === col.name;
                          return (
                            <td key={col.name} onClick={() => !col.primaryKey && !queryView && setEditing({ key, col: col.name, value: shown ?? '' })}>
                              {isEdit ? (
                                <input
                                  value={editing.value}
                                  autoFocus
                                  onChange={(e) => setEditing({ ...editing, value: e.target.value })}
                                  onBlur={() => {
                                    if (String(editing.value) !== String(row[col.name] ?? '')) {
                                      setDrafts((current) => ({
                                        ...current,
                                        [key]: {
                                          original: { ...(current[key]?.original || {}), [col.name]: row[col.name] },
                                          changes: { ...(current[key]?.changes || {}), [col.name]: editing.value },
                                        },
                                      }));
                                    }
                                    setEditing(null);
                                  }}
                                />
                              ) : (shown === null || shown === undefined ? 'NULL' : String(shown))}
                            </td>
                          );
                        })}
                        <td>
                          <button type="button" onClick={() => setMenu(menu === key ? null : key)}>⋮</button>
                          {menu === key && (
                            <div className="workspace-menu">
                              <button type="button" onClick={() => { setEditing({ key, col: columns.find((col) => !col.primaryKey)?.name, value: '' }); setMenu(null); }}>Edit</button>
                              <button type="button" onClick={() => { setDeleteTarget(row); setMenu(null); }}>Delete</button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {rows.length === 0 && !loading && (
                    <tr><td colSpan={Math.max(columns.length + 1, 1)}>No rows</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {addOpen && (
            <div className="workspace-panel">
              <strong>Add row to {selected}</strong>
              {(columns.length ? columns : Object.keys(structure?.columns || {}).map((name) => ({ name, primaryKey: (structure?.primaryKeys || []).includes(name) })))
                .filter((col) => !col.primaryKey)
                .map((col) => (
                  <label key={col.name}>
                    {col.name}
                    <input value={addValues[col.name] || ''} onChange={(e) => setAddValues({ ...addValues, [col.name]: e.target.value })} />
                  </label>
                ))}
              <div>
                <button type="button" onClick={() => setAddOpen(false)}>Cancel</button>
                <button type="button" onClick={insertRow}>Insert Row</button>
              </div>
            </div>
          )}

          {deleteTarget && (
            <div className="workspace-panel danger">
              <strong>Delete Row</strong>
              <p>This permanently deletes the selected row.</p>
              {primaryKeys.concat(columns.map((col) => col.name).filter((name) => !primaryKeys.includes(name)).slice(0, 2)).map((col) => (
                <div key={col}>{col}: {String(deleteTarget[col] ?? '')}</div>
              ))}
              <div>
                <button type="button" onClick={() => setDeleteTarget(null)}>Cancel</button>
                <button type="button" onClick={deleteRow}>Delete</button>
              </div>
            </div>
          )}

          {pending && (
            <div className={`workspace-panel ${pending.confirmPhrase ? 'danger' : ''}`}>
              <strong>{pending.confirmPhrase ? 'Critical operation' : 'Database modification'}</strong>
              <p>{pending.intent} on {pending.targetTable}. Risk: {pending.riskLevel}. {pending.estimatedRows != null ? `${pending.estimatedRows} row(s).` : ''}</p>
              <pre>{pending.sql}</pre>
              {pending.confirmPhrase && (
                <input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder={pending.confirmPhrase} />
              )}
              <div>
                <button type="button" onClick={() => setPending(null)}>Cancel</button>
                <button type="button" onClick={confirmPending}>Confirm {pending.intent}</button>
              </div>
            </div>
          )}

          <form className="vendor-chat" onSubmit={askVendor}>
            <div className="vendor-context">@vendor · Context: {selected || 'database'}</div>
            <div className="vendor-log">
              {messages.slice(-6).map((item, index) => (
                <p key={`${item.role}-${index}`}><b>{item.role === 'you' ? 'You' : '@vendor'}</b> {item.text}</p>
              ))}
            </div>
            <input
              value={chat}
              onChange={(e) => setChat(e.target.value)}
              placeholder={selected ? `Ask anything about ${selected}...` : 'Ask your database...'}
            />
          </form>
        </section>
      </div>
    </div>
  );
}
