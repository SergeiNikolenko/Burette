import { PluginStateObject as SO, PluginStateTransform } from '@molstar/plugin/state/objects';
import { ParamDefinition as PD } from '@molstar/core/util/param-definition';
import { UUID } from '@molstar/core/util/uuid';
import { Model } from '@molstar/model/model/structure/model/model';
import { Coordinates, Time } from '@molstar/model/model/structure/coordinates';
import { IndexPairBonds } from '@molstar/model/formats/structure/property/bonds/index-pair';

// Keep the scene branch and original bond candidates while coordinates move.
// XYZ candidates are rechecked against element-based distance thresholds on every
// frame, so stretched bonds disappear and return without H–H angle artifacts.
// MOL/SDF (bonds: null) keep the file's own bond table unconditionally.
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
    if (params.bonds) {
      const pairs = Object.fromEntries(Object.entries(params.bonds).map(([key, values]) => [key, { toArray: () => values }]));
      IndexPairBonds.Provider.set(model, IndexPairBonds.fromData({ count: rows.length, pairs }, { maxDistance: -1 }));
    } else {
      const declared = IndexPairBonds.Provider.get(a.data);
      if (!declared) throw new Error('Geometry lost the declared bonds.');
      IndexPairBonds.Provider.set(model, declared);
    }
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

const formats = { 'trajectory-from-xyz': 'xyz', 'trajectory-from-mol': 'mol', 'trajectory-from-sdf': 'sdf' };
// Shortest decimal that parses back to the same float32 coordinate.
function coordinate(value) {
  const target = Math.fround(value);
  for (let digits = 1; digits < 10; digits++) {
    const text = target.toPrecision(digits);
    if (Math.fround(Number(text)) === target) return String(Number(text));
  }
  return String(target);
}

// MOL/SDF baselines are a single XYZ frame of the model atoms in source order.
function modelXyz(model, format) {
  const { atoms, atomSourceIndex } = model.atomicHierarchy, { x, y, z } = model.atomicConformation;
  const count = atoms._rowCount, lines = [String(count), `Burette live geometry (${format})`];
  for (let i = 0; i < count; i++) {
    const symbol = String(atoms.type_symbol.value(i));
    if (atomSourceIndex.value(i) !== i || !/^[A-Za-z][A-Za-z0-9]*$/u.test(symbol)) throw new Error('Live Geometry requires one atom per source row.');
    lines.push(`${symbol[0].toUpperCase()}${symbol.slice(1).toLowerCase()} ${coordinate(x[i])} ${coordinate(y[i])} ${coordinate(z[i])}`);
  }
  return `${lines.join('\n')}\n`;
}
const baselines = new WeakMap();
function baseline(found) {
  if (found.format === 'xyz') return found.raw.obj.data;
  const model = found.base.obj.data;
  if (!baselines.has(model)) baselines.set(model, modelXyz(model, found.format));
  return baselines.get(model);
}

function source(plugin) {
  const roots = plugin?.managers.structure.hierarchy.current.structures;
  if (plugin?.disposed || roots?.length !== 1) throw stale();
  const root = roots[0].cell, cells = plugin.state.data.cells;
  const structure = root.obj?.data;
  if (root.status !== 'ok' || structure?.models.length !== 1 || structure.units.length !== 1 || structure.units[0].kind !== 0) throw new Error('Geometry requires a single atomic unit.');
  let base, trajectory, raw, geometry, format;
  for (let cell = root; cell;) {
    const id = cell.transform.transformer.id;
    if (id === GeometryModel.id) geometry = cell;
    if (id.endsWith('model-from-trajectory')) base = cell;
    const parser = !trajectory && Object.keys(formats).find(name => id.endsWith(name));
    if (parser) { trajectory = cell; format = formats[parser]; }
    if (trajectory && id.endsWith('raw-data')) { raw = cell; break; }
    const parent = cell.transform.parent;
    if (parent === cell.transform.ref) break;
    cell = cells.get(parent);
  }
  if (!base || !trajectory || !raw || trajectory.obj.data.frameCount !== 1) throw new Error('Live Geometry requires a single XYZ, MOL or SDF model.');
  return { root, base, trajectory, raw, geometry, format };
}

function geometryIdentity(cell) {
  return { cell, version: cell?.transform.version, object: cell?.obj };
}
function sameGeometry(cell, identity) {
  return cell === identity.cell && cell?.transform.version === identity.version && cell?.obj === identity.object;
}

function capture(plugin, isCurrent = () => true, lease) {
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
    owner = { ...found, versions, objects, lease: UUID.create22(), geometryIdentity: geometryIdentity(found.geometry) }; queue.owner = owner;
  }
  if (lease !== undefined && owner.lease !== lease) throw stale();
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
  const before = check(plugin, token), rows = xyz(text), original = xyz(baseline(before));
  if (rows.length !== original.length || rows.some((row, i) => row[0] !== original[i][0])) throw new Error('Live Geometry cannot change atom identities.');
  if (before.geometry?.transform.params.text === text) return;
  const state = plugin.state.data;
  if (state.burettePreconditionVersion !== 1 || state.buretteKeepHistoryVersion !== 1 || state.inTransaction) throw new Error('Geometry requires an independent conditional scene update.');
  const tree = state.tree, builder = state.build();
  let ref;
  if (before.geometry) {
    ref = before.geometry.transform.ref;
    builder.to(before.geometry).update({ ...before.geometry.transform.params, text });
  } else if (before.format !== 'xyz') {
    ref = builder.to(before.base).insert(GeometryModel, { text, bonds: null }).ref;
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
  coordinate,
  binding(plugin, isCurrent) {
    const token = capture(plugin, isCurrent), found = check(plugin, token);
    const text = found.geometry?.transform.params.text ?? baseline(found);
    xyz(text);
    check(plugin, token);
    return { lease: token.owner.lease, text };
  },
  // A passive update never supersedes a queued one: that item applies the pin too.
  update(plugin, text, token = capture(plugin), { passive = false } = {}) {
    const queue = queues.get(plugin);
    if (passive && queue.pending) return queue.pending.settled;
    let item;
    const result = new Promise((resolve, reject) => { item = { text, token, resolve, reject }; });
    item.settled = result.then(() => {}, () => {});
    if (queue.pending) queue.pending.reject(stale());
    queue.pending = item;
    if (!queue.running) {
      queue.running = true;
      void (async () => {
        try {
          while (queue.pending) {
            const next = queue.pending; queue.pending = null;
            try { await apply(plugin, queue.pin ? queue.pin(next.text) : next.text, next.token); next.resolve({ ok: true }); }
            catch (error) { next.reject(error); }
          }
        } finally { queue.running = false; }
      })();
    }
    return result;
  },
  // While an atom drag holds atoms, every applied text (host or drag) is rewritten
  // by `patch` right before it is applied. Returns the release function.
  pin(plugin, patch, token = capture(plugin)) {
    const queue = queues.get(plugin);
    if (queue?.owner !== token.owner) throw stale();
    queue.pin = patch;
    return () => { if (queue.pin === patch) queue.pin = null; };
  },
};
