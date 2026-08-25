import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';
import path from 'path';

// Vite config for WasteWise.
// Dev server runs on 0.0.0.0:3000 so it is reachable from other devices on the
// LAN. HMR is left at its default, which derives host/port/protocol from the
// URL the page was loaded over.
//
// HTTPS (npm run dev:https)
// -------------------------
// Chrome only lets a page start a download if its origin is "potentially
// trustworthy". http://localhost qualifies; http://192.168.x.x does not — so
// reaching this server over the LAN made every generated report come back as
// "Insecure download blocked", which is a property of the origin and cannot be
// fixed from the export code.
//
// Serving over TLS makes the LAN origin trustworthy and the downloads work.
// The certificate is self-signed, so a browser shows a one-time interstitial;
// accepting it is what promotes the origin. Left opt-in rather than default,
// because anyone working on http://localhost is already on a secure origin and
// should not be made to click through a certificate warning for nothing.
const useHttps = process.env.VITE_DEV_HTTPS === 'true';

export default defineConfig({
  plugins: [react(), ...(useHttps ? [basicSsl()] : [])],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 3000,
    strictPort: true,
    allowedHosts: true,
    watch: {
      usePolling: true,
      interval: 800,
    },
  },
  preview: {
    host: '0.0.0.0',
    port: 3000,
  },
  build: {
    outDir: 'build',
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
  },
});
