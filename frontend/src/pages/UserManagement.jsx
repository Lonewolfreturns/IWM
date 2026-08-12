import { useEffect, useMemo, useState } from 'react';
import {
  Users, Shield, UserCheck, Pencil, Trash2,
  ToggleLeft, ToggleRight,
} from 'lucide-react';
import { toast } from 'sonner';
import DataTable from '../components/common/DataTable.jsx';
import Badge from '../components/common/Badge.jsx';
import Modal from '../components/common/Modal.jsx';
import StatCard from '../components/common/StatCard.jsx';
import SelectMenu from '../components/common/SelectMenu.jsx';
import { getUsers, updateUser, deleteUser } from '../services/users';

function initials(name) {
  return (name || '?')
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

function avatarColor(name) {
  const palette = [
    'from-sky-400 to-sky-500',
    'from-emerald-400 to-emerald-500',
    'from-amber-400 to-amber-500',
    'from-fuchsia-400 to-fuchsia-500',
    'from-rose-400 to-rose-500',
    'from-cyan-400 to-cyan-500',
    'from-violet-400 to-violet-500',
  ];
  const name_ = name || '';
  let h = 0;
  for (let i = 0; i < name_.length; i++) h = (h + name_.charCodeAt(i)) % palette.length;
  return palette[h];
}

function Avatar({ name }) {
  return (
    <div
      className={`w-9 h-9 rounded-full grid place-items-center text-xs font-bold text-ink-900 bg-gradient-to-br ${avatarColor(name)} shadow-md`}
      aria-hidden
    >
      {initials(name)}
    </div>
  );
}

function formatDate(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleString('en-CA', {
      month: 'short',
      day: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

const EMPTY_FORM = { name: '', email: '', role: 'client', organization: '' };

export default function UserManagement() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');

  const [editTarget, setEditTarget] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);

  const reload = async () => {
    setLoading(true);
    try {
      setUsers(await getUsers());
    } catch {
      setUsers([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reload();
  }, []);

  const orgOptions = useMemo(
    () => Array.from(new Set(users.map((u) => u.organization).filter(Boolean))),
    [users]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter((u) => {
      if (roleFilter !== 'all' && u.role !== roleFilter) return false;
      if (statusFilter !== 'all' && u.status !== statusFilter) return false;
      if (!q) return true;
      return (
        u.name?.toLowerCase().includes(q) ||
        u.email?.toLowerCase().includes(q)
      );
    });
  }, [users, search, roleFilter, statusFilter]);

  const stats = useMemo(
    () => ({
      total: users.length,
      active: users.filter((u) => u.status === 'active').length,
      admins: users.filter((u) => u.role === 'admin').length,
      clients: users.filter((u) => u.role === 'client').length,
    }),
    [users]
  );

  const openEdit = (row) => {
    setEditTarget(row);
    setForm({
      name: row.name,
      email: row.email,
      role: row.role,
      organization: row.organization,
    });
  };

  const handleSave = async () => {
    if (!editTarget) return;
    if (!form.name.trim() || !form.email.trim()) {
      toast.error('Name and email are required');
      return;
    }
    await updateUser(editTarget.id, form);
    toast.success(`Updated ${form.name}`);
    setEditTarget(null);
    setForm(EMPTY_FORM);
    reload();
  };

  const toggleStatus = async (row) => {
    const next = row.status === 'active' ? 'inactive' : 'active';
    await updateUser(row.id, { status: next });
    toast.success(next === 'active' ? `${row.name} reactivated` : `${row.name} deactivated`);
    reload();
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    await deleteUser(deleteTarget.id);
    toast.success(`Removed ${deleteTarget.name}`);
    setDeleteTarget(null);
    reload();
  };

  const columns = [
    {
      key: 'name',
      label: 'User',
      sortable: true,
      render: (r) => (
        <div className="flex items-center gap-3 min-w-[180px]">
          <Avatar name={r.name} />
          <div className="leading-tight">
            <div className="font-semibold text-white">{r.name}</div>
            <div className="text-xs text-slate-500 truncate">{r.email}</div>
          </div>
        </div>
      ),
    },
    {
      key: 'role',
      label: 'Role',
      sortable: true,
      render: (r) => (
        <Badge
          label={r.role}
          variant={r.role === 'admin' ? 'info' : 'success'}
        />
      ),
    },
    {
      key: 'organization',
      label: 'Organization',
      sortable: true,
      render: (r) => <span className="text-slate-300">{r.organization}</span>,
    },
    {
      key: 'status',
      label: 'Status',
      sortable: true,
      render: (r) => (
        <Badge
          label={r.status === 'active' ? 'Active' : 'Inactive'}
          variant={r.status === 'active' ? 'success' : 'danger'}
          dot
        />
      ),
    },
    {
      key: 'lastLogin',
      label: 'Last Login',
      sortable: true,
      render: (r) => (
        <span className="text-slate-400 text-xs whitespace-nowrap">
          {formatDate(r.lastLogin)}
        </span>
      ),
    },
    {
      key: 'actions',
      label: 'Actions',
      render: (r) => (
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label={`Edit ${r.name}`}
            onClick={() => openEdit(r)}
            data-testid={`edit-user-${r.id}`}
            className="grid place-items-center w-9 h-9 rounded-lg text-slate-300 hover:bg-sky/15 hover:text-sky transition-colors"
          >
            <Pencil className="w-4 h-4" />
          </button>
          <button
            type="button"
            aria-label={r.status === 'active' ? `Deactivate ${r.name}` : `Activate ${r.name}`}
            onClick={() => toggleStatus(r)}
            data-testid={`toggle-user-${r.id}`}
            className="grid place-items-center w-9 h-9 rounded-lg text-slate-300 hover:bg-amber/15 hover:text-amber transition-colors"
          >
            {r.status === 'active' ? (
              <ToggleRight className="w-4 h-4" />
            ) : (
              <ToggleLeft className="w-4 h-4" />
            )}
          </button>
          <button
            type="button"
            aria-label={`Delete ${r.name}`}
            onClick={() => setDeleteTarget(r)}
            data-testid={`delete-user-${r.id}`}
            className="grid place-items-center w-9 h-9 rounded-lg text-slate-300 hover:bg-red-500/15 hover:text-red-400 transition-colors"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6 lg:space-y-8" data-testid="users-page">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <div className="text-xs uppercase tracking-[0.22em] text-sky font-semibold mb-2">
            <Users className="inline w-3.5 h-3.5 mr-1" /> Admin · Users
          </div>
          <h2 className="font-display font-bold text-2xl sm:text-3xl text-white">
            User Management
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            Clients create their own accounts via sign-up — manage access and organization assignments here.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard testId="users-stat-total" title="Total Users" value={stats.total} icon={Users} color="sky" />
        <StatCard testId="users-stat-active" title="Active Users" value={stats.active} icon={UserCheck} color="green" />
        <StatCard testId="users-stat-admins" title="Admin Users" value={stats.admins} icon={Shield} color="amber" />
        <StatCard testId="users-stat-clients" title="Client Users" value={stats.clients} icon={Users} color="green" />
      </div>

      <div className="glass rounded-2xl p-4 sm:p-5 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="lg:col-span-2">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or email..."
              data-testid="user-search"
              className="w-full h-11 px-3 rounded-xl bg-ink-800/60 border border-ink-600 text-sm text-slate-100 outline-none focus:border-sky/60"
            />
          </div>
          <SelectMenu
            value={roleFilter}
            onChange={setRoleFilter}
            options={[
              { value: 'all', label: 'All Roles' },
              { value: 'client', label: 'Client' },
              { value: 'admin', label: 'Admin' },
            ]}
            testId="user-role-filter"
            className="sm:w-44"
          />
          <SelectMenu
            value={statusFilter}
            onChange={setStatusFilter}
            options={[
              { value: 'all', label: 'All Statuses' },
              { value: 'active', label: 'Active', color: '#22C55E' },
              { value: 'inactive', label: 'Inactive', color: '#64748B' },
            ]}
            testId="user-status-filter"
            className="sm:w-44"
          />
        </div>

        {loading ? (
          <div className="py-20 text-center text-slate-400">Loading users...</div>
        ) : (
          <DataTable
            testId="users-table"
            columns={columns}
            data={filtered}
            pageSize={8}
            emptyLabel="No users yet — they'll show up here once someone signs up."
          />
        )}
      </div>

      {/* Edit modal */}
      <Modal
        open={!!editTarget}
        onClose={() => setEditTarget(null)}
        title={editTarget ? `Edit ${editTarget.name}` : ''}
        subtitle={editTarget ? `ID: ${editTarget.id}` : ''}
        testId="user-modal"
        size="lg"
        footer={
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              className="btn-ghost h-11"
              onClick={() => setEditTarget(null)}
              data-testid="user-cancel-btn"
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn-sky h-11"
              onClick={handleSave}
              data-testid="user-save-btn"
            >
              Save Changes
            </button>
          </div>
        }
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <label className="block text-[11px] uppercase tracking-wider text-slate-400 mb-1.5">
              Full Name *
            </label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              data-testid="user-name-input"
              className="w-full h-11 px-3 rounded-xl bg-ink-800/60 border border-ink-600 text-sm text-slate-100 outline-none focus:border-sky/60"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-[11px] uppercase tracking-wider text-slate-400 mb-1.5">
              Email *
            </label>
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              data-testid="user-email-input"
              className="w-full h-11 px-3 rounded-xl bg-ink-800/60 border border-ink-600 text-sm text-slate-100 outline-none focus:border-sky/60"
            />
          </div>
          <div>
            <label className="block text-[11px] uppercase tracking-wider text-slate-400 mb-1.5">
              Role
            </label>
            <SelectMenu
              value={form.role}
              onChange={(v) => setForm({ ...form, role: v })}
              options={[
                { value: 'client', label: 'Client' },
                { value: 'admin', label: 'Admin' },
              ]}
              testId="user-role-input"
            />
          </div>
          <div>
            <label className="block text-[11px] uppercase tracking-wider text-slate-400 mb-1.5">
              Organization
            </label>
            <input
              type="text"
              value={form.organization}
              onChange={(e) => setForm({ ...form, organization: e.target.value })}
              list="org-options"
              data-testid="user-org-input"
              className="w-full h-11 px-3 rounded-xl bg-ink-800/60 border border-ink-600 text-sm text-slate-100 outline-none focus:border-sky/60"
            />
            <datalist id="org-options">
              {orgOptions.map((o) => (
                <option key={o} value={o} />
              ))}
            </datalist>
          </div>
        </div>
      </Modal>

      {/* Delete confirm */}
      <Modal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Delete user?"
        subtitle="This action cannot be undone."
        size="sm"
        testId="delete-user-modal"
        footer={
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              className="btn-ghost h-11"
              onClick={() => setDeleteTarget(null)}
              data-testid="delete-user-cancel"
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn-danger h-11"
              onClick={confirmDelete}
              data-testid="delete-user-confirm"
            >
              <Trash2 className="w-4 h-4" /> Delete
            </button>
          </div>
        }
      >
        <p className="text-sm text-slate-300">
          Are you sure you want to delete{' '}
          <span className="font-semibold text-white">
            {deleteTarget?.name}
          </span>
          ? They will immediately lose access to IWM.
        </p>
      </Modal>
    </div>
  );
}
