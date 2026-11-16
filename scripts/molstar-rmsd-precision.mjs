import { molstarPatchPlugin } from './molstar-source.mjs';

export function patchMolstarRmsdPrecision(source) {
  const before = '    this.evdCache = EVD.createCache(4);';
  if (source.split(before).length !== 2) {
    throw new Error('Mol* RMSD state changed; review alignment precision before vendoring.');
  }
  // EVD defaults to Float32 storage; alignment must retain double precision in
  // both its accumulated quaternion matrix and the resulting eigenvectors.
  return source.replace(before, `${before}\n    this.evdCache.matrix = Matrix.create(4, 4, Float64Array);`);
}

export const molstarRmsdPrecisionPlugin = molstarPatchPlugin(
  'molstar-rmsd-precision', '@molstar/core/math/linear-algebra/3d/minimize-rmsd', patchMolstarRmsdPrecision,
);
