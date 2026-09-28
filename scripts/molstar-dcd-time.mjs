import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

// Mol* 5.11 uses the inverse AKMA conversion, ignores NSAVC and subtracts one
// from ISTART. Keep files standard (MDAnalysis/VMD-compatible), correct the
// version-locked reader at build time, never compensate inside exported DCDs.
export function patchMolstarDcdTime(source) {
  const replacements = [
    ['const charmmTimeUnitFactor = 20.45482949774598;', 'const charmmTimeUnitFactor = 0.04888821;'],
    ["Time(header.DELTA * charmmTimeUnitFactor, 'ps')", "Time(header.DELTA * (header.NSAVC || 1) * charmmTimeUnitFactor, 'ps')"],
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

export const molstarDcdTimePlugin = {
  name: 'molstar-standard-dcd-time',
  setup(build) {
    build.onLoad({ filter: /molstar\/lib\/mol-model-formats\/structure\/dcd\.js$/u }, async ({ path }) => {
      const { version } = JSON.parse(await readFile(resolve(dirname(path), '../../../package.json'), 'utf8'));
      if (version !== '5.11.0') throw new Error('Review the Mol* DCD time adapter before upgrading from 5.11.0.');
      return { contents: patchMolstarDcdTime(await readFile(path, 'utf8')), loader: 'js' };
    });
  }
};
