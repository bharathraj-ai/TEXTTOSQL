import { useState } from 'react';

const DB_TEMPLATES = {
  postgres: {
    name: 'PostgreSQL',
    icon: '🐘',
    prefix: 'postgresql://',
    placeholder: 'postgresql://username:password@ep-cool-fog.neon.tech/neondb?sslmode=require',
    desc: 'Neon, Supabase, AWS RDS, local PostgreSQL (ports 5432, 6543)',
  },
  mysql: {
    name: 'MySQL / MariaDB',
    icon: '🐬',
    prefix: 'mysql://',
    placeholder: 'mysql://username:password@localhost:3306/my_database',
    desc: 'Local MySQL, AWS RDS, PlanetScale, MariaDB (port 3306)',
  },
  sqlite: {
    name: 'SQLite',
    icon: '🗄️',
    prefix: 'sqlite://',
    placeholder: 'sqlite:///absolute/path/to/database.db',
    desc: 'Local file-based SQLite database (.db or .sqlite)',
  },
  mongodb: {
    name: 'MongoDB',
    icon: '🍃',
    prefix: 'mongodb+srv://',
    placeholder: 'mongodb+srv://username:password@cluster0.mongodb.net/myDatabase?retryWrites=true&w=majority',
    desc: 'MongoDB Atlas, local MongoDB (NoSQL collections & documents)',
  },
};

function detectTypeFromUrl(url) {
  const trimmed = (url || '').trim().toLowerCase();
  if (trimmed.startsWith('mongodb://') || trimmed.startsWith('mongodb+srv://')) return 'mongodb';
  if (trimmed.startsWith('mysql://') || trimmed.startsWith('mariadb://')) return 'mysql';
  if (trimmed.startsWith('sqlite://') || trimmed.startsWith('sqlite:') || trimmed.endsWith('.db') || trimmed.endsWith('.sqlite')) return 'sqlite';
  if (trimmed.startsWith('postgres://') || trimmed.startsWith('postgresql://')) return 'postgres';
  return null;
}

export default function DatabaseConnect({ token, dbStatus, onStatusChange, onNavigateToQuery, onAuthError }) {
  const [selectedType, setSelectedType] = useState('postgres');
  const [connectionName, setConnectionName] = useState('');
  const [databaseUrl, setDatabaseUrl] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Status & loading states
  const [isTesting, setIsTesting] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [isQuickConnecting, setIsQuickConnecting] = useState(false);

  const [testResult, setTestResult] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [showChangeForm, setShowChangeForm] = useState(false);

  const API_BASE = 'http://localhost:5000/api/database';

  const resetFeedback = () => {
    setErrorMsg('');
    setSuccessMsg('');
    setTestResult(null);
  };

  // Automatically update selected tab when user pastes or types a recognizable URL
  const handleUrlChange = (value) => {
    setDatabaseUrl(value);
    resetFeedback();
    const detected = detectTypeFromUrl(value);
    if (detected && detected !== selectedType) {
      setSelectedType(detected);
    }
  };

  const handleSelectTab = (type) => {
    setSelectedType(type);
    resetFeedback();
    // If empty or has other prefix, update placeholder prefix
    if (!databaseUrl.trim()) {
      setDatabaseUrl(DB_TEMPLATES[type].prefix);
    }
  };

  // Test connection without saving
  const handleTest = async (e) => {
    e?.preventDefault();
    if (!databaseUrl.trim()) {
      setErrorMsg('Please enter a database connection URL.');
      return;
    }

    resetFeedback();
    setIsTesting(true);

    try {
      const res = await fetch(`${API_BASE}/test`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ databaseUrl: databaseUrl.trim() }),
      });

      const data = await res.json();
      if (res.status === 401) {
        const msg = data.error || 'Your session has expired or is invalid. Please log in again.';
        setErrorMsg(msg);
        if (onAuthError) onAuthError(msg);
        return;
      }
      if (!data.success) {
        setErrorMsg(data.error || 'Connection test failed.');
      } else {
        setTestResult(data);
      }
    } catch (err) {
      setErrorMsg('Failed to test connection. Ensure backend server is running.');
    } finally {
      setIsTesting(false);
    }
  };

  // Connect and save user database
  const handleConnect = async (e) => {
    e?.preventDefault();
    if (!databaseUrl.trim()) {
      setErrorMsg('Please enter a database connection URL.');
      return;
    }

    resetFeedback();
    setIsConnecting(true);

    try {
      const res = await fetch(`${API_BASE}/connect`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          connectionName: connectionName.trim(),
          databaseUrl: databaseUrl.trim(),
        }),
      });

      const data = await res.json();
      if (res.status === 401) {
        const msg = data.error || 'Your session has expired or is invalid. Please log in again.';
        setErrorMsg(msg);
        if (onAuthError) onAuthError(msg);
        return;
      }
      if (!data.success) {
        setErrorMsg(data.error || 'Failed to connect database.');
      } else {
        setSuccessMsg(`${data.name || 'Database'} connected successfully!`);
        setDatabaseUrl('');
        setConnectionName('');
        setShowPassword(false);
        setShowChangeForm(false);
        if (onStatusChange) {
          onStatusChange({
            connected: true,
            connectionName: data.connectionName,
            databaseName: data.databaseName,
            host: data.host,
            dbType: data.dbType,
            tableCount: data.tableCount,
            tables: data.tables,
            connectionId: data.connectionId || null,
          });
        }
        if (onNavigateToQuery) onNavigateToQuery();
      }
    } catch (err) {
      setErrorMsg('Failed to connect to database. Ensure backend server is running.');
    } finally {
      setIsConnecting(false);
    }
  };

  // Quick-connect Neon sample database
  const handleQuickConnect = async () => {
    resetFeedback();
    setIsQuickConnecting(true);

    try {
      const res = await fetch(`${API_BASE}/connect-default`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
      });

      const data = await res.json();
      if (res.status === 401) {
        const msg = data.error || 'Your session has expired or is invalid. Please log in again.';
        setErrorMsg(msg);
        if (onAuthError) onAuthError(msg);
        return;
      }
      if (!data.success) {
        setErrorMsg(data.error || 'Failed to connect sample database.');
      } else {
        setSuccessMsg('Connected to sample Neon PostgreSQL database!');
        setShowChangeForm(false);
        if (onStatusChange) {
          onStatusChange({
            connected: true,
            connectionName: data.connectionName,
            databaseName: data.databaseName,
            host: data.host,
            dbType: data.dbType || 'postgres',
            tableCount: data.tableCount,
            tables: data.tables,
            connectionId: data.connectionId || null,
          });
        }
        if (onNavigateToQuery) onNavigateToQuery();
      }
    } catch (err) {
      setErrorMsg('Quick connect failed.');
    } finally {
      setIsQuickConnecting(false);
    }
  };

  // Disconnect active database
  const handleDisconnect = async () => {
    resetFeedback();
    setIsDisconnecting(true);

    try {
      const res = await fetch(`${API_BASE}/disconnect`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
      });

      const data = await res.json();
      if (res.status === 401) {
        const msg = data.error || 'Your session has expired or is invalid. Please log in again.';
        setErrorMsg(msg);
        if (onAuthError) onAuthError(msg);
        return;
      }
      if (data.success) {
        setSuccessMsg('Database disconnected.');
        if (onStatusChange) {
          onStatusChange({
            connected: false,
            connectionName: '',
            databaseName: '',
            host: '',
            dbType: '',
            tableCount: 0,
            tables: [],
            connectionId: null,
          });
        }
      } else {
        setErrorMsg(data.error || 'Failed to disconnect.');
      }
    } catch (err) {
      setErrorMsg('Failed to disconnect database.');
    } finally {
      setIsDisconnecting(false);
    }
  };

  const isConnected = dbStatus && dbStatus.connected;
  const currentDbMeta = DB_TEMPLATES[dbStatus?.dbType] || DB_TEMPLATES.postgres;
  const activeTemplate = DB_TEMPLATES[selectedType];

  return (
    <div className="database-connect-container">
      {/* Page Header */}
      <div className="db-page-header">
        <div className="header-text-group">
          <h1>Database Connection Manager</h1>
          <p className="header-subtitle">
            Connect any database: <strong>PostgreSQL</strong>, <strong>MySQL</strong>, <strong>SQLite</strong>, or <strong>MongoDB</strong>.
            Credentials are securely encrypted before saving.
          </p>
        </div>
      </div>

      {/* Success Notification */}
      {successMsg && (
        <div className="alert-box alert-success">
          <span className="alert-icon">✅</span>
          <p>{successMsg}</p>
          <button className="alert-close" onClick={() => setSuccessMsg('')}>×</button>
        </div>
      )}

      {/* Error Notification */}
      {errorMsg && (
        <div className="alert-box alert-error" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flex: 1 }}>
            <span className="alert-icon">❌</span>
            <p style={{ margin: 0 }}>{errorMsg}</p>
          </div>
          {(errorMsg.toLowerCase().includes('token') || errorMsg.toLowerCase().includes('session') || errorMsg.toLowerCase().includes('auth') || errorMsg.toLowerCase().includes('log in')) && (
            <button
              type="button"
              onClick={() => onAuthError ? onAuthError() : window.location.reload()}
              style={{
                background: 'rgba(231, 76, 60, 0.25)',
                border: '1px solid rgba(231, 76, 60, 0.6)',
                borderRadius: '4px',
                color: '#ff7675',
                padding: '0.35rem 0.85rem',
                fontSize: '0.82rem',
                fontWeight: 600,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              🔑 Log In Again
            </button>
          )}
          <button className="alert-close" onClick={() => setErrorMsg('')}>×</button>
        </div>
      )}

      {/* ── ALREADY CONNECTED CARD ─────────────────────────────────── */}
      {isConnected && !showChangeForm && (
        <div className="connected-status-card">
          <div className="card-top-bar">
            <div className="status-badge-lg connected">
              <span className="pulse-dot"></span>
              <span>{currentDbMeta.icon} Active {currentDbMeta.name} Connection</span>
            </div>
            <div className="connected-actions">
              <button
                className="btn-outline-danger"
                onClick={handleDisconnect}
                disabled={isDisconnecting}
              >
                {isDisconnecting ? 'Disconnecting...' : 'Disconnect'}
              </button>
              <button
                className="btn-secondary-sm"
                onClick={() => setShowChangeForm(true)}
              >
                Switch Database
              </button>
            </div>
          </div>

          <div className="connected-info-grid">
            <div className="info-item">
              <span className="info-label">Database Type</span>
              <span className="info-value highlight">
                {currentDbMeta.icon} {currentDbMeta.name}
              </span>
            </div>
            <div className="info-item">
              <span className="info-label">Database / Catalog</span>
              <span className="info-value">{dbStatus.databaseName || 'default'}</span>
            </div>
            <div className="info-item">
              <span className="info-label">Server Host</span>
              <span className="info-value host-value" title={dbStatus.host}>
                {dbStatus.host || 'localhost'}
              </span>
            </div>
            <div className="info-item">
              <span className="info-label">
                {dbStatus.dbType === 'mongodb' ? 'Total Collections' : 'Total Tables'}
              </span>
              <span className="info-value count-value">{dbStatus.tableCount || 0}</span>
            </div>
          </div>

          {/* Tables / Collections Discovered */}
          {dbStatus.tables && dbStatus.tables.length > 0 && (
            <div className="tables-preview-section">
              <span className="tables-header-label">
                {dbStatus.dbType === 'mongodb' ? 'Discovered Collections' : 'Discovered Tables'} ({dbStatus.tables.length}):
              </span>
              <div className="table-chips-list">
                {dbStatus.tables.map((tbl) => (
                  <span key={tbl} className="table-chip">
                    <span className="chip-icon">{dbStatus.dbType === 'mongodb' ? '🍃' : '📋'}</span>
                    <span>{tbl}</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="card-bottom-cta">
            <button
              className="btn-dash-action"
              onClick={onNavigateToQuery}
            >
              Open Database Workspace
            </button>
          </div>
        </div>
      )}

      {/* ── CONNECTION FORM (When disconnected or switching) ─────────── */}
      {(!isConnected || showChangeForm) && (
        <div className="connect-form-wrapper">
          {/* Quick-Connect Sample Banner */}
          <div className="quick-sample-card">
            <div className="quick-sample-info">
              <span className="quick-icon">⚡</span>
              <div>
                <h4>Sample PostgreSQL Database (Students & Courses)</h4>
                <p>
                  Instant 1-click cloud connection pre-loaded with Students, Courses, and Enrollments tables.
                </p>
              </div>
            </div>
            <button
              className="btn-quick-sample"
              onClick={handleQuickConnect}
              disabled={isQuickConnecting}
            >
              {isQuickConnecting ? 'Connecting...' : 'Connect Sample DB'}
            </button>
          </div>

          <div className="divider-line">
            <span>OR CONNECT YOUR OWN DATABASE</span>
          </div>

          {/* Database Type Selector Tabs */}
          <div className="db-type-selector">
            {Object.entries(DB_TEMPLATES).map(([key, tpl]) => (
              <button
                key={key}
                type="button"
                className={`db-type-tab ${selectedType === key ? 'active' : ''}`}
                onClick={() => handleSelectTab(key)}
              >
                <span className="tab-icon">{tpl.icon}</span>
                <span className="tab-name">{tpl.name}</span>
              </button>
            ))}
          </div>

          <form className="db-form-card" onSubmit={handleConnect}>
            <div className="type-hint-banner">
              <span className="hint-icon">{activeTemplate.icon}</span>
              <p><strong>{activeTemplate.name}</strong>: {activeTemplate.desc}</p>
            </div>

            <div className="form-group">
              <label htmlFor="connName">Connection Label (Optional)</label>
              <input
                id="connName"
                type="text"
                placeholder={`e.g. My ${activeTemplate.name} DB`}
                value={connectionName}
                onChange={(e) => setConnectionName(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label htmlFor="dbUrl">
                {activeTemplate.name} Connection URL <span className="req-star">*</span>
              </label>
              <div className="url-input-wrapper">
                <input
                  id="dbUrl"
                  type={showPassword ? 'text' : 'password'}
                  placeholder={activeTemplate.placeholder}
                  value={databaseUrl}
                  onChange={(e) => handleUrlChange(e.target.value)}
                  required
                />
                <button
                  type="button"
                  className="btn-toggle-eye"
                  onClick={() => setShowPassword(!showPassword)}
                  title={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? '🙈' : '👁️'}
                </button>
              </div>
              <small className="form-hint">
                Auto-detects format: <code>postgresql://</code>, <code>mysql://</code>, <code>sqlite://</code>, or <code>mongodb://</code>
              </small>
            </div>

            <div className="form-actions-row">
              <button
                type="button"
                className="btn-test-connection"
                onClick={handleTest}
                disabled={isTesting || isConnecting || !databaseUrl.trim()}
              >
                {isTesting ? (
                  <>
                    <span className="spinner-sm"></span>
                    Testing Connection...
                  </>
                ) : (
                  '🔍 Test Connection'
                )}
              </button>

              <button
                type="submit"
                className="btn-connect-primary"
                disabled={isConnecting || isTesting || !databaseUrl.trim()}
              >
                {isConnecting ? (
                  <>
                    <span className="spinner-sm"></span>
                    Connecting...
                  </>
                ) : (
                  '💾 Connect & Save'
                )}
              </button>

              {showChangeForm && (
                <button
                  type="button"
                  className="btn-cancel"
                  onClick={() => {
                    setShowChangeForm(false);
                    resetFeedback();
                  }}
                >
                  Cancel
                </button>
              )}
            </div>
          </form>

          {/* Test Connection Results Card */}
          {testResult && (
            <div className="test-results-panel">
              <div className="test-header">
                <span className="test-status-icon">✅</span>
                <h4>Connection Succeeded!</h4>
                <span className="db-badge-tag">{testResult.name || activeTemplate.name}</span>
              </div>

              <div className="test-grid">
                <div className="test-item">
                  <span className="test-k">Database</span>
                  <span className="test-v">{testResult.databaseName}</span>
                </div>
                <div className="test-item">
                  <span className="test-k">Host</span>
                  <span className="test-v">{testResult.host}</span>
                </div>
                <div className="test-item">
                  <span className="test-k">
                    {testResult.type === 'mongodb' ? 'Collections Found' : 'Tables Found'}
                  </span>
                  <span className="test-v bold">{testResult.tableCount}</span>
                </div>
              </div>

              {testResult.tables && testResult.tables.length > 0 && (
                <div className="test-tables-box">
                  <span className="test-subheading">
                    {testResult.type === 'mongodb' ? 'Collections' : 'Tables'}:
                  </span>
                  <div className="table-chips-list">
                    {testResult.tables.map((t) => (
                      <span key={t} className="table-chip-sm">
                        {testResult.type === 'mongodb' ? '🍃 ' : ''}{t}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
