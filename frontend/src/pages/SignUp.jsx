import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Eye, EyeOff, ArrowRight, ArrowLeft, Apple, CookingPot, Carrot, Salad, Cookie, IceCream, Leaf,
} from 'lucide-react';
import { toast } from 'sonner';
import { signup, isAuthenticated } from '../services/auth';
import { CANADIAN_LOCATIONS } from '../data/mockData';
import LoadingSpinner from '../components/common/LoadingSpinner.jsx';
import SelectMenu from '../components/common/SelectMenu.jsx';

const FLOAT_ICONS = [
  { Icon: Apple, top: '12%', left: '8%', delay: 0, size: 28 },
  { Icon: Carrot, top: '28%', left: '85%', delay: 1.2, size: 30 },
  { Icon: Salad, top: '70%', left: '12%', delay: 2.4, size: 32 },
  { Icon: Cookie, top: '80%', left: '78%', delay: 0.8, size: 26 },
  { Icon: IceCream, top: '50%', left: '92%', delay: 3, size: 26 },
  { Icon: CookingPot, top: '85%', left: '45%', delay: 2, size: 30 },
  { Icon: Leaf, top: '20%', left: '50%', delay: 1.6, size: 24 },
];

const SECRET_QUESTIONS = [
  'What is your favorite food?',
  'What is your favorite movie?',
  'What was your childhood nickname?',
  'What city were you born in?',
  'What is your favorite color?',
];

export default function SignUp() {
  const navigate = useNavigate();

  const [name, setName] = useState('');
  const [organization, setOrganization] = useState('');
  const [city, setCity] = useState(CANADIAN_LOCATIONS[0].city);
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [secretQuestion, setSecretQuestion] = useState(SECRET_QUESTIONS[0]);
  const [secretAnswer, setSecretAnswer] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isAuthenticated()) navigate('/dashboard', { replace: true });
  }, [navigate]);

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (password.length < 8) {
      toast.error('Password must be at least 8 characters');
      return;
    }
    if (password !== confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }
    if (!secretAnswer.trim()) {
      toast.error('Please answer your secret question');
      return;
    }

    setLoading(true);
    try {
      const { user } = await signup({
        name,
        organization,
        city,
        phone,
        email,
        password,
        secretQuestion,
        secretAnswer: secretAnswer.trim(),
      });
      toast.success(`Welcome to IWM, ${user.name.split(' ')[0]}! 🍁`);
      navigate('/dashboard', { replace: true });
    } catch (err) {
      toast.error(err?.response?.data?.message || err.message || 'Could not create account');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="ww-mesh min-h-screen relative overflow-hidden flex items-center justify-center px-4 py-10">
      <div className="absolute inset-0 pointer-events-none">
        {FLOAT_ICONS.map(({ Icon, top, left, delay, size }, i) => (
          <span
            key={i}
            className="absolute text-sky/15 animate-float"
            style={{ top, left, animationDelay: `${delay}s`, animationDuration: `${8 + (i % 3) * 2}s` }}
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
        className="relative z-10 w-full max-w-lg"
      >
        <div className="glass-strong rounded-3xl border border-ink-600/70 shadow-[0_30px_80px_-30px_rgba(56,189,248,0.35)] p-8 sm:p-10">
          <div className="flex flex-col items-center text-center mb-7">
            <div className="relative grid place-items-center w-16 h-16 rounded-2xl bg-leaf-gradient shadow-[0_10px_28px_-6px_rgba(34,197,94,0.55)] mb-4">
              <span className="font-display font-extrabold text-xl text-ink-900 tracking-tighter" aria-hidden>
                IWM
              </span>
            </div>
            <h1 className="font-display font-bold text-2xl sm:text-3xl text-white tracking-tight leading-tight">
              Create your account
            </h1>
            <p className="text-sm text-slate-400 mt-1.5">
              Set up client access to your kitchen's waste data{' '}
              <span aria-label="Canadian flag">🍁</span>
            </p>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="name" className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
                  Full Name
                </label>
                <input
                  id="name"
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Avery Chen"
                  data-testid="signup-name-input"
                  className="w-full h-12 px-4 rounded-xl bg-ink-800/60 border border-ink-600 text-slate-100 placeholder:text-slate-500 outline-none focus:border-sky/60 focus:shadow-glow transition-all"
                />
              </div>
              <div>
                <label htmlFor="organization" className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
                  Organization
                </label>
                <input
                  id="organization"
                  type="text"
                  required
                  value={organization}
                  onChange={(e) => setOrganization(e.target.value)}
                  placeholder="Maple Grove Bistro"
                  data-testid="signup-org-input"
                  className="w-full h-12 px-4 rounded-xl bg-ink-800/60 border border-ink-600 text-slate-100 placeholder:text-slate-500 outline-none focus:border-sky/60 focus:shadow-glow transition-all"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="city" className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
                  City
                </label>
                <SelectMenu
                  value={city}
                  onChange={setCity}
                  options={CANADIAN_LOCATIONS.map((l) => ({
                    value: l.city,
                    label: `${l.city}, ${l.province}`,
                  }))}
                  testId="signup-city-select"
                />
              </div>
              <div>
                <label htmlFor="phone" className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
                  Phone <span className="normal-case text-slate-500">(optional)</span>
                </label>
                <input
                  id="phone"
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+1 (416) 555-0142"
                  data-testid="signup-phone-input"
                  className="w-full h-12 px-4 rounded-xl bg-ink-800/60 border border-ink-600 text-slate-100 placeholder:text-slate-500 outline-none focus:border-sky/60 focus:shadow-glow transition-all"
                />
              </div>
            </div>

            <div>
              <label htmlFor="email" className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
                Email
              </label>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@restaurant.ca"
                data-testid="signup-email-input"
                className="w-full h-12 px-4 rounded-xl bg-ink-800/60 border border-ink-600 text-slate-100 placeholder:text-slate-500 outline-none focus:border-sky/60 focus:shadow-glow transition-all"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="password" className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
                  Password
                </label>
                <div className="relative">
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    required
                    minLength={8}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="At least 8 characters"
                    data-testid="signup-password-input"
                    className="w-full h-12 px-4 pr-12 rounded-xl bg-ink-800/60 border border-ink-600 text-slate-100 placeholder:text-slate-500 outline-none focus:border-sky/60 focus:shadow-glow transition-all"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className="absolute right-1.5 top-1.5 grid place-items-center w-9 h-9 rounded-lg text-slate-400 hover:text-white hover:bg-ink-700/60"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <div>
                <label htmlFor="confirm" className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
                  Confirm Password
                </label>
                <div className="relative">
                  <input
                    id="confirm"
                    type={showConfirm ? 'text' : 'password'}
                    required
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Re-enter password"
                    data-testid="signup-confirm-input"
                    className="w-full h-12 px-4 pr-12 rounded-xl bg-ink-800/60 border border-ink-600 text-slate-100 placeholder:text-slate-500 outline-none focus:border-sky/60 focus:shadow-glow transition-all"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirm((v) => !v)}
                    aria-label={showConfirm ? 'Hide password' : 'Show password'}
                    className="absolute right-1.5 top-1.5 grid place-items-center w-9 h-9 rounded-lg text-slate-400 hover:text-white hover:bg-ink-700/60"
                  >
                    {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-ink-600 bg-ink-800/40 p-4">
              <div className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">
                Secret Code — used to verify it's really you
              </div>
              <div className="flex flex-col gap-3">
                <div>
                  <label htmlFor="secretQuestion" className="block text-[11px] uppercase tracking-wider text-slate-500 mb-1.5">
                    Security Question
                  </label>
                  <SelectMenu
                    value={secretQuestion}
                    onChange={setSecretQuestion}
                    options={SECRET_QUESTIONS.map((q) => ({ value: q, label: q }))}
                    testId="signup-secret-question"
                  />
                </div>
                <div>
                  <label htmlFor="secretAnswer" className="block text-[11px] uppercase tracking-wider text-slate-500 mb-1.5">
                    Your Answer
                  </label>
                  <input
                    id="secretAnswer"
                    type="text"
                    required
                    value={secretAnswer}
                    onChange={(e) => setSecretAnswer(e.target.value)}
                    placeholder="e.g. Poutine"
                    data-testid="signup-secret-answer"
                    className="w-full h-11 px-3 rounded-xl bg-ink-800/60 border border-ink-600 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:border-sky/60"
                  />
                </div>
                <p className="text-[11px] text-slate-500">
                  You'll enter this alongside your password every time you sign in — keep it memorable but not guessable.
                </p>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              data-testid="signup-submit-btn"
              className="btn-sky h-12 mt-2 w-full"
            >
              {loading ? (
                <>
                  <LoadingSpinner size={20} />
                  <span>Creating account...</span>
                </>
              ) : (
                <>
                  Create Account <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>

          <div className="mt-6 pt-5 border-t border-ink-600/70 text-center">
            <button
              type="button"
              onClick={() => navigate('/login')}
              data-testid="signup-back-to-login"
              className="inline-flex items-center gap-1.5 text-sm text-sky hover:text-sky/80 font-medium"
            >
              <ArrowLeft className="w-4 h-4" /> Already have an account? Sign in
            </button>
          </div>
        </div>

        <p className="text-center text-xs text-slate-500 mt-6">
          Admin accounts are provisioned separately and can't be self-registered.
        </p>
      </motion.div>
    </div>
  );
}
