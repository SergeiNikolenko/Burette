import { createEnergyEvaluator, type MolecularStructure, type OptimizeOptions, type OptimizationResult } from './chemistry';
import { minimize } from './minimizer';
import { measureGeometry } from '../../../../../scripts/molecular-geometry.js';

/** Finite-difference force-field objective with exact Cartesian freezes and harmonic
 * coordinate restraints; method controls the actual numerical iteration. */
export function optimizeWithMethod(molecule: MolecularStructure, options: OptimizeOptions): OptimizationResult {
  const n = molecule.atoms.length, maxIterations = options.maxIterations ?? 250;
  if (!['lbfgs', 'fire', 'abc-fire', 'hybrid'].includes(options.method ?? 'lbfgs') || !Number.isInteger(maxIterations) || maxIterations < 1 || maxIterations > 1000) throw new Error('Invalid optimization method or iteration limit.');
  if (n > 64 || (options.constraints?.length ?? 0) > 64) throw new Error('Browser numerical optimization supports up to 64 atoms and constraints.');
  const constraints = options.constraints ?? [], frozen = new Set<number>();
  const measure = (atoms: MolecularStructure['atoms'], kind: 'distance' | 'angle' | 'dihedral', indices: number[]) => measureGeometry(kind, indices.map(i => ({ id: String(i), position: [atoms[i].x, atoms[i].y, atoms[i].z] }))).value as number;
  const residual = (value: number, target: number, kind: string) => kind === 'dihedral' ? ((value - target + 540) % 360) - 180 : value - target;
  const restraints = constraints.flatMap(c => {
    const count = { freeze: 1, distance: 2, angle: 3, dihedral: 4 }[c.kind];
    if (!count || c.atoms.length !== count || new Set(c.atoms).size !== count || c.atoms.some(i => !Number.isInteger(i) || i < 0 || i >= n)) throw new Error('Constraint contains invalid atom indices.');
    if (c.kind === 'freeze') { frozen.add(c.atoms[0]); return []; }
    const target = c.target ?? measure(molecule.atoms, c.kind, c.atoms);
    if (!Number.isFinite(target) || (c.kind === 'distance' && target <= 0) || (c.kind === 'angle' && (target <= 0 || target >= 180)) || (c.kind === 'dihedral' && Math.abs(target) > 180)) throw new Error('Constraint target is outside the valid range.');
    return [{ ...c, kind: c.kind, target }];
  });
  const evaluator = createEnergyEvaluator(molecule, options.forceField);
  try {
    const movable = molecule.atoms.flatMap((_, i) => frozen.has(i) ? [] : [i]);
    const unpack = (x: number[]) => {
      const atoms = molecule.atoms.map(a => ({ ...a }));
      movable.forEach((atom, i) => { atoms[atom].x = x[3 * i]; atoms[atom].y = x[3 * i + 1]; atoms[atom].z = x[3 * i + 2]; });
      return atoms;
    };
    const penaltyEnergy = (atoms: MolecularStructure['atoms']) => restraints.reduce((s, c) => s + 1000 * (residual(measure(atoms, c.kind, c.atoms), c.target, c.kind) * (c.kind === 'distance' ? 1 : Math.PI / 180)) ** 2, 0);
    const evaluate = (x: number[]) => {
      const atoms = unpack(x);
      return evaluator.energy(atoms) + penaltyEnergy(atoms);
    };
    const initial = movable.flatMap(i => [molecule.atoms[i].x, molecule.atoms[i].y, molecule.atoms[i].z]);
    const initialEnergy = evaluator.energy(molecule.atoms);
    const objective = (x: number[]) => {
      const atoms = unpack(x), analytic = evaluator.gradient?.(atoms);
      return { energy: evaluator.energy(atoms) + penaltyEnergy(atoms), gradient: x.map((v, i) => {
        if (analytic && !restraints.length) return analytic[movable[Math.floor(i / 3)]][i % 3];
        const sample = x.slice(), h = 1e-4;
        sample[i] = v + h; const plus = analytic ? penaltyEnergy(unpack(sample)) : evaluate(sample);
        sample[i] = v - h; const minus = analytic ? penaltyEnergy(unpack(sample)) : evaluate(sample);
        return (analytic?.[movable[Math.floor(i / 3)]][i % 3] ?? 0) + (plus - minus) / (2 * h);
      }) };
    };
    const trace: NonNullable<OptimizationResult['frames']> = [{ atoms: molecule.atoms.map(a => ({ ...a })), energy: initialEnergy }];
    const result = initial.length ? minimize(initial, objective, options.method ?? 'lbfgs', maxIterations, (x) => {
      const atoms = unpack(x); trace.push({ atoms, energy: evaluator.energy(atoms) });
    }) : { x: [], converged: true, iterations: 0 };
    const atoms = unpack(result.x), energy = evaluator.energy(atoms);
    const constraintResiduals = restraints.map(c => ({ kind: c.kind, error: residual(measure(atoms, c.kind, c.atoms), c.target, c.kind), unit: (c.kind === 'distance' ? 'angstrom' : 'degrees') as 'angstrom' | 'degrees' }));
    const satisfied = constraintResiduals.every(c => Math.abs(c.error) <= (c.unit === 'angstrom' ? .01 : 1));
    trace.push({ atoms, energy });
    // Coordinates stay authoritative in atoms; existing graph metadata and OCL
    // mapping are retained. Serialization is the caller's normal document path.
    return { molecule: { ...molecule, atoms }, initialEnergy, energy, unit: 'kcal/mol', forceField: options.forceField ?? 'MMFF94', converged: result.converged && satisfied, constraintResiduals, frames: trace, method: options.method, iterations: result.iterations };
  } finally { evaluator.dispose(); }
}
