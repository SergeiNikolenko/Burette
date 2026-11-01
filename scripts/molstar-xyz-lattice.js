import { readUnitCell } from '../apps/desktop/src/lib/molecular-workbench/crystal.ts';
import { ModelSymmetry } from '@molstar/model/formats/structure/property/symmetry';
import { Spacegroup } from '@molstar/core/math/geometry';
import { Mat4, Vec3 } from '@molstar/core/math/linear-algebra';

/** Optional native cell metadata must not tighten ordinary XYZ atom admission. */
export function attachXyzLattice(model, comment) {
  // Consume complete quoted values even for unknown metadata before looking for another key.
  const attributes = [], keyPattern = /([^\s="'\\]+)\s*=\s*/y;
  for (let index = 0; index < comment.length;) {
    while (index < comment.length && /\s/.test(comment[index])) index++;
    keyPattern.lastIndex = index;
    const key = keyPattern.exec(comment);
    if (key) index = keyPattern.lastIndex;
    const start = index;
    let quote, closing = -1, quotes = 0;
    for (; index < comment.length; index++) {
      const character = comment[index];
      if (quote) {
        if (character === '\\') { index++; continue; }
        if (character === quote) { quote = undefined; closing = index; }
      } else if (character === '"' || character === "'") { quote = character; quotes++; }
      else if (/\s/.test(character)) break;
    }
    if (!key) continue;
    const name = key[1].toLowerCase();
    if (quote) {
      if (name === 'lattice' || name === 'pbc') return;
      continue; // An unknown unterminated value owns the remaining comment.
    }
    const token = comment.slice(start, index);
    const delimiter = quotes === 1 && closing === index - 1 && (token[0] === '"' || token[0] === "'") ? token[0] : undefined;
    attributes.push({ name, value: delimiter ? token.slice(1, -1) : token, delimiter });
  }
  const lattice = attributes.filter(attribute => attribute.name === 'lattice');
  const pbc = attributes.filter(attribute => attribute.name === 'pbc');
  if (lattice.length !== 1 || lattice[0].delimiter !== '"' || pbc.length > 1
      || (pbc.length === 1 && !/^(?:T|true|1)\s+(?:T|true|1)\s+(?:T|true|1)$/i.test(pbc[0].value))) return;
  let basis;
  try { basis = readUnitCell(`Lattice="${lattice[0].value}"`); }
  catch { return; } // Malformed optional metadata remains available in the raw source.
  const fromFractional = Mat4.ofRows([
    [basis[0][0], basis[1][0], basis[2][0], 0],
    [basis[0][1], basis[1][1], basis[2][1], 0],
    [basis[0][2], basis[1][2], basis[2][2], 0],
    [0, 0, 0, 1],
  ]);
  // Preserve the full source frame, including handedness; size/angles alone lose it.
  const cell = {
    ...Spacegroup.ZeroP1.cell,
    size: Vec3.create(...basis.map(vector => Vec3.magnitude(vector))),
    anglesInRadians: Vec3.create(Vec3.angle(basis[1], basis[2]), Vec3.angle(basis[0], basis[2]), Vec3.angle(basis[0], basis[1])),
    volume: Math.abs(Mat4.determinant(fromFractional)),
    fromFractional,
    toFractional: Mat4.invert(Mat4.zero(), fromFractional),
  };
  // Native XYZ frames may share static properties; the cell belongs to this frame.
  model._staticPropertyData = { ...model._staticPropertyData };
  ModelSymmetry.Provider.set(model, { spacegroup: Spacegroup.create(cell), assemblies: [], isNonStandardCrystalFrame: false, ncsOperators: [] });
}
