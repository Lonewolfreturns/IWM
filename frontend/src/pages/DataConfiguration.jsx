import { useState } from 'react';
import {
  Database, Save, Bell, Building2, Carrot, Milk, Beef, Wheat, Apple, Boxes,
} from 'lucide-react';
import { toast } from 'sonner';
import ChartCard from '../components/common/ChartCard.jsx';
import SelectMenu from '../components/common/SelectMenu.jsx';

const CATEGORY_DEFS = [
  { key: 'vegetables', label: 'Vegetables', Icon: Carrot, color: '#22C55E', daily: 25, weekly: 150 },
  { key: 'dairy', label: 'Dairy', Icon: Milk, color: '#38BDF8', daily: 18, weekly: 110 },
  { key: 'meat', label: 'Meat', Icon: Beef, color: '#EF4444', daily: 22, weekly: 140 },
  { key: 'bread', label: 'Bread', Icon: Wheat, color: '#F59E0B', daily: 15, weekly: 90 },
  { key: 'fruits', label: 'Fruits', Icon: Apple, color: '#A78BFA', daily: 12, weekly: 75 },
  { key: 'other', label: 'Other', Icon: Boxes, color: '#94A3B8', daily: 10, weekly: 60 },
];

function ToggleSwitch({ checked, onChange, testId, ariaLabel }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={() => onChange(!checked)}
      data-testid={testId}
      className={`relative w-11 h-6 rounded-full transition-all shrink-0 ${
        checked ? 'bg-sky shadow-glow' : 'bg-ink-700 border border-ink-600'
      }`}
    >
      <span
        className={`absolute top-[2px] left-[2px] w-5 h-5 rounded-full bg-white shadow-md transition-all ${
          checked ? 'translate-x-5' : ''
        }`}
      />
    </button>
  );
}

export default function DataConfiguration() {
  // Section 1 — Thresholds
  const [thresholds, setThresholds] = useState(
    CATEGORY_DEFS.reduce((acc, c) => {
      acc[c.key] = { daily: c.daily, weekly: c.weekly, alert: true };
      return acc;
    }, {})
  );

  // Section 2 — Collection
  const [collection, setCollection] = useState({
    frequency: '15',
    retention: '90',
    autoExport: true,
    exportTime: '06:00',
  });

  // Section 3 — Alerts
  const [alerts, setAlerts] = useState({
    email: true,
    emailValue: 'admin@iwm.ca',
    sms: false,
    smsValue: '+1 (416) 555-0142',
    slack: false,
    slackValue: 'https://hooks.slack.com/services/T0/B0/XXX',
    severity: 'medium',
  });

  // Section 4 — Organization
  const [org, setOrg] = useState({
    name: 'IWM',
    industry: 'Restaurant',
    timezone: 'America/Toronto',
    currency: 'CAD',
  });

  const updateThreshold = (key, field, value) => {
    setThresholds((prev) => ({
      ...prev,
      [key]: { ...prev[key], [field]: value },
    }));
  };

  return (
    <div className="space-y-6 lg:space-y-8" data-testid="data-config-page">
      <div>
        <div className="text-xs uppercase tracking-[0.22em] text-sky font-semibold mb-2">
          <Database className="inline w-3.5 h-3.5 mr-1" /> Admin · Data
        </div>
        <h2 className="font-display font-bold text-2xl sm:text-3xl text-white">
          Data Configuration
        </h2>
        <p className="text-sm text-slate-400 mt-1">
          Tune thresholds, collection cadence, alerting and organization
          defaults for your IWM tenant.
        </p>
      </div>

      {/* Section 1: Thresholds */}
      <ChartCard
        testId="thresholds-card"
        title="Waste Thresholds"
        subtitle="Configure daily and weekly waste limits per food category."
      >
        <div className="px-2">
          <div className="hidden md:grid grid-cols-[1.4fr_1fr_1fr_auto] gap-4 px-3 pb-2 text-[11px] uppercase tracking-wider text-slate-400 font-semibold">
            <span>Category</span>
            <span>Daily (kg)</span>
            <span>Weekly (kg)</span>
            <span className="text-right">Alerts</span>
          </div>
          <div className="divide-y divide-ink-600/40">
            {CATEGORY_DEFS.map(({ key, label, Icon, color }) => (
              <div
                key={key}
                className="grid md:grid-cols-[1.4fr_1fr_1fr_auto] grid-cols-2 gap-3 md:gap-4 items-center px-3 py-3"
              >
                <div className="col-span-2 md:col-span-1 flex items-center gap-3">
                  <span
                    className="w-9 h-9 rounded-lg grid place-items-center shrink-0"
                    style={{ background: `${color}22`, color }}
                  >
                    <Icon className="w-4 h-4" />
                  </span>
                  <span className="font-semibold text-white">{label}</span>
                </div>
                <div>
                  <span className="md:hidden block text-[10px] uppercase tracking-wider text-slate-500 mb-1">Daily</span>
                  <input
                    type="number"
                    min={0}
                    value={thresholds[key].daily}
                    onChange={(e) => updateThreshold(key, 'daily', Number(e.target.value))}
                    data-testid={`threshold-daily-${key}`}
                    className="w-full h-10 px-3 rounded-lg bg-ink-800/60 border border-ink-600 text-sm text-slate-100 outline-none focus:border-sky/60 tabular-nums"
                  />
                </div>
                <div>
                  <span className="md:hidden block text-[10px] uppercase tracking-wider text-slate-500 mb-1">Weekly</span>
                  <input
                    type="number"
                    min={0}
                    value={thresholds[key].weekly}
                    onChange={(e) => updateThreshold(key, 'weekly', Number(e.target.value))}
                    data-testid={`threshold-weekly-${key}`}
                    className="w-full h-10 px-3 rounded-lg bg-ink-800/60 border border-ink-600 text-sm text-slate-100 outline-none focus:border-sky/60 tabular-nums"
                  />
                </div>
                <div className="flex md:justify-end items-center gap-2 col-span-2 md:col-span-1">
                  <span className="md:hidden text-xs text-slate-400">Alerts</span>
                  <ToggleSwitch
                    checked={thresholds[key].alert}
                    onChange={(v) => updateThreshold(key, 'alert', v)}
                    testId={`threshold-alert-${key}`}
                    ariaLabel={`${label} alerts`}
                  />
                </div>
              </div>
            ))}
          </div>
          <div className="flex justify-end pt-4">
            <button
              type="button"
              className="btn-sky h-11"
              onClick={() => toast.success('Thresholds saved')}
              data-testid="save-thresholds-btn"
            >
              <Save className="w-4 h-4" /> Save Thresholds
            </button>
          </div>
        </div>
      </ChartCard>

      {/* Section 2: Data Collection */}
      <ChartCard
        testId="collection-card"
        title="Data Collection Settings"
        subtitle="How often scales report and how long we keep the data."
      >
        <div className="px-2 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-[11px] uppercase tracking-wider text-slate-400 mb-1.5">
              Scale Reading Frequency
            </label>
            <SelectMenu
              value={collection.frequency}
              onChange={(v) => setCollection({ ...collection, frequency: v })}
              options={[
                { value: '5', label: 'Every 5 minutes' },
                { value: '10', label: 'Every 10 minutes' },
                { value: '15', label: 'Every 15 minutes' },
                { value: '30', label: 'Every 30 minutes' },
                { value: '60', label: 'Every 1 hour' },
              ]}
              testId="collection-frequency"
            />
          </div>
          <div>
            <label className="block text-[11px] uppercase tracking-wider text-slate-400 mb-1.5">
              Data Retention Period
            </label>
            <SelectMenu
              value={collection.retention}
              onChange={(v) => setCollection({ ...collection, retention: v })}
              options={[
                { value: '30', label: '30 days' },
                { value: '60', label: '60 days' },
                { value: '90', label: '90 days' },
                { value: '365', label: '1 year' },
                { value: 'forever', label: 'Forever' },
              ]}
              testId="collection-retention"
            />
          </div>

          <div className="sm:col-span-2 flex items-center justify-between gap-4 p-3.5 rounded-xl bg-ink-800/40 border border-ink-600">
            <div>
              <div className="text-sm font-semibold text-white">
                Auto-export weekly CSV
              </div>
              <div className="text-xs text-slate-400 mt-0.5">
                Email a full CSV every Monday at the configured time.
              </div>
            </div>
            <ToggleSwitch
              checked={collection.autoExport}
              onChange={(v) => setCollection({ ...collection, autoExport: v })}
              testId="collection-auto-export"
              ariaLabel="Auto-export weekly CSV"
            />
          </div>

          <div className="sm:col-span-2 sm:max-w-xs">
            <label className="block text-[11px] uppercase tracking-wider text-slate-400 mb-1.5">
              Export Time (local)
            </label>
            <input
              type="time"
              value={collection.exportTime}
              onChange={(e) => setCollection({ ...collection, exportTime: e.target.value })}
              data-testid="collection-export-time"
              className="w-full h-11 px-3 rounded-xl bg-ink-800/60 border border-ink-600 text-sm text-slate-100 outline-none focus:border-sky/60"
            />
          </div>

          <div className="sm:col-span-2 flex justify-end pt-1">
            <button
              type="button"
              className="btn-sky h-11"
              onClick={() => toast.success('Collection settings saved')}
              data-testid="save-collection-btn"
            >
              <Save className="w-4 h-4" /> Save Settings
            </button>
          </div>
        </div>
      </ChartCard>

      {/* Section 3: Alert Configuration */}
      <ChartCard
        testId="alerts-card"
        title="Alert Configuration"
        subtitle="Where should IWM send incident notifications?"
      >
        <div className="px-2 space-y-4">
          {/* Email */}
          <div className="rounded-xl bg-ink-800/40 border border-ink-600 p-4">
            <div className="flex items-center justify-between gap-4 mb-3">
              <div className="flex items-center gap-3">
                <span className="w-9 h-9 rounded-lg grid place-items-center bg-sky/15 text-sky">
                  <Bell className="w-4 h-4" />
                </span>
                <div>
                  <div className="text-sm font-semibold text-white">Email Alerts</div>
                  <div className="text-xs text-slate-400">Send incident emails to a single inbox.</div>
                </div>
              </div>
              <ToggleSwitch
                checked={alerts.email}
                onChange={(v) => setAlerts({ ...alerts, email: v })}
                testId="alerts-email-toggle"
                ariaLabel="Email alerts"
              />
            </div>
            <input
              type="email"
              value={alerts.emailValue}
              onChange={(e) => setAlerts({ ...alerts, emailValue: e.target.value })}
              disabled={!alerts.email}
              placeholder="alerts@yourcompany.ca"
              data-testid="alerts-email-input"
              className="w-full h-11 px-3 rounded-xl bg-ink-800/60 border border-ink-600 text-sm text-slate-100 outline-none focus:border-sky/60 disabled:opacity-50"
            />
          </div>

          {/* SMS */}
          <div className="rounded-xl bg-ink-800/40 border border-ink-600 p-4">
            <div className="flex items-center justify-between gap-4 mb-3">
              <div className="flex items-center gap-3">
                <span className="w-9 h-9 rounded-lg grid place-items-center bg-leaf/15 text-leaf">
                  <Bell className="w-4 h-4" />
                </span>
                <div>
                  <div className="text-sm font-semibold text-white">SMS Alerts</div>
                  <div className="text-xs text-slate-400">Critical events only — additional carrier fees may apply.</div>
                </div>
              </div>
              <ToggleSwitch
                checked={alerts.sms}
                onChange={(v) => setAlerts({ ...alerts, sms: v })}
                testId="alerts-sms-toggle"
                ariaLabel="SMS alerts"
              />
            </div>
            <input
              type="tel"
              value={alerts.smsValue}
              onChange={(e) => setAlerts({ ...alerts, smsValue: e.target.value })}
              disabled={!alerts.sms}
              placeholder="+1 (XXX) XXX-XXXX"
              data-testid="alerts-sms-input"
              className="w-full h-11 px-3 rounded-xl bg-ink-800/60 border border-ink-600 text-sm text-slate-100 outline-none focus:border-sky/60 disabled:opacity-50"
            />
          </div>

          {/* Slack */}
          <div className="rounded-xl bg-ink-800/40 border border-ink-600 p-4">
            <div className="flex items-center justify-between gap-4 mb-3">
              <div className="flex items-center gap-3">
                <span className="w-9 h-9 rounded-lg grid place-items-center bg-amber/15 text-amber">
                  <Bell className="w-4 h-4" />
                </span>
                <div>
                  <div className="text-sm font-semibold text-white">Slack Webhook</div>
                  <div className="text-xs text-slate-400">Post alerts directly into a Slack channel.</div>
                </div>
              </div>
              <ToggleSwitch
                checked={alerts.slack}
                onChange={(v) => setAlerts({ ...alerts, slack: v })}
                testId="alerts-slack-toggle"
                ariaLabel="Slack alerts"
              />
            </div>
            <input
              type="url"
              value={alerts.slackValue}
              onChange={(e) => setAlerts({ ...alerts, slackValue: e.target.value })}
              disabled={!alerts.slack}
              placeholder="https://hooks.slack.com/services/..."
              data-testid="alerts-slack-input"
              className="w-full h-11 px-3 rounded-xl bg-ink-800/60 border border-ink-600 text-sm text-slate-100 font-mono outline-none focus:border-sky/60 disabled:opacity-50"
            />
          </div>

          {/* Severity */}
          <div>
            <label className="block text-[11px] uppercase tracking-wider text-slate-400 mb-2">
              Minimum Alert Severity
            </label>
            <div className="grid grid-cols-3 gap-2 max-w-md">
              {[
                { key: 'low', label: 'Low', color: 'bg-leaf/20 border-leaf/40 text-leaf' },
                { key: 'medium', label: 'Medium', color: 'bg-amber/20 border-amber/40 text-amber' },
                { key: 'high', label: 'High', color: 'bg-red-500/20 border-red-500/40 text-red-400' },
              ].map((sev) => (
                <button
                  key={sev.key}
                  type="button"
                  onClick={() => setAlerts({ ...alerts, severity: sev.key })}
                  data-testid={`alerts-severity-${sev.key}`}
                  className={`h-11 rounded-xl border text-sm font-semibold transition-all ${
                    alerts.severity === sev.key
                      ? `${sev.color} shadow-glow`
                      : 'bg-ink-800/60 border-ink-600 text-slate-300 hover:border-sky/40'
                  }`}
                >
                  {sev.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex justify-end pt-1">
            <button
              type="button"
              className="btn-sky h-11"
              onClick={() => toast.success('Alert configuration saved')}
              data-testid="save-alerts-btn"
            >
              <Save className="w-4 h-4" /> Save Alert Config
            </button>
          </div>
        </div>
      </ChartCard>

      {/* Section 4: Organization */}
      <ChartCard
        testId="org-card"
        title="Organization Settings"
        subtitle="Tenant-wide defaults that apply across all kitchens."
      >
        <div className="px-2 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <label className="block text-[11px] uppercase tracking-wider text-slate-400 mb-1.5">
              Organization Name
            </label>
            <div className="relative">
              <Building2 className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              <input
                type="text"
                value={org.name}
                onChange={(e) => setOrg({ ...org, name: e.target.value })}
                data-testid="data-org-name"
                className="w-full h-11 pl-9 pr-3 rounded-xl bg-ink-800/60 border border-ink-600 text-sm text-slate-100 outline-none focus:border-sky/60"
              />
            </div>
          </div>
          <div>
            <label className="block text-[11px] uppercase tracking-wider text-slate-400 mb-1.5">
              Industry
            </label>
            <SelectMenu
              value={org.industry}
              onChange={(v) => setOrg({ ...org, industry: v })}
              options={[
                'Restaurant', 'Cafeteria', 'Hotel', 'Catering', 'Grocery',
                'Hospital / Healthcare', 'School / University',
              ].map((v) => ({ value: v, label: v }))}
              testId="data-org-industry"
            />
          </div>
          <div>
            <label className="block text-[11px] uppercase tracking-wider text-slate-400 mb-1.5">
              Country
            </label>
            <input
              type="text"
              value="Canada 🍁"
              readOnly
              data-testid="data-org-country"
              className="w-full h-11 px-3 rounded-xl bg-ink-800/40 border border-ink-600 text-sm text-slate-200 outline-none cursor-not-allowed"
            />
          </div>
          <div>
            <label className="block text-[11px] uppercase tracking-wider text-slate-400 mb-1.5">
              Timezone
            </label>
            <SelectMenu
              value={org.timezone}
              onChange={(v) => setOrg({ ...org, timezone: v })}
              options={[
                { value: 'America/Toronto', label: 'America/Toronto (ET)' },
                { value: 'America/Montreal', label: 'America/Montreal (ET)' },
                { value: 'America/Edmonton', label: 'America/Edmonton (MT)' },
                { value: 'America/Vancouver', label: 'America/Vancouver (PT)' },
                { value: 'America/Halifax', label: 'America/Halifax (AT)' },
              ]}
              testId="data-org-timezone"
            />
          </div>
          <div>
            <label className="block text-[11px] uppercase tracking-wider text-slate-400 mb-1.5">
              Currency
            </label>
            <input
              type="text"
              value="CAD ($)"
              readOnly
              data-testid="data-org-currency"
              className="w-full h-11 px-3 rounded-xl bg-ink-800/40 border border-ink-600 text-sm text-slate-200 outline-none cursor-not-allowed"
            />
          </div>

          <div className="sm:col-span-2 flex justify-end pt-1">
            <button
              type="button"
              className="btn-sky h-11"
              onClick={() => toast.success('Organization settings saved')}
              data-testid="save-org-btn"
            >
              <Save className="w-4 h-4" /> Save Organization
            </button>
          </div>
        </div>
      </ChartCard>
    </div>
  );
}
