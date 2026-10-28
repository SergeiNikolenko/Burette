import { molstarPatchPlugin } from './molstar-source.mjs';

// The pinned Mol* reader uses the inverse AKMA conversion, ignores NSAVC and subtracts one
// from ISTART. Keep files standard (MDAnalysis/VMD-compatible), correct the
// version-locked reader at build time, never compensate inside exported DCDs.
export function patchMolstarDcdTime(source) {
  const replacements = [
    ['const charmmTimeUnitFactor = 20.45482949774598;', 'const charmmTimeUnitFactor = 0.04888821;'],
    ['Time(header.DELTA * charmmTimeUnitFactor, "ps")', 'Time(header.DELTA * (header.NSAVC || 1) * charmmTimeUnitFactor, "ps")'],
    ['Time((header.ISTART - 1) * deltaTime.value, deltaTime.unit)', 'Time(header.ISTART * deltaTime.value / (header.NSAVC || 1), deltaTime.unit)'],
    // MDAnalysis writes zero boxes for nonperiodic/aligned coordinates.
    ['if (dcdFrame.cell) {', 'if (dcdFrame.cell && [0, 2, 5].some(index => dcdFrame.cell[index] !== 0)) {']
  ];
  for (const [before, after] of replacements) {
    if (source.split(before).length !== 2) throw new Error('Mol* DCD time reader changed; review AKMA conversion before vendoring.');
    source = source.replace(before, after);
  }
  return source;
}

export const molstarDcdTimePlugin = molstarPatchPlugin(
  'molstar-standard-dcd-time',
  '@molstar/model/formats/structure/dcd',
  patchMolstarDcdTime,
);
