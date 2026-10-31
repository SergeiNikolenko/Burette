import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

// Cube stores all datasets interleaved at each voxel. The selected dataset is
// an offset into that tuple; its length, not the selection, is the stride.
export function patchMolstarCubeDatasets(source) {
  const replacements = [
    ['        const space = Tensor.Space(header.dim, [0, 1, 2], Float64Array);', `        const datasetCount = Math.max(1, header.dataSetIds.length);
        const dataIndex = params?.dataIndex ?? 0;
        if (!Number.isInteger(dataIndex) || dataIndex < 0 || dataIndex >= datasetCount)
            throw new Error('Cube dataset index is outside the available fields.');
        const space = Tensor.Space(header.dim, [0, 1, 2], Float64Array);`],
    ['            const nth = ((params === null || params === void 0 ? void 0 : params.dataIndex) || 0) + 1;', '            const nth = datasetCount;'],
    ['            let o = 0, s = 0;', '            let o = 0, s = dataIndex;'],
  ];
  for (const [before, after] of replacements) {
    if (source.split(before).length !== 2) throw new Error('Mol* Cube volume reader changed; review dataset selection before vendoring.');
    source = source.replace(before, after);
  }
  return source;
}

export const molstarCubeDatasetsPlugin = {
  name: 'molstar-cube-dataset-selection',
  setup(build) {
    build.onLoad({ filter: /molstar\/lib\/mol-model-formats\/volume\/cube\.js$/u }, async ({ path }) => {
      const { version } = JSON.parse(await readFile(resolve(dirname(path), '../../../package.json'), 'utf8'));
      if (version !== '5.11.0') throw new Error('Review the Mol* Cube dataset adapter before upgrading from 5.11.0.');
      return { contents: patchMolstarCubeDatasets(await readFile(path, 'utf8')), loader: 'js' };
    });
  },
};
