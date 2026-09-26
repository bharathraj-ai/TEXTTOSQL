import { useState, useEffect } from 'react';
import Navbar from './components/Navbar';
import Login from './pages/Login';
import Register from './pages/Register';
import QueryInput from './components/QueryInput';
import SqlDisplay from './components/SqlDisplay';
import ExplanationDisplay from './components/ExplanationDisplay';
import QueryMetadata from './components/QueryMetadata';
import ResultTable from './components/ResultTable';
import QueryHistory, { saveToHistory } from './components/QueryHistory';
import DatabaseConnect from './components/DatabaseConnect';
import ClarificationBox from './components/ClarificationBox';
import QuerySuggestions from './components/QuerySuggestions';
import MutationPanel from './components/MutationPanel';

const API_URL = 'http://localhost:5000/api';

export default function App() {
  // ── Auth & Navigation State ─────────────────────────
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(localStorage.getItem('nl_sql_token') || '');
  const [activePage, setActivePage] = useState('login');
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);

  // ── Query Execution State ───────────────────────────
  const [sql, setSql] = useState('');
  const [explanation, setExplanation] = useState('');
  const [columns, setColumns] = useState(null);
  const [rows, setRows] = useState(null);
  const [executionTime, setExecutionTime] = useState(null);
  const [rowCount, setRowCount] = useState(null);
  const [error, setError] = useState('');
  const [errorType, setErrorType] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');
  const [externalQuestion, setExternalQuestion] = useState('');
  const [historyKey, setHistoryKey] = useState(0);

  // ── Clarification State ─────────────────────────────
  const [clarification, setClarification] = useState(null);

  // ── Query Mode (read vs write) ──────────────────────
  const [queryMode, setQueryMode] = useState('read');
  const [queryReview, setQueryReview] = useState(null);

  // ── Unsupported State ───────────────────────────────
  const [unsupported, setUnsupported] = useState('');

  // ── Database Connection State ───────────────────────
  const [queryDbType, setQueryDbType] = useState('postgres');
  const [dbStatus, setDbStatus] = useState({
    connected: false,
    connectionName: '',
    databaseName: '',
    host: '',
    dbType: '',
    tableCount: 0,
    tables: [],
  });

  const fetchDbStatus = async (userToken) => {
    const t = userToken || token;
    if (!t) return;
    try {
      const res = await fetch(`${API_URL.replace('/api', '')}/api/database/status`, {
        headers: {
          'Authorization': `Bearer ${t}`,
        },
      });
      const data = await res.json();
      if (data.success) {
        setDbStatus({
          connected: data.connected || false,
          connectionName: data.connectionName || '',
          databaseName: data.databaseName || '',
          host: data.host || '',
          dbType: data.dbType || 'postgres',
          tableCount: data.tableCount || 0,
          tables: data.tables || [],
        });
        if (data.dbType) setQueryDbType(data.dbType);
      }
    } catch (err) {
      console.error('Failed to fetch DB status:', err);
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
            'Authorization': `Bearer ${savedToken}`,
          },
        });
        const data = await res.json();
        if (data.success && data.user) {
          setUser(data.user);
          setToken(savedToken);
          setActivePage('dashboard');
          fetchDbStatus(savedToken);
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
    setUser(userData);
    setToken(userToken);
    setActivePage('dashboard');
    fetchDbStatus(userToken);
  };

  const handleLogout = async () => {
    try {
      await fetch('http://localhost:5000/api/auth/logout', { method: 'POST' });
    } catch {
      // Ignore
    }
    localStorage.removeItem('nl_sql_token');
    setUser(null);
    setToken('');
    setDbStatus({ connected: false, connectionName: '', databaseName: '', host: '', tableCount: 0, tables: [] });
    setActivePage('login');
  };

  // ── Reset all query results ─────────────────────────
  const resetQueryState = () => {
    setSql('');
    setExplanation('');
    setColumns(null);
    setRows(null);
    setExecutionTime(null);
    setRowCount(null);
    setError('');
    setErrorType('');
    setClarification(null);
    setUnsupported('');
    setQueryReview(null);
  };

  // ── Main query handler ──────────────────────────────
  const handleQuery = async (question) => {
    resetQueryState();
    setIsLoading(true);
    setLoadingMessage('Understanding question...');

    try {
      await new Promise((r) => setTimeout(r, 200));
      setLoadingMessage('Generating SQL...');

      const headers = { 'Content-Type': 'application/json' };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const response = await fetch(`${API_URL}/query`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ question }),
      });

      setLoadingMessage('Processing results...');
      await new Promise((r) => setTimeout(r, 150));

      const data = await response.json();

      // ── Handle different response types ─────────────
      if (!data.success) {
        switch (data.type) {
          case 'clarification_required':
            setClarification({
              message: data.message,
              options: data.options || [],
              originalQuestion: data.originalQuestion || question,
            });
            saveToHistory(question, false, '', null);
            setHistoryKey((k) => k + 1);
            return;

          case 'unsupported_question':
            setUnsupported(data.message || 'This question cannot be answered using the connected database.');
            saveToHistory(question, false, '', null);
            setHistoryKey((k) => k + 1);
            return;

          default:
            setError(data.error || 'Something went wrong.');
            setErrorType(data.type || 'query_error');
            if (data.sql) setSql(data.sql);
            saveToHistory(question, false, data.sql || '', null);
            setHistoryKey((k) => k + 1);
            return;
        }
      }

      setLoadingMessage('Complete!');
      await new Promise((r) => setTimeout(r, 200));

      if (data.dbType) setQueryDbType(data.dbType);
      setSql(data.sql);
      setExplanation(data.explanation || '');
      setColumns(data.columns);
      setRows(data.rows);
      setExecutionTime(data.executionTime ?? null);
      setRowCount(data.rowCount ?? data.rows?.length ?? null);
      if (data.review) setQueryReview(data.review);

      saveToHistory(question, true, data.sql || '', data.executionTime);
      setHistoryKey((k) => k + 1);
    } catch (err) {
      console.error('API error:', err);
      setError('Failed to connect to the server. Make sure the backend is running.');
      setErrorType('connection_error');
      saveToHistory(question, false, '', null);
      setHistoryKey((k) => k + 1);
    } finally {
      setIsLoading(false);
      setLoadingMessage('');
    }
  };

  // ── Handle clarification selection ──────────────────
  const handleClarificationSelect = async (originalQuestion, selectedOption) => {
    resetQueryState();
    setIsLoading(true);
    setLoadingMessage('Processing clarified question...');

    try {
      const headers = { 'Content-Type': 'application/json' };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const response = await fetch(`${API_URL}/query/clarify`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ originalQuestion, selectedOption }),
      });

      const data = await response.json();

      if (!data.success) {
        setError(data.error || data.message || 'Something went wrong.');
        setErrorType(data.type || 'query_error');
        if (data.sql) setSql(data.sql);
        saveToHistory(`${originalQuestion} (${selectedOption})`, false, data.sql || '', null);
        setHistoryKey((k) => k + 1);
        return;
      }

      if (data.dbType) setQueryDbType(data.dbType);
      setSql(data.sql);
      setExplanation(data.explanation || '');
      setColumns(data.columns);
      setRows(data.rows);
      setExecutionTime(data.executionTime ?? null);
      setRowCount(data.rowCount ?? data.rows?.length ?? null);
      if (data.review) setQueryReview(data.review);

      saveToHistory(`${originalQuestion} (${selectedOption})`, true, data.sql || '', data.executionTime);
      setHistoryKey((k) => k + 1);
    } catch (err) {
      console.error('Clarify API error:', err);
      setError('Failed to process clarification.');
      setErrorType('connection_error');
    } finally {
      setIsLoading(false);
      setLoadingMessage('');
    }
  };

  const handleHistorySelect = (question) => {
    setExternalQuestion(question);
  };

  const handleSuggestionClick = (suggestion) => {
    setExternalQuestion(suggestion);
    // Also auto-submit the suggestion
    setTimeout(() => handleQuery(suggestion), 50);
  };

  const handleRetry = () => {
    resetQueryState();
  };

  if (isCheckingAuth) {
    return (
      <div className="app loading-container">
        <div className="loading-dots">
          <span></span>
          <span></span>
          <span></span>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <div className="bg-glow bg-glow-1"></div>
      <div className="bg-glow bg-glow-2"></div>

      {/* Global Navigation Bar */}
      <Navbar
        user={user}
        activePage={activePage}
        onNavigate={setActivePage}
        onLogout={handleLogout}
        dbStatus={dbStatus}
      />

      {/* Page Controller */}
      {!user && activePage === 'login' && (
        <Login
          onLoginSuccess={handleLoginSuccess}
          onNavigateToRegister={() => setActivePage('register')}
        />
      )}

      {!user && activePage === 'register' && (
        <Register
          onRegisterSuccess={handleLoginSuccess}
          onNavigateToLogin={() => setActivePage('login')}
        />
      )}

      {user && activePage === 'dashboard' && (
        <main className="app-main dashboard-view">
          <div className="dashboard-welcome">
            <h2>Welcome back, {user.name} 👋</h2>
            <p className="subtitle">Natural Language → SQL Dynamic Platform</p>
          </div>

          <div className="dashboard-cards-grid">
            <div className="dash-card">
              <div className="dash-card-icon">🗄️</div>
              <h3>Database Status</h3>
              <p>
                {dbStatus.connected
                  ? `Connected to ${dbStatus.databaseName}`
                  : 'No database connected'}
              </p>
              <button
                className="btn-dash-action"
                onClick={() => setActivePage('database')}
              >
                {dbStatus.connected ? 'Manage Database' : 'Connect Your Database'}
              </button>
            </div>

            <div className="dash-card">
              <div className="dash-card-icon">💬</div>
              <h3>Natural Language Query</h3>
              <p>Ask questions in plain English to query data</p>
              <button
                className="btn-dash-action"
                onClick={() => { setQueryMode('read'); setActivePage('query'); }}
              >
                Open Query Console
              </button>
            </div>

            <div className="dash-card">
              <div className="dash-card-icon">✏️</div>
              <h3>Write Operations</h3>
              <p>Add, update, or delete records using natural language</p>
              <button
                className="btn-dash-action"
                onClick={() => { setQueryMode('write'); setActivePage('query'); }}
              >
                Open Write Console
              </button>
            </div>
          </div>
        </main>
      )}

      {user && activePage === 'database' && (
        <main className="app-main database-view">
          <DatabaseConnect
            token={token}
            dbStatus={dbStatus}
            onStatusChange={(newStatus) => setDbStatus(newStatus)}
            onNavigateToQuery={() => setActivePage('query')}
          />
        </main>
      )}

      {/* Natural Language Query Console */}
      {user && activePage === 'query' && (
        <main className="app-main query-view">
          {/* Connection status banner */}
          {dbStatus.connected && (
            <div className="query-db-banner">
              <span className="banner-dot connected"></span>
              <span>
                {dbStatus.dbType === 'mongodb' ? '🍃' : dbStatus.dbType === 'mysql' ? '🐬' : dbStatus.dbType === 'sqlite' ? '🗄️' : '🐘'}{' '}
                Connected: <strong>{dbStatus.databaseName || dbStatus.connectionName}</strong>
              </span>
              <span className="banner-tables">
                {dbStatus.tableCount} {dbStatus.dbType === 'mongodb' ? 'collections' : 'tables'}
              </span>
            </div>
          )}

          {!dbStatus.connected && (
            <div className="query-db-banner disconnected">
              <span className="banner-dot"></span>
              <span>No database connected</span>
              <button className="banner-action" onClick={() => setActivePage('database')}>
                Connect Database
              </button>
            </div>
          )}

          <header className="query-view-header">
            <div className="logo">
              <span className="logo-icon">⚡</span>
              <h1>Natural Language → SQL</h1>
            </div>
            <p className="subtitle">Ask questions about your data in plain English</p>
          </header>

          {/* Mode Toggle: Read / Write */}
          <div className="query-mode-toggle">
            <button
              className={`mode-btn ${queryMode === 'read' ? 'active' : ''}`}
              onClick={() => setQueryMode('read')}
            >
              🔍 Read (Query)
            </button>
            <button
              className={`mode-btn ${queryMode === 'write' ? 'active' : ''}`}
              onClick={() => setQueryMode('write')}
            >
              ✏️ Write (Modify)
            </button>
          </div>

          {queryMode === 'read' && (
            <QueryInput
              onSubmit={handleQuery}
              isLoading={isLoading}
              externalQuestion={externalQuestion}
              onExternalQuestionConsumed={() => setExternalQuestion('')}
            />
          )}

          {queryMode === 'write' && (
            <MutationPanel token={token} dbStatus={dbStatus} />
          )}

          {/* Schema-aware suggestions */}
          {queryMode === 'read' && !sql && !error && !clarification && !unsupported && !isLoading && (
            <QuerySuggestions
              token={token}
              dbConnected={dbStatus.connected}
              onSuggestionClick={handleSuggestionClick}
              isLoading={isLoading}
            />
          )}

          {queryMode === 'read' && isLoading && (
            <div className="loading-section">
              <div className="loading-dots">
                <span></span>
                <span></span>
                <span></span>
              </div>
              <span>{loadingMessage}</span>
            </div>
          )}

          {/* Clarification UI */}
          {queryMode === 'read' && clarification && (
            <ClarificationBox
              message={clarification.message}
              options={clarification.options}
              originalQuestion={clarification.originalQuestion}
              onSelect={handleClarificationSelect}
              isLoading={isLoading}
            />
          )}

          {/* Unsupported question */}
          {queryMode === 'read' && unsupported && (
            <div className="unsupported-section">
              <div className="unsupported-card">
                <span className="unsupported-icon">🚫</span>
                <div className="unsupported-content">
                  <strong>Cannot answer this question</strong>
                  <p>{unsupported}</p>
                </div>
              </div>
            </div>
          )}

          {/* Error display */}
          {queryMode === 'read' && error && (
            <div className="error-section">
              <div className="error-content">
                <span className="error-icon">
                  {errorType === 'connection_error' ? '🔌' : '❌'}
                </span>
                <div className="error-details">
                  <strong>
                    {errorType === 'connection_error' ? 'Connection Error' :
                     errorType === 'unsupported_question' ? 'Unsupported Question' :
                     'Query Failed'}
                  </strong>
                  <p>{error}</p>
                </div>
              </div>
              <button className="retry-btn" onClick={handleRetry}>
                Try Again
              </button>
            </div>
          )}

          {queryMode === 'read' && (
            <SqlDisplay
              sql={sql}
              dbType={queryDbType || dbStatus.dbType}
              review={queryReview}
            />
          )}
          {queryMode === 'read' && <ExplanationDisplay explanation={explanation} />}
          {queryMode === 'read' && <QueryMetadata
            executionTime={executionTime}
            rowCount={rowCount}
          />}
          {queryMode === 'read' && <ResultTable
            columns={columns}
            rows={rows}
          />}

          {queryMode === 'read' && <QueryHistory
            key={historyKey}
            onSelectQuery={handleHistorySelect}
          />}
        </main>
      )}

      <footer className="app-footer">
        <p>Natural Language → SQL Platform • Multi-User Architecture</p>
      </footer>
    </div>
  );
}
