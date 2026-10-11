// Auth service — talks to the `iwm-auth` Lambda via the `authApi` client
// (see services/api.js). Accounts are created by clients themselves through
// /signup; admins are pre-provisioned in DynamoDB and cannot self-register.
import { authApi } from './api';
import { clearDashboardCache } from '../lib/dashboardCache.js';
import {
  getToken as readToken,
  getUser,
  setSession,
  clearSession,
} from '../native/session.js';

// Session persistence lives in native/session.js: localStorage on the web, the
// iOS Keychain / Android EncryptedSharedPreferences in the apps. This wrapper
// stays here so the rest of the app keeps importing auth the way it always has.
function persistSession(token, user) {
  return setSession(token, user);
}

// Credentials: email + password + secretAnswer (the answer to the security
// question chosen at signup, e.g. "What is your favorite food?").
// No role is passed — it's whatever the account has in the database. The API
// still accepts an optional role and will reject a mismatch, but the UI has
// no reason to guess.
export async function login({ email, password, secretAnswer }) {
  const { data } = await authApi.post('/auth/login', {
    email,
    password,
    secretAnswer,
  });
  // Awaited, unlike the old synchronous localStorage write: the secure store is
  // asynchronous, and resolving before it completes would let the caller
  // navigate to the dashboard with the token still only in memory.
  await persistSession(data.token, data.user);
  return data;
}

// Self-service signup — always creates a 'client' account. Admin accounts are
// provisioned directly in the database, not through this flow.
export async function signup({
  name,
  email,
  password,
  secretQuestion,
  secretAnswer,
  organization,
  city,
  phone,
}) {
  const { data } = await authApi.post('/auth/signup', {
    name,
    email,
    password,
    secretQuestion,
    secretAnswer,
    organization,
    city,
    phone,
    role: 'client',
  });
  await persistSession(data.token, data.user);
  return data;
}

/**
 * Changes the signed-in user's password and/or security question.
 *
 * The current password AND secret answer are re-checked server-side even
 * though the request is already authenticated: a live session can be a
 * borrowed laptop, and what is being replaced here is the credential that
 * grants access afterwards.
 *
 * Pass only the parts being changed. The API returns a fresh token, which is
 * persisted so the session is not left holding one minted against credentials
 * that no longer exist.
 */
export async function changeCredentials({
  currentPassword,
  currentSecretAnswer,
  newPassword,
  newSecretQuestion,
  newSecretAnswer,
}) {
  const { data } = await authApi.post('/auth/credentials', {
    currentPassword,
    currentSecretAnswer,
    ...(newPassword ? { newPassword } : {}),
    ...(newSecretQuestion ? { newSecretQuestion } : {}),
    ...(newSecretAnswer ? { newSecretAnswer } : {}),
  });
  await persistSession(data.token, data.user);
  return data;
}

export async function logout() {
  await clearSession();
  // The dashboard keeps its last response in memory so navigation is instant.
  // Clearing it here covers every exit — the buttons, and the expired-token
  // path below — so a new sign-in never paints the previous account's scales.
  clearDashboardCache();
}

export function getCurrentUser() {
  return getUser();
}

export function getToken() {
  return readToken();
}

/**
 * The JWT's payload, or null if it isn't a readable token.
 *
 * Base64url, so `-` and `_` have to be mapped back before atob, and the
 * padding the encoder stripped has to be restored.
 */
function decodeToken(token) {
  try {
    const payload = String(token).split('.')[1];
    if (!payload) return null;
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

/**
 * Whether the token is past its `exp`.
 *
 * A token with no `exp` is treated as live: the server is the real authority,
 * and locking a user out over a claim that was never issued would be worse
 * than letting one request 401.
 *
 * The 30s skew allows for a slightly fast client clock, so a token that the
 * API would still accept isn't discarded a moment early.
 */
export function isTokenExpired(token = getToken()) {
  const claims = decodeToken(token);
  if (!claims || typeof claims.exp !== 'number') return false;
  return claims.exp * 1000 <= Date.now() - 30_000;
}

/**
 * Checked before any guarded route renders.
 *
 * This deliberately inspects `exp` rather than only asking whether a token
 * string exists. Presence alone let an expired session mount the dashboard,
 * which then fired its requests, collected a 401 and bounced to /login — the
 * blank-dashboard flash on every return to the app. Failing the check up front
 * means an expired session goes straight to the login screen.
 */
export function isAuthenticated() {
  const token = getToken();
  if (!token || !getCurrentUser()) return false;
  if (isTokenExpired(token)) {
    logout();          // don't leave a dead token behind to fail again
    return false;
  }
  return true;
}
