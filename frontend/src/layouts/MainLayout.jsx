import { useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from '../components/layout/Sidebar.jsx';
import Navbar from '../components/layout/Navbar.jsx';

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

      <div className="lg:pl-[240px] md:pl-[80px] pl-0 relative z-10">
        <Navbar
          title={title}
          onMenuClick={() => setMobileOpen(true)}
        />

        <main
          data-testid="main-content"
          className="px-4 sm:px-6 lg:px-8 py-6 lg:py-8 max-w-[1600px] mx-auto"
        >
          <Outlet />
        </main>
      </div>
    </div>
  );
}
