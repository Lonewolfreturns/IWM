import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Eye, EyeOff, ArrowRight, Apple, CookingPot, Carrot, Salad, Cookie, IceCream, Leaf } from 'lucide-react';
import { toast } from 'sonner';
import { login, isAuthenticated } from '../services/auth';
import LoadingSpinner from '../components/common/LoadingSpinner.jsx';

const FLOAT_ICONS = [
  { Icon: Apple, top: '12%', left: '8%', delay: 0, size: 28 },
  { Icon: Carrot, top: '28%', left: '85%', delay: 1.2, size: 30 },
  { Icon: Salad, top: '70%', left: '12%', delay: 2.4, size: 32 },
  { Icon: Cookie, top: '80%', left: '78%', delay: 0.8, size: 26 },
  { Icon: IceCream, top: '50%', left: '92%', delay: 3, size: 26 },
  { Icon: CookingPot, top: '85%', left: '45%', delay: 2, size: 30 },
  { Icon: Leaf, top: '20%', left: '50%', delay: 1.6, size: 24 },
];

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [secretAnswer, setSecretAnswer] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isAuthenticated()) {
      navigate('/dashboard', { replace: true });
    }
  }, [navigate]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      // No role is sent: the account's role comes from the database, so the
      // dashboard adapts to whoever signs in.
      const { user } = await login({ email, password, secretAnswer });
      toast.success(`Welcome back, ${user.name.split(' ')[0]}! 🍁`);
      const dest = location.state?.from?.pathname || '/dashboard';
      navigate(dest, { replace: true });
    } catch (err) {
      toast.error(err?.response?.data?.message || err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="ww-mesh min-h-screen relative overflow-hidden flex items-center justify-center px-4 py-10">
      {/* Floating food particle icons */}
      <div className="absolute inset-0 pointer-events-none">
        {FLOAT_ICONS.map(({ Icon, top, left, delay, size }, i) => (
          <span
            key={i}
            className="absolute text-sky/15 animate-float"
            style={{
              top,
              left,
              animationDelay: `${delay}s`,
              animationDuration: `${8 + (i % 3) * 2}s`,
            }}
            aria-hidden
          >
            <Icon style={{ width: size, height: size }} />
          </span>
        ))}
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
        className="relative z-10 w-full max-w-md"
      >
        <div className="glass-strong rounded-3xl border border-ink-600/70 shadow-[0_30px_80px_-30px_rgba(56,189,248,0.35)] p-8 sm:p-10">
          {/* Logo */}
          <div className="flex flex-col items-center text-center mb-7">
            <div className="relative grid place-items-center w-16 h-16 rounded-2xl bg-leaf-gradient shadow-[0_10px_28px_-6px_rgba(34,197,94,0.55)] mb-4">
              <span className="font-display font-extrabold text-xl text-ink-900 tracking-tighter" aria-hidden>
                IWM
              </span>
            </div>
            <h1 className="font-display font-bold text-2xl sm:text-3xl text-white tracking-tight leading-tight">
              Innovative Waste Management
            </h1>
            <div className="text-[11px] font-semibold uppercase tracking-[0.3em] text-sky mt-1">
              IWM
            </div>
            <p className="text-sm text-slate-400 mt-1.5">
              Reducing Food Waste Across Canada{' '}
              <span aria-label="Canadian flag">🍁</span>
            </p>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div>
              <label
                htmlFor="email"
                className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2"
              >
                Email
              </label>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@restaurant.ca"
                data-testid="login-email-input"
                className="w-full h-12 px-4 rounded-xl bg-ink-800/60 border border-ink-600 text-slate-100 placeholder:text-slate-500 outline-none focus:border-sky/60 focus:shadow-glow transition-all"
              />
            </div>

            <div>
              <label
                htmlFor="password"
                className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2"
              >
                Password
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  data-testid="login-password-input"
                  className="w-full h-12 px-4 pr-12 rounded-xl bg-ink-800/60 border border-ink-600 text-slate-100 placeholder:text-slate-500 outline-none focus:border-sky/60 focus:shadow-glow transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  data-testid="toggle-password-btn"
                  className="absolute right-1.5 top-1.5 grid place-items-center w-9 h-9 rounded-lg text-slate-400 hover:text-white hover:bg-ink-700/60"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div>
              <label
                htmlFor="secretAnswer"
                className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2"
              >
                Secret Code
              </label>
              <input
                id="secretAnswer"
                type="text"
                required
                value={secretAnswer}
                onChange={(e) => setSecretAnswer(e.target.value)}
                placeholder="Answer to your security question"
                data-testid="login-secret-input"
                className="w-full h-12 px-4 rounded-xl bg-ink-800/60 border border-ink-600 text-slate-100 placeholder:text-slate-500 outline-none focus:border-sky/60 focus:shadow-glow transition-all"
              />
            </div>

            <label className="inline-flex items-center gap-2.5 cursor-pointer select-none text-sm text-slate-300">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
                className="appearance-none w-[18px] h-[18px] rounded-md border border-ink-600 bg-ink-800/80 checked:bg-sky checked:border-sky transition-all cursor-pointer relative
                           checked:after:content-['✓'] checked:after:absolute checked:after:inset-0 checked:after:grid checked:after:place-items-center checked:after:text-ink-900 checked:after:text-xs checked:after:font-bold"
                data-testid="remember-me-checkbox"
              />
              Remember me
            </label>

            <button
              type="submit"
              disabled={loading}
              data-testid="login-submit-btn"
              className="btn-sky h-12 mt-2 w-full"
            >
              {loading ? (
                <>
                  <LoadingSpinner size={20} />
                  <span>Signing in...</span>
                </>
              ) : (
                <>
                  Sign In <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>

          <div className="mt-6 pt-5 border-t border-ink-600/70 text-center">
            <span className="text-sm text-slate-400">Don't have an account? </span>
            <button
              type="button"
              onClick={() => navigate('/signup')}
              data-testid="go-to-signup-link"
              className="text-sm text-sky hover:text-sky/80 font-semibold"
            >
              Create one
            </button>
          </div>
        </div>

        <p className="text-center text-xs text-slate-500 mt-6">
          © {new Date().getFullYear()} IWM · Made with{' '}
          <span aria-hidden>🍁</span> for a more sustainable kitchen.
        </p>
      </motion.div>
    </div>
  );
}
