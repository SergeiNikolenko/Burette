import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const molstarXyzLatticePlugin = {
  name: 'molstar-xyz-source-lattice',
  setup(build) {
    build.onLoad({ filter: /molstar\/lib\/mol-model-formats\/structure\/xyz\.js$/u }, async ({ path }) => {
      const { version } = JSON.parse(await readFile(resolve(dirname(path), '../../../package.json'), 'utf8'));
      if (version !== '5.11.0') throw new Error('Review the Mol* XYZ lattice adapter before upgrading from 5.11.0.');
      let source = await readFile(path, 'utf8');
      const before = '    return createModels(basic, XyzFormat.create(mol), ctx);';
      if (source.split('function getModels(mol, ctx) {').length !== 2 || source.split(before).length !== 2) {
        throw new Error('Mol* XYZ model construction changed; review source lattice attachment.');
      }
      source = source.replace('function getModels(mol, ctx) {', 'async function getModels(mol, ctx) {')
        .replace(before, `    const models = await createModels(basic, XyzFormat.create(mol), ctx);
    for (let i = 0; i < models.frameCount; i++) {
        const model = models.getFrameAtIndex(i);
        attachXyzLattice(model, molecules[model.modelNum].comment);
    }
    return models;`);
      const helper = fileURLToPath(new URL('./molstar-xyz-lattice.js', import.meta.url));
      return { contents: `import { attachXyzLattice } from ${JSON.stringify(helper)};\n${source}`, loader: 'js' };
    });
  },
};
