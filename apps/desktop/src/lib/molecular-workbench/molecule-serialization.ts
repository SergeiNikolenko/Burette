import { Molecule } from 'openchemlib';

/** OCL's generic writer scales planar coordinates to diagram bond lengths.
 * Retain its graph/stereo/charge encoding but write physical Å coordinates.
 * Our molecule coordinates are already in the physical source/viewer frame;
 * bypass the generic writer's y/z rotation as well as its diagram scaling. */
export function serializePhysicalMolfile(mol: Molecule): string {
  let inAtoms = false, inBonds = false;
  const unknownStereo = new Set<number>();
  const source = mol.toMolfileV3();
  const requiredUnknown = Array.from({ length: mol.getAllAtoms() }, (_, i) => i).filter(i => mol.isAtomConfigurationUnknown(i) || mol.getAtomParity(i) === Molecule.cAtomParityUnknown);
  const output = source.split('\n').map((line, index) => {
    if (index === 1) return line.replace(/\b2D\b/, '3D');
    if (line === 'M  V30 BEGIN BOND') inBonds = true;
    else if (line === 'M  V30 END BOND') inBonds = false;
    else if (inBonds) {
      // OCL omits explicit unknown atom stereo in V3000. A standard wavy
      // outgoing single bond (at an allene terminal when axial) prevents 3D coordinates from choosing an enantiomer.
      const bond = /^(M  V30 \d+ 1 )(\d+) (\d+)(.*)$/.exec(line);
      if (bond && !/\bCFG=/u.test(bond[4])) {
        const ends = [Number(bond[2]) - 1, Number(bond[3]) - 1];
        const center = ends.map(i => mol.findAlleneCenterAtom(i)).map((i, n) => i < 0 ? ends[n] : i);
        const endpoint = center.findIndex(i => (mol.isAtomConfigurationUnknown(i) || mol.getAtomParity(i) === Molecule.cAtomParityUnknown) && !unknownStereo.has(i));
        const atom = endpoint < 0 ? undefined : center[endpoint];
        if (atom !== undefined) {
          unknownStereo.add(atom);
          const from = ends[endpoint], other = ends[1 - endpoint];
          return `${bond[1]}${from + 1} ${other + 1}${bond[4]} CFG=2`;
        }
      }
    }
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
  if (requiredUnknown.some(i => !unknownStereo.has(i))) throw new Error('This unknown stereo center cannot be serialized without choosing a configuration.');
  return output;
}
