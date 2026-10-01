import { useCallback, useEffect, useState, useMemo } from 'react';
import TableToolbar from './database/TableToolbar';
import TableView from './database/TableView';
import TablePagination from './database/TablePagination';
import TableStructure from './database/TableStructure';
import { AddRowModal, DeleteRowModal } from './database/TableEditor';
import AnalyticsDashboard from './analytics/AnalyticsDashboard';
import VendorChat from './vendor/VendorChat';
import { useToast } from './common/Toast';

const API = 'http://localhost:5000/api';

function rowKey(row, primaryKeys) {
  if (!primaryKeys?.length) return JSON.stringify(row);
  return primaryKeys.map((key) => row[key]).join('|');
}

export default function DatabaseWorkspace({
  token,
  dbStatus,
  onAuthError,
  user,
  schema: propSchema,
  selectedTable: propSelectedTable,
  onSelectTable: propOnSelectTable,
  onRefreshSchema: propOnRefreshSchema,
  isRefreshingSchema: propIsRefreshingSchema,
  activeTab: propActiveTab = 'data',
  onTabChange: propOnTabChange,
  onOpenMobileSidebar,
  openCopilotRequest = 0,
}) {
  const toast = useToast();

  // ── Schema & Selected Table ─────────────────────────
  const [internalSchema, setInternalSchema] = useState(null);
  const [internalSelectedTable, setInternalSelectedTable] = useState('');
  const [activeTab, setActiveTab] = useState(propActiveTab || 'data');
  const [internalIsRefreshingSchema, setInternalIsRefreshingSchema] = useState(false);

  const schema = propSchema || internalSchema;
  const selectedTable = propSelectedTable || internalSelectedTable;
  const isRefreshingSchema = propIsRefreshingSchema !== undefined ? propIsRefreshingSchema : internalIsRefreshingSchema;

  // ── Table Data & Pagination ─────────────────────────
  const [tableData, setTableData] = useState(null);
  const [isLoadingTable, setIsLoadingTable] = useState(false);
  const [tableError, setTableError] = useState('');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(50);
  const [sortCol, setSortCol] = useState('');
  const [sortDir, setSortDir] = useState('asc');
  const [searchQuery, setSearchQuery] = useState('');
  const [hiddenColumns, setHiddenColumns] = useState({});

  // ── Multi-Filter Builder State ──────────────────────
  const [activeFilters, setActiveFilters] = useState([]); // [{ col, op, val }]

  // ── Query Result View (when user executes a SELECT via @Intella) ──
  const [queryView, setQueryView] = useState(null);

  // ── Inline Editing State ────────────────────────────
  const [drafts, setDrafts] = useState({}); // { [rowKey]: { original: {}, changes: {} } }
  const [isSavingDrafts, setIsSavingDrafts] = useState(false);

  // ── Modals & Row Operations ─────────────────────────
  const [isAddRowOpen, setIsAddRowOpen] = useState(false);
  const [isInsertingRow, setIsInsertingRow] = useState(false);
  const [deleteTargetRow, setDeleteTargetRow] = useState(null);
  const [isDeletingRow, setIsDeletingRow] = useState(false);
  const [selectedRowKey, setSelectedRowKey] = useState('');

  // ── Export Dropdown ─────────────────────────────────
  const [exportDropdownOpen, setExportDropdownOpen] = useState(false);

  // ── Right Copilot Drawer Toggle ─────────────────────
  const [isCopilotOpen, setIsCopilotOpen] = useState(true);
  const [analyticsRefresh, setAnalyticsRefresh] = useState(0);

  useEffect(() => {
    if (openCopilotRequest > 0) setIsCopilotOpen(true);
  }, [openCopilotRequest]);

  const authHeaders = useMemo(() => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  }), [token]);

  // ── Load Database Schema ────────────────────────────
  const loadSchema = useCallback(async (preferredTable = '') => {
    if (propOnRefreshSchema) {
      await propOnRefreshSchema(preferredTable);
      return;
    }
    if (!token) return;
    setInternalIsRefreshingSchema(true);
    try {
      const res = await fetch(`${API}/database/schema`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (res.status === 401) {
        onAuthError?.(data.error);
        return;
      }
      if (data.success && data.schema) {
        setInternalSchema(data.schema);
        const tableNames = Object.keys(data.schema.tables || {});
        if (tableNames.length > 0) {
          setInternalSelectedTable((curr) => {
            if (preferredTable && tableNames.includes(preferredTable)) return preferredTable;
            if (curr && tableNames.includes(curr)) return curr;
            return tableNames[0];
          });
        }
      }
    } catch {
      toast.error('Failed to load database schema.');
    } finally {
      setInternalIsRefreshingSchema(false);
    }
  }, [token, onAuthError, toast, propOnRefreshSchema]);

  useEffect(() => {
    if (propActiveTab && propActiveTab !== activeTab) {
      setActiveTab(propActiveTab);
    }
  }, [propActiveTab]);

  const handleTabChange = (tab) => {
    setActiveTab(tab);
    propOnTabChange?.(tab);
  };

  const handleSelectTable = (tbl) => {
    setInternalSelectedTable(tbl);
    propOnSelectTable?.(tbl);
    setQueryView(null);
    setPage(1);
    setSearchQuery('');
    setActiveFilters([]);
    setDrafts({});
    setSelectedRowKey('');
    loadTable(tbl, 1, limit);
  };

  useEffect(() => {
    if (propSelectedTable && propSelectedTable !== selectedTable) {
      setInternalSelectedTable(propSelectedTable);
      setQueryView(null);
      setPage(1);
      setSearchQuery('');
      setActiveFilters([]);
      setDrafts({});
      setSelectedRowKey('');
      loadTable(propSelectedTable, 1, limit);
    }
  }, [propSelectedTable]);

  // ── Load Table Data from Server-side Endpoint ───────
  const loadTable = useCallback(
    async (tableName = selectedTable, targetPage = page, targetLimit = limit) => {
      if (!tableName || !token) return;
      setIsLoadingTable(true);
      setTableError('');

      try {
        const params = new URLSearchParams({
          page: String(targetPage),
          limit: String(targetLimit),
          sort: sortCol,
          dir: sortDir,
          q: searchQuery,
        });

        if (dbStatus.connectionId) {
          params.set('connectionId', String(dbStatus.connectionId));
        }

        const res = await fetch(
          `${API}/database/tables/${encodeURIComponent(tableName)}?${params}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );

        if (res.status === 401) {
          onAuthError?.('Session expired.');
          return;
        }

        const data = await res.json();
        if (!data.success) {
          setTableError(data.error || 'Could not load this table.');
          setTableData(null);
        } else {
          setTableData(data);
          setQueryView(null);
        }
      } catch {
        setTableError('Unable to load this table. The connection may have expired.');
      } finally {
        setIsLoadingTable(false);
      }
    },
    [selectedTable, page, limit, sortCol, sortDir, searchQuery, token, dbStatus.connectionId, onAuthError]
  );

  useEffect(() => {
    if (schema) return undefined;
    loadSchema();
    return undefined;
  }, [token, dbStatus?.connectionId]);

  useEffect(() => {
    if (selectedTable && !queryView) {
      loadTable(selectedTable, page, limit);
    }
  }, [selectedTable, page, limit, sortCol, sortDir]);

  // ── Derived Data Elements & Filtering ───────────────
  const rawColumns = queryView?.columns || tableData?.columns || [];
  const rawRows = queryView?.rows || tableData?.rows || [];
  const primaryKeys = tableData?.primaryKeys || rawColumns.filter((col) => col.primaryKey).map((col) => col.name);
  const currentStructure = schema?.tables?.[selectedTable];

  // Apply multi-filters to rows
  const filteredRows = useMemo(() => {
    if (!activeFilters || activeFilters.length === 0) return rawRows;

    return rawRows.filter((row) => {
      return activeFilters.every((filter) => {
        const rowVal = row[filter.col];
        if (rowVal === null || rowVal === undefined) return false;

        const valStr = String(rowVal).toLowerCase();
        const targetStr = String(filter.val).toLowerCase();
        const valNum = Number(rowVal);
        const targetNum = Number(filter.val);
        const hasNumbers = !isNaN(valNum) && !isNaN(targetNum);

        if (filter.op === 'equals') {
          return hasNumbers ? valNum === targetNum : valStr === targetStr;
        }
        if (filter.op === 'not_equals') {
          return hasNumbers ? valNum !== targetNum : valStr !== targetStr;
        }
        if (filter.op === 'contains') {
          return valStr.includes(targetStr);
        }
        if (filter.op === 'gt') {
          return hasNumbers ? valNum > targetNum : valStr > targetStr;
        }
        if (filter.op === 'lt') {
          return hasNumbers ? valNum < targetNum : valStr < targetStr;
        }
        return true;
      });
    });
  }, [rawRows, activeFilters]);

  const totalRows = queryView ? queryView.rows.length : (activeFilters.length > 0 ? filteredRows.length : (tableData?.total || 0));

  // ── Sorting Handler ─────────────────────────────────
  const handleSort = (colName) => {
    if (sortCol === colName) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortCol(colName);
      setSortDir('asc');
    }
    setPage(1);
  };


  // ── Column Visibility Toggle ────────────────────────
  const handleToggleColumn = (colName) => {
    setHiddenColumns((prev) => ({
      ...prev,
      [colName]: !prev[colName],
    }));
  };

  // ── Filter Builder Handlers ─────────────────────────
  const handleAddFilter = (newFilter) => {
    setActiveFilters((prev) => [...prev, newFilter]);
  };

  const handleRemoveFilter = (index) => {
    setActiveFilters((prev) => prev.filter((_, i) => i !== index));
  };

  const handleClearAllFilters = () => {
    setActiveFilters([]);
  };

  // ── Cell Editing Change Handler ─────────────────────
  const handleCellChange = (key, colName, newValue, originalValue) => {
    setDrafts((prev) => {
      const currentDraft = prev[key] || { original: {}, changes: {} };
      const updatedOriginal = {
        ...currentDraft.original,
        [colName]: currentDraft.original[colName] !== undefined ? currentDraft.original[colName] : originalValue,
      };
      const updatedChanges = {
        ...currentDraft.changes,
        [colName]: newValue,
      };

      if (String(newValue) === String(updatedOriginal[colName] ?? '')) {
        delete updatedChanges[colName];
      }

      if (Object.keys(updatedChanges).length === 0) {
        const copy = { ...prev };
        delete copy[key];
        return copy;
      }

      return {
        ...prev,
        [key]: {
          original: updatedOriginal,
          changes: updatedChanges,
        },
      };
    });
  };

  // ── Save All Draft Inline Changes ───────────────────
  const handleSaveDrafts = async () => {
    const draftEntries = Object.entries(drafts);
    if (draftEntries.length === 0) return;

    setIsSavingDrafts(true);
    let successCount = 0;
    let lastError = '';

    try {
      for (const [key, draft] of draftEntries) {
        const targetRow = rawRows.find((r) => rowKey(r, primaryKeys) === key);
        if (!targetRow) continue;

        const pkValues = {};
        primaryKeys.forEach((pk) => {
          pkValues[pk] = targetRow[pk];
        });

        const res = await fetch(`${API}/database/rows`, {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({
            connectionId: dbStatus.connectionId,
            action: 'update',
            table: selectedTable,
            primaryKey: pkValues,
            changes: draft.changes,
          }),
        });

        const data = await res.json();
        if (data.success) {
          successCount += data.affectedRows || 1;
        } else {
          lastError = data.error || 'Update failed.';
        }
      }

      if (successCount > 0) {
        toast.success(successCount === 1 ? '✓ Row updated successfully' : `✓ ${successCount} rows updated successfully`);
        setDrafts({});
        setAnalyticsRefresh((value) => value + 1);
        await loadTable(selectedTable, page, limit);
      }
      if (lastError) {
        toast.error(`Some updates could not be applied: ${lastError}`);
      }
    } catch (err) {
      toast.error(`Save failed: ${err.message}`);
    } finally {
      setIsSavingDrafts(false);
    }
  };

  const handleCancelDrafts = () => {
    setDrafts({});
  };

  // ── Insert New Row ──────────────────────────────────
  const handleInsertRow = async (values) => {
    setIsInsertingRow(true);
    try {
      const res = await fetch(`${API}/database/rows`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          connectionId: dbStatus.connectionId,
          action: 'insert',
          table: selectedTable,
          values,
        }),
      });

      const data = await res.json();
      if (!data.success) {
        throw new Error(data.error || 'Failed to insert row.');
      }

      toast.success('✓ 1 row inserted');
      setIsAddRowOpen(false);
      setPage(1);
      setAnalyticsRefresh((value) => value + 1);
      await loadTable(selectedTable, 1, limit);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setIsInsertingRow(false);
    }
  };

  // ── Delete Row ──────────────────────────────────────
  const handleDeleteRow = async () => {
    if (!deleteTargetRow) return;
    setIsDeletingRow(true);

    try {
      const pkValues = {};
      primaryKeys.forEach((pk) => {
        pkValues[pk] = deleteTargetRow[pk];
      });

      const res = await fetch(`${API}/database/rows`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          connectionId: dbStatus.connectionId,
          action: 'delete',
          table: selectedTable,
          primaryKey: pkValues,
        }),
      });

      const data = await res.json();
      if (!data.success) {
        throw new Error(data.error || 'Failed to delete row.');
      }

      toast.success('✓ 1 row deleted');
      setDeleteTargetRow(null);
      setAnalyticsRefresh((value) => value + 1);
      await loadTable(selectedTable, page, limit);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setIsDeletingRow(false);
    }
  };

  // ── Export Dropdown Handlers (CSV / JSON) ───────────
  const handleExportCSV = () => {
    if (!filteredRows || filteredRows.length === 0) {
      toast.warning('No data to export.');
      return;
    }

    const visibleCols = rawColumns.filter((c) => !hiddenColumns[c.name]);
    const headers = visibleCols.map((c) => `"${c.name.replace(/"/g, '""')}"`).join(',');
    const csvRows = filteredRows.map((r) =>
      visibleCols
        .map((c) => {
          const val = r[c.name];
          if (val === null || val === undefined) return '""';
          return `"${String(val).replace(/"/g, '""')}"`;
        })
        .join(',')
    );

    const csvContent = [headers, ...csvRows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `${selectedTable || 'export'}_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setExportDropdownOpen(false);
    toast.success(`Exported ${filteredRows.length} rows to CSV`);
  };

  const handleExportJSON = () => {
    if (!filteredRows || filteredRows.length === 0) {
      toast.warning('No data to export.');
      return;
    }

    const jsonContent = JSON.stringify(filteredRows, null, 2);
    const blob = new Blob([jsonContent], { type: 'application/json;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `${selectedTable || 'export'}_${new Date().toISOString().slice(0, 10)}.json`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setExportDropdownOpen(false);
    toast.success(`Exported ${filteredRows.length} rows to JSON`);
  };

  // ── Callback when @Intella executes modifications ───
  const handleCopilotDatabaseModified = async (modifiedTable) => {
    toast.success('✓ Database modified. Refreshing table...');
    await loadSchema(modifiedTable);
    setAnalyticsRefresh((value) => value + 1);
    if (modifiedTable === selectedTable) {
      await loadTable(selectedTable, page, limit);
    }
  };

  const unsavedCount = Object.keys(drafts).length;
  const capitalizedTitle = selectedTable ? selectedTable.charAt(0).toUpperCase() + selectedTable.slice(1) : 'Table';

  return (
    <div className="premium-workspace-viewport">
      {/* ── Center Main Workspace (Flexible, fills vertical space) ── */}
      <main className="premium-main-workspace">
        {/* Main Workspace Header */}
        <div className="workspace-main-header">
          <div className="header-meta-stack">
            {onOpenMobileSidebar && (
              <button
                type="button"
                className="workspace-mobile-menu-btn"
                onClick={onOpenMobileSidebar}
                title="Open navigation menu"
                aria-label="Open navigation menu"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="3" y1="12" x2="21" y2="12" />
                  <line x1="3" y1="6" x2="21" y2="6" />
                  <line x1="3" y1="18" x2="21" y2="18" />
                </svg>
              </button>
            )}

            <div className="title-and-metadata-line">
              <h2 className="workspace-current-table-title">{capitalizedTitle}</h2>
              <div className="workspace-db-context-meta">
                <span>{dbStatus.dbType || 'PostgreSQL'}</span>
                <span className="dot-separator">·</span>
                <span>{selectedTable || 'table'}</span>
                <span className="dot-separator">·</span>
                <span className="row-count-emphasis">{totalRows.toLocaleString()} rows</span>
              </div>
            </div>

            {/* Segmented Control Tabs */}
            <div className="segmented-tab-control" role="tablist">
              <button
                type="button"
                className={`segmented-tab-button ${activeTab === 'data' ? 'is-active' : ''}`}
                onClick={() => setActiveTab('data')}
                role="tab"
                aria-selected={activeTab === 'data'}
              >
                Data
              </button>
              <button
                type="button"
                className={`segmented-tab-button ${activeTab === 'analytics' ? 'is-active' : ''}`}
                onClick={() => setActiveTab('analytics')}
                role="tab"
                aria-selected={activeTab === 'analytics'}
              >
                Analytics
              </button>
              <button
                type="button"
                className={`segmented-tab-button ${activeTab === 'structure' ? 'is-active' : ''}`}
                onClick={() => setActiveTab('structure')}
                role="tab"
                aria-selected={activeTab === 'structure'}
              >
                Structure
              </button>
            </div>
          </div>

          {/* Actions Cluster: Refresh, Export Dropdown, Primary + Add Row, Copilot Drawer Toggle */}
          <div className="workspace-header-actions-group">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => {
                setQueryView(null);
                loadTable(selectedTable, page, limit);
              }}
              title="Refresh table data"
            >
              ↻ Refresh
            </button>

            {/* Export Dropdown */}
            <div className="relative-dropdown-wrap">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setExportDropdownOpen(!exportDropdownOpen)}
              >
                <span>Export</span>
                <span className="dropdown-caret">▾</span>
              </button>
              {exportDropdownOpen && (
                <div className="dropdown-panel export-dropdown-panel">
                  <button
                    type="button"
                    className="dropdown-item"
                    onClick={handleExportCSV}
                  >
                    Export as CSV (.csv)
                  </button>
                  <button
                    type="button"
                    className="dropdown-item"
                    onClick={handleExportJSON}
                  >
                    Export as JSON (.json)
                  </button>
                </div>
              )}
            </div>

            {/* Primary Action Button: + Add Row */}
            <button
              type="button"
              className="btn btn-primary btn-sm add-row-primary-action"
              onClick={() => setIsAddRowOpen(true)}
            >
              + Add Row
            </button>

            {/* AI Copilot Drawer Toggle */}
            <button
              type="button"
              className={`btn btn-sm copilot-drawer-toggle-btn ${isCopilotOpen ? 'active' : ''}`}
              onClick={() => setIsCopilotOpen(!isCopilotOpen)}
              title={isCopilotOpen ? 'Hide Intella' : 'Open Intella'}
              aria-label={isCopilotOpen ? 'Hide Intella' : 'Open Intella'}
            >
              <span>Intella</span>
              <span className="copilot-toggle-arrow">{isCopilotOpen ? '▸' : '◂'}</span>
            </button>
          </div>
        </div>

        {/* Unsaved Changes Banner */}
        {unsavedCount > 0 && (
          <div className="unsaved-changes-floating-bar" role="alert">
            <div className="unsaved-info">
              <span className="unsaved-dot">●</span>
              <span>
                <strong>{unsavedCount}</strong> unsaved {unsavedCount === 1 ? 'row edit' : 'row edits'}
              </span>
            </div>
            <div className="unsaved-actions">
              <button
                type="button"
                className="btn btn-secondary btn-xs"
                onClick={handleCancelDrafts}
                disabled={isSavingDrafts}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary btn-xs"
                onClick={handleSaveDrafts}
                disabled={isSavingDrafts}
              >
                {isSavingDrafts ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        )}

        {/* Stage Error Alert */}
        {tableError && (
          <div className="table-stage-error-banner" role="alert">
            <span className="error-icon">✕</span>
            <div className="error-text-content">
              <strong>Unable to load table:</strong> {tableError}
            </div>
            <button
              type="button"
              className="btn btn-secondary btn-xs"
              onClick={() => loadTable(selectedTable, page, limit)}
            >
              Retry
            </button>
          </div>
        )}

        {/* ── Tab 1: DATA EXPLORER ── */}
        {activeTab === 'data' && (
          <div className="workspace-tab-stage-view">
            <TableToolbar
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              onApplySearch={() => {
                setPage(1);
                loadTable(selectedTable, 1, limit);
              }}
              onRefresh={() => loadTable(selectedTable, page, limit)}
              onOpenAddRow={() => setIsAddRowOpen(true)}
              columns={rawColumns}
              hiddenColumns={hiddenColumns}
              onToggleColumn={handleToggleColumn}
              activeFilters={activeFilters}
              onAddFilter={handleAddFilter}
              onRemoveFilter={handleRemoveFilter}
              onClearAllFilters={handleClearAllFilters}
            />

            {/* Flexible table viewport container */}
            <div className="table-container-full-viewport">
              <TableView
                columns={rawColumns}
                rows={filteredRows}
                primaryKeys={primaryKeys}
                hiddenColumns={hiddenColumns}
                sortCol={sortCol}
                sortDir={sortDir}
                onSort={handleSort}
                isLoading={isLoadingTable}
                selectedRowKey={selectedRowKey}
                onSelectRow={(key) => setSelectedRowKey(key)}
                onOpenDeleteRow={(row) => setDeleteTargetRow(row)}
                drafts={drafts}
                onCellChange={handleCellChange}
                isReadOnly={Boolean(queryView)}
                onResetFilter={() => {
                  setSearchQuery('');
                  setActiveFilters([]);
                  setPage(1);
                  loadTable(selectedTable, 1, limit);
                }}
              />
            </div>

            {/* Sticky bottom pagination */}
            {!queryView && (
              <TablePagination
                page={page}
                limit={limit}
                total={totalRows}
                onPageChange={(nextPage) => {
                  setPage(nextPage);
                  loadTable(selectedTable, nextPage, limit);
                }}
                onLimitChange={(newLimit) => {
                  setLimit(newLimit);
                  setPage(1);
                  loadTable(selectedTable, 1, newLimit);
                }}
                isLoading={isLoadingTable}
              />
            )}
          </div>
        )}

        {/* ── Tab 2: ANALYTICS DASHBOARD ── */}
        {activeTab === 'analytics' && (
          <div className="workspace-tab-stage-view">
            <AnalyticsDashboard
              token={token}
              tableName={selectedTable}
              connectionId={dbStatus?.connectionId}
              refreshKey={analyticsRefresh}
              enabled={activeTab === 'analytics'}
              onAuthError={onAuthError}
            />
          </div>
        )}

        {/* ── Tab 3: STRUCTURE EXPLORER ── */}
        {activeTab === 'structure' && (
          <div className="workspace-tab-stage-view">
            <TableStructure
              structure={currentStructure}
              tableName={selectedTable}
            />
          </div>
        )}
      </main>

      {/* ── 3. Right Intella panel ── */}
      <VendorChat
        token={token}
        dbStatus={dbStatus}
        currentTable={selectedTable}
        schema={schema}
        user={user}
        onApplyQueryResult={(res) => {
          setQueryView(res);
          setActiveTab('data');
        }}
        onDatabaseModified={handleCopilotDatabaseModified}
        onAuthError={onAuthError}
        isOpen={isCopilotOpen}
        onClose={() => setIsCopilotOpen(false)}
      />

      {/* ── Add Row Modal ── */}
      {isAddRowOpen && (
        <AddRowModal
          tableName={selectedTable}
          columns={rawColumns}
          structure={currentStructure}
          onClose={() => setIsAddRowOpen(false)}
          onInsert={handleInsertRow}
          isInserting={isInsertingRow}
        />
      )}

      {/* ── Delete Row Confirmation Modal ── */}
      {deleteTargetRow && (
        <DeleteRowModal
          tableName={selectedTable}
          row={deleteTargetRow}
          primaryKeys={primaryKeys}
          columns={rawColumns}
          onClose={() => setDeleteTargetRow(null)}
          onDelete={handleDeleteRow}
          isDeleting={isDeletingRow}
        />
      )}
    </div>
  );
}
