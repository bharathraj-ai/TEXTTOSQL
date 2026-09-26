import { useState, useEffect } from 'react';

const STORAGE_KEY = 'nl-sql-query-history';
const FAVORITES_KEY = 'nl-sql-favorites';
const MAX_HISTORY = 20;

export default function QueryHistory({ onSelectQuery }) {
  const [history, setHistory] = useState([]);
  const [favorites, setFavorites] = useState([]);
  const [isExpanded, setIsExpanded] = useState(false);
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);

  // Load history and favorites from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) setHistory(JSON.parse(stored));
    } catch { /* Ignore parse errors */ }

    try {
      const storedFavs = localStorage.getItem(FAVORITES_KEY);
      if (storedFavs) setFavorites(JSON.parse(storedFavs));
    } catch { /* Ignore parse errors */ }
  }, []);

  const toggleFavorite = (question) => {
    let updatedFavs;
    if (favorites.includes(question)) {
      updatedFavs = favorites.filter((f) => f !== question);
    } else {
      updatedFavs = [...favorites, question];
    }
    setFavorites(updatedFavs);
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(updatedFavs));
  };

  if (history.length === 0) return null;

  const displayList = showFavoritesOnly
    ? history.filter((item) => favorites.includes(item.question))
    : history;

  const finalList = isExpanded ? displayList : displayList.slice(0, 5);

  return (
    <section className="query-history-section">
      <div className="section-header">
        <div className="section-icon">🕐</div>
        <h2>{showFavoritesOnly ? 'Favorite Queries' : 'Recent Queries'}</h2>

        <div className="history-controls">
          <button
            className={`toggle-favorites-btn ${showFavoritesOnly ? 'active' : ''}`}
            onClick={() => setShowFavoritesOnly(!showFavoritesOnly)}
            title={showFavoritesOnly ? 'Show all' : 'Show favorites'}
          >
            {showFavoritesOnly ? '★ Favorites' : '☆ Favorites'}
          </button>

          {displayList.length > 5 && (
            <button
              className="toggle-history-btn"
              onClick={() => setIsExpanded(!isExpanded)}
            >
              {isExpanded ? 'Show less' : `Show all (${displayList.length})`}
            </button>
          )}

          <button
            className="clear-history-btn"
            onClick={() => {
              setHistory([]);
              localStorage.removeItem(STORAGE_KEY);
            }}
            title="Clear history"
          >
            ✕ Clear
          </button>
        </div>
      </div>
      <div className="history-list">
        {finalList.map((item, i) => (
          <div key={`${item.question}-${i}`} className="history-item-row">
            <button
              className="history-item"
              onClick={() => onSelectQuery(item.question)}
            >
              <span className="history-number">{i + 1}.</span>
              <span className="history-question">{item.question}</span>
              {item.executionTime && (
                <span className="history-time">{item.executionTime}ms</span>
              )}
              {item.success !== undefined && (
                <span className={`history-status ${item.success ? 'success' : 'failed'}`}>
                  {item.success ? '✓' : '✗'}
                </span>
              )}
            </button>
            <button
              className={`favorite-btn ${favorites.includes(item.question) ? 'favorited' : ''}`}
              onClick={(e) => {
                e.stopPropagation();
                toggleFavorite(item.question);
              }}
              title={favorites.includes(item.question) ? 'Remove from favorites' : 'Add to favorites'}
            >
              {favorites.includes(item.question) ? '★' : '☆'}
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * Save a query to localStorage history.
 * Called from App.jsx after each query execution.
 */
export function saveToHistory(question, success, sql = '', executionTime = null) {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    let history = stored ? JSON.parse(stored) : [];

    // Remove duplicate if exists
    history = history.filter((h) => h.question !== question);

    // Add to front
    history.unshift({
      question,
      success,
      sql,
      executionTime,
      timestamp: Date.now(),
    });

    // Limit size
    if (history.length > MAX_HISTORY) {
      history = history.slice(0, MAX_HISTORY);
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
  } catch {
    // Ignore storage errors
  }
}
