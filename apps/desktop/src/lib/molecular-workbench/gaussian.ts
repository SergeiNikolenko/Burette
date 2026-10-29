import type { MolecularAtom, Vec3 } from "./types";
import { atomicNumber } from "./elements";
import type { GaussianShell, MolecularOrbital, ScalarGrid, ScientificDocument } from "./scientific-types";
import { shellSize, cartesianPowers, cartesianCoefficients, primitiveNormalization } from "./gaussian-angular";

const BOHR = 0.529177210903;
const MAX_BASIS = 2_000;
const MAX_COEFFICIENTS = 2_000_000;
const MAX_COMPILED_PRIMITIVES = 250_000;

export type QuantumField = { kind: "orbital"; orbitalIndex: number } | { kind: "density" } | { kind: "spin-density" };
export type QuantumGridOptions = { spacingAngstrom?: number; paddingAngstrom?: number };

function numeric(value: string | undefined) {
  if (!value || !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[EeDd][+-]?\d+)?$/.test(value)) throw new Error("Invalid Molden numeric value.");
  const result = Number(value.replace(/[Dd]/, "e"));
  if (!Number.isFinite(result)) throw new Error("Non-finite Molden value.");
  return result;
}
function tokens(line: string) { return line.trim().split(/\s+/); }

/** Molden format: https://www.theochem.ru.nl/molden/molden_format.html */
export function parseMolden(text: string): ScientificDocument {
  if (text.length > 16 * 1024 * 1024) throw new Error("Molden input exceeds 16 MiB.");
  const sections = new Map<string, { qualifier: string; lines: string[] }>();
  let section: { qualifier: string; lines: string[] } | undefined;
  for (const line of text.replace(/\r/g, "").split("\n")) {
    const header = line.match(/^\s*\[([^\]]+)\]\s*(.*)$/);
    if (header) { section = { qualifier: header[2].trim(), lines: [] }; sections.set(header[1].toLowerCase(), section); }
    else if (line.trim() && !line.trim().startsWith("!")) section?.lines.push(line.trim());
  }
  if (sections.has("sto")) throw new Error("Slater basis sets are not supported. Export a Gaussian basis or a cube field.");
  const atomSection = sections.get("atoms");
  if (!atomSection || !/^(Angs|AU)$/i.test(atomSection.qualifier)) throw new Error("Molden [Atoms] must declare Angs or AU coordinates.");
  const scale = /^AU$/i.test(atomSection.qualifier) ? BOHR : 1;
  const atoms = atomSection.lines.map((line, index): MolecularAtom => {
    const p = tokens(line);
    if (p.length !== 6 || numeric(p[1]) !== index + 1 || numeric(p[2]) !== atomicNumber(p[0])) throw new Error("Molden atom identifiers or elements are inconsistent.");
    const coordinates = p.slice(3).map(value => numeric(value) * scale);
    if (coordinates.some(value => Math.abs(value) > 1e6)) throw new Error("Molden coordinates exceed browser limits.");
    return { element: p[0], x: coordinates[0], y: coordinates[1], z: coordinates[2] };
  });
  if (!atoms.length || atoms.length > 10_000) throw new Error("Unsupported Molden atom count.");
  // [5D] implies 7F, but does not imply 9G; [5D10F] and [7F] override
  // the mixed cases. Preserve separate conventions for each angular momentum.
  const spherical = { d: false, f: false, g: false };
  for (const key of sections.keys()) {
    if (key === "5d") { spherical.d = true; spherical.f = true; }
    else if (/^(?:(?:5d|6d))?(?:(?:7f|10f))?(?:(?:9g|15g))?$/.test(key) && key) {
      if (/5d|6d/.test(key)) spherical.d = key.includes("5d");
      if (/7f|10f/.test(key)) spherical.f = key.includes("7f");
      if (/9g|15g/.test(key)) spherical.g = key.includes("9g");
    }
  }
  const basis: GaussianShell[] = [];
  const gto = sections.get("gto");
  if (!gto) throw new Error("Molden [GTO] Gaussian basis is missing.");
  let atomIndex = -1;
  for (let i = 0; i < gto.lines.length; i++) {
    const p = tokens(gto.lines[i]);
    if (/^\d+$/.test(p[0])) {
      atomIndex = numeric(p[0]) - 1;
      if (!Number.isInteger(atomIndex) || atomIndex < 0 || atomIndex >= atoms.length) throw new Error("Invalid Molden basis atom.");
      continue;
    }
    const label = p[0].toLowerCase();
    if (!["s", "p", "sp", "d", "f", "g"].includes(label)) throw new Error(`Molden ${label} shells are not supported; the published ordering is supported through g. Export a cube field for higher angular momentum.`);
    const count = numeric(p[1]);
    if (atomIndex < 0 || !Number.isInteger(count) || count < 1 || count > 100) throw new Error("Invalid Gaussian shell size.");
    const exponents: number[] = [], coefficients: number[] = [], pCoefficients: number[] = [];
    for (let primitive = 0; primitive < count; primitive++) {
      const parts = tokens(gto.lines[++i] ?? "");
      if (parts.length !== (label === "sp" ? 3 : 2)) throw new Error("Truncated Gaussian primitive.");
      const exponent = numeric(parts[0]);
      if (exponent <= 0 || exponent > 1e10) throw new Error("Gaussian exponent is outside supported range.");
      exponents.push(exponent); coefficients.push(numeric(parts[1]));
      if (label === "sp") pCoefficients.push(numeric(parts[2]));
    }
    basis.push({ atomIndex, kind: label === "sp" ? "s" : label as GaussianShell["kind"], spherical: spherical[label as keyof typeof spherical] ?? false, exponents, coefficients });
    if (label === "sp") basis.push({ atomIndex, kind: "p", spherical: false, exponents: [...exponents], coefficients: pCoefficients });
    if (basis.reduce((sum, shell) => sum + shellSize(shell), 0) > MAX_BASIS) throw new Error("Gaussian basis exceeds 2000 functions.");
  }
  const basisCount = basis.reduce((sum, shell) => sum + shellSize(shell), 0);
  if (!basisCount) throw new Error("Molden basis is empty.");
  const orbitalSection = sections.get("mo");
  if (!orbitalSection) throw new Error("Molden [MO] coefficients are missing.");
  const orbitals: MolecularOrbital[] = [];
  let current: Partial<MolecularOrbital> | undefined;
  let seen = new Set<number>();
  function finish() {
    if (!current) return;
    if (current.energyHartree === undefined || current.occupancy === undefined || !current.spin || !seen.size) throw new Error("Incomplete Molden orbital metadata or coefficients.");
    orbitals.push(current as MolecularOrbital);
    if (orbitals.length * basisCount > MAX_COEFFICIENTS) throw new Error("Molden orbital matrix exceeds browser limit.");
  }
  for (const line of orbitalSection.lines) {
    const metadata = line.match(/^(Sym|Ene|Spin|Occup)\s*=\s*(.*)$/i);
    if (metadata) {
      const key = metadata[1].toLowerCase();
      if (!current || (seen.size > 0 && (key === "sym" || key === "ene"))) {
        finish(); current = { index: orbitals.length, coefficients: Array(basisCount).fill(0) }; seen = new Set();
      }
      const value = metadata[2].trim();
      if (key === "sym") current.symmetry = value;
      if (key === "ene") current.energyHartree = numeric(value);
      if (key === "occup") { current.occupancy = numeric(value); if (current.occupancy < 0 || current.occupancy > 2) throw new Error("Invalid orbital occupancy."); }
      if (key === "spin") { if (!/^(alpha|beta)$/i.test(value)) throw new Error("Unsupported orbital spin."); current.spin = value.toLowerCase() as "alpha" | "beta"; }
    } else {
      const p = tokens(line); const index = numeric(p[0]) - 1;
      if (!current || p.length !== 2 || !Number.isInteger(index) || index < 0 || index >= basisCount || seen.has(index)) throw new Error("Invalid or duplicate Molden AO coefficient.");
      current.coefficients![index] = numeric(p[1]); seen.add(index);
    }
  }
  finish();
  if (!orbitals.length) throw new Error("Molden contains no orbitals.");
  return { format: "molden", atoms, frames: [{ atoms }], modes: [], orbitals, basis };
}

type GaussianTerm = { center: Vec3; powers: Vec3; primitives: { exponent: number; weight: number }[] };

/** Cartesian AO order follows Molden: s; x y z; xx yy zz xy xz yz. */
function compileOrbital(document: ScientificDocument, orbitalIndex: number): GaussianTerm[] {
  const orbital = document.orbitals[orbitalIndex];
  if (!document.basis || !orbital) throw new Error("Select an orbital from a supported Molden Gaussian basis.");
  if (document.basis.reduce((sum, shell) => sum + shellSize(shell), 0) !== orbital.coefficients.length) throw new Error("Orbital coefficients do not match the Gaussian basis.");
  const result: GaussianTerm[] = [];
  let offset = 0;
  for (const shell of document.basis!) {
    const center = document.atoms[shell.atomIndex];
    const angular = cartesianPowers(shell);
    let coefficients = orbital.coefficients.slice(offset, offset + shellSize(shell));
    offset += coefficients.length;
    coefficients = cartesianCoefficients(shell, coefficients, angular);
    angular.forEach((powers, i) => {
      if (!coefficients[i]) return;
      result.push({ center: [center.x / BOHR, center.y / BOHR, center.z / BOHR], powers,
        primitives: shell.exponents.map((exponent, p) => ({ exponent, weight: coefficients[i] * shell.coefficients[p] * primitiveNormalization(exponent, ...powers) })) });
    });
  }
  return result;
}

function evaluateTerms(terms: GaussianTerm[], point: Vec3) {
  const px = point[0] / BOHR, py = point[1] / BOHR, pz = point[2] / BOHR;
  let value = 0;
  for (const term of terms) {
    const x = px - term.center[0], y = py - term.center[1], z = pz - term.center[2];
    const r2 = x * x + y * y + z * z;
    let radial = 0;
    for (const primitive of term.primitives) radial += primitive.weight * Math.exp(-primitive.exponent * r2);
    value += radial * Math.pow(x, term.powers[0]) * Math.pow(y, term.powers[1]) * Math.pow(z, term.powers[2]);
  }
  return value;
}

export function evaluateOrbital(document: ScientificDocument, orbitalIndex: number, point: Vec3): number {
  if (point.some(value => !Number.isFinite(value))) throw new Error("Orbital point must be finite.");
  return fieldAt(compileField(document, { kind: "orbital", orbitalIndex }), point);
}

function densityWeights(document: ScientificDocument, spin: boolean): { orbitalIndex: number; weight: number }[] {
  const unrestricted = document.orbitals.some(orbital => orbital.spin === "beta");
  return document.orbitals.flatMap((orbital, orbitalIndex) => {
    const occupancy = orbital.occupancy;
    if (!Number.isFinite(occupancy) || occupancy < 0 || occupancy > 2) throw new Error("Invalid density orbital occupancy.");
    if (!spin) return occupancy ? [{ orbitalIndex, weight: occupancy }] : [];
    if (unrestricted) {
      if (occupancy > 1) throw new Error("Unrestricted spin-density requires occupations from zero to one per spin orbital.");
      return occupancy ? [{ orbitalIndex, weight: occupancy * (orbital.spin === "beta" ? -1 : 1) }] : [];
    }
    // Restricted paired orbitals contribute equally to alpha/beta. ROHF singly occupied orbitals are alpha.
    if (occupancy === 2 || occupancy === 0) return [];
    if (occupancy === 1) return [{ orbitalIndex, weight: 1 }];
    throw new Error("Restricted fractional occupations do not specify an alpha/beta spin partition.");
  });
}

function compileField(document: ScientificDocument, field: QuantumField) {
  if (!document.atoms.length || !document.basis?.length || !document.orbitals.length) throw new Error("Gaussian atoms, basis and molecular orbitals are required.");
  const weights = field.kind === "orbital" ? [{ orbitalIndex: field.orbitalIndex, weight: 1 }]
    : densityWeights(document, field.kind === "spin-density");
  const primitiveWork = (document.basis ?? []).reduce((sum, shell) => sum + cartesianPowers(shell).length * shell.exponents.length, 0) * weights.length;
  if (primitiveWork > MAX_COMPILED_PRIMITIVES) throw new Error("Quantum field exceeds browser coefficient memory limit.");
  return { primitiveWork, orbitals: weights.map(item => ({ terms: compileOrbital(document, item.orbitalIndex), weight: item.weight })), square: field.kind !== "orbital" };
}

function fieldAt(compiled: ReturnType<typeof compileField>, point: Vec3) {
  let value = 0;
  for (const orbital of compiled.orbitals) {
    const psi = evaluateTerms(orbital.terms, point);
    value += orbital.weight * (compiled.square ? psi * psi : psi);
  }
  if (!Number.isFinite(value)) throw new Error("Quantum field exceeds numeric range.");
  return value;
}

export function evaluateDensity(document: ScientificDocument, point: Vec3): number {
  if (point.some(value => !Number.isFinite(value))) throw new Error("Density point must be finite.");
  return fieldAt(compileField(document, { kind: "density" }), point);
}

export function evaluateSpinDensity(document: ScientificDocument, point: Vec3): number {
  if (point.some(value => !Number.isFinite(value))) throw new Error("Density point must be finite.");
  return fieldAt(compileField(document, { kind: "spin-density" }), point);
}

/** Density and spin-density units are electrons/bohr³; orbital amplitudes are bohr^(-3/2). */
export function evaluateQuantumGrid(document: ScientificDocument, field: QuantumField, options: QuantumGridOptions = {}): ScalarGrid {
  const spacing = options.spacingAngstrom ?? 0.3;
  const padding = options.paddingAngstrom ?? 3;
  if (!Number.isFinite(spacing) || spacing < 0.1 || spacing > 2 || !Number.isFinite(padding) || padding < 0 || padding > 10) throw new Error("Unsupported orbital grid spacing or padding.");
  if (!document.atoms.length || !document.basis) throw new Error("Gaussian atoms and basis are required.");
  const origin: Vec3 = [Infinity, Infinity, Infinity], maximum: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const atom of document.atoms) [atom.x, atom.y, atom.z].forEach((value, i) => { origin[i] = Math.min(origin[i], value - padding); maximum[i] = Math.max(maximum[i], value + padding); });
  const dimensions = maximum.map((value, i) => Math.max(2, Math.ceil((value - origin[i]) / spacing) + 1)) as ScalarGrid["dimensions"];
  const size = dimensions.reduce((a, b) => a * b, 1);
  if (size > 1_000_000) throw new Error("Quantum grid exceeds the browser limit of one million values. Increase the grid spacing.");
  const compiled = compileField(document, field);
  if (size * compiled.primitiveWork > 30_000_000) throw new Error("Quantum grid exceeds browser work limit. Increase the grid spacing.");
  const values = new Float32Array(size);
  let index = 0;
  for (let x = 0; x < dimensions[0]; x++) for (let y = 0; y < dimensions[1]; y++) for (let z = 0; z < dimensions[2]; z++) {
    values[index++] = fieldAt(compiled, [origin[0] + x * spacing, origin[1] + y * spacing, origin[2] + z * spacing]);
  }
  if (values.some(value => !Number.isFinite(value))) throw new Error("Orbital field exceeds float range.");
  return { dimensions, origin, axes: [[spacing, 0, 0], [0, spacing, 0], [0, 0, spacing]], values };
}

export function evaluateOrbitalGrid(document: ScientificDocument, orbitalIndex: number, options: QuantumGridOptions = {}): ScalarGrid {
  return evaluateQuantumGrid(document, { kind: "orbital", orbitalIndex }, options);
}

export function evaluateDensityGrid(document: ScientificDocument, options: QuantumGridOptions = {}): ScalarGrid {
  return evaluateQuantumGrid(document, { kind: "density" }, options);
}

export function evaluateSpinDensityGrid(document: ScientificDocument, options: QuantumGridOptions = {}): ScalarGrid {
  return evaluateQuantumGrid(document, { kind: "spin-density" }, options);
}
