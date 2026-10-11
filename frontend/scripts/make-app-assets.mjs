/**
 * Generates the source artwork that @capacitor/assets expands into every
 * Android and iOS icon and splash size.
 *
 * Run:  node scripts/make-app-assets.mjs && npx capacitor-assets generate
 *
 * WHY THE ART IS BUILT HERE RATHER THAN CHECKED IN
 * ------------------------------------------------
 * The only brand asset in the repo is public/favicon.svg at 64x64. Scaling a
 * 64px raster to the 1024px an app icon needs gives a soft, obviously-upscaled
 * mark, and store review does notice. Redrawing the same geometry as vectors at
 * the target size keeps it crisp, and keeps the icon and the favicon from
 * drifting apart — both are generated from the one path definition below.
 *
 * THE THREE ICONS ARE NOT THE SAME IMAGE
 * --------------------------------------
 * - icon.png          Full-bleed, square, NO transparency and NO rounded
 *                     corners. iOS applies its own mask; a pre-rounded icon
 *                     gets rounded twice and ends up with dark corner fringes,
 *                     and an alpha channel is rejected outright at upload.
 * - icon-foreground   Android adaptive icons are cropped to an arbitrary shape
 *                     chosen by the launcher, and the system animates them, so
 *                     only the middle ~66% is guaranteed visible. The mark is
 *                     drawn smaller here to sit inside that safe zone.
 * - icon-background   The layer behind it. Flat brand navy: a gradient here
 *                     shifts visibly as the launcher parallaxes the layers.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, '..', 'assets');
mkdirSync(out, { recursive: true });

const NAVY = '#0F172A';

/*
 * The IWM mark: a leaf/droplet with a centre vein, on the sky-to-leaf gradient.
 * Matches public/favicon.svg, expressed in the same 64-unit box so the
 * original path data carries over unchanged.
 *
 * The mark does NOT fill its box. Its ink runs x:[20,44] and y:[12,46] — 24
 * wide by 34 tall inside a 64x64 viewBox, and centred on (32, 29) rather than
 * (32, 32). Scaling the box instead of the ink is what made the first run come
 * out at roughly a quarter of the canvas: 62% of the box is only 33% of the
 * icon once three quarters of that box is empty. `fraction` below is a
 * fraction of the CANVAS that the ink should occupy, measured on its longer
 * axis, which is what you actually want to specify.
 */
const INK = { w: 24, h: 34, cx: 32, cy: 29 };

const mark = (fraction, canvas) => {
  const scale = (canvas * fraction) / INK.h;
  const c = canvas / 2;
  return `
  <g transform="translate(${c} ${c}) scale(${scale}) translate(${-INK.cx} ${-INK.cy})">
    <path d="M32 12c-3 8-12 10-12 22a12 12 0 0024 0c0-12-9-14-12-22z" fill="url(#g)"/>
    <path d="M32 18v22" stroke="${NAVY}" stroke-width="2" stroke-linecap="round"/>
  </g>`;
};

const gradient = `
  <defs>
    <linearGradient id="g" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0" stop-color="#38BDF8"/>
      <stop offset="1" stop-color="#22C55E"/>
    </linearGradient>
  </defs>`;

function svg(size, body, bg = NAVY) {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      ${gradient}
      <rect width="${size}" height="${size}" fill="${bg}"/>
      ${body}
    </svg>`
  );
}

// Each entry is [filename, size, svg]. `flatten` removes the alpha channel —
// required for the iOS icon and harmless for the rest.
const ICON = 1024;
const SPLASH = 2732;

const files = [
  // Full-bleed icon. 58% leaves the margin Apple's own icons carry once their
  // corner mask is applied; much larger and the mark crowds the rounding.
  ['icon.png', ICON, svg(ICON, mark(0.58, ICON))],

  // Adaptive foreground. An Android launcher crops this to a shape of its
  // choosing and parallaxes it, so only the middle 66% is guaranteed to
  // survive. 40% keeps the mark comfortably inside that, with room for the
  // shift.
  ['icon-foreground.png', ICON, svg(ICON, mark(0.4, ICON), 'none')],
  ['icon-background.png', ICON, svg(ICON, '')],

  // Splash. The canvas is square and far larger than any screen because
  // @capacitor/assets centre-crops it per device aspect ratio; the mark stays
  // small so it survives the tightest crop without touching an edge.
  ['splash.png', SPLASH, svg(SPLASH, mark(0.2, SPLASH))],
  // The app is dark-only, so the dark splash is the same image rather than a
  // light variant. It has to exist or the generator warns on every run.
  ['splash-dark.png', SPLASH, svg(SPLASH, mark(0.2, SPLASH))],
];

for (const [name, size, source] of files) {
  const keepAlpha = name === 'icon-foreground.png';
  let pipeline = sharp(source, { density: 400 }).resize(size, size);
  if (!keepAlpha) pipeline = pipeline.flatten({ background: NAVY });
  await pipeline.png({ compressionLevel: 9 }).toFile(resolve(out, name));
  console.log(`  ${name.padEnd(22)} ${size}x${size}${keepAlpha ? '  (alpha kept)' : ''}`);
}

console.log('\nSource art written to frontend/assets/.');
console.log('Now run:  npx capacitor-assets generate');
