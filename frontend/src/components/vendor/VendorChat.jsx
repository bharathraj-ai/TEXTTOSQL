import { useState, useRef, useEffect, useMemo } from 'react';
import VendorMessage from './VendorMessage';
import ConfirmationDialog from './ConfirmationDialog';
const API_URL = 'http://localhost:5000/api';
export default function VendorChat({
  token,
  dbStatus,
  currentTable,
  schema,
  user,
  onApplyQueryResult,
  onDatabaseModified,
  onAuthError,
  isOpen = true,
  onClose,
}) {
  const [chatInput, setChatInput] = useState('');
  const [messages, setMessages] = useState([
    {
      role: 'intella',
      text: `Hello${user?.name ? ' ' + user.name : ''}! I am Intella, your AI Database Copilot. Ask questions, explore data, or request modifications for ${currentTable ? `table "${currentTable}"` : 'your connected database'}.`,
    },
  ]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingText, setLoadingText] = useState('');
  const [pendingOp, setPendingOp] = useState(null);
  const [isExecutingOp, setIsExecutingOp] = useState(false);

  const scrollRef = useRef(null);
  const [panelWidth, setPanelWidth] = useState(() => {
    const saved = Number(localStorage.getItem('vendor-chat-width'));
    return saved >= 280 && saved <= 640 ? saved : 360;
  });

  const clampWidth = (value) => Math.min(640, Math.max(280, value));

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isLoading, loadingText]);

  useEffect(() => {
    localStorage.setItem('vendor-chat-width', String(panelWidth));
  }, [panelWidth]);

  // Generate dynamic, schema-aware suggestions based strictly on existing columns
  const suggestions = useMemo(() => {
    if (!currentTable || !schema?.tables?.[currentTable]) {
      return [
        'Show tables in this database',
        'Count total records',
      ];
    }

    const tableInfo = schema.tables[currentTable];
    const columns = Object.keys(tableInfo.columns || {});
    const items = [];

    // Find numeric / currency columns
    const numericCols = columns.filter((col) => {
      const type = String(tableInfo.columns[col] || '').toLowerCase();
      return /int|numeric|decimal|float|double|budget|revenue|price|amount|score|mark|salary/i.test(type + col);
    });

    // Find categorical / department columns
    const categoryCols = columns.filter((col) => {
      const type = String(tableInfo.columns[col] || '').toLowerCase();
      return /varchar|text|char|department|dept|status|category|role|type|city/i.test(type + col);
    });

    // Find date columns
    const dateCols = columns.filter((col) => {
      const type = String(tableInfo.columns[col] || '').toLowerCase();
      return /date|time|timestamp|created|updated/i.test(type + col);
    });

    if (numericCols.length > 0) {
      const numCol = numericCols[0];
      items.push(`Show top 10 ${currentTable} by ${numCol}`);
      items.push(`Show ${currentTable} with ${numCol} above 500000`);
    } else {
      items.push(`Show top 10 ${currentTable}`);
    }

    if (categoryCols.length > 0) {
      items.push(`Group ${currentTable} by ${categoryCols[0]}`);
    }

    if (dateCols.length > 0) {
      items.push(`Show recent ${currentTable}`);
    } else {
      items.push(`Find missing values in ${currentTable}`);
    }

    return items.slice(0, 4);
  }, [currentTable, schema]);

  const handleSendMessage = async (textToSend) => {
    const query = (textToSend || chatInput).trim();
    if (!query || isLoading) return;

    setChatInput('');
    setMessages((prev) => [...prev, { role: 'you', text: query }]);
    setIsLoading(true);
    setLoadingText('Intella is analyzing your database...');

    const loadingPhases = [
      'Intella is analyzing your database...',
      'Checking schema and intent...',
      'Generating query...',
    ];
    let step = 0;
    const interval = setInterval(() => {
      step = (step + 1) % loadingPhases.length;
      setLoadingText(loadingPhases[step]);
    }, 450);

    try {
      const res = await fetch(`${API_URL}/query`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          query,
          currentTable,
          connectionId: dbStatus.connectionId,
        }),
      });

      clearInterval(interval);

      if (res.status === 401) {
        onAuthError?.('Your session has expired. Please log in again.');
        return;
      }

      const data = await res.json();

      // Case 1: Pure conversation (e.g. "Hi", "Hello", "Thanks")
      if (data.type === 'conversation' || data.type === 'schema_overview') {
        setMessages((prev) => [
          ...prev,
          {
            role: 'intella',
            text: data.message,
            sql: null,
            intent: null,
          },
        ]);
        return;
      }

      if (data.type === 'clarification_required' || data.type === 'entity_not_found') {
        setMessages((prev) => [
          ...prev,
          {
            role: 'intella',
            text: data.message || data.error,
            sql: null,
            intent: null,
            suggestions: data.options || [],
            language: data.language,
            normalizedRequest: data.normalizedRequest,
          },
        ]);
        return;
      }

      // Case 2: Confirmation required for write/modification operation
      if (data.type === 'confirmation_required') {
        setPendingOp(data);
        setMessages((prev) => [
          ...prev,
          {
            role: 'intella',
            text: `${data.intent || 'Operation'} prepared for table "${data.targetTable || currentTable}". Review and confirm to execute.`,
            sql: data.sql,
            intent: data.intent,
            riskLevel: data.riskLevel,
            columnValues: data.columnValues || null,
            language: data.language,
            normalizedRequest: data.normalizedRequest,
          },
        ]);
        return;
      }

      // Case 3: Blocked operation or validation error
      if (!data.success || data.type === 'operation_blocked' || data.type === 'safety_review_rejected') {
        setMessages((prev) => [
          ...prev,
          {
            role: 'intella',
            text: data.review?.reason || data.error || 'The operation could not be executed.',
            sql: data.sql,
            intent: 'BLOCKED',
            riskLevel: 'HIGH',
            error: data.error,
          },
        ]);
        return;
      }

      // Case 4: Query result (SELECT)
      const rowCount = data.rowCount ?? data.rows?.length ?? 0;
      let summaryText = `Found ${rowCount} matching ${rowCount === 1 ? 'record' : 'records'}.`;
      if (data.explanation) {
        summaryText = `${data.explanation} (${rowCount} ${rowCount === 1 ? 'row' : 'rows'})`;
      }

      setMessages((prev) => [
        ...prev,
        {
          role: 'intella',
          text: summaryText,
          sql: data.sql,
          intent: 'SELECT',
          riskLevel: 'LOW',
          language: data.language,
          normalizedRequest: data.normalizedRequest,
          hasResults: Array.isArray(data.rows) && data.rows.length > 0,
          resultData: {
            columns: (data.columns || []).map((c) => (typeof c === 'string' ? { name: c, type: 'text' } : c)),
            rows: data.rows || [],
            total: rowCount,
            executionTime: data.executionTime,
            querySql: data.sql,
          },
        },
      ]);

      if (data.rows && onApplyQueryResult) {
        onApplyQueryResult({
          columns: (data.columns || []).map((c) => (typeof c === 'string' ? { name: c, type: 'text' } : c)),
          rows: data.rows || [],
          total: rowCount,
          executionTime: data.executionTime,
          querySql: data.sql,
        });
      }
    } catch (err) {
      clearInterval(interval);
      setMessages((prev) => [
        ...prev,
        {
          role: 'intella',
          text: 'Failed to communicate with the query service. Please verify your connection.',
          error: err.message,
        },
      ]);
    } finally {
      clearInterval(interval);
      setIsLoading(false);
      setLoadingText('');
    }
  };

  const handleConfirmPending = async (confirmationText) => {
    if (!pendingOp?.operationId) return;

    setIsExecutingOp(true);
    try {
      const res = await fetch(`${API_URL}/query/confirm`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          operationId: pendingOp.operationId,
          confirmationText: confirmationText || '',
        }),
      });

      const data = await res.json();
      if (!data.success) {
        throw new Error(data.error || 'Operation failed during confirmation.');
      }

      setMessages((prev) => [
        ...prev,
        {
          role: 'intella',
          text: `✓ ${data.message || 'Operation executed successfully.'}${data.affectedRows != null ? ` (${data.affectedRows} affected)` : ''}`,
          sql: data.sql || pendingOp.sql,
          intent: data.operation || pendingOp.intent,
          riskLevel: 'LOW',
        },
      ]);

      setPendingOp(null);
      if (onDatabaseModified) {
        onDatabaseModified(pendingOp.targetTable || currentTable);
      }
    } catch (err) {
      const message = err.message || 'Operation failed during confirmation.';
      const terminal = /already ran|not authorized|expired|cancelled|already executing|authentication|session|invalid authentication/i.test(message);
      if (terminal) setPendingOp(null);
      setMessages((prev) => [
        ...prev,
        {
          role: 'intella',
          text: `Execution failed: ${err.message}`,
          error: err.message,
        },
      ]);
    } finally {
      setIsExecutingOp(false);
    }
  };

  const startResize = (event) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = panelWidth;
    const onMove = (moveEvent) => {
      setPanelWidth(clampWidth(startWidth + (startX - moveEvent.clientX)));
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  return (
    <aside
      className={`intella-copilot-drawer ${isOpen ? 'is-open' : 'is-closed'}`}
      style={isOpen ? { width: panelWidth } : undefined}
      aria-label="Intella AI Database Copilot"
    >
      <div
        className="copilot-resize-handle"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize Intella chat"
        title="Drag to resize"
        onPointerDown={startResize}
        onDoubleClick={() => setPanelWidth(360)}
      />
      {/* 1. Copilot Header */}
      <div className="copilot-drawer-header">
        <div className="copilot-header-info">
          <div className="copilot-brand-badge-wrap">
            <span className="copilot-identity-mark" aria-hidden="true">In</span>
            <div className="copilot-title-column">
              <div className="copilot-main-title">
                <strong>Intella</strong>
              </div>
              <div className="copilot-role-line">AI Database Copilot</div>
              <div className="copilot-connected-status">
                <span className={`status-live-dot ${dbStatus?.connected ? '' : 'is-offline'}`} />
                <span>{dbStatus?.connected ? 'Connected' : 'Offline'}</span>
                {dbStatus?.dbType ? <span className="copilot-engine-label">{dbStatus.dbType}</span> : null}
              </div>
              <div className="copilot-working-with">
                Working with <strong>{currentTable || 'your database'}</strong>
              </div>
            </div>
          </div>
        </div>

        {onClose && (
          <button
            type="button"
            className="copilot-close-action-btn"
            onClick={onClose}
            title="Minimize Intella"
            aria-label="Minimize Intella"
          >
            ×
          </button>
        )}
      </div>

      {/* 2. Try Asking Suggestion Cards */}
      <div className="copilot-suggestions-container">
        <div className="suggestions-section-title">TRY ASKING</div>
        <div className="suggestions-cards-stack">
          {suggestions.map((s, idx) => (
            <button
              key={idx}
              type="button"
              className="copilot-suggestion-card"
              onClick={() => handleSendMessage(s)}
            >
              <span className="card-sparkle">✦</span>
              <span className="card-suggestion-text">{s}</span>
            </button>
          ))}
        </div>
      </div>

      {/* 3. Messages Thread */}
      <div className="copilot-messages-thread" ref={scrollRef}>
        {messages.map((m, idx) => (
          <VendorMessage
            key={idx}
            message={m}
            onViewResults={(res) => onApplyQueryResult && onApplyQueryResult(res)}
            onSelectSuggestion={(s) => handleSendMessage(s)}
          />
        ))}

        {isLoading && (
          <div className="copilot-msg-card intella-msg loading-msg">
            <div className="typing-dots-indicator">
              <span />
              <span />
              <span />
            </div>
            <p className="loading-status-message">{loadingText}</p>
          </div>
        )}
      </div>

      {/* 4. Table Context Indicator + Input Area */}
      <div className="copilot-input-zone">
        <div className="copilot-context-bar">
          <span className="context-label">Context:</span>
          <span className="context-table-pill">
            <span className="context-dot-mini" />
            {currentTable || 'database'}
          </span>
        </div>

        <form
          className="copilot-input-form"
          onSubmit={(e) => {
            e.preventDefault();
            handleSendMessage();
          }}
        >
          <div className="copilot-input-box-wrapper">
            <input
              type="text"
              className="copilot-text-field"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              placeholder={currentTable ? `Ask Intella about ${currentTable}...` : 'Ask Intella about your database...'}
              aria-label="Ask Intella"
              disabled={isLoading}
            />
            <button
              type="submit"
              className="copilot-submit-btn"
              disabled={!chatInput.trim() || isLoading}
              title="Ask Intella"
              aria-label="Ask Intella"
            >
              Send →
            </button>
          </div>
        </form>
      </div>

      {/* 5. Safe Confirmation Dialog */}
      {pendingOp && (
        <ConfirmationDialog
          pending={pendingOp}
          onConfirm={handleConfirmPending}
          onCancel={() => setPendingOp(null)}
          isExecuting={isExecutingOp}
        />
      )}
    </aside>
  );
}
