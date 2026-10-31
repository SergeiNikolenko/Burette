(function () {
  'use strict';

  const controllers = new WeakMap();
  const kinds = { bond: 2, angle: 3, dihedral: 4 };

  function current(plugin, source) {
    const roots = plugin.managers.structure.hierarchy.current.structures;
    return source && roots.length === 1 && roots[0].cell === source.cell
      && source.cell.obj?.data === source.data && plugin.state.data.cells.get(source.cell.transform.ref) === source.cell;
  }

  function pointsFor(structure, atoms) {
    const Element = window.molstar?.lib?.structure?.StructureElement;
    if (!Element || structure.models.length !== 1 || atoms.length > structure.elementCount) return [];
    return atoms.map(atom => {
      const matches = structure.units.flatMap(unit => {
        if (unit.kind !== 0) return [];
        const index = unit.elements.indexOf(atom);
        return index < 0 ? [] : [{ unit, indices: Int32Array.of(index) }];
      });
      // atom_index is model-local; repeated assembly copies are ambiguous.
      return matches.length === 1 ? Element.Loci(structure, matches) : null;
    });
  }

  function remove(state) {
    const repr = state.repr;
    state.repr = null;
    if (repr) {
      try { state.canvas.remove(repr); } finally { repr.destroy(); }
    }
  }

  function apply(viewer, action) {
    const plugin = viewer?.plugin;
    if (!plugin) return Promise.resolve({ ok: true });
    let state = controllers.get(plugin);
    if (!state) {
      state = { revision: 0, repr: null, source: null, pending: Promise.resolve(), closed: false };
      controllers.set(plugin, state);
      plugin.state.data.events.changed.subscribe({
        next: () => {
          if (state.source && !current(plugin, state.source)) {
            ++state.revision;
            state.source = null;
            remove(state);
          }
        },
        complete: () => { state.closed = true; ++state.revision; state.source = null; remove(state); },
      });
    }
    const revision = ++state.revision;
    remove(state);
    const roots = plugin.managers.structure.hierarchy.current.structures;
    const cell = roots.length === 1 ? roots[0].cell : null;
    const source = cell?.obj?.data ? { cell, data: cell.obj.data } : null;
    state.source = source;
    const count = Object.prototype.hasOwnProperty.call(kinds, action.kind) ? kinds[action.kind] : null;
    const atoms = Array.isArray(action.atoms) ? action.atoms : [];
    const valid = (action.kind === undefined || count) && (!count || atoms.length === count)
      && atoms.every(atom => Number.isSafeInteger(atom) && atom >= 0) && new Set(atoms).size === atoms.length;
    const points = valid && source ? pointsFor(source.data, atoms) : [];
    const highlights = plugin.managers.interactivity.lociHighlights;
    // Highlight writes are synchronous. Late jobs never clear a newer native hover.
    if (!state.closed) {
      highlights.clearHighlights();
      if (points.length && points.every(Boolean)) for (const loci of points) highlights.highlight({ loci }, false);
    }
    const canvas = plugin.canvas3d;
    state.pending = state.pending.catch(() => {}).then(async () => {
      if (state.closed || revision !== state.revision || !current(plugin, source)
        || !count || points.length !== count || !points.every(Boolean) || !canvas) return;
      const repr = await window.molstar.BuretteGeometryMeasurement.create(plugin, action.kind, points);
      if (state.closed || revision !== state.revision || !current(plugin, source) || plugin.canvas3d !== canvas) {
        repr.destroy();
        return;
      }
      state.repr = repr;
      state.canvas = canvas;
      try { canvas.add(repr); } catch (error) { remove(state); throw error; }
    });
    return state.pending.then(() => ({ ok: true }));
  }

  function update(viewer, action, owner) {
    const geometry = window.molstar?.BuretteGeometry;
    if (!geometry) throw new Error('Reload a runtime supporting live Geometry.');
    return geometry.update(viewer?.plugin, action.text, owner);
  }
  const fields = new WeakMap();

  // This private route accepts one generated Gaussian cube, in bohr, not arbitrary multi-field files.
  function validateField(action) {
    if (typeof action.cube !== 'string' || action.cube.length > 32 * 1024 * 1024) throw new Error('Scalar field exceeds 32 MiB.');
    if (!action.cube) return;
    if (!Number.isFinite(action.isovalue) || action.isovalue <= 0) throw new Error('The isovalue must be positive.');
    const lines = action.cube.split(/\r\n?|\n/u);
    const number = value => /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/u.test(value) ? Number(value) : NaN;
    const row = index => (lines[index] || '').trim().split(/\s+/u).map(number);
    const header = row(2), atoms = header[0], axes = [row(3), row(4), row(5)];
    const size = axes.reduce((n, axis) => n * axis[0], 1);
    if (!Number.isInteger(atoms) || atoms < 1 || atoms > 10000 || (header[4] !== undefined && header[4] !== 1)
      || header.length < 4 || !header.every(Number.isFinite) || axes.some(axis => axis.length !== 4 || !axis.every(Number.isFinite)
        || !Number.isInteger(axis[0]) || axis[0] < 1) || !Number.isSafeInteger(size) || size > 1000000) throw new Error('Invalid or oversized scalar field header.');
    for (let i = 0; i < atoms; i++) {
      const atom = row(6 + i);
      if (atom.length !== 5 || !atom.every(Number.isFinite)) throw new Error('Invalid scalar field atom.');
    }
    const values = lines.slice(6 + atoms).join(' ').trim().split(/\s+/u);
    if (values.length !== size || values.some(value => !Number.isFinite(Math.fround(number(value))))) throw new Error('Invalid scalar field values.');
  }

  function field(viewer, action, isCurrent) {
    const plugin = viewer?.plugin;
    const stale = () => Object.assign(new Error('The scalar field source or request changed.'), { name: 'AbortError' });
    if (!plugin || typeof isCurrent !== 'function' || !isCurrent()) return Promise.reject(stale());
    validateField(action);
    if (plugin.state.data.burettePreconditionVersion !== 1) throw new Error('Reload a runtime supporting conditional scene updates.');
    let state = fields.get(plugin);
    if (!state) {
      state = { revision: 0, ref: null, owner: null, expectedVersion: null, expectedCell: null, retiring: false, pending: Promise.resolve() }; fields.set(plugin, state);
      // A single stable transient branch remains owned across source Undo/Redo; no per-grid history is retained.
      plugin.state.data.events.changed.subscribe(() => {
        const cell = state.ref && plugin.state.data.cells.get(state.ref);
        if (state.retiring || !cell?.transform.tags?.includes('burette-scalar-field')
          || (state.owner?.() && cell.transform.version === state.expectedVersion && (!state.expectedCell || state.expectedCell === cell))) return;
        state.retiring = true;
        const retire = async () => {
          if (plugin.disposed || plugin.state.data.cells.get(state.ref) !== cell) return;
          await plugin.runTask(plugin.state.data.updateTree(plugin.state.data.build().delete(state.ref), {
            buretteKeepHistory: true, burettePrecondition: () => { if (plugin.state.data.cells.get(state.ref) !== cell) throw stale(); },
          }));
        };
        state.pending = state.pending.catch(() => {}).then(retire).finally(() => { state.retiring = false; });
        void state.pending.catch(() => {});
      });
    }
    state.owner = isCurrent;
    state.expectedVersion = null; state.expectedCell = null;
    const revision = ++state.revision;
    const assertCurrent = () => { if (plugin.disposed || revision !== state.revision || !isCurrent()) throw stale(); };
    const commit = builder => plugin.runTask(plugin.state.data.updateTree(builder, { burettePrecondition: assertCurrent, buretteKeepHistory: true }));
    const run = state.pending.catch(() => {}).then(async () => {
      assertCurrent();
      const previous = state.ref;
      if (previous && plugin.state.data.cells.has(previous)) await commit(plugin.state.data.build().delete(previous));
      assertCurrent();
      if (!action.cube) return;
      const transforms = window.molstar?.lib?.plugin?.StateTransforms;
      if (!transforms?.Data?.RawData || !transforms.Data.ParseCube || !transforms.Volume?.VolumeFromCube || !transforms.Representation?.VolumeRepresentation3D) throw new Error('This viewer cannot render scalar fields.');
      const builder = plugin.state.data.build();
      const data = builder.toRoot().apply(transforms.Data.RawData, { data: action.cube, label: String(action.label || 'Scalar field').slice(0, 128) }, { ...(state.ref ? { ref: state.ref } : {}), tags: ['burette-scalar-field'] });
      state.ref = data.ref;
      state.expectedVersion = builder.currentTree.transforms.get(data.ref).version;
      const volume = data.apply(transforms.Data.ParseCube).apply(transforms.Volume.VolumeFromCube);
      const alpha = Number.isFinite(action.alpha) ? Math.min(1, Math.max(0.05, action.alpha)) : 0.6;
      const surface = (value, color) => volume.apply(transforms.Representation.VolumeRepresentation3D, {
        type: { name: 'isosurface', params: { isoValue: { kind: 'absolute', absoluteValue: value }, alpha } },
        colorTheme: { name: 'uniform', params: { value: color } }, sizeTheme: { name: 'uniform', params: { value: 1 } },
      });
      surface(action.isovalue, 0x3b82f6);
      if (action.signed !== false) surface(-action.isovalue, 0xef4444);
      try {
        await commit(builder);
        assertCurrent();
        const cell = plugin.state.data.cells.get(data.ref);
        if (!cell || cell.transform.version !== state.expectedVersion) throw stale();
        state.expectedCell = cell;
        state.ref = data.ref;
      } catch (error) {
        // A source change during CPU representation work removes only this request's branch.
        if (!plugin.disposed && plugin.state.data.cells.has(data.ref)) {
          const cell = plugin.state.data.cells.get(data.ref);
          await plugin.runTask(plugin.state.data.updateTree(plugin.state.data.build().delete(data.ref), {
            buretteKeepHistory: true, burettePrecondition: () => { if (plugin.state.data.cells.get(data.ref) !== cell) throw stale(); },
          }));
        }
        throw error;
      }
    });
    state.pending = run;
    return run.then(() => ({ ok: true }));
  }
  const bindings = new WeakMap();
  const sourceChanged = () => Object.assign(new Error('The scalar field source changed. Recalculate the field.'), { name: 'AbortError' });
  const digest = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), value => value.toString(16).padStart(2, '0')).join('');
  const floatBytes = values => {
    const bytes = new Uint8Array(values.length * 4), view = new DataView(bytes.buffer);
    for (let index = 0; index < values.length; index++) view.setFloat32(index * 4, values[index], true);
    return bytes;
  };

  async function bindField(viewer, expected, owner) {
    const plugin = viewer.plugin;
    const previous = bindings.get(plugin); previous?.dispose(); bindings.delete(plugin);
    const fail = message => { throw new Error(message); };
    try {
      const sha = value => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
      if (!expected || !['atoms', 'cube'].includes(expected.kind) || !sha(expected.geometrySha256)
        || !sha(expected.decodedSourceSha256)) fail('Invalid scalar source identity.');
      const cell = owner.cell, data = cell.obj.data;
      const raw = owner.ancestors.find(entry => entry.cell.transform.transformer === window.molstar.lib.plugin.StateTransforms.Data.RawData);
      {
        if (typeof raw?.data !== 'string' || raw.data.length > 32 * 1024 * 1024
          || await digest(new TextEncoder().encode(raw.data)) !== expected.decodedSourceSha256) fail('The displayed source differs from the scientific source.');
      }
      if (expected.kind === 'atoms') {
        if (!Number.isInteger(expected.atomCount) || expected.atomCount < 1 || expected.atomCount > 10000
          || data.elementCount !== expected.atomCount || data.models?.length !== 1) fail('The displayed atoms differ from the scientific source.');
        const atoms = new Array(expected.atomCount), point = [0, 0, 0];
        for (const unit of data.units) {
          if (unit.kind !== 0) fail('The displayed source is not an atomic structure.');
          for (const index of unit.elements) {
            if (index < 0 || index >= atoms.length || atoms[index]) fail('The displayed atom order is ambiguous.');
            unit.conformation.position(index, point);
            atoms[index] = [unit.model.atomicHierarchy.atoms.type_symbol.value(index).toUpperCase(), ...point.map(Math.fround)];
          }
        }
        if (Array.from(atoms).some(atom => !atom) || await digest(new TextEncoder().encode(JSON.stringify(atoms))) !== expected.geometrySha256) fail('The displayed geometry differs from the scientific source.');
      } else {
        const grid = data.grid, dimensions = grid?.cells?.space?.dimensions;
        if (data.sourceData?.kind !== 'cube' || !expected.decodedSourceSha256 || !sha(expected.valuesSha256)
          || !Array.isArray(expected.dimensions) || expected.dimensions.length !== 3
          || !expected.dimensions.every(value => Number.isSafeInteger(value) && value > 0)
          || expected.dimensions.reduce((a, b) => a * b, 1) > 1000000
          || !Array.isArray(expected.matrix) || expected.matrix.length !== 16 || !expected.matrix.every(Number.isFinite)
          || !dimensions || dimensions.some((value, index) => value !== expected.dimensions[index])
          || grid.transform.kind !== 'matrix' || data.instances?.some(instance => instance.transform.some((value, index) => value !== (index % 5 === 0 ? 1 : 0)))) fail('The displayed Cube differs from the scientific source.');
        // Mol* and the scientific reader use published bohr factors differing by 8.3e-11 relative.
        if (grid.transform.matrix.some((value, index) => Math.abs(value - expected.matrix[index]) > 1e-9 * Math.max(1, Math.abs(value), Math.abs(expected.matrix[index])))
          || await digest(floatBytes(grid.cells.data)) !== expected.valuesSha256) fail('The displayed Cube grid differs from the scientific source.');
        const header = data.sourceData.data.header;
        if (await digest(new TextEncoder().encode(JSON.stringify([expected.dimensions, expected.matrix]))) !== expected.geometrySha256
          || header.dataSetIds.length !== 1) fail('The scalar source grid identity is invalid.');
      }
      if (!owner.current()) throw sourceChanged();
      const binding = { lease: crypto.randomUUID(), current: owner.current, dispose: owner.dispose };
      bindings.set(plugin, binding);
      return { ok: true, result: { lease: binding.lease } };
    } catch (error) { owner.dispose(); throw error; }
  }

  function fieldBinding(viewer, lease) {
    const binding = bindings.get(viewer?.plugin);
    if (typeof lease !== 'string' || !binding || binding.lease !== lease || !binding.current()) throw sourceChanged();
    return binding.current;
  }
  window.BuretteGeometryPreview = { apply, update, field, bindField, fieldBinding };
})();
