import { Suspense, lazy, useEffect } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import { isAuthenticated } from './services/auth';
import { setUnauthorizedHandler } from './services/api';
import { setRouterBack } from './native/shell.js';
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
const Privacy = lazy(() => import('./pages/Privacy.jsx'));
const DeleteAccount = lazy(() => import('./pages/DeleteAccount.jsx'));

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

/*
 * Routes that are the end of the line for the Android back button.
 *
 * Pressing back on one of these minimises the app rather than navigating. The
 * dashboard is where a signed-in user starts, and the landing page is where a
 * signed-out one does, so in both cases there is nothing behind them that the
 * user chose to visit — only whatever redirect put them there. Letting history
 * unwind past it walks backwards through those redirects, which from the
 * user's side looks like the back button flashing the screen and doing
 * nothing.
 */
const BACK_EXITS_APP = ['/', '/dashboard', '/login'];

export default function App() {
  const navigate = useNavigate();
  const location = useLocation();

  // A 401 anywhere in the app routes through here instead of assigning
  // window.location, which in the native apps would reload the whole WebView.
  // See services/api.js.
  useEffect(() => {
    setUnauthorizedHandler(() => navigate('/login', { replace: true }));
    return () => setUnauthorizedHandler(null);
  }, [navigate]);

  // Tells the native shell what the back button should do when no open dialog
  // has claimed it. Returning true means "handled, stop here".
  useEffect(() => {
    setRouterBack(() => {
      if (BACK_EXITS_APP.includes(location.pathname)) return false;
      navigate(-1);
      return true;
    });
    return () => setRouterBack(null);
  }, [navigate, location.pathname]);

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

          {/*
            Public on purpose, and outside ProtectedRoute.

            Both are store requirements rather than product pages. Apple will
            not accept a submission without a reachable privacy policy URL, and
            Play's User Data policy requires an account-deletion route that
            works for someone who has already uninstalled the app — which means
            it cannot sit behind a sign-in. Both URLs are submitted in the store
            listings, so their paths are part of the contract:

              https://foodloss.ca/privacy
              https://foodloss.ca/delete-account
          */}
          <Route path="/privacy" element={<Privacy />} />
          <Route path="/delete-account" element={<DeleteAccount />} />

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
