import { useMemo, useState } from 'react';
import { Search, ChevronUp, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';

// A single bad row/column should never blank the whole table (or app) — fall back to "—".
function renderCell(col, row) {
  try {
    return col.render ? col.render(row) : row?.[col.key] ?? '—';
  } catch {
    return '—';
  }
}

/**
 * Generic, controlled-ish data table.
 *
 * Props:
 *  - columns: [{ key, label, sortable?, render?(row) => node, className? }]
 *  - data: array
 *  - searchableKeys: string[]
 *  - pageSize: number (default 10)
 *  - emptyLabel: string
 */
export default function DataTable({
  columns,
  data,
  searchableKeys = [],
  pageSize = 10,
  emptyLabel = 'No records found.',
  // Extra filter controls, rendered beside the search box. Kept as a slot so
  // this component stays generic — it knows nothing about what is being
  // filtered, only that the caller has already narrowed `data`.
  toolbar = null,
  testId,
}) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState({ key: null, dir: 'asc' });
  const [page, setPage] = useState(1);

  const safeData = Array.isArray(data) ? data : [];

  const filtered = useMemo(() => {
    if (!query.trim()) return safeData;
    const q = query.toLowerCase();
    return safeData.filter((row) =>
      searchableKeys.some((k) => String(row?.[k] ?? '').toLowerCase().includes(q))
    );
  }, [safeData, query, searchableKeys]);

  const sorted = useMemo(() => {
    if (!sort.key) return filtered;
    const out = [...filtered];
    out.sort((a, b) => {
      const av = a[sort.key];
      const bv = b[sort.key];
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'number' && typeof bv === 'number') {
        return sort.dir === 'asc' ? av - bv : bv - av;
      }
      return sort.dir === 'asc'
        ? String(av).localeCompare(String(bv))
        : String(bv).localeCompare(String(av));
    });
    return out;
  }, [filtered, sort]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const paged = sorted.slice((safePage - 1) * pageSize, safePage * pageSize);

  const toggleSort = (key) => {
    setSort((s) => {
      if (s.key !== key) return { key, dir: 'asc' };
      return { key, dir: s.dir === 'asc' ? 'desc' : 'asc' };
    });
  };

  return (
    <div className="flex flex-col gap-3" data-testid={testId}>
      {(searchableKeys.length > 0 || toolbar) && (
        <div className="flex flex-col lg:flex-row lg:items-center gap-3">
          {searchableKeys.length > 0 && (
            <div className="flex items-center gap-2 w-full lg:max-w-xs h-11 rounded-xl bg-ink-800/60 border border-ink-600 px-3 focus-within:border-sky/60 transition-all">
              <Search className="w-4 h-4 text-slate-400" />
              <input
                type="search"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setPage(1);
                }}
                placeholder="Search..."
                className="flex-1 bg-transparent outline-none text-sm placeholder:text-slate-500 text-slate-100"
                data-testid="datatable-search"
              />
            </div>
          )}
          {toolbar}
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-ink-600/60">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="bg-ink-800/70 text-slate-300">
            <tr>
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={`text-left font-semibold uppercase tracking-wider text-[11px] px-4 py-3 ${
                    col.className || ''
                  }`}
                >
                  {col.sortable ? (
                    <button
                      type="button"
                      onClick={() => toggleSort(col.key)}
                      className="inline-flex items-center gap-1.5 hover:text-white transition-colors"
                      data-testid={`sort-${col.key}`}
                    >
                      {col.label}
                      <span className="flex flex-col -my-1.5">
                        <ChevronUp
                          className={`w-3 h-3 -mb-1 ${
                            sort.key === col.key && sort.dir === 'asc'
                              ? 'text-sky'
                              : 'text-slate-500'
                          }`}
                        />
                        <ChevronDown
                          className={`w-3 h-3 ${
                            sort.key === col.key && sort.dir === 'desc'
                              ? 'text-sky'
                              : 'text-slate-500'
                          }`}
                        />
                      </span>
                    </button>
                  ) : (
                    col.label
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {paged.length === 0 && (
              <tr>
                <td
                  colSpan={columns.length}
                  className="text-center text-slate-400 px-4 py-12"
                >
                  {emptyLabel}
                </td>
              </tr>
            )}
            {paged.map((row, i) => (
              <tr
                key={row.id || i}
                className="border-t border-ink-600/40 hover:bg-ink-700/30 transition-colors"
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={`px-4 py-3 text-slate-200 ${col.cellClassName || ''}`}
                  >
                    {renderCell(col, row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-xs text-slate-400 px-1">
          <div>
            Showing {(safePage - 1) * pageSize + 1}
            {'-'}
            {Math.min(safePage * pageSize, sorted.length)} of {sorted.length}
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={safePage === 1}
              aria-label="Previous page"
              className="grid place-items-center w-9 h-9 rounded-lg text-slate-300 hover:bg-ink-700/60 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <div className="px-3 font-semibold text-white">
              {safePage} / {totalPages}
            </div>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={safePage === totalPages}
              aria-label="Next page"
              className="grid place-items-center w-9 h-9 rounded-lg text-slate-300 hover:bg-ink-700/60 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
