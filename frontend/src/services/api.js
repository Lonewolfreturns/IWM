import axios from 'axios';

// Three AWS Lambda Function URLs, three clients:
//
//   authApi     -> iwm-auth      (public: /auth/login, /auth/signup)
//   api         -> iwm-api       (token-gated: /scales, /users, /me)
//   readingsApi -> iwm-readings   (token-gated: /readings, /dashboard/*, /analytics/*)
//
// Separate deployments so the one publicly-reachable endpoint stays isolated,
// and so the heavy telemetry queries can be tuned independently. Set all three
// in frontend/.env; Vite only reads that file at startup, so restart the dev
// server after changing it.
const AUTH_BASE_URL = import.meta.env.VITE_API_URL || '';
const CORE_BASE_URL = import.meta.env.VITE_CORE_API_URL || AUTH_BASE_URL;
const READINGS_BASE_URL = import.meta.env.VITE_READINGS_API_URL || CORE_BASE_URL;
// Analytics and Reports moved to their own deployments so a year-long range
// scan can be tuned (timeout, memory) without touching the dashboard's
// latency-sensitive polling. Both fall back to the readings Lambda, which
// still serves the older bare-array routes.
const ANALYTICS_BASE_URL = import.meta.env.VITE_ANALYTICS_API_URL || READINGS_BASE_URL;
const REPORTS_BASE_URL = import.meta.env.VITE_REPORTS_API_URL || READINGS_BASE_URL;

if (import.meta.env.DEV) {
  if (!AUTH_BASE_URL) {
    console.warn('[IWM] VITE_API_URL is not set — login and signup will fail.');
  }
  if (!import.meta.env.VITE_CORE_API_URL) {
    console.warn(
      '[IWM] VITE_CORE_API_URL is not set — scales, users and profile calls ' +
      'will be sent to the auth Lambda and 404.'
    );
  }
  if (!import.meta.env.VITE_READINGS_API_URL) {
    console.warn(
      '[IWM] VITE_READINGS_API_URL is not set — readings, dashboard stats and ' +
      'analytics will 404 and render as empty states.'
    );
  }
}

function createClient(baseURL) {
  const client = axios.create({
    baseURL,
    timeout: 15000,
    headers: { 'Content-Type': 'application/json' },
  });

  client.interceptors.request.use((config) => {
    const token = localStorage.getItem('ww_token');
    if (token) config.headers.Authorization = `Bearer ${token}`;
    return config;
  });

  return client;
}

export const authApi = createClient(AUTH_BASE_URL);
export const readingsApi = createClient(READINGS_BASE_URL);
export const analyticsApi = createClient(ANALYTICS_BASE_URL);
export const reportsApi = createClient(REPORTS_BASE_URL);
const api = createClient(CORE_BASE_URL);

// A 401 means an expired/invalid session — clear it and bounce to login.
// Exclude the auth pages themselves: a failed sign-in attempt also returns 401,
// and redirecting there would wipe the form instead of showing the error toast.
const AUTH_PATHS = ['/login', '/signup'];

const handleUnauthorized = (err) => {
  if (err?.response?.status === 401 && !AUTH_PATHS.includes(window.location.pathname)) {
    localStorage.removeItem('ww_token');
    localStorage.removeItem('ww_user');
    window.location.href = '/login';
  }
  return Promise.reject(err);
};

api.interceptors.response.use((res) => res, handleUnauthorized);
authApi.interceptors.response.use((res) => res, handleUnauthorized);
readingsApi.interceptors.response.use((res) => res, handleUnauthorized);
analyticsApi.interceptors.response.use((res) => res, handleUnauthorized);
reportsApi.interceptors.response.use((res) => res, handleUnauthorized);

export default api;
