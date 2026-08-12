import { Navigate, useLocation } from 'react-router-dom';
import { isAuthenticated, getCurrentUser } from '../services/auth';

export default function ProtectedRoute({ children, requireAdmin = false }) {
  const location = useLocation();
  const authed = isAuthenticated();

  if (!authed) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  if (requireAdmin) {
    const user = getCurrentUser();
    if (!user || user.role !== 'admin') {
      return <Navigate to="/dashboard" replace />;
    }
  }

  return children;
}
