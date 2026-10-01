export default function AIInsights({ insights = [], tableName, rowCount }) {
  return (
    <div className="ai-insights-premium-card">
      <div className="ai-insights-top-row">
        <div className="ai-insights-badge-group">
          <span className="sparkle-symbol">✨</span>
          <span className="ai-label-strong">Intella Insights</span>
        </div>
        <span className="data-verified-pill">
          Verified from {rowCount?.toLocaleString() || 0} records in <strong>{tableName}</strong>
        </span>
      </div>

      <div className="ai-insights-body-content">
        {insights.length === 0 ? (
          <p className="ai-insights-empty-notice">
            Not enough data available to generate statistical insights. Try querying or adding more rows.
          </p>
        ) : (
          <ul className="ai-insights-bullet-list">
            {insights.map((insight, idx) => (
              <li key={idx} className="ai-bullet-item">
                <span className="bullet-star">✦</span>
                <span className="bullet-sentence">{insight}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
