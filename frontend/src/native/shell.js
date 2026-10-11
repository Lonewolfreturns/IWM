// =============================================================================
// IWM — Native app shell
// =============================================================================
//
// One-time wiring between the web app and the things that only exist once it
// is inside an APK or an IPA: the status bar, the splash screen, the software
// keyboard, the Android hardware back button, and the resume lifecycle.
//
// Everything here is a no-op on the web build, so main.jsx can call it
// unconditionally.
// =============================================================================

import { isNative, isAndroid, isIOS, hasPlugin } from './platform.js';
import { clearExportCache } from './saveFile.js';

let started = false;

// --- hardware back button ----------------------------------------------------
//
// Android's back gesture is a system-level promise: it must undo the last
// thing that happened. A WebView does not know what that was, so the app has
// to say. Components that open something dismissible (a drawer, a modal, a
// confirm step) push a handler here; the most recent one gets first refusal,
// and only when nothing claims the press does it become navigation.
//
// Getting this wrong is a listed rejection reason on Play ("app does not
// respond correctly to the Back button") and in practice is the single most
// irritating thing about a web app in a shell: one back press from a dialog
// and the whole session is gone.

const backHandlers = [];

/**
 * Registers a back-press handler. Returns its unsubscribe function.
 *
 * The handler returns true when it consumed the press.
 */
export function pushBackHandler(fn) {
  backHandlers.push(fn);
  return () => {
    const i = backHandlers.indexOf(fn);
    if (i >= 0) backHandlers.splice(i, 1);
  };
}

/**
 * Where the back button goes when nothing has claimed it. Set once by the
 * router, which is the only thing that can navigate.
 */
let routerBack = null;
export function setRouterBack(fn) {
  routerBack = fn;
}

async function onBackPress({ canGoBack }) {
  // Most recently opened first.
  for (let i = backHandlers.length - 1; i >= 0; i--) {
    try {
      if (backHandlers[i]()) return;
    } catch (err) {
      console.warn('[IWM] back handler threw', err);
    }
  }

  if (routerBack && routerBack()) return;

  if (canGoBack) {
    window.history.back();
    return;
  }

  // At the root with nothing to dismiss. Minimise rather than exit: the app
  // keeps its place, and a user who meant to leave gets the behaviour every
  // other Android app gives them. `exitApp` would tear down the WebView and
  // reload the whole bundle on next launch.
  const { App } = await import('@capacitor/app');
  await App.minimizeApp();
}

// --- keyboard ----------------------------------------------------------------
//
// `resize: native` lets the OS shrink the WebView, which handles scrolling for
// free. The height is still published as a CSS variable so a fixed-position
// element (the sidebar's bottom actions, a sticky form footer) can lift clear
// of the keyboard instead of sitting under it.

function publishKeyboardHeight(px) {
  document.documentElement.style.setProperty('--kb-height', `${Math.round(px)}px`);
  document.documentElement.classList.toggle('kb-open', px > 0);
}

/**
 * Starts the native shell. Idempotent.
 */
export async function initNativeShell() {
  if (started) return;
  started = true;

  // Marks the platform on <html> so CSS can target it — safe-area padding and
  // the iOS-only scroll-bounce suppression both need it, and a media query
  // cannot ask what OS it is on.
  document.documentElement.classList.add(isNative ? 'native' : 'web');
  if (isAndroid) document.documentElement.classList.add('android');
  if (isIOS) document.documentElement.classList.add('ios');

  if (!isNative) return;

  try {
    if (hasPlugin('StatusBar')) {
      const { StatusBar, Style } = await import('@capacitor/status-bar');
      // The app is dark-only, so the status bar is pinned to light content on
      // a dark background rather than following the system theme.
      await StatusBar.setStyle({ style: Style.Dark });
      if (isAndroid) {
        await StatusBar.setBackgroundColor({ color: '#0F172A' });
        // The web layout already reserves the inset itself (see safe-area.css);
        // overlaying would double it.
        await StatusBar.setOverlaysWebView({ overlay: false });
      }
    }
  } catch (err) {
    console.warn('[IWM] status bar setup failed', err);
  }

  try {
    if (hasPlugin('Keyboard')) {
      const { Keyboard } = await import('@capacitor/keyboard');
      Keyboard.addListener('keyboardWillShow', (info) =>
        publishKeyboardHeight(info?.keyboardHeight || 0)
      );
      Keyboard.addListener('keyboardWillHide', () => publishKeyboardHeight(0));
    }
  } catch (err) {
    console.warn('[IWM] keyboard setup failed', err);
  }

  try {
    if (hasPlugin('App')) {
      const { App } = await import('@capacitor/app');
      if (isAndroid) App.addListener('backButton', onBackPress);

      App.addListener('appStateChange', ({ isActive }) => {
        if (isActive) {
          // Exported reports are transient; see clearExportCache.
          clearExportCache();
        }
      });
    }
  } catch (err) {
    console.warn('[IWM] app lifecycle setup failed', err);
  }
}

/**
 * Dismisses the splash screen.
 *
 * `launchAutoHide` is false in capacitor.config.json so the splash stays up
 * until the app says it is ready. That is deliberate: hiding on a timer shows
 * the user an empty dark shell while the session hydrates and the first
 * dashboard fetch is still in flight. Called once the shell has rendered.
 */
export async function hideSplash() {
  if (!isNative || !hasPlugin('SplashScreen')) return;
  try {
    const { SplashScreen } = await import('@capacitor/splash-screen');
    await SplashScreen.hide({ fadeOutDuration: 200 });
  } catch {
    /* already hidden */
  }
}
