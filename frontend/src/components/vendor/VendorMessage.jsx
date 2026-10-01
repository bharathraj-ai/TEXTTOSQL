import QueryPreview from './QueryPreview';
import RiskBadge from './RiskBadge';

export default function VendorMessage({
  message,
  onViewResults,
  onSelectSuggestion,
}) {
  const isYou = message.role === 'you';

  if (isYou) {
    return (
      <div className="copilot-msg-card user-msg">
        <div className="msg-meta-line">
          <span className="msg-author-tag user-tag">You</span>
        </div>
        <p className="msg-text-content">{message.text}</p>
      </div>
    );
  }

  return (
    <div className="copilot-msg-card intella-msg">
      <div className="msg-meta-line">
        <div className="msg-author-group">
          <span className="copilot-mini-avatar" aria-hidden="true">In</span>
          <span className="msg-author-tag intella-tag">Intella</span>
        </div>
        {message.intent && (
          <RiskBadge intent={message.intent} riskLevel={message.riskLevel} />
        )}
      </div>

      {message.language && message.language !== 'english' && (
        <p className="msg-language-note">
          Detected language: {message.language.charAt(0).toUpperCase() + message.language.slice(1)}
          {message.normalizedRequest ? `. Normalized request: ${message.normalizedRequest}` : ''}
        </p>
      )}

      {message.text && (
        <p className="msg-text-content">{message.text}</p>
      )}

      {message.hasResults && onViewResults && (
        <div className="msg-action-bar">
          <button
            type="button"
            className="btn btn-secondary btn-xs view-results-btn"
            onClick={() => onViewResults(message.resultData)}
          >
             View Results in Table ({message.resultData?.rows?.length || 0})
          </button>
        </div>
      )}

      {message.sql && (
        <QueryPreview
          sql={message.sql}
          defaultOpen={['INSERT', 'UPDATE', 'DELETE', 'ALTER', 'DROP'].includes(String(message.intent || '').toUpperCase())}
          title="▸ View SQL"
        />
      )}

      {message.error && (
        <div className="msg-error-alert">
          <span className="error-symbol">✕</span>
          <span>{message.error}</span>
        </div>
      )}

      {message.suggestions && message.suggestions.length > 0 && (
        <div className="msg-suggestions-box">
          <span className="sub-hint">Suggested follow-ups:</span>
          <div className="followup-chips">
            {message.suggestions.map((s, i) => (
              <button
                key={i}
                type="button"
                className="followup-chip-btn"
                onClick={() => onSelectSuggestion && onSelectSuggestion(s)}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
