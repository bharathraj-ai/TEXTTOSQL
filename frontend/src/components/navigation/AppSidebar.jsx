import { useState, useMemo } from 'react';

export default function AppSidebar({
  user,
  activePage,
  onNavigate,
  onLogout,
  dbStatus,
  schema,
  selectedTable,
  onSelectTable,
  onRefreshSchema,
  isRefreshingSchema = false,
  activeTab = 'data',
  onSelectAnalytics,
  onOpenHistory,
  onAskIntella,
  isAssistantActive = false,
  onOpenSettings,
  isCollapsed = false,
  onToggleCollapse,
  isMobileOpen = false,
  onCloseMobile,
}) {
  const [search, setSearch] = useState('');

  const isConnected = Boolean(dbStatus && dbStatus.connected);
  const dbName = dbStatus?.databaseName || 'neondb';
  const dbEngine = dbStatus?.dbType || 'PostgreSQL';
  const userName = user?.name || 'Bharath Raj';
  const userInitial = userName.trim()[0]?.toUpperCase() || 'B';

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

  const handleTableClick = (tableName) => {
    onSelectTable(tableName);
    if (isMobileOpen && onCloseMobile) {
      onCloseMobile();
    }
  };

  const handleNavClick = (page) => {
    onNavigate(page);
    if (isMobileOpen && onCloseMobile) {
      onCloseMobile();
    }
  };

  const handleAnalyticsClick = () => {
    if (onSelectAnalytics) {
      onSelectAnalytics();
    } else {
      onNavigate('query');
    }
    if (isMobileOpen && onCloseMobile) {
      onCloseMobile();
    }
  };

  return (
    <>
      {/* Mobile Backdrop Overlay */}
      {isMobileOpen && (
        <div
          className="app-sidebar-backdrop"
          onClick={onCloseMobile}
          aria-hidden="true"
        />
      )}

      <aside
        className={`app-sidebar-root ${isCollapsed ? 'is-collapsed' : ''} ${
          isMobileOpen ? 'is-mobile-open' : ''
        }`}
        aria-label="Application navigation"
      >
        {/* ── 1. Top Section: Branding + Collapse Toggle (Fixed) ── */}
        <div className="sidebar-top-section">
          <div
            className="sidebar-brand-wrapper"
            onClick={() => handleNavClick(user ? 'dashboard' : 'login')}
            role="button"
            tabIndex={0}
            title="Intella — AI Database Copilot"
            aria-label="Intella AI Database Copilot"
          >
            <div className="sidebar-brand-badge">
              <span className="brand-logo-text">In</span>
            </div>
            {!isCollapsed && (
              <div className="sidebar-brand-text-stack">
                <span className="sidebar-brand-title">Intella</span>
                <span className="sidebar-brand-subtitle">AI Database Copilot</span>
              </div>
            )}
          </div>

          {/* Desktop Collapse / Expand Toggle Button */}
          <button
            type="button"
            className="sidebar-collapse-toggle-btn"
            onClick={onToggleCollapse}
            title={isCollapsed ? 'Expand sidebar (240px)' : 'Collapse sidebar (72px)'}
            aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {isCollapsed ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            )}
          </button>

          {/* Mobile Close Button */}
          {isMobileOpen && (
            <button
              type="button"
              className="sidebar-mobile-close-btn"
              onClick={onCloseMobile}
              aria-label="Close navigation sidebar"
            >
              ✕
            </button>
          )}
        </div>

        <div className="sidebar-divider" />

        {/* ── 2. MAIN Navigation Links (Fixed) ── */}
        <div className="sidebar-main-nav-group">
          {!isCollapsed && <div className="sidebar-section-heading">MAIN</div>}
          <nav className="sidebar-nav-list-main" aria-label="Main navigation">
            <button
              type="button"
              className={`sidebar-nav-link ${activePage === 'dashboard' ? 'is-active' : ''}`}
              onClick={() => handleNavClick('dashboard')}
              title={isCollapsed ? 'Dashboard' : undefined}
            >
              <span className="sidebar-nav-icon">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                  <polyline points="9 22 9 12 15 12 15 22" />
                </svg>
              </span>
              {!isCollapsed && <span className="sidebar-nav-label">Dashboard</span>}
            </button>

            <button
              type="button"
              className={`sidebar-nav-link ${activePage === 'query' ? 'is-active' : ''}`}
              onClick={() => handleNavClick('query')}
              title={isCollapsed ? 'Workspace' : undefined}
            >
              <span className="sidebar-nav-icon">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                  <line x1="3" y1="9" x2="21" y2="9" />
                  <line x1="9" y1="21" x2="9" y2="9" />
                </svg>
              </span>
              {!isCollapsed && <span className="sidebar-nav-label">Workspace</span>}
            </button>

            <button
              type="button"
              className={`sidebar-nav-link ${activePage === 'database' ? 'is-active' : ''}`}
              onClick={() => handleNavClick('database')}
              title={isCollapsed ? 'Connections' : undefined}
            >
              <span className="sidebar-nav-icon">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                  <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                </svg>
              </span>
              {!isCollapsed && <span className="sidebar-nav-label">Connections</span>}
            </button>
          </nav>
        </div>

        <div className="sidebar-divider" />

        <div className="sidebar-main-nav-group">
          {!isCollapsed && <div className="sidebar-section-heading">INTELLA</div>}
          <nav className="sidebar-nav-list-main" aria-label="Intella">
            <button
              type="button"
              className={`sidebar-nav-link ${isAssistantActive ? 'is-active' : ''}`}
              onClick={onAskIntella}
              title={isCollapsed ? 'Ask Intella' : undefined}
              aria-label="Ask Intella"
            >
              <span className="sidebar-nav-icon">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
              </span>
              {!isCollapsed && <span className="sidebar-nav-label">Ask Intella</span>}
            </button>

            <button
              type="button"
              className="sidebar-nav-link"
              onClick={onOpenHistory}
              title={isCollapsed ? 'Query History' : undefined}
              aria-label="Intella query history"
            >
              <span className="sidebar-nav-icon">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
              </span>
              {!isCollapsed && <span className="sidebar-nav-label">Query History</span>}
            </button>

            <button
              type="button"
              className={`sidebar-nav-link ${activePage === 'query' && activeTab === 'analytics' ? 'is-active' : ''}`}
              onClick={handleAnalyticsClick}
              title={isCollapsed ? 'AI Insights' : undefined}
              aria-label="Intella Insights"
            >
              <span className="sidebar-nav-icon">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="20" x2="18" y2="10" />
                  <line x1="12" y1="20" x2="12" y2="4" />
                  <line x1="6" y1="20" x2="6" y2="14" />
                </svg>
              </span>
              {!isCollapsed && <span className="sidebar-nav-label">AI Insights</span>}
            </button>
          </nav>
        </div>

        <div className="sidebar-divider" />

        {/* ── 3. DATABASE Header & Status (Fixed) ── */}
        <div className="sidebar-db-context-block">
          <div className="sidebar-db-header-row">
            <span className="sidebar-section-heading">DATABASE</span>
            <button
              type="button"
              className={`sidebar-refresh-icon-btn ${isRefreshingSchema ? 'is-spinning' : ''}`}
              onClick={onRefreshSchema}
              disabled={isRefreshingSchema}
              title="Refresh database schema"
              aria-label="Refresh database schema"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="23 4 23 10 17 10" />
                <polyline points="1 20 1 14 7 14" />
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
              </svg>
            </button>
          </div>

          {/* Database Identity & Status */}
          <div
            className="sidebar-db-identity-card"
            title={`${dbName} (${dbEngine}) — ${isConnected ? 'Connected' : 'Disconnected'}`}
          >
            <div className="sidebar-db-icon-wrap">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <ellipse cx="12" cy="5" rx="9" ry="3" />
                <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
                <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
              </svg>
              <span className={`db-status-dot-pip ${isConnected ? 'connected' : 'disconnected'}`} />
            </div>

            {!isCollapsed && (
              <div className="sidebar-db-text-column">
                <div className="sidebar-db-name-row">
                  <strong className="sidebar-db-name-label">{dbName}</strong>
                </div>
                <div className="sidebar-db-meta-row">
                  <span className="sidebar-db-dialect">{dbEngine}</span>
                  <span className="sidebar-dot-sep">·</span>
                  <span className={`sidebar-status-tag ${isConnected ? 'connected' : 'disconnected'}`}>
                    {isConnected ? 'Connected' : 'Disconnected'}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Table Search Input */}
          {!isCollapsed ? (
            <div className="sidebar-search-box">
              <span className="search-icon-symbol">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
              </span>
              <input
                type="text"
                className="sidebar-search-input"
                placeholder="Search tables..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {search && (
                <button
                  type="button"
                  className="sidebar-search-clear-btn"
                  onClick={() => setSearch('')}
                  aria-label="Clear table search"
                >
                  ×
                </button>
              )}
            </div>
          ) : (
            <div className="sidebar-search-collapsed-wrap" title="Search tables">
              <button
                type="button"
                className="sidebar-collapsed-action-btn"
                onClick={onToggleCollapse}
                title="Search tables (expand)"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
              </button>
            </div>
          )}
        </div>

        {/* ── 4. Scrollable Middle: Tables Tree + Tools (Scrollable) ── */}
        <div className="sidebar-scrollable-content">
          {/* Tables Tree Header */}
          <div className="sidebar-tree-subhead">
            <span className="tree-subhead-label">TABLES</span>
            <span className="tree-count-badge">{allTables.length}</span>
          </div>

          <ul className="sidebar-tables-list" role="list">
            {filteredTables.map((tableName) => {
              const isSelected =
                tableName.toLowerCase() === (selectedTable || '').toLowerCase() &&
                activePage === 'query';

              return (
                <li key={tableName}>
                  <button
                    type="button"
                    className={`sidebar-table-row-btn ${isSelected ? 'is-active' : ''}`}
                    onClick={() => handleTableClick(tableName)}
                    title={isCollapsed ? tableName : undefined}
                  >
                    <span className="table-row-icon">
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="3" width="18" height="18" rx="2" />
                        <line x1="3" y1="9" x2="21" y2="9" />
                        <line x1="3" y1="15" x2="21" y2="15" />
                        <line x1="12" y1="3" x2="12" y2="21" />
                      </svg>
                    </span>
                    {!isCollapsed && (
                      <span className="table-row-name" title={tableName}>
                        {tableName}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}

            {filteredTables.length === 0 && !isCollapsed && (
              <li className="sidebar-empty-state-row">
                <span>{allTables.length === 0 ? 'No tables found' : 'No matching tables'}</span>
              </li>
            )}
          </ul>

          {/* Views List (if views exist in schema) */}
          {allViews.length > 0 && (
            <>
              <div className="sidebar-tree-subhead mt-3">
                <span className="tree-subhead-label">VIEWS</span>
                <span className="tree-count-badge">{allViews.length}</span>
              </div>
              <ul className="sidebar-tables-list" role="list">
                {filteredViews.map((viewName) => {
                  const isSelected =
                    viewName.toLowerCase() === (selectedTable || '').toLowerCase() &&
                    activePage === 'query';

                  return (
                    <li key={viewName}>
                      <button
                        type="button"
                        className={`sidebar-table-row-btn ${isSelected ? 'is-active' : ''}`}
                        onClick={() => handleTableClick(viewName)}
                        title={isCollapsed ? `View: ${viewName}` : undefined}
                      >
                        <span className="table-row-icon">
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polygon points="12 2 2 7 12 12 22 7 12 2" />
                            <polyline points="2 17 12 22 22 17" />
                            <polyline points="2 12 12 17 22 12" />
                          </svg>
                        </span>
                        {!isCollapsed && (
                          <span className="table-row-name" title={viewName}>
                            {viewName}
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}

        </div>

        {/* ── 5. Bottom Account / Footer (Fixed) ── */}
        <div className="sidebar-account-footer">
          <div className="sidebar-divider" />

          {/* Settings Button */}
          <button
            type="button"
            className="sidebar-footer-action-link"
            onClick={onOpenSettings}
            title={isCollapsed ? 'Settings' : undefined}
          >
            <span className="sidebar-footer-icon">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            </span>
            {!isCollapsed && <span className="sidebar-footer-label">Settings</span>}
          </button>

          {/* User Profile + Logout */}
          <div
            className="sidebar-user-profile-card"
            title={isCollapsed ? `${userName} — Sign out` : undefined}
          >
            <div className="sidebar-user-avatar-badge" aria-hidden="true">
              {userInitial}
            </div>

            {!isCollapsed && (
              <div className="sidebar-user-info-text">
                <span className="sidebar-user-name-title" title={userName}>
                  {userName}
                </span>
                <span className="sidebar-user-role-subtext">
                  {user?.role || 'Account'}
                </span>
              </div>
            )}

            <button
              type="button"
              className="sidebar-logout-icon-btn"
              onClick={onLogout}
              title="Sign out"
              aria-label="Sign out"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
