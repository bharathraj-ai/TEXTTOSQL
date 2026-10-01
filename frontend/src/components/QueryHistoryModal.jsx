import { useState, useEffect } from 'react';

const STORAGE_KEY = 'nl-sql-query-history';

export default function QueryHistoryModal({
  isOpen,
  onClose,
  onSelectQuery,
}) {
  const [history, setHistory] = useState([]);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (isOpen) {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const list = JSON.parse(raw);
          if (Array.isArray(list)) setHistory(list);
        }
      } catch {
        setHistory([]);
      }
    }
  }, [isOpen]);

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

  const handleClearHistory = () => {
    localStorage.removeItem(STORAGE_KEY);
    setHistory([]);
  };

  const filteredHistory = history.filter((item) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      (item.question && item.question.toLowerCase().includes(q)) ||
      (item.sql && item.sql.toLowerCase().includes(q))
    );
  });

  return (
    <div className="modal-backdrop-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div className="modal-card-dialog history-modal-card" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="modal-dialog-header">
          <div className="modal-title-group">
            <span className="modal-icon-symbol">⌘</span>
            <div>
              <h2 className="modal-title-text">Query History</h2>
              <p className="modal-subtitle-text">Previous questions and executed database statements</p>
            </div>
          </div>
          <button
            type="button"
            className="modal-close-icon-btn"
            onClick={onClose}
            aria-label="Close query history"
          >
            ✕
          </button>
        </div>

        {/* Search Bar */}
        <div className="history-search-row">
          <input
            type="text"
            className="form-control form-control-sm"
            placeholder="Search past queries..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {history.length > 0 && (
            <button
              type="button"
              className="btn btn-secondary btn-xs text-danger"
              onClick={handleClearHistory}
              title="Clear all stored queries"
            >
              Clear All
            </button>
          )}
        </div>

        {/* List */}
        <div className="modal-dialog-body history-body-scroll">
          {filteredHistory.length > 0 ? (
            <div className="history-items-list">
              {filteredHistory.map((item, idx) => (
                <div key={idx} className="history-card-item">
                  <div className="history-item-top">
                    <span className="history-question-text">{item.question || 'Custom Query'}</span>
                    <span className={`status-pill-sm ${item.success ? 'status-ok' : 'status-failed'}`}>
                      {item.success ? 'Success' : 'Failed'}
                    </span>
                  </div>

                  {item.sql && (
                    <div className="history-sql-preview">
                      <code>{item.sql}</code>
                    </div>
                  )}

                  <div className="history-item-bottom">
                    <span className="history-timestamp-label">
                      {item.timestamp
                        ? new Date(item.timestamp).toLocaleString([], {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })
                        : 'Recent'}
                    </span>

                    <button
                      type="button"
                      className="btn btn-primary btn-xs"
                      onClick={() => {
                        onClose();
                        onSelectQuery?.(item.question || item.sql);
                      }}
                    >
                      Ask Intella →
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="history-empty-state">
              <span className="empty-icon">🕐</span>
              <p>No queries found in history.</p>
              <span className="text-secondary text-sm">
                Queries asked in Intella will automatically be saved here.
              </span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="modal-dialog-footer">
          <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
