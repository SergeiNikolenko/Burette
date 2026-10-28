import { molstarPatchPlugin } from './molstar-source.mjs';
import { fileURLToPath } from 'node:url';

export function patchMolstarSurfaceFieldCache(source) {
  const call = 'return await MolecularSurface(ctx, position, boundary, maxRadius, boundary.box, p);';
  // The first call belongs to the unit path; the whole-structure path is left
  // alone. Changing that layout requires reviewing identity and input coverage.
  if (source.split(call).length !== 3 || source.includes('buretteSurfaceFields')) {
    throw new Error('Mol* molecular-surface layout changed; review field cache inputs.');
  }
  const module = fileURLToPath(new URL('./molstar-surface-field-cache.js', import.meta.url));
  return `import { MolecularSurfaceFieldCache } from ${JSON.stringify(module)};\n`
    + 'const buretteSurfaceFields = new MolecularSurfaceFieldCache(64 * 1024 * 1024);\n'
    + source.replace(call, 'return buretteSurfaceFields.getOrCreate(unit, { position, boundary, maxRadius, props: p }, () => MolecularSurface(ctx, position, boundary, maxRadius, boundary.box, p));');
}

export const molstarSurfaceFieldCachePlugin = molstarPatchPlugin(
  'molstar-surface-field-cache',
  '@molstar/graphics/repr/structure/visual/util/molecular-surface',
  patchMolstarSurfaceFieldCache,
);
