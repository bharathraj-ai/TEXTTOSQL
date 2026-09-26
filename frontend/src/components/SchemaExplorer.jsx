import { useState } from 'react';

export default function SchemaExplorer({ schema, databaseName }) {
  const tables = schema?.tables ? Object.entries(schema.tables) : [];
  const [openTable, setOpenTable] = useState(tables[0]?.[0] || '');

  if (!schema || tables.length === 0) {
    return (
      <aside className="schema-sidebar">
        <div className="schema-sidebar-title">Schema</div>
        <p className="schema-empty">Connect a database to see tables and columns.</p>
      </aside>
    );
  }

  return (
    <aside className="schema-sidebar">
      <div className="schema-sidebar-title">{databaseName || 'Database'}</div>
      <ul className="schema-tree">
        {tables.map(([name, info]) => {
          const columns = Object.entries(info.columns || {});
          const open = openTable === name;
          return (
            <li key={name}>
              <button
                type="button"
                className={`schema-table ${open ? 'open' : ''}`}
                onClick={() => setOpenTable(open ? '' : name)}
              >
                <span>{open ? '▾' : '▸'}</span>
                {name}
              </button>
              {open && (
                <ul className="schema-columns">
                  {columns.map(([col, type]) => (
                    <li key={col}>
                      <span className="schema-col-name">{col}</span>
                      <span className="schema-col-type">{typeof type === 'string' ? type : ''}</span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
