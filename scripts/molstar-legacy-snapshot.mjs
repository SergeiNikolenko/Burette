import { molstarPatchPlugin } from './molstar-source.mjs';

// Migrate versioned scene files before the snapshot manager stores their entries.
export const molstarLegacySnapshotPlugin = molstarPatchPlugin(
  'molstar-legacy-snapshot',
  '@molstar/plugin/state/manager/snapshots',
  source => {
    const entry = '  async setStateSnapshot(snapshot) {';
    if (source.split(entry).length !== 2) throw new Error('Mol* snapshot import changed; review the 5.11 migration.');
    return `import { deepEqual } from '@molstar/core/util';
import { ParamDefinition as PD } from '@molstar/core/util/param-definition';
import { StructureComponentManager } from '@molstar/plugin/state/manager/structure/component';
${source.replace(entry, `${entry}
    if (typeof snapshot.version === 'string' && /^5\\.11\\.\\d+$/.test(snapshot.version)) {
      const focusId = 'ms-plugin.create-structure-focus-representation';
      const focus = this.plugin.state.behaviors.cells.get(focusId)?.transform.transformer;
      const defaults = focus && PD.getDefaultValues(focus.definition.params(undefined, this.plugin));
      for (const entry of snapshot.entries) {
        const saved = entry.snapshot;
        const options = saved.structureComponentManager?.options;
        if (options && !Object.hasOwn(options, 'solidSurface'))
          options.solidSurface = StructureComponentManager.OptionsParams.solidSurface.defaultValue;
        if (!defaults) continue;
        const transforms = saved.behaviour?.tree?.transforms;
        const params = transforms?.find(t => t.ref === focusId && t.transformer === focusId)?.params;
        for (const key of ['targetParams', 'surroundingsParams']) {
          const provider = params?.[key];
          if (provider?.type?.params?.bumpFrequency !== 0) continue;
          const current = defaults[key];
          const legacy = JSON.parse(JSON.stringify(current));
          legacy.type.params.bumpFrequency = 0;
          for (const key of ['renderMerged', 'gpuCulling', 'lodPixelSize', 'lodRadius'])
            delete legacy.type.params[key];
          // Preserve authored focus settings. Only the former defaults are upgraded.
          if (deepEqual(provider, legacy)) params[key] = current;
        }
      }
    }
`)}`;
  },
);
