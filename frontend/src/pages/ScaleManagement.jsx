import { useEffect, useMemo, useState } from 'react';
import { Plus, Pencil, Link as LinkIcon, Trash2, Scale as ScaleIcon, CheckCircle2, AlertOctagon, HelpCircle } from 'lucide-react';
import { toast } from 'sonner';
import DataTable from '../components/common/DataTable.jsx';
import Badge from '../components/common/Badge.jsx';
import Modal from '../components/common/Modal.jsx';
import { getScales, addScale, updateScale, deleteScale } from '../services/scales';
import { getUsers } from '../services/users';
import StatCard from '../components/common/StatCard.jsx';
import SelectMenu from '../components/common/SelectMenu.jsx';
import { COMMON_TIME_ZONES } from '../lib/time.js';

function StatusBadge({ status }) {
  if (status === 'online') return <Badge label="Online" variant="success" dot />;
  if (status === 'offline') return <Badge label="Offline" variant="danger" dot />;
  // A device reporting telemetry that was never provisioned here.
  if (status === 'unregistered') return <Badge label="Unregistered" variant="info" dot />;
  return <Badge label="Maintenance" variant="warning" dot />;
}

export default function ScaleManagement() {
  const [scales, setScales] = useState([]);
  const [users, setUsers] = useState([]);
  const [usersError, setUsersError] = useState(null);
  const [loading, setLoading] = useState(true);

  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const [form, setForm] = useState({
    scaleId: '',
    name: '',
    location: '',
    timeZone: 'America/Halifax',
    assignedEmail: '',
    serial: '',
    notes: '',
  });

  const reload = async () => {
    setLoading(true);
    const [scalesData, usersData] = await Promise.allSettled([getScales(), getUsers()]);
    setScales(scalesData.status === 'fulfilled' ? scalesData.value : []);

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

  const stats = useMemo(() => {
    const total = scales.length;
    const online = scales.filter((s) => s.status === 'online').length;
    const offline = scales.filter((s) => s.status === 'offline').length;
    // Devices reporting telemetry that have never been provisioned here —
    // surfaced so an admin can actually act on them.
    const unregistered = scales.filter((s) => s.registered === false).length;
    return { total, online, offline, unregistered };
  }, [scales]);

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

  const assignedOrg = useMemo(
    () => clientUsers.find((u) => u.email === form.assignedEmail)?.organization || '',
    [clientUsers, form.assignedEmail]
  );

  const resetForm = () =>
    setForm({
      scaleId: '',
      name: '',
      location: '',
      timeZone: 'America/Halifax',
      assignedEmail: '',
      serial: '',
      notes: '',
    });

  const openAdd = () => {
    resetForm();
    setAddOpen(true);
  };

  // Provisioning a device we've already seen reporting: same dialog as Add,
  // with the UID locked in since it must match what the hardware sends.
  const openProvision = (scaleId) => {
    resetForm();
    setForm((f) => ({ ...f, scaleId, name: scaleId }));
    setAddOpen(true);
  };

  const openEdit = (row) => {
    setEditTarget(row);
    setForm({
      scaleId: row.scaleId || row.id,
      name: row.name,
      location: row.location || '',
      timeZone: row.timeZone || 'America/Halifax',
      assignedEmail: row.assignedEmail || '',
      serial: row.serial || '',
      notes: row.notes || '',
    });
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
        // scaleId is the partition key and can't be changed after creation.
        const { scaleId, ...editable } = form;
        await updateScale(editTarget.id, editable);
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
      render: (r) =>
        r.organization || r.assignedEmail ? (
          <div className="leading-tight">
            <div className="text-slate-300">{r.organization || '—'}</div>
            {r.assignedEmail && (
              <div className="text-xs text-slate-500 truncate">{r.assignedEmail}</div>
            )}
          </div>
        ) : (
          <span className="text-slate-500 italic">Unassigned</span>
        ),
    },
    {
      key: 'status',
      label: 'Status',
      sortable: true,
      render: (r) => <StatusBadge status={r.status} />,
    },
    {
      key: 'lastReading',
      label: 'Last Reading',
      sortable: true,
      render: (r) => <span className="tabular-nums text-slate-200">{r.lastReading} kg</span>,
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
          <button
            type="button"
            onClick={() => openProvision(r.scaleId)}
            data-testid={`provision-${r.id}`}
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-xs font-semibold bg-sky/15 text-sky border border-sky/30 hover:bg-sky/25 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" /> Provision
          </button>
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
          changeLabel={stats.unregistered ? 'Reporting but not provisioned' : undefined}
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
              Time Zone
            </label>
            <SelectMenu
              value={form.timeZone}
              onChange={(v) => setForm({ ...form, timeZone: v })}
              options={[
                { value: '', label: "Use viewer's local time" },
                ...COMMON_TIME_ZONES.map((z) => ({ value: z.value, label: z.label })),
              ]}
              testId="scale-timezone-input"
            />
            <p className="text-[11px] text-slate-500 mt-1.5">
              Readings from this scale are displayed in this zone.
            </p>
          </div>
          <div className="sm:col-span-2">
            <label className="block text-[11px] uppercase tracking-wider text-slate-400 mb-1.5">
              Assign To User
            </label>
            <SelectMenu
              value={form.assignedEmail}
              onChange={(v) => setForm({ ...form, assignedEmail: v })}
              options={[
                { value: '', label: '— Unassigned —' },
                ...clientUsers.map((u) => ({
                  value: u.email,
                  label: `${u.email}${u.organization ? ` — ${u.organization}` : ''}`,
                })),
              ]}
              testId="scale-client-input"
            />
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
                {assignedOrg
                  ? `Visible to everyone at ${assignedOrg}.`
                  : `Leave unassigned to provision the scale now and allocate it later. ${clientUsers.length} client account${clientUsers.length === 1 ? '' : 's'} available.`}
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
    </div>
  );
}
