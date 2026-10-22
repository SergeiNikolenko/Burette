// An SDF ensemble keeps one model per molecule, but shares background geometry.
// Parsed models survive Single/All switches; inactive geometry never survives in
// the hierarchy, so selection and export see exactly the displayed molecules.
(() => {
  let scenes = new WeakMap();
  const yieldToHost = () => new Promise(resolve => setTimeout(resolve, 0));

  function moleculeRecords(molecules) {
    return molecules.map((molecule, index) => [
      `Molecule ${index + 1}`, '  Burette', '',
      '  0  0  0     0  0            999 V3000', 'M  V30 BEGIN CTAB',
      `M  V30 COUNTS ${molecule.atoms.length} ${molecule.bonds.length} 0 0 0`,
      'M  V30 BEGIN ATOM',
      ...molecule.atoms.map((atom, i) => `M  V30 ${i + 1} ${atom.element} ${atom.x} ${atom.y} ${atom.z} 0`),
      'M  V30 END ATOM', 'M  V30 BEGIN BOND',
      ...molecule.bonds.map((bond, i) => `M  V30 ${i + 1} ${bond.order} ${bond.a} ${bond.b}`),
      'M  V30 END BOND', 'M  V30 END CTAB', 'M  END', '$$$$', ''
    ].join('\n')).join('');
  }

  function poseExpression(index, selected) {
    return {
      head: { name: 'structure-query.generator.atom-groups' },
      args: { 'chain-test': {
        head: { name: selected ? 'core.rel.eq' : 'core.rel.neq' },
        args: [{ head: { name: 'structure-query.atom-property.core.model-label' } }, `Molecule ${index + 1}`]
      } }
    };
  }

  async function show(plugin, options) {
    const { molecules, all, spread, spreadCells, spreadMolecules, foreground, background } = options;
    if (!molecules?.length) throw new Error('The molecule collection is empty.');
    const index = Math.max(0, Math.min(molecules.length - 1, Math.trunc(Number(options.index) || 0)));
    const cellsKey = spread ? JSON.stringify(spreadCells || null) : '';
    const dataState = plugin.state.data;
    const canvas = plugin.canvas3d;
    const manualReset = canvas?.props?.camera?.manualReset === true;
    let scene = scenes.get(plugin);
    // Never overwrite camera input made while the state transaction yields.
    if (scene) canvas?.setProps({ camera: { manualReset: true } });
    try {
      await plugin.dataTransaction(async () => {
        if (!scene || scene.molecules !== molecules || scene.spread !== spread || scene.cellsKey !== cellsKey || !dataState.cells.has(scene.raw.ref)) {
          await plugin.clear();
          const shown = spread ? spreadMolecules(molecules, spreadCells) : molecules;
          const raw = await plugin.builders.data.rawData({ data: moleculeRecords(shown), label: 'Molecule collection' });
          await yieldToHost();
          const trajectory = await plugin.builders.structure.parseTrajectory(raw, 'sdf');
          if (trajectory.obj?.data?.frameCount !== molecules.length) throw new Error('The molecule collection could not be parsed completely.');
          scene = { molecules, spread, cellsKey, raw, trajectory };
        }
        if (scene.all !== all || !dataState.cells.has(scene.root?.ref)) {
          const remove = dataState.build();
          for (const child of dataState.tree.children.get(scene.trajectory.ref) || []) remove.delete(child);
          await remove.commit();
          await yieldToHost();
          if (all) {
            scene.root = await dataState.build().to(scene.trajectory)
              .apply(window.molstar.lib.plugin.StateTransforms.Model.StructureFromTrajectory, {}, { tags: ['burette-sdf-ensemble'] })
              .commit({ revertOnError: true });
            scene.model = null;
          } else {
            scene.model = await plugin.builders.structure.createModel(scene.trajectory, { modelIndex: index });
            scene.root = await plugin.builders.structure.createStructure(scene.model);
          }
          scene.all = all;
          scene.index = -1;
          scene.foreground = scene.background = null;
          scene.foregroundKey = scene.backgroundKey = '';
        } else if (!all && scene.index !== index) {
          await dataState.build().to(scene.model).update({ modelIndex: index }).commit({ revertOnError: true });
        }
        if (scene.index !== index || !dataState.cells.has(scene.foreground?.ref)) {
          const builder = plugin.builders.structure;
          scene.foreground = all
            ? await builder.tryCreateComponentFromExpression(scene.root, poseExpression(index, true), 'pose', { label: 'Selected pose' })
            : await builder.tryCreateComponentStatic(scene.root, 'all', { label: 'Selected pose' });
          if (all) scene.background = await builder.tryCreateComponentFromExpression(scene.root, poseExpression(index, false), 'context', { label: 'Other poses' });
          scene.index = index;
        }
        for (const [role, representation] of [['background', background], ['foreground', foreground]]) {
          const component = scene[role];
          if (!component) continue;
          const key = JSON.stringify(representation);
          if (scene[`${role}Key`] === key) continue;
          await yieldToHost();
          await plugin.builders.structure.representation.addRepresentation(component, representation, { tag: `burette-collection-${role}` });
          scene[`${role}Key`] = key;
        }
      }, { rethrowErrors: true });
      scenes.set(plugin, scene);
    } catch (error) {
      // Mol* restores the transaction on failure; don't retain selectors from
      // an aborted update. A retry reconstructs the scene from the source.
      scenes.delete(plugin);
      throw error;
    } finally {
      canvas?.setProps({ camera: { manualReset } });
    }
  }

  window.BuretteSdfCollection = {
    show,
    reset(plugin) {
      if (plugin) scenes.delete(plugin);
      else scenes = new WeakMap();
    }
  };
})();
