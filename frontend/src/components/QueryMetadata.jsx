export default function QueryMetadata({ executionTime, rowCount }) {
  if (executionTime === null || executionTime === undefined) return null;

  return (
    <div className="query-metadata">
      <div className="metadata-items">
        <span className="metadata-item">
          <span className="metadata-icon">📊</span>
          {rowCount} row{rowCount !== 1 ? 's' : ''}
        </span>
        <span className="metadata-separator">•</span>
        <span className="metadata-item">
          <span className="metadata-icon">⚡</span>
          {executionTime}ms
        </span>
      </div>
    </div>
  );
}
