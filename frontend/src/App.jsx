import { Suspense, lazy } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
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

const pageTransition = {
  initial: { opacity: 0, y: 18 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -10 },
  transition: { duration: 0.35, ease: [0.22, 1, 0.36, 1] },
};

// The Suspense boundary lives INSIDE the animated wrapper on purpose. If it
// sits outside <AnimatePresence>, a lazily-loaded route chunk suspending will
// unmount the whole AnimatePresence subtree mid-transition, so its exit/enter
// cycle never completes and the page silently never swaps — the URL changes
// but the old screen stays on display. Keeping it here means only the page
// body suspends; the motion element AnimatePresence is tracking stays mounted.
function AnimatedPage({ children }) {
  return (
    <motion.div
      initial={pageTransition.initial}
      animate={pageTransition.animate}
      exit={pageTransition.exit}
      transition={pageTransition.transition}
      className="relative z-10"
    >
      <Suspense
        fallback={
          <div className="flex min-h-[60vh] w-full items-center justify-center">
            <LoadingSpinner size={40} />
          </div>
        }
      >
        {children}
      </Suspense>
    </motion.div>
  );
}

export default function App() {
  const location = useLocation();

  return (
    <AnimatePresence mode="wait">
      <Routes location={location} key={location.pathname}>
          <Route
            path="/"
            element={
              <AnimatedPage>
                <Landing />
              </AnimatedPage>
            }
          />
          <Route
            path="/login"
            element={
              <AnimatedPage>
                <Login />
              </AnimatedPage>
            }
          />
          <Route
            path="/signup"
            element={
              <AnimatedPage>
                <SignUp />
              </AnimatedPage>
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
                <AnimatedPage>
                  <Dashboard />
                </AnimatedPage>
              }
            />
            <Route
              path="/analytics"
              element={
                <AnimatedPage>
                  <Analytics />
                </AnimatedPage>
              }
            />
            <Route
              path="/reports"
              element={
                <AnimatedPage>
                  <Reports />
                </AnimatedPage>
              }
            />
            <Route
              path="/scales"
              element={
                <ProtectedRoute requireAdmin>
                  <AnimatedPage>
                    <ScaleManagement />
                  </AnimatedPage>
                </ProtectedRoute>
              }
            />
            <Route
              path="/users"
              element={
                <ProtectedRoute requireAdmin>
                  <AnimatedPage>
                    <UserManagement />
                  </AnimatedPage>
                </ProtectedRoute>
              }
            />
            <Route
              path="/data-config"
              element={
                <ProtectedRoute requireAdmin>
                  <AnimatedPage>
                    <DataConfiguration />
                  </AnimatedPage>
                </ProtectedRoute>
              }
            />
            <Route
              path="/system-logs"
              element={
                <ProtectedRoute requireAdmin>
                  <AnimatedPage>
                    <SystemLogs />
                  </AnimatedPage>
                </ProtectedRoute>
              }
            />
            <Route
              path="/settings"
              element={
                <AnimatedPage>
                  <Settings />
                </AnimatedPage>
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
    </AnimatePresence>
  );
}
