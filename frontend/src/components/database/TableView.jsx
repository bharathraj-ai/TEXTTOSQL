import { useState } from 'react';
import { SkeletonTable } from '../common/LoadingSkeleton';
import EmptyState from '../common/EmptyState';
import { isCurrencyColumn, isStatusColumn, formatCurrency, formatDate, getStatusStyle } from '../../utils/formatters';

function rowKey(row, primaryKeys) {
  if (!primaryKeys?.length) return JSON.stringify(row);
  return primaryKeys.map((key) => row[key]).join('|');
}

function isNumericType(type) {
  const t = String(type || '').toLowerCase();
  return /int|numeric|decimal|float|double|real|serial|money/.test(t);
}

function isDateType(type, name) {
  const t = String(type || '').toLowerCase();
  const n = String(name || '').toLowerCase();
  return /date|time|timestamp/.test(t) || /_at|date|timestamp/.test(n);
}

export default function TableView({
  columns = [],
  rows = [],
  primaryKeys = [],
  hiddenColumns = {},
  sortCol,
  sortDir,
  onSort,
  isLoading = false,
  selectedRowKey,
  onSelectRow,
  onOpenDeleteRow,
  drafts = {},
  onCellChange,
  isReadOnly = false,
  onResetFilter,
}) {
  const [editingCell, setEditingCell] = useState(null); // { key, col, value }
  const [hoveredRowKey, setHoveredRowKey] = useState(null);

  const visibleColumns = columns.filter((col) => !hiddenColumns[col.name]);

  if (isLoading) {
    return <SkeletonTable rows={10} columns={Math.max(visibleColumns.length, 5)} />;
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        icon="🔍"
        title="No records found"
        description="Try changing your search filter or add a new row to this table."
        actionLabel={onResetFilter ? 'Reset Filter' : null}
        onAction={onResetFilter}
      />
    );
  }

  const handleCellBlur = (key, colName, originalVal) => {
    if (!editingCell) return;
    if (String(editingCell.value) !== String(originalVal ?? '')) {
      onCellChange(key, colName, editingCell.value, originalVal);
    }
    setEditingCell(null);
  };

  const handleCellKeyDown = (e, key, colName, originalVal) => {
    if (e.key === 'Enter') {
      handleCellBlur(key, colName, originalVal);
    } else if (e.key === 'Escape') {
      setEditingCell(null);
    }
  };

  return (
    <div className="table-view-scroll-container">
      <table className="workspace-grid main-data-table">
        <thead>
          <tr>
            {visibleColumns.map((col) => {
              const isSorted = sortCol === col.name;
              const isPK = primaryKeys.includes(col.name);
              const isNum = isNumericType(col.type) || isCurrencyColumn(col.name, col.type);

              return (
                <th
                  key={col.name}
                  className={`${isSorted ? 'sorted-col-th' : ''} ${isNum ? 'th-numeric' : ''}`}
                >
                  <button
                    type="button"
                    className={`th-sort-btn ${isNum ? 'justify-end' : ''}`}
                    onClick={() => onSort(col.name)}
                    title={`Sort by ${col.name}`}
                  >
                    <span className="th-col-name">
                      {isPK && <span className="pk-badge-tiny">PK</span>}
                      {col.name}
                    </span>
                    <span className="sort-indicator">
                      {isSorted ? (sortDir === 'desc' ? '▼' : '▲') : '⇅'}
                    </span>
                  </button>
                </th>
              );
            })}
            {!isReadOnly && <th className="th-actions-header">Actions</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const key = rowKey(row, primaryKeys);
            const isSelected = selectedRowKey === key;
            const hasDraft = Boolean(drafts[key]);
            const isHovered = hoveredRowKey === key;

            return (
              <tr
                key={key}
                className={`table-data-row ${isSelected ? 'row-selected' : ''} ${hasDraft ? 'row-has-unsaved' : ''}`}
                onClick={() => onSelectRow && onSelectRow(key, row)}
                onMouseEnter={() => setHoveredRowKey(key)}
                onMouseLeave={() => setHoveredRowKey(null)}
              >
                {visibleColumns.map((col) => {
                  const isPK = primaryKeys.includes(col.name);
                  const isNum = isNumericType(col.type) || isCurrencyColumn(col.name, col.type);
                  const isDraftModified = drafts[key]?.changes?.[col.name] !== undefined;
                  const rawValue = isDraftModified
                    ? drafts[key].changes[col.name]
                    : row[col.name];

                  const isEditingThisCell =
                    editingCell?.key === key && editingCell?.col === col.name;

                  // Format display value
                  let formattedValue = null;
                  const isCurrency = isCurrencyColumn(col.name, col.type);
                  const statusInfo = isStatusColumn(col.name) || (typeof rawValue === 'string' && getStatusStyle(rawValue));

                  if (rawValue === null || rawValue === undefined) {
                    formattedValue = <span className="cell-null">NULL</span>;
                  } else if (statusInfo && typeof statusInfo === 'object') {
                    formattedValue = (
                      <span className={`status-badge ${statusInfo.className}`}>
                        <span className="status-dot-mini">●</span> {statusInfo.label}
                      </span>
                    );
                  } else if (isCurrency && !isEditingThisCell) {
                    formattedValue = <span className="cell-currency tabular-nums">{formatCurrency(rawValue)}</span>;
                  } else if (isDateType(col.type, col.name) && !isEditingThisCell) {
                    formattedValue = <span className="cell-date">{formatDate(rawValue)}</span>;
                  } else if (isNum && !isEditingThisCell) {
                    formattedValue = <span className="tabular-nums">{String(rawValue)}</span>;
                  } else {
                    formattedValue = typeof rawValue === 'object' ? JSON.stringify(rawValue) : String(rawValue);
                  }

                  return (
                    <td
                      key={col.name}
                      className={`table-cell ${isPK ? 'cell-pk' : 'cell-editable'} ${isNum ? 'cell-numeric' : ''} ${isDraftModified ? 'cell-unsaved' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!isPK && !isReadOnly) {
                          setEditingCell({
                            key,
                            col: col.name,
                            value: rawValue ?? '',
                          });
                        }
                      }}
                    >
                      {isEditingThisCell ? (
                        <input
                          type="text"
                          className="inline-cell-input"
                          autoFocus
                          value={editingCell.value}
                          onChange={(e) =>
                            setEditingCell({ ...editingCell, value: e.target.value })
                          }
                          onBlur={() =>
                            handleCellBlur(key, col.name, row[col.name])
                          }
                          onKeyDown={(e) =>
                            handleCellKeyDown(e, key, col.name, row[col.name])
                          }
                        />
                      ) : (
                        <div className={`cell-content-wrap ${isNum ? 'justify-end' : ''}`}>
                          {isDraftModified && (
                            <span className="unsaved-cell-dot" title="Modified value" />
                          )}
                          <div className="cell-inner-text">
                            {formattedValue}
                          </div>
                        </div>
                      )}
                    </td>
                  );
                })}

                {!isReadOnly && (
                  <td className="row-action-td" onClick={(e) => e.stopPropagation()}>
                    <div className="row-hover-actions">
                      <button
                        type="button"
                        className="btn-action-ghost"
                        onClick={() => {
                          const firstEditableCol = visibleColumns.find((c) => !primaryKeys.includes(c.name))?.name;
                          if (firstEditableCol) {
                            setEditingCell({
                              key,
                              col: firstEditableCol,
                              value: row[firstEditableCol] ?? '',
                            });
                          }
                        }}
                        title="Edit row"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="btn-action-ghost text-danger"
                        onClick={() => onOpenDeleteRow(row)}
                        title="Delete row"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
