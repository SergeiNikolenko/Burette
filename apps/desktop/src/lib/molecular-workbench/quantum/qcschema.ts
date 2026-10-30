import { readQcschemaSpectra } from '../scientific-spectra-inputs';
import { validateParsedSpectra } from '../parsed-spectral-document';
import type { ScientificSpectra } from '../scientific-spectra';
import { atomicNumber } from '../elements';
import type { ScientificDocument, ScientificFrame } from '../scientific-types';
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
  const identity: Record<string, unknown> = {};
  for (const key of ['masses', 'mass_numbers', 'atom_labels'] as const) {
    if (data[key] === undefined) continue;
    const values = array(data[key], atoms.length, key);
    if (key === 'atom_labels' ? values.some(v => typeof v !== 'string' || v.length > 256)
      : values.some(v => typeof v !== 'number' || !Number.isFinite(v) || v <= 0 || v > 1000 || (key === 'mass_numbers' && !Number.isInteger(v)))) throw new Error(`Invalid QCSchema ${key}.`);
    identity[key] = values;
  }
  return { atoms, identity: JSON.stringify(identity) };
}
function atomicResult(value: unknown, name: string): ScientificFrame & { identity: string; propertySpectra?: ScientificSpectra } {
  const data = object(value);
  if (data.schema_name !== 'qcschema_output' && data.schema_name !== 'qc_schema_output') throw new Error('Unsupported QCSchema atomic result schema.');
  schema(data, data.schema_name, 1);
  if (data.success !== true) throw new Error('QCSchema calculation did not succeed.');
  const { atoms, identity } = molecule(data.molecule);
  const frame: ScientificFrame & { identity: string } = { atoms, identity };
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
  } else if (data.driver === 'properties') {
    object(data.return_result);
  } else throw new Error('QCSchema reader supports energy, gradient and properties results; Hessian and wavefunction import are not supported.');
  return { ...frame, propertySpectra: readQcschemaSpectra(data.properties, { name, format: 'qcschema', scope: 'file' }, atoms.map(atom => atomicNumber(atom.element))) };
}
function sameGeometry(a: ScientificFrame, b: ScientificFrame) {
  return a.atoms.every((atom, i) => atom.x === b.atoms[i].x && atom.y === b.atoms[i].y && atom.z === b.atoms[i].z);
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
  let converged: boolean | undefined;
  if (data.schema_name === 'qcschema_molecule') {
    frames = [{ atoms: molecule(data, false).atoms }];
  } else if (data.schema_name === 'qcschema_optimization_output') {
    schema(data, 'qcschema_optimization_output', 1);
    if (data.success !== true) throw new Error('QCSchema optimization did not succeed.');
    const initial = molecule(data.initial_molecule), final = molecule(data.final_molecule);
    const trajectory = data.trajectory;
    if (!Array.isArray(trajectory) || !trajectory.length || trajectory.length > MAX_FRAMES) throw new Error('QCSchema optimization requires a bounded explicit trajectory.');
    const energies = array(data.energies, trajectory.length, 'optimization energies').map(finite);
    let retainedValues = 0;
    const steps = trajectory.map(value => {
      const step = atomicResult(value, name);
      retainedValues += step.atoms.length * 3;
      if (retainedValues > MAX_VALUES) throw new Error('QCSchema trajectory exceeds browser limit.');
      return step;
    });
    for (const [i, step] of steps.entries()) {
      checkIdentity(step.atoms, initial.atoms);
      if (step.identity !== initial.identity) throw new Error('QCSchema isotope or atom labels change between frames.');
      if (step.energyHartree !== undefined && Math.abs(step.energyHartree - energies[i]) > 1e-8) throw new Error('QCSchema trajectory energies disagree.');
      step.energyHartree = energies[i];
    }
    checkIdentity(final.atoms, initial.atoms);
    if (final.identity !== initial.identity) throw new Error('QCSchema final atom identity disagrees with initial molecule.');
    frames = steps.map(({ identity: _, ...frame }) => frame);
    if (!sameGeometry({ atoms: initial.atoms }, frames[0])) frames.unshift({ atoms: initial.atoms });
    // A producer may omit the final geometry from trajectory. Retain it as a
    // separate frame, never move the last step's gradient/energy onto it.
    if (!sameGeometry({ atoms: final.atoms }, frames.at(-1)!)) frames.push({ atoms: final.atoms });
    converged = true;
  } else {
    const { identity: _, ...frame } = atomicResult(data, name);
    frames = [frame];
  }
  if (frames.length > MAX_FRAMES || frames.reduce((sum, f) => sum + f.atoms.length * 3, 0) > MAX_VALUES) throw new Error('QCSchema trajectory exceeds browser limit.');
  const ownedFrames = frames.map(({ propertySpectra, ...frame }, frameIndex) => propertySpectra ? { ...frame, spectra: { ...propertySpectra,
    source: { ...propertySpectra.source, scope: 'frame' as const, frameIndex, frameCount: frames.length } } } : frame);
  return validateParsedSpectra({ format: 'qcschema', atoms: frames.at(-1)!.atoms, frames: ownedFrames, modes: [], orbitals: [], ...(converged === undefined ? {} : { converged }) });
}
