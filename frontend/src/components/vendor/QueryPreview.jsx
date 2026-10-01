import { useState } from 'react';

export default function QueryPreview({ sql, defaultOpen = false, title = 'Generated SQL' }) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const [copied, setCopied] = useState(false);

  if (!sql) return null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(sql);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
    }
  };

  return (
    <div className="query-preview-container">
      <div className="query-preview-header">
        <button
          type="button"
          className="query-preview-toggle-btn"
          onClick={() => setIsOpen(!isOpen)}
          aria-expanded={isOpen}
        >
          <span className="query-preview-chevron">{isOpen ? '▾' : '▸'}</span>
          <span className="query-preview-title">{title}</span>
        </button>

        <div className="query-preview-actions">
          <button
            type="button"
            className="btn-icon-subtle"
            onClick={handleCopy}
            title="Copy SQL to clipboard"
          >
            {copied ? '✓ Copied' : '📋 Copy'}
          </button>
        </div>
      </div>

      {isOpen && (
        <div className="query-preview-body">
          <pre className="query-preview-code">
            <code>{sql}</code>
          </pre>
        </div>
      )}
    </div>
  );
}
