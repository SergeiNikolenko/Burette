import { fileURLToPath } from 'node:url';
import { molstarPatchPlugin } from './molstar-source.mjs';

export function patchMolstarXyzLattice(source) {
  const before = '  return createModels(basic, XyzFormat.create(mol), ctx);';
  if (source.split('function getModels(mol, ctx) {').length !== 2 || source.split(before).length !== 2) {
    throw new Error('Mol* XYZ model construction changed; review source lattice attachment.');
  }
  source = source.replace('function getModels(mol, ctx) {', 'async function getModels(mol, ctx) {')
    .replace(before, `  const models = await createModels(basic, XyzFormat.create(mol), ctx);
  for (let i = 0; i < models.frameCount; i++) {
    const model = models.getFrameAtIndex(i);
    attachXyzLattice(model, molecules[model.modelNum].comment);
  }
  return models;`);
  const helper = fileURLToPath(new URL('./molstar-xyz-lattice.js', import.meta.url));
  return `import { attachXyzLattice } from ${JSON.stringify(helper)};\n${source}`;
}

export const molstarXyzLatticePlugin = molstarPatchPlugin(
  'molstar-xyz-source-lattice',
  '@molstar/model/formats/structure/xyz',
  patchMolstarXyzLattice,
);
