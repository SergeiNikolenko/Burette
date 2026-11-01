// Private polymer role picking. The source/model lifetime stays inside its viewer.
if (!window.BurettePolymerPick) {
  const owners = new WeakMap();
  const stale = () => Object.assign(new Error('The polymer source changed. Choose the atoms again.'), { name: 'AbortError' });
  async function bind(viewer, action, currentViewer, notify, signal) {
    const expected = action.expected, plugin = viewer?.plugin;
    if (typeof action.lease !== 'string' || !action.lease || action.lease.length > 128
      || !expected || !['mol', 'sdf'].includes(expected.format) || !/^[a-f0-9]{64}$/.test(expected.sourceSha256)
      || !Array.isArray(expected.atoms) || expected.atoms.length < 1 || expected.atoms.length > 256
      || expected.atoms.some(a => !a || typeof a.element !== 'string' || ![a.x, a.y, a.z].every(Number.isFinite))) throw new Error('Invalid polymer source.');
    owners.get(plugin)?.retire();
    const roots = plugin?.managers.structure.hierarchy.current.structures;
    const cell = roots?.length === 1 ? roots[0].cell : null, structure = cell?.obj?.data;
    if (!structure || structure.models.length !== 1) throw new Error('Open one molecular source before picking polymer atoms.');
    const ancestors = [];
    for (let node = cell; node;) {
      ancestors.push({ cell: node, object: node.obj, data: node.obj?.data, version: node.transform.version });
      if (node.transform.ref === node.transform.parent) break;
      node = plugin.state.data.cells.get(node.transform.parent);
    }
    let retired = false, subscription;
    const pending = new AbortController();
    const current = () => !retired && !plugin.disposed && currentViewer() === viewer
      && plugin.managers.structure.hierarchy.current.structures.length === 1
      && plugin.managers.structure.hierarchy.current.structures[0].cell === cell
      && ancestors.every(a => plugin.state.data.cells.get(a.cell.transform.ref) === a.cell
        && a.cell.obj === a.object && a.cell.obj?.data === a.data && a.cell.transform.version === a.version);
    const retire = (report = true) => {
      if (retired) return;
      retired = true; subscription?.unsubscribe(); pending.abort();
      if (owners.get(plugin) === owner) owners.delete(plugin);
      if (report) notify({ type: 'polymer_source_retired', lease: action.lease });
    };
    const owner = { lease: action.lease, structure, current, retire, signal: pending.signal, cancelPick: null };
    owners.set(plugin, owner);
    subscription = plugin.state.data.events.changed.subscribe({ next: () => { if (!current()) retire(); }, complete: retire });
    signal.addEventListener('abort', retire, { once: true });
    try {
      signal.throwIfAborted();
      const report = await window.BuretteSceneFiles.science.graphBinding(viewer, expected.format);
      if (!current()) throw stale();
      if (report.sourceSha256 !== expected.sourceSha256 || report.frameIndex !== 0 || report.frameCount !== 1
        || report.atomCount !== expected.atoms.length || expected.atoms.some((atom, i) => atom.element !== report.elements[i]
          || [atom.x, atom.y, atom.z].some((v, axis) => Math.fround(v) !== Math.fround(report.positions[3 * i + axis])))) throw new Error('The displayed molecule differs from the polymer source.');
      return { lease: owner.lease, atomCount: report.atomCount };
    } catch (error) { retire(false); throw error; }
    finally { signal.removeEventListener('abort', retire); }
  }
  function owned(viewer, lease) {
    const owner = owners.get(viewer?.plugin);
    if (!owner || owner.lease !== lease) throw stale();
    if (!owner.current()) { owner.retire(); throw stale(); }
    return owner;
  }
  function pick(viewer, lease, signal) {
    const owner = owned(viewer, lease); owner.cancelPick?.();
    return new Promise((resolve, reject) => {
      let subscription;
      const cleanup = () => { subscription?.unsubscribe(); signal.removeEventListener('abort', abort); owner.signal.removeEventListener('abort', abort); if (owner.cancelPick === abort) owner.cancelPick = null; };
      const abort = () => { cleanup(); reject(stale()); };
      owner.cancelPick = abort;
      signal.addEventListener('abort', abort, { once: true }); owner.signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted || owner.signal.aborted) { abort(); return; }
      // MolStar uses a BehaviorSubject: its replayed last click predates this role.
      let armed = false;
      subscription = viewer.plugin.behaviors.interaction.click.subscribe(event => {
        if (!armed || event.button !== 1) return;
        const loci = event.current?.loci, runtime = window.molstar.lib.structure.StructureElement;
        if (!runtime.Loci.is(loci) || runtime.Loci.size(loci) !== 1) return;
        try {
          if (!owner.current()) throw stale();
          const location = runtime.Loci.getFirstLocation(loci), unit = location.unit;
          const sourceUnit = owner.structure.unitMap.get(unit.id), atom = location.element;
          if (!sourceUnit || sourceUnit.model !== unit.model || sourceUnit.conformation.operator !== unit.conformation.operator
            || !sourceUnit.elements.includes(atom)) throw new Error('Pick an atom in the polymer source molecule.');
          const sourceIndex = unit.model.atomicHierarchy.atomSourceIndex.value(atom);
          if (!Number.isSafeInteger(sourceIndex) || sourceIndex < 0 || sourceIndex >= owner.structure.elementCount) throw stale();
          cleanup(); resolve({ lease, sourceIndex, element: unit.model.atomicHierarchy.atoms.type_symbol.value(atom) });
        } catch (error) { cleanup(); reject(error); }
      });
      armed = true;
    });
  }
  function release(viewer, lease) { const owner = owners.get(viewer?.plugin); if (owner?.lease === lease) owner.retire(); }
  window.BurettePolymerPick = { bind, pick, release };
}
