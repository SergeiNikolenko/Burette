// Workspace file imports only; the scene's object context menus own their UI.
(function () {
  const sessions = new WeakMap();
  // A source file stays part of the scene while a top-level data node still
  // carries its file name. Deleting a structure in the tree frees the file for
  // a later import, and a rebuild no longer resurrects it. Scenes whose data
  // nodes use other labels keep the given list unchanged.
  function livePaths(viewer, paths) {
    const data = viewer?.plugin?.state?.data;
    const root = data?.tree?.root?.ref;
    if (!root) return paths;
    let children = 0;
    const labels = new Set();
    for (const [ref, cell] of data.cells) {
      if (ref === root || cell.transform.parent !== root) continue;
      children += 1;
      const label = cell.obj?.label || cell.transform.params?.label;
      if (label) labels.add(label);
    }
    if (!children) return [];
    const live = paths.filter(path => labels.has(path.split('/').pop()));
    return live.length ? live : paths;
  }
  window.BuretteSceneFiles = {
    livePaths,
    sequence(viewer) {
      const records = [];
      const seen = new Set();
      for (const entry of viewer?.plugin?.managers?.structure?.hierarchy?.current?.structures || []) {
        for (const model of entry.cell?.obj?.data?.models || []) {
          if (seen.has(model.id)) continue;
          seen.add(model.id);
          for (const entity of model.sequence?.sequences || []) {
            const sequence = entity.sequence;
            if (!['protein', 'DNA', 'RNA'].includes(sequence.kind)) continue;
            if (sequence.length > 100000) throw new Error('Sequence exceeds 100,000 residues.');
            const code = Array.from({ length: sequence.length }, (_, index) => sequence.code.value(index)).join('');
            records.push(`>${model.label || 'structure'} | entity ${entity.entityId}\n${code}`);
          }
        }
      }
      if (!records.length) throw new Error('This structure has no polymer sequence.');
      const text = records.join('\n');
      if (text.length > 1024 * 1024) throw new Error('Sequence export exceeds 1 MB.');
      return text;
    },
    async append(viewer, action, context) {
      if (!viewer?.plugin?.state?.data) throw new Error('The scene is still loading.');
      let session = sessions.get(viewer);
      if (!session) {
        session = { paths: new Set(), busy: false };
        sessions.set(viewer, session);
      }
      if (session.busy) throw new Error('Wait for the current scene import to finish.');
      let sources = action.sources;
      if (!Array.isArray(sources) || !sources.length || sources.length > 200) throw new Error('Choose 1–200 structures.');
      let bytes = 0;
      const incoming = new Set();
      for (const source of sources) {
        if (typeof source.path !== 'string' || source.path.length > 4096
          || typeof source.data !== 'string' || !['pdb', 'cif', 'mmcif', 'mol', 'sdf', 'mol2', 'xyz'].includes(source.format)) {
          throw new Error('Unsupported scene source.');
        }
        bytes += new TextEncoder().encode(source.data).length;
        if (incoming.has(source.path) && !action.skipExisting) throw new Error('The selection contains duplicate files.');
        incoming.add(source.path);
      }
      if (bytes > 24 * 1024 * 1024) throw new Error('Scene imports are limited to 24 MB at a time.');
      for (const path of (action.existingPaths || []).slice(0, 200)) session.paths.add(path);
      session.paths = new Set(livePaths(viewer, Array.from(session.paths)));
      if (action.skipExisting) {
        const fresh = new Map(sources.filter(source => !session.paths.has(source.path)).map(source => [source.path, source]));
        sources = Array.from(fresh.values());
        if (!sources.length) return { ok: true, command: 'append_scene_files', result: { added: 0, paths: Array.from(session.paths) } };
      }
      if (sources.some(source => session.paths.has(source.path))) throw new Error('A selected file is already in this scene.');
      if (session.paths.size + sources.length > 200) throw new Error('A scene supports up to 200 source files.');
      session.busy = true;
      const data = viewer.plugin.state.data;
      const before = new Set(data.cells.keys());
      const camera = context.capture(viewer);
      try {
        for (const source of sources) await context.load(viewer, {
          ...source,
          label: source.label || source.path.split('/').pop(),
          // Each SDF record is a ligand, not an animation frame to discard.
          loadPreset: source.format === 'sdf' ? 'all-models' : 'default'
        });
        sources.forEach(source => session.paths.add(source.path));
        return { ok: true, command: 'append_scene_files', result: { added: sources.length, paths: Array.from(session.paths) } };
      } catch (error) {
        const update = data.build();
        for (const [ref, cell] of data.cells) {
          if (!before.has(ref) && before.has(cell.transform.parent)) update.delete(ref);
        }
        await update.commit();
        throw error;
      } finally {
        context.restore(viewer, camera);
        session.busy = false;
      }
    }
  };
})();
