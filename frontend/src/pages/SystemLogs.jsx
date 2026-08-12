import { useEffect, useMemo, useState } from 'react';
import {
  Terminal, AlertOctagon, AlertTriangle, Info, CheckCircle2,
  Download, FileText, Copy, X,
} from 'lucide-react';
import { toast } from 'sonner';
import StatCard from '../components/common/StatCard.jsx';
import Modal from '../components/common/Modal.jsx';
import Badge from '../components/common/Badge.jsx';
import SelectMenu from '../components/common/SelectMenu.jsx';
import DatePicker from '../components/common/DatePicker.jsx';
import { getSystemLogs } from '../services/systemLogs';

const LEVEL_META = {
  error: { label: 'ERROR', variant: 'danger', Icon: AlertOctagon },
  warning: { label: 'WARNING', variant: 'warning', Icon: AlertTriangle },
  info: { label: 'INFO', variant: 'info', Icon: Info },
  success: { label: 'SUCCESS', variant: 'success', Icon: CheckCircle2 },
};

function formatTs(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleString('en-CA', {
      month: 'short',
      day: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  } catch {
    return iso;
  }
}

function buildDetails(log) {
  return {
    id: log.id,
    timestamp: log.timestamp,
    level: log.level?.toUpperCase(),
    source: log.source,
    user: log.user,
    message: log.message,
  };
}

const PAGE_SIZE = 20;

export default function SystemLogs() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [level, setLevel] = useState('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState(null);

  useEffect(() => {
    let mounted = true;
    getSystemLogs()
      .then((data) => mounted && setLogs(data))
      .catch(() => mounted && setLogs([]))
      .finally(() => mounted && setLoading(false));
    return () => {
      mounted = false;
    };
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return logs.filter((l) => {
      if (level !== 'all' && l.level !== level) return false;
      if (from) {
        const d = new Date(l.timestamp);
        if (d < new Date(from)) return false;
      }
      if (to) {
        const d = new Date(l.timestamp);
        const end = new Date(to);
        end.setHours(23, 59, 59, 999);
        if (d > end) return false;
      }
      if (!q) return true;
      return (
        l.message?.toLowerCase().includes(q) ||
        l.user?.toLowerCase().includes(q) ||
        l.source?.toLowerCase().includes(q)
      );
    });
  }, [logs, search, level, from, to]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paged = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const stats = useMemo(
    () => ({
      total: logs.length,
      error: logs.filter((l) => l.level === 'error').length,
      warning: logs.filter((l) => l.level === 'warning').length,
      info: logs.filter((l) => l.level === 'info').length,
    }),
    [logs]
  );

  const clearFilters = () => {
    setSearch('');
    setLevel('all');
    setFrom('');
    setTo('');
    setPage(1);
  };

  const detailJson = detail ? JSON.stringify(buildDetails(detail), null, 2) : '';

  const copyDetail = async () => {
    try {
      await navigator.clipboard.writeText(detailJson);
      toast.success('Log JSON copied to clipboard');
    } catch {
      toast.error('Could not copy');
    }
  };

  return (
    <div className="space-y-6 lg:space-y-8" data-testid="system-logs-page">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <div className="text-xs uppercase tracking-[0.22em] text-sky font-semibold mb-2">
            <Terminal className="inline w-3.5 h-3.5 mr-1" /> Admin · Logs
          </div>
          <h2 className="font-display font-bold text-2xl sm:text-3xl text-white">
            System Logs
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            Inspect every event flowing through IWM — auth, scales, alerts,
            data sync.
          </p>
        </div>
        <button
          type="button"
          className="btn-sky h-11"
          onClick={() => toast.success('Logs exported', { description: `${filtered.length} entries` })}
          data-testid="export-logs-btn"
        >
          <Download className="w-4 h-4" /> Export Logs
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard testId="logs-stat-total" title="Total Logs Today" value={stats.total} icon={Terminal} color="sky" />
        <StatCard testId="logs-stat-error" title="Errors" value={stats.error} icon={AlertOctagon} color="red" />
        <StatCard testId="logs-stat-warning" title="Warnings" value={stats.warning} icon={AlertTriangle} color="amber" />
        <StatCard testId="logs-stat-info" title="Info Logs" value={stats.info} icon={Info} color="green" />
      </div>

      <div className="glass rounded-2xl p-4 sm:p-5 space-y-4">
        {/* Filters */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3">
          <div className="xl:col-span-2">
            <input
              type="search"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Search by message, user or source..."
              data-testid="logs-search"
              className="w-full h-11 px-3 rounded-xl bg-ink-800/60 border border-ink-600 text-sm text-slate-100 outline-none focus:border-sky/60"
            />
          </div>
          <SelectMenu
            value={level}
            onChange={(v) => {
              setLevel(v);
              setPage(1);
            }}
            options={[
              { value: 'all', label: 'All Levels' },
              { value: 'error', label: 'Error', color: '#EF4444' },
              { value: 'warning', label: 'Warning', color: '#F59E0B' },
              { value: 'info', label: 'Info', color: '#38BDF8' },
              { value: 'success', label: 'Success', color: '#22C55E' },
            ]}
            testId="logs-level-filter"
          />
          <DatePicker
            value={from}
            max={to || undefined}
            onChange={(v) => {
              setFrom(v);
              setPage(1);
            }}
            placeholder="From"
            testId="logs-from"
          />
          <DatePicker
            value={to}
            min={from || undefined}
            onChange={(v) => {
              setTo(v);
              setPage(1);
            }}
            placeholder="To"
            testId="logs-to"
          />
        </div>

        <div className="flex items-center justify-between gap-3 text-xs text-slate-400">
          <span>
            <span className="text-white font-semibold">{filtered.length}</span> log entr{filtered.length === 1 ? 'y' : 'ies'} matching your filters
          </span>
          <button
            type="button"
            className="btn-ghost h-9 px-3 text-xs"
            onClick={clearFilters}
            data-testid="logs-clear-filters"
          >
            <X className="w-3.5 h-3.5" /> Clear Filters
          </button>
        </div>

        {/* Table */}
        <div className="overflow-x-auto rounded-xl border border-ink-600/60">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="bg-ink-800/70 text-slate-300">
              <tr>
                <th className="text-left font-semibold uppercase tracking-wider text-[11px] px-4 py-3">Timestamp</th>
                <th className="text-left font-semibold uppercase tracking-wider text-[11px] px-4 py-3">Level</th>
                <th className="text-left font-semibold uppercase tracking-wider text-[11px] px-4 py-3">Source</th>
                <th className="text-left font-semibold uppercase tracking-wider text-[11px] px-4 py-3">User</th>
                <th className="text-left font-semibold uppercase tracking-wider text-[11px] px-4 py-3">Message</th>
                <th className="text-left font-semibold uppercase tracking-wider text-[11px] px-4 py-3 w-24">Details</th>
              </tr>
            </thead>
            <tbody>
              {paged.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-center text-slate-400 px-4 py-12">
                    {loading ? 'Loading logs…' : 'No logs match your filters.'}
                  </td>
                </tr>
              )}
              {paged.map((l) => {
                const meta = LEVEL_META[l.level];
                const Icon = meta.Icon;
                return (
                  <tr
                    key={l.id}
                    className="border-t border-ink-600/40 hover:bg-ink-700/30 transition-colors"
                    data-testid={`log-row-${l.id}`}
                  >
                    <td className="px-4 py-3 text-slate-400 whitespace-nowrap text-xs font-mono">
                      {formatTs(l.timestamp)}
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1.5">
                        <Icon
                          className={`w-3.5 h-3.5 ${
                            l.level === 'error'
                              ? 'text-red-400'
                              : l.level === 'warning'
                              ? 'text-amber'
                              : l.level === 'info'
                              ? 'text-sky'
                              : 'text-leaf'
                          }`}
                        />
                        <Badge label={meta.label} variant={meta.variant} />
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-300 text-xs font-mono">{l.source}</td>
                    <td className="px-4 py-3 text-slate-300 text-xs truncate max-w-[180px]">{l.user}</td>
                    <td className="px-4 py-3 text-slate-200 max-w-[420px]">{l.message}</td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => setDetail(l)}
                        data-testid={`view-log-${l.id}`}
                        className="inline-flex items-center gap-1.5 text-xs font-semibold text-sky hover:text-sky/80 transition-colors"
                      >
                        <FileText className="w-3.5 h-3.5" />
                        Details
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between text-xs text-slate-400 px-1">
            <div>
              Showing {(safePage - 1) * PAGE_SIZE + 1}-{Math.min(safePage * PAGE_SIZE, filtered.length)} of {filtered.length}
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={safePage === 1}
                className="h-9 px-3 rounded-lg text-slate-300 hover:bg-ink-700/60 disabled:opacity-40 disabled:cursor-not-allowed"
                data-testid="logs-prev-page"
              >
                Previous
              </button>
              <div className="px-3 font-semibold text-white">{safePage} / {totalPages}</div>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={safePage === totalPages}
                className="h-9 px-3 rounded-lg text-slate-300 hover:bg-ink-700/60 disabled:opacity-40 disabled:cursor-not-allowed"
                data-testid="logs-next-page"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      <Modal
        open={!!detail}
        onClose={() => setDetail(null)}
        title={detail ? `Log ${detail.id}` : 'Log Detail'}
        subtitle={detail ? `${detail.source} · ${formatTs(detail.timestamp)}` : ''}
        size="lg"
        testId="log-detail-modal"
        footer={
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              className="btn-ghost h-11"
              onClick={() => setDetail(null)}
              data-testid="log-detail-close"
            >
              Close
            </button>
            <button
              type="button"
              className="btn-sky h-11"
              onClick={copyDetail}
              data-testid="log-detail-copy"
            >
              <Copy className="w-4 h-4" /> Copy JSON
            </button>
          </div>
        }
      >
        {detail && (
          <pre
            className="rounded-xl bg-ink-950 border border-ink-600 p-4 text-xs leading-relaxed font-mono text-slate-200 overflow-x-auto"
            style={{
              boxShadow: 'inset 0 0 0 1px rgba(56,189,248,0.06)',
            }}
          >
            <code
              dangerouslySetInnerHTML={{
                __html: detailJson
                  .replace(/("[^"]+":)/g, '<span style="color:#38BDF8">$1</span>')
                  .replace(/: ("[^"]*")/g, ': <span style="color:#22C55E">$1</span>')
                  .replace(/: (\d+)/g, ': <span style="color:#F59E0B">$1</span>'),
              }}
            />
          </pre>
        )}
      </Modal>
    </div>
  );
}
