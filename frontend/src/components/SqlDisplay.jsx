import { useState } from 'react';

export default function SqlDisplay({ sql, dbType, review }) {
  const [copied, setCopied] = useState(false);

  if (!sql) return null;

  const isMongo = dbType === 'mongodb' || (typeof sql === 'string' && sql.trim().startsWith('db.'));

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(sql);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = sql;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <section className="sql-display-section">
      <div className="section-header">
        <div className="section-icon">{isMongo ? '🍃' : '🔧'}</div>
        <h2>{isMongo ? 'Generated MongoDB Query (MQL)' : 'Generated SQL'}</h2>

        {/* AI Safety Review Tag */}
        {review && (
          <div
            className="sql-review-tag"
            title={review.reason || 'AI safety review passed'}
          >
            <span>🛡️</span>
            <span>AI Verified</span>
            <span style={{ opacity: 0.85, fontSize: '0.7rem' }}>• {review.risk || 'LOW'}</span>
          </div>
        )}

        <button
          className={`copy-btn ${copied ? 'copied' : ''}`}
          onClick={handleCopy}
          title={isMongo ? 'Copy MQL' : 'Copy SQL'}
        >
          {copied ? '✓ Copied' : '📋 Copy'}
        </button>
      </div>
      <div className="sql-code-block">
        <pre><code>{sql}</code></pre>
      </div>
    </section>
  );
}
