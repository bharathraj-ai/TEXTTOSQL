export default function Navbar({
  user,
  activePage,
  onNavigate,
  onLogout,
  dbStatus,
}) {
  const isConnected = dbStatus && dbStatus.connected;
  const dbName = dbStatus?.databaseName || 'neondb';
  const userName = user?.name || 'Bharath Raj';

  return (
    <header className="navbar-premium-root">
      <div className="navbar-container-inner">
        {/* Left: Brand + Database Connection Context */}
        <div className="navbar-left-brand-group">
          <div
            className="navbar-brand-button"
            onClick={() => onNavigate(user ? 'dashboard' : 'login')}
            role="button"
            tabIndex={0}
          >
            <div className="brand-logo-cube">
              <span className="brand-symbol">@v</span>
            </div>
            <span className="brand-title">@Intell a</span>
          </div>

          <div className="navbar-divider" />

          {/* Database Context */}
          <div className="navbar-database-badge">
            <span className="badge-dim-label">Database:</span>
            <strong className="badge-db-name">{dbName}</strong>
            <span className={`db-status-dot-pulse ${isConnected ? 'connected' : 'disconnected'}`} />
            <span className="db-status-text">{isConnected ? 'Connected' : 'Disconnected'}</span>
          </div>
        </div>

        {/* Center: Navigation Pills */}
        {user && (
          <nav className="navbar-center-nav">
            <button
              type="button"
              className={`nav-pill-item ${activePage === 'dashboard' ? 'active' : ''}`}
              onClick={() => onNavigate('dashboard')}
            >
              Dashboard
            </button>
            <button
              type="button"
              className={`nav-pill-item ${activePage === 'query' ? 'active' : ''}`}
              onClick={() => onNavigate('query')}
            >
              Workspace
            </button>
            <button
              type="button"
              className={`nav-pill-item ${activePage === 'database' ? 'active' : ''}`}
              onClick={() => onNavigate('database')}
            >
              Connections
            </button>
          </nav>
        )}

        {/* Right: Quick Search, Notifications, User Avatar */}
        <div className="navbar-right-user-group">
          {user ? (
            <>
              {/* Quick Search Shortcut */}
              <button
                type="button"
                className="nav-icon-action-btn"
                title="Quick search"
                onClick={() => onNavigate('query')}
              >
                <span>s</span>
              </button>

              {/* Notifications */}
              <button
                type="button"
                className="nav-icon-action-btn relative"
                title="Notifications"
              >
                <span>N</span>
                <span className="notification-unread-dot" />
              </button>

              <div className="navbar-divider" />

              {/* User Profile */}
              <div className="navbar-user-chip">
                <div className="user-initial-badge">
                  {userName[0]?.toUpperCase() || 'B'}
                </div>
                <span className="user-name-label">{userName}</span>
                <button
                  type="button"
                  className="nav-logout-ghost-btn"
                  onClick={onLogout}
                  title="Sign out"
                >
                  Log out
                </button>
              </div>
            </>
          ) : (
            <div className="navbar-auth-actions">
              <button
                type="button"
                className={`btn btn-secondary btn-sm ${activePage === 'login' ? 'active' : ''}`}
                onClick={() => onNavigate('login')}
              >
                Sign In
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => onNavigate('register')}
              >
                Sign Up
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
