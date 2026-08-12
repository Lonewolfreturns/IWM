import { Scale as ScaleIcon, CloudCog, LineChart, Sprout, Globe2 } from 'lucide-react';

/**
 * A symbolic, continuously-revolving diagram of what IWM actually does:
 *
 *      scales measure  ->  cloud collects  ->  analytics quantify
 *      ->  waste is diverted back to soil  ->  and round again,
 *
 * all orbiting the thing the whole loop exists to improve: the planet.
 *
 * Deliberately not a chart. A chart would only say "there is data"; this says
 * what the data is *for*. Every moving part is CSS transform-driven so the
 * browser can keep it on the GPU compositor, and all of it stops dead for
 * anyone who has asked for reduced motion (see index.css).
 */

// Four stages, placed at the compass points of the orbit.
const STAGES = [
  {
    Icon: ScaleIcon,
    label: 'Measure',
    caption: 'IoT scales',
    pos: 'left-1/2 top-[11%] -translate-x-1/2 -translate-y-1/2',
    ring: 'border-leaf/40',
    tint: 'text-leaf',
    glow: 'rgba(34,197,94,0.35)',
  },
  {
    Icon: CloudCog,
    label: 'Collect',
    caption: 'Cloud',
    pos: 'left-[89%] top-1/2 -translate-x-1/2 -translate-y-1/2',
    ring: 'border-sky/40',
    tint: 'text-sky',
    glow: 'rgba(56,189,248,0.35)',
  },
  {
    Icon: LineChart,
    label: 'Quantify',
    caption: 'Waste · CO₂',
    pos: 'left-1/2 top-[89%] -translate-x-1/2 -translate-y-1/2',
    ring: 'border-amber/40',
    tint: 'text-amber',
    glow: 'rgba(245,158,11,0.35)',
  },
  {
    Icon: Sprout,
    label: 'Return',
    caption: 'Soil · diversion',
    pos: 'left-[11%] top-1/2 -translate-x-1/2 -translate-y-1/2',
    ring: 'border-leaf/40',
    tint: 'text-leaf',
    glow: 'rgba(34,197,94,0.35)',
  },
];

export default function ImpactCycle() {
  return (
    <div
      className="relative w-full max-w-[420px] mx-auto aspect-square select-none"
      role="img"
      aria-label="A continuous cycle: IoT scales measure food waste, the cloud collects the readings, analytics quantify waste and CO2, and diverted waste returns to the soil — all working to improve the planet."
    >
      {/* Soft pool of light behind the whole diagram */}
      <div
        className="absolute inset-[12%] rounded-full blur-3xl opacity-40 pointer-events-none"
        style={{ background: 'radial-gradient(circle, #38BDF8 0%, transparent 68%)' }}
        aria-hidden
      />

      {/* Rings + orbiting particles */}
      <svg viewBox="0 0 400 400" className="absolute inset-0 w-full h-full" aria-hidden>
        <defs>
          <linearGradient id="cycleArc" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#22C55E" />
            <stop offset="50%" stopColor="#38BDF8" />
            <stop offset="100%" stopColor="#F59E0B" />
          </linearGradient>
          <radialGradient id="earthFill" cx="35%" cy="30%">
            <stop offset="0%" stopColor="#38BDF8" stopOpacity="0.9" />
            <stop offset="60%" stopColor="#0EA5E9" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#0B1322" stopOpacity="0.9" />
          </radialGradient>
        </defs>

        {/* Static guide ring */}
        <circle cx="200" cy="200" r="156" fill="none" stroke="#334155" strokeWidth="1" opacity="0.5" />

        {/* Dashed ring, revolving one way */}
        <g className="animate-spin-slow" style={{ transformOrigin: '200px 200px' }}>
          <circle
            cx="200" cy="200" r="156" fill="none"
            stroke="url(#cycleArc)" strokeWidth="2"
            strokeDasharray="3 14" strokeLinecap="round" opacity="0.85"
          />
        </g>

        {/* Inner ring, revolving the other way for depth */}
        <g
          className="animate-spin-slow"
          style={{ transformOrigin: '200px 200px', animationDirection: 'reverse', animationDuration: '38s' }}
        >
          <circle
            cx="200" cy="200" r="118" fill="none"
            stroke="#38BDF8" strokeWidth="1"
            strokeDasharray="1 10" strokeLinecap="round" opacity="0.35"
          />
        </g>

        {/* Data packets travelling the orbit */}
        <g className="animate-spin-slow" style={{ transformOrigin: '200px 200px', animationDuration: '14s' }}>
          {[0, 120, 240].map((deg) => (
            <circle
              key={deg}
              cx={200 + 156 * Math.cos((deg * Math.PI) / 180)}
              cy={200 + 156 * Math.sin((deg * Math.PI) / 180)}
              r="4"
              fill={deg === 0 ? '#22C55E' : deg === 120 ? '#38BDF8' : '#F59E0B'}
            >
              <animate attributeName="opacity" values="0.35;1;0.35" dur="2.6s" repeatCount="indefinite" />
            </circle>
          ))}
        </g>

        {/* The planet at the centre */}
        <circle cx="200" cy="200" r="58" fill="url(#earthFill)" stroke="#38BDF8" strokeOpacity="0.35" />
        <circle cx="200" cy="200" r="58" fill="none" stroke="#38BDF8" strokeWidth="1" opacity="0.25">
          <animate attributeName="r" values="58;70;58" dur="4.5s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.3;0;0.3" dur="4.5s" repeatCount="indefinite" />
        </circle>
      </svg>

      {/* Centre label */}
      <div className="absolute inset-0 grid place-items-center pointer-events-none">
        <div className="text-center">
          <Globe2 className="w-9 h-9 text-sky mx-auto animate-spin-slow" style={{ animationDuration: '40s' }} />
          <div className="text-[10px] uppercase tracking-[0.2em] text-slate-400 mt-1.5 font-semibold">
            Impact
          </div>
        </div>
      </div>

      {/* Stage nodes */}
      {STAGES.map(({ Icon, label, caption, pos, ring, tint, glow }) => (
        <div key={label} className={`absolute ${pos} flex flex-col items-center gap-1.5`}>
          <div
            className={`grid place-items-center w-14 h-14 rounded-2xl glass-strong border ${ring} ${tint}`}
            style={{ boxShadow: `0 0 26px -6px ${glow}` }}
          >
            <Icon className="w-6 h-6" />
          </div>
          <div className="text-center leading-tight">
            <div className="text-[11px] font-bold text-white tracking-wide">{label}</div>
            <div className="text-[9px] uppercase tracking-wider text-slate-500 whitespace-nowrap">
              {caption}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
