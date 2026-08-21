// CPU port of the hero cloud shader from the burette-landing repo
// (`initSky()` in its index.html, vendored from MAKI / Aceternity UI), so the
// installer sky is the same sky as the website without a WebGL context in the
// build. Rendering one frozen frame on the CPU keeps the artwork reproducible
// from `node scripts/build-dmg-background.mjs` alone.
//
// The noise will not match the GPU bit for bit: `fract(sin(x) * 26737.367)` is
// precision-sensitive and highp float is 32-bit where JavaScript is double. The
// palette, structure and light model are the shader's.

import zlib from 'node:zlib';

const hex = (value) => [
  parseInt(value.slice(1, 3), 16) / 255,
  parseInt(value.slice(3, 5), 16) / 255,
  parseInt(value.slice(5, 7), 16) / 255,
];

// MAKI's own defaults for the component. The cloud shading mixes the sky colour
// into the shadow side (`shadow = mix(cloud * 0.60, sky, 0.38)`), so a saturated
// sky is what makes the clouds read as volumes. burette-landing overrides these
// with an achromatic pair, which flattens the clouds to near-invisible on white.
export const SKY_PALETTE = {
  cloud: hex('#fbf8f2'),
  top: hex('#3876ba'),
  bottom: hex('#8cbfe8'),
};

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const mix = (a, b, t) => a + (b - a) * t;
const fract = (x) => x - Math.floor(x);

function smoothstep(edge0, edge1, x) {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

const hash = (x, y) => fract(Math.sin(x * 41.31 + y * 289.17) * 26737.367);

function vnoise(x, y) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  let fx = x - ix;
  let fy = y - iy;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy);
  const b = hash(ix + 1, iy);
  const c = hash(ix, iy + 1);
  const d = hash(ix + 1, iy + 1);
  return mix(mix(a, b, fx), mix(c, d, fx), fy);
}

// const mat2 R = mat2(0.80, 0.60, -0.60, 0.80), column-major: R * p is
// (0.80x - 0.60y, 0.60x + 0.80y).
function fbm(x, y) {
  let s = 0;
  let a = 0.5;
  for (let i = 0; i < 4; i += 1) {
    s += a * vnoise(x, y);
    const rx = 0.8 * x - 0.6 * y;
    const ry = 0.6 * x + 0.8 * y;
    x = rx * 2.03 + 19.19;
    y = ry * 2.03 + 19.19;
    a *= 0.5;
  }
  return s;
}

function billow(x, y) {
  let s = 0;
  let a = 0.5;
  for (let i = 0; i < 5; i += 1) {
    s += a * (1 - Math.abs(2 * vnoise(x, y) - 1));
    const rx = 0.8 * x - 0.6 * y;
    const ry = 0.6 * x + 0.8 * y;
    x = rx * 2.11 + 13.37;
    y = ry * 2.11 + 13.37;
    a *= 0.5;
  }
  return s;
}

function cloudDensity(px, py, cx, cy, rx, ry0, seed, t) {
  const qx = px - cx;
  const qy = py - cy;
  const ry = qy > 0 ? ry0 : ry0 * 0.42;
  const nx = qx / rx;
  const ny = qy / ry;
  const env = 1 - Math.hypot(nx, ny);
  if (env < -0.35) return 0;
  const k = 2.4 / rx;
  let dx = qx * k + seed;
  let dy = qy * k + seed;
  // Both warp components read the same, unmodified dp in the shader.
  const warpX = fbm(dx * 1.4 + t * 0.04, dy * 1.4 + t * 0.04);
  const warpY = fbm(dx * 1.4 + 7.7 - t * 0.03, dy * 1.4 + 7.7 - t * 0.03);
  dx += 0.6 * warpX;
  dy += 0.6 * warpY;
  const detail = billow(dx * 1.6, dy * 1.6);
  return env + (detail - 0.62) * 0.62;
}

function shadeCloud(color, sky, px, py, cx, cy, rx, ry, seed, t, dist, cloudRgb) {
  const d = cloudDensity(px, py, cx, cy, rx, ry, seed, t);
  if (d < 0.02) return;
  const dUp = cloudDensity(px, py + ry * 0.55, cx, cy, rx, ry, seed, t);
  const occl = clamp01((dUp - d) * 1.1 + d * 0.55);
  let alpha = smoothstep(0.02, 0.38, d);
  const rim = smoothstep(0.02, 0.14, d) * (1 - smoothstep(0.14, 0.4, d));
  alpha *= mix(1, 0.8, dist);
  for (let i = 0; i < 3; i += 1) {
    const lit = cloudRgb[i] * 1.04;
    const shadow = mix(cloudRgb[i] * 0.6, sky[i], 0.38);
    let value = mix(lit, shadow, occl * 0.85) + rim * 0.1;
    value = mix(value, sky[i], dist * 0.35);
    color[i] = mix(color[i], value, alpha);
  }
}

// speed, phase, y, rx, ry, seed, distance — the six passes from the shader, far
// and small at the top down to near and wide at the bottom.
const PASSES = [
  [0.006, 0.1, 0.84, 0.2, 0.1, 43.7, 1.0],
  [0.008, 0.62, 0.73, 0.24, 0.12, 71.3, 0.85],
  [0.011, 0.33, 0.6, 0.34, 0.16, 17.3, 0.55],
  [0.013, 0.8, 0.47, 0.3, 0.15, 29.9, 0.45],
  [0.016, 0.05, 0.35, 0.46, 0.2, 91.1, 0.15],
  [0.02, 0.48, 0.2, 0.56, 0.24, 57.2, 0.0],
];

/** Renders one frozen frame as a packed RGB buffer, top row first. */
export function renderSky(width, height, time, palette = SKY_PALETTE) {
  const out = Buffer.alloc(width * height * 3);
  const aspect = width / height;
  const sky = [0, 0, 0];
  const color = [0, 0, 0];
  const centres = PASSES.map(([spd, phase, y, rx]) => [
    mix(-rx - 0.25, aspect + rx + 0.25, fract(time * spd + phase)),
    y + Math.sin(time * 0.05 + phase * 6.2831) * 0.012,
  ]);

  for (let row = 0; row < height; row += 1) {
    // gl_FragCoord.y counts up from the bottom, the raster counts down.
    const uvy = (height - 1 - row + 0.5) / height;
    const cirrusBand = smoothstep(0.55, 0.8, uvy) * (1 - smoothstep(0.9, 1.0, uvy));
    for (let col = 0; col < width; col += 1) {
      const uvx = (col + 0.5) / width;
      const px = uvx * aspect;
      const py = uvy;
      for (let i = 0; i < 3; i += 1) {
        sky[i] = mix(palette.bottom[i], palette.top[i], uvy);
        color[i] = mix(sky[i], palette.bottom[i] * 1.06, smoothstep(0.35, 0.0, uvy) * 0.5);
      }

      const sunDx = px - aspect * 0.78;
      const sunDy = py - 0.92;
      const sun = Math.exp(-(sunDx * sunDx + sunDy * sunDy) * 5.0) * 0.28;
      color[0] += 1.0 * sun;
      color[1] += 0.95 * sun;
      color[2] += 0.82 * sun;

      if (cirrusBand > 0.01) {
        const streak = fbm(px * 1.6 - time * 0.006, py * 12.0);
        const w = smoothstep(0.52, 0.78, streak) * cirrusBand * 0.35;
        for (let i = 0; i < 3; i += 1) color[i] = mix(color[i], palette.cloud[i] * 0.98, w);
      }

      for (let pass = 0; pass < PASSES.length; pass += 1) {
        const [, , , rx, ry, seed, dist] = PASSES[pass];
        const [cx, cy] = centres[pass];
        shadeCloud(color, sky, px, py, cx, cy, rx, ry, seed, time, dist, palette.cloud);
      }

      const o = (row * width + col) * 3;
      out[o] = Math.round(clamp01(color[0]) * 255);
      out[o + 1] = Math.round(clamp01(color[1]) * 255);
      out[o + 2] = Math.round(clamp01(color[2]) * 255);
    }
  }
  return out;
}

/**
 * Renders at `supersample` times the target and box-averages down. The cloud
 * envelope is a hard threshold on noise, so without this the silhouettes come
 * out visibly aliased — the GPU version hides it under animation, a still frame
 * does not.
 */
export function renderSkySupersampled(width, height, time, palette = SKY_PALETTE, supersample = 3) {
  const s = supersample;
  const big = renderSky(width * s, height * s, time, palette);
  const out = Buffer.alloc(width * height * 3);
  const area = s * s;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let dy = 0; dy < s; dy += 1) {
        let o = ((y * s + dy) * width * s + x * s) * 3;
        for (let dx = 0; dx < s; dx += 1) {
          r += big[o];
          g += big[o + 1];
          b += big[o + 2];
          o += 3;
        }
      }
      const t = (y * width + x) * 3;
      out[t] = Math.round(r / area);
      out[t + 1] = Math.round(g / area);
      out[t + 2] = Math.round(b / area);
    }
  }
  return out;
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = -1;
  for (let i = 0; i < buffer.length; i += 1) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/** Minimal 8-bit RGB PNG writer, Paeth-filtered so the gradients compress. */
export function encodePng(width, height, rgb) {
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const o = y * (stride + 1);
    raw[o] = 4; // Paeth
    for (let x = 0; x < stride; x += 1) {
      const a = x >= 3 ? rgb[y * stride + x - 3] : 0;
      const b = y > 0 ? rgb[(y - 1) * stride + x] : 0;
      const c = x >= 3 && y > 0 ? rgb[(y - 1) * stride + x - 3] : 0;
      const p = a + b - c;
      const pa = Math.abs(p - a);
      const pb = Math.abs(p - b);
      const pc = Math.abs(p - c);
      const pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      raw[o + 1 + x] = (rgb[y * stride + x] - pred) & 0xff;
    }
  }

  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length, 0);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body), 0);
    return Buffer.concat([length, body, crc]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
