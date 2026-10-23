// The first-launch opening in one fragment shader: three electrons draw their
// orbits around the nucleus, the atom flashes and blooms into the window, then
// shrinks into the logo above the title. Coordinates are window-centred and
// normalised by the window width (x in [-.5, .5], y up), so every size is a
// fraction of the width and the scene scales with any window.

/** Seconds into the opening at which the native window changes. */
export const ATOM_CUE = { chrome: 4.7, undim: 5.2, undimFor: 1.0, settle: 6.3, end: 7.5 } as const;
/** The welcome line and the button that hands over to the app. */
export const ATOM_TITLE = { start: 5.6, size: 0.046, y: 0.066 } as const;
export const ATOM_ACTION = { start: 6.6, y: 0.133 } as const;

export const clamp = (x: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));
export const range = (t: number, start: number, end: number) => clamp((t - start) / (end - start));

const bezier = (x1: number, y1: number, x2: number, y2: number) => {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sampleX = (u: number) => ((ax * u + bx) * u + cx) * u;
  const sampleY = (u: number) => ((ay * u + by) * u + cy) * u;
  return (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let lo = 0, hi = 1, u = x;
    for (let i = 0; i < 28; i++) {
      const v = sampleX(u);
      if (Math.abs(v - x) < 1e-6) break;
      if (v < x) lo = u;
      else hi = u;
      u = (lo + hi) / 2;
    }
    return sampleY(u);
  };
};

/** Long, calm deceleration used for arrivals. */
export const easeOut = bezier(0.16, 1, 0.3, 1);
/** Symmetric ease for state changes on screen. */
export const easeInOut = bezier(0.65, 0, 0.35, 1);

/** SwiftUI-style spring(duration:bounce:) in closed form, so each frame is a pure function of time. */
export const spring = (t: number, duration = 0.6, bounce = 0.26) => {
  if (t <= 0) return 0;
  const zeta = 1 - bounce;
  const w0 = (2 * Math.PI) / duration;
  if (zeta >= 1) return 1 - (1 + w0 * t) * Math.exp(-w0 * t);
  const wd = w0 * Math.sqrt(1 - zeta * zeta);
  return 1 - Math.exp(-zeta * w0 * t) * (Math.cos(wd * t) + ((zeta * w0) / wd) * Math.sin(wd * t));
};

const pulse = (t: number, at: number, width: number) => Math.exp(-(((t - at) / width) ** 2));

const TAU = Math.PI * 2;
const ORBIT_START = [0.85, 1.05, 1.25];

/**
 * Angle travelled by an electron: it launches softly, completes its first
 * orbit in about 1.3 s while drawing it, then settles into a calm revolution.
 */
const travel = (s: number) => {
  if (s <= 0) return 0;
  const fast = TAU / 1.2, slow = TAU / 6.5, a = 0.12, turn = 1.35, tau = 0.8;
  if (s < turn) return fast * (s - a * (1 - Math.exp(-s / a)));
  const atTurn = fast * (turn - a * (1 - Math.exp(-turn / a)));
  const x = s - turn;
  return atTurn + slow * x + (fast - slow) * tau * (1 - Math.exp(-x / tau));
};

/** Shader inputs at time `t`: nucleus, ink, bloom, settle, flash and each electron's travel. */
export const atomParams = (t: number) => [
  easeOut(range(t, 0.35, 1.2)),
  easeInOut(range(t, 3.8, 5.0)),
  easeInOut(range(t, 3.15, 4.6)),
  easeInOut(range(t, 4.0, 5.6)),
  pulse(t, 3.25, 0.4),
  ...ORBIT_START.map((start) => travel(t - start)),
];

/** sRGB hex as a linear-light GLSL vec3: the shader mixes light linearly. */
const linear = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  const channels = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.pow(v / 255, 2.2).toFixed(5));
  return `vec3(${channels.join(",")})`;
};
/** A colour for the light theme and its counterpart for the dark one. */
const themed = (light: string, dark: string) => `themed(${linear(light)}, ${linear(dark)})`;

export const vertexShader = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2. - 1., 0., 1.);
}`;

const prelude = `#version 300 es
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform vec4 uA;
uniform vec4 uB;
// 0 in the light theme, 1 in the dark one.
uniform float uDark;
out vec4 fragColor;
const float PI = 3.14159265359;

vec3 themed(vec3 light, vec3 dark) { return mix(light, dark, uDark); }
float themed(float light, float dark) { return mix(light, dark, uDark); }
vec2 uvw() { return (gl_FragCoord.xy - .5 * uRes) / uRes.x; }
float pixel() { return 1. / uRes.x; }
float halfH() { return .5 * uRes.y / uRes.x; }

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * .1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy) * 2. - 1.;
}
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * f * (f * (f * 6. - 15.) + 10.);
  return mix(
    mix(dot(hash22(i), f), dot(hash22(i + vec2(1, 0)), f - vec2(1, 0)), u.x),
    mix(dot(hash22(i + vec2(0, 1)), f - vec2(0, 1)), dot(hash22(i + vec2(1, 1)), f - vec2(1, 1)), u.x),
    u.y);
}
mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, s, -s, c); }
// Mesh-gradient building blocks: soft colour pools and a slow, large warp.
float blob(vec2 p, vec2 c, float r) { vec2 d = p - c; return exp(-dot(d, d) / (r * r)); }
vec2 warp(vec2 p, float t, float amount) {
  return p + amount * vec2(noise(p * 1.6 + vec2(t * .07, 1.3)), noise(p * 1.6 + vec2(4.1, -t * .06)));
}
float sdRoundRect(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.)) + min(max(q.x, q.y), 0.) - r;
}
// Distance to an ellipse, accurate close to the curve (enough for strokes).
float sdEllipse(vec2 p, vec2 ab) {
  float k0 = length(p / ab);
  float k1 = length(p / (ab * ab));
  return k0 * (k0 - 1.) / max(k1, 1e-6);
}
vec3 tonemap(vec3 c) { return 1. - exp(-c); }

// Premultiplied linear colour (light added over the desktop) and coverage,
// written as dithered, premultiplied sRGB.
void emitPremul(vec3 premul, float a) {
  a = clamp(a, 0., 1.);
  vec3 c = pow(a > 1e-4 ? clamp(premul / a, 0., 1.) : vec3(0.), vec3(1. / 2.2));
  float n = hash12(gl_FragCoord.xy + fract(uTime * 7.31) * 113.) + hash12(gl_FragCoord.yx * 1.37 + 17.) - 1.;
  fragColor = vec4(clamp(c + n / 255., 0., 1.) * a, a);
}
`;

// Morning window: airy sky, lilac, peach and cream pools around a light centre;
// in the dark theme the same pools glow deep on near-black.
const dawnField = `
vec3 dawnField(vec2 p, float t) {
  p = warp(p, t, .08);
  vec3 col = ${themed("#eeebf8", "#0c0c11")};
  col = mix(col, ${themed("#b3c9fb", "#142037")}, blob(p, vec2(-.3 + .08 * sin(t * .17), .15 + .06 * cos(t * .13)), .32) * .9);
  col = mix(col, ${themed("#cfbaf8", "#1f1836")}, blob(p, vec2(.28 + .08 * sin(t * .15 + 2.), .19 + .05 * cos(t * .2 + 1.)), .3) * .85);
  col = mix(col, ${themed("#ffcbb4", "#2d1b1b")}, blob(p, vec2(.22 + .1 * sin(t * .12 + 4.), -.2 + .05 * cos(t * .16)), .3) * .9);
  col = mix(col, ${themed("#fde6c0", "#282115")}, blob(p, vec2(-.25 + .1 * sin(t * .18 + 1.), -.24 + .04 * cos(t * .14 + 3.)), .27) * .85);
  return mix(col, ${themed("#f8f6fd", "#121218")}, blob(p, vec2(0., .01), .2) * .55);
}
`;

const atom = `
const vec3 THETA0 = vec3(.3, 2.4, 4.5);
// Each orbit glows in one dawn colour over the dark desktop and keeps a deeper
// shade of it for the comet behind its electron once printed on the window.
const vec3 GLOW[3] = vec3[3](${linear("#ffc0a3")}, ${linear("#cdb8ff")}, ${linear("#a9c6ff")});
const vec3 DEEP[3] = vec3[3](${linear("#e5704f")}, ${linear("#7b5cf0")}, ${linear("#3f7ef2")});
const vec3 INK = ${linear("#1a1b26")};

void main() {
  vec2 p = uvw();
  float t = uTime, H = halfH(), pix = pixel();
  float nucleus = uA.x, ink = uA.y, bloom = uA.z, settle = uA.w, flash = uB.x;
  vec3 trav = uB.yzw;

  // The atom shrinks into the logo above the title while the window forms.
  float s = mix(.17, .064, settle);
  vec2 lp = p - vec2(0., mix(0., .068, settle));
  float w = s * mix(.05, .062, settle);
  float energy = 1. + flash;
  // Printed on the window, the atom cools from its deep colours into ink.
  float cool = smoothstep(.5, 1., ink);

  vec3 light = vec3(0.);
  float printed = 0.;
  vec3 printCol = INK;
  float bead = 0.;
  for (int i = 0; i < 3; i++) {
    float travel = trav[i];
    if (travel <= 0.) continue;
    vec2 q = rot(float(i) * PI / 3.) * lp;
    vec2 ab = vec2(1., .37) * s;
    float d = abs(sdEllipse(q, ab));
    float th = atan(q.y / ab.y, q.x / ab.x);
    float head = THETA0[i] + travel;
    float delta = mod(head - th, 2. * PI);
    // The electron paints its orbit as it goes; the first turn closes the ring.
    float drawn = 1. - smoothstep(travel - .3, travel, delta);
    float band = (1. - smoothstep(w - pix, w + pix, d)) * drawn;
    float tube = 1. - pow(min(d / w, 1.), 2.);
    float fresh = exp(-delta * 1.2) * smoothstep(0., .3, delta);
    vec3 c = mix(GLOW[i], vec3(1.), fresh * .75);
    light += c * band * (.42 + .3 * tube) * (.5 + .5 * exp(-delta * 1.1)) * energy;
    light += GLOW[i] * exp(-max(d - w, 0.) / (1.2 * w)) * drawn * .2 * energy;

    float hd = length(q - vec2(cos(head), sin(head)) * ab);
    float on = smoothstep(0., .4, travel);
    light += (vec3(1.) * (1. - smoothstep(w * 1.25 - pix, w * 1.25 + pix, hd)) * 1.4
            + GLOW[i] * exp(-hd / (2.2 * w)) * .7) * on * energy;

    printCol = mix(printCol, mix(mix(DEEP[i], INK, cool), DEEP[i], fresh * .8), band);
    printed = max(printed, band);
    bead = max(bead, (1. - smoothstep(w * .58 - pix, w * .58 + pix, hd)) * on);
  }
  float nd = length(lp) - .1 * s;
  float core = (1. - smoothstep(-pix, pix, nd)) * nucleus;
  light += vec3(1.) * core * 1.2 + ${linear("#ffd2b8")} * exp(-max(nd, 0.) / (.9 * w)) * nucleus * (.5 + flash);
  printCol = mix(printCol, mix(DEEP[0], INK, cool), core);
  printed = max(printed, core);
  vec3 glow = tonemap(light * 1.1);

  // The flash floods out from the nucleus as a soft ball of light that
  // sharpens and squares off into the window, clearing into the dawn field.
  // In the dark theme the flash is dimmer, clears sooner and the atom keeps
  // glowing on the window instead of being printed in ink.
  float open = step(1e-4, bloom);
  float R = mix(0., .62, bloom);
  float wd = sdRoundRect(p, vec2(min(R, .51), min(R, H + .01)), min(R, H) * (1. - smoothstep(.6, 1., bloom)));
  float soft = mix(.045, 0., smoothstep(.1, .7, bloom)) + pix;
  float win = max(1. - smoothstep(-soft, soft, wd), smoothstep(.97, 1., bloom)) * open;
  vec3 flashCol = ${themed("#fffaf6", "#ddd6ee")};
  vec3 interior = mix(flashCol, dawnField(p, t), smoothstep(themed(.2, .08), themed(.75, .5), bloom));
  interior = mix(interior, flashCol, exp(-max(-wd, 0.) / .03) * (1. - bloom) * themed(.6, .35));
  vec3 winCol = interior + glow * mix((1. - ink) * .5, 1., uDark);
  float print = ink * (1. - uDark);
  winCol = mix(winCol, printCol, printed * print);
  winCol = mix(winCol, ${linear("#fff6ef")}, bead * print);

  // The rim fades before the edges of the window so its glow is never cut off.
  float ad = abs(wd);
  float rim = (exp(-ad / .002) * .7 + exp(-ad / .014) * .22 + exp(-ad / .05) * .06)
            * smoothstep(.25, .6, bloom) * (1. - smoothstep(.75, 1., bloom))
            * smoothstep(0., .035, -sdRoundRect(p, vec2(.5, H), 0.));
  vec3 rimCol = mix(vec3(1.), mix(${linear("#ffd9c4")}, ${linear("#d3c8ff")}, smoothstep(-.35, .35, p.x)), .5);
  vec3 outside = glow + tonemap(rimCol * rim * 1.2);
  // Coverage adds up: inside the soft edge the window and the atom's light overlap.
  float la = clamp(max(max(outside.r, outside.g), outside.b), 0., 1.) * (1. - win);
  emitPremul(winCol * win + outside * (1. - win), win + la);
}
`;

export const atomFragment = prelude + dawnField + atom;
