import type { GaussianShell, MolecularOrbital } from '../scientific-types';
import { cartesianPowers, primitiveNormalization } from '../gaussian-angular';
import { finite, MAX_VALUES } from './reader-values';

type JsonObject = Record<string, unknown>;
const KINDS: GaussianShell['kind'][] = ['s', 'p', 'd', 'f', 'g', 'h', 'i'];
const object = (value: unknown, label: string): JsonObject => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`QCSchema ${label} must be an object.`);
  return value as JsonObject;
};
const numbers = (value: unknown, label: string): number[] => {
  if (!Array.isArray(value)) throw new Error(`QCSchema ${label} must be an array.`);
  return value.map(item => finite(typeof item === 'string' ? Number(item) : item));
};

/** Lexicographic Cartesian components (xx, xy, xz, yy, yz, zz) of angular momentum l. */
function lexicographic(l: number) {
  const powers: [number, number, number][] = [];
  for (let x = l; x >= 0; x--) for (let y = l - x; y >= 0; y--) powers.push([x, y, l - x - y]);
  return powers;
}

/**
 * QCSchema BasisSet + Wavefunction, as written by Psi4 through QCEngine. Verified against PySCF
 * (tests/fixtures/quantum/qcschema): shell coefficients include the x^l primitive normalization;
 * spherical components run m = +l..-l; Cartesian components are lexicographic and all carry the
 * x^l normalization; orbitals are stored (nbf, nmo) row-major. Burette stores normalized-primitive
 * contraction coefficients, real solid harmonics in m = 0, +1, -1, ... order and individually
 * normalized Cartesian components, so coefficients are permuted and rescaled here.
 */
export function readQcschemaWavefunction(value: unknown, atomCount: number, electrons: { alpha?: unknown; beta?: unknown }) {
  const wavefunction = object(value, 'wavefunction');
  const basisSet = object(wavefunction.basis, 'basis');
  const atomMap = basisSet.atom_map;
  const centers = object(basisSet.center_data, 'basis center data');
  if (!Array.isArray(atomMap) || atomMap.length !== atomCount) throw new Error('QCSchema basis atom map does not match the molecule.');
  const basis: GaussianShell[] = [];
  // For each Burette AO: the QCSchema AO it reads and the factor applied to its coefficient.
  const source: { index: number; factor: number }[] = [];
  let offset = 0;
  atomMap.forEach((key, atomIndex) => {
    const center = object(centers[String(key)], 'basis center');
    if (center.ecp_potentials != null && (!Array.isArray(center.ecp_potentials) || center.ecp_potentials.length)) throw new Error('QCSchema effective core potentials are not supported for orbital fields.');
    const shells = center.electron_shells;
    if (!Array.isArray(shells)) throw new Error('QCSchema basis center has no electron shells.');
    for (const raw of shells) {
      const shell = object(raw, 'electron shell');
      const momenta = numbers(shell.angular_momentum, 'angular momentum');
      const exponents = numbers(shell.exponents, 'exponents');
      const rows = shell.coefficients;
      if (!Array.isArray(rows) || rows.length !== momenta.length || !exponents.length || exponents.some(e => e <= 0)) throw new Error('Malformed QCSchema electron shell.');
      if (shell.harmonic_type !== 'spherical' && shell.harmonic_type !== 'cartesian') throw new Error('Unsupported QCSchema harmonic type.');
      momenta.forEach((l, row) => {
        const kind = KINDS[l];
        if (!kind || !Number.isInteger(l)) throw new Error('QCSchema angular momentum above i is not supported.');
        const coefficients = numbers(rows[row], 'coefficients');
        if (coefficients.length !== exponents.length) throw new Error('Malformed QCSchema contraction.');
        const spherical = shell.harmonic_type === 'spherical' && l >= 1;
        const primitive = exponents.map(e => primitiveNormalization(e, l, 0, 0));
        let norm = 0;
        exponents.forEach((a, p) => exponents.forEach((b, q) => { norm += coefficients[p] / primitive[p] * coefficients[q] / primitive[q] * (2 * Math.sqrt(a * b) / (a + b)) ** (l + 1.5); }));
        if (!(norm > 0)) throw new Error('QCSchema shell has no normalizable contraction.');
        const entry: GaussianShell = { atomIndex, kind, spherical: spherical && l >= 2, exponents, coefficients: coefficients.map((c, p) => c / primitive[p] / Math.sqrt(norm)) };
        basis.push(entry);
        if (spherical) {
          // QCSchema m = +l..-l; Burette m = 0, +1, -1, +2, -2, ... (p: x, y, z = m +1, -1, 0).
          const m = l === 1 ? [1, -1, 0] : Array.from({ length: 2 * l + 1 }, (_, k) => k === 0 ? 0 : (k % 2 ? 1 : -1) * Math.ceil(k / 2));
          for (const mm of m) source.push({ index: offset + l - mm, factor: 1 });
          offset += 2 * l + 1;
        } else {
          const printed = lexicographic(l).map(p => p.join());
          for (const p of cartesianPowers(entry)) source.push({ index: offset + printed.indexOf(p.join()), factor: primitiveNormalization(1, l, 0, 0) / primitiveNormalization(1, ...p) });
          offset += printed.length;
        }
      });
    }
  });
  if (basisSet.nbf !== undefined && basisSet.nbf !== offset) throw new Error('QCSchema basis function count disagrees with its shells.');
  const restricted = wavefunction.restricted;
  if (typeof restricted !== 'boolean') throw new Error('QCSchema wavefunction must state whether it is restricted.');
  const field = (name: string) => {
    const pointer = wavefunction[name];
    return typeof pointer === 'string' ? wavefunction[pointer] : pointer;
  };
  const count = (value: unknown) => Number.isInteger(value) && (value as number) >= 0 ? value as number : undefined;
  const alpha = count(electrons.alpha), beta = count(electrons.beta);
  const occupations = (spin: 'a' | 'b') => {
    const printed = field(`occupations_${spin}`);
    return printed == null ? undefined : numbers(printed, 'occupations');
  };
  const orbitals: MolecularOrbital[] = [];
  for (const spin of restricted ? ['a'] as const : ['a', 'b'] as const) {
    const flat = numbers(field(`orbitals_${spin}`), 'orbitals');
    if (!flat.length || flat.length % offset || flat.length > MAX_VALUES) throw new Error('QCSchema orbitals do not match the basis.');
    const nmo = flat.length / offset;
    const energies = numbers(field(`eigenvalues_${spin}`), 'eigenvalues');
    if (energies.length !== nmo) throw new Error('QCSchema eigenvalues do not match the orbitals.');
    // Occupations are per spin; a restricted wavefunction shares one set of orbitals.
    const own = occupations(spin), paired = restricted ? occupations('b') ?? own : undefined;
    if ((own && own.length !== nmo) || (paired && paired.length !== nmo)) throw new Error('QCSchema occupations do not match the orbitals.');
    if (!own && (alpha === undefined || beta === undefined)) throw new Error('QCSchema wavefunction states neither occupations nor electron counts.');
    for (let i = 0; i < nmo; i++) {
      const occupancy = own ? own[i] + (paired?.[i] ?? 0)
        : restricted ? (i < Math.min(alpha!, beta!) ? 2 : i < Math.max(alpha!, beta!) ? 1 : 0) : i < (spin === 'a' ? alpha! : beta!) ? 1 : 0;
      if (!(occupancy >= 0 && occupancy <= (restricted ? 2 : 1))) throw new Error('Invalid QCSchema orbital occupation.');
      orbitals.push({ index: i, spin: spin === 'a' ? 'alpha' : 'beta', energyHartree: energies[i], occupancy, coefficients: source.map(({ index, factor }) => flat[index * nmo + i] * factor) });
    }
  }
  return { basis, orbitals };
}
