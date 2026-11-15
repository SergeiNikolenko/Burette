import { molstarPatchPlugin } from './molstar-source.mjs';

// Keep the native editor and its command dispatch. Only a changed Cube dataset
// can enter the viewer's existing scene history; other hosts keep native behavior.
export function patchMolstarCubeUiHistory(source) {
  const call = '    return this.plugin.state.updateTransform(this.props.state, this.props.transform.ref, this.state.params);';
  if (source.split(call).length !== 2 || source.includes('buretteCubeDatasetUpdate'))
    throw new Error('Mol* transform editor changed; review Cube UI history before vendoring.');
  return source.replace(call, `    const cubeUpdate = this.plugin.customState.buretteCubeDatasetUpdate;
    if (this.props.transform.transformer.id === 'ms-plugin.volume-from-cube'
      && this.state.params.dataIndex !== this.getInfo().initialValues.dataIndex
      && typeof cubeUpdate === 'function')
      return cubeUpdate(this.props.state, this.props.transform.ref, this.state.params);
${call}`);
}

export const molstarCubeUiHistoryPlugin = molstarPatchPlugin(
  'molstar-cube-ui-history',
  '@molstar/plugin-ui/state/update-transform',
  patchMolstarCubeUiHistory,
);
