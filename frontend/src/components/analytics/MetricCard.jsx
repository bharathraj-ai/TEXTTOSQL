export default function MetricCard({
  title,
  value,
  subtitle,
  badge,
  badgeType = 'neutral',
  icon,
}) {
  return (
    <div className="metric-card">
      <div className="metric-card-header">
        <span className="metric-title">{title}</span>
        {icon && <span className="metric-icon">{icon}</span>}
      </div>
      <div className="metric-value-row">
        <span className="metric-value">{value != null ? value : '—'}</span>
        {badge && (
          <span className={`metric-badge badge-${badgeType}`}>{badge}</span>
        )}
      </div>
      {subtitle && <p className="metric-subtitle">{subtitle}</p>}
    </div>
  );
}
