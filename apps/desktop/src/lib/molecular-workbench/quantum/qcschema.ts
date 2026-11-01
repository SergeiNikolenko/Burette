import { readQcschemaSpectra } from '../scientific-spectra-inputs';
import { validateParsedSpectra } from '../parsed-spectral-document';
import type { ScientificSpectra } from '../scientific-spectra';
import { atomicNumber } from '../elements';
import { hessianFromSquare } from '../hessian';
import type { GaussianShell, MolecularOrbital, ScientificDocument, ScientificFrame } from '../scientific-types';
import { readQcschemaWavefunction } from './qcschema-wavefunction';
import type { Vec3 } from '../types';
import { BOHR, checkIdentity, coordinate, finite, MAX_ATOMS, MAX_FRAMES, MAX_VALUES } from './reader-values';

const HARTREE_KCAL_MOL = 627.5094740631;
type JsonObject = Record<string, unknown>;
function object(value: unknown): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('QCSchema requires an object.');
  return value as JsonObject;
}
function array(value: unknown, count: number, label: string): unknown[] {
  if (!Array.isArray(value) || value.length !== count) throw new Error(`Invalid QCSchema ${label} dimensions.`);
  return value;
}
function schema(data: JsonObject, name: string, version: number, embedded = false) {
  if ((data.schema_name !== name || data.schema_version !== version) && !(embedded && data.schema_name === undefined && data.schema_version === undefined)) throw new Error(`Unsupported QCSchema ${name} version.`);
}
function molecule(value: unknown, embedded = true) {
  const data = object(value);
  schema(data, 'qcschema_molecule', 2, embedded);
  const symbols = data.symbols;
  if (!Array.isArray(symbols) || !symbols.length || symbols.length > MAX_ATOMS) throw new Error('QCSchema molecule exceeds atom limit or has no symbols.');
  const geometry = array(data.geometry, 3 * symbols.length, 'geometry').map(finite);
  // QCSchema uses bohr, regardless of display conventions in the producing program.
  if (data.units !== undefined && data.units !== 'bohr') throw new Error('QCSchema geometry must use bohr.');
  if (data.real !== undefined && array(data.real, symbols.length, 'real').some(v => v !== true)) throw new Error('QCSchema ghost atoms are not supported.');
  const atoms = symbols.map((element, i) => {
    if (typeof element !== 'string') throw new Error('Invalid QCSchema element symbol.');
    return coordinate(element, geometry.slice(i * 3, i * 3 + 3), BOHR);
  });
  if (data.atomic_numbers !== undefined && array(data.atomic_numbers, atoms.length, 'atomic numbers').some((z, i) => z !== atomicNumber(atoms[i].element))) throw new Error('QCSchema atomic numbers disagree with symbols.');
  const identity: Identity = {};
  for (const key of ['masses', 'mass_numbers', 'atom_labels'] as const) {
    if (data[key] === undefined) continue;
    const values = array(data[key], atoms.length, key);
    if (key === 'atom_labels' ? values.some(v => typeof v !== 'string' || v.length > 256)
      : values.some(v => typeof v !== 'number' || !Number.isFinite(v) || v <= 0 || v > 1000 || (key === 'mass_numbers' && !Number.isInteger(v)))) throw new Error(`Invalid QCSchema ${key}.`);
    identity[key] = values;
  }
  return { atoms, identity, masses: identity.masses as number[] | undefined };
}
type Identity = Partial<Record<'masses' | 'mass_numbers' | 'atom_labels', unknown[]>>;
/** Programs echo molecules with their default masses and labels filled in, while optimizers may
 * leave them unset; `stated` compares only fields both molecules state. */
function sameIdentity(a: Identity, b: Identity, stated = false) {
  return (['masses', 'mass_numbers', 'atom_labels'] as const).every(key => (stated && (!a[key] || !b[key])) || JSON.stringify(a[key]) === JSON.stringify(b[key]));
}
type Wavefunction = { basis: GaussianShell[]; orbitals: MolecularOrbital[] };
function atomicResult(value: unknown, name: string): ScientificFrame & { identity: Identity; propertySpectra?: ScientificSpectra; wavefunction?: Wavefunction } {
  const data = object(value);
  if (data.schema_name !== 'qcschema_output' && data.schema_name !== 'qc_schema_output') throw new Error('Unsupported QCSchema atomic result schema.');
  schema(data, data.schema_name, 1);
  if (data.success !== true) throw new Error('QCSchema calculation did not succeed.');
  const { atoms, identity, masses } = molecule(data.molecule);
  const frame: ScientificFrame & { identity: Identity; wavefunction?: Wavefunction } = { atoms, identity };
  const properties = data.properties === undefined ? {} : object(data.properties);
  if (properties.calcinfo_natom !== undefined && properties.calcinfo_natom !== atoms.length) throw new Error('QCSchema atom count disagrees with molecule.');
  if (properties.return_energy !== undefined) frame.energyHartree = finite(properties.return_energy);
  if (data.driver === 'energy') {
    const energy = finite(data.return_result);
    if (frame.energyHartree !== undefined && Math.abs(frame.energyHartree - energy) > 1e-8) throw new Error('QCSchema return energies disagree.');
    frame.energyHartree = energy;
  } else if (data.driver === 'gradient') {
    const gradient = array(data.return_result, 3 * atoms.length, 'gradient').map(finite);
    const reported = properties.return_gradient == null ? null : array(properties.return_gradient, gradient.length, 'return gradient').map(finite);
    if (reported?.some((value, i) => value !== gradient[i])) throw new Error('QCSchema return gradients disagree.');
    frame.forcesKcalMolAngstrom = atoms.map((_, i) => gradient.slice(3 * i, 3 * i + 3).map(v => finite(-v * HARTREE_KCAL_MOL / BOHR)) as Vec3);
  } else if (data.driver === 'hessian') {
    // Hartree/bohr², (3N, 3N); QCElemental serializes it flat or nested.
    const raw = Array.isArray(data.return_result) && Array.isArray(data.return_result[0]) ? array(data.return_result, 3 * atoms.length, 'Hessian').flatMap(row => array(row, 3 * atoms.length, 'Hessian')) : data.return_result;
    const values = array(raw, 9 * atoms.length * atoms.length, 'Hessian').map(finite);
    frame.hessian = hessianFromSquare(values, atoms.length, 'qcschema', masses);
  } else if (data.driver === 'properties') {
    object(data.return_result);
  } else throw new Error('Unsupported QCSchema driver.');
  if (data.wavefunction != null) frame.wavefunction = readQcschemaWavefunction(data.wavefunction, atoms.length, { alpha: properties.calcinfo_nalpha, beta: properties.calcinfo_nbeta });
  return { ...frame, propertySpectra: readQcschemaSpectra(data.properties, { name, format: 'qcschema', scope: 'file' }, atoms.map(atom => atomicNumber(atom.element))) };
}
/** Most steps each `protocols.trajectory` value keeps. */
const TRAJECTORY_PROTOCOLS = new Map<unknown, number>([['all', MAX_FRAMES], ['final', 1], ['initial_and_final', 2], ['none', 0]]);
/** Optimizers echo the input geometry with symmetrization noise (~1e-17 bohr). */
function sameGeometry(a: ScientificFrame, b: ScientificFrame) {
  return a.atoms.every((atom, i) => Math.abs(atom.x - b.atoms[i].x) < 1e-10 && Math.abs(atom.y - b.atoms[i].y) < 1e-10 && Math.abs(atom.z - b.atoms[i].z) < 1e-10);
}
/** MolSSI QCSchema molecule v2, atomic result v1 and optimization result v1.
 * Geometry: bohr; energy: Hartree; gradient: Hartree/bohr (negative force).
 * https://github.com/MolSSI/QCSchema and https://github.com/MolSSI/QCElemental/blob/master/qcelemental/models/v1/procedures.py
 */
export function parseQcschema(text: string, name = "QCSchema input"): ScientificDocument {
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new Error('Invalid or truncated QCSchema JSON.'); }
  const data = object(parsed);
  let frames: Array<ScientificFrame & { propertySpectra?: ScientificSpectra }>;
  let converged: boolean | undefined, wavefunction: Wavefunction | undefined;
  if (data.schema_name === 'qcschema_molecule') {
    frames = [{ atoms: molecule(data, false).atoms }];
  } else if (data.schema_name === 'qcschema_optimization_output') {
    schema(data, 'qcschema_optimization_output', 1);
    if (data.success !== true) throw new Error('QCSchema optimization did not succeed.');
    const initial = molecule(data.initial_molecule), final = molecule(data.final_molecule);
    const trajectory = data.trajectory;
    // protocols.trajectory may keep only some gradient steps; `energies` always lists every step.
    const kept = data.protocols == null ? 'all' : object(data.protocols).trajectory ?? 'all';
    const keptSteps = TRAJECTORY_PROTOCOLS.get(kept);
    if (keptSteps === undefined) throw new Error('Unsupported QCSchema trajectory protocol.');
    if (!Array.isArray(trajectory) || (kept === 'all' && !trajectory.length) || trajectory.length > keptSteps) throw new Error('QCSchema optimization requires a bounded explicit trajectory.');
    if (!Array.isArray(data.energies) || !data.energies.length || data.energies.length > MAX_FRAMES || (kept === 'all' && data.energies.length !== trajectory.length)) throw new Error('Invalid QCSchema optimization energies dimensions.');
    const energies = data.energies.map(finite);
    const energyIndex = (i: number) => kept === 'all' ? i : kept === 'final' || i > 0 ? energies.length - 1 : 0;
    let retainedValues = 0;
    const steps = trajectory.map(value => {
      const step = atomicResult(value, name);
      retainedValues += step.atoms.length * 3;
      if (retainedValues > MAX_VALUES) throw new Error('QCSchema trajectory exceeds browser limit.');
      return step;
    });
    for (const [i, step] of steps.entries()) {
      checkIdentity(step.atoms, initial.atoms);
      if (!sameIdentity(step.identity, steps[0].identity) || !sameIdentity(step.identity, initial.identity, true)) throw new Error('QCSchema isotope or atom labels change between frames.');
      if (step.energyHartree !== undefined && Math.abs(step.energyHartree - energies[energyIndex(i)]) > 1e-8) throw new Error('QCSchema trajectory energies disagree.');
      step.energyHartree = energies[energyIndex(i)];
    }
    checkIdentity(final.atoms, initial.atoms);
    if (!sameIdentity(final.identity, initial.identity)) throw new Error('QCSchema final atom identity disagrees with initial molecule.');
    frames = steps.map(({ identity: _, wavefunction: __, ...frame }) => frame);
    // energies[0] belongs to the initial geometry; it is only unclaimed when the first step was not kept.
    const initialFrame = kept === 'all' ? { atoms: initial.atoms } : { atoms: initial.atoms, energyHartree: energies[0] };
    if (!frames.length || !sameGeometry({ atoms: initial.atoms }, frames[0])) frames.unshift(initialFrame);
    // A producer may omit the final geometry from trajectory. Retain it as a
    // separate frame, never move the last step's gradient/energy onto it.
    if (!sameGeometry({ atoms: final.atoms }, frames.at(-1)!)) frames.push({ atoms: final.atoms });
    else wavefunction = steps.at(-1)?.wavefunction;
    converged = true;
  } else {
    const { identity: _, wavefunction: result, ...frame } = atomicResult(data, name);
    frames = [frame];
    wavefunction = result;
  }
  if (frames.length > MAX_FRAMES || frames.reduce((sum, f) => sum + f.atoms.length * 3, 0) > MAX_VALUES) throw new Error('QCSchema trajectory exceeds browser limit.');
  const ownedFrames = frames.map(({ propertySpectra, ...frame }, frameIndex) => propertySpectra ? { ...frame, spectra: { ...propertySpectra,
    source: { ...propertySpectra.source, scope: 'frame' as const, frameIndex, frameCount: frames.length } } } : frame);
  return validateParsedSpectra({ format: 'qcschema', atoms: frames.at(-1)!.atoms, referenceFrameIndex: frames.length - 1, frames: ownedFrames, modes: [], orbitals: wavefunction?.orbitals ?? [], ...(wavefunction ? { basis: wavefunction.basis } : {}), ...(converged === undefined ? {} : { converged }) });
}
