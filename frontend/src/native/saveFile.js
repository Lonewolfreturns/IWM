// =============================================================================
// IWM — Saving a generated file
// =============================================================================
//
// Reports builds its PDFs, workbooks and JSON entirely in the browser, then
// hands the resulting Blob to the platform to save. On the web that is an
// `<a download>` click. In a WebView it cannot be.
//
// WHY THE WEB PATH DOES NOT WORK NATIVELY
// ---------------------------------------
// `<a download>` asks the *browser* to write to a downloads folder. A Capacitor
// WebView has no downloads folder and no download manager: on iOS the click is
// a no-op, and on Android it either does nothing or opens a blob: URL the
// system cannot resolve. Every export in the app would silently fail, which is
// the kind of thing that passes review and then gets one-starred.
//
// So natively the Blob is written into the app's cache directory and handed to
// the system share sheet, which is where a phone user expects a generated file
// to go — Files, Drive, Mail, AirDrop, Print. The cache directory is used
// rather than Documents because these are transient artefacts: the OS may
// reclaim them, nothing in the app ever reads them back, and leaving a growing
// pile of old reports inside the app sandbox is its own problem. Anything the
// user actually wants to keep, they keep from the share sheet.
//
// No storage permission is involved on either platform. Writing inside the
// sandbox and sharing through a FileProvider is exactly the pattern that
// avoids asking for one, which matters: a declared storage permission on a
// dashboard app is a Play Console policy conversation we have no reason to
// have.
// =============================================================================

import { isNative, hasPlugin } from './platform.js';

/** Blob -> bare base64 (no data: prefix), which is what Filesystem expects. */
function toBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error('Could not read blob'));
    reader.onload = () => {
      const result = String(reader.result || '');
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.readAsDataURL(blob);
  });
}

function webDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Saves `blob` as `filename`, by whatever route the platform provides.
 *
 * Resolves `{ shared: boolean }` — false when the user dismissed the share
 * sheet, so a caller can skip its "export complete" toast. Rejects only when
 * the file could not be produced at all.
 */
export async function saveFile(blob, filename) {
  if (!isNative || !hasPlugin('Filesystem') || !hasPlugin('Share')) {
    webDownload(blob, filename);
    return { shared: true };
  }

  const [{ Filesystem, Directory }, { Share }] = await Promise.all([
    import('@capacitor/filesystem'),
    import('@capacitor/share'),
  ]);

  const data = await toBase64(blob);

  // Namespaced so the share sheet shows our files and nothing else, and so a
  // cleanup can target one directory.
  const dir = 'exports';
  try {
    await Filesystem.mkdir({ path: dir, directory: Directory.Cache, recursive: true });
  } catch {
    // Already there — mkdir rejects rather than being idempotent.
  }

  const path = `${dir}/${filename}`;
  await Filesystem.writeFile({ path, data, directory: Directory.Cache, recursive: true });
  const { uri } = await Filesystem.getUri({ path, directory: Directory.Cache });

  try {
    await Share.share({
      title: filename,
      // `files` is the only field that matters here. `text` and `url` are left
      // off on purpose: some targets (Mail, Messages) will attach the file AND
      // paste the text, which puts a stray filename in the message body.
      files: [uri],
      dialogTitle: 'Save or send report',
    });
    return { shared: true };
  } catch (err) {
    // Share rejects on dismissal with no distinguishing code, so a cancel and
    // a genuine failure look alike. Treated as a cancel: the file is written
    // either way, and a scary error on "I changed my mind" is worse than
    // staying quiet.
    return { shared: false, reason: err?.message };
  }
}

/**
 * Deletes previously-exported files.
 *
 * The OS clears the cache directory under pressure, but not promptly, and a
 * month of daily reports is tens of megabytes of "Documents & Data" the user
 * cannot explain. Called on app resume.
 */
export async function clearExportCache() {
  if (!isNative || !hasPlugin('Filesystem')) return;
  try {
    const { Filesystem, Directory } = await import('@capacitor/filesystem');
    await Filesystem.rmdir({
      path: 'exports',
      directory: Directory.Cache,
      recursive: true,
    });
  } catch {
    // Nothing exported yet, or already gone.
  }
}
