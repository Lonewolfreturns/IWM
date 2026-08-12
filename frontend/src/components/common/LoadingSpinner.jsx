export default function LoadingSpinner({ size = 28, className = '' }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={`inline-block ${className}`}
      style={{ width: size, height: size }}
    >
      <svg viewBox="0 0 50 50" className="animate-spin">
        <circle
          cx="25"
          cy="25"
          r="20"
          fill="none"
          strokeWidth="4"
          stroke="rgba(56,189,248,0.18)"
        />
        <circle
          cx="25"
          cy="25"
          r="20"
          fill="none"
          strokeWidth="4"
          stroke="#38BDF8"
          strokeDasharray="90 200"
          strokeLinecap="round"
        />
      </svg>
    </span>
  );
}
