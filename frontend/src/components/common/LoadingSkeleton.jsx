export function SkeletonRow({ columns = 5 }) {
  return (
    <tr className="skeleton-tr">
      {Array.from({ length: columns }).map((_, i) => (
        <td key={i} className="skeleton-td">
          <div className="skeleton-bone" style={{ width: `${50 + (i * 17) % 45}%` }} />
        </td>
      ))}
    </tr>
  );
}

export function SkeletonTable({ rows = 6, columns = 5 }) {
  return (
    <div className="skeleton-table-wrapper">
      <div className="skeleton-header-bone" />
      <table className="workspace-grid skeleton-grid">
        <thead>
          <tr>
            {Array.from({ length: columns }).map((_, i) => (
              <th key={i}>
                <div className="skeleton-bone skeleton-th-bone" />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }).map((_, r) => (
            <SkeletonRow key={r} columns={columns} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SkeletonCard() {
  return (
    <div className="skeleton-card">
      <div className="skeleton-bone" style={{ width: '40%', height: '14px', marginBottom: '8px' }} />
      <div className="skeleton-bone" style={{ width: '70%', height: '28px', marginBottom: '12px' }} />
      <div className="skeleton-bone" style={{ width: '50%', height: '12px' }} />
    </div>
  );
}

export function SkeletonChart() {
  return (
    <div className="skeleton-chart-box">
      <div className="skeleton-bone" style={{ width: '35%', height: '16px', marginBottom: '16px' }} />
      <div className="skeleton-bars">
        <div className="skeleton-bone skeleton-bar" style={{ height: '70%' }} />
        <div className="skeleton-bone skeleton-bar" style={{ height: '90%' }} />
        <div className="skeleton-bone skeleton-bar" style={{ height: '45%' }} />
        <div className="skeleton-bone skeleton-bar" style={{ height: '80%' }} />
        <div className="skeleton-bone skeleton-bar" style={{ height: '60%' }} />
      </div>
    </div>
  );
}
