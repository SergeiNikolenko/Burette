// Workspace file imports only; the scene's object context menus own their UI.
(function () {
  const sessions = new WeakMap();
  const modelLoads = new WeakSet();
  const appendOwners = new WeakMap();
  const MAX_SCENE_MODELS = 200;
  const allModels = preset => preset === 'all-models' || preset === 'preset-trajectory-all-models';
  const modelLimit = () => new Error('A scene supports up to 200 loaded models. Open a collection and select fewer structures.');
  function modelCount(viewer) {
    const models = viewer?.plugin?.managers?.structure?.hierarchy?.current?.models;
    if (!Array.isArray(models)) throw new Error('The scene model inventory is unavailable.');
    return models.length;
  }
  function checkTrajectoryCount(count) {
    if (!Number.isSafeInteger(count) || count < 1 || count > MAX_SCENE_MODELS) throw modelLimit();
  }
  function preflightModels(viewer, sources) {
    let incoming = 0;
    const remaining = MAX_SCENE_MODELS - modelCount(viewer);
    for (const source of sources) {
      if (source.format !== 'sdf' || !allModels(source.loadPreset)) {
        if (++incoming > remaining) throw modelLimit();
        continue;
      }
      // Mol* recognizes a line beginning with $$$$, including suffixes. Scan
      // without splitting or copying the SDF; retain an unterminated last record.
      const text = source.data;
      let nonblank = false;
      let headerLines = 4;
      let propertyValue = 0; // 0: data items, 1: first value line, 2: continuation
      for (let i = 0; i < text.length;) {
        // Delimiter-looking titles/program/comments and the first property
        // value are ordinary data to Mol*'s SDF reader.
        if (!headerLines && !propertyValue && text.startsWith('$$$$', i)) {
          if (++incoming > remaining) throw modelLimit();
          nonblank = false;
          headerLines = 4;
          while (i < text.length && text[i] !== '\r' && text[i] !== '\n') i++;
        } else {
          if (headerLines) headerLines--;
          else if (propertyValue === 1) propertyValue = 2;
          else if (propertyValue === 2) {
            // Mol* consumes the terminating line while finishing a value; it
            // does not interpret that same line again as a record boundary.
            if (text[i] === '\r' || text[i] === '\n' || text.startsWith('$$$$', i) || text.startsWith('> ', i)) propertyValue = 0;
          } else if (text.startsWith('> ', i)) propertyValue = 1;
          while (i < text.length && text[i] !== '\r' && text[i] !== '\n') {
            if (!nonblank && !/\s/u.test(text[i])) nonblank = true;
            i++;
          }
        }
        if (text[i] === '\r') i++;
        if (text[i] === '\n') i++;
      }
      if (nonblank && ++incoming > remaining) throw modelLimit();
    }
  }
  async function loadModels(viewer, source, parse, options, appendOwner) {
    const plugin = viewer.plugin;
    if (modelLoads.has(plugin) || (appendOwners.has(plugin) && appendOwners.get(plugin) !== appendOwner)) {
      throw new Error('Wait for the current scene model load to finish.');
    }
    preflightModels(viewer, [source]);
    modelLoads.add(plugin);
    let raw;
    try {
      raw = await plugin.builders.data.rawData({ data: source.data, label: source.label });
      const trajectories = await parse(plugin, raw, source.format);
      checkTrajectoryCount(trajectories.length);
      const preset = source.loadPreset || 'default';
      let incoming = 0;
      for (const trajectory of trajectories) {
        const frames = trajectory?.obj?.data?.frameCount;
        if (!Number.isSafeInteger(frames) || frames < 1) throw new Error('The source has no valid model count.');
        incoming += allModels(preset) ? frames : 1;
        if (modelCount(viewer) + incoming > MAX_SCENE_MODELS) throw modelLimit();
      }
      // No await between admission and entering the protected preset loop.
      // Concurrent loads through this boundary refuse instead of queuing work.
      for (const trajectory of trajectories) {
        await plugin.builders.structure.hierarchy.applyPreset(trajectory, preset, options);
        if (modelCount(viewer) > MAX_SCENE_MODELS) throw modelLimit();
      }
    } catch (error) {
      if (raw) await plugin.state.data.build().delete(raw.ref).commit();
      throw error;
    } finally {
      modelLoads.delete(plugin);
    }
  }
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
  const SCIENCE_ATOM_LIMIT = 10000;
  function scienceBinding(viewer) {
    const plugin = viewer?.plugin;
    const roots = plugin?.managers?.structure?.hierarchy?.current?.structures;
    if (!Array.isArray(roots) || roots.length !== 1) throw new Error('Scientific data is saved with scenes of exactly one structure.');
    const structureCell = roots[0].cell;
    const structure = structureCell?.obj?.data;
    if (!structure) throw new Error('Wait for the scene to load.');
    const cells = plugin.state.data.cells;
    let model = null;
    let trajectory = null;
    for (let cell = cells.get(structureCell.transform.parent); cell;) {
      const id = String(cell.transform.transformer?.id || '');
      if (!model && id.endsWith('model-from-trajectory')) model = cell;
      else if (model && id.includes('trajectory-from-')) { trajectory = cell; break; }
      const parent = cell.transform.parent;
      if (!parent || parent === cell.transform.ref) break;
      cell = cells.get(parent);
    }
    if (!model || !trajectory) throw new Error('This scene structure has no trajectory source.');
    const atomCount = structure.elementCount;
    if (!Number.isInteger(atomCount) || atomCount < 1 || atomCount > SCIENCE_ATOM_LIMIT) throw new Error('Scientific data is saved for structures of 1–10,000 atoms.');
    const elements = Array.from({ length: atomCount });
    const positions = new Float64Array(atomCount * 3);
    const seen = new Uint8Array(atomCount);
    for (const unit of structure.units) {
      if (unit.kind !== 0) throw new Error('Scientific data needs an atomic structure.');
      const hierarchy = unit.model.atomicHierarchy;
      for (let index = 0; index < unit.elements.length; index++) {
        const element = unit.elements[index];
        const source = hierarchy.atomSourceIndex.value(element);
        if (!(source >= 0 && source < atomCount) || seen[source]) throw new Error('The scene structure does not list each atom once.');
        seen[source] = 1;
        elements[source] = String(hierarchy.atoms.type_symbol.value(element));
        positions[source * 3] = unit.conformation.x(element);
        positions[source * 3 + 1] = unit.conformation.y(element);
        positions[source * 3 + 2] = unit.conformation.z(element);
      }
    }
    if (seen.includes(0)) throw new Error('The scene structure does not list each atom once.');
    return {
      structureRef: structureCell.transform.ref,
      modelRef: model.transform.ref,
      trajectoryRef: trajectory.transform.ref,
      frameIndex: Math.max(0, Math.trunc(Number(model.transform.params?.modelIndex) || 0)),
      frameCount: Math.max(1, Math.trunc(Number(trajectory.obj?.data?.frameCount) || 1)),
      atomCount,
      elements,
      positions,
    };
  }
  // Explicit graph identity includes the exact parser input, not coincident positions.
  async function graphSourceBinding(viewer) {
    const report = scienceBinding(viewer);
    const cells = viewer.plugin.state.data.cells;
    const trajectory = cells.get(report.trajectoryRef);
    const transformer = String(trajectory?.transform?.transformer?.id || '');
    const sourceFormat = transformer.endsWith('trajectory-from-sdf') ? 'sdf' : transformer.endsWith('trajectory-from-mol') ? 'mol' : null;
    if (!sourceFormat) throw new Error('This scene has no MOL or SDF graph source.');
    const raw = cells.get(trajectory.transform.parent);
    const text = raw?.obj?.data;
    if (typeof text !== 'string' || new TextEncoder().encode(text).byteLength > 16 * 1024 * 1024) throw new Error('This scene has no bounded graph source.');
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    // Do not return an identity captured before another model/source was loaded.
    const current = scienceBinding(viewer);
    if (!sameScienceBinding(current, { binding: report, positions: report.positions }) || cells.get(report.trajectoryRef) !== trajectory
      || String(trajectory.transform.transformer?.id || '') !== transformer || cells.get(trajectory.transform.parent) !== raw || raw.obj.data !== text) throw new Error('The scene source changed while it was being read.');
    return { ...report, sourceFormat, sourceSha256: Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('') };
  }
  function sameScienceBinding(current, expected) {
    const binding = expected?.binding;
    if (!binding || !['structureRef', 'modelRef', 'trajectoryRef', 'frameIndex', 'frameCount', 'atomCount'].every(key => current[key] === binding[key])) return false;
    const positions = expected.positions;
    if (!positions || positions.length !== current.positions.length) return false;
    for (let index = 0; index < positions.length; index++) if (!(Math.abs(positions[index] - current.positions[index]) <= 1e-3)) return false;
    return true;
  }
  window.BuretteSceneFiles = {
    science: { binding: scienceBinding, graphBinding: graphSourceBinding },
    loadModels,
    checkTrajectoryCount,
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
      // Refuse before taking a rollback snapshot: another loader's newly
      // created raw node never belongs to this append's cleanup.
      if (modelLoads.has(viewer.plugin) || appendOwners.has(viewer.plugin)) throw new Error('Wait for the current scene model load to finish.');
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
      preflightModels(viewer, sources.map(source => ({ ...source,
        loadPreset: source.format === 'sdf' ? 'all-models' : 'default' })));
      const data = viewer.plugin.state.data;
      const before = new Set(data.cells.keys());
      const camera = context.capture(viewer);
      session.busy = true;
      const owner = {};
      appendOwners.set(viewer.plugin, owner);
      try {
        for (const source of sources) await context.load(viewer, {
          ...source,
          label: source.label || source.path.split('/').pop(),
          // Each SDF record is a ligand, not an animation frame to discard.
          loadPreset: source.format === 'sdf' ? 'all-models' : 'default'
        }, undefined, owner);
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
        session.busy = false;
        appendOwners.delete(viewer.plugin);
        context.restore(viewer, camera);
      }
    }
  };
})();
