import { PluginStateObject as SO, PluginStateTransform } from 'molstar/lib/mol-plugin-state/objects.js';
import { ParamDefinition as PD } from 'molstar/lib/mol-util/param-definition.js';
import { Model } from 'molstar/lib/mol-model/structure/model/model.js';
import { Coordinates, Time } from 'molstar/lib/mol-model/structure/coordinates.js';
import { IndexPairBonds } from 'molstar/lib/mol-model-formats/structure/property/bonds/index-pair.js';

// Keep the scene branch and original bond candidates while coordinates move.
// Recheck candidates against element-based distance thresholds on every frame,
// so stretched bonds disappear and return without introducing H–H angle artifacts.
const GeometryModel = PluginStateTransform.BuiltIn({
  name: 'burette-geometry-model', display: { name: 'Geometry' },
  from: SO.Molecule.Model, to: SO.Molecule.Model, isDecorator: true,
  params: { text: PD.Text(''), bonds: PD.Value(null, { isHidden: true }) },
})({
  apply({ a, params }) {
    const rows = xyz(params.text);
    if (rows.length !== a.data.atomicHierarchy.atoms._rowCount) throw new Error('Geometry cannot change the model atom count.');
    const frame = { elementCount: rows.length, time: Time(0, 'step'), xyzOrdering: { isIdentity: true },
      x: Float32Array.from(rows, row => Number(row[1])),
      y: Float32Array.from(rows, row => Number(row[2])),
      z: Float32Array.from(rows, row => Number(row[3])) };
    const model = Model.trajectoryFromModelAndCoordinates(a.data, Coordinates.create([frame], Time(1, 'step'), Time(0, 'step'))).representative;
    const pairs = Object.fromEntries(Object.entries(params.bonds).map(([key, values]) => [key, { toArray: () => values }]));
    IndexPairBonds.Provider.set(model, IndexPairBonds.fromData({ count: rows.length, pairs }, { maxDistance: -1 }));
    return new SO.Molecule.Model(model, { label: a.label, description: a.description });
  },
});

// Tokens retain real cells and parser/model versions; source text is never an owner ID.
// Only verified own updates advance the root and Geometry identities shared by pending tokens.
const queues = new WeakMap();
const stale = () => Object.assign(new Error('The Geometry source or viewer changed.'), { name: 'AbortError' });

function xyz(text) {
  if (typeof text !== 'string' || text.length > 3 * 1024 * 1024) throw new Error('Invalid Geometry preview size.');
  const lines = text.trimEnd().split(/\r\n?|\n/u), count = Number(lines[0]);
  if (!/^\d+$/u.test(lines[0].trim()) || !Number.isSafeInteger(count) || count < 1 || lines.length !== count + 2) throw new Error('Live Geometry requires a single XYZ frame.');
  return lines.slice(2).map(line => {
    const row = line.trim().split(/\s+/);
    if (row.length < 4 || !row.slice(1, 4).every(value => /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/u.test(value) && Number.isFinite(Math.fround(Number(value))))) throw new Error('Invalid Geometry coordinates.');
    return row;
  });
}

function source(plugin) {
  const roots = plugin?.managers.structure.hierarchy.current.structures;
  if (plugin?.disposed || roots?.length !== 1) throw stale();
  const root = roots[0].cell, cells = plugin.state.data.cells;
  const structure = root.obj?.data;
  if (root.status !== 'ok' || structure?.models.length !== 1 || structure.units.length !== 1 || structure.units[0].kind !== 0) throw new Error('Geometry requires a single atomic unit.');
  let base, trajectory, raw, geometry;
  for (let cell = root; cell;) {
    const id = cell.transform.transformer.id;
    if (id === GeometryModel.id) geometry = cell;
    if (id.endsWith('model-from-trajectory')) base = cell;
    if (id.endsWith('trajectory-from-xyz')) trajectory = cell;
    if (trajectory && id.endsWith('raw-data')) { raw = cell; break; }
    const parent = cell.transform.parent;
    if (parent === cell.transform.ref) break;
    cell = cells.get(parent);
  }
  if (!base || !trajectory || !raw || trajectory.obj.data.frameCount !== 1) throw new Error('Live Geometry requires a single XYZ frame.');
  return { root, base, trajectory, raw, geometry };
}

function geometryIdentity(cell) {
  return { cell, version: cell?.transform.version, object: cell?.obj };
}
function sameGeometry(cell, identity) {
  return cell === identity.cell && cell?.transform.version === identity.version && cell?.obj === identity.object;
}

function capture(plugin, isCurrent = () => true) {
  const found = source(plugin);
  let queue = queues.get(plugin);
  if (!queue) { queue = { running: false, pending: null, owner: null }; queues.set(plugin, queue); }
  const versions = [found.root, found.base, found.trajectory, found.raw].map(cell => cell.transform.version);
  const objects = [found.base, found.trajectory, found.raw].map(cell => cell.obj);
  let owner = queue.owner;
  if (!owner || objects.some((object, index) => object !== owner.objects[index]) || ['root', 'base', 'trajectory', 'raw'].some((key, index) => found[key] !== owner[key]
    || (versions[index] !== owner.versions[index] && (index !== 0 || versions[index] !== owner.inFlightVersion)))
    || (!sameGeometry(found.geometry, owner.geometryIdentity) && !(owner.inFlightGeometry
      && found.geometry?.transform.ref === owner.inFlightGeometry.ref && found.geometry?.transform.version === owner.inFlightGeometry.version
      && (!owner.geometry || found.geometry === owner.geometry)))) {
    owner = { ...found, versions, objects, geometryIdentity: geometryIdentity(found.geometry) }; queue.owner = owner;
  }
  return { owner, isCurrent };
}

function check(plugin, token, rootVersion = token.owner.versions[0], geometry = token.owner.geometryIdentity) {
  if (!token.isCurrent() || plugin.disposed || queues.get(plugin)?.owner !== token.owner) throw stale();
  const found = source(plugin), owner = token.owner;
  if (['root', 'base', 'trajectory', 'raw'].some((key, index) => found[key] !== owner[key]
    || found[key].transform.version !== (index ? owner.versions[index] : rootVersion))) throw stale();
  if (!sameGeometry(found.geometry, geometry) || [found.base, found.trajectory, found.raw].some((cell, index) => cell.obj !== owner.objects[index])) throw stale();
  return found;
}

async function apply(plugin, text, token) {
  const before = check(plugin, token), rows = xyz(text), original = xyz(before.raw.obj.data);
  if (rows.length !== original.length || rows.some((row, i) => row[0] !== original[i][0])) throw new Error('Live Geometry cannot change atom identities.');
  if (before.geometry?.transform.params.text === text) return;
  const state = plugin.state.data;
  if (state.burettePreconditionVersion !== 1 || state.buretteKeepHistoryVersion !== 1 || state.inTransaction) throw new Error('Geometry requires an independent conditional scene update.');
  const tree = state.tree, builder = state.build();
  let ref;
  if (before.geometry) {
    ref = before.geometry.transform.ref;
    builder.to(before.geometry).update({ ...before.geometry.transform.params, text });
  } else {
    const unit = before.root.obj.data.units[0], graph = unit.bonds;
    const bonds = { indexA: [], indexB: [], order: [], flag: [] };
    for (let i = 0; i < graph.a.length; i++) {
      if (graph.a[i] >= graph.b[i]) continue;
      bonds.indexA.push(unit.model.atomicHierarchy.atomSourceIndex.value(unit.elements[graph.a[i]]));
      bonds.indexB.push(unit.model.atomicHierarchy.atomSourceIndex.value(unit.elements[graph.b[i]]));
      bonds.order.push(graph.edgeProps.order[i]); bonds.flag.push(graph.edgeProps.flags[i]);
    }
    ref = builder.to(before.base).insert(GeometryModel, { text, bonds }).ref;
  }
  const candidate = builder.getTree(), version = candidate.transforms.get(before.root.transform.ref).version;
  const canvas = plugin.canvas3d, manualReset = canvas?.props.camera.manualReset;
  canvas?.pause(true); canvas?.setProps({ camera: { manualReset: true } });
  try {
    await plugin.runTask(state.updateTree(candidate, { revertOnError: true, revertIfAborted: true, doNotUpdateCurrent: true, buretteKeepHistory: true,
      burettePrecondition() { check(plugin, token); if (state.tree !== tree || state.inTransaction) throw stale(); token.owner.inFlightVersion = version; token.owner.inFlightGeometry = { ref, version: candidate.transforms.get(ref).version }; },
    }));
    const cell = state.cells.get(ref);
    if (cell?.status !== 'ok' || cell.transform.params.text !== text || cell.transform.version !== candidate.transforms.get(ref).version) throw new Error('The Geometry update failed or was reverted.');
    const geometry = geometryIdentity(cell);
    check(plugin, { ...token, isCurrent: () => true }, version, geometry);
    token.owner.versions[0] = version; token.owner.geometry = cell; token.owner.geometryIdentity = geometry;
    check(plugin, token);
    canvas?.commit(true);
  } finally {
    delete token.owner.inFlightVersion; delete token.owner.inFlightGeometry;
    // Coordinate previews never restore an old camera snapshot over a newer view.
    if (!plugin.disposed && plugin.canvas3d === canvas) {
      if (manualReset !== undefined) canvas.setProps({ camera: { manualReset } });
      canvas?.resume();
    }
  }
}

export const BuretteGeometry = {
  capture,
  update(plugin, text, token = capture(plugin)) {
    const queue = queues.get(plugin);
    return new Promise((resolve, reject) => {
      if (queue.pending) queue.pending.reject(stale());
      queue.pending = { text, token, resolve, reject };
      if (queue.running) return;
      queue.running = true;
      void (async () => {
        try {
          while (queue.pending) {
            const item = queue.pending; queue.pending = null;
            try { await apply(plugin, item.text, item.token); item.resolve({ ok: true }); }
            catch (error) { item.reject(error); }
          }
        } finally { queue.running = false; }
      })();
    });
  },
};
