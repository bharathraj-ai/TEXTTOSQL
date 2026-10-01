import { formatCompactCurrency, formatNumber } from '../../utils/formatters';

export default function ChartCard({
  title,
  subtitle,
  type = 'bar',
  data = [],
  isCurrency = false,
  emptyMessage = 'Not enough data for this visualization.',
}) {
  if (!data || data.length === 0) {
    return (
      <div className="analytics-chart-panel">
        <div className="chart-panel-header">
          <h4 className="chart-panel-title">{title}</h4>
          {subtitle && <p className="chart-panel-subtitle">{subtitle}</p>}
        </div>
        <div className="chart-empty-placeholder">
          <span className="empty-symbol">📊</span>
          <p>{emptyMessage}</p>
        </div>
      </div>
    );
  }

  // Type 1: Horizontal Bar Chart (e.g. Budget by Project, or Category counts)
  if (type === 'bar' || type === 'horizontal') {
    const maxVal = Math.max(...data.map((d) => d.value), 1);

    return (
      <div className="analytics-chart-panel">
        <div className="chart-panel-header">
          <h4 className="chart-panel-title">{title}</h4>
          {subtitle && <p className="chart-panel-subtitle">{subtitle}</p>}
        </div>

        <div className="horizontal-bars-container">
          {data.map((item, idx) => {
            const pct = Math.max(Math.round((item.value / maxVal) * 100), 4);
            const displayVal = isCurrency ? formatCompactCurrency(item.value) : formatNumber(item.value);

            return (
              <div key={idx} className="horizontal-bar-item">
                <div className="bar-labels-row">
                  <span className="bar-item-name" title={item.label}>
                    {item.label}
                  </span>
                  <span className="bar-item-metric">
                    <strong>{displayVal}</strong>
                    {item.percentage ? <span className="bar-pct-label">({item.percentage}%)</span> : null}
                  </span>
                </div>
                <div className="bar-track-line">
                  <div
                    className="bar-fill-gradient"
                    style={{ width: `${pct}%` }}
                    title={`${item.label}: ${displayVal}`}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // Type 2: Histogram / Binned Distribution
  if (type === 'histogram') {
    const maxVal = Math.max(...data.map((d) => d.count), 1);

    return (
      <div className="analytics-chart-panel">
        <div className="chart-panel-header">
          <h4 className="chart-panel-title">{title}</h4>
          {subtitle && <p className="chart-panel-subtitle">{subtitle}</p>}
        </div>

        <div className="histogram-bars-frame">
          <div className="histogram-columns-row">
            {data.map((bin, idx) => {
              const heightPct = bin.count === 0 ? 4 : Math.max(Math.round((bin.count / maxVal) * 100), 8);
              return (
                <div key={idx} className="histogram-column-item">
                  <div className="histogram-track-vertical">
                    <div
                      className="histogram-fill-bar"
                      style={{ height: `${heightPct}%` }}
                      title={`${bin.range}: ${bin.count} records`}
                    >
                      <span className="histogram-hover-tip">{bin.count}</span>
                    </div>
                  </div>
                  <span className="histogram-x-label">{bin.range}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  if (type === 'line') {
    const width = 320;
    const height = 140;
    const maxVal = Math.max(...data.map((item) => Number(item.value) || 0), 1);
    const points = data.map((item, index) => {
      const x = data.length === 1 ? width / 2 : (index / (data.length - 1)) * width;
      const y = height - ((Number(item.value) || 0) / maxVal) * (height - 16);
      return `${x},${y}`;
    }).join(' ');

    return (
      <div className="analytics-chart-panel">
        <div className="chart-panel-header">
          <h4 className="chart-panel-title">{title}</h4>
          {subtitle && <p className="chart-panel-subtitle">{subtitle}</p>}
        </div>
        <svg className="analytics-line-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title}>
          <polyline fill="none" stroke="currentColor" strokeWidth="2" points={points} />
        </svg>
        <div className="analytics-line-labels">
          {data.map((item) => (
            <span key={item.label}>{item.label}</span>
          ))}
        </div>
      </div>
    );
  }

  // Type 3: Donut or Category Breakdown
  return (
    <div className="analytics-chart-panel">
      <div className="chart-panel-header">
        <h4 className="chart-panel-title">{title}</h4>
        {subtitle && <p className="chart-panel-subtitle">{subtitle}</p>}
      </div>

      <div className="breakdown-chips-grid">
        {data.map((item, idx) => (
          <div key={idx} className="breakdown-chip-item">
            <span className="chip-color-bullet" />
            <span className="chip-name">{item.label}</span>
            <span className="chip-val">{formatNumber(item.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
