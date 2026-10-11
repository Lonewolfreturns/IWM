import { useEffect, useState } from 'react';
import { WifiOff } from 'lucide-react';
import { isNative, hasPlugin } from '../../native/platform.js';

/*
 * A bar that appears when the device loses its connection.
 *
 * WHY THIS MATTERS MORE IN THE APP THAN ON THE WEB
 *
 * The dashboard polls every 15 seconds and swallows every failure on purpose —
 * a transient error must not blank a panel that already holds good data, so a
 * rejected request leaves the previous values on screen. That is right for one
 * dropped poll and wrong for a tunnel: the numbers sit there looking live
 * while they quietly go stale, and the only hint is a "last updated" time
 * nobody reads.
 *
 * On a desktop that state is brief and usually obvious. On a phone, walking
 * into a walk-in fridge or a basement kitchen is exactly where this app gets
 * used, so it has to say so.
 *
 * `navigator.onLine` is the web fallback and is famously weak — it reports a
 * link-layer connection, not reachability, so a captive portal reads as
 * online. The Network plugin asks the platform, which is why the native path
 * is preferred where it exists.
 */
export default function OfflineBanner() {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    let mounted = true;
    let remove = null;

    const apply = (connected) => {
      if (mounted) setOffline(!connected);
    };

    if (isNative && hasPlugin('Network')) {
      import('@capacitor/network')
        .then(async ({ Network }) => {
          if (!mounted) return;
          const status = await Network.getStatus();
          apply(status.connected);
          const handle = await Network.addListener('networkStatusChange', (s) =>
            apply(s.connected)
          );
          // The listener outlives this effect if it is not removed, and in
          // StrictMode the effect runs twice — so without this, two listeners
          // accumulate on every mount.
          if (mounted) remove = () => handle.remove();
          else handle.remove();
        })
        .catch(() => {});
    } else {
      apply(navigator.onLine);
      const on = () => apply(true);
      const off = () => apply(false);
      window.addEventListener('online', on);
      window.addEventListener('offline', off);
      remove = () => {
        window.removeEventListener('online', on);
        window.removeEventListener('offline', off);
      };
    }

    return () => {
      mounted = false;
      remove?.();
    };
  }, []);

  if (!offline) return null;

  return (
    <div
      role="status"
      data-testid="offline-banner"
      className="sticky top-0 z-30 flex items-center justify-center gap-2 px-4 py-2
                 bg-amber/15 border-b border-amber/30 text-amber text-xs font-semibold"
    >
      <WifiOff className="w-3.5 h-3.5 shrink-0" />
      <span>No connection — showing the last data received</span>
    </div>
  );
}
