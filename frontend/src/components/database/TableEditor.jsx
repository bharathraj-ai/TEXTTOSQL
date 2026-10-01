import { useState } from 'react';

export function AddRowModal({
  tableName,
  columns = [],
  structure,
  onClose,
  onInsert,
  isInserting = false,
}) {
  const [formValues, setFormValues] = useState({});
  const [error, setError] = useState('');

  const primaryKeys = structure?.primaryKeys || [];

  // Filter columns to render
  const editableColumns = columns.filter((col) => {
    // If it's a serial PK, it's auto-generated, but user can still see other columns
    return true;
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    setError('');

    // Ensure at least one value was provided
    const hasValues = Object.values(formValues).some((v) => v !== undefined && v !== '');
    if (!hasValues) {
      setError('Please provide at least one column value.');
      return;
    }

    onInsert(formValues);
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal-card add-row-modal">
        <div className="modal-header">
          <div>
            <h3 className="modal-title">Add Row to {tableName}</h3>
            <p className="modal-subtitle">Enter values for the new record.</p>
          </div>
          <button
            type="button"
            className="btn-icon-subtle"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {error && (
          <div className="alert-inline alert-danger">
            <span>⚠️</span>
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="add-row-form">
          <div className="form-fields-grid">
            {editableColumns.map((col) => {
              const isPK = primaryKeys.includes(col.name);
              const colType = structure?.columns?.[col.name] || col.type || 'text';
              return (
                <div key={col.name} className="form-group">
                  <label htmlFor={`input-${col.name}`} className="form-label">
                    <span>{col.name}</span>
                    <span className="col-type-hint">({colType}{isPK ? ' • PK' : ''})</span>
                  </label>
                  <input
                    id={`input-${col.name}`}
                    type="text"
                    className="form-input"
                    placeholder={isPK ? 'Auto-generated or custom ID' : `Enter ${col.name}`}
                    value={formValues[col.name] || ''}
                    onChange={(e) =>
                      setFormValues({ ...formValues, [col.name]: e.target.value })
                    }
                  />
                </div>
              );
            })}
          </div>

          <div className="modal-footer">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
              disabled={isInserting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={isInserting}
            >
              {isInserting ? 'Inserting...' : 'Insert Row'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function DeleteRowModal({
  tableName,
  row,
  primaryKeys = [],
  columns = [],
  onClose,
  onDelete,
  isDeleting = false,
}) {
  if (!row) return null;

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal-card delete-row-modal">
        <div className="modal-header">
          <div className="delete-modal-title-group">
            <span className="delete-warning-icon">⚠️</span>
            <div>
              <h3 className="modal-title">Delete Row</h3>
              <p className="modal-subtitle">
                This will permanently delete the selected record from <strong>{tableName}</strong>.
              </p>
            </div>
          </div>
        </div>

        <div className="delete-row-preview">
          <div className="preview-label">Row Identifiers:</div>
          <div className="preview-tags-list">
            {primaryKeys.map((pk) => (
              <div key={pk} className="preview-tag">
                <span className="tag-key">{pk}:</span>
                <span className="tag-val">{String(row[pk] ?? '')}</span>
              </div>
            ))}
            {primaryKeys.length === 0 &&
              columns.slice(0, 3).map((col) => (
                <div key={col.name} className="preview-tag">
                  <span className="tag-key">{col.name}:</span>
                  <span className="tag-val">{String(row[col.name] ?? '')}</span>
                </div>
              ))}
          </div>
        </div>

        <div className="modal-footer">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onClose}
            disabled={isDeleting}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-danger"
            onClick={onDelete}
            disabled={isDeleting}
          >
            {isDeleting ? 'Deleting...' : 'Delete Row'}
          </button>
        </div>
      </div>
    </div>
  );
}
