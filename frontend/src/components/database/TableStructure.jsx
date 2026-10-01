export default function TableStructure({ structure, tableName }) {
  if (!structure) {
    return (
      <div className="structure-empty-view">
        <p>No schema structure available for this table.</p>
      </div>
    );
  }

  const columns = Object.entries(structure.columns || {});
  const primaryKeys = structure.primaryKeys || [];
  const foreignKeys = structure.foreignKeys || [];

  return (
    <div className="table-structure-scroll-wrapper">
      <div className="table-structure-card-premium">
        <div className="structure-top-header">
          <div className="structure-title-column">
            <div className="structure-table-name-row">
              <span className="structure-name-title">{tableName}</span>
              <span className="structure-col-badge">{columns.length} columns</span>
            </div>
            <p className="structure-subtitle-text">
              Database schema constraints, column types, and relational keys.
            </p>
          </div>
        </div>

        <div className="structure-table-container">
          <table className="workspace-grid structure-grid-modern">
            <thead>
              <tr>
                <th style={{ width: '48px' }}>#</th>
                <th>Column</th>
                <th>Type</th>
                <th>Nullable</th>
                <th>Key</th>
              </tr>
            </thead>
            <tbody>
              {columns.map(([name, type], idx) => {
                const isPK = primaryKeys.includes(name);
                const isFK = foreignKeys.some((fk) => fk.column === name || fk.from === name) || /_id$/.test(name);
                const isNullable = structure.nullable ? structure.nullable[name] !== false : true;

                return (
                  <tr key={name}>
                    <td className="text-muted text-center">{idx + 1}</td>
                    <td>
                      <div className="structure-col-name-wrap">
                        {isPK && <span className="key-icon-gold" title="Primary Key">🔑</span>}
                        {isFK && !isPK && <span className="key-icon-blue" title="Foreign Key">🔗</span>}
                        <strong className="structure-col-text">{name}</strong>
                      </div>
                    </td>
                    <td>
                      <span className="type-badge-clean">{type}</span>
                    </td>
                    <td>
                      <span className={`nullable-status-pill ${isNullable ? 'is-yes' : 'is-no'}`}>
                        {isNullable ? 'Yes' : 'No'}
                      </span>
                    </td>
                    <td>
                      {isPK ? (
                        <span className="badge-key-pk">PK</span>
                      ) : isFK ? (
                        <span className="badge-key-fk">FK</span>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
