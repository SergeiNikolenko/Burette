import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
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

export const molstarSurfaceFieldCachePlugin = {
  name: 'molstar-surface-field-cache',
  setup(build) {
    build.onLoad({ filter: /molstar\/lib\/mol-repr\/structure\/visual\/util\/molecular-surface\.js$/u }, async ({ path }) => {
      const { version } = JSON.parse(await readFile(resolve(dirname(path), '../../../../../package.json'), 'utf8'));
      if (version !== '5.11.0') throw new Error('Review the surface field cache before upgrading Mol* from 5.11.0.');
      return { contents: patchMolstarSurfaceFieldCache(await readFile(path, 'utf8')), loader: 'js' };
    });
  },
};
