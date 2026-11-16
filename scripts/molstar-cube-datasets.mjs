import { molstarPatchPlugin } from './molstar-source.mjs';

// Cube stores all datasets interleaved at each voxel. The selected dataset is
// an offset into that tuple; its length, not the selection, is the stride.
export function patchMolstarCubeDatasets(source) {
  const replacements = [
    ['    const space = Tensor.Space(header.dim, [0, 1, 2], Float64Array);', `    const datasetCount = Math.max(1, header.dataSetIds.length);
    const dataIndex = params?.dataIndex ?? 0;
    if (!Number.isInteger(dataIndex) || dataIndex < 0 || dataIndex >= datasetCount)
      throw new Error('Cube dataset index is outside the available fields.');
    const space = Tensor.Space(header.dim, [0, 1, 2], Float64Array);`],
    ['      const nth = (params?.dataIndex || 0) + 1;', '      const nth = datasetCount;'],
    ['      let o = 0, s = 0;', '      let o = 0, s = dataIndex;'],
  ];
  for (const [before, after] of replacements) {
    if (source.split(before).length !== 2) throw new Error('Mol* Cube volume reader changed; review dataset selection before vendoring.');
    source = source.replace(before, after);
  }
  return source;
}

export const molstarCubeDatasetsPlugin = molstarPatchPlugin(
  'molstar-cube-dataset-selection',
  '@molstar/model/formats/volume/cube',
  patchMolstarCubeDatasets,
);
