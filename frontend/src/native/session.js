// =============================================================================
// IWM — Session storage
// =============================================================================
//
// Where the signed-in user's JWT lives.
//
// On the web that is `localStorage`, as before. In the native apps it is the
// iOS Keychain and Android's EncryptedSharedPreferences (AES-256 via the
// Keystore), because `localStorage` inside a WebView is an unencrypted SQLite
// file in the app sandbox. On a rooted or jailbroken device — and in any
// filesystem backup that captures app data — that file is readable, and a
// bearer token read out of it is a working session.
//
// Both store reviews look for this. Google Play's security guidance and
// Apple's review guideline 5.1.1(ix) both treat auth credentials as data that
// must be protected at rest, and automated scanners (Play's pre-launch report,
// MobSF, the usual pentest tooling) specifically grep WebView local storage
// for anything token-shaped.
//
// WHY THERE IS A CACHE
// --------------------
// The Keychain and Keystore APIs are asynchronous; `localStorage.getItem` is
// not. The axios request interceptor in services/api.js has to attach a header
// synchronously, and so does every `isAuthenticated()` check during the first
// render. Rather than make all of that async and thread promises through the
// router guards, the session is read once into memory at startup and every
// subsequent read is served from there. Writes go to the secure store and
// update the cache together.
//
// That means the cache is authoritative for the lifetime of the process and
// the secure store is the durable copy. They cannot drift: nothing else writes
// those keys.
// =============================================================================

import { isNative, hasPlugin } from './platform.js';

const TOKEN_KEY = 'ww_token';
const USER_KEY = 'ww_user';

// Resolved during hydrate(). Kept module-level rather than exported so no
// caller can read a token before hydration has decided where it comes from.
let cache = { token: null, user: null };
let hydrated = false;
let secure = null; // the plugin, once it is known to be usable

/**
 * True when the secure store is in play.
 *
 * Exposed so Settings can tell the user where their session is kept, and so
 * the hydrate failure path is observable rather than silent.
 */
export let usingSecureStore = false;

function parseUser(raw) {
  if (!raw) return null;
  if (typeof raw === 'object') return raw; // SecureStorage round-trips objects
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Loads the session into memory. Must finish before the app renders.
 *
 * Falls back to `localStorage` if the secure store cannot be reached — a
 * device with no passcode, a Keystore that has invalidated its key after a
 * biometric enrolment change, or a plugin missing from an older build. Losing
 * the session on every launch would be a worse failure than storing it the way
 * the web build already does, so the fallback is deliberate and reported
 * through `usingSecureStore` rather than hidden.
 */
export async function hydrateSession() {
  if (hydrated) return cache;

  if (isNative && hasPlugin('SecureStorage')) {
    try {
      const { SecureStorage } = await import('@aparajita/capacitor-secure-storage');

      // Never sync to iCloud. A bearer token on another of the user's devices
      // is a second copy to lose control of, and this one is cheap to
      // re-obtain by signing in.
      await SecureStorage.setSynchronize(false);

      const [token, user] = await Promise.all([
        SecureStorage.get(TOKEN_KEY),
        SecureStorage.get(USER_KEY),
      ]);

      secure = SecureStorage;
      usingSecureStore = true;
      cache = { token: token ?? null, user: parseUser(user) };

      // One-time move for anyone upgrading from a build that kept the session
      // in WebView storage: adopt it, then wipe the plaintext copy.
      if (!cache.token) {
        const legacy = readLocal();
        if (legacy.token) {
          cache = legacy;
          await writeSecure(legacy.token, legacy.user);
        }
      }
      clearLocal();

      hydrated = true;
      return cache;
    } catch (err) {
      // Deliberately not rethrown: see the fallback note above.
      console.warn('[IWM] secure session store unavailable, using localStorage', err);
      secure = null;
      usingSecureStore = false;
    }
  }

  cache = readLocal();
  hydrated = true;
  return cache;
}

function readLocal() {
  try {
    return {
      token: localStorage.getItem(TOKEN_KEY),
      user: parseUser(localStorage.getItem(USER_KEY)),
    };
  } catch {
    // Private browsing / blocked site data.
    return { token: null, user: null };
  }
}

function clearLocal() {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  } catch {
    /* nothing to clear */
  }
}

async function writeSecure(token, user) {
  if (!secure) return;
  // `set` rejects on null, so an absent user is removed rather than written.
  await secure.set(TOKEN_KEY, token);
  if (user) await secure.set(USER_KEY, user);
  else await secure.remove(USER_KEY).catch(() => {});
}

// --- synchronous reads, served from the cache --------------------------------

export function getToken() {
  return cache.token;
}

export function getUser() {
  return cache.user;
}

/**
 * Persists a session. Await it where the caller is already async (sign-in),
 * so a token is durable before the app navigates away from the form.
 */
export async function setSession(token, user) {
  cache = { token: token ?? null, user: user ?? null };
  if (secure) {
    try {
      await writeSecure(cache.token, cache.user);
      return;
    } catch (err) {
      // Keep the in-memory session — the user is signed in either way — but
      // do not silently leave them with a session that dies on relaunch.
      console.warn('[IWM] could not write secure session', err);
    }
  }
  try {
    localStorage.setItem(TOKEN_KEY, cache.token ?? '');
    if (cache.user) localStorage.setItem(USER_KEY, JSON.stringify(cache.user));
  } catch {
    /* in-memory only for this launch */
  }
}

/** Merges fields into the cached user without touching the token. */
export async function patchUser(fields) {
  const next = { ...(cache.user || {}), ...(fields || {}) };
  await setSession(cache.token, next);
  return next;
}

export async function clearSession() {
  cache = { token: null, user: null };
  if (secure) {
    await Promise.all([
      secure.remove(TOKEN_KEY).catch(() => {}),
      secure.remove(USER_KEY).catch(() => {}),
    ]);
  }
  clearLocal();
}
