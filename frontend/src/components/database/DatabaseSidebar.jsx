import { useState, useMemo } from 'react';

export default function DatabaseSidebar({
  dbStatus,
  schema,
  selectedTable,
  onSelectTable,
  onRefreshSchema,
  isRefreshing = false,
}) {
  const [search, setSearch] = useState('');

  const allTables = useMemo(() => {
    return Object.keys(schema?.tables || {});
  }, [schema]);

  const allViews = useMemo(() => {
    return Object.keys(schema?.views || {});
  }, [schema]);

  const filteredTables = useMemo(() => {
    if (!search.trim()) return allTables;
    const q = search.toLowerCase();
    return allTables.filter((t) => t.toLowerCase().includes(q));
  }, [allTables, search]);

  const filteredViews = useMemo(() => {
    if (!search.trim()) return allViews;
    const q = search.toLowerCase();
    return allViews.filter((v) => v.toLowerCase().includes(q));
  }, [allViews, search]);

  return (
    <aside className="db-sidebar-premium">
      {/* 1. Header & Database Label */}
      <div className="sidebar-brand-block">
        <div className="sidebar-header-line">
          <span className="sidebar-section-title">DATABASE</span>
          <span className="db-engine-mini-tag">{dbStatus.dbType || 'PostgreSQL'}</span>
        </div>
        <div className="sidebar-db-display">
          <span className="sidebar-db-icon">🗄️</span>
          <span className="sidebar-db-text" title={dbStatus.databaseName || 'production_db'}>
            {dbStatus.databaseName || 'neondb'}
          </span>
        </div>

        {/* 2. Instant Search Input */}
        <div className="sidebar-search-wrapper">
          <span className="search-symbol">🔍</span>
          <input
            type="text"
            className="sidebar-search-field"
            placeholder="Search tables..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button
              type="button"
              className="sidebar-search-clear"
              onClick={() => setSearch('')}
              aria-label="Clear search"
            >
              ×
            </button>
          )}
        </div>
      </div>

      {/* 3. Tables List */}
      <div className="sidebar-scrollable-tree">
        <div className="sidebar-tree-header">
          <span className="tree-heading">TABLES</span>
          <span className="tree-count-badge">{allTables.length}</span>
        </div>

        <ul className="sidebar-nav-list">
          {filteredTables.map((tableName) => {
            const isSelected = tableName.toLowerCase() === (selectedTable || '').toLowerCase();
            return (
              <li key={tableName}>
                <button
                  type="button"
                  className={`sidebar-table-item ${isSelected ? 'active' : ''}`}
                  onClick={() => onSelectTable(tableName)}
                >
                  <span className="table-symbol">▣</span>
                  <span className="table-text-title">{tableName}</span>
                </button>
              </li>
            );
          })}

          {filteredTables.length === 0 && (
            <li className="sidebar-empty-state">
              <span>{allTables.length === 0 ? 'No tables found' : 'No matching tables'}</span>
            </li>
          )}
        </ul>

        {/* Views List (if views exist in schema) */}
        {allViews.length > 0 && (
          <>
            <div className="sidebar-tree-header mt-4">
              <span className="tree-heading">VIEWS</span>
              <span className="tree-count-badge">{allViews.length}</span>
            </div>
            <ul className="sidebar-nav-list">
              {filteredViews.map((viewName) => {
                const isSelected = viewName.toLowerCase() === (selectedTable || '').toLowerCase();
                return (
                  <li key={viewName}>
                    <button
                      type="button"
                      className={`sidebar-table-item ${isSelected ? 'active' : ''}`}
                      onClick={() => onSelectTable(viewName)}
                    >
                      <span className="table-symbol">◫</span>
                      <span className="table-text-title">{viewName}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>

      {/* 4. Footer: Connection Status & Refresh Schema */}
      <div className="sidebar-footer-block">
        <div className="footer-status-pill">
          <span className="status-indicator-dot" />
          <span className="status-label">Connected</span>
        </div>

        <button
          type="button"
          className={`sidebar-refresh-btn ${isRefreshing ? 'is-spinning' : ''}`}
          onClick={onRefreshSchema}
          disabled={isRefreshing}
          title="Refresh database schema"
        >
          <span className="refresh-icon">↻</span>
          <span>Refresh Schema</span>
        </button>
      </div>
    </aside>
  );
}
