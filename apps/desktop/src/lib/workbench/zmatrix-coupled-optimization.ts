import { atomsFromZmatrixDocument, resolveZmatrixDocument, type ZmatrixDocument } from '../../../../../scripts/zmatrix-document.mjs';
import { placeInReferenceFrame, type CoordinateAtom } from '../../../../../scripts/internal-coordinates.mjs';
import { getEnergy, type MolecularStructure, type OptimizeOptions, type OptimizationResult } from '../molecular-workbench/chemistry';
import { minimize } from '../molecular-workbench/minimizer';
import { zmatrixAtomIndices, zmatrixLockKey } from './zmatrix-optimization';
import { placeWithFrozenAtoms, projectFrozenShape } from './zmatrix-frozen-projection';

export type ZmatrixOptimizeOptions = OptimizeOptions & { frozenRows?: number[]; lockedCoordinates?: string[] };
export type CoupledZmatrixOptimizationResult = OptimizationResult & { definition: ZmatrixDocument };
type Parameter = { name?: string; row?: number; slot?: number; value: number; scale: number; lower: number; upper: number; periodic: boolean; held: boolean };
const DEG = Math.PI / 180;
const distance = (a: number[], b: number[]) => Math.hypot(...a.map((value, i) => value - b[i]));
const coordinates = (molecule: MolecularStructure): CoordinateAtom[] => molecule.atoms.map(({ element, x, y, z }) => ({ element, position: [x, y, z] }));
const wrap = (value: number) => value > 180 ? value - 360 * Math.ceil((value - 180) / 360) : value < -180 ? value + 360 * Math.ceil((-180 - value) / 360) : value;

/**
 * Optimize the actual force-field energy on the geometry defined by the rows.
 * Each signed use of a variable is one degree of freedom; holding any use holds
 * all of them. Dummy points contribute placement only, never force-field atoms.
 * Frozen atoms add exact shape equations, rather than a harmonic penalty.
 */
export function optimizeZmatrix(molecule: MolecularStructure, definition: ZmatrixDocument, options: ZmatrixOptimizeOptions = {}): CoupledZmatrixOptimizationResult {
  const method = options.method ?? 'lbfgs', iterations = options.maxIterations ?? 250;
  if (!['lbfgs', 'fire', 'abc-fire', 'hybrid'].includes(method) || !Number.isInteger(iterations) || iterations < 1 || iterations > 1000) throw new Error('Invalid optimization method or iteration limit.');
  if (molecule.atoms.length > 64 || definition.rows.length > 64) throw new Error('Coupled Z-matrix optimization supports up to 64 atoms and rows.');
  if (options.constraints?.length) throw new Error('Use Z-matrix row freezes and coordinate locks for coupled optimization.');
  const before = coordinates(molecule), canonical = atomsFromZmatrixDocument(definition), resolved = resolveZmatrixDocument(definition);
  if (before.length !== canonical.length || before.some((atom, i) => atom.element !== canonical[i].element)) throw new Error('The optimized structure does not match the Z-matrix atoms.');
  const aligned = placeInReferenceFrame(canonical, before);
  if (aligned.some((atom, i) => distance(atom.position, before[i].position) > 1e-6)) throw new Error('The current geometry no longer matches this Z-matrix definition.');
  const rowAtoms = zmatrixAtomIndices(definition), frozenRows = new Set(options.frozenRows ?? []), locked = new Set(options.lockedCoordinates ?? []);
  for (const row of frozenRows) if (!Number.isInteger(row) || rowAtoms[row] === undefined || rowAtoms[row] === null) throw new Error('Only real atom rows can be frozen.');
  for (const key of locked) {
    const [row, slot] = key.split(':').map(Number);
    if (key !== zmatrixLockKey(row, slot) || !Number.isInteger(row) || !Number.isInteger(slot) || definition.rows[row]?.values[slot] === undefined) throw new Error('A locked Z-matrix coordinate no longer exists.');
  }
  const frozen = [...frozenRows].map(row => rowAtoms[row] as number);
  const parameters: Parameter[] = [], named = new Map<string, Parameter>();
  definition.rows.forEach((row, index) => row.values.forEach((token, slot) => {
    const name = typeof token === 'string' ? token.replace(/^[+-]/u, '') : undefined;
    let parameter = name ? named.get(name) : undefined;
    if (!parameter) {
      parameter = { name, row: index, slot, value: typeof token === 'number' ? token : definition.variables.find(variable => variable.name === name)!.value,
        scale: slot === 0 ? 1 : 1 / DEG, lower: -Infinity, upper: Infinity, periodic: true, held: false };
      parameters.push(parameter);
      if (name) named.set(name, parameter);
    }
    const sign = typeof token === 'string' && token.startsWith('-') ? -1 : 1;
    const [lower, upper] = slot === 0 ? [1e-7, 1e6] : slot === 1 ? [0, 180] : [-180, 180];
    if (slot !== 2) parameter.periodic = false;
    parameter.lower = Math.max(parameter.lower, sign > 0 ? lower : -upper);
    parameter.upper = Math.min(parameter.upper, sign > 0 ? upper : -lower);
    // Numeric dummy coordinates describe a reference frame; do not optimize its
    // arbitrary size. A named value used there still couples every use.
    if (locked.has(zmatrixLockKey(index, slot)) || (!name && (row.element === 'X' || (slot === 2 && [0, 180].includes(resolved[index].values[1]))))) parameter.held = true;
  }));
  const movable = parameters.filter(parameter => !parameter.held);
  if (movable.length > 192) throw new Error('Too many coupled Z-matrix coordinates.');
  const initial = movable.map(parameter => parameter.value / parameter.scale);
  const decode = (x: number[]): ZmatrixDocument => {
    const document = { rows: definition.rows.map(row => ({ ...row, refs: [...row.refs], values: [...row.values] })), variables: definition.variables.map(variable => ({ ...variable })) };
    movable.forEach((parameter, i) => {
      const raw = x[i] * parameter.scale;
      const bounded = parameter.periodic ? wrap(raw) : Math.min(parameter.upper, Math.max(parameter.lower, raw));
      // Preserve unchanged authored values within the binding agreement tolerance,
      // including the equivalent -180/+180 representations of a torsion.
      const difference = bounded - parameter.value;
      const value = Math.abs(parameter.periodic ? wrap(difference) : difference) < 1e-8 ? parameter.value : bounded;
      if (parameter.name) document.variables.find(variable => variable.name === parameter.name)!.value = value;
      else document.rows[parameter.row!].values[parameter.slot!] = value;
    });
    return document;
  };
  const pairs = frozen.flatMap((a, i) => frozen.slice(0, i).map(b => ({ a, b, target: distance(before[a].position, before[b].position) })));
  const residuals = (x: number[]) => {
    const atoms = atomsFromZmatrixDocument(decode(x));
    return pairs.map(({ a, b, target }) => distance(atoms[a].position, atoms[b].position) - target);
  };
  const project = (x: number[]) => pairs.length ? projectFrozenShape(x, residuals) : x;
  const unpack = (x: number[]) => {
    const document = decode(project(x)), atoms = atomsFromZmatrixDocument(document);
    const positions = placeWithFrozenAtoms(atoms.map(atom => atom.position), before.map(atom => atom.position), frozen);
    const placed = atoms.map((atom, i) => ({ ...atom, position: positions[i] }));
    // Rigid transforms incur roundoff even for an unchanged geometry. Keep
    // exact source positions at that scale so a no-op does not create Undo.
    placed.forEach((atom, i) => { if (distance(atom.position, before[i].position) < 1e-12) placed[i] = before[i]; });
    for (const i of frozen) {
      if (distance(placed[i].position, before[i].position) > 1e-7) throw new Error('The frozen atoms could not be preserved.');
      placed[i] = before[i];
    }
    return { document, atoms: placed.map(({ element, position: [x, y, z] }) => ({ element, x, y, z })) };
  };
  const initialEnergy = getEnergy(molecule, options.forceField);
  const evaluate = (x: number[]) => getEnergy({ ...molecule, atoms: unpack(x).atoms }, options.forceField);
  const objective = (x: number[]) => ({ energy: evaluate(x), gradient: x.map((value, i) => {
    const sample = x.slice(), h = 1e-5;
    sample[i] = value + h; const plus = evaluate(sample);
    sample[i] = value - h; const minus = evaluate(sample);
    return (plus - minus) / (2 * h);
  }) });
  const frames: NonNullable<OptimizationResult['frames']> = [{ atoms: molecule.atoms.map(atom => ({ ...atom })), energy: initialEnergy }];
  const result = initial.length && frozen.length < molecule.atoms.length ? minimize(initial, objective, method, iterations, x => {
    const atoms = unpack(x).atoms;
    frames.push({ atoms, energy: getEnergy({ ...molecule, atoms }, options.forceField) });
  }) : { x: initial, converged: true, iterations: 0 };
  const output = unpack(result.x), energy = getEnergy({ ...molecule, atoms: output.atoms }, options.forceField);
  if (!Number.isFinite(energy) || energy > initialEnergy + 1e-6) throw new Error('Coupled Z-matrix optimization did not lower the energy.');
  frames.push({ atoms: output.atoms, energy });
  return { molecule: { ...molecule, atoms: output.atoms }, definition: output.document, initialEnergy, energy, unit: 'kcal/mol',
    converged: result.converged, constraintResiduals: [], frames, method, iterations: result.iterations, forceField: options.forceField ?? 'MMFF94' };
}
