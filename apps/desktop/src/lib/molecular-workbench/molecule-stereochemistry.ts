import { Molecule } from 'openchemlib';

/** Read unspecified stereo at the parsed MOL boundary, before any coordinate-frame conversion. */
export function readUnspecifiedMolfileStereo(mol: Molecule, text: string, sourceMap: readonly number[]) {
  // OCL interprets wavy single bonds as AND stereo; retain the source's unspecified constraint.
  mol.ensureHelperArrays(Molecule.cHelperCIP);
  const unknownAtoms = new Set(Array.from({ length: mol.getAllAtoms() }, (_, i) => i).filter(i => mol.getAtomParity(i) === Molecule.cAtomParityUnknown));
  const unknownBonds = new Set(Array.from({ length: mol.getAllBonds() }, (_, b) => b).filter(b => mol.getBondParity(b) === Molecule.cBondParityUnknown));
  const lines = text.replace(/\r\n?/g, '\n').replace(/-\nM  V30 /g, '').split('\n');
  if (lines[3]?.includes('V3000')) {
    const begin = lines.indexOf('M  V30 BEGIN ATOM'), end = lines.indexOf('M  V30 END ATOM');
    const ids = new Map(lines.slice(begin + 1, end).map((line, i) => [Number(/^M  V30 (\d+)/.exec(line)?.[1]), i]));
    let bonds = false;
    for (const line of lines) {
      if (line === 'M  V30 BEGIN BOND') bonds = true;
      else if (line === 'M  V30 END BOND') bonds = false;
      else if (bonds) {
        const wavy = /^M  V30 \d+ ([12]) (\d+) (\d+).*\bCFG=2(?:\s|$)/u.exec(line);
        if (wavy && ids.has(Number(wavy[2])) && ids.has(Number(wavy[3]))) {
          const a = sourceMap[ids.get(Number(wavy[2]))!], b = sourceMap[ids.get(Number(wavy[3]))!];
          if (wavy[1] === '1') unknownAtoms.add(mol.findAlleneCenterAtom(a) < 0 ? a : mol.findAlleneCenterAtom(a)); else unknownBonds.add(mol.getBond(a, b));
        }
      }
    }
  } else if (lines[3]?.includes('V2000')) {
    const count = Number(lines[3].slice(0, 3)), bonds = Number(lines[3].slice(3, 6));
    for (const line of lines.slice(4 + count, 4 + count + bonds)) {
      const a = sourceMap[Number(line.slice(0, 3)) - 1], b = sourceMap[Number(line.slice(3, 6)) - 1];
      if (Number(line.slice(6, 9)) === 1 && Number(line.slice(9, 12)) === 4) unknownAtoms.add(mol.findAlleneCenterAtom(a) < 0 ? a : mol.findAlleneCenterAtom(a));
      if (Number(line.slice(6, 9)) === 2 && Number(line.slice(9, 12)) === 3) unknownBonds.add(mol.getBond(a, b));
    }
  }
  return { atoms: [...unknownAtoms], bonds: [...unknownBonds] };
}

// Unknown source constraints survive a chosen 3D pose and the toolkit's AND-stereo parser convention.
export function retainUnknownStereo(mol: Molecule, atoms: number[], bonds: number[]) {
  atoms.forEach(i => {
    mol.convertStereoBondsToSingleBonds(i);
    // OCL's allene branch scans heavy neighbours only; include terminal explicit H wedges.
    for (let b = 0; b < mol.getAllBonds(); b++) {
      if (mol.isStereoBond(b) && mol.findAlleneCenterAtom(mol.getBondAtom(0, b)) === i) mol.setBondType(b, Molecule.cBondTypeSingle);
    }
  });
  mol.ensureHelperArrays(Molecule.cHelperRings);
  atoms.forEach(i => {
    mol.setAtomConfigurationUnknown(i, true); mol.setAtomParity(i, Molecule.cAtomParityUnknown, false);
    mol.setAtomCIPParity(i, Molecule.cAtomCIPParityNone); mol.setAtomESR(i, Molecule.cESRTypeAbs, 0);
  });
  bonds.forEach(b => { mol.setBondParity(b, Molecule.cBondParityUnknown, false); mol.setBondCIPParity(b, Molecule.cBondCIPParityNone); });
  mol.setParitiesValid(Molecule.cHelperBitCIP);
}
