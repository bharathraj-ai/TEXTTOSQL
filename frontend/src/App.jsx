import { useState, useEffect, useMemo } from 'react';
import AppSidebar from './components/navigation/AppSidebar';
import SettingsModal from './components/SettingsModal';
import QueryHistoryModal from './components/QueryHistoryModal';
import Login from './pages/Login';
import Register from './pages/Register';
import DatabaseWorkspace from './components/DatabaseWorkspace';
import DatabaseConnect from './components/DatabaseConnect';
import { ToastProvider } from './components/common/Toast';

const API_URL = 'http://localhost:5000/api';

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function getStoredRecentActivity() {
  try {
    const raw = localStorage.getItem('nl-sql-query-history');
    if (!raw) return [];
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    return list.slice(0, 5);
  } catch {
    return [];
  }
}

export default function App() {
  // ── Auth & Navigation State ─────────────────────────
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(localStorage.getItem('nl_sql_token') || '');
  const [activePage, setActivePage] = useState('login');
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const [authNotice, setAuthNotice] = useState('');

  // ── Database Connection State ───────────────────────
  const [dbStatus, setDbStatus] = useState({
    connected: false,
    connectionName: '',
    databaseName: '',
    host: '',
    dbType: '',
    tableCount: 0,
    tables: [],
    connectionId: null,
  });

  // ── Schema & Selected Table Context ──────────────────
  const [schema, setSchema] = useState(null);
  const [schemaSummary, setSchemaSummary] = useState(null);
  const [selectedTable, setSelectedTable] = useState('');
  const [isRefreshingSchema, setIsRefreshingSchema] = useState(false);
  const [activeTab, setActiveTab] = useState('data');

  // ── Navigation & Modals State ────────────────────────
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [openCopilotRequest, setOpenCopilotRequest] = useState(0);
  const [isAssistantActive, setIsAssistantActive] = useState(false);

  // ── Handle auth error / expired session ─────────────
  const handleAuthError = (message) => {
    localStorage.removeItem('nl_sql_token');
    setUser(null);
    setToken('');
    setSchema(null);
    setSchemaSummary(null);
    setSelectedTable('');
    setDbStatus({
      connected: false,
      connectionName: '',
      databaseName: '',
      host: '',
      dbType: '',
      tableCount: 0,
      tables: [],
      connectionId: null,
    });
    setAuthNotice(message || 'Your session has expired. Please log in again.');
    setActivePage('login');
  };

  const fetchDbStatus = async (userToken) => {
    const t = userToken || token;
    if (!t) return;
    try {
      const res = await fetch(`${API_URL}/database/status`, {
        headers: {
          Authorization: `Bearer ${t}`,
        },
      });
      if (res.status === 401) {
        handleAuthError('Your session has expired. Please log in again.');
        return;
      }
      const data = await res.json();
      if (data.success) {
        setDbStatus({
          connected: data.connected || false,
          connectionName: data.connectionName || '',
          databaseName: data.databaseName || '',
          host: data.host || '',
          dbType: data.dbType || 'postgres',
          tableCount: data.tableCount || (data.tables ? data.tables.length : 0),
          tables: data.tables || [],
          connectionId: data.connectionId || null,
        });
      }
    } catch (err) {
      console.error('Failed to fetch DB status:', err);
    }
  };

  const fetchSchema = async (userToken, preferredTable = '') => {
    const t = userToken || token;
    if (!t) return;
    setIsRefreshingSchema(true);
    try {
      const res = await fetch(`${API_URL}/database/schema`, {
        headers: { Authorization: `Bearer ${t}` },
      });
      if (res.status === 401) {
        handleAuthError('Your session has expired. Please log in again.');
        return;
      }
      const data = await res.json();
      if (data.success && data.schema) {
        setSchema(data.schema);
        setSchemaSummary(data.schema);
        const tableNames = Object.keys(data.schema.tables || {});
        if (tableNames.length > 0) {
          const matchName = (name) => tableNames.find(
            (tableName) => tableName.toLowerCase() === String(name || '').toLowerCase()
          );
          setSelectedTable((curr) => {
            const current = matchName(curr);
            if (current) return current;
            return matchName(preferredTable) || tableNames[0];
          });
        }
      }
    } catch (err) {
      console.error('Failed to load schema:', err);
    } finally {
      setIsRefreshingSchema(false);
    }
  };

  // Verify auth session on initial load
  useEffect(() => {
    const checkAuth = async () => {
      const savedToken = localStorage.getItem('nl_sql_token');
      if (!savedToken) {
        setIsCheckingAuth(false);
        setActivePage('login');
        return;
      }

      try {
        const res = await fetch('http://localhost:5000/api/auth/me', {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${savedToken}`,
          },
        });
        const data = await res.json();
        if (data.success && data.user) {
          setUser(data.user);
          setToken(savedToken);
          setActivePage('query'); // Directly open database workspace
          fetchDbStatus(savedToken);
          fetchSchema(savedToken);
        } else {
          localStorage.removeItem('nl_sql_token');
          setUser(null);
          setToken('');
          setActivePage('login');
        }
      } catch (err) {
        console.error('Session check failed:', err);
        setUser(null);
        setActivePage('login');
      } finally {
        setIsCheckingAuth(false);
      }
    };

    checkAuth();
  }, []);

  const handleLoginSuccess = (userData, userToken) => {
    setAuthNotice('');
    setUser(userData);
    setToken(userToken);
    setActivePage('query');
    fetchDbStatus(userToken);
    fetchSchema(userToken);
  };

  const handleLogout = async () => {
    try {
      await fetch('http://localhost:5000/api/auth/logout', {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
    } catch {
      // Ignore
    }
    localStorage.removeItem('nl_sql_token');
    setUser(null);
    setToken('');
    setAuthNotice('');
    setSchema(null);
    setSchemaSummary(null);
    setSelectedTable('');
    setDbStatus({
      connected: false,
      connectionName: '',
      databaseName: '',
      host: '',
      dbType: '',
      tableCount: 0,
      tables: [],
      connectionId: null,
    });
    setActivePage('login');
  };

  const handleSelectTableFromSidebar = (tableName) => {
    setSelectedTable(tableName);
    setActivePage('query');
    setActiveTab('data');
  };

  // Recent activity from real storage
  const recentActivities = useMemo(() => {
    return getStoredRecentActivity();
  }, [activePage]);

  if (isCheckingAuth) {
    return (
      <div className="app-loader-screen">
        <div className="spinner-clean" />
        <p className="loading-subtext">Loading workspace...</p>
      </div>
    );
  }

  return (
    <ToastProvider>
      {/* ── Unauthenticated Views ── */}
      {!user && (
        <div className="auth-shell light-theme-root">
          {activePage === 'login' && (
            <Login
              onLoginSuccess={handleLoginSuccess}
              onNavigateToRegister={() => {
                setAuthNotice('');
                setActivePage('register');
              }}
              initialNotice={authNotice}
            />
          )}

          {activePage === 'register' && (
            <Register
              onRegisterSuccess={handleLoginSuccess}
              onNavigateToLogin={() => setActivePage('login')}
            />
          )}
        </div>
      )}

      {/* ── Authenticated Application (Left Sidebar Layout) ── */}
      {user && (
        <div className={`app-shell light-theme-root ${isSidebarCollapsed ? 'sidebar-is-collapsed' : ''}`}>
          {/* Primary Left Vertical Sidebar Navigation */}
          <AppSidebar
            user={user}
            activePage={activePage}
            onNavigate={(page) => {
              setActivePage(page);
              setIsAssistantActive(false);
              if (page === 'query') setActiveTab('data');
            }}
            onLogout={handleLogout}
            dbStatus={dbStatus}
            schema={schema}
            selectedTable={selectedTable}
            onSelectTable={handleSelectTableFromSidebar}
            onRefreshSchema={() => fetchSchema(token, selectedTable)}
            isRefreshingSchema={isRefreshingSchema}
            activeTab={activeTab}
            onSelectAnalytics={() => {
              setActivePage('query');
              setActiveTab('analytics');
              setIsAssistantActive(false);
            }}
            onOpenHistory={() => setIsHistoryOpen(true)}
            onAskIntella={() => {
              setActivePage('query');
              setActiveTab('data');
              setIsAssistantActive(true);
              setOpenCopilotRequest((current) => current + 1);
            }}
            isAssistantActive={isAssistantActive}
            onOpenSettings={() => setIsSettingsOpen(true)}
            isCollapsed={isSidebarCollapsed}
            onToggleCollapse={() => setIsSidebarCollapsed((prev) => !prev)}
            isMobileOpen={isMobileSidebarOpen}
            onCloseMobile={() => setIsMobileSidebarOpen(false)}
          />

          {/* Main Content Area (Fills remaining viewport, 100vh) */}
          <div className="app-main-viewport-container">
            {/* Mobile Minimal Bar (< 768px) */}
            <div className="mobile-app-header-bar">
              <button
                type="button"
                className="mobile-hamburger-trigger"
                onClick={() => setIsMobileSidebarOpen(true)}
                title="Open navigation menu"
                aria-label="Open navigation menu"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="3" y1="12" x2="21" y2="12" />
                  <line x1="3" y1="6" x2="21" y2="6" />
                  <line x1="3" y1="18" x2="21" y2="18" />
                </svg>
              </button>
              <div className="mobile-header-brand">
                <span className="mobile-brand-symbol">In</span>
                <span className="mobile-brand-name">Intella</span>
              </div>
              <div className="mobile-header-page-tag">
                {activePage === 'dashboard'
                  ? 'Dashboard'
                  : activePage === 'database'
                  ? 'Connections'
                  : selectedTable || 'Workspace'}
              </div>
            </div>

            {/* ── Dashboard Overview Page ── */}
            {activePage === 'dashboard' && (
              <main className="dashboard-overview-page">
                <div className="dashboard-hero-section">
                  <div className="hero-text-group">
                    <h1 className="hero-title">{getGreeting()}, {user.name}</h1>
                    <p className="hero-subtitle">Your database analytics workspace</p>
                  </div>

                  <div className="hero-actions-group">
                    {dbStatus.connected ? (
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={() => {
                          setActivePage('query');
                          setActiveTab('data');
                        }}
                      >
                        Open Database Workspace →
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={() => setActivePage('database')}
                      >
                        Connect Database →
                      </button>
                    )}
                  </div>
                </div>

                {/* 3 Metric Cards: Databases, Tables, Engine */}
                <div className="dashboard-metric-cards-grid">
                  <div className="dash-kpi-card">
                    <div className="dash-kpi-header">
                      <span className="dash-kpi-title">Databases</span>
                      <span className="dash-kpi-icon">🗄️</span>
                    </div>
                    <div className="dash-kpi-value">
                      {dbStatus.connected ? '1' : '0'}
                    </div>
                    <div className="dash-kpi-footer">
                      <span className={dbStatus.connected ? 'text-success font-medium' : 'text-muted'}>
                        {dbStatus.connected ? '● 1 active connection' : '○ No connection'}
                      </span>
                    </div>
                  </div>

                  <div className="dash-kpi-card">
                    <div className="dash-kpi-header">
                      <span className="dash-kpi-title">Tables</span>
                      <span className="dash-kpi-icon">▣</span>
                    </div>
                    <div className="dash-kpi-value">
                      {schema?.tables
                        ? Object.keys(schema.tables).length
                        : dbStatus.tableCount || 0}
                    </div>
                    <div className="dash-kpi-footer">
                      <span className="text-secondary font-medium">
                        {dbStatus.databaseName || 'No database connected'}
                      </span>
                    </div>
                  </div>

                  <div className="dash-kpi-card">
                    <div className="dash-kpi-header">
                      <span className="dash-kpi-title">Engine</span>
                      <span className="dash-kpi-icon">⚡</span>
                    </div>
                    <div className="dash-kpi-value text-capitalize">
                      {dbStatus.connected ? (dbStatus.dbType || 'PostgreSQL') : '—'}
                    </div>
                    <div className="dash-kpi-footer">
                      <span className="text-secondary font-medium">
                        {dbStatus.host ? `Host: ${dbStatus.host}` : 'SSL enabled'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Two Column Grid: Recent Databases & Recent Activity */}
                <div className="dashboard-content-split-grid">
                  {/* Recent Databases Section */}
                  <div className="dash-section-card">
                    <div className="section-card-header">
                      <h3>Recent Databases</h3>
                      <button
                        type="button"
                        className="btn btn-secondary btn-xs"
                        onClick={() => setActivePage('database')}
                      >
                        Manage
                      </button>
                    </div>
                    <div className="recent-db-list">
                      {dbStatus.connected ? (
                        <div
                          className="recent-db-item active-db"
                          onClick={() => {
                            setActivePage('query');
                            setActiveTab('data');
                          }}
                          role="button"
                          tabIndex={0}
                        >
                          <div className="db-item-left">
                            <span className="db-avatar">
                              {dbStatus.dbType === 'mongodb' ? '🍃' : dbStatus.dbType === 'mysql' ? '🐬' : dbStatus.dbType === 'sqlite' ? '🗄️' : '🐘'}
                            </span>
                            <div>
                              <div className="db-item-title">
                                <strong>{dbStatus.databaseName || 'production_db'}</strong>
                                <span className="badge-connected-sm">Active</span>
                              </div>
                              <p className="db-item-subtitle">
                                {(schema?.tables ? Object.keys(schema.tables).length : dbStatus.tableCount) || 0} tables • {dbStatus.dbType || 'postgres'}
                              </p>
                            </div>
                          </div>
                          <span className="arrow-launch">→</span>
                        </div>
                      ) : (
                        <div className="empty-db-prompt">
                          <p>No database currently connected.</p>
                          <button
                            type="button"
                            className="btn btn-primary btn-sm"
                            onClick={() => setActivePage('database')}
                          >
                            Connect Your Database
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Recent Activity Section */}
                  <div className="dash-section-card">
                    <div className="section-card-header">
                      <h3>Recent Activity</h3>
                      <button
                        type="button"
                        className="btn btn-secondary btn-xs"
                        onClick={() => {
                          setActivePage('query');
                          setActiveTab('data');
                        }}
                      >
                        Workspace
                      </button>
                    </div>
                    <div className="recent-activity-list">
                      {recentActivities.length > 0 ? (
                        recentActivities.map((act, idx) => (
                          <div key={idx} className="activity-item-row">
                            <span className="activity-bullet">●</span>
                            <div className="activity-text-wrap">
                              <span className="activity-query-text">{act.question}</span>
                              <span className="activity-time-text">
                                {act.timestamp ? new Date(act.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Recent'}
                              </span>
                            </div>
                            <span className={`status-pill-sm ${act.success ? 'status-ok' : 'status-failed'}`}>
                              {act.success ? 'Success' : 'Failed'}
                            </span>
                          </div>
                        ))
                      ) : (
                        <div className="empty-activity-prompt">
                          <p>No recent queries yet.</p>
                          <p className="text-secondary text-sm">
                            Queries and modifications executed through Intella will appear here.
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </main>
            )}

            {/* ── Database Connections Page ── */}
            {activePage === 'database' && (
              <main className="database-connections-page">
                <DatabaseConnect
                  token={token}
                  dbStatus={dbStatus}
                  onStatusChange={(newStatus) => {
                    setDbStatus(newStatus);
                    fetchSchema(token);
                  }}
                  onNavigateToQuery={() => {
                    setActivePage('query');
                    setActiveTab('data');
                  }}
                  onAuthError={handleAuthError}
                />
              </main>
            )}

            {/* ── Main Database Workspace (Default & Primary View) ── */}
            {activePage === 'query' && (
              <div className="workspace-page-container">
                {dbStatus.connected ? (
                  <DatabaseWorkspace
                    token={token}
                    dbStatus={dbStatus}
                    user={user}
                    onAuthError={handleAuthError}
                    schema={schema}
                    selectedTable={selectedTable}
                    onSelectTable={setSelectedTable}
                    onRefreshSchema={(tbl) => fetchSchema(token, tbl || selectedTable)}
                    isRefreshingSchema={isRefreshingSchema}
                    activeTab={activeTab}
                    onTabChange={setActiveTab}
                    onOpenMobileSidebar={() => setIsMobileSidebarOpen(true)}
                    openCopilotRequest={openCopilotRequest}
                  />
                ) : (
                  <div className="workspace-unconnected-center">
                    <div className="empty-connect-card">
                      <span className="empty-connect-icon">🗄️</span>
                      <h2>Connect your first database</h2>
                      <p>
                        Explore your tables, analyze your data, and use Intella to interact with your database.
                      </p>
                      <button
                        type="button"
                        className="btn btn-primary btn-lg"
                        onClick={() => setActivePage('database')}
                      >
                        Connect Database
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── Workspace Settings Modal ── */}
          <SettingsModal
            isOpen={isSettingsOpen}
            onClose={() => setIsSettingsOpen(false)}
            dbStatus={dbStatus}
            user={user}
            onNavigateToConnections={() => {
              setIsSettingsOpen(false);
              setActivePage('database');
            }}
          />

          {/* ── Query History Modal ── */}
          <QueryHistoryModal
            isOpen={isHistoryOpen}
            onClose={() => setIsHistoryOpen(false)}
            onSelectQuery={(q) => {
              setIsHistoryOpen(false);
              setActivePage('query');
            }}
          />
        </div>
      )}
    </ToastProvider>
  );
}
