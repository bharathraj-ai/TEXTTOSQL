import { useCallback, useEffect, useState } from 'react';
import MetricCard from './MetricCard';
import ChartCard from './ChartCard';
import AIInsights from './AIInsights';
import { isCurrencyColumn, formatCompactCurrency, formatNumber, formatDate } from '../../utils/formatters';

const API = 'http://localhost:5000/api';

function titleCase(value) {
  return String(value || 'Table')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function displayMetric(value, currency) {
  if (value == null || Number.isNaN(Number(value))) return 'N/A';
  return currency ? formatCompactCurrency(value) : formatNumber(value);
}

function displayDate(value) {
  if (!value) return 'N/A';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return formatDate(value) || 'N/A';
  return parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function AnalyticsDashboard({
  token,
  tableName,
  connectionId,
  refreshKey = 0,
  enabled = true,
  onAuthError,
}) {
  const [analytics, setAnalytics] = useState(null);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  const loadAnalytics = useCallback(async () => {
    if (!enabled || !tableName || !token) return;
    setStatus('loading');
    setError('');
    try {
      const params = new URLSearchParams({ table: tableName });
      if (connectionId) params.set('connectionId', String(connectionId));
      const res = await fetch(`${API}/database/analytics?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401) {
        onAuthError?.('Session expired.');
        setStatus('error');
        setError('Unable to calculate analytics.');
        return;
      }
      const data = await res.json();
      if (!data.success) {
        setAnalytics(null);
        setStatus('error');
        setError(data.error || 'Unable to calculate analytics.');
        return;
      }
      setAnalytics(data);
      setStatus(data.totalRows === 0 ? 'empty' : 'ready');
    } catch {
      setAnalytics(null);
      setStatus('error');
      setError('Unable to calculate analytics.');
    }
  }, [enabled, tableName, token, connectionId, onAuthError]);

  useEffect(() => {
    loadAnalytics();
  }, [loadAnalytics, refreshKey, attempt]);

  const tableTitle = titleCase(tableName);
  const numericColumn = analytics?.columns?.find((column) => column.type === 'numeric'
    && /value|amount|mark|score|price|salary|cost|budget/i.test(column.name))
    || analytics?.columns?.find((column) => column.type === 'numeric');
  const currency = numericColumn ? isCurrencyColumn(numericColumn.name, numericColumn.dataType) : false;

  if (!tableName) {
    return (
      <div className="analytics-state-panel">
        <h3>No table selected</h3>
        <p>Select a table to calculate analytics.</p>
      </div>
    );
  }

  if (status === 'loading') {
    return (
      <div className="analytics-scrollable-workspace">
        <div className="analytics-inner-layout">
          <div className="analytics-page-title-row">
            <h3 className="analytics-header-heading">{tableTitle} Analytics</h3>
            <span className="analytics-scope-pill">Analytics for all rows</span>
          </div>
          <p className="analytics-status-line">Analyzing {tableName}...</p>
          <div className="analytics-kpi-row-grid">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="skeleton-card" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="analytics-state-panel">
        <h3>Unable to calculate analytics.</h3>
        <p>{error || 'Unable to calculate analytics.'}</p>
        <button type="button" className="analytics-retry-button" onClick={() => setAttempt((value) => value + 1)}>
          Retry
        </button>
      </div>
    );
  }

  if (status === 'empty') {
    return (
      <div className="analytics-state-panel">
        <h3>No data available for analytics.</h3>
        <p>Analytics for all rows in {tableName}. This table has 0 rows.</p>
      </div>
    );
  }

  const kpis = [
    {
      title: 'Total Rows',
      value: formatNumber(analytics.totalRows),
      subtitle: `${tableTitle} · all rows`,
      badge: 'Count',
      badgeType: 'neutral',
    },
    {
      title: 'Numeric Columns',
      value: formatNumber(analytics.summary?.numericColumns || 0),
      subtitle: 'Aggregated in the database',
      badge: 'Schema',
      badgeType: 'info',
    },
    {
      title: 'Categorical Columns',
      value: formatNumber(analytics.summary?.categoricalColumns || 0),
      subtitle: 'Distribution from the full table',
      badge: 'Schema',
      badgeType: 'neutral',
    },
    {
      title: 'Latest Record',
      value: displayDate(analytics.summary?.latestRecord),
      subtitle: analytics.summary?.latestRecord ? 'Latest date in the table' : 'No date column',
      badge: 'Date',
      badgeType: 'accent',
    },
  ];

  if (numericColumn) {
    kpis.splice(1, 0, {
      title: `Avg ${titleCase(numericColumn.name)}`,
      value: displayMetric(numericColumn.avg, currency),
      subtitle: `Sum ${displayMetric(numericColumn.sum, currency)}`,
      badge: 'Avg',
      badgeType: 'accent',
    });
  }

  const category = analytics.charts?.category;
  const histogram = analytics.charts?.histogram;
  const comparison = analytics.charts?.numericComparison;
  const timeline = analytics.charts?.timeline;

  return (
    <div className="analytics-scrollable-workspace">
      <div className="analytics-inner-layout">
        <div className="analytics-page-title-row">
          <h3 className="analytics-header-heading">{tableTitle} Analytics</h3>
          <span className="analytics-scope-pill">Analytics for all rows</span>
        </div>

        <div className="analytics-kpi-row-grid">
          {kpis.map((kpi) => (
            <MetricCard
              key={kpi.title}
              title={kpi.title}
              value={kpi.value}
              subtitle={kpi.subtitle}
              badge={kpi.badge}
              badgeType={kpi.badgeType}
            />
          ))}
        </div>

        <div className="analytics-charts-split-grid">
          {category && (
            <ChartCard
              title={`${tableTitle} by ${titleCase(category.column)}`}
              subtitle="Top categories across the full table"
              type="horizontal"
              data={category.distribution.map((item) => ({
                label: item.value === '' ? '(empty)' : item.value,
                value: item.count,
                percentage: analytics.totalRows
                  ? Math.round((item.count / analytics.totalRows) * 100)
                  : 0,
              }))}
            />
          )}
          {histogram && (
            <ChartCard
              title={`${titleCase(histogram.column)} distribution`}
              subtitle="Five bins calculated in the database"
              type="histogram"
              data={histogram.bins.map((bin) => ({ range: bin.label, count: bin.count }))}
              isCurrency={currency && histogram.column === numericColumn?.name}
            />
          )}
          {comparison && (
            <ChartCard
              title={`${titleCase(comparison.column)} min, average, max`}
              subtitle="Compared from the full table"
              type="bar"
              data={comparison.points}
              isCurrency={currency && comparison.column === numericColumn?.name}
            />
          )}
          {timeline && (
            <ChartCard
              title={`${titleCase(timeline.column)} over time`}
              subtitle="Rows grouped by month"
              type="line"
              data={timeline.points.map((point) => ({ label: point.label, value: point.count }))}
            />
          )}
        </div>

        <AIInsights
          insights={analytics.insights || []}
          tableName={tableName}
          rowCount={analytics.totalRows}
        />

        <div className="analytics-columns-breakdown-card">
          <div className="columns-card-header">
            <h4>Column Statistical Breakdown</h4>
            <span className="columns-count-tag">{analytics.columns.length} columns</span>
          </div>
          <div className="columns-table-frame">
            <table className="workspace-grid stats-breakdown-grid">
              <thead>
                <tr>
                  <th>Column</th>
                  <th>Type</th>
                  <th>Non-null</th>
                  <th>Nulls</th>
                  <th>Summary</th>
                </tr>
              </thead>
              <tbody>
                {analytics.columns.map((column) => {
                  const columnCurrency = isCurrencyColumn(column.name, column.dataType);
                  let summary = 'N/A';
                  if (column.type === 'numeric') {
                    summary = `Min ${displayMetric(column.min, columnCurrency)} · Avg ${displayMetric(column.avg, columnCurrency)} · Max ${displayMetric(column.max, columnCurrency)} · Sum ${displayMetric(column.sum, columnCurrency)}`;
                  } else if (column.type === 'date') {
                    summary = column.earliest || column.latest
                      ? `${displayDate(column.earliest)} to ${displayDate(column.latest)}`
                      : 'N/A';
                  } else if (column.type === 'categorical' || column.type === 'identifier') {
                    const top = column.distribution?.[0];
                    summary = `${formatNumber(column.distinctCount || 0)} distinct${top ? ` · Top: ${top.value || '(empty)'} (${formatNumber(top.count)})` : ''}`;
                  }
                  return (
                    <tr key={column.name}>
                      <td><strong>{column.name}</strong></td>
                      <td><span className="type-tag">{column.type}</span></td>
                      <td>{formatNumber(column.count || 0)}</td>
                      <td>{column.nullCount > 0 ? <span className="text-warning font-medium">{formatNumber(column.nullCount)} nulls</span> : <span className="text-muted">0</span>}</td>
                      <td>{summary}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
