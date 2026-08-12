import { NavLink, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard,
  BarChart3,
  FileText,
  Settings as SettingsIcon,
  Users,
  Scale,
  Database,
  Terminal,
  LogOut,
  Globe,
  X,
} from 'lucide-react';
import { getCurrentUser, logout } from '../../services/auth';
import { toast } from 'sonner';
import UserAvatar from '../common/UserAvatar.jsx';
import SelectMenu from '../common/SelectMenu.jsx';
import { COMMON_TIME_ZONES, timeZoneAbbr } from '../../lib/time.js';
import {
  useTimeZonePreference, ZONE_AUTO, ZONE_PER_SCALE,
} from '../../lib/timeZonePreference.jsx';

const CLIENT_LINKS = [
  { to: '/dashboard', label: 'Dashboard', Icon: LayoutDashboard },
  { to: '/analytics', label: 'Analytics', Icon: BarChart3 },
  { to: '/reports', label: 'Reports', Icon: FileText },
  { to: '/settings', label: 'Settings', Icon: SettingsIcon },
];

const ADMIN_LINKS = [
  { to: '/users', label: 'User Management', Icon: Users },
  { to: '/scales', label: 'Scale Management', Icon: Scale },
  { to: '/data-config', label: 'Data Configuration', Icon: Database },
  { to: '/system-logs', label: 'System Logs', Icon: Terminal },
];

function Logo({ collapsed = false }) {
  return (
    <div className="flex items-center gap-2.5 px-1" data-testid="ww-logo">
      <div className="relative grid place-items-center w-9 h-9 rounded-xl bg-leaf-gradient shadow-[0_6px_20px_-4px_rgba(34,197,94,0.5)] shrink-0">
        <span className="font-display font-extrabold text-[11px] text-ink-900 tracking-tighter" aria-hidden>
          IWM
        </span>
      </div>
      {!collapsed && (
        <div className="leading-tight min-w-0">
          <div className="font-display font-bold text-lg text-white tracking-tight">
            IWM
          </div>
          <div className="text-[9px] uppercase tracking-[0.14em] text-sky truncate">
            Innovative Waste Mgmt
          </div>
        </div>
      )}
    </div>
  );
}

function NavSection({ title, links, onNavigate }) {
  const handleClick = () => {
    onNavigate?.();
  };

  return (
    <div className="px-3 mt-6 first:mt-2">
      <div className="px-3 mb-2 text-[10px] font-semibold tracking-[0.22em] uppercase text-slate-500 lg:block hidden">
        {title}
      </div>
      <ul className="flex flex-col gap-1">
        {links.map((link) => {
          const { Icon } = link;
          return (
            <li key={link.label}>
              <NavLink
                to={link.to}
                end={false}
                onClick={handleClick}
                data-testid={`nav-${link.label.toLowerCase().replace(/\s+/g, '-')}`}
                className={({ isActive }) =>
                  [
                    'group flex items-center gap-3 rounded-lg px-3 py-2.5',
                    'min-h-[44px] text-sm font-medium transition-all',
                    'text-slate-400 hover:text-white hover:bg-ink-700/50',
                    isActive ? 'nav-active' : '',
                  ].join(' ')
                }
              >
                <Icon className="w-[18px] h-[18px] shrink-0" />
                <span className="lg:inline hidden">{link.label}</span>
              </NavLink>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Display-zone picker.
 *
 * Readings are stored as the device's own wall clock, so this decides what the
 * viewer reads them as: their own zone, each scale's, or one fixed zone. It
 * changes presentation only — no reading is rewritten and no total moves.
 */
function TimeZonePicker() {
  const { preference, setPreference, deviceZone } = useTimeZonePreference();

  const options = [
    { value: ZONE_AUTO, label: `My time (${timeZoneAbbr(deviceZone)})` },
    { value: ZONE_PER_SCALE, label: "Each scale's own time" },
    ...COMMON_TIME_ZONES.map((z) => ({ value: z.value, label: z.label })),
  ];

  return (
    <div className="px-3 pb-2 mt-auto lg:block hidden">
      <div className="px-3 mb-1.5 text-[10px] font-semibold tracking-[0.22em] uppercase text-slate-500">
        Display time in
      </div>
      <SelectMenu
        value={preference}
        onChange={setPreference}
        options={options}
        icon={Globe}
        testId="sidebar-timezone"
      />
    </div>
  );
}

function UserFooter({ user, onLogout }) {
  return (
    <div className="px-3 pb-4 mt-auto">
      <div className="flex items-center gap-3 rounded-xl glass p-3">
        <UserAvatar user={user} />
        <div className="min-w-0 flex-1 lg:block hidden">
          <div className="text-sm font-semibold text-white truncate">
            {user.name}
          </div>
          <div className="flex items-center gap-1.5">
            <span
              className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${
                user.role === 'admin'
                  ? 'bg-sky/20 text-sky'
                  : 'bg-leaf/20 text-leaf'
              }`}
            >
              {user.role}
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={onLogout}
          aria-label="Logout"
          data-testid="sidebar-logout-btn"
          className="grid place-items-center w-9 h-9 rounded-lg text-slate-400 hover:text-white hover:bg-red-500/20 transition-all"
        >
          <LogOut className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

function SidebarContent({ user, onLogout, onNavigate }) {
  return (
    <div className="flex h-full flex-col">
      <div className="px-5 pt-5 pb-4 border-b border-ink-600/50">
        <Logo />
      </div>

      <nav className="flex-1 overflow-y-auto pt-1 pb-4">
        <NavSection title="Client" links={CLIENT_LINKS} onNavigate={onNavigate} />
        {user.role === 'admin' && (
          <NavSection title="Admin" links={ADMIN_LINKS} onNavigate={onNavigate} />
        )}
      </nav>

      <TimeZonePicker />
      <UserFooter user={user} onLogout={onLogout} />
    </div>
  );
}

export default function Sidebar({ mobileOpen, onClose }) {
  const navigate = useNavigate();
  const user = getCurrentUser() || {
    name: 'Guest',
    role: 'client',
  };

  const handleLogout = () => {
    logout();
    toast.success('Logged out successfully');
    navigate('/login', { replace: true });
  };

  return (
    <>
      {/* Desktop / tablet sidebar */}
      <aside
        data-testid="sidebar-desktop"
        className="hidden md:flex flex-col fixed top-0 left-0 h-screen z-30 glass-strong border-r border-ink-600/50
                   lg:w-[240px] md:w-[80px] w-0"
      >
        <SidebarContent user={user} onLogout={handleLogout} />
      </aside>

      {/* Mobile drawer */}
      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={onClose}
              className="fixed inset-0 z-40 bg-ink-950/70 backdrop-blur-sm md:hidden"
            />
            <motion.aside
              initial={{ x: -260 }}
              animate={{ x: 0 }}
              exit={{ x: -260 }}
              transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
              className="fixed top-0 left-0 z-50 h-screen w-[260px] glass-strong border-r border-ink-600/50 md:hidden"
              data-testid="sidebar-mobile"
            >
              <button
                type="button"
                aria-label="Close menu"
                onClick={onClose}
                className="absolute top-3 right-3 grid place-items-center w-10 h-10 rounded-lg text-slate-300 hover:bg-ink-700/60"
                data-testid="sidebar-close-btn"
              >
                <X className="w-5 h-5" />
              </button>
              <div className="lg:!block">
                <SidebarContent
                  user={user}
                  onLogout={() => {
                    handleLogout();
                    onClose?.();
                  }}
                  onNavigate={onClose}
                />
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
