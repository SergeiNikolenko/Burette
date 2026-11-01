import { molstarPatchPlugin } from './molstar-source.mjs';

export function patchMolstarSurfaceLoop(source) {
  // Upstream now resolves each pair's group IDs once. Keep only Burette's
  // early skip of untouched cells; distance arithmetic and probe order stay exact.
  const changes = [
    [`              const dz = pz - gridz[zi];
              const dSq = dxySq + dz * dz;
              const idx = zi + xyIdx;
              const current = data[idx];
              if (current > 0 && dSq < current * current) {`,
      `              const idx = zi + xyIdx;
              const current = data[idx];
              if (!(current > 0)) continue;
              const dz = pz - gridz[zi];
              const dSq = dxySq + dz * dz;
              if (dSq < current * current) {`],
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
export const molstarSurfaceLoopPlugin = molstarPatchPlugin(
  'molstar-surface-loop',
  '@molstar/core/math/geometry/molecular-surface',
  patchMolstarSurfaceLoop,
);
