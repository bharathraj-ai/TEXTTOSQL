import { useState, useEffect } from 'react';
import Navbar from './components/Navbar';
import Login from './pages/Login';
import Register from './pages/Register';
import QueryInput from './components/QueryInput';
import SqlDisplay from './components/SqlDisplay';
import ExplanationDisplay from './components/ExplanationDisplay';
import QueryMetadata from './components/QueryMetadata';
import DatabaseWorkspace from './components/DatabaseWorkspace';
import QueryHistory, { saveToHistory } from './components/QueryHistory';
import DatabaseConnect from './components/DatabaseConnect';
import ClarificationBox from './components/ClarificationBox';
import QuerySuggestions from './components/QuerySuggestions';

const PHASE_LABELS = {
  idle: '',
  thinking: 'Understanding your request...',
  generating: 'Generating SQL...',
  validating: 'Validating query...',
  reviewing: 'AI safety review...',
  awaiting_confirmation: 'Waiting for confirmation...',
  executing: 'Executing...',
  success: 'Success',
  error: 'Something went wrong.',
  blocked: 'Blocked',
};

const API_URL = 'http://localhost:5000/api';

export default function App() {
  // ── Auth & Navigation State ─────────────────────────
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(localStorage.getItem('nl_sql_token') || '');
  const [activePage, setActivePage] = useState('login');
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const [authNotice, setAuthNotice] = useState('');

  // ── Handle auth error / expired session ─────────────
  const handleAuthError = (message) => {
    localStorage.removeItem('nl_sql_token');
    setUser(null);
    setToken('');
    setDbStatus({
      connected: false,
      connectionName: '',
      databaseName: '',
      host: '',
      dbType: '',
      tableCount: 0,
      tables: [],
    });
    setAuthNotice(message || 'Your session has expired or is invalid. Please log in again.');
    setActivePage('login');
  };

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

  const [queryReview, setQueryReview] = useState(null);
  const [pipelinePhase, setPipelinePhase] = useState('idle');
  const [conversation, setConversation] = useState(null);
  const [pendingOp, setPendingOp] = useState(null);
  const [writeResult, setWriteResult] = useState(null);
  const [askedQuestion, setAskedQuestion] = useState('');
  const [schemaTree, setSchemaTree] = useState(null);
  const [errorDetail, setErrorDetail] = useState('');
  const [showErrorDetail, setShowErrorDetail] = useState(false);

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
      if (res.status === 401) {
        handleAuthError('Your session has expired or is invalid. Please log in again.');
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
          tableCount: data.tableCount || 0,
          tables: data.tables || [],
          connectionId: data.connectionId || null,
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
    setAuthNotice('');
    setUser(userData);
    setToken(userToken);
    setActivePage('dashboard');
    fetchDbStatus(userToken);
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
    setDbStatus({ connected: false, connectionName: '', databaseName: '', host: '', dbType: '', tableCount: 0, tables: [] });
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
    setConversation(null);
    setPendingOp(null);
    setWriteResult(null);
    setErrorDetail('');
    setShowErrorDetail(false);
    setPipelinePhase('idle');
  };

  const loadSchema = async (userToken) => {
    const t = userToken || token;
    if (!t) return;
    try {
      const res = await fetch('http://localhost:5000/api/database/schema', {
        headers: { Authorization: `Bearer ${t}` },
      });
      const data = await res.json();
      if (data.success && data.schema) setSchemaTree(data.schema);
    } catch {
      setSchemaTree(null);
    }
  };

  useEffect(() => {
    if (user && (activePage === 'query' || activePage === 'dashboard')) {
      loadSchema(token);
    }
  }, [user, activePage, token]);

  // ── Main query handler ──────────────────────────────
  const handleQuery = async (question) => {
    resetQueryState();
    setAskedQuestion(question);
    setIsLoading(true);
    setPipelinePhase('thinking');
    const phases = ['thinking', 'generating', 'validating', 'reviewing'];
    let step = 0;
    const timer = setInterval(() => {
      step = Math.min(step + 1, phases.length - 1);
      setPipelinePhase(phases[step]);
      setLoadingMessage(PHASE_LABELS[phases[step]]);
    }, 400);

    try {
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers.Authorization = `Bearer ${token}`;

      const response = await fetch(`${API_URL}/query`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ query: question }),
      });
      const data = await response.json();
      clearInterval(timer);

      if (response.status === 401) {
        handleAuthError('Your session has expired or is invalid. Please log in again.');
        return;
      }

      if (data.type === 'conversation') {
        setPipelinePhase('success');
        setConversation(data);
        saveToHistory(question, true, '', null, { operation: 'CHAT', status: 'success' });
        setHistoryKey((k) => k + 1);
        return;
      }

      if (data.type === 'confirmation_required') {
        setPipelinePhase('awaiting_confirmation');
        setPendingOp(data);
        setSql(data.sql || '');
        if (data.review) setQueryReview(data.review);
        saveToHistory(question, true, data.sql || '', null, {
          operation: data.intent || 'WRITE',
          status: 'awaiting confirmation',
        });
        setHistoryKey((k) => k + 1);
        return;
      }

      if (data.type === 'operation_blocked' || data.type === 'safety_review_rejected') {
        setPipelinePhase('blocked');
        setPendingOp(data);
        setSql(data.sql || '');
        setError(data.review?.reason || data.error || 'This operation was blocked because it could modify or destroy database structure.');
        setErrorType('blocked');
        setErrorDetail((data.review?.issues || []).join('\n'));
        if (data.review) setQueryReview(data.review);
        saveToHistory(question, false, data.sql || '', null, {
          operation: data.intent || 'BLOCKED',
          status: 'blocked',
        });
        setHistoryKey((k) => k + 1);
        return;
      }

      if (!data.success) {
        setPipelinePhase('error');
        if (data.type === 'clarification_required') {
          setClarification({
            message: data.message,
            options: data.options || [],
            originalQuestion: data.originalQuestion || question,
          });
        } else if (data.type === 'unsupported_question') {
          setUnsupported(data.message || 'This question cannot be answered using the connected database.');
        } else if (data.type === 'validation_error') {
          setError('The generated query could not be validated.');
          setErrorDetail(data.error || '');
          setErrorType('validation_error');
          if (data.sql) setSql(data.sql);
        } else {
          setError('Something went wrong. The query could not be executed.');
          setErrorDetail(data.error || '');
          setErrorType(data.type || 'query_error');
          if (data.sql) setSql(data.sql);
        }
        saveToHistory(question, false, data.sql || '', null, { operation: data.intent || '', status: 'failed' });
        setHistoryKey((k) => k + 1);
        return;
      }

      setPipelinePhase('success');
      if (data.dbType) setQueryDbType(data.dbType);
      setSql(data.sql || '');
      setExplanation(data.explanation || '');
      setColumns(data.columns);
      setRows(data.rows);
      setExecutionTime(data.executionTime ?? null);
      setRowCount(data.rowCount ?? data.rows?.length ?? null);
      if (data.review) setQueryReview(data.review);
      saveToHistory(question, true, data.sql || '', data.executionTime, { operation: 'SELECT', status: 'success' });
      setHistoryKey((k) => k + 1);
    } catch (err) {
      clearInterval(timer);
      console.error('API error:', err);
      setPipelinePhase('error');
      setError('Something went wrong. The query could not be executed.');
      setErrorType('connection_error');
      saveToHistory(question, false, '', null, { status: 'failed' });
      setHistoryKey((k) => k + 1);
    } finally {
      clearInterval(timer);
      setIsLoading(false);
      setLoadingMessage('');
    }
  };

  const handleConfirmOperation = async () => {
    if (!pendingOp?.operationId) return;
    setIsLoading(true);
    setPipelinePhase('executing');
    setLoadingMessage(PHASE_LABELS.executing);
    setError('');
    try {
      const response = await fetch(`${API_URL}/query/confirm`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ operationId: pendingOp.operationId }),
      });
      const data = await response.json();
      if (!data.success) {
        setPipelinePhase('error');
        setError('Something went wrong. The query could not be executed.');
        setErrorDetail(data.error || '');
        setErrorType('query_error');
        return;
      }
      setPipelinePhase('success');
      setWriteResult(data);
      setSql(data.sql || pendingOp.sql || '');
      setExecutionTime(data.executionTime ?? null);
      setPendingOp(null);
      saveToHistory(askedQuestion, true, data.sql || '', data.executionTime, {
        operation: data.operation || 'WRITE',
        status: 'success',
      });
      setHistoryKey((k) => k + 1);
      fetchDbStatus(token);
      loadSchema(token);
    } catch {
      setPipelinePhase('error');
      setError('Something went wrong. The query could not be executed.');
      setErrorType('connection_error');
    } finally {
      setIsLoading(false);
      setLoadingMessage('');
    }
  };

  const handleCancelOperation = () => {
    setPendingOp(null);
    setPipelinePhase('idle');
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
    <div className={`app${activePage === 'query' ? ' app-browser' : ''}`}>
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
          onNavigateToRegister={() => {
            setAuthNotice('');
            setActivePage('register');
          }}
          initialNotice={authNotice}
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
              <h3>Database Workspace</h3>
              <p>Browse tables and ask @vendor about the connected database</p>
              <button
                className="btn-dash-action"
                onClick={() => setActivePage('query')}
              >
                Open Database Workspace
              </button>
            </div>

            <div className="dash-card">
              <div className="dash-card-icon">✏️</div>
              <h3>Write Operations</h3>
              <p>Add, update, delete, or change schema. Changes ask for confirmation.</p>
              <button
                className="btn-dash-action"
                onClick={() => setActivePage('query')}
              >
                Open Console
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
            onAuthError={handleAuthError}
          />
        </main>
      )}

      {user && activePage === 'query' && (
        <main className="app-main query-view">
          {dbStatus.connected ? (
            <DatabaseWorkspace
              token={token}
              dbStatus={dbStatus}
              onAuthError={handleAuthError}
            />
          ) : (
            <div className="query-empty-state">
              <div className="empty-state-content">
                <span className="empty-icon">🗄️</span>
                <h3>Connect a database</h3>
                <p>The workspace opens after a successful connection.</p>
                <button className="btn btn-primary" onClick={() => setActivePage('database')}>
                  Connect Database
                </button>
              </div>
            </div>
          )}
        </main>
      )}

      <footer className="app-footer">
        <p>Natural Language → SQL Platform • Multi-User Architecture</p>
      </footer>
    </div>
  );
}
