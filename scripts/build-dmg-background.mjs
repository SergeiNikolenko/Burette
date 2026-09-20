#!/usr/bin/env node
// Finder draws the real, draggable app over its position in the Dock photograph.
// Keep the icon centres in sync with scripts/create-dmg.sh.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'packaging/dmg');
const width = 356;
const height = 520;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="356" height="520" viewBox="0 0 356 520">
  <defs>
    <clipPath id="hero"><rect width="356" height="248"/></clipPath>
    <linearGradient id="glass" x2="0.7" y2="1">
      <stop stop-color="#464646"/><stop offset="1" stop-color="#626262"/>
    </linearGradient>
    <radialGradient id="glow"><stop stop-color="#96ddff" stop-opacity=".27"/><stop offset="1" stop-color="#96ddff" stop-opacity="0"/></radialGradient>
    <radialGradient id="spotlight" cx="50%" cy="76%" r="76%">
      <stop stop-color="#000000" stop-opacity="0"/><stop offset="1" stop-color="#000000" stop-opacity=".64"/>
    </radialGradient>
    <filter id="grain" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency=".85" numOctaves="3" stitchTiles="stitch"/>
      <feColorMatrix type="saturate" values="0"/>
    </filter>
    <filter id="cloudShade" color-interpolation-filters="sRGB">
      <feColorMatrix type="matrix" values=".04 .04 .04 0 0  .04 .04 .04 0 0  .04 .04 .04 0 0  0 0 0 1 0"/>
      <feGaussianBlur stdDeviation="5"/>
    </filter>
    <filter id="halo" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="8"/></filter>
    <filter id="soft"><feGaussianBlur stdDeviation="3"/></filter>
  </defs>
  <rect width="356" height="520" fill="url(#glass)"/>
  <image xlink:href="dock-reference.png" x="-36" y="-41" width="468" height="314" clip-path="url(#hero)"/>
  <rect width="356" height="248" fill="url(#spotlight)"/>
  <rect x="119" y="125" width="118" height="118" rx="30" fill="none" stroke="#42baff" stroke-width="5" opacity=".22" filter="url(#halo)"/>
  <image xlink:href="sky.png" x="0" y="248" width="356" height="272" preserveAspectRatio="xMidYMid slice" filter="url(#cloudShade)" opacity=".12"/>
  <rect y="248" width="356" height="272" filter="url(#grain)" opacity=".065"/>
  <path d="M0 248H356" stroke="#ffffff" stroke-opacity=".22"/>
  <ellipse cx="178" cy="306" rx="42" ry="30" fill="url(#glow)"/>
  <g fill="none" stroke="#8ed9ff" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round">
    <path d="m168 286 10 10 10-10" opacity=".2"/>
    <path d="m168 298 10 10 10-10" opacity=".5"/>
    <path d="m168 310 10 10 10-10"/>
    <path d="m168 310 10 10 10-10" filter="url(#soft)" opacity=".6"/>
  </g>
</svg>\n`;
const svgPath = join(out, 'background.svg');
writeFileSync(svgPath, svg);
const temporary = mkdtempSync(join(tmpdir(), 'burette-dmg-bg-'));
try {
  const pages = [1, 2].map(scale => {
    const page = join(temporary, `background@${scale}x.png`);
    execFileSync('rsvg-convert', [svgPath, '--width', String(width * scale), '--height', String(height * scale), '-o', page]);
    return page;
  });
  execFileSync('tiffutil', ['-cathidpicheck', ...pages, '-out', join(out, 'background.tiff')]);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
console.log('Wrote vertical Dock background.svg and Retina background.tiff');
