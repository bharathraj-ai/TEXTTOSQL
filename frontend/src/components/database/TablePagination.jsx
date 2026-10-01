export default function TablePagination({
  page,
  limit = 50,
  total = 0,
  onPageChange,
  onLimitChange,
  isLoading = false,
}) {
  const pageCount = Math.max(1, Math.ceil(total / limit));
  const startRow = total === 0 ? 0 : (page - 1) * limit + 1;
  const endRow = Math.min(page * limit, total);

  return (
    <footer className="table-pagination-footer">
      <div className="pagination-range-text">
        Showing <strong>{startRow}–{endRow}</strong> of <strong>{total.toLocaleString()}</strong> rows
      </div>

      <div className="pagination-controls-compact">
        {onLimitChange && (
          <div className="pagination-limit-wrap">
            <span className="limit-title">Rows per page:</span>
            <select
              className="pagination-limit-select"
              value={limit}
              onChange={(e) => onLimitChange(Number(e.target.value))}
              disabled={isLoading}
            >
              <option value={10}>10</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
          </div>
        )}

        <div className="pagination-buttons-group">
          <button
            type="button"
            className="btn-pagination-nav"
            disabled={page <= 1 || isLoading}
            onClick={() => onPageChange(page - 1)}
            aria-label="Previous page"
          >
            ← Prev
          </button>

          <span className="pagination-page-indicator">
            Page {page} of {pageCount}
          </span>

          <button
            type="button"
            className="btn-pagination-nav"
            disabled={page >= pageCount || isLoading}
            onClick={() => onPageChange(page + 1)}
            aria-label="Next page"
          >
            Next →
          </button>
        </div>
      </div>
    </footer>
  );
}
