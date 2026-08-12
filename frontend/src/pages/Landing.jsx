import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, useInView } from 'framer-motion';
import {
  ArrowRight, Scale as ScaleIcon, BarChart3, FileText, Leaf,
  Apple, Carrot, Salad, Cookie, IceCream, CookingPot, ExternalLink,
  Clock, Building2, Download, ShieldCheck, Activity, FlaskConical, ChefHat,
} from 'lucide-react';
import { isAuthenticated } from '../services/auth';
import ImpactCycle from '../components/common/ImpactCycle.jsx';

/* ------------------------------------------------------------------ */
/* Decorative background                                               */
/* ------------------------------------------------------------------ */

const FLOAT_ICONS = [
  { Icon: Apple, top: '16%', left: '5%', delay: 0, size: 26 },
  { Icon: Carrot, top: '30%', left: '91%', delay: 1.2, size: 28 },
  { Icon: Salad, top: '68%', left: '7%', delay: 2.4, size: 30 },
  { Icon: Cookie, top: '80%', left: '86%', delay: 0.8, size: 24 },
  { Icon: IceCream, top: '50%', left: '95%', delay: 3, size: 22 },
  { Icon: CookingPot, top: '88%', left: '38%', delay: 2, size: 26 },
  { Icon: Leaf, top: '10%', left: '58%', delay: 1.6, size: 22 },
];

function Backdrop() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden>
      {/* Drifting colour orbs */}
      <div
        className="orb animate-drift"
        style={{ width: 620, height: 620, top: '-14%', left: '-10%', background: '#38BDF8' }}
      />
      <div
        className="orb animate-drift-slow"
        style={{ width: 540, height: 540, top: '8%', right: '-12%', background: '#22C55E', opacity: 0.35 }}
      />
      <div
        className="orb animate-drift"
        style={{
          width: 500, height: 500, bottom: '-16%', left: '30%',
          background: '#6366F1', opacity: 0.3, animationDelay: '6s',
        }}
      />

      <div className="grid-overlay" />

      {/* Slowly rotating conic ring, far behind the hero visual */}
      <div
        className="absolute animate-spin-slow rounded-full opacity-[0.07]"
        style={{
          width: 900, height: 900, top: '-22%', right: '-18%',
          background: 'conic-gradient(from 0deg, transparent, #38BDF8, transparent 55%, #22C55E, transparent)',
        }}
      />

      {/* Floating food glyphs, carried over from the login screen */}
      {FLOAT_ICONS.map(({ Icon, top, left, delay, size }, i) => (
        <span
          key={i}
          className="absolute text-sky/10 animate-float"
          style={{ top, left, animationDelay: `${delay}s`, animationDuration: `${9 + (i % 3) * 2}s` }}
        >
          <Icon style={{ width: size, height: size }} />
        </span>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Hero visual                                                         */
/* ------------------------------------------------------------------ */

function HeroVisual() {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.92 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.9, delay: 0.15, ease: [0.22, 1, 0.36, 1] }}
      className="relative"
    >
      <ImpactCycle />
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/* Count-up statistic                                                  */
/* ------------------------------------------------------------------ */

// Counts up to `target` once the element scrolls into view.
//
// These are published statistics, so the number on screen must never be wrong.
// requestAnimationFrame doesn't run in a backgrounded tab, which would strand
// the display at "0%" — a false claim, not just a missed animation. Two guards
// prevent that: reduced-motion users skip straight to the value, and a timeout
// snaps everyone else to it if the frame loop never completes.
function useCountUp(target, decimals, active, duration = 1600) {
  const prefersReducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  const [value, setValue] = useState(prefersReducedMotion ? target : 0);

  // Failsafe, deliberately NOT gated on `active`. Both the scroll trigger
  // (IntersectionObserver) and the animation (rAF) are paused in a background
  // tab, so gating this on either would let the stat sit at 0 indefinitely.
  // Whatever else happens, the correct figure is on screen shortly after mount.
  useEffect(() => {
    const failsafe = setTimeout(() => setValue(target), duration + 1400);
    return () => clearTimeout(failsafe);
  }, [target, duration]);

  useEffect(() => {
    if (!active || prefersReducedMotion) {
      if (prefersReducedMotion) setValue(target);
      return undefined;
    }

    let raf;
    const start = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(target * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, active, duration, prefersReducedMotion]);

  return value.toFixed(decimals);
}

function Stat({ prefix = '', target, decimals = 0, suffix = '', label, delay }) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: '-80px' });
  const shown = useCountUp(target, decimals, inView);

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 16 }}
      animate={inView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.55, delay, ease: [0.22, 1, 0.36, 1] }}
      className="relative text-center px-4"
    >
      <div className="font-display font-extrabold text-4xl sm:text-5xl lg:text-6xl text-gradient tabular-nums">
        {prefix}{shown}{suffix}
      </div>
      <p className="text-sm text-slate-400 mt-3 max-w-[17rem] mx-auto leading-relaxed">
        {label}
      </p>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/* Sections                                                            */
/* ------------------------------------------------------------------ */

const STEPS = [
  {
    Icon: ScaleIcon,
    title: 'Weigh',
    body: 'Connected scales record every deposit the moment it lands — no clipboards, no end-of-shift guesswork.',
    tint: 'text-leaf',
    bg: 'bg-leaf/15',
  },
  {
    Icon: BarChart3,
    title: 'Understand',
    body: 'Readings are grouped by kitchen and service period, so you can see exactly when and where waste builds up.',
    tint: 'text-sky',
    bg: 'bg-sky/15',
  },
  {
    Icon: FileText,
    title: 'Act',
    body: 'Export the evidence as PDF or CSV to back up diversion targets, audits and published research.',
    tint: 'text-amber',
    bg: 'bg-amber/15',
  },
];

// Only capabilities the platform actually has today — nothing aspirational.
const CAPABILITIES = [
  {
    Icon: Activity,
    title: 'Deposit-level capture',
    body: 'Every individual deposit is recorded with its own timestamp, not just a daily total.',
  },
  {
    Icon: Clock,
    title: 'Service-period breakdown',
    body: 'Set breakfast, lunch, dinner, snack and night windows per scale and see waste attributed to each.',
  },
  {
    Icon: Building2,
    title: 'Multi-site by design',
    body: 'Run many kitchens under one organization, each with its own scales and schedules.',
  },
  {
    Icon: Download,
    title: 'PDF & CSV export',
    body: 'Take the underlying readings or a formatted summary out of the platform whenever you need them.',
  },
  {
    Icon: ShieldCheck,
    title: 'Secure by default',
    body: 'Credentials are hashed, never stored in readable form, and every request is authorised per role.',
  },
  {
    Icon: BarChart3,
    title: 'Trends over time',
    body: 'Compare scales and periods to see whether an intervention actually moved the number.',
  },
];

const AUDIENCES = [
  {
    Icon: ChefHat,
    tag: 'For kitchens',
    title: 'See where the waste really goes',
    points: [
      'Which station and which service period is costing you most',
      'Whether last month’s change actually helped',
      'Evidence for diversion targets and audits',
    ],
    tint: 'text-leaf',
    bg: 'bg-leaf/15',
    border: 'hover:border-leaf/40',
  },
  {
    Icon: FlaskConical,
    tag: 'For researchers',
    title: 'Consistent data across every site',
    points: [
      'One measurement method applied identically everywhere',
      'Raw, unaggregated readings available for export',
      'Compare organizations and sites on equal footing',
    ],
    tint: 'text-sky',
    bg: 'bg-sky/15',
    border: 'hover:border-sky/40',
  },
];

function Section({ children, className = '' }) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 26 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      className={className}
    >
      {children}
    </motion.section>
  );
}

/* ------------------------------------------------------------------ */

export default function Landing() {
  const navigate = useNavigate();
  const authed = isAuthenticated();
  const go = () => navigate(authed ? '/dashboard' : '/login');

  return (
    <div className="ww-mesh min-h-screen relative overflow-hidden" data-testid="landing-page">
      <Backdrop />

      {/* Header */}
      <header className="relative z-10 flex items-center justify-between px-5 sm:px-8 lg:px-14 py-5">
        <div className="flex items-center gap-2.5">
          <div className="grid place-items-center w-9 h-9 rounded-xl bg-leaf-gradient shadow-[0_6px_20px_-4px_rgba(34,197,94,0.5)] shrink-0">
            <span className="font-display font-extrabold text-[11px] text-ink-900 tracking-tighter">IWM</span>
          </div>
          <span className="font-display font-bold text-lg text-white tracking-tight">IWM</span>
        </div>
        <button
          type="button"
          onClick={go}
          data-testid="landing-nav-signin"
          className="text-sm font-semibold text-slate-300 hover:text-white transition-colors"
        >
          {authed ? 'Go to dashboard' : 'Sign in'}
        </button>
      </header>

      <main className="relative z-10 px-5 sm:px-8 lg:px-14">
        {/* ---------------- Hero ---------------- */}
        <section className="max-w-6xl mx-auto grid lg:grid-cols-2 gap-14 lg:gap-10 items-center pt-10 sm:pt-16 pb-24">
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
            className="text-center lg:text-left"
          >
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-sky/25 bg-sky/10 text-[11px] font-semibold uppercase tracking-[0.18em] text-sky mb-7">
              <span className="w-1.5 h-1.5 rounded-full bg-sky animate-pulse" />
              Food waste analytics
            </div>

            <h1 className="font-display font-extrabold text-[2.6rem] leading-[1.05] sm:text-6xl lg:text-[4.2rem] text-white tracking-tight">
              Welcome to{' '}
              <span className="text-gradient animate-shimmer" style={{ backgroundSize: '200% auto' }}>
                IWM
              </span>
            </h1>
            <p className="font-display font-semibold text-lg sm:text-xl text-slate-300 mt-4">
              Innovative Waste Management
            </p>

            <p className="text-base sm:text-lg text-slate-400 mt-6 max-w-xl mx-auto lg:mx-0 leading-relaxed">
              You can't reduce what you don't measure. IWM turns connected kitchen
              scales into a clear picture of what's being thrown away — when, where
              and how much — so kitchens and researchers can act on evidence
              instead of estimates.
            </p>

            <div className="flex flex-col sm:flex-row items-center lg:items-start justify-center lg:justify-start gap-3 mt-9">
              <button
                type="button"
                onClick={go}
                data-testid="landing-get-started"
                className="btn-sky px-8 py-3.5 text-base w-full sm:w-auto shadow-glow-lg hover:scale-[1.03] transition-transform"
              >
                {authed ? 'Go to Dashboard' : 'Get Started'}
                <ArrowRight className="w-4 h-4" />
              </button>
              {!authed && (
                <button
                  type="button"
                  onClick={() => navigate('/signup')}
                  data-testid="landing-create-account"
                  className="btn-ghost px-7 py-3.5 text-base w-full sm:w-auto"
                >
                  Create an account
                </button>
              )}
            </div>
          </motion.div>

          <HeroVisual />
        </section>

        {/* ---------------- Stats ---------------- */}
        <Section className="max-w-5xl mx-auto pb-24">
          <div className="relative glass rounded-3xl px-6 sm:px-10 py-12 overflow-hidden">
            <div
              className="absolute inset-x-0 top-0 h-px"
              style={{ background: 'linear-gradient(90deg, transparent, rgba(56,189,248,0.6), transparent)' }}
            />
            <h2 className="text-center font-display font-bold text-2xl sm:text-3xl text-white mb-3">
              Why it matters
            </h2>
            <p className="text-center text-sm text-slate-400 mb-12 max-w-lg mx-auto">
              Food waste is one of Canada's largest — and most solvable — climate problems.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-10 sm:gap-4">
              <Stat target={46} suffix="%" delay={0}
                label="of all food in Canada is wasted every year" />
              <Stat prefix="$" target={58} suffix="B" delay={0.1}
                label="the value of the 41% of that waste which is avoidable" />
              <Stat target={25.7} decimals={1} suffix=" Mt" delay={0.2}
                label="of CO₂ emitted annually by avoidable food waste" />
            </div>

            <p className="text-center text-[11px] text-slate-500 mt-12 leading-relaxed">
              Source: Second Harvest,{' '}
              <a
                href="https://www.secondharvest.ca/research/avoidable-crisis-updated"
                target="_blank"
                rel="noopener noreferrer"
                className="text-slate-400 hover:text-sky underline underline-offset-2 inline-flex items-center gap-1"
              >
                The Avoidable Crisis of Food Waste: Update
                <ExternalLink className="w-3 h-3" />
              </a>
              , October 2024.
            </p>
          </div>
        </Section>

        {/* ---------------- How it works ---------------- */}
        <Section className="max-w-5xl mx-auto pb-24">
          <h2 className="text-center font-display font-bold text-2xl sm:text-3xl text-white mb-3">
            How it works
          </h2>
          <p className="text-center text-sm text-slate-400 mb-12">
            From the bin to the boardroom, in three steps.
          </p>

          <div className="relative grid grid-cols-1 md:grid-cols-3 gap-5">
            {/* Connecting line behind the cards on desktop */}
            <div
              className="hidden md:block absolute top-16 left-[16%] right-[16%] h-px"
              style={{ background: 'linear-gradient(90deg, rgba(34,197,94,0.4), rgba(56,189,248,0.4), rgba(245,158,11,0.4))' }}
              aria-hidden
            />
            {STEPS.map(({ Icon, title, body, tint, bg }, i) => (
              <motion.div
                key={title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: i * 0.12, ease: [0.22, 1, 0.36, 1] }}
                className="relative glass rounded-2xl p-7 lift-card"
              >
                <div className="flex items-center justify-between mb-5">
                  <div className={`grid place-items-center w-12 h-12 rounded-xl ${bg} ${tint}`}>
                    <Icon className="w-5 h-5" />
                  </div>
                  <span className="font-display font-extrabold text-4xl text-ink-700 select-none">
                    0{i + 1}
                  </span>
                </div>
                <h3 className="font-display font-semibold text-white text-lg mb-2">{title}</h3>
                <p className="text-sm text-slate-400 leading-relaxed">{body}</p>
              </motion.div>
            ))}
          </div>
        </Section>

        {/* ---------------- Capabilities ---------------- */}
        <Section className="max-w-5xl mx-auto pb-24">
          <div className="text-center mb-12">
            <div className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-sky mb-4">
              <ScaleIcon className="w-3.5 h-3.5" />
              Capabilities
            </div>
            <h2 className="font-display font-bold text-2xl sm:text-3xl text-white mb-3">
              Everything the loop needs
            </h2>
            <p className="text-sm text-slate-400 max-w-lg mx-auto">
              Measurement is only useful if it's consistent, attributable and portable.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {CAPABILITIES.map(({ Icon, title, body }, i) => (
              <motion.div
                key={title}
                initial={{ opacity: 0, y: 18 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-40px' }}
                transition={{ duration: 0.45, delay: (i % 3) * 0.08, ease: [0.22, 1, 0.36, 1] }}
                className="glass rounded-2xl p-6 lift-card"
              >
                <div className="grid place-items-center w-10 h-10 rounded-xl bg-sky/10 text-sky mb-4">
                  <Icon className="w-[18px] h-[18px]" />
                </div>
                <h3 className="font-display font-semibold text-white text-[15px] mb-2">
                  {title}
                </h3>
                <p className="text-[13px] text-slate-400 leading-relaxed">{body}</p>
              </motion.div>
            ))}
          </div>
        </Section>

        {/* ---------------- Who it's for ---------------- */}
        <Section className="max-w-5xl mx-auto pb-24">
          <h2 className="text-center font-display font-bold text-2xl sm:text-3xl text-white mb-3">
            Who it's for
          </h2>
          <p className="text-center text-sm text-slate-400 mb-12 max-w-lg mx-auto">
            The same readings answer two very different questions.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {AUDIENCES.map(({ Icon, tag, title, points, tint, bg, border }, i) => (
              <motion.div
                key={tag}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-40px' }}
                transition={{ duration: 0.5, delay: i * 0.12, ease: [0.22, 1, 0.36, 1] }}
                className={`glass rounded-2xl p-7 lift-card ${border}`}
              >
                <div className="flex items-center gap-3 mb-5">
                  <span className={`grid place-items-center w-11 h-11 rounded-xl ${bg} ${tint}`}>
                    <Icon className="w-5 h-5" />
                  </span>
                  <span className={`text-[11px] font-bold uppercase tracking-[0.18em] ${tint}`}>
                    {tag}
                  </span>
                </div>
                <h3 className="font-display font-semibold text-white text-lg mb-4">{title}</h3>
                <ul className="space-y-2.5">
                  {points.map((p) => (
                    <li key={p} className="flex items-start gap-2.5 text-sm text-slate-400 leading-relaxed">
                      <span className={`mt-[7px] w-1.5 h-1.5 rounded-full shrink-0 ${tint.replace('text-', 'bg-')}`} />
                      {p}
                    </li>
                  ))}
                </ul>
              </motion.div>
            ))}
          </div>
        </Section>

        {/* ---------------- Research ---------------- */}
        <Section className="max-w-3xl mx-auto pb-24">
          <div className="relative glass-strong rounded-3xl px-6 sm:px-11 py-11 text-center overflow-hidden">
            <div
              className="absolute -top-24 left-1/2 -translate-x-1/2 w-72 h-72 rounded-full blur-3xl opacity-20 pointer-events-none"
              style={{ background: '#22C55E' }}
              aria-hidden
            />
            <div className="relative">
              <div className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-leaf mb-4">
                <Leaf className="w-3.5 h-3.5" />
                Research
              </div>
              <h2 className="font-display font-bold text-2xl sm:text-3xl text-white mb-5">
                Built for real measurement
              </h2>
              <p className="text-sm sm:text-base text-slate-400 leading-relaxed max-w-2xl mx-auto">
                IWM is named for the{' '}
                <a
                  href="https://www.dal.ca/faculty/agriculture/engineering/faculty-staff/our-faculty/gordon-price/research-group.html"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sky hover:text-sky/80 underline underline-offset-2"
                >
                  Innovative Waste Management Laboratory
                </a>{' '}
                at Dalhousie University, led by Dr. Gordon Price in the Department of
                Engineering. The lab's research addresses data gaps around greenhouse
                gas emissions across Canada's food system, with a focus on the
                industrial, commercial and institutional sector — work supported by
                NSERC and carried out in partnership with the Circular Innovation
                Council on data-driven commercial food waste diversion.
              </p>
              <p className="text-xs text-slate-500 mt-6 leading-relaxed">
                Accurate, per-site measurement is the foundation that kind of research
                depends on. That's what this platform is for.
              </p>
            </div>
          </div>
        </Section>

        {/* ---------------- Closing CTA ---------------- */}
        <Section className="max-w-3xl mx-auto pb-24 text-center">
          <h2 className="font-display font-extrabold text-3xl sm:text-4xl text-white tracking-tight mb-4">
            Start measuring today
          </h2>
          <p className="text-slate-400 mb-8 max-w-lg mx-auto">
            Set up your kitchen in minutes and watch the first readings land on your dashboard.
          </p>
          <button
            type="button"
            onClick={go}
            data-testid="landing-cta-bottom"
            className="btn-sky px-8 py-3.5 text-base shadow-glow-lg hover:scale-[1.03] transition-transform"
          >
            {authed ? 'Go to Dashboard' : 'Get Started'}
            <ArrowRight className="w-4 h-4" />
          </button>
        </Section>
      </main>

      {/* Footer */}
      <footer className="relative z-10 border-t border-ink-600/50 px-5 sm:px-8 lg:px-14 py-7">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-xs text-slate-500">
            © {new Date().getFullYear()} IWM · Innovative Waste Management
          </p>
          <button
            type="button"
            onClick={go}
            className="text-xs font-semibold text-sky hover:text-sky/80"
          >
            {authed ? 'Go to dashboard →' : 'Sign in →'}
          </button>
        </div>
      </footer>
    </div>
  );
}
