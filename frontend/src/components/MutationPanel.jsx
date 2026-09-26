import { useState } from 'react';

const API_URL = 'http://localhost:5000/api';

/**
 * MutationPanel — Day 5 Safe Database Modification & AI Review Console
 *
 * Implements the 10-step architecture:
 * Natural Language → Local Intent → Schema → Local SQL Generator → Local SQL Validator
 * → OpenRouter Semantic Reviewer → Risk Assessment → User Confirmation → Local Final Check → Execution
 */
export default function MutationPanel({ token, dbStatus, onExecutionSuccess, onAuthError }) {
  const [question, setQuestion] = useState('');
  const [stagedQuestion, setStagedQuestion] = useState('');
  const [isStaging, setIsStaging] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);

  // Staged plan
  const [stagedPlan, setStagedPlan] = useState(null);

  // Result after confirm
  const [mutationResult, setMutationResult] = useState(null);

  // Errors
  const [error, setError] = useState('');

  const resetAll = () => {
    setStagedPlan(null);
    setMutationResult(null);
    setError('');
  };

  // ── Stage a mutation ─────────────────────────────
  const handleStage = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    if (!question.trim() || isStaging) return;

    const currentQuery = question.trim();
    resetAll();
    setIsStaging(true);
    setStagedQuestion(currentQuery);

    try {
      const res = await fetch(`${API_URL}/mutation/stage`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ question: currentQuery }),
      });
      const data = await res.json();

      if (res.status === 401) {
        const msg = data.error || 'Your session has expired or is invalid. Please log in again.';
        setError(msg);
        if (onAuthError) onAuthError(msg);
        return;
      }

      if (!data.success) {
        setError(data.error || 'Failed to stage the operation.');
        return;
      }

      setStagedPlan(data);
    } catch (err) {
      console.error('Stage error:', err);
      setError('Failed to connect to the server.');
    } finally {
      setIsStaging(false);
    }
  };

  // ── Confirm and execute ──────────────────────────
  const handleConfirm = async () => {
    if (!(stagedPlan?.operationId || stagedPlan?.confirmationToken) || isConfirming || stagedPlan.canConfirm === false) return;
    setIsConfirming(true);
    setError('');

    try {
      const res = await fetch(`${API_URL}/query/confirm`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ operationId: stagedPlan.operationId || stagedPlan.confirmationToken }),
      });
      const data = await res.json();

      if (res.status === 401) {
        const msg = data.error || 'Your session has expired or is invalid. Please log in again.';
        setError(msg);
        if (onAuthError) onAuthError(msg);
        return;
      }

      if (!data.success) {
        setError(data.error || 'Failed to execute the operation.');
        return;
      }

      setMutationResult(data);
      setStagedPlan(null);
      if (onExecutionSuccess) onExecutionSuccess();
    } catch (err) {
      console.error('Confirm error:', err);
      setError('Failed to connect to the server.');
    } finally {
      setIsConfirming(false);
    }
  };

  // ── Cancel staged plan ───────────────────────────
  const handleCancel = () => {
    setStagedPlan(null);
    setError('');
  };

  // ── Apply suggestion from reviewer ───────────────
  const handleApplySuggestion = (suggestedSql) => {
    if (!suggestedSql) return;
    setQuestion(suggestedSql);
    setStagedPlan(null);
    setError('');
  };

  // ── New operation ────────────────────────────────
  const handleNewOperation = () => {
    setQuestion('');
    setStagedQuestion('');
    resetAll();
  };

  const intentIcon = (intent) => {
    switch (intent) {
      case 'INSERT': return '➕';
      case 'UPDATE': return '✏️';
      case 'DELETE': return '🗑️';
      case 'DROP': return '🚨';
      case 'TRUNCATE': return '⚠️';
      case 'CREATE': return '📦';
      case 'ALTER': return '🔧';
      default: return '📝';
    }
  };

  const intentColor = (intent) => {
    switch (intent) {
      case 'INSERT': return 'var(--success, #00b894)';
      case 'UPDATE': return 'var(--accent, #6c5ce7)';
      case 'DELETE': return '#e17055';
      case 'DROP': return 'var(--error, #e74c3c)';
      case 'TRUNCATE': return '#d63031';
      case 'CREATE': return '#0984e3';
      case 'ALTER': return '#fdcb6e';
      default: return 'var(--text-secondary)';
    }
  };

  const isCritical = stagedPlan?.riskLevel === 'CRITICAL' || stagedPlan?.review?.risk === 'CRITICAL' || stagedPlan?.intent === 'DROP';
  const isApproved = stagedPlan?.review ? stagedPlan.review.approved : (stagedPlan?.canConfirm ?? true);
  const currentRisk = stagedPlan?.review?.risk || stagedPlan?.riskLevel || 'MEDIUM';

  return (
    <section className="mutation-panel">
      <div className="section-header">
        <div className="section-icon">✏️</div>
        <div>
          <h2>Safe Database Modifications</h2>
          <p className="section-subtitle" style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            Natural Language write operations verified by OpenRouter AI Safety Reviewer & Local Security Layer
          </p>
        </div>
      </div>

      {!dbStatus.connected && (
        <div className="mutation-warning-card" style={{ marginBottom: '1rem' }}>
          <span>⚠️</span>
          <p>Connect a database first to use write operations.</p>
        </div>
      )}

      {/* ── Input Form ─────────────────────────── */}
      {!stagedPlan && !mutationResult && (
        <form onSubmit={handleStage} className="query-form">
          <div className="input-wrapper">
            <textarea
              id="mutation-textarea"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder={`Describe what you want to change, e.g. "Add a student named Rahul in CSE with mark 85" or "Delete students where mark < 40"`}
              rows={2}
              disabled={isStaging || !dbStatus.connected}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleStage(e);
                }
              }}
            />
            <button
              type="submit"
              className="run-btn mutation-stage-btn"
              disabled={!question.trim() || isStaging || !dbStatus.connected}
              id="stage-mutation-btn"
            >
              {isStaging ? (
                <>
                  <span className="spinner"></span>
                  Reviewing Safety...
                </>
              ) : (
                <>
                  <span className="btn-icon">🛡️</span>
                  Stage & Review
                </>
              )}
            </button>
          </div>
        </form>
      )}

      {/* ── Error Display ──────────────────────── */}
      {error && (
        <div className="error-section" style={{ marginTop: '1rem' }}>
          <div className="error-content">
            <span className="error-icon">❌</span>
            <div className="error-details">
              <strong>Operation Blocked / Failed</strong>
              <p>{error}</p>
            </div>
          </div>
          <button className="retry-btn" onClick={() => { setError(''); setStagedPlan(null); }}>
            Try Again
          </button>
        </div>
      )}

      {/* ── Staged Plan Review (Section 10 Confirmation UI) ── */}
      {stagedPlan && !mutationResult && (
        <div className={`staged-plan-card ${isCritical ? 'critical-card' : ''}`} style={{ animation: 'fade-slide-up 0.3s ease-out' }}>
          
          {/* Critical Header Banner for DROP / CRITICAL */}
          {isCritical ? (
            <div className="critical-operation-banner">
              <div className="critical-header">
                <span className="critical-icon">🚨</span>
                <div>
                  <h3 className="critical-title">CRITICAL DATABASE OPERATION</h3>
                  <p className="critical-sub">
                    Operation: <strong>{stagedPlan.intent || 'DROP TABLE'}</strong> on table <strong>{stagedPlan.targetTable}</strong>
                  </p>
                  <p className="critical-warning-text">⚠️ This permanently removes the table and its data.</p>
                </div>
              </div>
            </div>
          ) : (
            <div className="normal-modification-banner">
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                <span style={{ fontSize: '1.4rem' }}>⚠️</span>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 600 }}>Database Modification</h3>
                  <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Review the operation before confirmation</span>
                </div>
              </div>
            </div>
          )}

          {/* User Request Context */}
          <div className="staged-meta-row" style={{ marginTop: '0.75rem' }}>
            <div className="staged-meta-item">
              <span className="meta-label">Your request:</span>
              <p className="meta-value-quote">"{stagedQuestion || question}"</p>
            </div>
          </div>

          {/* Operation & Target Table Header */}
          <div className="staged-plan-header">
            <div className="staged-plan-intent" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <span style={{ fontSize: '1.6rem' }}>{intentIcon(stagedPlan.intent)}</span>
              <div>
                <span className="mutation-badge" style={{
                  borderColor: intentColor(stagedPlan.intent),
                  color: intentColor(stagedPlan.intent),
                  background: `${intentColor(stagedPlan.intent)}15`,
                  fontWeight: 600,
                }}>
                  {stagedPlan.intent}
                </span>
                <span style={{ marginLeft: '0.5rem', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                  on <strong style={{ color: 'var(--text-primary)' }}>{stagedPlan.targetTable}</strong>
                </span>
              </div>
            </div>

            {/* Risk Badge */}
            <span className={`risk-pill risk-${currentRisk.toLowerCase()}`}>
              Risk: {currentRisk}
            </span>
          </div>

          {/* SQL Preview */}
          <div className="staged-sql-preview">
            <div className="staged-sql-label">Generated SQL:</div>
            <pre className="staged-sql-code">{stagedPlan.sql}</pre>
          </div>

          {/* OpenRouter AI Safety Review Card */}
          <div className={`ai-review-card ${isApproved ? 'approved' : 'rejected'}`}>
            <div className="ai-review-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ fontSize: '1.2rem' }}>{isApproved ? '🛡️' : '❌'}</span>
                <div>
                  <strong style={{ fontSize: '0.95rem' }}>AI Safety Review</strong>
                  <div className="review-status-text" style={{ fontSize: '0.8rem', color: isApproved ? 'var(--success, #00b894)' : 'var(--error, #e74c3c)' }}>
                    {isApproved ? '✓ SQL matches the requested operation' : '❌ Generated operation may not match the user\'s request'}
                  </div>
                </div>
              </div>
              <span className={`risk-badge-review risk-${currentRisk.toLowerCase()}`}>
                {currentRisk}
              </span>
            </div>

            <div className="ai-review-body">
              {stagedPlan.review?.reason && (
                <p className="review-reason-text">
                  <strong>Assessment:</strong> {stagedPlan.review.reason}
                </p>
              )}

              {stagedPlan.review?.issues && stagedPlan.review.issues.length > 0 && (
                <div className="review-issues-box">
                  <span className="issues-label">Detected Issues:</span>
                  <ul className="issues-list">
                    {stagedPlan.review.issues.map((issue, idx) => (
                      <li key={idx}>⚠️ {issue}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Suggested SQL if available */}
              {stagedPlan.review?.suggested_sql && (
                <div className="review-suggestion-box">
                  <div className="suggestion-title">
                    <span>💡</span>
                    <strong>Suggested Safer Alternative ({stagedPlan.review.suggested_operation || 'REPLACE'}):</strong>
                  </div>
                  <pre className="suggestion-code">{stagedPlan.review.suggested_sql}</pre>
                  <button
                    type="button"
                    className="btn-apply-suggestion"
                    onClick={() => handleApplySuggestion(stagedPlan.review.suggested_sql)}
                  >
                    ✏️ Load Suggested Query
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Warnings */}
          {stagedPlan.warnings && stagedPlan.warnings.length > 0 && (
            <div className="staged-warnings">
              {stagedPlan.warnings.map((w, i) => (
                <div key={i} className="staged-warning-item">
                  <span>⚠️</span>
                  <span>{w}</span>
                </div>
              ))}
            </div>
          )}

          {/* Estimated rows */}
          {stagedPlan.estimatedRows != null && (
            <div className="staged-estimate">
              Estimated affected rows: <strong>{stagedPlan.estimatedRows}</strong>
            </div>
          )}

          {/* ── Confirm / Cancel Actions ── */}
          <div className="staged-actions">
            {isApproved && stagedPlan.canConfirm ? (
              <>
                <button
                  className="confirm-btn"
                  onClick={handleConfirm}
                  disabled={isConfirming}
                  id="confirm-mutation-btn"
                  style={{
                    borderColor: currentRisk === 'HIGH' ? '#e67e22' : undefined,
                    background: currentRisk === 'HIGH' ? 'rgba(230, 126, 34, 0.15)' : undefined,
                  }}
                >
                  {isConfirming ? (
                    <>
                      <span className="spinner"></span>
                      Executing...
                    </>
                  ) : (
                    '✅ Confirm & Execute'
                  )}
                </button>
                <button className="cancel-btn" onClick={handleCancel} disabled={isConfirming}>
                  ✕ Cancel
                </button>
              </>
            ) : (
              // Section 10: "Do not provide a normal confirmation button when the safety review rejects the query."
              <div className="rejected-actions-container">
                <div className="blocked-notice-card">
                  <span className="blocked-icon">🛑</span>
                  <div>
                    <strong>Execution Blocked by Safety Review</strong>
                    <p>The safety reviewer rejected this operation or flagged a critical semantic mismatch. Direct execution is prohibited.</p>
                  </div>
                </div>
                <button className="cancel-btn danger-cancel-btn" onClick={handleCancel} id="cancel-rejected-mutation-btn">
                  ✕ Cancel
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Mutation Result ────────────────────── */}
      {mutationResult && (
        <div className="mutation-result-section" style={{ animation: 'fade-slide-up 0.3s ease-out' }}>
          <div className="mutation-card">
            <span className="mutation-icon">{intentIcon(mutationResult.operation)}</span>
            <div className="mutation-info">
              <h3>
                <span className="command-tag">{mutationResult.operation}</span> completed successfully
              </h3>
              <p>{mutationResult.message}</p>
              <div style={{ display: 'flex', gap: '1.5rem', marginTop: '0.5rem', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                <span>Table: <strong>{mutationResult.table}</strong></span>
                <span>Affected rows: <strong>{mutationResult.affectedRows}</strong></span>
                <span>Time: <strong>{mutationResult.executionTime}ms</strong></span>
              </div>
            </div>
          </div>

          {/* Show executed SQL */}
          <div className="staged-sql-preview" style={{ marginTop: '0.75rem' }}>
            <div className="staged-sql-label">Executed SQL</div>
            <pre className="staged-sql-code">{mutationResult.sql}</pre>
          </div>

          <button className="new-operation-btn" onClick={handleNewOperation}>
            🔄 New Operation
          </button>
        </div>
      )}
    </section>
  );
}
