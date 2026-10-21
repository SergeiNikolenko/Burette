import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

export function patchMolstarSurfaceLoop(source) {
  const changes = [
    ['        const rA = radius[a];',
      '        const idA = id[OrderedSet.indexOf(indices, a)], idB = id[OrderedSet.indexOf(indices, b)];\n        const rA = radius[a];'],
    ['id[OrderedSet.indexOf(indices, dp < 0.0 ? b : a)]', 'dp < 0.0 ? idB : idA'],
    [`                            const dz = pz - gridz[zi];
                            const dSq = dxySq + dz * dz;
                            const idx = zi + xyIdx;
                            const current = data[idx];
                            if (current > 0.0 && dSq < (current * current)) {`,
      `                            const idx = zi + xyIdx;
                            const current = data[idx];
                            if (!(current > 0.0)) continue;
                            const dz = pz - gridz[zi];
                            const dSq = dxySq + dz * dz;
                            if (dSq < (current * current)) {`],
  ];
  for (const [before, after] of changes) {
    if (source.split(before).length !== 2) throw new Error('Mol* surface loop changed; review exact field equivalence.');
    source = source.replace(before, after);
  }
  return source;
}

// Preserve probe/grid order, distance arithmetic and group assignment exactly.
// Resolve each pair's constant group IDs once and skip untouched grid cells
// before computing distances; this also benefits a first, uncached Surface.
export const molstarSurfaceLoopPlugin = {
  name: 'molstar-surface-loop',
  setup(build) {
    build.onLoad({ filter: /molstar\/lib\/mol-math\/geometry\/molecular-surface\.js$/u }, async ({ path }) => {
      const { version } = JSON.parse(await readFile(resolve(dirname(path), '../../../package.json'), 'utf8'));
      if (version !== '5.11.0') throw new Error('Review the surface loop before upgrading Mol* from 5.11.0.');
      return { contents: patchMolstarSurfaceLoop(await readFile(path, 'utf8')), loader: 'js' };
    });
  },
};
