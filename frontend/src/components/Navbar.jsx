export default function Navbar({ user, activePage, onNavigate, onLogout, dbStatus }) {
  return (
    <header className="navbar">
      <div className="navbar-container">
        <div className="navbar-brand" onClick={() => onNavigate(user ? 'dashboard' : 'login')}>
          <span className="navbar-logo">⚡</span>
          <span className="navbar-title">Natural Language → SQL</span>
        </div>

        {user && (
          <nav className="navbar-nav">
            <button
              className={`nav-link ${activePage === 'dashboard' ? 'active' : ''}`}
              onClick={() => onNavigate('dashboard')}
            >
              Dashboard
            </button>
            <button
              className={`nav-link ${activePage === 'database' ? 'active' : ''}`}
              onClick={() => onNavigate('database')}
            >
              Database
            </button>
            <button
              className={`nav-link ${activePage === 'query' ? 'active' : ''}`}
              onClick={() => onNavigate('query')}
            >
              Query
            </button>
          </nav>
        )}

        <div className="navbar-right">
          {dbStatus && (
            <div className={`db-status-pill ${dbStatus.connected ? 'connected' : 'disconnected'}`}>
              <span className="status-dot"></span>
              <span className="status-text">
                {dbStatus.connected ? (
                  <>
                    <span className="pill-db-icon">
                      {dbStatus.dbType === 'mongodb' ? '🍃' : dbStatus.dbType === 'mysql' ? '🐬' : dbStatus.dbType === 'sqlite' ? '🗄️' : '🐘'}
                    </span>
                    {dbStatus.databaseName || 'Connected'}
                  </>
                ) : 'No Database'}
              </span>
            </div>
          )}

          {user ? (
            <div className="user-profile">
              <span className="user-name">👤 {user.name}</span>
              <button className="logout-btn" onClick={onLogout} title="Logout">
                Logout
              </button>
            </div>
          ) : (
            <div className="auth-nav-btns">
              <button
                className={`nav-link ${activePage === 'login' ? 'active' : ''}`}
                onClick={() => onNavigate('login')}
              >
                Sign In
              </button>
              <button
                className="btn-primary-sm"
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
