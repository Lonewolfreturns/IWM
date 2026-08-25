// Starts the Vite dev server over HTTPS.
//
// Exists because Chrome refuses downloads started by a page on a non-trustworthy
// origin: http://localhost is fine, http://192.168.x.x is not. Reaching this dev
// server over the LAN therefore turned every generated report into "Insecure
// download blocked". TLS fixes the origin; nothing in the export code can.
//
// A launcher script rather than an inline npm script because `VAR=value cmd` is
// not valid on Windows cmd or PowerShell, and this repo is developed on Windows.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

/**
 * Vite's entry, to be run through node directly.
 *
 * Not `spawn('vite')`: on Windows that resolves to a .cmd shim, which Node
 * refuses to spawn without shell:true — and turning the shell on merely to
 * launch a dev server invites quoting bugs.
 *
 * Not `require.resolve('vite/bin/vite.js')` either: Vite's package `exports`
 * map does not expose the bin path, so that throws ERR_PACKAGE_PATH_NOT_EXPORTED.
 * The package.json is exported, so its directory is the reliable anchor.
 */
function resolveViteBin() {
  try {
    const pkg = require.resolve('vite/package.json');
    const candidate = path.join(path.dirname(pkg), 'bin', 'vite.js');
    if (existsSync(candidate)) return candidate;
  } catch {
    // Fall through to the layout-based guess.
  }
  const fallback = path.join(here, '..', 'node_modules', 'vite', 'bin', 'vite.js');
  if (existsSync(fallback)) return fallback;
  throw new Error('Could not locate Vite. Run `npm install` in frontend/ first.');
}

const port = process.env.PORT || '3000';

const vite = spawn(
  process.execPath,
  [resolveViteBin(), '--host', '0.0.0.0', '--port', port],
  { stdio: 'inherit', env: { ...process.env, VITE_DEV_HTTPS: 'true' } }
);

vite.on('exit', (code) => process.exit(code ?? 0));
