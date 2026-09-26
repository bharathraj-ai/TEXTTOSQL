import { useState, useEffect } from 'react';

export default function QuerySuggestions({ token, dbConnected, onSuggestionClick, isLoading }) {
  const [suggestions, setSuggestions] = useState([]);
  const [isFetching, setIsFetching] = useState(false);

  useEffect(() => {
    if (!dbConnected || !token) {
      setSuggestions([]);
      return;
    }

    const fetchSuggestions = async () => {
      setIsFetching(true);
      try {
        const res = await fetch('http://localhost:5000/api/query/suggestions', {
          headers: {
            'Authorization': `Bearer ${token}`,
          },
        });
        const data = await res.json();
        if (data.success && data.suggestions) {
          setSuggestions(data.suggestions);
        }
      } catch (err) {
        console.error('Failed to fetch suggestions:', err);
      } finally {
        setIsFetching(false);
      }
    };

    fetchSuggestions();
  }, [dbConnected, token]);

  if (suggestions.length === 0 || isFetching) return null;

  return (
    <section className="query-suggestions-section">
      <div className="section-header">
        <div className="section-icon">💡</div>
        <h2>Try asking</h2>
      </div>
      <div className="suggestions-grid">
        {suggestions.map((suggestion, i) => (
          <button
            key={i}
            className="suggestion-chip"
            onClick={() => onSuggestionClick(suggestion)}
            disabled={isLoading}
          >
            <span className="suggestion-arrow">→</span>
            {suggestion}
          </button>
        ))}
      </div>
    </section>
  );
}
