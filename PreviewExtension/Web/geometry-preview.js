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

  window.BuretteGeometryPreview = { apply };
})();
