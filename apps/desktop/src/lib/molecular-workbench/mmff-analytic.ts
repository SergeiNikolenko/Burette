/**
 * MMFF94/MMFF94s energy with an analytic Cartesian gradient, evaluated from the
 * term parameters that the pinned RDKit module extracts (BMFX v1, see
 * compute/rdkit-conformer/mmff-extractor-contract.v1.json). The functional forms
 * follow crates/burette-compute-core/src/mmff.rs; parameters are stored as f32
 * by the ABI, coordinates and arithmetic are f64.
 */
const HEADER_BYTES = 64, TERM_BYTES = 48, RDKIT_RELEASE = 20_250_304;
const MDYNE = 143.9325, RAD = Math.PI / 180, STRETCH_BEND = 2.5121, COULOMB = 332.0716;

type Term = { atoms: Uint32Array; p0: Float32Array; p1: Float32Array };
export type MmffTerms = {
  atomCount: number;
  bonds: Term[]; angles: Term[]; stretchBends: Term[]; outOfPlanes: Term[]; torsions: Term[]; vanDerWaals: Term[]; electrostatics: Term[];
};

/** Strict BMFX v1 decoder; any shape or header mismatch throws. */
export function decodeMmffTerms(bytes: Uint8Array): MmffTerms {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), text = String.fromCharCode(...bytes.subarray(0, 4));
  if (bytes.byteLength < HEADER_BYTES || text !== 'BMFX' || view.getUint16(4, true) !== 1 || view.getUint16(6, true) !== HEADER_BYTES
    || view.getUint32(52, true) !== RDKIT_RELEASE || view.getUint32(48, true) !== bytes.byteLength) throw new Error('MMFF parameters differ from the pinned BMFX v1 ABI.');
  const atomCount = view.getUint32(12, true), counts = Array.from({ length: 7 }, (_, i) => view.getUint32(16 + 4 * i, true));
  let cursor = Math.ceil((HEADER_BYTES + 4 * atomCount) / 16) * 16;
  if (!atomCount || cursor + counts.reduce((a, b) => a + b, 0) * TERM_BYTES !== bytes.byteLength) throw new Error('MMFF parameter payload does not match its counts.');
  const groups = counts.map(count => Array.from({ length: count }, () => {
    const atoms = new Uint32Array(4), p0 = new Float32Array(4), p1 = new Float32Array(4);
    for (let i = 0; i < 4; i++) { atoms[i] = view.getUint32(cursor + 4 * i, true); p0[i] = view.getFloat32(cursor + 16 + 4 * i, true); p1[i] = view.getFloat32(cursor + 32 + 4 * i, true); }
    if ([...atoms].some(atom => atom >= atomCount) || [...p0, ...p1].some(value => !Number.isFinite(value))) throw new Error('MMFF parameter term is out of range.');
    cursor += TERM_BYTES;
    return { atoms, p0, p1 };
  }));
  const [bonds, angles, stretchBends, outOfPlanes, torsions, vanDerWaals, electrostatics] = groups;
  return { atomCount, bonds, angles, stretchBends, outOfPlanes, torsions, vanDerWaals, electrostatics };
}

// Twelve-component forward-mode duals for the bonded angular terms (as in mmff_analytic.rs).
type Dual = { v: number; d: Float64Array };
const dual = (v: number, d = new Float64Array(12)): Dual => ({ v, d });
const add = (a: Dual, b: Dual) => { const d = new Float64Array(12); for (let i = 0; i < 12; i++) d[i] = a.d[i] + b.d[i]; return dual(a.v + b.v, d); };
const sub = (a: Dual, b: Dual) => { const d = new Float64Array(12); for (let i = 0; i < 12; i++) d[i] = a.d[i] - b.d[i]; return dual(a.v - b.v, d); };
const mul = (a: Dual, b: Dual) => { const d = new Float64Array(12); for (let i = 0; i < 12; i++) d[i] = a.d[i] * b.v + a.v * b.d[i]; return dual(a.v * b.v, d); };
const div = (a: Dual, b: Dual) => { const inv = 1 / b.v, d = new Float64Array(12); for (let i = 0; i < 12; i++) d[i] = (a.d[i] - a.v * inv * b.d[i]) * inv; return dual(a.v * inv, d); };
const chain = (a: Dual, v: number, derivative: number) => { const d = new Float64Array(12); for (let i = 0; i < 12; i++) d[i] = a.d[i] * derivative; return dual(v, d); };
const sqrt = (a: Dual) => { const root = Math.sqrt(Math.max(a.v, 1e-20)); return chain(a, root, 0.5 / root); };
const acos = (a: Dual) => { const v = Math.min(1, Math.max(-1, a.v)); return chain(a, Math.acos(v), -1 / Math.sqrt(Math.max(1 - v * v, 1e-20))); };
const asin = (a: Dual) => { const v = Math.min(1, Math.max(-1, a.v)); return chain(a, Math.asin(v), 1 / Math.sqrt(Math.max(1 - v * v, 1e-20))); };
type Vec = [Dual, Dual, Dual];
const vsub = (a: Vec, b: Vec): Vec => [sub(a[0], b[0]), sub(a[1], b[1]), sub(a[2], b[2])];
const vdot = (a: Vec, b: Vec) => add(add(mul(a[0], b[0]), mul(a[1], b[1])), mul(a[2], b[2]));
const vcross = (a: Vec, b: Vec): Vec => [sub(mul(a[1], b[2]), mul(a[2], b[1])), sub(mul(a[2], b[0]), mul(a[0], b[2])), sub(mul(a[0], b[1]), mul(a[1], b[0]))];
const vlength = (a: Vec) => sqrt(vdot(a, a));
const vunit = (a: Vec): Vec => { const n = vlength(a); return [div(a[0], n), div(a[1], n), div(a[2], n)]; };
const angleOf = (p: Vec[]) => { const a = vsub(p[0], p[1]), b = vsub(p[2], p[1]); return acos(div(vdot(a, b), mul(vlength(a), vlength(b)))); };
const constant = (v: number) => dual(v);

function points(x: Float64Array, atoms: Uint32Array, count: number): Vec[] {
  return Array.from({ length: count }, (_, slot) => [0, 1, 2].map(axis => {
    const d = new Float64Array(12); d[3 * slot + axis] = 1;
    return dual(x[3 * atoms[slot] + axis], d);
  }) as Vec);
}
function scatter(gradient: Float64Array, atoms: Uint32Array, count: number, value: Dual) {
  for (let slot = 0; slot < count; slot++) for (let axis = 0; axis < 3; axis++) gradient[3 * atoms[slot] + axis] += value.d[3 * slot + axis];
  return value.v;
}

/** Energy in kcal/mol; adds dE/dx in kcal/(mol·Å) into `gradient` (3 values per atom, molblock order). */
export function mmffEnergy(terms: MmffTerms, x: Float64Array, gradient: Float64Array): number {
  gradient.fill(0);
  let energy = 0;
  // Radial terms: closed-form derivative along the pair axis.
  const radial = (i: number, j: number, value: (r: number) => [number, number]) => {
    const dx = x[3 * i] - x[3 * j], dy = x[3 * i + 1] - x[3 * j + 1], dz = x[3 * i + 2] - x[3 * j + 2];
    const r = Math.max(Math.hypot(dx, dy, dz), 1e-10), [e, dEdr] = value(r), s = dEdr / r;
    gradient[3 * i] += s * dx; gradient[3 * i + 1] += s * dy; gradient[3 * i + 2] += s * dz;
    gradient[3 * j] -= s * dx; gradient[3 * j + 1] -= s * dy; gradient[3 * j + 2] -= s * dz;
    energy += e;
  };
  for (const { atoms, p0 } of terms.bonds) radial(atoms[0], atoms[1], r => {
    const k = MDYNE * p0[0], d = r - p0[1];
    return [0.5 * k * d * d * (1 - 2 * d + (7 / 3) * d * d), k * (d - 3 * d * d + (14 / 3) * d * d * d)];
  });
  for (const { atoms, p0 } of terms.vanDerWaals) radial(atoms[0], atoms[1], r => {
    const rStar = p0[0], epsilon = p0[1], rho = r / rStar, b = 1.07 / (rho + 0.07), b7 = b ** 7, q = rho ** 7 + 0.12;
    const e = epsilon * b7 * (1.12 / q - 2);
    const dEdrho = epsilon * (-7 * b7 / (rho + 0.07) * (1.12 / q - 2) - b7 * 1.12 * 7 * rho ** 6 / (q * q));
    return [e, dEdrho / rStar];
  });
  for (const { atoms, p0 } of terms.electrostatics) radial(atoms[0], atoms[1], r => {
    const k = (p0[1] === 1 ? 0.75 : 1) * COULOMB * p0[0], s = r + 0.05;
    return [k / s, -k / (s * s)];
  });
  for (const { atoms, p0 } of terms.angles) {
    const theta = angleOf(points(x, atoms, 3));
    if (p0[2] === 1) { energy += scatter(gradient, atoms, 3, mul(constant(MDYNE * p0[0]), chain(theta, 1 + Math.cos(theta.v), -Math.sin(theta.v)))); continue; }
    const d = sub(div(theta, constant(RAD)), constant(p0[1]));
    energy += scatter(gradient, atoms, 3, mul(mul(constant(0.5 * MDYNE * RAD * RAD * p0[0]), mul(d, d)), sub(constant(1), mul(constant(0.4 * RAD), d))));
  }
  for (const { atoms, p0, p1 } of terms.stretchBends) {
    const p = points(x, atoms, 3), a = sub(div(angleOf(p), constant(RAD)), constant(p1[0]));
    const stretch = add(mul(constant(p0[0]), sub(vlength(vsub(p[0], p[1])), constant(p0[2]))), mul(constant(p0[1]), sub(vlength(vsub(p[2], p[1])), constant(p0[3]))));
    energy += scatter(gradient, atoms, 3, mul(constant(STRETCH_BEND), mul(a, stretch)));
  }
  for (const { atoms, p0 } of terms.outOfPlanes) {
    const p = points(x, atoms, 4), a = vunit(vsub(p[0], p[1])), b = vunit(vsub(p[2], p[1])), d = vunit(vsub(p[3], p[1]));
    const chi = asin(vdot(vunit(vcross([chain(a[0], -a[0].v, -1), chain(a[1], -a[1].v, -1), chain(a[2], -a[2].v, -1)], b)), d));
    energy += scatter(gradient, atoms, 4, mul(constant(0.5 * MDYNE * p0[0]), mul(chi, chi)));
  }
  for (const { atoms, p0 } of terms.torsions) {
    const p = points(x, atoms, 4), t = vcross(vsub(p[1], p[0]), vsub(p[2], p[1])), u = vcross(vsub(p[2], p[1]), vsub(p[3], p[2]));
    const c = div(vdot(t, u), mul(vlength(t), vlength(u))), c2 = sub(mul(constant(2), mul(c, c)), constant(1)), c3 = mul(c, sub(mul(constant(4), mul(c, c)), constant(3)));
    energy += scatter(gradient, atoms, 4, mul(constant(0.5), add(add(mul(constant(p0[0]), add(constant(1), c)), mul(constant(p0[1]), sub(constant(1), c2))), mul(constant(p0[2]), add(constant(1), c3)))));
  }
  return energy;
}
