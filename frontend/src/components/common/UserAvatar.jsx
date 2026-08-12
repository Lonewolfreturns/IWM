// Chrome-level identity mark for the sidebar footer and navbar user menu.
// Client accounts show no picture at all (by request). Admin accounts get a
// small IWM lettermark instead of a photo.
export default function UserAvatar({ user }) {
  if (user?.role !== 'admin') return null;
  return (
    <div
      className="grid place-items-center w-9 h-9 rounded-full bg-leaf-gradient border border-ink-600 shrink-0"
      aria-label="IWM admin"
      title="IWM Admin"
    >
      <span className="font-display font-extrabold text-[10px] text-ink-900 tracking-tighter">
        IWM
      </span>
    </div>
  );
}
