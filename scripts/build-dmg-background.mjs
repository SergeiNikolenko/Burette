#!/usr/bin/env node
// Builds the Finder background artwork used by scripts/create-dmg.sh.
//
// The geometry below mirrors the AppleScript in create-dmg.sh: the app icon is
// centred at (145, 205) and the Applications symlink at (515, 205). Keep both
// files in sync.
//
// Usage: node scripts/build-dmg-background.mjs

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SKY_PALETTE, encodePng, renderSkySupersampled } from './render-dmg-sky.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'packaging', 'dmg');

const W = 660;
// Finder tiles a background that is smaller than the view and crops one that is
// larger, and the content height depends on the title-bar height of the running
// macOS version (368pt on macOS 26 for the {100,100,760,500} window in
// create-dmg.sh). So the canvas overdraws to H and everything bottom-anchored is
// placed against H_VISIBLE, which is what the user actually sees.
const H = 400;
const H_VISIBLE = 368;

const APP_ICON = { x: 145, y: 205 };
const APPLICATIONS_ICON = { x: 515, y: 205 };

// Straight, on the icon centreline, spanning the gap between the two 104pt
// icons. Drawn as a single filled polygon rather than a stroked shaft plus a
// separate head, so there is no junction to misalign: `s` is the shaft's half
// thickness, `h` the head's half width and `L` its length.
const ARROW = { x0: 245, x1: 415, y: 205, s: 4, h: 12, L: 21 };

function arrowPath({ x0, x1, y, s, h, L }) {
  return [
    `M ${x0 + s} ${y - s}`,
    `L ${x1 - L} ${y - s}`,
    `L ${x1 - L} ${y - h}`,
    `L ${x1} ${y}`,
    `L ${x1 - L} ${y + h}`,
    `L ${x1 - L} ${y + s}`,
    `L ${x0 + s} ${y + s}`,
    `A ${s} ${s} 0 0 1 ${x0 + s} ${y - s}`,
    'Z',
  ].join(' ');
}

// The frame of the drift animation to freeze on: of the frames sampled, this one
// has the widest cloud bank, so both icons sit on cloud rather than on open sky.
const SKY_TIME = 95;

const TITLE_FONT = "'SF Pro Display','Helvetica Neue',Helvetica,sans-serif";
const BODY_FONT = "'SF Pro Text','Helvetica Neue',Helvetica,sans-serif";

/**
 * Inlines an RDKit-generated molecule drawing, flattened to white so it reads as
 * a faint contrail against the sky rather than a chemistry diagram.
 */
function molecule(name, { x, y, scale, opacity }) {
  const source = readFileSync(join(OUT_DIR, 'molecules', `${name}.svg`), 'utf8');
  const body = source
    .slice(source.indexOf('<!-- END OF HEADER -->') + '<!-- END OF HEADER -->'.length)
    .replace(/<\/svg>\s*$/, '')
    // RDKit only emits atom/bond colours as literal hex, so a blanket swap is
    // safe here and leaves `fill:none` on the bond paths untouched.
    .replace(/#[0-9A-Fa-f]{6}/g, '#ffffff')
    .replace(/stroke-width:2\.0px/g, 'stroke-width:2.4px');
  return `<g transform="translate(${x} ${y}) scale(${scale})" opacity="${opacity}">${body}</g>`;
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="labelHaze" gradientUnits="userSpaceOnUse" x1="0" y1="246" x2="0" y2="300">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0"/>
      <stop offset="55%" stop-color="#ffffff" stop-opacity="0.4"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
    <filter id="typeShadow" x="-20%" y="-40%" width="140%" height="200%">
      <feDropShadow dx="0" dy="1" stdDeviation="2.4" flood-color="#1d4a78" flood-opacity="0.45"/>
    </filter>
  </defs>

  <image xlink:href="sky.png" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="none"/>

  <g>
    ${molecule('caffeine', { x: -30, y: 2, scale: 0.78, opacity: 0.15 })}
    ${molecule('aspirin', { x: 468, y: -14, scale: 0.82, opacity: 0.14 })}
    ${molecule('dopamine', { x: -26, y: 214, scale: 0.76, opacity: 0.11 })}
    ${molecule('ibuprofen', { x: 466, y: 220, scale: 0.78, opacity: 0.11 })}
  </g>

  <!-- Finder paints the icon labels in the system label colour, which is dark in
       Light Mode, so this keeps the label strip bright wherever the frozen frame
       happens to leave open sky. -->
  <rect x="0" y="246" width="${W}" height="54" fill="url(#labelHaze)"/>

  <g filter="url(#typeShadow)">
    <text x="${W / 2}" y="52" text-anchor="middle" font-family="${TITLE_FONT}" font-size="23" font-weight="700" fill="#ffffff" letter-spacing="-0.3">Install Burette</text>
    <text x="${W / 2}" y="76" text-anchor="middle" font-family="${BODY_FONT}" font-size="13" font-weight="400" fill="#ffffff" fill-opacity="0.92">Drag Burette to the Applications folder</text>
  </g>

  <!-- The frozen frame puts the tip over a bright cloud, where a plain white
       fill loses its silhouette; the hairline defines the edge there and stays
       unobtrusive over open sky. -->
  <path d="${arrowPath(ARROW)}" fill="#ffffff" stroke="#2f6ea8" stroke-opacity="0.38" stroke-width="1" filter="url(#typeShadow)"/>

  <text x="${W - 20}" y="${H_VISIBLE - 16}" text-anchor="end" font-family="${BODY_FONT}" font-size="10" font-weight="400" fill="#ffffff" fill-opacity="0.72">macOS 12 or later</text>
</svg>
`;

mkdirSync(OUT_DIR, { recursive: true });

// The sky is authored at 2x; rsvg-convert downscales it for the 1x page.
process.stdout.write('Rendering sky... ');
const skyW = W * 2;
const skyH = H * 2;
writeFileSync(
  join(OUT_DIR, 'sky.png'),
  encodePng(skyW, skyH, renderSkySupersampled(skyW, skyH, SKY_TIME, SKY_PALETTE, 2)),
);
process.stdout.write('done\n');

const svgPath = join(OUT_DIR, 'background.svg');
writeFileSync(svgPath, svg);

// The two raster scales are only inputs to the TIFF, so they stay out of the
// repository: tiffutil packs them into one file that carries both, stamping the
// 2x page as HiDPI so Finder draws the background at 660x400 points on Retina.
const rasterDir = mkdtempSync(join(tmpdir(), 'burette-dmg-bg-'));
try {
  const pages = [1, 2].map((scale) => {
    const page = join(rasterDir, `background@${scale}x.png`);
    execFileSync('rsvg-convert', [
      svgPath,
      '--width', String(W * scale),
      '--height', String(H * scale),
      '--background-color', 'white',
      '-o', page,
    ]);
    return page;
  });
  execFileSync('tiffutil', ['-cathidpicheck', ...pages, '-out', join(OUT_DIR, 'background.tiff')]);
} finally {
  rmSync(rasterDir, { recursive: true, force: true });
}

console.log('Wrote packaging/dmg/sky.png, background.svg and background.tiff');
