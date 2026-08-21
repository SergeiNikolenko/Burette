#!/usr/bin/env node
// Builds the Finder background artwork used by scripts/create-dmg.sh.
//
// The geometry below mirrors the AppleScript in create-dmg.sh: a 660x348pt
// Finder content area with the app icon centred at (145, 205) and the
// Applications symlink at (515, 205). Keep both files in sync.
//
// Usage: node scripts/build-dmg-background.mjs

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'packaging', 'dmg');

const W = 660;
// Finder tiles a background that is smaller than the view and crops one that is
// larger, and the content height depends on the title-bar height of the running
// macOS version (368pt on macOS 26 for the {100,100,760,500} window below). So
// the canvas overdraws to H and everything bottom-anchored is placed against
// H_VISIBLE, which is what the user actually sees.
const H = 400;
const H_VISIBLE = 368;
const APP_ICON = { x: 145, y: 205 };
const APPLICATIONS_ICON = { x: 515, y: 205 };

const MOLECULE_INK = '#93aecd';
const TEXT_PRIMARY = '#1d2733';
const TEXT_SECONDARY = '#5f6d7f';
const TEXT_FOOTER = '#9aa8b9';
const ACCENT = '#af52de';

const TITLE_FONT = "'SF Pro Display','Helvetica Neue',Helvetica,sans-serif";
const BODY_FONT = "'SF Pro Text','Helvetica Neue',Helvetica,sans-serif";

const round = (value) => Number(value.toFixed(2));

function mulberry32(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A cumulus silhouette: a rounded slab with a run of lobes of varied radii
 * along its top. Emitted as one <g> so group opacity composites the union and
 * the overlaps leave no seams.
 */
function cloudShape({ cx, baseY, width, height, seed, fill, opacity = 1, filter, dy = 0 }) {
  const random = mulberry32(seed);
  const lobeCount = 5 + Math.floor(random() * 3);
  const shapes = [
    `<rect x="${round(cx - width / 2)}" y="${round(baseY + dy - height * 0.38)}" width="${round(width)}" height="${round(height * 0.38)}" rx="${round(height * 0.19)}"/>`,
  ];
  for (let i = 0; i < lobeCount; i += 1) {
    // Lobes peak in the middle of the cloud and taper toward both ends, which
    // is what reads as "cloud" instead of "row of circles".
    const t = (i + 0.5) / lobeCount;
    const taper = 0.45 + 0.55 * Math.sin(Math.PI * t) ** 0.8;
    const r = height * taper * (0.82 + random() * 0.36);
    const x = cx - width / 2 + width * t + (random() - 0.5) * width * 0.06;
    const y = baseY + dy - r * (0.72 + random() * 0.2);
    shapes.push(`<circle cx="${round(x)}" cy="${round(y)}" r="${round(r)}"/>`);
  }
  const attrs = [
    `fill="${fill}"`,
    opacity === 1 ? '' : `opacity="${opacity}"`,
    filter ? `filter="url(#${filter})"` : '',
  ]
    .filter(Boolean)
    .join(' ');
  return `<g ${attrs}>${shapes.join('')}</g>`;
}

/** A cloud plus the soft shadow under its belly that gives it volume. */
function cloud(spec) {
  return (
    cloudShape({
      ...spec,
      dy: spec.height * 0.26,
      width: spec.width * 0.92,
      height: spec.height * 0.92,
      fill: '#a3c1e4',
      opacity: (spec.opacity ?? 1) * 0.6,
      filter: 'soft',
    }) + cloudShape({ ...spec, fill: 'url(#cloudFill)', filter: 'crisp' })
  );
}

/**
 * Inlines an RDKit-generated molecule drawing, flattened to a single ink so it
 * reads as a faint vapour trail rather than a chemistry diagram.
 */
function molecule(name, { x, y, scale, opacity }) {
  const source = readFileSync(join(OUT_DIR, 'molecules', `${name}.svg`), 'utf8');
  const body = source
    .slice(source.indexOf('<!-- END OF HEADER -->') + '<!-- END OF HEADER -->'.length)
    .replace(/<\/svg>\s*$/, '')
    // RDKit only emits atom/bond colours as literal hex, so a blanket swap is
    // safe here and leaves `fill:none` on the bond paths untouched.
    .replace(/#[0-9A-Fa-f]{6}/g, MOLECULE_INK)
    .replace(/stroke-width:2\.0px/g, 'stroke-width:2.4px');
  return `<g transform="translate(${x} ${y}) scale(${scale})" opacity="${opacity}">${body}</g>`;
}

// Distinct clouds live in the upper band only: the strip around y=150..290 is
// where Finder paints the two 104pt icons and their labels, and it stays clear.
const skyClouds = [
  { cx: 72, baseY: 104, width: 168, height: 30, seed: 7, opacity: 0.95 },
  { cx: 600, baseY: 88, width: 150, height: 27, seed: 21, opacity: 0.9 },
  { cx: 366, baseY: 140, width: 150, height: 14, seed: 44, opacity: 0.7 },
  { cx: 214, baseY: 124, width: 104, height: 10, seed: 91, opacity: 0.5 },
];

// The bank the icons rest on. Kept low and wide so it brightens the label strip
// without competing with the icons themselves.
const bank = [
  // Anchored below the canvas so only the crowns show: the icons read as
  // resting on a bank rather than on a row of separate puffs.
  { cx: 90, baseY: 392, width: 380, height: 62, seed: 3, opacity: 1 },
  { cx: 560, baseY: 388, width: 380, height: 58, seed: 13, opacity: 1 },
  { cx: 330, baseY: 404, width: 340, height: 52, seed: 29, opacity: 0.9 },
  { cx: 330, baseY: 412, width: 700, height: 46, seed: 61, opacity: 0.8 },
];

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="sky" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="${H_VISIBLE}">
      <stop offset="0%" stop-color="#d3e6fa"/>
      <stop offset="46%" stop-color="#eaf3fd"/>
      <stop offset="78%" stop-color="#f9fcff"/>
      <stop offset="100%" stop-color="#ffffff"/>
    </linearGradient>
    <linearGradient id="cloudFill" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="${H_VISIBLE}">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="60%" stop-color="#ffffff"/>
      <stop offset="100%" stop-color="#f2f7fd"/>
    </linearGradient>
    <linearGradient id="mist" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0.55"/>
    </linearGradient>
    <radialGradient id="horizonGlow" cx="0.5" cy="0.72" r="0.6">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.75"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
    <filter id="crisp" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="0.6"/>
    </filter>
    <filter id="soft" x="-40%" y="-40%" width="180%" height="180%">
      <feGaussianBlur stdDeviation="6"/>
    </filter>
    <filter id="haze" x="-40%" y="-40%" width="180%" height="180%">
      <feGaussianBlur stdDeviation="16"/>
    </filter>
  </defs>

  <rect width="${W}" height="${H}" fill="url(#sky)"/>

  <g>
    ${molecule('caffeine', { x: -30, y: 2, scale: 0.78, opacity: 0.17 })}
    ${molecule('aspirin', { x: 468, y: -14, scale: 0.82, opacity: 0.15 })}
    ${molecule('dopamine', { x: -26, y: 214, scale: 0.76, opacity: 0.13 })}
    ${molecule('ibuprofen', { x: 466, y: 220, scale: 0.78, opacity: 0.13 })}
  </g>

  <g filter="url(#haze)" opacity="0.6">
    ${skyClouds.map((c) => cloudShape({ ...c, baseY: c.baseY + 20, width: c.width * 1.4, height: c.height * 1.5, fill: '#ffffff' })).join('\n    ')}
  </g>

  <rect width="${W}" height="${H_VISIBLE}" fill="url(#horizonGlow)"/>

  ${skyClouds.map((c) => cloud(c)).join('\n  ')}

  <rect x="0" y="${H_VISIBLE - 150}" width="${W}" height="${H - H_VISIBLE + 150}" fill="url(#mist)"/>
  ${bank.map((c) => cloud(c)).join('\n  ')}

  <text x="${W / 2}" y="52" text-anchor="middle" font-family="${TITLE_FONT}" font-size="23" font-weight="700" fill="${TEXT_PRIMARY}" letter-spacing="-0.3">Install Burette</text>
  <text x="${W / 2}" y="76" text-anchor="middle" font-family="${BODY_FONT}" font-size="13" font-weight="400" fill="${TEXT_SECONDARY}">Drag Burette to the Applications folder</text>

  <g stroke="${ACCENT}" fill="none" stroke-linecap="round">
    <path d="M ${APP_ICON.x + 96} ${APP_ICON.y + 6} Q ${W / 2} ${APP_ICON.y - 34} ${APPLICATIONS_ICON.x - 112} ${APP_ICON.y + 6}"
          stroke-width="3" stroke-dasharray="0 10" opacity="0.8"/>
    <path d="M ${APPLICATIONS_ICON.x - 121} ${APP_ICON.y - 2} L ${APPLICATIONS_ICON.x - 109} ${APP_ICON.y + 6} L ${APPLICATIONS_ICON.x - 121} ${APP_ICON.y + 14}"
          stroke-width="2.6" stroke-linejoin="round"/>
  </g>

  <text x="${W - 20}" y="${H_VISIBLE - 16}" text-anchor="end" font-family="${BODY_FONT}" font-size="10" font-weight="400" fill="${TEXT_FOOTER}">macOS 12 or later</text>
</svg>
`;

mkdirSync(OUT_DIR, { recursive: true });
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

console.log('Wrote packaging/dmg/background.svg and packaging/dmg/background.tiff');
