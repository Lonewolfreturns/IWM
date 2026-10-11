import { useEffect, useMemo, useState } from 'react';
import { Plus, Pencil, Link as LinkIcon, Trash2, Scale as ScaleIcon, CheckCircle2, AlertOctagon, HelpCircle, Search, Eraser, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import DataTable from '../components/common/DataTable.jsx';
import Badge from '../components/common/Badge.jsx';
import Modal from '../components/common/Modal.jsx';
import { getScales, addScale, updateScale, deleteScale } from '../services/scales';
import {
  getReadings, countReadingsForScale, purgeReadingsForScale,
} from '../services/readings';
import { getUsers } from '../services/users';
import StatCard from '../components/common/StatCard.jsx';
import SelectMenu from '../components/common/SelectMenu.jsx';
import { COMMON_TIME_ZONES, FLEET_TIME_ZONE_LABEL } from '../lib/time.js';
import ClockCheck from '../components/common/ClockCheck.jsx';
import {
  deriveScaleStatuses, latestByUid, summariseScaleStatuses,
} from '../lib/scaleStatus.js';

// Takes a derived state from lib/scaleStatus.js, not the stored `status`
// field. "Quiet" and "Silent" are distinct on purpose: readings are
// event-driven, so a day without a deposit is normal and a week without one
// is not — collapsing both to "Offline" threw that distinction away.
function StatusBadge({ state, registered }) {
  if (registered === false) return <Badge label="Unregistered" variant="info" dot />;
  if (state === 'online') return <Badge label="Online" variant="success" dot />;
  if (state === 'maintenance') return <Badge label="Maintenance" variant="warning" dot />;
  if (state === 'idle') return <Badge label="Quiet" variant="warning" dot />;
  if (state === 'silent') return <Badge label="Silent" variant="danger" dot />;
  return <Badge label="No data" variant="neutral" dot />;
}

export default function ScaleManagement() {
  const [scales, setScales] = useState([]);
  const [users, setUsers] = useState([]);
  const [usersError, setUsersError] = useState(null);
  const [loading, setLoading] = useState(true);

  const [addOpen, setAddOpen] = useState(false);
  const [readings, setReadings] = useState([]);
  // Why a load failed, rather than an empty page that looks like an empty
  // fleet. `Promise.allSettled` means one failing call no longer blanks the
  // others, but it also means a failure is otherwise completely silent.
  const [loadError, setLoadError] = useState(null);
  const [editTarget, setEditTarget] = useState(null);
  // Purging a scale's telemetry. `phrase` holds what has been typed so far;
  // the button stays disabled until it matches the UID exactly.
  const [purgeTarget, setPurgeTarget] = useState(null);
  const [purgeRows, setPurgeRows] = useState(null);
  const [purgePhrase, setPurgePhrase] = useState('');
  const [purging, setPurging] = useState(false);
  // Rows removed so far in the current purge, for the progress line. A large
  // device takes several round trips.
  const [purgeProgress, setPurgeProgress] = useState(0);
  // The form's values as the dialog opened, so a save can send only what the
  // person actually changed. See handleSave.
  const [original, setOriginal] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const [form, setForm] = useState({
    scaleId: '',
    name: '',
    location: '',
    timeZone: '',
    assignedEmails: [],
    serial: '',
    notes: '',
  });

  const reload = async ({ refresh = false } = {}) => {
    setLoading(true);
    // Readings come along because "is this scale online" is a question only
    // telemetry can answer — the stored `status` field is an admin flag that
    // nothing in the pipeline ever sets. See lib/scaleStatus.js.
    const [scalesData, usersData, readingsData] = await Promise.allSettled([
      // `refresh` bypasses the api Lambda's UID cache — see confirmPurge.
      getScales(refresh ? { refresh: 1 } : undefined), getUsers(), getReadings(),
    ]);
    const reason = (r) =>
      r.reason?.response?.data?.message || r.reason?.message || 'request failed';

    if (scalesData.status === 'fulfilled') {
      setScales(scalesData.value || []);
    } else {
      setScales([]);
      setLoadError(`Could not load scales — ${reason(scalesData)}`);
    }

    if (readingsData.status === 'fulfilled') {
      setReadings(readingsData.value || []);
      // A scales failure is the more serious of the two, so it wins the banner.
      if (scalesData.status === 'fulfilled') setLoadError(null);
    } else {
      setReadings([]);
      if (scalesData.status === 'fulfilled') {
        // Scales loaded, readings did not: the table renders, but every
        // status and last-reading is derived from telemetry and will read
        // "no data". Saying so beats a page that looks like a dead fleet.
        setLoadError(
          `Scales loaded, but readings did not — ${reason(readingsData)}. ` +
          'Status and Last Reading will show "no data" until this succeeds.'
        );
      }
    }

    // A failed user load and an empty user list both produce an assignment
    // dropdown with nothing in it. Keeping the reason means the form can say
    // which it is — "no client accounts exist yet" and "we could not reach the
    // API" call for completely different actions.
    if (usersData.status === 'fulfilled') {
      setUsers(usersData.value || []);
      setUsersError(null);
    } else {
      setUsers([]);
      setUsersError(
        usersData.reason?.response?.data?.message ||
          usersData.reason?.message ||
          'Could not load users'
      );
    }
    setLoading(false);
  };

  useEffect(() => {
    reload();
  }, []);

  // Derived from when each scale last reported, exactly as the Dashboard does.
  //
  // This used to read the stored `status` field, which no Lambda ever writes:
  // it defaults to "offline" at creation and only changes if someone edits the
  // form. So the Online tile showed 0 for a fleet that was actively sending
  // data, while the Dashboard — reading telemetry — showed several active.
  const statuses = useMemo(
    () => deriveScaleStatuses(scales, latestByUid(readings)),
    [scales, readings]
  );

  const stats = useMemo(() => summariseScaleStatuses(statuses), [statuses]);

  // Row id -> derived state, so the table's Status column can show the same
  // thing the tiles count.
  const stateById = useMemo(() => {
    const map = new Map();
    statuses.forEach((s) => map.set(s.id, s));
    return map;
  }, [statuses]);

  // Scales are assigned to a specific person, picked by email — an unambiguous
  // identifier the admin actually recognises. Visibility still resolves to that
  // person's organization server-side, so their colleagues see it too.
  const clientUsers = useMemo(
    () =>
      users
        .filter((u) => u.role === 'client')
        .sort((a, b) => (a.email || '').localeCompare(b.email || '')),
    [users]
  );

  // Organizations represented by the chosen assignees. With several owners
  // there is no single org, and it is only a label now, so the summary names
  // however many there are.
  const assignedOrgs = useMemo(
    () => [
      ...new Set(
        form.assignedEmails
          .map((e) => clientUsers.find((u) => u.email === e)?.organization)
          .filter(Boolean)
      ),
    ],
    [clientUsers, form.assignedEmails]
  );

  // Filters the assignee checklist. Local to the dialog, so it resets each
  // time one is opened rather than persisting a stale search.
  const [assigneeQuery, setAssigneeQuery] = useState('');

  /**
   * The checklist, ordered so the people already ticked come first.
   *
   * Selected entries are never filtered out. Typing a search that excluded
   * someone already assigned would make them silently disappear from a list
   * whose whole job is showing who has access — and the obvious next move,
   * saving, would look like it kept them while the box said otherwise.
   */
  const visibleAssignees = useMemo(() => {
    const q = assigneeQuery.trim().toLowerCase();
    const selected = form.assignedEmails;
    const match = (u) =>
      !q ||
      u.email.toLowerCase().includes(q) ||
      (u.organization || '').toLowerCase().includes(q);

    const chosen = clientUsers.filter((u) => selected.includes(u.email));
    const rest = clientUsers.filter((u) => !selected.includes(u.email) && match(u));
    return { chosen, rest, hiddenByQuery: Boolean(q) };
  }, [clientUsers, form.assignedEmails, assigneeQuery]);

  const toggleAssignee = (email) =>
    setForm((f) => ({
      ...f,
      assignedEmails: f.assignedEmails.includes(email)
        ? f.assignedEmails.filter((e) => e !== email)
        : [...f.assignedEmails, email],
    }));

  const resetForm = () => {
    setForm({
      scaleId: '',
      name: '',
      location: '',
      // Blank, not a guessed zone. "Not set" resolves to the fleet clock,
      // which is what these units actually keep; pre-filling a named zone
      // would assert a fact about the hardware nobody has checked.
      timeZone: '',
      assignedEmails: [],
      serial: '',
      notes: '',
    });
    setOriginal(null);
  };

  const openAdd = () => {
    resetForm();
    setAssigneeQuery('');
    setAddOpen(true);
  };

  // Provisioning a device we've already seen reporting: same dialog as Add,
  // with the UID locked in since it must match what the hardware sends.
  const openProvision = (scaleId) => {
    resetForm();
    setForm((f) => ({ ...f, scaleId, name: scaleId }));
    setAddOpen(true);
  };

  const openPurge = async (row) => {
    setPurgeTarget(row);
    setPurgePhrase('');
    setPurgeRows(null);
    try {
      const { rows } = await countReadingsForScale(row.scaleId || row.id);
      setPurgeRows(rows);
    } catch {
      // A failed count must not block the action, but it must not be silent
      // either — null renders as "could not count" rather than as zero.
      setPurgeRows(null);
    }
  };

  const confirmPurge = async () => {
    const uid = purgeTarget?.scaleId || purgeTarget?.id;
    if (!uid || purgePhrase !== uid) return;
    setPurging(true);
    setPurgeProgress(0);

    // One invocation deletes a bounded number of rows so it cannot hit the
    // Lambda timeout mid-delete; it reports `complete: false` when more
    // remain. Looping here is what makes the cap invisible — a device with
    // 200k readings is simply several round trips, not a partial job the
    // operator has to notice and repeat.
    let total = 0;
    try {
      // Bounded so a server that always answers `complete: false` cannot spin
      // forever. At 5000 rows an invocation this covers a million readings.
      for (let pass = 0; pass < 200; pass++) {
        // eslint-disable-next-line no-await-in-loop
        const res = await purgeReadingsForScale(uid);
        total += res.deleted || 0;
        setPurgeProgress(total);
        if (res.complete) break;
        if (!res.deleted) break;   // no progress: stop rather than loop
      }

      toast.success(
        `Deleted ${total.toLocaleString('en-CA')} reading${total === 1 ? '' : 's'} from ${uid}`,
        { description: 'The scale record itself was kept.' }
      );
      setPurgeTarget(null);
      setPurgePhrase('');
      // Force a fresh UID discovery: the api Lambda caches the list of
      // devices-with-telemetry for minutes, and the purge happened in a
      // different Lambda that cannot clear that cache.
      await reload({ refresh: true });
    } catch (err) {
      // No `response` at all means the request never reached AWS — a blocked
      // CORS preflight or an unreachable endpoint. That is a different problem
      // from a server that answered with an error, and the commonest cause is
      // the readings Lambda not yet carrying this route.
      const unreachable = !err?.response;
      toast.error(
        err?.response?.data?.message ||
          (unreachable
            ? 'The delete endpoint did not respond'
            : 'Could not delete the readings'),
        {
          description: unreachable
            ? 'The request never reached the server. If the readings Lambda has not been redeployed with the purge route, that is why.'
            : total
            ? `${total.toLocaleString('en-CA')} rows were removed before it failed.`
            : undefined,
        }
      );
      await reload({ refresh: true });
    } finally {
      setPurging(false);
      setPurgeProgress(0);
    }
  };

  const openEdit = (row) => {
    const values = {
      scaleId: row.scaleId || row.id,
      name: row.name,
      location: row.location || '',
      // Empty means "not set", and that is a real, meaningful value — it is
      // what makes the scale fall back to the fleet clock. Defaulting the box
      // to a zone would turn every edit into a silent time-zone assignment.
      timeZone: row.timeZone || '',
      // Reads either storage shape: rows written before scales became
      // shareable carry a single `assignedEmail` and no list.
      assignedEmails:
        row.assignedEmails || (row.assignedEmail ? [row.assignedEmail] : []),
      serial: row.serial || '',
      notes: row.notes || '',
    };
    setEditTarget(row);
    setForm(values);
    setOriginal(values);
    setAssigneeQuery('');
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      toast.error('Scale name is required');
      return;
    }
    if (!editTarget && !form.scaleId.trim()) {
      toast.error('Device UID is required — it must match the physical scale');
      return;
    }

    try {
      if (editTarget) {
        // Send only what actually changed.
        //
        // This used to PATCH the entire form on every save, which meant the API
        // saw a write to every field whether or not it had been touched. The
        // permission check is per field, so a client who edited nothing but the
        // location was told "You are not allowed to change: assignedEmail,
        // name, notes, serial" — a rejection listing four fields they had not
        // touched, naming the one thing they had changed nowhere at all.
        //
        // A PATCH should carry the change, not the whole record. Diffing here
        // also means two people editing different fields of the same scale no
        // longer overwrite each other.
        //
        // scaleId is the partition key and can't be changed after creation.
        const { scaleId, ...editable } = form;
        // Compared through JSON so the assignee array is diffed by contents.
        // A plain !== on two arrays is always true, which would put every save
        // back to sending fields nobody touched.
        const same = (a, b) =>
          Array.isArray(a) || Array.isArray(b)
            ? JSON.stringify(a) === JSON.stringify(b)
            : a === b;
        const changed = Object.fromEntries(
          Object.entries(editable).filter(([k, v]) => !same(v, original?.[k]))
        );

        if (Object.keys(changed).length === 0) {
          toast.info('No changes to save');
          setEditTarget(null);
          resetForm();
          return;
        }

        await updateScale(editTarget.id, changed);
        toast.success(`Updated ${form.name}`);
        setEditTarget(null);
      } else {
        const created = await addScale({ ...form, scaleId: form.scaleId.trim().toUpperCase() });
        toast.success(`Scale ${created.id} added`, { description: form.name });
        setAddOpen(false);
      }
      resetForm();
      reload();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Could not save scale');
    }
  };

  const handleAssign = (row) => {
    toast.info(`Reassign ${row.name} from the Edit dialog for now`);
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    await deleteScale(deleteTarget.id);
    toast.success(`Removed ${deleteTarget.name}`);
    setDeleteTarget(null);
    reload();
  };

  const columns = [
    { key: 'id', label: 'Scale ID', sortable: true, cellClassName: 'font-mono text-xs text-slate-400' },
    { key: 'name', label: 'Name', sortable: true, render: (r) => <span className="font-semibold text-white">{r.name}</span> },
    { key: 'location', label: 'Location', sortable: true, render: (r) => <span className="text-slate-300">{r.location}</span> },
    {
      key: 'organization',
      label: 'Assigned To',
      sortable: true,
      render: (r) => {
        const people = r.assignedEmails || (r.assignedEmail ? [r.assignedEmail] : []);
        if (people.length === 0) {
          return <span className="text-slate-500 italic">Unassigned</span>;
        }
        return (
          <div className="leading-tight" title={people.join('\n')}>
            <div className="text-slate-300 truncate">{people[0]}</div>
            {people.length > 1 ? (
              <div className="text-xs text-sky">+{people.length - 1} more</div>
            ) : (
              r.organization && (
                <div className="text-xs text-slate-500 truncate">{r.organization}</div>
              )
            )}
          </div>
        );
      },
    },
    {
      key: 'status',
      label: 'Status',
      sortable: true,
      render: (r) => {
        const s = stateById.get(r.scaleId || r.id);
        return <StatusBadge state={s?.state} registered={r.registered} />;
      },
    },
    {
      key: 'lastReading',
      label: 'Last Reading',
      sortable: true,
      // `lastReading` and `lastActive` are stored on the record but, like
      // `status`, nothing ever writes them — this column read "0 kg" for every
      // scale in the fleet. Both now come from the telemetry.
      render: (r) => {
        const s = stateById.get(r.scaleId || r.id);
        return (
          <div className="leading-tight">
            <div className="tabular-nums text-slate-200">
              {s?.lastKg == null ? '—' : `${s.lastKg.toFixed(2)} kg`}
            </div>
            <div className="text-[11px] text-slate-500">
              {s?.lastSeenLabel || 'never reported'}
            </div>
          </div>
        );
      },
    },
    {
      key: 'lastActive',
      label: 'Last Active',
      render: (r) => <span className="text-slate-400 text-xs">{r.lastActive}</span>,
    },
    {
      key: 'actions',
      label: 'Actions',
      render: (r) =>
        // An unregistered device has no record to edit or delete — the only
        // sensible action is to provision it, with its UID already known.
        r.registered === false ? (
          // No record to edit or delete, but the readings are real and this is
          // exactly where test devices pile up — so the purge belongs here
          // most of all.
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => openProvision(r.scaleId)}
              data-testid={`provision-${r.id}`}
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-xs font-semibold bg-sky/15 text-sky border border-sky/30 hover:bg-sky/25 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" /> Provision
            </button>
            <button
              type="button"
              aria-label={`Delete all readings from ${r.name}`}
              title="Delete all recorded data for this device"
              onClick={() => openPurge(r)}
              className="grid place-items-center w-9 h-9 rounded-lg text-slate-300 hover:bg-amber/15 hover:text-amber transition-colors"
              data-testid={`purge-${r.id}`}
            >
              <Eraser className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-label={`Edit ${r.name}`}
              onClick={() => openEdit(r)}
              className="grid place-items-center w-9 h-9 rounded-lg text-slate-300 hover:bg-sky/15 hover:text-sky transition-colors"
              data-testid={`edit-${r.id}`}
            >
              <Pencil className="w-4 h-4" />
            </button>
            <button
              type="button"
              aria-label={`Assign ${r.name}`}
              onClick={() => handleAssign(r)}
              className="grid place-items-center w-9 h-9 rounded-lg text-slate-300 hover:bg-leaf/15 hover:text-leaf transition-colors"
              data-testid={`assign-${r.id}`}
            >
              <LinkIcon className="w-4 h-4" />
            </button>
            {/* Clearing telemetry is a different act from removing the
                scale, so it gets its own control rather than a checkbox
                inside the delete dialog. */}
            <button
              type="button"
              aria-label={`Delete all readings from ${r.name}`}
              title="Delete all recorded data for this scale"
              onClick={() => openPurge(r)}
              className="grid place-items-center w-9 h-9 rounded-lg text-slate-300 hover:bg-amber/15 hover:text-amber transition-colors"
              data-testid={`purge-${r.id}`}
            >
              <Eraser className="w-4 h-4" />
            </button>
            <button
              type="button"
              aria-label={`Delete ${r.name}`}
              onClick={() => setDeleteTarget(r)}
              className="grid place-items-center w-9 h-9 rounded-lg text-slate-300 hover:bg-red-500/15 hover:text-red-400 transition-colors"
              data-testid={`delete-${r.id}`}
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ),
    },
  ];

  return (
    <div className="space-y-6 lg:space-y-8" data-testid="scales-page">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <div className="text-xs uppercase tracking-[0.22em] text-sky font-semibold mb-2">
            <ScaleIcon className="inline w-3.5 h-3.5 mr-1" /> Admin
          </div>
          <h2 className="font-display font-bold text-2xl sm:text-3xl text-white">
            Scale Management
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            Manage your fleet of IWM scales across Canada.
          </p>
        </div>
        <button
          type="button"
          className="btn-sky h-11"
          onClick={openAdd}
          data-testid="add-scale-btn"
        >
          <Plus className="w-4 h-4" /> Add New Scale
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          testId="scale-stat-total"
          title="Total Scales"
          value={stats.total}
          icon={ScaleIcon}
          color="sky"
        />
        <StatCard
          testId="scale-stat-online"
          title="Online"
          value={stats.online}
          icon={CheckCircle2}
          color="green"
        />
        <StatCard
          testId="scale-stat-offline"
          title="Offline"
          value={stats.offline}
          icon={AlertOctagon}
          color="red"
        />
        <StatCard
          testId="scale-stat-unregistered"
          title="Unregistered"
          value={stats.unregistered}
          hint="Sending data with no scale record yet — also counted above"
          changeLabel={undefined}
          icon={HelpCircle}
          color="amber"
        />
      </div>

      <div className="glass rounded-2xl p-4 sm:p-5">
        {loading ? (
          <div className="py-20 text-center text-slate-400">Loading scales...</div>
        ) : (
          <DataTable
            testId="scales-table"
            columns={columns}
            data={scales}
            searchableKeys={['id', 'name', 'location', 'organization', 'status']}
            pageSize={10}
          />
        )}
      </div>

      {/* Add / Edit modal */}
      <Modal
        open={addOpen || !!editTarget}
        onClose={() => {
          setAddOpen(false);
          setEditTarget(null);
        }}
        title={editTarget ? `Edit ${editTarget.name}` : 'Add New Scale'}
        subtitle={editTarget ? `ID: ${editTarget.id}` : 'Provision a new scale and assign it to a client.'}
        testId="scale-modal"
        footer={
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              className="btn-ghost h-11"
              onClick={() => {
                setAddOpen(false);
                setEditTarget(null);
              }}
              data-testid="scale-cancel-btn"
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn-sky h-11"
              onClick={handleSave}
              data-testid="scale-save-btn"
            >
              {editTarget ? 'Save Changes' : 'Add Scale'}
            </button>
          </div>
        }
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <label className="block text-[11px] uppercase tracking-wider text-slate-400 mb-1.5">
              Device UID {editTarget ? '' : '*'}
            </label>
            <input
              type="text"
              value={form.scaleId}
              onChange={(e) => setForm({ ...form, scaleId: e.target.value.toUpperCase() })}
              placeholder="e.g. DAL00001"
              readOnly={!!editTarget}
              title={editTarget ? 'The device UID cannot be changed after provisioning' : ''}
              data-testid="scale-uid-input"
              className={`w-full h-11 px-3 rounded-xl border border-ink-600 text-sm outline-none font-mono ${
                editTarget
                  ? 'bg-ink-800/40 text-slate-400 cursor-not-allowed'
                  : 'bg-ink-800/60 text-slate-100 focus:border-sky/60'
              }`}
            />
            <p className="text-[11px] text-slate-500 mt-1.5">
              {editTarget
                ? 'Fixed at provisioning — incoming readings are keyed to this UID.'
                : 'Must exactly match the ID the physical scale reports, or its readings will not be attributed.'}
            </p>
          </div>
          <div>
            <label className="block text-[11px] uppercase tracking-wider text-slate-400 mb-1.5">
              Scale Name *
            </label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. Prep Station Alpha"
              data-testid="scale-name-input"
              className="w-full h-11 px-3 rounded-xl bg-ink-800/60 border border-ink-600 text-sm text-slate-100 outline-none focus:border-sky/60"
            />
          </div>
          <div>
            <label className="block text-[11px] uppercase tracking-wider text-slate-400 mb-1.5">
              Location
            </label>
            <input
              type="text"
              value={form.location}
              onChange={(e) => setForm({ ...form, location: e.target.value })}
              placeholder="e.g. Dalhousie University — Risley Hall"
              data-testid="scale-location-input"
              className="w-full h-11 px-3 rounded-xl bg-ink-800/60 border border-ink-600 text-sm text-slate-100 outline-none focus:border-sky/60"
            />
          </div>
          <div>
            <label className="block text-[11px] uppercase tracking-wider text-slate-400 mb-1.5">
              Device Clock
            </label>
            <SelectMenu
              value={form.timeZone}
              onChange={(v) => setForm({ ...form, timeZone: v })}
              options={[
                { value: '', label: 'Not set — show times exactly as recorded' },
                ...COMMON_TIME_ZONES.map((z) => ({ value: z.value, label: z.label })),
              ]}
              testId="scale-timezone-input"
            />
            {/* This field used to read "readings are displayed in this zone",
                which is the model backwards and led to it being set to wherever
                the kitchen is. It describes the clock the hardware keeps: that
                is what turns a bare "12:01" into a real instant. Where it is
                displayed is the viewer's own preference, set in Settings. */}
            <p className="text-[11px] text-slate-500 mt-1.5">
              The clock this unit's hardware keeps — not where the kitchen is.
              Left unset, its readings are displayed exactly as the scale wrote
              them. Set it and they are converted into whichever zone you
              prefer, which is only worth doing once you know what clock the
              device actually keeps — the check below infers it.
            </p>
            {/* Only on edit: a scale being provisioned has no readings to
                infer anything from yet. */}
            {editTarget && (
              <div className="mt-3 pt-3 border-t border-ink-600/40">
                <div className="text-[10px] uppercase tracking-wider text-slate-400 mb-2">
                  Clock check
                </div>
                <ClockCheck uid={editTarget.scaleId || editTarget.id} currentZone={form.timeZone} />
              </div>
            )}
          </div>
          <div className="sm:col-span-2">
            <label className="block text-[11px] uppercase tracking-wider text-slate-400 mb-1.5">
              Assign To User
            </label>
            {/* A checklist, not a dropdown: a scale can be allotted to any
                number of people, and each one gets access in their own right.
                Trying to share by adding the device a second time is what
                produced "already registered" — there is only ever one row per
                physical scale. */}
            <div className="rounded-xl bg-ink-800/60 border border-ink-600 overflow-hidden">
              {/* Only worth the vertical space once the list is long enough to
                  scroll past what fits. */}
              {clientUsers.length > 5 && (
                <div className="relative border-b border-ink-600/60">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
                  <input
                    type="text"
                    value={assigneeQuery}
                    onChange={(e) => setAssigneeQuery(e.target.value)}
                    placeholder={`Search ${clientUsers.length} users by email or organization`}
                    data-testid="assignee-search"
                    className="w-full h-10 pl-9 pr-3 bg-transparent text-sm text-slate-100 placeholder:text-slate-500 outline-none"
                  />
                </div>
              )}

              <div
                className="max-h-44 overflow-y-auto divide-y divide-ink-600/40"
                data-testid="scale-client-input"
              >
                {[...visibleAssignees.chosen, ...visibleAssignees.rest].map((u) => {
                  const checked = form.assignedEmails.includes(u.email);
                  return (
                    <label
                      key={u.email}
                      className={`flex items-center gap-3 px-3 py-2.5 cursor-pointer transition-colors ${
                        checked ? 'bg-sky/10 text-white' : 'text-slate-300 hover:bg-ink-700/30'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleAssignee(u.email)}
                        data-testid={`assignee-${u.email}`}
                        className="accent-sky w-4 h-4 shrink-0"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm truncate">{u.email}</span>
                        {u.organization && (
                          <span className="block text-[11px] text-slate-500 truncate">
                            {u.organization}
                          </span>
                        )}
                      </span>
                    </label>
                  );
                })}

                {visibleAssignees.rest.length === 0 && visibleAssignees.hiddenByQuery && (
                  <p className="px-3 py-3 text-xs text-slate-500">
                    No other users match “{assigneeQuery}”.
                  </p>
                )}
              </div>
            </div>
            {/* Three genuinely different situations, previously all rendered
                as the same empty list. */}
            {usersError ? (
              <p className="text-[11px] text-amber mt-1.5" data-testid="assign-users-error">
                Could not load the user list — {usersError}.{' '}
                <button
                  type="button"
                  onClick={reload}
                  className="underline hover:text-white"
                >
                  Retry
                </button>
              </p>
            ) : !loading && clientUsers.length === 0 ? (
              <p className="text-[11px] text-slate-400 mt-1.5" data-testid="assign-users-empty">
                No client accounts exist yet, so there is nobody to assign to.
                Admin accounts can't own scales — a client signs up at{' '}
                <span className="text-slate-300">/signup</span>, then appears here.
                You can still provision the scale unassigned.
              </p>
            ) : (
              <p className="text-[11px] text-slate-500 mt-1.5">
                {/* Access is granted per person, so the summary counts
                    people. Organizations are named only as a label. */}
                {form.assignedEmails.length > 0
                  ? `Visible to ${form.assignedEmails.length} ${
                      form.assignedEmails.length === 1 ? 'person' : 'people'
                    }${assignedOrgs.length ? ` (${assignedOrgs.join(', ')})` : ''}. Only the people ticked here can see this scale.`
                  : `Nobody selected — the scale stays visible to admins only. ${clientUsers.length} client account${clientUsers.length === 1 ? '' : 's'} available.`}
              </p>
            )}
          </div>
          <div>
            <label className="block text-[11px] uppercase tracking-wider text-slate-400 mb-1.5">
              Serial Number
            </label>
            <input
              type="text"
              value={form.serial}
              onChange={(e) => setForm({ ...form, serial: e.target.value })}
              placeholder="SN-AX-XXX-CA"
              data-testid="scale-serial-input"
              className="w-full h-11 px-3 rounded-xl bg-ink-800/60 border border-ink-600 text-sm text-slate-100 outline-none focus:border-sky/60 font-mono"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-[11px] uppercase tracking-wider text-slate-400 mb-1.5">
              Notes
            </label>
            <textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="Installation details, contact person, etc."
              rows={3}
              data-testid="scale-notes-input"
              className="w-full px-3 py-2.5 rounded-xl bg-ink-800/60 border border-ink-600 text-sm text-slate-100 outline-none focus:border-sky/60 resize-none"
            />
          </div>
        </div>
      </Modal>

      {loadError && (
        <div
          className="flex items-start gap-2.5 rounded-xl border border-amber/40 bg-amber/10 px-4 py-3"
          data-testid="scales-load-error"
        >
          <AlertTriangle className="w-4 h-4 text-amber shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm text-amber-200">{loadError}</p>
            <button
              type="button"
              onClick={() => reload()}
              className="mt-1 text-xs text-slate-300 underline hover:text-white"
            >
              Try again
            </button>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      <Modal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Delete scale?"
        subtitle="This action cannot be undone."
        size="sm"
        testId="delete-modal"
        footer={
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              className="btn-ghost h-11"
              onClick={() => setDeleteTarget(null)}
              data-testid="delete-cancel-btn"
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn-danger h-11"
              onClick={confirmDelete}
              data-testid="delete-confirm-btn"
            >
              <Trash2 className="w-4 h-4" /> Delete
            </button>
          </div>
        }
      >
        <p className="text-sm text-slate-300">
          You're about to remove{' '}
          <span className="font-semibold text-white">
            {deleteTarget?.name}
          </span>{' '}
          ({deleteTarget?.id}). This will stop data collection from this scale.
        </p>
      </Modal>

      {/* Purge readings — type-to-confirm */}
      <Modal
        open={!!purgeTarget}
        onClose={() => !purging && setPurgeTarget(null)}
        title="Delete all recorded data?"
        subtitle="This cannot be undone."
        size="sm"
        testId="purge-modal"
        footer={
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              className="btn-ghost h-11"
              onClick={() => setPurgeTarget(null)}
              disabled={purging}
              data-testid="purge-cancel-btn"
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn-danger h-11 disabled:opacity-40 disabled:cursor-not-allowed"
              onClick={confirmPurge}
              // The UID must be typed exactly. Deliberately not a plain
              // "type CONFIRM": that word is the same on every dialog, so it
              // becomes muscle memory and stops proving anything. Typing the
              // UID proves you know which scale you are standing on.
              disabled={purging || purgePhrase !== (purgeTarget?.scaleId || purgeTarget?.id)}
              data-testid="purge-confirm-btn"
            >
              <Trash2 className="w-4 h-4" />
              {purging
                ? purgeProgress
                  ? `Deleting… ${purgeProgress.toLocaleString('en-CA')}`
                  : 'Deleting…'
                : 'Delete data'}
            </button>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="flex items-start gap-2.5 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2.5">
            <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
            <p className="text-xs text-red-200 leading-relaxed">
              Every reading recorded by this scale will be permanently removed
              from the database. There is no undo and no backup — this data is
              the only copy.
            </p>
          </div>

          <p className="text-sm text-slate-300">
            {purgeRows == null ? (
              <>Counting readings for{' '}
                <span className="font-mono text-white">
                  {purgeTarget?.scaleId || purgeTarget?.id}
                </span>…
              </>
            ) : (
              <>
                <span className="font-semibold text-white">
                  {purgeRows.toLocaleString('en-CA')}
                </span>{' '}
                reading{purgeRows === 1 ? '' : 's'} from{' '}
                <span className="font-mono text-white">
                  {purgeTarget?.scaleId || purgeTarget?.id}
                </span>{' '}
                will be deleted.
              </>
            )}
          </p>

          <p className="text-xs text-slate-400">
            The scale itself is kept — its name, assignment, clock and schedule
            all stay as they are. Only the recorded readings go, so the device
            simply starts from an empty history.
          </p>

          <div>
            <label
              htmlFor="purge-confirm-input"
              className="block text-[11px] uppercase tracking-wider text-slate-400 mb-1.5"
            >
              Type{' '}
              <span className="font-mono text-slate-200 normal-case">
                {purgeTarget?.scaleId || purgeTarget?.id}
              </span>{' '}
              to confirm
            </label>
            <input
              id="purge-confirm-input"
              type="text"
              value={purgePhrase}
              onChange={(e) => setPurgePhrase(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              placeholder={purgeTarget?.scaleId || purgeTarget?.id}
              data-testid="purge-confirm-input"
              className="w-full h-11 px-3 rounded-xl bg-ink-800/60 border border-ink-600 text-sm font-mono text-slate-100 placeholder:text-slate-600 outline-none focus:border-red-500/60"
            />
          </div>
        </div>
      </Modal>
    </div>
  );
}
