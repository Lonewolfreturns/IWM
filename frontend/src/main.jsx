import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import App from './App.jsx';
import { TimeZoneProvider } from './lib/timeZonePreference.jsx';
import { hydrateSession } from './native/session.js';
import { initNativeShell, hideSplash } from './native/shell.js';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { refetchOnWindowFocus: false, staleTime: 60_000 },
  },
});

function Root() {
  return (
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <TimeZoneProvider>
            <App />
          </TimeZoneProvider>
          <Toaster
            position="top-right"
            theme="dark"
            richColors
            closeButton
            toastOptions={{
              classNames: {
                toast:
                  'bg-ink-800/95 border border-ink-600 text-slate-100 backdrop-blur-md',
              },
            }}
          />
        </BrowserRouter>
      </QueryClientProvider>
    </React.StrictMode>
  );
}

/*
 * The session is loaded BEFORE the first render, and nothing renders until it
 * resolves.
 *
 * Every auth check in the app is synchronous — `isAuthenticated()` in the
 * route guards, `getCurrentUser()` in the sidebar and on Reports, the axios
 * request interceptor attaching its header. On the web that was free, because
 * localStorage is synchronous. The native apps keep the token in the Keychain
 * and the Android Keystore, which are not.
 *
 * Rendering first and hydrating after would therefore mount every guard
 * against an empty session: a signed-in user would be bounced to the login
 * screen on each cold start and then jumped to the dashboard a frame later.
 * Blocking here costs one async read — single-digit milliseconds — and removes
 * the whole class of problem, which is why the splash screen is configured not
 * to auto-hide.
 */
async function start() {
  // Marks the platform on <html> first, so the very first paint already has
  // the right safe-area padding rather than reflowing into it.
  await initNativeShell();

  try {
    await hydrateSession();
  } catch (err) {
    // hydrateSession already falls back to localStorage internally, so this is
    // only reachable if even that threw. Start signed out rather than showing
    // a dead screen.
    console.error('[IWM] session hydrate failed, starting signed out', err);
  }

  ReactDOM.createRoot(document.getElementById('root')).render(<Root />);

  // Two frames, so the splash lifts onto a painted first screen instead of the
  // empty shell between mount and paint.
  requestAnimationFrame(() => requestAnimationFrame(hideSplash));
}

start();
