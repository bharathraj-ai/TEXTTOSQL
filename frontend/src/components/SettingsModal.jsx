import { useEffect } from 'react';

export default function SettingsModal({
  isOpen,
  onClose,
  dbStatus,
  user,
  onNavigateToConnections,
}) {
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const isConnected = dbStatus && dbStatus.connected;
  const dbName = dbStatus?.databaseName || 'neondb';
  const dbEngine = dbStatus?.dbType || 'PostgreSQL';

  return (
    <div className="modal-backdrop-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div className="modal-card-dialog settings-modal-card" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="modal-dialog-header">
          <div className="modal-title-group">
            <span className="modal-icon-symbol">⚙️</span>
            <div>
              <h2 className="modal-title-text">Workspace Settings</h2>
              <p className="modal-subtitle-text">Configure database environment and application preferences</p>
            </div>
          </div>
          <button
            type="button"
            className="modal-close-icon-btn"
            onClick={onClose}
            aria-label="Close settings"
          >
            ✕
          </button>
        </div>

        {/* Content Body */}
        <div className="modal-dialog-body settings-body-scroll">
          {/* Section 1: Connected Database Info */}
          <div className="settings-section-card">
            <div className="settings-section-header">
              <span className="section-bullet">●</span>
              <h3>Active Database Connection</h3>
            </div>
            <div className="settings-info-grid">
              <div className="settings-field-cell">
                <span className="field-label">Database Name</span>
                <span className="field-value font-mono font-bold">{dbName}</span>
              </div>
              <div className="settings-field-cell">
                <span className="field-label">Engine</span>
                <span className="field-value font-mono">{dbEngine}</span>
              </div>
              <div className="settings-field-cell">
                <span className="field-label">Status</span>
                <span className="field-value">
                  <span className={`status-pill-sm ${isConnected ? 'status-ok' : 'status-failed'}`}>
                    {isConnected ? '● Connected' : '○ Disconnected'}
                  </span>
                </span>
              </div>
              <div className="settings-field-cell">
                <span className="field-label">Host</span>
                <span className="field-value text-truncate font-mono" title={dbStatus?.host || 'Neon AWS Pooler'}>
                  {dbStatus?.host || 'AWS neon.tech'}
                </span>
              </div>
            </div>

            <div className="settings-action-row mt-3">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  onClose();
                  onNavigateToConnections();
                }}
              >
                Manage Connections →
              </button>
            </div>
          </div>

          <div className="settings-section-card mt-3">
            <div className="settings-section-header">
              <span className="section-bullet">●</span>
              <h3>Intella</h3>
            </div>
            <div className="settings-info-grid">
              <div className="settings-field-cell">
                <span className="field-label">AI Engine</span>
                <span className="field-value font-mono">Groq Llama-3.3-70b-versatile</span>
              </div>
              <div className="settings-field-cell">
                <span className="field-label">Safety Review</span>
                <span className="field-value text-success font-medium">Strict Verification</span>
              </div>
              <div className="settings-field-cell">
                <span className="field-label">Context Scope</span>
                <span className="field-value">Active Table + Full Schema</span>
              </div>
              <div className="settings-field-cell">
                <span className="field-label">Destructive Guard</span>
                <span className="field-value">Phrase Confirmation Required</span>
              </div>
            </div>
          </div>

          {/* Section 3: User Account */}
          <div className="settings-section-card mt-3">
            <div className="settings-section-header">
              <span className="section-bullet">●</span>
              <h3>User Account</h3>
            </div>
            <div className="settings-info-grid">
              <div className="settings-field-cell">
                <span className="field-label">Full Name</span>
                <span className="field-value">{user?.name || 'Bharath Raj'}</span>
              </div>
              <div className="settings-field-cell">
                <span className="field-label">Email Address</span>
                <span className="field-value">{user?.email || 'bharath@example.com'}</span>
              </div>
              <div className="settings-field-cell">
                <span className="field-label">Role</span>
                <span className="field-value font-medium">{user?.role || 'Administrator'}</span>
              </div>
              <div className="settings-field-cell">
                <span className="field-label">Workspace Edition</span>
                <span className="field-value">Intella</span>
              </div>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="modal-dialog-footer">
          <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>
            Close
          </button>
          <button type="button" className="btn btn-primary btn-sm" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
