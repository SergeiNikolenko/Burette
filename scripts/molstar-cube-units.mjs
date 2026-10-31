import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

// Cube axis counts, not the atom-count/orbital flag, declare the length unit.
// Keep the pinned Bohr constant unchanged for ordinary positive-count files.
export function patchMolstarCubeUnits(source) {
  const replacements = [
    ['    const basis = (i) => {', `    const axisCounts = [h(3, 0), h(4, 0), h(5, 0)];
    if (axisCounts.some(n => !Number.isInteger(n) || n === 0))
        throw new Error('Cube axis counts must be nonzero integers.');
    if (axisCounts.some(n => Math.sign(n) !== Math.sign(axisCounts[0])))
        throw new Error('Mixed cube axis units are unsupported.');
    const lengthScale = axisCounts[0] < 0 ? 1 : bohrToAngstromFactor;
    const basis = (i) => {`],
    ['        const s = bohrToAngstromFactor;', '        const s = lengthScale;'],
    ['readAtoms(tokenizer, atomCount, bohrToAngstromFactor)', 'readAtoms(tokenizer, atomCount, lengthScale)'],
  ];
  for (const [before, after] of replacements) {
    if (source.split(before).length !== 2) throw new Error('Mol* Cube reader changed; review units before vendoring.');
    source = source.replace(before, after);
  }
  return source;
}

export const molstarCubeUnitsPlugin = {
  name: 'molstar-cube-axis-units',
  setup(build) {
    build.onLoad({ filter: /molstar\/lib\/mol-io\/reader\/cube\/parser\.js$/u }, async ({ path }) => {
      const { version } = JSON.parse(await readFile(resolve(dirname(path), '../../../../package.json'), 'utf8'));
      if (version !== '5.11.0') throw new Error('Review the Mol* Cube units adapter before upgrading from 5.11.0.');
      return { contents: patchMolstarCubeUnits(await readFile(path, 'utf8')), loader: 'js' };
    });
  },
};
