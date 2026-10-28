import type { Molecule } from 'openchemlib';

/** OCL's generic writer scales planar coordinates to diagram bond lengths.
 * Retain its graph/stereo/charge encoding but write physical Å coordinates.
 * Our molecule coordinates are already in the physical source/viewer frame;
 * bypass the generic writer's y/z rotation as well as its diagram scaling. */
export function serializePhysicalMolfile(mol: Molecule): string {
  let inAtoms = false;
  return mol.toMolfileV3().split('\n').map((line, index) => {
    if (index === 1) return line.replace(/\b2D\b/, '3D');
    if (line === 'M  V30 BEGIN ATOM') inAtoms = true;
    else if (line === 'M  V30 END ATOM') inAtoms = false;
    else if (inAtoms) return line.replace(/^(M  V30 )(\d+)( \S+ )\S+ \S+ \S+( .*)$/, (_, prefix, id, element, suffix) => {
      const atom = Number(id) - 1;
      const xyz = [mol.getAtomX(atom), mol.getAtomY(atom), mol.getAtomZ(atom)];
      if (xyz.some(v => !Number.isFinite(v) || Math.abs(v) > 1e6)) throw new Error('Invalid molecular coordinates during serialization.');
      return `${prefix}${id}${element}${xyz.map(v => Number(v.toFixed(10))).join(' ')}${suffix}`;
    });
    return line;
  }).join('\n');
}
