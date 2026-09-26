export default function ResultTable({ columns, rows }) {
  if (!columns || !rows) return null;

  if (rows.length === 0) {
    return (
      <section className="result-table-section">
        <div className="section-header">
          <div className="section-icon">📊</div>
          <h2>Query Result</h2>
        </div>
        <div className="empty-result">
          <span className="empty-icon">📭</span>
          <p>No results found</p>
        </div>
      </section>
    );
  }

  return (
    <section className="result-table-section">
      <div className="section-header">
        <div className="section-icon">📊</div>
        <h2>Query Result</h2>
      </div>
      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              {columns.map((col) => (
                <th key={col}>{col}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i}>
                {columns.map((col) => (
                  <td key={col}>{row[col] !== null && row[col] !== undefined ? String(row[col]) : '—'}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
