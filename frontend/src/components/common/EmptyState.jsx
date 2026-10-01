export default function EmptyState({
  icon = '📂',
  title = 'No data found',
  description = 'There are no items to display right now.',
  actionLabel,
  onAction,
  secondaryActionLabel,
  onSecondaryAction,
  compact = false,
}) {
  return (
    <div className={`empty-state-panel ${compact ? 'compact' : ''}`}>
      <div className="empty-state-icon-bubble">{icon}</div>
      <h3 className="empty-state-title">{title}</h3>
      <p className="empty-state-desc">{description}</p>
      {(actionLabel || secondaryActionLabel) && (
        <div className="empty-state-actions">
          {actionLabel && (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={onAction}
            >
              {actionLabel}
            </button>
          )}
          {secondaryActionLabel && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={onSecondaryAction}
            >
              {secondaryActionLabel}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
