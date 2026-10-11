// =============================================================================
// IWM — Opening a link outside the app
// =============================================================================
//
// `target="_blank"` has no meaning in a Capacitor WebView: there is no second
// tab to open. Left alone, the link either does nothing or — worse — navigates
// the WebView itself, so the app is replaced by a website with no way back and
// no address bar. That is both a dead end for the user and the shape of attack
// the app-bound-domain rules exist to stop.
//
// Natively these go to the system in-app browser: a Chrome Custom Tab on
// Android, SFSafariViewController on iOS. Both show the real URL and a done
// button, keep their cookie jar separate from the app WebView, and hand
// control back when dismissed. Apple's review guidelines expect external web
// content to be presented this way rather than inside the app's own WebView,
// and it is what a user means by "open the scale configuration tool".
// =============================================================================

import { isNative, hasPlugin } from './platform.js';

const TOOLBAR_COLOR = '#0F172A';

/**
 * Opens `url` outside the app shell.
 *
 * Only http(s) is allowed through. The href comes from our own nav config
 * today, but this is the one place in the app that hands a string to the
 * platform's URL opener, and that is worth keeping narrow — `javascript:`,
 * `data:` and `intent:` URLs all do something unwelcome when passed to a
 * system handler, and a future caller may be passing a value from the API.
 */
export async function openExternal(url) {
  let parsed;
  try {
    parsed = new URL(String(url));
  } catch {
    console.warn('[IWM] refusing to open a malformed URL', url);
    return false;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    console.warn('[IWM] refusing to open a non-http(s) URL', parsed.protocol);
    return false;
  }

  if (isNative && hasPlugin('Browser')) {
    const { Browser } = await import('@capacitor/browser');
    await Browser.open({
      url: parsed.href,
      presentationStyle: 'popover',
      toolbarColor: TOOLBAR_COLOR,
    });
    return true;
  }

  // noopener matters on the web: without it the opened page gets a handle on
  // window.opener and can navigate this tab somewhere else.
  window.open(parsed.href, '_blank', 'noopener,noreferrer');
  return true;
}
