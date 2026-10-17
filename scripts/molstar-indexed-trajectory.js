import { Task } from 'molstar/lib/mol-task/index.js';
import { PluginStateObject, PluginStateTransform } from 'molstar/lib/mol-plugin-state/objects.js';
import { ParamDefinition as PD } from 'molstar/lib/mol-util/param-definition.js';
import { Model } from 'molstar/lib/mol-model/structure/model/model.js';
import { Coordinates, Time } from 'molstar/lib/mol-model/structure/coordinates.js';
import { Cell } from 'molstar/lib/mol-math/geometry/spacegroup/cell.js';
import { Vec3 } from 'molstar/lib/mol-math/linear-algebra.js';
import { parseXtc } from 'molstar/lib/mol-io/reader/xtc/parser.js';

const readers = new WeakMap();
const FRAME_CACHE_BYTES = 32 * 1024 * 1024;

function dcdCell(values) {
  if (!values || ![0, 2, 5].some(i => values[i] !== 0)) return undefined;
  const [a, gamma, b, beta, alpha, c] = values;
  // CHARMM/NAMD write cosines or angles; newer CHARMM writes the symmetric
  // cell matrix. DCD stores gamma before beta and alpha, unlike Cell.create.
  if ([gamma, beta, alpha].every(angle => angle >= -1 && angle <= 1)) {
    return Cell.create(Vec3.create(a, b, c), Vec3.create(Math.acos(alpha), Math.acos(beta), Math.acos(gamma)));
  }
  if (values.some(value => value < 0) || [gamma, beta, alpha].some(value => value > 180)) {
    return Cell.fromBasis(Vec3.create(a, gamma, beta), Vec3.create(gamma, b, alpha), Vec3.create(beta, alpha, c));
  }
  const rad = angle => (Math.abs(angle) < 1e-6 ? 90 : angle) * Math.PI / 180;
  return Cell.create(Vec3.create(a, b, c), Vec3.create(rad(alpha), rad(beta), rad(gamma)));
}

// Native expands fixed atoms and normalizes byte order. Decode the single
// emitted frame, preserving non-orthogonal cells and source atom ordering.
function decodeDcd(data, timePs) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (view.getUint32(0, true) !== 84) throw new Error('Invalid indexed DCD header.');
  const charmm = view.getUint32(84, true) !== 0;
  const hasCell = charmm && view.getUint32(48, true) !== 0;
  let offset = 92;
  offset += view.getUint32(offset, true) + 8;
  const count = view.getUint32(offset + 4, true);
  offset += 12;
  let cell;
  if (hasCell) {
    if (view.getUint32(offset, true) !== 48) throw new Error('Unsupported indexed DCD cell.');
    cell = dcdCell(Array.from({ length: 6 }, (_, i) => view.getFloat64(offset + 4 + i * 8, true)));
    offset += 56;
  }
  const axes = [];
  for (let axis = 0; axis < 3; axis++) {
    if (view.getUint32(offset, true) !== count * 4) throw new Error('Invalid indexed DCD axis.');
    offset += 4;
    axes.push(new Float32Array(data.buffer.slice(data.byteOffset + offset, data.byteOffset + offset + count * 4)));
    offset += count * 4 + 4;
  }
  return { elementCount: count, x: axes[0], y: axes[1], z: axes[2], cell, xyzOrdering: { isIdentity: true }, time: Time(timePs ?? 0, timePs == null ? 'step' : 'ps') };
}

function decodeTrr(data) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const header = 12 + Math.ceil(view.getUint32(8) / 4) * 4;
  const sizes = Array.from({ length: 10 }, (_, i) => view.getUint32(header + i * 4));
  const count = view.getUint32(header + 40);
  const precision = sizes[2] ? sizes[2] / 9 : sizes[7] / (count * 3);
  if (![4, 8].includes(precision)) throw new Error('Invalid indexed TRR precision.');
  const float = offset => precision === 8 ? view.getFloat64(offset) : view.getFloat32(offset);
  const time = float(header + 52);
  let offset = header + 52 + 2 * precision;
  let cell;
  if (sizes[2]) {
    const box = Array.from({ length: 9 }, (_, i) => float(offset + i * precision) * 10);
    if (box.some(value => value !== 0)) cell = Cell.fromBasis(Vec3.fromArray(Vec3(), box, 0), Vec3.fromArray(Vec3(), box, 3), Vec3.fromArray(Vec3(), box, 6));
  }
  offset += sizes[2] + sizes[3] + sizes[4];
  const x = new Float32Array(count), y = new Float32Array(count), z = new Float32Array(count);
  for (let atom = 0; atom < count; atom++) {
    x[atom] = float(offset) * 10;
    y[atom] = float(offset + precision) * 10;
    z[atom] = float(offset + 2 * precision) * 10;
    offset += 3 * precision;
  }
  return { elementCount: count, x, y, z, cell, xyzOrdering: { isIdentity: true }, time: Time(time, 'ps') };
}

async function decodeFrame(format, bytes, timePs, ctx, cellBasis) {
  if (format === 'dcd') {
    const frame = decodeDcd(bytes, timePs);
    if (cellBasis?.some(value => value !== 0)) frame.cell = Cell.fromBasis(Vec3.fromArray(Vec3(), cellBasis, 0), Vec3.fromArray(Vec3(), cellBasis, 3), Vec3.fromArray(Vec3(), cellBasis, 6));
    return frame;
  }
  if (format === 'trr') return decodeTrr(bytes);
  const parsed = await parseXtc(bytes).runInContext(ctx);
  if (parsed.isError) throw new Error(parsed.message);
  const file = parsed.result;
  if (file.frames.length !== 1) throw new Error('Indexed reader returned more than one frame.');
  const frame = file.frames[0], box = file.boxes[0];
  return {
    elementCount: frame.count, x: frame.x, y: frame.y, z: frame.z,
    cell: box?.some(value => value !== 0) ? Cell.fromBasis(Vec3.fromArray(Vec3(), box, 0), Vec3.fromArray(Vec3(), box, 3), Vec3.fromArray(Vec3(), box, 6)) : undefined,
    xyzOrdering: { isIdentity: true }, time: Time(file.times[0], 'ps')
  };
}

function coordinates(frame) {
  return Coordinates.create([frame], Time(0, frame.time.unit), frame.time);
}

function createTrajectory(template, descriptor, first, requestFrame, releaseReader) {
  const cache = new Map([[0, first]]);
  let cacheBytes = first.x.byteLength * 3;
  let disposed = false;
  let prefetch;
  let readTail = Promise.resolve();
  const pending = new Map();
  const frameBytes = descriptor.atomCount * 12;
  const remember = (index, frame) => {
    if (frameBytes > FRAME_CACHE_BYTES) return;
    if (cache.has(index)) cacheBytes -= frameBytes;
    cache.delete(index);
    cache.set(index, frame);
    cacheBytes += frameBytes;
    while (cache.size > 3 || cacheBytes > FRAME_CACHE_BYTES) {
      cache.delete(cache.keys().next().value);
      cacheBytes -= frameBytes;
    }
  };
  const fetch = async (index, ctx, signal) => {
    const previous = readTail;
    let release;
    readTail = new Promise(resolve => { release = resolve; });
    await previous;
    try {
      if (disposed || signal?.aborted) throw Task.Aborted('Trajectory frame request cancelled.');
      const payload = await requestFrame(index, signal);
      if (disposed || signal?.aborted) throw Task.Aborted('Trajectory frame request cancelled.');
      const frame = await decodeFrame(descriptor.format, payload.bytes, payload.timePs, ctx, payload.cellBasis);
      if (frame.elementCount !== descriptor.atomCount) throw new Error('Trajectory frame atom count changed.');
      remember(index, frame);
      return frame;
    } finally { release(); }
  };
  const modelFor = (frame, index) => {
    const model = Model.trajectoryFromModelAndCoordinates(template, coordinates(frame)).representative;
    model.modelNum = index;
    Model.TrajectoryInfo.set(model, { index, size: descriptor.frameCount });
    return model;
  };
  const trajectory = {
    frameCount: descriptor.frameCount,
    duration: descriptor.frameCount,
    representative: modelFor(first, 0),
    getFrameAtIndex(index) {
      return Task.create('Read trajectory frame', async ctx => {
        if (disposed || !Number.isInteger(index) || index < 0 || index >= descriptor.frameCount) throw new Error('Trajectory frame is unavailable.');
        await ctx.update({ canAbort: true, message: `Reading frame ${index + 1}` });
        // Only one speculative read exists. A seek outside it cancels its reply;
        // the native side does at most one bounded frame read for that request.
        if (prefetch && prefetch.index !== index) {
          prefetch.controller.abort();
          pending.delete(prefetch.index);
          prefetch = undefined;
        }
        let frame = cache.get(index);
        // A cached frame must not bypass source-revision checks after an
        // external edit. Validation performs no coordinate I/O/serialization.
        if (frame) await requestFrame(index, undefined, true);
        if (!frame) {
          const inFlight = pending.get(index);
          if (inFlight) frame = await inFlight;
          else {
            const promise = fetch(index, ctx);
            pending.set(index, promise);
            try { frame = await promise; }
            finally { if (pending.get(index) === promise) pending.delete(index); }
          }
        }
        await ctx.update({ canAbort: true });
        if (disposed) throw Task.Aborted('Trajectory was closed.');
        const next = index + 1;
        if (frameBytes <= FRAME_CACHE_BYTES / 3 && next < descriptor.frameCount && !cache.has(next) && !pending.has(next)) {
          const controller = new AbortController();
          prefetch = { index: next, controller };
          // Decoding uses its own task context so a completed presentation task
          // never retains an active child context for background prefetch.
          const promise = Task.create('Prefetch trajectory frame', background => fetch(next, background, controller.signal)).run();
          pending.set(next, promise);
          void promise.catch(() => {}).finally(() => {
            if (pending.get(next) === promise) pending.delete(next);
            if (prefetch?.controller === controller) prefetch = undefined;
          });
        }
        return modelFor(frame, index);
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      prefetch?.controller.abort();
      cache.clear();
      pending.clear();
      cacheBytes = 0;
      releaseReader?.();
      releaseReader = undefined;
      requestFrame = undefined;
      template = undefined;
      first = undefined;
    }
  };
  return trajectory;
}

const IndexedTrajectory = PluginStateTransform.BuiltIn({
  name: 'burette-indexed-trajectory',
  display: { name: 'Trajectory' },
  from: PluginStateObject.Root,
  to: PluginStateObject.Molecule.Trajectory,
  params: { modelRef: PD.Text(''), descriptor: PD.Value({}) }
})({
  getDependencies: params => [params.modelRef],
  apply({ params, dependencies }, plugin) {
    return Task.create('Open file-backed trajectory', async ctx => {
      const previous = readers.get(plugin);
      const { indexKey, segmentIndex = 0 } = params.descriptor;
      const restore = globalThis.BuretteReadIndexedTrajectoryFrame;
      if (previous?.indexKey !== indexKey && typeof restore !== 'function') throw new Error('Trajectory source is no longer open. Reopen the trajectory.');
      // Each transform owns its binding, even when undo recreates the same
      // source before the previous transform is disposed.
      const reader = previous?.indexKey === indexKey
        ? { ...previous }
        : { indexKey, request: (index, signal, validateOnly) => restore(indexKey, segmentIndex, index, signal, validateOnly) };
      readers.set(plugin, reader);
      try {
        const initialPayload = reader.firstBytes
          ? { bytes: reader.firstBytes, timePs: params.descriptor.firstTimePs, cellBasis: params.descriptor.firstCellBasis }
          : await reader.request(0);
        const first = await decodeFrame(params.descriptor.format, initialPayload.bytes, initialPayload.timePs, ctx, initialPayload.cellBasis);
        reader.firstBytes = undefined;
        if (previous?.indexKey === indexKey) previous.firstBytes = undefined;
        const object = dependencies[params.modelRef];
        const initial = object.type === PluginStateObject.Molecule.Topology.type
          ? await Model.trajectoryFromTopologyAndCoordinates(object.data, coordinates(first)).runInContext(ctx)
          : Model.trajectoryFromModelAndCoordinates(object.data, coordinates(first));
        const trajectory = createTrajectory(initial.representative, params.descriptor, first, reader.request, () => {
          if (readers.get(plugin) === reader) readers.delete(plugin);
        });
        return new PluginStateObject.Molecule.Trajectory(trajectory, { label: 'Trajectory', description: `${trajectory.frameCount} frames` });
      } catch (error) {
        if (readers.get(plugin) === reader) readers.delete(plugin);
        throw error;
      }
    });
  },
  dispose({ b }) { b?.data.dispose(); }
});

export const BuretteIndexedTrajectory = {
  async load(viewer, pair, options, request) {
    const plugin = viewer.plugin;
    const descriptor = { ...pair.coordinateEntry.indexedTrajectory, segmentIndex: pair.coordinateEntry.segmentIndex ?? 0 };
    // One source per native trajectory runtime. Disposal only releases this
    // binding, never a newer attachment to the same plugin.
    const reader = { indexKey: descriptor.indexKey, firstBytes: pair.coordinateEntry.data, request };
    readers.set(plugin, reader);
    try {
      const data = await plugin.builders.data.rawData({ data: pair.modelEntry.data, label: pair.modelEntry.label });
      let model;
      if (pair.modelKind === 'model-data') {
        model = await plugin.builders.structure.createModel(await plugin.builders.structure.parseTrajectory(data, pair.modelEntry.format));
      } else {
        model = (await plugin.dataFormats.get(pair.modelEntry.format).parse(plugin, data)).topology;
      }
      const trajectory = await plugin.build().toRoot().apply(IndexedTrajectory, { modelRef: model.ref, descriptor }, { dependsOn: [model.ref] }).commit();
      await plugin.builders.structure.hierarchy.applyPreset(trajectory, 'default', options);
    } catch (error) {
      if (readers.get(plugin) === reader) readers.delete(plugin);
      throw error;
    }
  }
};
