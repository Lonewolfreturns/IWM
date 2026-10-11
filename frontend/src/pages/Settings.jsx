import { useEffect, useMemo, useState } from 'react';
import {
  User, MapPin, Scale as ScaleIcon, Coffee, Utensils, UtensilsCrossed,
  Cookie, Moon, ExternalLink, Clock3, ShieldCheck, Eye, EyeOff,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import ChartCard from '../components/common/ChartCard.jsx';
import Badge from '../components/common/Badge.jsx';
import DataTable from '../components/common/DataTable.jsx';
import ClockTimePicker from '../components/common/ClockTimePicker.jsx';
import { getCurrentUser, changeCredentials } from '../services/auth';
import { getScales, updateScale } from '../services/scales';
import { updateMyProfile } from '../services/profile';
import SelectMenu from '../components/common/SelectMenu.jsx';
import DeleteAccountCard from '../components/common/DeleteAccountCard.jsx';
import { COMMON_TIME_ZONES } from '../lib/time.js';

// Kept in step with SECRET_QUESTIONS in SignUp.jsx — a question set here has
// to be one the login screen can show back to the user.
const SECRET_QUESTIONS = [
  'What is your favorite food?',
  'What was the name of your first pet?',
  'What city were you born in?',
  'What is your mother’s maiden name?',
  'What was the name of your first school?',
];

const MEAL_PERIODS = [
  { key: 'breakfast', label: 'Breakfast', Icon: Coffee, defaultFrom: '07:00', defaultTo: '09:00' },
  { key: 'lunch', label: 'Lunch', Icon: Utensils, defaultFrom: '12:00', defaultTo: '14:00' },
  { key: 'dinner', label: 'Dinner', Icon: UtensilsCrossed, defaultFrom: '18:00', defaultTo: '20:00' },
  { key: 'snacks', label: 'Snacks', Icon: Cookie, defaultFrom: '15:00', defaultTo: '16:00' },
  { key: 'night', label: 'Night', Icon: Moon, defaultFrom: '21:00', defaultTo: '23:00' },
];

function defaultMealSchedule() {
  return Object.fromEntries(
    MEAL_PERIODS.map((m) => [m.key, { from: m.defaultFrom, to: m.defaultTo }])
  );
}

function StatusDot({ status }) {
  const color =
    status === 'online' ? 'bg-leaf shadow-[0_0_8px_#22C55E]' : status === 'maintenance' ? 'bg-amber' : 'bg-red-500';
  return <span className={`shrink-0 w-2.5 h-2.5 rounded-full ${color}`} />;
}

/* -------------------------- Security (all roles) -------------------------- */

function PasswordField({ id, label, value, onChange, placeholder, autoComplete }) {
  const [shown, setShown] = useState(false);
  return (
    <div>
      <label htmlFor={id} className="block text-[11px] uppercase tracking-wider text-slate-400 mb-1.5">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type={shown ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete={autoComplete}
          data-testid={id}
          className="w-full h-11 pl-3 pr-11 rounded-xl bg-ink-800/60 border border-ink-600 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:border-sky/60"
        />
        <button
          type="button"
          onClick={() => setShown((v) => !v)}
          aria-label={shown ? 'Hide' : 'Show'}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
        >
          {shown ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}

/**
 * Password and security-question changes.
 *
 * Both live on one card and behind one re-authentication, because they are the
 * same kind of change and someone rotating their credentials usually wants
 * both — which should cost one round of typing, not two.
 */
function SecurityTab({ user }) {
  return (
    <div className="space-y-6">
      <CredentialsCard user={user} />
      {/* Account deletion lives under Password & Security rather than in a tab
          of its own. It is an account-level action, it is where a reviewer
          looks for it, and burying it would defeat the "readily discoverable"
          requirement it exists to satisfy. */}
      <DeleteAccountCard user={user} />
    </div>
  );
}

function CredentialsCard({ user }) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [currentSecretAnswer, setCurrentSecretAnswer] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [newSecretQuestion, setNewSecretQuestion] = useState(
    user.secretQuestion || SECRET_QUESTIONS[0]
  );
  const [newSecretAnswer, setNewSecretAnswer] = useState('');
  const [saving, setSaving] = useState(false);

  const wantsPassword = Boolean(newPassword || confirmPassword);
  const wantsSecret = Boolean(newSecretAnswer);

  const reset = () => {
    setCurrentPassword('');
    setCurrentSecretAnswer('');
    setNewPassword('');
    setConfirmPassword('');
    setNewSecretAnswer('');
  };

  const handleSave = async () => {
    if (!wantsPassword && !wantsSecret) {
      toast.error('Enter a new password or a new secret answer');
      return;
    }
    if (wantsPassword && newPassword.length < 8) {
      toast.error('New password must be at least 8 characters');
      return;
    }
    if (wantsPassword && newPassword !== confirmPassword) {
      toast.error('New passwords do not match');
      return;
    }
    if (!currentPassword || !currentSecretAnswer.trim()) {
      toast.error('Enter your current password and secret code to confirm');
      return;
    }

    setSaving(true);
    try {
      const { changed } = await changeCredentials({
        currentPassword,
        currentSecretAnswer: currentSecretAnswer.trim(),
        newPassword: wantsPassword ? newPassword : undefined,
        newSecretQuestion: wantsSecret ? newSecretQuestion : undefined,
        newSecretAnswer: wantsSecret ? newSecretAnswer.trim() : undefined,
      });
      const what = (changed || [])
        .map((c) => (c === 'password' ? 'password' : 'security question'))
        .join(' and ');
      toast.success(`Updated your ${what || 'credentials'}`, {
        description: 'Use the new details next time you sign in.',
      });
      reset();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Could not save the change');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ChartCard
      testId="security-card"
      title="Password & Security"
      subtitle="Change your password or your security question"
    >
      <div className="px-2 space-y-6">
        <section className="space-y-4">
          <h4 className="text-xs uppercase tracking-wider text-slate-400 font-semibold">
            New password
          </h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <PasswordField
              id="new-password"
              label="New password"
              value={newPassword}
              onChange={setNewPassword}
              placeholder="At least 8 characters"
              autoComplete="new-password"
            />
            <PasswordField
              id="confirm-new-password"
              label="Confirm new password"
              value={confirmPassword}
              onChange={setConfirmPassword}
              placeholder="Re-enter new password"
              autoComplete="new-password"
            />
          </div>
          <p className="text-[11px] text-slate-500">
            Leave both blank to keep your current password.
          </p>
        </section>

        <section className="space-y-4 pt-2 border-t border-ink-600/40">
          <h4 className="text-xs uppercase tracking-wider text-slate-400 font-semibold pt-4">
            Security question
          </h4>
          {user.secretQuestion && (
            <p className="text-[11px] text-slate-500 -mt-2">
              Currently: {user.secretQuestion}
            </p>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-[11px] uppercase tracking-wider text-slate-400 mb-1.5">
                Question
              </label>
              <SelectMenu
                value={newSecretQuestion}
                onChange={setNewSecretQuestion}
                options={SECRET_QUESTIONS.map((q) => ({ value: q, label: q }))}
                testId="new-secret-question"
              />
            </div>
            <div>
              <label
                htmlFor="new-secret-answer"
                className="block text-[11px] uppercase tracking-wider text-slate-400 mb-1.5"
              >
                New answer
              </label>
              <input
                id="new-secret-answer"
                type="text"
                value={newSecretAnswer}
                onChange={(e) => setNewSecretAnswer(e.target.value)}
                placeholder="e.g. Poutine"
                autoComplete="off"
                data-testid="new-secret-answer"
                className="w-full h-11 px-3 rounded-xl bg-ink-800/60 border border-ink-600 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:border-sky/60"
              />
            </div>
          </div>
          <p className="text-[11px] text-slate-500">
            Leave the answer blank to keep your current question. Capitals and
            extra spaces are ignored when you sign in.
          </p>
        </section>

        {/* Re-authentication. A valid session is not on its own enough to
            replace the credential that grants the next one. */}
        <section className="space-y-4 pt-2 border-t border-ink-600/40">
          <h4 className="text-xs uppercase tracking-wider text-slate-400 font-semibold pt-4 inline-flex items-center gap-2">
            <ShieldCheck className="w-3.5 h-3.5 text-sky" />
            Confirm it is you
          </h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <PasswordField
              id="current-password"
              label="Current password"
              value={currentPassword}
              onChange={setCurrentPassword}
              placeholder="Your password today"
              autoComplete="current-password"
            />
            <div>
              <label
                htmlFor="current-secret-answer"
                className="block text-[11px] uppercase tracking-wider text-slate-400 mb-1.5"
              >
                Current secret code
              </label>
              <input
                id="current-secret-answer"
                type="text"
                value={currentSecretAnswer}
                onChange={(e) => setCurrentSecretAnswer(e.target.value)}
                placeholder={user.secretQuestion || 'Your secret answer'}
                autoComplete="off"
                data-testid="current-secret-answer"
                className="w-full h-11 px-3 rounded-xl bg-ink-800/60 border border-ink-600 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:border-sky/60"
              />
            </div>
          </div>
        </section>

        <div className="flex justify-end pt-1">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            data-testid="save-credentials-btn"
            className="btn-sky h-11 px-6 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
    </ChartCard>
  );
}

/* --------------------------- Profile (all roles) -------------------------- */

function ProfileTab({ user }) {
  const [name, setName] = useState(user.name || '');
  const [phone, setPhone] = useState(user.phone || '');
  const [city, setCity] = useState(user.city || '');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error('Name cannot be empty');
      return;
    }
    setSaving(true);
    try {
      await updateMyProfile({ name: name.trim(), phone: phone.trim(), city: city.trim() });
      toast.success('Profile saved');
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Could not save profile');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ChartCard title="Profile" subtitle="Your personal information">
      <div className="px-2 grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-[11px] uppercase tracking-wider text-slate-400 mb-1.5">
            Name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            data-testid="profile-name"
            className="w-full h-11 px-3 rounded-xl bg-ink-800/60 border border-ink-600 text-sm text-slate-100 outline-none focus:border-sky/60"
          />
        </div>
        <div>
          <label className="block text-[11px] uppercase tracking-wider text-slate-400 mb-1.5">
            Email
          </label>
          {/* Email is the account's primary key — changing it would orphan the
              stored credentials, so the API rejects it. Read-only by design. */}
          <input
            type="email"
            value={user.email || ''}
            readOnly
            title="Email cannot be changed"
            data-testid="profile-email"
            className="w-full h-11 px-3 rounded-xl bg-ink-800/40 border border-ink-600 text-sm text-slate-300 outline-none cursor-not-allowed"
          />
        </div>
        <div>
          <label className="block text-[11px] uppercase tracking-wider text-slate-400 mb-1.5">
            Phone
          </label>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            data-testid="profile-phone"
            className="w-full h-11 px-3 rounded-xl bg-ink-800/60 border border-ink-600 text-sm text-slate-100 outline-none focus:border-sky/60"
          />
        </div>
        <div>
          <label className="block text-[11px] uppercase tracking-wider text-slate-400 mb-1.5">
            City
          </label>
          <input
            type="text"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            data-testid="profile-city"
            className="w-full h-11 px-3 rounded-xl bg-ink-800/60 border border-ink-600 text-sm text-slate-100 outline-none focus:border-sky/60"
          />
        </div>
        <div>
          <label className="block text-[11px] uppercase tracking-wider text-slate-400 mb-1.5">
            Organization
          </label>
          <input
            type="text"
            value={user.organization || ''}
            readOnly
            title="Only an admin can change your organization"
            className="w-full h-11 px-3 rounded-xl bg-ink-800/40 border border-ink-600 text-sm text-slate-300 outline-none cursor-not-allowed"
          />
        </div>
        <div>
          <label className="block text-[11px] uppercase tracking-wider text-slate-400 mb-1.5">
            Role
          </label>
          <input
            type="text"
            value={user.role || 'client'}
            readOnly
            className="w-full h-11 px-3 rounded-xl bg-ink-800/40 border border-ink-600 text-sm text-slate-300 outline-none capitalize cursor-not-allowed"
          />
        </div>
        <div className="sm:col-span-2 flex justify-end mt-2">
          <button
            type="button"
            className="btn-sky h-11"
            onClick={handleSave}
            disabled={saving}
            data-testid="profile-save-btn"
          >
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </div>
    </ChartCard>
  );
}

/* ----------------------------- Client: Scale Settings ---------------------------- */

function ScaleScheduleCard({ scale, config, onLocationChange, onTimeZoneChange, onMealEdgeChange }) {
  return (
    <div
      className="rounded-2xl border border-ink-600/60 bg-ink-800/30 p-4 sm:p-5"
      data-testid={`scale-schedule-${scale.id}`}
    >
      {/* Scale header */}
      <div className="flex items-center gap-3 flex-wrap mb-4">
        <StatusDot status={scale.status} />
        <div className="flex-1 min-w-[160px]">
          <div className="text-sm font-semibold text-white">{scale.name}</div>
          <div className="text-xs text-slate-500">{scale.id}</div>
        </div>
      </div>

      {/* Location */}
      <div className="mb-5 max-w-sm">
        <label className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-slate-400 mb-1.5">
          <MapPin className="w-3.5 h-3.5" /> Location
        </label>
        <input
          type="text"
          value={config.location}
          onChange={(e) => onLocationChange(e.target.value)}
          placeholder="e.g. Toronto, ON — Main Kitchen"
          data-testid={`scale-location-${scale.id}`}
          className="w-full h-11 px-3 rounded-xl bg-ink-800/60 border border-ink-600 text-sm text-slate-100 outline-none focus:border-sky/60"
        />
      </div>

      {/* Time zone — you know where the site is, so you set its clock. */}
      <div className="mb-5 max-w-sm">
        <label className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-slate-400 mb-1.5">
          <Clock3 className="w-3.5 h-3.5" /> Time Zone
        </label>
        <SelectMenu
          value={config.timeZone}
          onChange={onTimeZoneChange}
          options={[
            { value: '', label: 'Use my local time' },
            ...COMMON_TIME_ZONES.map((z) => ({ value: z.value, label: z.label })),
          ]}
          testId={`scale-timezone-${scale.id}`}
        />
        <p className="text-[11px] text-slate-500 mt-1.5">
          Readings and meal windows for this scale are shown in this zone.
        </p>
      </div>

      {/* Meal timings */}
      <div>
        <div className="text-[11px] uppercase tracking-wider text-slate-400 mb-3">
          Food Service Timings
        </div>
        <div className="flex flex-col gap-3">
          {MEAL_PERIODS.map(({ key, label, Icon }) => (
            <div
              key={key}
              className="flex items-center justify-between gap-3 flex-wrap rounded-xl border border-ink-600/60 bg-ink-900/30 px-4 py-3"
            >
              <div className="flex items-center gap-3">
                <span className="grid place-items-center w-9 h-9 rounded-lg bg-ink-700/60 text-sky shrink-0">
                  <Icon className="w-4 h-4" />
                </span>
                <span className="text-sm font-semibold text-white">{label}</span>
              </div>
              <div className="flex items-center gap-2.5 flex-wrap">
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] uppercase tracking-wider text-slate-500">From</span>
                  <ClockTimePicker
                    testId={`meal-time-${scale.id}-${key}-from`}
                    value={config.meals[key].from}
                    onChange={(v) => onMealEdgeChange(key, 'from', v)}
                  />
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] uppercase tracking-wider text-slate-500">To</span>
                  <ClockTimePicker
                    testId={`meal-time-${scale.id}-${key}-to`}
                    value={config.meals[key].to}
                    onChange={(v) => onMealEdgeChange(key, 'to', v)}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ClientScaleSettingsTab({ user }) {
  const [scales, setScales] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState({});

  useEffect(() => {
    let mounted = true;
    getScales()
      .then((data) => mounted && setScales(data))
      .catch(() => mounted && setScales([]))
      .finally(() => mounted && setLoading(false));
    return () => {
      mounted = false;
    };
  }, []);

  const myScales = useMemo(
    () => scales.filter((s) => s.organization === user.organization),
    [scales, user.organization]
  );

  // Seed per-scale settings the first time each scale appears, preferring the
  // schedule already saved on the server and falling back to sensible defaults.
  useEffect(() => {
    setSettings((prev) => {
      const missing = myScales.filter((s) => !prev[s.id]);
      if (missing.length === 0) return prev;
      const next = { ...prev };
      missing.forEach((s) => {
        next[s.id] = {
          location: s.location || '',
          timeZone: s.timeZone || '',
          meals: { ...defaultMealSchedule(), ...(s.mealSchedule || {}) },
        };
      });
      return next;
    });
  }, [myScales]);

  const updateLocation = (scaleId, value) => {
    setSettings((prev) => ({
      ...prev,
      [scaleId]: { ...prev[scaleId], location: value },
    }));
  };

  const updateTimeZone = (scaleId, value) => {
    setSettings((prev) => ({
      ...prev,
      [scaleId]: { ...prev[scaleId], timeZone: value },
    }));
  };

  const updateMealEdge = (scaleId, mealKey, edge, value) => {
    setSettings((prev) => ({
      ...prev,
      [scaleId]: {
        ...prev[scaleId],
        meals: {
          ...prev[scaleId].meals,
          [mealKey]: { ...prev[scaleId].meals[mealKey], [edge]: value },
        },
      },
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      // One PATCH per scale — the API scopes each write to the caller's org.
      const updated = await Promise.all(
        myScales.map((s) =>
          updateScale(s.id, {
            location: settings[s.id].location,
            timeZone: settings[s.id].timeZone,
            mealSchedule: settings[s.id].meals,
          })
        )
      );
      // Refresh from the server response so the UI reflects what was stored.
      setScales((prev) =>
        prev.map((s) => updated.find((u) => u.id === s.id) || s)
      );
      toast.success(
        `Saved ${updated.length} scale${updated.length === 1 ? '' : 's'}`
      );
    } catch (err) {
      toast.error(
        err?.response?.data?.message || 'Could not save scale settings'
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <ChartCard
      testId="my-scales-card"
      title="Your Scales — Location & Meal Schedule"
      subtitle="Set each scale's kitchen location and service-period time ranges"
      action={<Badge label={`${myScales.length} scale${myScales.length === 1 ? '' : 's'}`} variant="info" />}
    >
      {loading ? (
        <div className="px-3 py-6 text-sm text-slate-400">Loading scales…</div>
      ) : myScales.length === 0 ? (
        <div className="px-3 py-6 text-sm text-slate-400">
          No scales are assigned to your organization yet. Ask an admin to assign one.
        </div>
      ) : (
        <div className="px-1 sm:px-2 space-y-4">
          {myScales.map((s) =>
            settings[s.id] ? (
              <ScaleScheduleCard
                key={s.id}
                scale={s}
                config={settings[s.id]}
                onLocationChange={(v) => updateLocation(s.id, v)}
                onTimeZoneChange={(v) => updateTimeZone(s.id, v)}
                onMealEdgeChange={(mealKey, edge, v) => updateMealEdge(s.id, mealKey, edge, v)}
              />
            ) : null
          )}

          <div className="flex justify-end pt-1">
            <button
              type="button"
              className="btn-sky h-11"
              onClick={handleSave}
              disabled={saving}
              data-testid="scale-settings-save-btn"
            >
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </div>
      )}
    </ChartCard>
  );
}

/* ----------------------------- Admin: Manage Scales ---------------------------- */

function ManageScalesTab() {
  const navigate = useNavigate();
  const [scales, setScales] = useState([]);
  const [loading, setLoading] = useState(true);

  const reload = () => {
    setLoading(true);
    getScales()
      .then((rows) => setScales(rows || []))
      .catch(() => setScales([]))
      .finally(() => setLoading(false));
  };

  useEffect(reload, []);

  const columns = [
    {
      key: 'name',
      label: 'Scale',
      sortable: true,
      render: (r) => (
        <div>
          <div className="font-medium text-white">{r.name}</div>
          <div className="text-xs text-slate-500">{r.id}</div>
        </div>
      ),
    },
    { key: 'location', label: 'Location', sortable: true, cellClassName: 'whitespace-nowrap' },
    {
      key: 'status',
      label: 'Status',
      render: (r) => (
        <span className="inline-flex items-center gap-1.5">
          <StatusDot status={r.status} />
          <span className="capitalize text-slate-300">{r.status}</span>
        </span>
      ),
    },
    {
      key: 'assignedEmail',
      label: 'Assigned To',
      // Read-only. A scale can have any number of assignees, and the
      // single-select that used to live here sent the whole list as one value
      // — quietly dropping everyone else on a shared scale. Changing who has
      // access is done in Scale Management, which has the full checklist.
      render: (r) => {
        const people = r.assignedEmails || (r.assignedEmail ? [r.assignedEmail] : []);
        if (people.length === 0) {
          return <span className="text-slate-500 italic">Unassigned</span>;
        }
        return (
          <div className="min-w-[220px] leading-tight" data-testid={`assignees-${r.id}`}>
            {people.slice(0, 2).map((e) => (
              <div key={e} className="text-sm text-slate-300 truncate">{e}</div>
            ))}
            {people.length > 2 && (
              <div className="text-[11px] text-sky">+{people.length - 2} more</div>
            )}
            {r.organization && people.length <= 2 && (
              <div className="text-[10px] text-slate-500 truncate">{r.organization}</div>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <ChartCard
      testId="manage-scales-card"
      title="All Scales"
      subtitle="Assign any scale in the fleet to a client user"
      action={
        <button
          type="button"
          onClick={() => navigate('/scales')}
          className="btn-ghost h-9 text-xs"
          data-testid="open-scale-management-btn"
        >
          Full Scale Management <ExternalLink className="w-3.5 h-3.5" />
        </button>
      }
      bodyClassName="px-3 sm:px-5"
    >
      {loading ? (
        <div className="px-3 py-6 text-sm text-slate-400">Loading scales…</div>
      ) : (
        <DataTable
          testId="manage-scales-table"
          columns={columns}
          data={scales}
          searchableKeys={['name', 'id', 'location', 'client']}
          pageSize={8}
          emptyLabel="No scales found."
        />
      )}
    </ChartCard>
  );
}

/* -------------------------------- Page --------------------------------- */

export default function Settings() {
  const user = getCurrentUser() || {};
  const isAdmin = user.role === 'admin';

  const TABS = isAdmin
    ? [
        { key: 'profile', label: 'Profile', Icon: User },
        { key: 'security', label: 'Password & Security', Icon: ShieldCheck },
        { key: 'manageScales', label: 'Manage Scales', Icon: ScaleIcon },
      ]
    : [
        { key: 'profile', label: 'Profile', Icon: User },
        { key: 'security', label: 'Password & Security', Icon: ShieldCheck },
        { key: 'scaleSettings', label: 'Scale Settings', Icon: ScaleIcon },
      ];

  const [tab, setTab] = useState('profile');

  return (
    <div className="space-y-6 lg:space-y-8" data-testid="settings-page">
      <div>
        <div className="text-xs uppercase tracking-[0.22em] text-sky font-semibold mb-2">
          <User className="inline w-3.5 h-3.5 mr-1" /> Settings
        </div>
        <h2 className="font-display font-bold text-2xl sm:text-3xl text-white">
          Manage your account
        </h2>
        <p className="text-sm text-slate-400 mt-1">
          {isAdmin
            ? 'Update your profile and manage scale assignments across every client.'
            : 'Update your profile, kitchen location and meal schedule.'}
        </p>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1.5 p-1 bg-ink-800/60 border border-ink-600 rounded-xl w-full overflow-x-auto sm:w-fit">
        {TABS.map((t) => {
          const { Icon } = t;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              data-testid={`settings-tab-${t.key}`}
              className={`inline-flex items-center gap-2 px-4 h-10 rounded-lg text-sm font-semibold transition-all whitespace-nowrap ${
                tab === t.key
                  ? 'bg-sky-gradient text-ink-900 shadow-glow'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Icon className="w-4 h-4" />
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === 'profile' && <ProfileTab user={user} />}
      {tab === 'security' && <SecurityTab user={user} />}
      {tab === 'scaleSettings' && !isAdmin && <ClientScaleSettingsTab user={user} />}
      {tab === 'manageScales' && isAdmin && <ManageScalesTab />}
    </div>
  );
}
