import { useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from '../components/layout/Sidebar.jsx';
import Navbar from '../components/layout/Navbar.jsx';
import OfflineBanner from '../components/common/OfflineBanner.jsx';

const ROUTE_TITLES = {
  '/dashboard': 'Overview Dashboard',
  '/analytics': 'Analytics',
  '/reports': 'Reports & Exports',
  '/scales': 'Scale Management',
  '/users': 'User Management',
  '/data-config': 'Data Configuration',
  '/system-logs': 'System Logs',
  '/settings': 'Settings',
};

export default function MainLayout() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const title = ROUTE_TITLES[location.pathname] || 'IWM';

  return (
    <div className="ww-mesh min-h-screen relative">
      <Sidebar mobileOpen={mobileOpen} onClose={() => setMobileOpen(false)} />

      {/*
        One sidebar width from md (768px) up, rather than an 80px icon rail
        between 768 and 1024.

        The rail looked tidy and was not: at 768 it hid every nav LABEL, the
        whole timezone picker and the signed-in user's name, while the brand
        wordmark — which never had the collapsed treatment the others did —
        overflowed its 80px and collided with the page title in the navbar.
        A tablet is the width where that information fits comfortably, so it
        is shown. Below 768 the sidebar is a drawer, which is unchanged.
      */}
      <div className="md:pl-[240px] pl-0 relative z-10">
        {/* Above the navbar, so a dropped connection is the first thing
            on screen rather than something to scroll past. */}
        <OfflineBanner />

        <Navbar
          title={title}
          onMenuClick={() => setMobileOpen(true)}
        />

        <main
          data-testid="main-content"
          className="px-4 sm:px-6 lg:px-8 py-6 lg:py-8 max-w-[1600px] mx-auto"
          // Bottom: clears the iOS home indicator and Android's gesture bar,
          // which otherwise sit on top of the last row of whatever is
          // scrolled to the end — routinely a table row or a chart legend.
          // Right: the landscape notch inset; the left one is taken by the
          // sidebar, which spans the full height.
          style={{
            paddingBottom: 'calc(1.5rem + var(--safe-bottom))',
            paddingRight: 'calc(1rem + var(--safe-right))',
          }}
        >
          <Outlet />
        </main>
      </div>
    </div>
  );
}
