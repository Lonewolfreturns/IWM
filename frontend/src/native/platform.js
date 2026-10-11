// =============================================================================
// IWM — Platform detection
// =============================================================================
//
// One source of truth for "am I inside the native app or a browser tab?".
//
// The same React bundle ships three ways: served from nginx at foodloss.ca,
// embedded in the Android APK, and embedded in the iOS app. Almost all of the
// app is identical across the three, but a handful of things cannot be —
// saving a file, opening an external link, where the session is kept, what the
// hardware back button does. Each of those branches on the helpers here rather
// than sniffing the user agent at the call site.
//
// Capacitor injects `window.Capacitor` before any app code runs, and
// `isNativePlatform()` is false for the web build even though the package is
// bundled, so these are safe to call unconditionally.
// =============================================================================

import { Capacitor } from '@capacitor/core';

/** True inside the Android or iOS app; false in any browser. */
export const isNative = Capacitor.isNativePlatform();

/** 'android' | 'ios' | 'web' */
export const platform = Capacitor.getPlatform();

export const isAndroid = platform === 'android';
export const isIOS = platform === 'ios';
export const isWeb = !isNative;

/**
 * Whether a Capacitor plugin is actually available to call.
 *
 * A plugin bundled in JS is not necessarily registered natively — an older
 * installed build of the app will not have a plugin added to the project since
 * it shipped. Calling into a missing one throws, which on the web build would
 * take out whatever render triggered it. Every native call in this folder is
 * gated on this, so a missing plugin degrades to the web behaviour instead.
 */
export function hasPlugin(name) {
  try {
    return Capacitor.isPluginAvailable(name);
  } catch {
    return false;
  }
}
