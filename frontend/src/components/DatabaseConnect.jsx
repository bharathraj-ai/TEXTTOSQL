import { useState } from 'react';

const ENGINE_NAMES = {
  postgres: 'PostgreSQL',
  mysql: 'MySQL',
  sqlite: 'SQLite',
  mongodb: 'MongoDB',
};

const PROVIDER_PATTERNS = [
  { label: 'Neon', engine: 'postgres', test: /neon\.tech/i },
  { label: 'Supabase', engine: 'postgres', test: /supabase\.(co|com)/i },
  { label: 'MongoDB Atlas', engine: 'mongodb', test: /mongodb\.net|mongodb\+srv:\/\//i },
  { label: 'PlanetScale', engine: 'mysql', test: /planetscale\.com|psdb\.cloud/i },
  { label: 'CockroachDB', engine: 'postgres', test: /cockroachlabs\.cloud/i },
  { label: 'Amazon RDS', engine: null, test: /rds\.amazonaws\.com/i },
  { label: 'Render', engine: 'postgres', test: /render\.com/i },
  { label: 'Railway', engine: null, test: /railway\.app|rlwy\.net/i },
];

function detectConnection(value) {
  const text = String(value || '').trim();
  const lower = text.toLowerCase();
  if (!lower) return null;

  let engine = null;
  if (lower.startsWith('mongodb://') || lower.startsWith('mongodb+srv://') || lower.includes('mongodb.net')) {
    engine = 'mongodb';
  } else if (lower.startsWith('mysql://') || lower.startsWith('mariadb://')) {
    engine = 'mysql';
  } else if (lower.startsWith('sqlite://') || lower.startsWith('sqlite:') || /\.(db|sqlite)(\?|$)/.test(lower)) {
    engine = 'sqlite';
  } else if (lower.startsWith('postgres://') || lower.startsWith('postgresql://')) {
    engine = 'postgres';
  }

  const provider = PROVIDER_PATTERNS.find((item) => item.test.test(lower));
  const resolvedEngine = provider?.engine || engine;
  if (!resolvedEngine) return null;

  const engineName = ENGINE_NAMES[resolvedEngine] || resolvedEngine;
  const label = provider?.label
    || (resolvedEngine === 'mongodb' ? 'MongoDB' : engineName);

  return { engine: resolvedEngine, label, engineName };
}

export default function DatabaseConnect({
  token,
  dbStatus,
  onStatusChange,
  onNavigateToQuery,
  onAuthError,
}) {
  const [databaseUrl, setDatabaseUrl] = useState('');
  const [connectionName, setConnectionName] = useState('');
  const [showUrl, setShowUrl] = useState(true);

  const [isTesting, setIsTesting] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isQuickConnecting, setIsQuickConnecting] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);

  const [testResult, setTestResult] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [successData, setSuccessData] = useState(null);

  const API_BASE = 'http://localhost:5000/api/database';

  const resetMessages = () => {
    setErrorMsg('');
    setTestResult(null);
    setSuccessData(null);
  };

  const handleUrlChange = (value) => {
    setDatabaseUrl(value);
    resetMessages();
  };

  // Test Connection
  const handleTestConnection = async (e) => {
    e?.preventDefault();
    if (!databaseUrl.trim()) {
      setErrorMsg('Please enter a database connection URL.');
      return;
    }

    resetMessages();
    setIsTesting(true);

    try {
      const res = await fetch(`${API_BASE}/test`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ databaseUrl: databaseUrl.trim() }),
      });

      const data = await res.json();
      if (res.status === 401) {
        onAuthError?.(data.error);
        return;
      }
      if (!data.success) {
        setErrorMsg(data.error || 'Connection test failed. Please verify credentials.');
      } else {
        setTestResult(data);
      }
    } catch {
      setErrorMsg('Unable to connect to server. Ensure the backend is reachable.');
    } finally {
      setIsTesting(false);
    }
  };

  // Connect and Save
  const handleConnect = async (e) => {
    e?.preventDefault();
    if (!databaseUrl.trim()) {
      setErrorMsg('Please enter a database connection URL.');
      return;
    }

    resetMessages();
    setIsConnecting(true);

    try {
      const res = await fetch(`${API_BASE}/connect`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          connectionName: connectionName.trim() || undefined,
          databaseUrl: databaseUrl.trim(),
        }),
      });

      const data = await res.json();
      if (res.status === 401) {
        onAuthError?.(data.error);
        return;
      }
      if (!data.success) {
        setErrorMsg(data.error || 'Failed to connect database.');
      } else {
        const newStatus = {
          connected: true,
          connectionName: data.connectionName || data.name,
          databaseName: data.databaseName || 'production_db',
          host: data.host,
          dbType: data.dbType || detectConnection(databaseUrl)?.engine || '',
          tableCount: data.tableCount || data.tables?.length || 0,
          tables: data.tables || [],
          connectionId: data.connectionId || null,
        };

        setSuccessData(newStatus);
        onStatusChange?.(newStatus);
      }
    } catch {
      setErrorMsg('Failed to connect to database.');
    } finally {
      setIsConnecting(false);
    }
  };

  // Quick Connect (Sample Neon DB)
  const handleQuickConnect = async () => {
    resetMessages();
    setIsQuickConnecting(true);

    try {
      const res = await fetch(`${API_BASE}/connect-default`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });

      const data = await res.json();
      if (res.status === 401) {
        onAuthError?.(data.error);
        return;
      }
      if (!data.success) {
        setErrorMsg(data.error || 'Failed to connect sample database.');
      } else {
        const newStatus = {
          connected: true,
          connectionName: data.connectionName || 'Neon Sample DB',
          databaseName: data.databaseName || 'students_db',
          host: data.host,
          dbType: data.dbType || 'postgres',
          tableCount: data.tableCount || data.tables?.length || 0,
          tables: data.tables || [],
          connectionId: data.connectionId || null,
        };

        setSuccessData(newStatus);
        onStatusChange?.(newStatus);
      }
    } catch {
      setErrorMsg('Quick connect failed.');
    } finally {
      setIsQuickConnecting(false);
    }
  };

  // Disconnect active database
  const handleDisconnect = async () => {
    resetMessages();
    setIsDisconnecting(true);

    try {
      const res = await fetch(`${API_BASE}/disconnect`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });

      const data = await res.json();
      if (data.success) {
        onStatusChange?.({
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
    } catch {
      setErrorMsg('Failed to disconnect database.');
    } finally {
      setIsDisconnecting(false);
    }
  };

  const isConnected = dbStatus && dbStatus.connected;
  const urlDetection = detectConnection(databaseUrl);
  const activeDetection = detectConnection(`${dbStatus?.dbType || ''} ${dbStatus?.host || ''}`);
  const activeLabel = activeDetection
    ? (activeDetection.label === activeDetection.engineName
      ? activeDetection.engineName
      : `${activeDetection.label} · ${activeDetection.engineName}`)
    : (dbStatus?.dbType || 'Database');

  return (
    <div className="connections-page">
      <header className="connections-header">
        <div>
          <h1>Connections</h1>
          <p>Connect a database, then open the workspace to browse tables and ask Intella.</p>
        </div>
      </header>

      {isConnected && !successData && (
        <section className="connection-status-card" aria-label="Active connection">
          <div className="connection-status-main">
            <span className="connection-status-mark" aria-hidden="true">DB</span>
            <div>
              <div className="connection-status-kicker">Active connection</div>
              <h2>{dbStatus.databaseName || 'Database'}</h2>
              <p>
                {activeLabel}
                {dbStatus.host ? ` · ${dbStatus.host}` : ''}
                {` · ${dbStatus.tableCount || dbStatus.tables?.length || 0} tables`}
              </p>
            </div>
          </div>
          <div className="connection-status-actions">
            <button type="button" className="btn btn-primary" onClick={onNavigateToQuery}>
              Open workspace
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleDisconnect}
              disabled={isDisconnecting}
            >
              {isDisconnecting ? 'Disconnecting...' : 'Disconnect'}
            </button>
          </div>
        </section>
      )}

      {successData ? (
        <section className="connection-form-card connection-success-card" role="status">
          <div className="connection-success-mark" aria-hidden="true">✓</div>
          <h2>Connection successful</h2>
          <p className="connection-success-copy">
            {successData.databaseName} is ready. {successData.tableCount || 0} tables were discovered.
          </p>
          <dl className="connection-success-meta">
            <div>
              <dt>Database</dt>
              <dd>{successData.databaseName}</dd>
            </div>
            <div>
              <dt>Engine</dt>
              <dd>
                {detectConnection(`${successData.dbType || ''} ${successData.host || ''}`)?.label || successData.dbType}
              </dd>
            </div>
            <div>
              <dt>Tables</dt>
              <dd>{successData.tableCount || 0}</dd>
            </div>
          </dl>
          <button type="button" className="btn btn-primary btn-lg" onClick={onNavigateToQuery}>
            Open workspace
          </button>
        </section>
      ) : (
        <div className="connections-layout">
          <section className="connection-form-card">
            <div className="connection-card-heading">
              <h2>{isConnected ? 'Switch database' : 'New connection'}</h2>
              <p>The URL stays on the server. It is not shown again after you connect.</p>
            </div>

            <div className="form-step-group">
              <label htmlFor="database-url-input" className="step-label">
                Connection URL
              </label>
              <div className="connection-url-field">
                <input
                  id="database-url-input"
                  type={showUrl ? 'text' : 'password'}
                  className="connection-url-input"
                  placeholder="postgresql://user:password@host:5432/database"
                  value={databaseUrl}
                  onChange={(e) => handleUrlChange(e.target.value)}
                  autoComplete="off"
                  spellCheck="false"
                />
                {urlDetection && (
                  <span className="connection-url-badge">{urlDetection.label}</span>
                )}
                <button
                  type="button"
                  className="connection-url-toggle"
                  onClick={() => setShowUrl((current) => !current)}
                >
                  {showUrl ? 'Hide' : 'Show'}
                </button>
              </div>
              <p className="input-helper-text">
                {urlDetection
                  ? `Detected ${urlDetection.label}${urlDetection.label === urlDetection.engineName ? '' : ` · ${urlDetection.engineName}`}.`
                  : 'Paste the full connection URL for your database.'}
              </p>
            </div>

            <div className="form-step-group">
              <label htmlFor="connection-name-input" className="step-label">
                Label <span>optional</span>
              </label>
              <input
                id="connection-name-input"
                type="text"
                className="connection-url-input"
                placeholder="Production, analytics, or local"
                value={connectionName}
                onChange={(e) => setConnectionName(e.target.value)}
              />
            </div>

            {testResult && (
              <div className="connection-notice is-success">
                <strong>{testResult.message || 'Connection test succeeded'}</strong>
                <p>
                  {testResult.databaseName} is reachable
                  {` · ${testResult.tableCount || testResult.tables?.length || 0} tables`}
                </p>
              </div>
            )}

            {errorMsg && (
              <div className="connection-notice is-error" role="alert">
                {errorMsg}
              </div>
            )}

            <div className="connection-actions-row">
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleConnect}
                disabled={isConnecting || isTesting || isQuickConnecting}
              >
                {isConnecting ? 'Connecting...' : 'Connect database'}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleTestConnection}
                disabled={isTesting || isConnecting || isQuickConnecting}
              >
                {isTesting ? 'Testing...' : 'Test connection'}
              </button>
            </div>
          </section>

          <aside className="connection-side-card">
            <h2>Sample database</h2>
            <p>Open the included Neon sample if you want to explore the workspace before connecting your own database.</p>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleQuickConnect}
              disabled={isQuickConnecting || isConnecting || isTesting}
            >
              {isQuickConnecting ? 'Connecting...' : 'Use sample database'}
            </button>
          </aside>
        </div>
      )}
    </div>
  );
}
