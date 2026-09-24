import { StructureElement } from 'molstar/lib/mol-model/structure.js';
import { StructureFocusRepresentation } from 'molstar/lib/mol-plugin/behavior/dynamic/selection/structure-focus-representation.js';
import { PluginCommands } from 'molstar/lib/mol-plugin/commands.js';
import { installAutomaticStoryPresentation } from './molstar-story-presentation.mjs';

export const BuretteStory = {
  install: installAutomaticStoryPresentation,
  async automatic(plugin) {
    // This explicit MVS reference carries a residue selection, not a bespoke
    // representation. Unmarked stories never gain unsolicited surroundings.
    const environment = Array.from(plugin.state.data.cells.values()).find(cell =>
      cell.transform.tags?.includes('mvs-ref:burette-environment') && cell.obj?.data?.elementCount > 0);
    const parent = environment && plugin.helpers.substructureParent.get(environment.obj.data);
    // Auto replaces authored components. Bind loci to the surviving structure,
    // not to the component which syncPreset is about to remove.
    const loci = parent?.obj?.data
      ? StructureElement.Loci.remap(StructureElement.Loci.all(environment.obj.data), parent.obj.data)
      : undefined;
    const provider = plugin.builders.structure.representation.resolveProvider('preset-structure-representation-auto');
    if (!provider) throw new Error('The standard Mol* Auto preset is unavailable.');
    await plugin.managers.structure.component.applyPreset(
      plugin.managers.structure.hierarchy.selection.structures, provider);
    if (loci) {
      const focus = plugin.state.behaviors.cells.get(StructureFocusRepresentation.id)?.obj?.data;
      if (!focus?.focus) throw new Error('The standard Mol* surroundings behavior is unavailable.');
      // Await the same implementation used by interactive focus. No custom
      // balls, labels, distance primitives, or selection/highlight overlay.
      await focus.focus(loci);
    }
  },
  async camera(plugin, camera) {
    const durationMs = camera?.transitionStyle === 'animate' ? camera.transitionDurationInMs : 0;
    if (camera?.current) await PluginCommands.Camera.Reset(plugin, { snapshot: camera.current, durationMs });
    else if (camera?.focus) await PluginCommands.Camera.FocusObject(plugin, { ...camera.focus, durationMs });
  },
};
