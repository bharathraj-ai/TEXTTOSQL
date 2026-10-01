import { useState } from 'react';

export default function TableToolbar({
  searchQuery,
  onSearchChange,
  onApplySearch,
  onRefresh,
  onOpenAddRow,
  columns = [],
  hiddenColumns = {},
  onToggleColumn,
  activeFilters = [],
  onAddFilter,
  onRemoveFilter,
  onClearAllFilters,
}) {
  const [columnsDropdownOpen, setColumnsDropdownOpen] = useState(false);
  const [filterBuilderOpen, setFilterBuilderOpen] = useState(false);

  // Filter builder form state
  const [filterCol, setFilterCol] = useState(columns[0]?.name || '');
  const [filterOp, setFilterOp] = useState('equals');
  const [filterVal, setFilterVal] = useState('');

  const handleApplyNewFilter = (e) => {
    e?.preventDefault();
    if (!filterCol || !filterVal.trim()) return;

    if (onAddFilter) {
      onAddFilter({
        col: filterCol,
        op: filterOp,
        val: filterVal.trim(),
      });
    }

    setFilterVal('');
    setFilterBuilderOpen(false);
  };

  return (
    <div className="table-toolbar-wrapper">
      <div className="table-toolbar-container">
        {/* 1. Large Search Input (occupies most available width) */}
        <form
          className="toolbar-search-expanded"
          onSubmit={(e) => {
            e.preventDefault();
            onApplySearch();
          }}
        >
          <span className="search-icon">🔍</span>
          <input
            type="text"
            className="toolbar-search-input"
            placeholder="Search rows in table..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
          />
          {searchQuery && (
            <button
              type="button"
              className="clear-search-btn"
              onClick={() => {
                onSearchChange('');
                setTimeout(() => onApplySearch(), 10);
              }}
              aria-label="Clear search"
            >
              ×
            </button>
          )}
        </form>

        {/* 2. Secondary Utility Buttons */}
        <div className="toolbar-actions-cluster">
          {/* Filter Popover Button */}
          <div className="relative-dropdown-wrap">
            <button
              type="button"
              className={`btn btn-secondary btn-sm ${activeFilters.length > 0 ? 'btn-active-filter' : ''}`}
              onClick={() => {
                setFilterBuilderOpen(!filterBuilderOpen);
                setColumnsDropdownOpen(false);
                if (!filterCol && columns.length > 0) {
                  setFilterCol(columns[0].name);
                }
              }}
            >
              <span>Filter</span>
              {activeFilters.length > 0 && (
                <span className="filter-count-bubble">{activeFilters.length}</span>
              )}
              <span className="dropdown-caret">▾</span>
            </button>

            {filterBuilderOpen && (
              <div className="dropdown-panel filter-builder-panel">
                <div className="filter-panel-header">
                  <span>Filter Builder</span>
                  <button
                    type="button"
                    className="close-panel-btn"
                    onClick={() => setFilterBuilderOpen(false)}
                  >
                    ×
                  </button>
                </div>

                <form onSubmit={handleApplyNewFilter} className="filter-builder-form">
                  <div className="filter-input-row">
                    <label className="filter-sublabel">Column</label>
                    <select
                      className="filter-select"
                      value={filterCol}
                      onChange={(e) => setFilterCol(e.target.value)}
                    >
                      {columns.map((c) => (
                        <option key={c.name} value={c.name}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="filter-input-row">
                    <label className="filter-sublabel">Condition</label>
                    <select
                      className="filter-select"
                      value={filterOp}
                      onChange={(e) => setFilterOp(e.target.value)}
                    >
                      <option value="equals">equals (=)</option>
                      <option value="contains">contains (LIKE)</option>
                      <option value="gt">greater than (&gt;)</option>
                      <option value="lt">less than (&lt;)</option>
                      <option value="not_equals">not equals (!=)</option>
                    </select>
                  </div>

                  <div className="filter-input-row">
                    <label className="filter-sublabel">Value</label>
                    <input
                      type="text"
                      className="filter-text-input"
                      placeholder="e.g. 500000 or Active"
                      value={filterVal}
                      onChange={(e) => setFilterVal(e.target.value)}
                      autoFocus
                    />
                  </div>

                  <div className="filter-panel-footer">
                    <button
                      type="submit"
                      className="btn btn-primary btn-sm w-full"
                      disabled={!filterVal.trim()}
                    >
                      Apply Filter
                    </button>
                  </div>
                </form>
              </div>
            )}
          </div>

          {/* Columns Visibility Toggle */}
          <div className="relative-dropdown-wrap">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => {
                setColumnsDropdownOpen(!columnsDropdownOpen);
                setFilterBuilderOpen(false);
              }}
            >
              <span>Columns</span>
              <span className="dropdown-caret">▾</span>
            </button>
            {columnsDropdownOpen && (
              <div className="dropdown-panel columns-panel">
                <div className="dropdown-header">Toggle Columns</div>
                <div className="columns-checkbox-list">
                  {columns.map((col) => (
                    <label key={col.name} className="column-checkbox-label">
                      <input
                        type="checkbox"
                        checked={!hiddenColumns[col.name]}
                        onChange={() => onToggleColumn(col.name)}
                      />
                      <span>{col.name}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Refresh Table */}
          {onRefresh && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={onRefresh}
              title="Refresh table"
            >
              ↻
            </button>
          )}

          {/* 3. Primary Add Row Button */}
          <button
            type="button"
            className="btn btn-primary btn-sm add-row-primary-btn"
            onClick={onOpenAddRow}
          >
            + Add Row
          </button>
        </div>
      </div>

      {/* Active Filter Chips Bar (Shown when filters are applied) */}
      {activeFilters.length > 0 && (
        <div className="active-filters-chips-bar">
          <span className="filter-chips-label">Filters:</span>
          {activeFilters.map((f, idx) => {
            const opSymbol =
              f.op === 'gt'
                ? '>'
                : f.op === 'lt'
                  ? '<'
                  : f.op === 'not_equals'
                    ? '!='
                    : f.op === 'contains'
                      ? 'contains'
                      : '=';
            return (
              <div key={idx} className="filter-chip">
                <span className="chip-text">
                  <strong>{f.col}</strong> {opSymbol} {f.val}
                </span>
                <button
                  type="button"
                  className="chip-remove-btn"
                  onClick={() => onRemoveFilter(idx)}
                  aria-label="Remove filter"
                >
                  ×
                </button>
              </div>
            );
          })}
          {onClearAllFilters && activeFilters.length > 1 && (
            <button
              type="button"
              className="btn-clear-all-filters"
              onClick={onClearAllFilters}
            >
              Clear all
            </button>
          )}
        </div>
      )}
    </div>
  );
}
