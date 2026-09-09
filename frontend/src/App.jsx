import { Suspense, lazy } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import { isAuthenticated } from './services/auth';
import MainLayout from './layouts/MainLayout.jsx';
import LoadingSpinner from './components/common/LoadingSpinner.jsx';

const Landing = lazy(() => import('./pages/Landing.jsx'));
const Login = lazy(() => import('./pages/Login.jsx'));
const SignUp = lazy(() => import('./pages/SignUp.jsx'));
const Dashboard = lazy(() => import('./pages/Dashboard.jsx'));
const Analytics = lazy(() => import('./pages/Analytics.jsx'));
const Reports = lazy(() => import('./pages/Reports.jsx'));
const ScaleManagement = lazy(() => import('./pages/ScaleManagement.jsx'));
const UserManagement = lazy(() => import('./pages/UserManagement.jsx'));
const DataConfiguration = lazy(() => import('./pages/DataConfiguration.jsx'));
const SystemLogs = lazy(() => import('./pages/SystemLogs.jsx'));
const Settings = lazy(() => import('./pages/Settings.jsx'));

/*
 * ROUTE TRANSITIONS WERE REMOVED, AND THIS IS WHY.
 *
 * Every top-level route used to be wrapped in a motion.div inside
 * `<AnimatePresence mode="wait">`, with `<Routes location={location}
 * key={location.pathname}>` as the direct child. That is the pattern the
 * framer/react-router docs describe, and here it broke navigation outright:
 * clicking "Sign in" on the landing page changed the URL to /login and left
 * the landing page on screen indefinitely. Only a full page reload moved.
 *
 * Measured, not guessed. With `mode="wait"` the incoming route never mounted
 * at all. With it removed, the incoming route mounted but the outgoing one was
 * never unmounted — both rendered, stacked, forever. That is the signature of
 * an exit animation whose completion callback never fires: `mode="wait"` waits
 * on it before mounting the next page, and without the mode nothing ever calls
 * safeToRemove. The exiting subtree here is a keyed `<Routes>` holding a
 * lazily-loaded chunk, and a suspending child in that position is enough to
 * lose the callback.
 *
 * Rather than keep fighting it, the route-level transition is gone. Nothing
 * visual was really lost: every page already animates itself on mount — the
 * auth cards have their own motion.div, the dashboard tiles stagger in — so
 * pages still arrive with movement, they just arrive reliably.
 *
 * Suspense stays at the top so a lazy chunk shows one spinner while it loads.
 */

export default function App() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[60vh] w-full items-center justify-center">
          <LoadingSpinner size={40} />
        </div>
      }
    >
      <Routes>
          <Route
            path="/"
            element={
              <Landing />
            }
          />
          <Route
            path="/login"
            element={
              <Login />
            }
          />
          <Route
            path="/signup"
            element={
              <SignUp />
            }
          />

          <Route
            element={
              <ProtectedRoute>
                <MainLayout />
              </ProtectedRoute>
            }
          >
            <Route
              path="/dashboard"
              element={
                <Dashboard />
              }
            />
            <Route
              path="/analytics"
              element={
                <Analytics />
              }
            />
            <Route
              path="/reports"
              element={
                <Reports />
              }
            />
            <Route
              path="/scales"
              element={
                <ProtectedRoute requireAdmin>
                  <ScaleManagement />
                </ProtectedRoute>
              }
            />
            <Route
              path="/users"
              element={
                <ProtectedRoute requireAdmin>
                  <UserManagement />
                </ProtectedRoute>
              }
            />
            <Route
              path="/data-config"
              element={
                <ProtectedRoute requireAdmin>
                  <DataConfiguration />
                </ProtectedRoute>
              }
            />
            <Route
              path="/system-logs"
              element={
                <ProtectedRoute requireAdmin>
                  <SystemLogs />
                </ProtectedRoute>
              }
            />
            <Route
              path="/settings"
              element={
                <Settings />
              }
            />
          </Route>

          {/* Unknown paths land wherever the visitor can actually get to.
              Sending everyone to /dashboard meant a signed-out visitor was
              bounced twice — once here, once by ProtectedRoute — rendering an
              empty dashboard in between. */}
          <Route
            path="*"
            element={<Navigate to={isAuthenticated() ? '/dashboard' : '/login'} replace />}
          />
      </Routes>
    </Suspense>
  );
}
