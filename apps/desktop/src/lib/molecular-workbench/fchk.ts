import { elementSymbol } from './elements';
import type { GaussianShell, MolecularOrbital, ScientificDocument } from './scientific-types';
import { shellSize } from './gaussian-angular';
import { fchkVibrations } from './fchk-vibrations';
import { MAX_HESSIAN_DIMENSION, hessianFromLowerTriangle, packedTriangleDimension, packedTriangleLength } from './hessian';

const BOHR = 0.529177210903;
const fields = new Set(['Number of atoms', 'Atomic numbers', 'Current cartesian coordinates', 'Number of basis functions',
  'Number of alpha electrons', 'Number of beta electrons', 'Shell types', 'Number of primitives per shell', 'Shell to atom map',
  'Primitive exponents', 'Contraction coefficients', 'P(S=P) Contraction coefficients', 'Alpha Orbital Energies',
  'Beta Orbital Energies', 'Alpha MO coefficients', 'Beta MO coefficients', 'Total Energy', 'Real atomic weights',
  'Cartesian Force Constants', 'Dipole Derivatives', 'Polarizability Derivatives', 'Number of Normal Modes', 'Vib-NDim', 'Vib-LE2Fix', 'Vib-AtMass', 'Vib-E2', 'Vib-Modes']);
// The packed Hessian of the largest supported molecule; other arrays stay far smaller.
const FIELD_LIMITS: Record<string, number> = { 'Cartesian Force Constants': packedTriangleLength(MAX_HESSIAN_DIMENSION) };

/** Gaussian formatted checkpoint specification: https://gaussian.com/interfacing/.
 * Values are atomic units; real arrays use E16.8 and integer arrays I12. */
export function parseFchk(text: string): ScientificDocument {
  if (text.length > 16 * 1024 * 1024 || text.includes('\0')) throw new Error('FCHK input must be text under 16 MiB.');
  const lines = text.replace(/\r/g, '').split('\n'), data = new Map<string, number[]>();
  // Every field present, read or not: Gaussian zero-fills spectra whose derivatives it never computed.
  const present = new Set<string>();
  const number = (token: string) => {
    if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[EDed][+-]?\d+)?$/.test(token)) throw new Error('Invalid FCHK number.');
    const n = Number(token.replace(/[Dd]/, 'e'));
    if (!Number.isFinite(n)) throw new Error('Non-finite FCHK value.');
    return n;
  };
  for (let i = 2; i < lines.length; i++) {
    const header = lines[i].match(/^(.{1,40}?)\s+([IRCLH])\s+(?:N=\s*(\d+)|(.+))$/);
    if (!header) continue;
    const key = header[1].trim();
    present.add(key);
    if (!fields.has(key)) continue;
    if (data.has(key)) throw new Error(`Duplicate FCHK field: ${key}.`);
    if ((key === 'Dipole Derivatives' || key === 'Polarizability Derivatives') && (header[2] !== 'R' || header[3] === undefined)) throw new Error('FCHK derivatives must be real numeric arrays.');
    if (header[2] !== 'I' && header[2] !== 'R') throw new Error('Invalid FCHK numeric field type.');
    const count = header[3] === undefined ? 1 : Number(header[3]);
    if (!Number.isSafeInteger(count) || count < 1 || count > (FIELD_LIMITS[key] ?? 250_000)) throw new Error('FCHK field exceeds the supported size.');
    // A triangle that cannot be 3N × 3N is refused before any of it is read.
    if (key === 'Cartesian Force Constants') packedTriangleDimension(count);
    const values: number[] = [];
    if (header[3] === undefined) values.push(number(header[4].trim()));
    else while (values.length < count) {
      const line = lines[++i];
      if (line === undefined || /[A-CF-Za-cf-z]/.test(line)) throw new Error(`Truncated FCHK field: ${key}.`);
      const tokens = line.trim().split(/\s+/).filter(Boolean);
      if (!tokens.length || values.length + tokens.length > count) throw new Error(`Incorrect FCHK array length: ${key}.`);
      values.push(...tokens.map(number));
    }
    if (header[2] === 'I' && values.some(v => !Number.isSafeInteger(v))) throw new Error('Non-integer FCHK integer field.');
    data.set(key, values);
  }
  const array = (key: string, count?: number) => {
    const value = data.get(key);
    if (!value || (count !== undefined && value.length !== count)) throw new Error(`Missing or inconsistent FCHK field: ${key}.`);
    return value;
  };
  const integer = (key: string, maximum: number, min = 1) => {
    const value = array(key, 1)[0];
    if (!Number.isInteger(value) || value < min || value > maximum) throw new Error(`Invalid FCHK ${key}.`);
    return value;
  };
  const n = integer('Number of atoms', 10_000), z = array('Atomic numbers', n), xyz = array('Current cartesian coordinates', 3 * n);
  // Derivative tensors certify zero intensities only after their complete numeric records validate.
  for (const [key, count] of [['Dipole Derivatives', 9 * n], ['Polarizability Derivatives', 18 * n]] as const) if (data.has(key)) array(key, count);
  for (const key of ['Number of Normal Modes', 'Vib-NDim', 'Vib-LE2Fix']) if (data.has(key)) array(key, 1);
  if (xyz.some(v => Math.abs(v) > 1e6)) throw new Error('FCHK atomic coordinates exceed the supported range.');
  const atoms = z.map((value, i) => ({ element: elementSymbol(value), x: xyz[3 * i] * BOHR, y: xyz[3 * i + 1] * BOHR, z: xyz[3 * i + 2] * BOHR }));
  const document: ScientificDocument = { format: 'fchk', atoms, frames: [{ atoms }], orbitals: [], modes: [] };
  if (data.has('Total Energy')) document.frames[0].energyHartree = array('Total Energy', 1)[0];
  // The masses the frequency analysis used (isotopes included), else the file's atomic weights.
  const masses = data.has('Vib-AtMass') ? array('Vib-AtMass', n) : data.has('Real atomic weights') ? array('Real atomic weights', n) : undefined;
  if (data.has('Cartesian Force Constants')) document.frames[0].hessian = hessianFromLowerTriangle(array('Cartesian Force Constants'), n, masses);
  document.modes = fchkVibrations(data, present, n);
  if (document.modes.length) document.frames[0].modes = document.modes;
  if (!data.has('Shell types')) return document;
  const types = array('Shell types'), counts = array('Number of primitives per shell', types.length), centers = array('Shell to atom map', types.length);
  if (counts.some(c => !Number.isInteger(c) || c < 1 || c > 1024)) throw new Error('Invalid FCHK primitive count.');
  const total = counts.reduce((a, b) => a + b, 0), exponents = array('Primitive exponents', total), coefficients = array('Contraction coefficients', total);
  if (exponents.some(e => e <= 0)) throw new Error('FCHK Gaussian exponents must be positive.');
  const pCoefficients = types.includes(-1) ? array('P(S=P) Contraction coefficients', total) : [];
  const basis: GaussianShell[] = [];
  let offset = 0, nbasis = 0;
  for (let i = 0; i < types.length; i++) {
    if (!Number.isInteger(types[i]) || Math.abs(types[i]) > 6) throw new Error('FCHK fields support s through i shells and sp contractions.');
    const atomIndex = centers[i] - 1, end = offset + counts[i];
    if (!Number.isInteger(atomIndex) || atomIndex < 0 || atomIndex >= n) throw new Error('Invalid FCHK shell-to-atom mapping.');
    const shell = { atomIndex, exponents: exponents.slice(offset, end), coefficients: coefficients.slice(offset, end), spherical: types[i] < -1, cartesianOrder: 'gaussian' as const };
    const kind = types[i] === -1 ? 's' : (['s', 'p', 'd', 'f', 'g', 'h', 'i'] as const)[Math.abs(types[i])];
    basis.push({ ...shell, kind });
    if (types[i] === -1) basis.push({ ...shell, kind: 'p', coefficients: pCoefficients.slice(offset, end) });
    nbasis += types[i] === -1 ? 4 : shellSize({ ...shell, kind });
    offset = end;
  }
  if (integer('Number of basis functions', 2000) !== nbasis) throw new Error('FCHK basis dimensions do not agree.');
  document.basis = basis;
  if (!data.has('Alpha MO coefficients')) {
    if (data.has('Beta MO coefficients')) throw new Error('FCHK alpha orbital data is missing.');
    return document;
  }
  const na = integer('Number of alpha electrons', nbasis, 0), nb = integer('Number of beta electrons', nbasis, 0);
  const unrestricted = data.has('Beta MO coefficients');
  if (data.has('Beta Orbital Energies') !== unrestricted) throw new Error('Incomplete FCHK beta orbital data.');
  const readOrbitals = (spin: MolecularOrbital['spin']) => {
    const prefix = spin === 'alpha' ? 'Alpha' : 'Beta', energies = array(`${prefix} Orbital Energies`), coeffs = array(`${prefix} MO coefficients`, energies.length * nbasis);
    if (energies.length > nbasis || energies.length < Math.max(na, nb)) throw new Error('FCHK orbital count does not match electron occupations.');
    for (let i = 0; i < energies.length; i++) {
      const occupancy = unrestricted ? Number(i < (spin === 'alpha' ? na : nb)) : Number(i < na) + Number(i < nb);
      document.orbitals.push({ index: document.orbitals.length, spin, occupancy, energyHartree: energies[i], coefficients: coeffs.slice(i * nbasis, (i + 1) * nbasis) });
    }
  };
  readOrbitals('alpha'); if (unrestricted) readOrbitals('beta');
  // Restricted open-shell orbitals share coefficients but require separate
  // alpha/beta occupations for a physically meaningful spin-density field.
  if (!unrestricted && na !== nb) {
    const spatial = document.orbitals;
    document.orbitals = spatial.map((o, i) => ({ ...o, occupancy: Number(i < na) }));
    document.orbitals.push(...spatial.map((o, i) => ({ ...o, spin: 'beta' as const, occupancy: Number(i < nb) })));
  }
  document.orbitals.forEach((orbital, index) => { orbital.index = index; });
  return document;
}
