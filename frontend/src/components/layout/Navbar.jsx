import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Menu, ChevronDown, User, LogOut, Settings } from 'lucide-react';
import { getCurrentUser, logout } from '../../services/auth';
import { toast } from 'sonner';
import UserAvatar from '../common/UserAvatar.jsx';

export default function Navbar({ title, onMenuClick }) {
  const navigate = useNavigate();
  const user = getCurrentUser();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    };
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, []);

  const handleLogout = async () => {
    // Awaited so the token is gone from the Keychain / Keystore before the app
    // leaves the screen. `clearSession` drops the in-memory copy first, so
    // every synchronous `isAuthenticated()` on the way out already reads
    // false — the await is only about the durable copy.
    await logout();
    toast.success('Logged out successfully');
    // Home, not the sign-in form. Signing out is a decision to stop using the
    // app, and dropping straight onto a login box reads as "you got signed
    // out, sign back in" rather than "you left". The landing page also gives
    // somewhere to go that isn't typing a password again.
    navigate('/', { replace: true });
  };

  return (
    <header
      data-testid="top-navbar"
      // The notch/status bar inset is added as padding rather than baked into
      // the height, so the bar grows to clear it and the 64px of actual
      // content keeps its proportions. A fixed h-16 on a device with a notch
      // puts the page title under the clock.
      className="sticky top-0 z-20 glass-strong border-b border-ink-600/50"
      style={{ paddingTop: 'var(--safe-top)' }}
    >
      <div className="h-16 flex items-center gap-3 px-4 sm:px-6 lg:px-8">
        <button
          type="button"
          aria-label="Open menu"
          data-testid="hamburger-btn"
          onClick={onMenuClick}
          className="md:hidden grid place-items-center w-11 h-11 rounded-lg text-slate-300 hover:bg-ink-700/60"
        >
          <Menu className="w-5 h-5" />
        </button>

        <h1
          className="font-display font-semibold text-lg sm:text-xl text-white truncate"
          data-testid="page-title"
        >
          {title}
        </h1>

        <div className="flex-1" />

        {/* User menu */}
        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            data-testid="user-menu-btn"
            className="flex items-center gap-2 h-11 pl-1 pr-2 sm:pr-3 rounded-xl hover:bg-ink-700/60 transition-all"
          >
            <UserAvatar user={user} />
            <div className="hidden sm:block text-left leading-tight">
              <div className="text-sm font-semibold text-white">
                {user?.name?.split(' ')[0]}
              </div>
              <div className="text-[10px] uppercase tracking-wider text-slate-400">
                {user?.role}
              </div>
            </div>
            <ChevronDown className="w-4 h-4 text-slate-400 hidden sm:block" />
          </button>

          {menuOpen && (
            <div
              data-testid="user-dropdown"
              className="absolute right-0 mt-2 w-56 rounded-xl glass-strong border border-ink-600 shadow-2xl py-1.5 overflow-hidden"
            >
              <button
                type="button"
                className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-slate-200 hover:bg-ink-700/60 transition-colors"
                onClick={() => {
                  setMenuOpen(false);
                  navigate('/settings');
                }}
              >
                <User className="w-4 h-4" /> Profile
              </button>
              <button
                type="button"
                className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-slate-200 hover:bg-ink-700/60 transition-colors"
                onClick={() => {
                  setMenuOpen(false);
                  navigate('/settings');
                }}
              >
                <Settings className="w-4 h-4" /> Settings
              </button>
              <div className="h-px bg-ink-600/50 my-1" />
              <button
                type="button"
                data-testid="user-logout-btn"
                onClick={handleLogout}
                className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-red-400 hover:bg-red-500/15 transition-colors"
              >
                <LogOut className="w-4 h-4" /> Logout
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
