import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BaseGeometry } from '@molstar/graphics/geo/geometry/base';
import { Cylinders } from '@molstar/graphics/geo/geometry/cylinders/cylinders';
import { CylindersBuilder } from '@molstar/graphics/geo/geometry/cylinders/cylinders-builder';
import { Mesh } from '@molstar/graphics/geo/geometry/mesh/mesh';
import { MeshBuilder } from '@molstar/graphics/geo/geometry/mesh/mesh-builder';
import { Spheres } from '@molstar/graphics/geo/geometry/spheres/spheres';
import { SpheresBuilder } from '@molstar/graphics/geo/geometry/spheres/spheres-builder';
import { TextureMesh } from '@molstar/graphics/geo/geometry/texture-mesh/texture-mesh';
import { createTransform } from '@molstar/graphics/geo/geometry/transform-data';
import { createRenderObject } from '@molstar/graphics/gl/render-object';
import { Sphere3D } from '@molstar/core/math/geometry';
import { Vec3 } from '@molstar/core/math/linear-algebra';
import { Task } from '@molstar/core/task';
import { Color } from '@molstar/core/util/color/color';
import { ValueCell } from '@molstar/core/util/value-cell';
import { TaskManager } from '@molstar/plugin/util/task-manager';
import { BuretteSceneExport } from '../scripts/molstar-scene-export.js';
import { serializeSceneMesh } from '../scripts/scene-mesh-formats.mjs';
import { PlyMeshWriter } from '../scripts/ply-mesh.mjs';

// Real Mol* render objects (the values its representations upload), exported through
// MeshExporter's tessellation into binary PLY and read back here byte by byte.

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const translation = (x, y, z) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
const transformOf = (matrices) => createTransform(new Float32Array(matrices.flat()), matrices.length);
const renderObject = (type, values, props = {}) => createRenderObject(type, values, BaseGeometry.createRenderableState(props), 0);

function spheresObject(centers, radius, matrices = [IDENTITY], props = {}) {
  const builder = SpheresBuilder.create(centers.length, 8);
  centers.forEach(([x, y, z], group) => builder.add(x, y, z, group));
  const values = Spheres.Utils.createValuesSimple(builder.getSpheres(), props, Color(0x3366cc), radius, transformOf(matrices));
  return renderObject('spheres', values, props);
}

function meshObject(triangles, matrices = [IDENTITY], props = {}) {
  const state = MeshBuilder.createState(16, 16);
  for (const [a, b, c] of triangles) MeshBuilder.addTriangle(state, Vec3.create(...a), Vec3.create(...b), Vec3.create(...c));
  const values = Mesh.Utils.createValuesSimple(MeshBuilder.getMesh(state), props, Color(0xcc6633), 1, transformOf(matrices));
  return renderObject('mesh', values, props);
}

function parsePly(bytes) {
  const marker = new TextEncoder().encode('end_header\n');
  let end = -1;
  for (let i = 0; i + marker.length <= bytes.length && end < 0; i++) {
    if (marker.every((byte, k) => bytes[i + k] === byte)) end = i + marker.length;
  }
  const header = new TextDecoder().decode(bytes.subarray(0, end));
  const count = (name) => Number(new RegExp(`element ${name} (\\d+)`).exec(header)[1]);
  const view = new DataView(bytes.buffer, bytes.byteOffset + end);
  const vertices = Array.from({ length: count('vertex') }, (_, i) => ({
    position: [0, 1, 2].map((k) => view.getFloat32(i * 28 + k * 4, true)),
    normal: [0, 1, 2].map((k) => view.getFloat32(i * 28 + 12 + k * 4, true)),
    color: [0, 1, 2, 3].map((k) => view.getUint8(i * 28 + 24 + k)),
  }));
  const faceStart = vertices.length * 28;
  const faces = Array.from({ length: count('face') }, (_, i) => {
    assert.equal(view.getUint8(faceStart + i * 13), 3);
    return [0, 1, 2].map((k) => view.getInt32(faceStart + i * 13 + 1 + k * 4, true));
  });
  assert.equal(end + faceStart + faces.length * 13, bytes.length, 'nothing follows the faces');
  return { header, vertices, faces };
}

async function exportPly(objects) {
  const result = await BuretteSceneExport.task(objects).run();
  const ply = parsePly(new Uint8Array(await result.blob.arrayBuffer()));
  assert.deepEqual([result.vertexCount, result.faceCount], [ply.vertices.length, ply.faces.length]);
  return ply;
}

const sub = (a, b) => a.map((v, i) => v - b[i]);
const dot = (a, b) => a.reduce((sum, v, i) => sum + v * b[i], 0);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const length = (a) => Math.hypot(...a);
const unit = (a) => a.map((v) => v / length(a));
const faceNormal = ({ vertices }, [a, b, c]) => cross(sub(vertices[b].position, vertices[a].position), sub(vertices[c].position, vertices[a].position));
// Column-major 4x4 applied to a point, independently of Mol*.
const apply = (m, [x, y, z]) => [0, 1, 2].map((r) => m[r] * x + m[4 + r] * y + m[8 + r] * z + m[12 + r]);
const close = (actual, expected, tolerance, message) => actual.forEach((v, i) => assert.ok(Math.abs(v - expected[i]) <= tolerance, `${message}: ${actual} vs ${expected}`));

const triangle = [[0, 0, 0], [1, 0, 0], [0, 1, 0]];

// The viewer canvas as the facade reads it: the live render objects, the camera and the background.
const canvasOf = (getRenderObjects) => ({
  getRenderObjects, graphics: undefined, props: { renderer: { backgroundColor: Color(0xffffff) } },
  camera: { scale: 1, viewport: { width: 800, height: 600 }, getSnapshot: () => ({ mode: 'perspective', position: Vec3.create(0, 0, 50), target: Vec3(), up: Vec3.create(0, 1, 0), fov: Math.PI / 4 }) },
});

test('the PLY header declares binary little-endian angstrom vertices with normals and RGBA', async () => {
  const { header } = await exportPly([meshObject([triangle])]);
  assert.equal(header, [
    'ply', 'format binary_little_endian 1.0', 'comment Burette scene mesh; coordinates in angstrom', 'element vertex 3',
    'property float x', 'property float y', 'property float z', 'property float nx', 'property float ny', 'property float nz',
    'property uchar red', 'property uchar green', 'property uchar blue', 'property uchar alpha',
    'element face 1', 'property list uchar int vertex_indices', 'end_header', '',
  ].join('\n'));
});

test('mesh instances keep their exact scene positions under non-uniform, shearing and reflecting transforms', async () => {
  const stretch = [2, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0.5, 0, 10, -5, 7, 1];
  const shear = [1, 0, 0, 0, 0.5, 1, 0, 0, 0, 0.25, 1, 0, -3, 2, 1, 1];
  const reflect = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, 0, 0, 0, 4, 1];
  const tilted = [[0, 0, 0], [1, 0, 1], [0, 2, 1]];
  const matrices = [stretch, shear, reflect];
  const ply = await exportPly([meshObject([tilted], matrices)]);
  assert.equal(ply.faces.length, 3);
  ply.faces.forEach((face, instance) => {
    const corners = face.map((index) => ply.vertices[index].position);
    // Reflection may reverse the corner order; the set of positions is the transformed triangle.
    const expected = tilted.map((point) => apply(matrices[instance], point));
    for (const point of expected) assert.ok(corners.some((corner) => length(sub(corner, point)) < 1e-5), `instance ${instance} has ${point}`);
    // Outward: the stored normal and the counter-clockwise face agree, and both are unit.
    const geometric = unit(faceNormal(ply, face));
    for (const index of face) {
      const { normal } = ply.vertices[index];
      close([length(normal)], [1], 1e-6, 'unit normal');
      close(normal, geometric, 1e-5, `instance ${instance} normal is the transformed face normal`);
    }
  });
  // The reflected instance has the original normal mirrored in z.
  const original = unit(cross(sub(tilted[1], tilted[0]), sub(tilted[2], tilted[0])));
  close(ply.vertices[ply.faces[2][0]].normal, [original[0], original[1], -original[2]], 1e-5, 'mirrored normal');

  const xs = ply.vertices.map(({ position }) => position);
  const expectedAll = matrices.flatMap((m) => tilted.map((point) => apply(m, point)));
  for (let axis = 0; axis < 3; axis++) {
    close([Math.min(...xs.map((p) => p[axis])), Math.max(...xs.map((p) => p[axis]))],
      [Math.min(...expectedAll.map((p) => p[axis])), Math.max(...expectedAll.map((p) => p[axis]))], 1e-5, `bounds on axis ${axis}`);
  }
});

test('flip-sided meshes are written with the normals and winding Mol* draws', async () => {
  const plain = await exportPly([meshObject([triangle])]);
  const flipped = await exportPly([meshObject([triangle], [IDENTITY], { flipSided: true, doubleSided: false })]);
  close(plain.vertices[0].normal, [0, 0, 1], 1e-6, 'plain normal');
  close(flipped.vertices[0].normal, [0, 0, -1], 1e-6, 'flipped normal');
  close(unit(faceNormal(flipped, flipped.faces[0])), [0, 0, -1], 1e-6, 'flipped winding');
});

test('every instance of a sphere object is tessellated around its own transformed centre', async () => {
  const centers = [[0, 0, 0], [5, 0, 0]];
  const matrices = [IDENTITY, translation(0, 10, -2)];
  const ply = await exportPly([spheresObject(centers, 1.5, matrices)]);
  const world = matrices.flatMap((m) => centers.map((c) => apply(m, c)));
  const nearest = new Map(world.map((_, i) => [i, 0]));
  for (const { position, normal } of ply.vertices) {
    const distances = world.map((center) => length(sub(position, center)));
    const index = distances.indexOf(Math.min(...distances));
    nearest.set(index, nearest.get(index) + 1);
    close([distances[index]], [1.5], 1e-4, 'on the sphere');
    // Mol* smooths sphere normals over faces, so they point outward within a fraction of a degree.
    assert.ok(dot(normal, unit(sub(position, world[index]))) > 0.999, `${normal} points out of the sphere`);
  }
  const perSphere = ply.vertices.length / 4;
  assert.deepEqual([...nearest.values()], [perSphere, perSphere, perSphere, perSphere], 'all four spheres, none from out-of-range centres');
});

test('cylinders follow the bond between their ends', async () => {
  const builder = CylindersBuilder.create(1, 1);
  builder.add(0, 0, 0, 0, 0, 4, 1, true, true, 0, 0);
  const values = Cylinders.Utils.createValuesSimple(builder.getCylinders(), {}, Color(0x999999), 0.25, transformOf([translation(1, 2, 3)]));
  const ply = await exportPly([renderObject('cylinders', values)]);
  for (const { position } of ply.vertices) {
    const [x, y, z] = sub(position, [1, 2, 3]);
    assert.ok(Math.hypot(x, y) <= 0.25 + 1e-5 && z >= -1e-5 && z <= 4 + 1e-5, `${position} lies on the capped cylinder`);
  }
  assert.ok(ply.vertices.some(({ position }) => Math.abs(position[2] - 3) < 1e-5) && ply.vertices.some(({ position }) => Math.abs(position[2] - 7) < 1e-5));
});

test('colours, overpaint and transparency are written per vertex; object opacity scales alpha', async () => {
  const object = spheresObject([[0, 0, 0], [5, 0, 0]], 1, [IDENTITY], { alpha: 0.5 });
  const { values } = object;
  ValueCell.update(values.colorType, 'group');
  ValueCell.update(values.tColor, { array: Uint8Array.from([255, 0, 0, 255, 0, 255, 0, 255]), width: 2, height: 1 });
  // Group 1 is fully overpainted blue; group 0 is 75% transparent.
  ValueCell.update(values.dOverpaint, true);
  ValueCell.update(values.overpaintType, 'groupInstance');
  ValueCell.update(values.tOverpaint, { array: Uint8Array.from([0, 0, 0, 0, 0, 0, 255, 255]), width: 2, height: 1 });
  ValueCell.update(values.dTransparency, true);
  ValueCell.update(values.transparencyType, 'groupInstance');
  ValueCell.update(values.tTransparency, { array: Uint8Array.from([191, 0]), width: 2, height: 1 });
  const ply = await exportPly([object]);
  const colors = new Set(ply.vertices.map(({ position, color }) => `${position[0] < 2.5 ? 0 : 1}:${color}`));
  assert.deepEqual([...colors].sort(), ['0:255,0,0,32', '1:0,0,255,128']);
});

test('hidden and fully transparent objects are absent; nothing visible is an error', async () => {
  const hidden = meshObject([[[100, 0, 0], [101, 0, 0], [100, 1, 0]]]);
  hidden.state.visible = false;
  const clear = meshObject([[[200, 0, 0], [201, 0, 0], [200, 1, 0]]], [IDENTITY], { alpha: 0 });
  const ply = await exportPly([hidden, meshObject([triangle]), clear]);
  assert.deepEqual(ply.vertices.map(({ position }) => position), triangle);
  await assert.rejects(BuretteSceneExport.task([hidden, clear]).run(), /no exportable triangles/u);
});

test('labels, images, volumes and clipping are refused rather than silently left out', async () => {
  const labels = renderObject('text', { drawCount: ValueCell.create(6), instanceCount: ValueCell.create(1), uAlpha: ValueCell.create(1) });
  await assert.rejects(BuretteSceneExport.task([meshObject([triangle]), labels]).run(), /cannot include text labels/u);
  labels.state.visible = false;
  await exportPly([meshObject([triangle]), labels]);
  const volume = renderObject('direct-volume', { drawCount: ValueCell.create(36), instanceCount: ValueCell.create(1), uAlpha: ValueCell.create(1) });
  await assert.rejects(BuretteSceneExport.task([volume]).run(), /direct volume rendering/u);
  const clipped = meshObject([triangle]);
  ValueCell.update(clipped.values.dClipObjectCount, 1);
  await assert.rejects(BuretteSceneExport.task([clipped]).run(), /clipping/u);
});

test('an object that would exceed 64 MiB is refused before it is tessellated or expanded', async () => {
  const spheres = spheresObject(Array.from({ length: 40000 }, (_, i) => [i % 200, Math.floor(i / 200), 0]), 0.5);
  let centerReads = 0;
  const centers = spheres.values.centerBuffer.ref.value;
  Object.defineProperty(spheres.values.centerBuffer.ref, 'value', { get: () => { centerReads++; return centers; } });
  await assert.rejects(BuretteSceneExport.task([spheres]).run(), /64 MiB/u);
  assert.equal(centerReads, 0, 'no sphere was built');

  // 20,000 triangles in 50 instances: 3,000,000 expanded vertices.
  const many = Array.from({ length: 20000 }, (_, i) => [[i, 0, 0], [i + 1, 0, 0], [i, 1, 0]]);
  const instanced = meshObject(many, Array.from({ length: 50 }, (_, i) => translation(0, 0, i)));
  let positionReads = 0;
  const positions = instanced.values.aPosition.ref.value;
  Object.defineProperty(instanced.values.aPosition.ref, 'value', { get: () => { positionReads++; return positions; } });
  await assert.rejects(BuretteSceneExport.task([instanced]).run(), /64 MiB/u);
  assert.equal(positionReads, 0, 'no instance was expanded');

  const far = meshObject([[[2e6, 0, 0], [2e6 + 1, 0, 0], [2e6, 1, 0]]]);
  await assert.rejects(BuretteSceneExport.task([far]).run(), /±1,000,000/u);
});

test('an aborted export stops between objects and rejects as cancelled', async () => {
  const objects = [meshObject([triangle]), spheresObject([[0, 0, 0]], 1)];
  const progress = [];
  const run = BuretteSceneExport.task(objects).run((update) => {
    progress.push(update.root.progress.message);
    if (update.canAbort) update.requestAbort('Cancelled by test');
  }, 0);
  await assert.rejects(run, (error) => Task.isAbort(error));
  assert.equal(progress[0], 'Exporting object 1 of 2');

  // One large instance yields inside its own loops, so Abort does not wait for it to finish.
  const large = meshObject(Array.from({ length: 100000 }, (_, i) => [[i, 0, 0], [i + 1, 0, 0], [i, 1, 0]]));
  let midway = null;
  const inside = BuretteSceneExport.task([large]).run((update) => {
    const { current, max } = update.root.progress;
    if (midway === null && current > 0 && current < max) { midway = current / max; update.requestAbort('Cancelled by test'); }
  }, 0);
  await assert.rejects(inside, (error) => Task.isAbort(error));
  assert.ok(midway > 0 && midway < 1, `aborted ${midway} of the way through the instance`);

  // Through the viewer facade, Abort in Mol*'s task overlay arrives as an AbortError.
  const plugin = {
    canvas3d: canvasOf(() => objects),
    runTask: (task) => task.run((update) => update.requestAbort('Abort'), 0),
  };
  await assert.rejects(BuretteSceneExport.exportScene(plugin), (error) => error instanceof DOMException && error.name === 'AbortError');
});

test('Abort pressed while the finished mesh is serialized still cancels the export', async () => {
  // Mol*'s overlay Abort goes to the task manager, which hands it to the task only when
  // progress is next reported. The click lands during the last, synchronous step of one
  // large object: handled at once, or queued behind it as a browser click would be.
  const toBlob = PlyMeshWriter.prototype.toBlob;
  try {
    for (const click of [(abort) => abort(), (abort) => setImmediate(abort)]) {
      const manager = new TaskManager();
      const plugin = {
        canvas3d: canvasOf(() => [large]),
        runTask: (task, params) => manager.run(task, params),
      };
      const large = meshObject(Array.from({ length: 100000 }, (_, i) => [[i, 0, 0], [i + 1, 0, 0], [i, 1, 0]]));
      let taskId, serialized = false;
      manager.events.progress.subscribe(({ progress }) => { taskId = progress.root.progress.taskId; });
      PlyMeshWriter.prototype.toBlob = function () {
        serialized = true;
        click(() => manager.requestAbort(taskId, 'User Request'));
        return toBlob.call(this);
      };
      await assert.rejects(BuretteSceneExport.exportScene(plugin), (error) => error instanceof DOMException && error.name === 'AbortError');
      assert.equal(serialized, true);
    }
  } finally { PlyMeshWriter.prototype.toBlob = toBlob; }
});

test('an Abort that runs at any turn of the event loop before the export finishes cancels it', async () => {
  // The click is queued at the n-th progress report and runs at the next turn of the loop
  // that reaches it. If it runs while the task is still running, no file may be produced.
  for (const defer of [process.nextTick, setImmediate]) {
    let ranBeforeFinish = true;
    for (let n = 1; ranBeforeFinish; n++) {
      const manager = new TaskManager();
      const objects = [meshObject([triangle]), spheresObject([[0, 0, 0]], 1)];
      const plugin = { canvas3d: canvasOf(() => objects), runTask: (task, params) => manager.run(task, params) };
      let reports = 0, finished = false;
      manager.events.finished.subscribe(() => { finished = true; });
      manager.events.progress.subscribe(({ progress }) => {
        if (++reports !== n) return;
        defer(() => { ranBeforeFinish = !finished; manager.requestAbort(progress.root.progress.taskId, 'User Request'); });
      });
      const outcome = await BuretteSceneExport.exportScene(plugin).then(() => 'saved', (error) => error.name);
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(outcome, ranBeforeFinish ? 'AbortError' : 'saved', `click queued at report ${n} of ${reports} (${defer.name})`);
      assert.ok(n < 100);
    }
  }
});

// Runs an export of `objects` and applies `change` once, when the export yields before the
// second object, as a playing trajectory, vibration or visibility toggle would.
function exportWhileChanging(objects, change, liveObjects) {
  let changed = false;
  const run = BuretteSceneExport.task(objects, { liveObjects }).run((update) => {
    if (!changed && update.root.progress.message === `Exporting object 2 of ${objects.length}`) { changed = true; change(); }
  }, 0);
  return run.finally(() => assert.equal(changed, true, 'the scene changed during the export'));
}
const sceneChanged = /scene changed during the export.*Pause the animation and export again/u;

test('a scene that changes during the export is refused instead of mixing two moments', async () => {
  const pair = () => [meshObject([triangle]), meshObject([triangle.map(([x, y, z]) => [x, y, z + 10])])];
  // The two meshes are always 10 Å apart; moving both between objects would write them 11 Å apart.
  const moved = pair();
  await assert.rejects(exportWhileChanging(moved, () => moved.forEach(({ values }) => ValueCell.update(values.aTransform, new Float32Array(translation(0, 0, 1))))), sceneChanged);
  const reshaped = pair();
  await assert.rejects(exportWhileChanging(reshaped, () => ValueCell.update(reshaped[0].values.aPosition, new Float32Array([0, 0, 1, 1, 0, 1, 0, 1, 1]))), sceneChanged);
  const recoloured = pair();
  await assert.rejects(exportWhileChanging(recoloured, () => ValueCell.update(recoloured[0].values.uColor, Color.toVec3Normalized(Vec3(), Color(0x00ff00)))), sceneChanged);
  const hidden = pair();
  await assert.rejects(exportWhileChanging(hidden, () => { hidden[1].state.visible = false; }), sceneChanged);
  const shown = [...pair(), meshObject([triangle])];
  shown[2].state.visible = false;
  await assert.rejects(exportWhileChanging(shown, () => { shown[2].state.visible = true; }), sceneChanged);
  const faded = pair();
  await assert.rejects(exportWhileChanging(faded, () => { faded[0].state.alphaFactor = 0.5; }), sceneChanged);
  // The scene gains an object (a new frame's representation) that the export never saw.
  const scene = pair();
  const live = [...scene];
  await assert.rejects(exportWhileChanging(scene, () => live.push(meshObject([triangle])), () => live), sceneChanged);

  // Hovering highlights through the marker texture, which is not exported: the export completes.
  const hovered = pair();
  const result = await exportWhileChanging(hovered, () => ValueCell.update(hovered[0].values.tMarker, hovered[0].values.tMarker.ref.value), () => hovered);
  const ply = parsePly(new Uint8Array(await result.blob.arrayBuffer()));
  assert.deepEqual(ply.faces.map(([a]) => ply.vertices[a].position[2]), [0, 10]);
  result.assertSceneUnchanged();
});

test('a change inside one large instance, before the run or before saving refuses the export', async () => {
  const large = meshObject(Array.from({ length: 100000 }, (_, i) => [[i, 0, 0], [i + 1, 0, 0], [i, 1, 0]]));
  let changed = false;
  const inside = BuretteSceneExport.task([large]).run((update) => {
    const { current, max } = update.root.progress;
    if (!changed && current > 0 && current < max) { changed = true; ValueCell.update(large.values.uColor, Color.toVec3Normalized(Vec3(), Color(0x00ff00))); }
  }, 0);
  await assert.rejects(inside, sceneChanged);
  assert.equal(changed, true);

  // The scene is captured when the export is requested, not when the task first runs.
  const early = meshObject([triangle]);
  const task = BuretteSceneExport.task([early]);
  ValueCell.update(early.values.aTransform, new Float32Array(translation(5, 0, 0)));
  await assert.rejects(task.run(), sceneChanged);

  // The saved file must still be the visible scene: the viewer checks right before downloading.
  const saved = meshObject([triangle]);
  const result = await BuretteSceneExport.task([saved]).run();
  result.assertSceneUnchanged();
  ValueCell.update(saved.values.aTransform, new Float32Array(translation(5, 0, 0)));
  assert.throws(() => result.assertSceneUnchanged(), sceneChanged);

  // Through the viewer facade the live scene membership is checked, and the refusal is not a cancellation.
  const objects = [meshObject([triangle]), meshObject([triangle])];
  const live = [...objects];
  const plugin = {
    canvas3d: canvasOf(() => [...live]),
    runTask: (task) => task.run((update) => { if (update.root.progress.message === 'Exporting object 2 of 2') live.pop(); }, 0),
  };
  await assert.rejects(BuretteSceneExport.exportScene(plugin), (error) => !(error instanceof DOMException) && sceneChanged.test(error.message));
});

test('a GPU surface whose texture readback exceeds 64 MiB is refused before any buffer is allocated', async () => {
  const surface = meshObject([triangle]);
  surface.type = 'texture-mesh';
  surface.values.uGeoTexDim = ValueCell.create([4096, 4096]);
  await assert.rejects(BuretteSceneExport.task([surface]).run(), /live viewer/u);
  const FloatArray = globalThis.Float32Array;
  let largest = 0;
  globalThis.Float32Array = new Proxy(FloatArray, { construct(target, args) {
    if (typeof args[0] === 'number') largest = Math.max(largest, args[0] * 4);
    return Reflect.construct(target, args);
  } });
  try {
    await assert.rejects(BuretteSceneExport.task([surface], { graphics: { isWebGL2: true, namedFramebuffers: {} } }).run(), /64 MiB/u);
  } finally { globalThis.Float32Array = FloatArray; }
  assert.ok(largest < 1024 * 1024, `no readback buffer was allocated (largest ${largest} bytes)`);
});

// The graphics context seam returns the RGBA texels that the surface writes.
function gpu() {
  return { reads: 0, async readTextureData(texture) { this.reads++; return { array: texture.texels }; } };
}
const gpuTexture = (width, height, texels) => ({ texels, getWidth: () => width, getHeight: () => height });
function textureMeshObject(vertexCount, [width, height], vertices, normals, matrices = [IDENTITY]) {
  const texels = (rows) => { const array = new Float32Array(width * height * 4); rows.slice(0, width * height).forEach((row, i) => array.set(row, i * 4)); return array; };
  const mesh = TextureMesh.create(vertexCount, 1, gpuTexture(width, height, texels(vertices)), gpuTexture(width, height, new Uint8Array(width * height * 4)),
    gpuTexture(width, height, texels(normals)), Sphere3D.create(Vec3.create(0, 0, 0), 2));
  const values = TextureMesh.Utils.createValuesSimple(mesh, {}, Color(0x3399cc), 1, transformOf(matrices));
  return createRenderObject('texture-mesh', values, TextureMesh.Utils.createRenderableState({}), 0);
}

test('a GPU isosurface exports what WebGL draws; an empty one is left out unread', async () => {
  const corners = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1]];
  const surface = textureMeshObject(6, [4, 2], corners, corners.map(() => [0, 0, 1]), [translation(5, 0, 0)]);
  // An isosurface level with no crossing (the negative lobe of an s orbital): the histogram
  // pyramid still reports one vertex, in large textures cached from an earlier level.
  const empty = textureMeshObject(1, [4096, 4096], [], []);
  assert.deepEqual([empty.values.drawCount.ref.value, empty.values.uVertexCount.ref.value], [1, 1]);
  const graphics = gpu();
  const result = await BuretteSceneExport.task([surface, empty], { graphics }).run();
  const ply = parsePly(new Uint8Array(await result.blob.arrayBuffer()));
  assert.equal(graphics.reads, 3, 'only the drawn surface was read back');
  assert.deepEqual(ply.vertices.map(({ position }) => position), corners.map((p) => apply(translation(5, 0, 0), p)));
  assert.deepEqual(ply.faces, [[0, 1, 2], [3, 4, 5]]);
  assert.deepEqual(ply.vertices.map(({ color }) => color), Array(6).fill([0x33, 0x99, 0xcc, 255]));
  ply.vertices.forEach(({ normal }) => assert.deepEqual(normal, [0, 0, 1]));
});

test('a GPU surface whose counts or textures disagree is refused with its metadata', async () => {
  const corners = [[0, 0, 0], [1, 0, 0], [0, 1, 0]];
  const surface = (vertexCount, dim) => textureMeshObject(vertexCount, dim, corners, corners.map(() => [0, 0, 1]));
  const stale = surface(3, [4, 2]);
  ValueCell.update(stale.values.tNormal, gpuTexture(2, 2, new Float32Array(16)));
  await assert.rejects(BuretteSceneExport.task([meshObject([triangle]), stale], { graphics: gpu() }).run(), (error) => {
    assert.match(error.message, /out of sync with its textures/u);
    assert.deepEqual(error.sceneObject, { index: 1, count: 2, type: 'texture-mesh', visible: true, drawCount: 3, vertexCount: 3, instanceCount: 1, geoTexDim: [4, 2] });
    return true;
  });
  const fractional = surface(3, [4, 2]);
  ValueCell.update(fractional.values.uGeoTexDim, [4.5, 2]);
  // More vertices than texels, an incomplete triangle, and one vertex that is not the empty-level count.
  const oneVertex = surface(1, [4, 2]);
  oneVertex.values.uVertexCount = ValueCell.create(3);
  for (const object of [surface(3, [1, 2]), surface(4, [4, 2]), surface(2, [4, 2]), oneVertex, fractional]) {
    await assert.rejects(BuretteSceneExport.task([object], { graphics: gpu() }).run(), /out of sync with its textures/u);
  }
});

test('triangles that are fully transparent at every corner are left out of every format', async () => {
  const object = meshObject([triangle, triangle.map(([x, y, z]) => [x + 5, y, z])]);
  const { values } = object;
  // Group 0 is the first triangle; it is fully transparent, the second one is opaque.
  ValueCell.update(values.aGroup, Float32Array.from([0, 0, 0, 1, 1, 1]));
  ValueCell.update(values.uGroupCount, 2);
  ValueCell.update(values.dTransparency, true);
  ValueCell.update(values.transparencyType, 'groupInstance');
  ValueCell.update(values.tTransparency, { array: Uint8Array.from([255, 0]), width: 2, height: 1 });
  const ply = await exportPly([object]);
  assert.equal(ply.faces.length, 1);
  assert.ok(ply.vertices.every(({ position }) => position[0] >= 5), 'only the opaque triangle remains');
});

// One opaque or translucent triangle chunk per entry, written straight into the mesh writer.
function writerOf(alphas) {
  const writer = new PlyMeshWriter();
  alphas.forEach((corners, i) => writer.append({
    positions: triangle.flatMap(([x, y, z]) => [x + 2 * i, y, z]),
    normals: [0, 0, 1, 0, 0, 1, 0, 0, 1],
    colors: corners.flatMap((alpha) => [10, 20, 30, alpha]),
    indices: [0, 1, 2],
  }));
  return writer;
}
const view = { mode: 'perspective', position: [0, 0, 50], target: [0, 0, 0], up: [0, 1, 0], fov: Math.PI / 4, aspect: 4 / 3, scale: 1, background: [1, 1, 1] };

test('formats that cannot hold the drawn opacity refuse instead of making the scene opaque', async () => {
  await assert.rejects(serializeSceneMesh(writerOf([[255, 255, 255], [128, 128, 128]]), 'obj', { view }), /OBJ files cannot keep translucent colours/u);
  await assert.rejects(serializeSceneMesh(writerOf([[255, 128, 255]]), 'wrl', { view }), /VRML files cannot keep opacity that varies/u);
  // Uniform opacity per face becomes one VRML shape per opacity over shared coordinates.
  const text = await (await serializeSceneMesh(writerOf([[255, 255, 255], [128, 128, 128]]), 'wrl', { view })).text();
  assert.deepEqual(text.match(/transparency [\d.]+/gu), ['transparency 0', 'transparency 0.498']);
  assert.equal(text.match(/USE SceneCoordinates/gu).length, 1);
  for (const format of ['ply', 'glb', 'x3d', 'pov']) await serializeSceneMesh(writerOf([[255, 128, 0]]), format, { view });
  await assert.rejects(serializeSceneMesh(writerOf([[255, 255, 255]]), 'stl', { view }), /Unknown 3D model format/u);
  assert.throws(() => BuretteSceneExport.task([], { format: 'stl' }), /Unknown 3D model format/u);
});

// About 1,800,000 vertices fit the binary formats but not their text in OBJ, X3D, VRML or POV-Ray.
function largeWriter() {
  const writer = new PlyMeshWriter();
  for (let chunk = 0; chunk < 4; chunk++) {
    const triangles = 150000, positions = new Float32Array(triangles * 9), indices = new Uint32Array(triangles * 3);
    for (let i = 0; i < triangles; i++) {
      positions.set([i * 1e-3 + 123.45678, -98.76543, chunk + 0.12345, i * 1e-3 + 124.45678, -98.76543, chunk + 0.12345, i * 1e-3 + 123.45678, -97.76543, chunk + 0.12345], i * 9);
      indices.set([i * 3, i * 3 + 1, i * 3 + 2], i * 3);
    }
    const normals = new Float32Array(triangles * 9).map((_, i) => (i % 3 === 2 ? 1 : 0.12345));
    writer.append({ positions, normals, colors: new Uint8Array(triangles * 12).fill(255), indices });
  }
  return writer;
}

test('text formats stop at the 64 MiB output limit, and binary ones stay within it', async () => {
  const writer = largeWriter();
  for (const format of ['obj', 'x3d', 'pov']) await assert.rejects(serializeSceneMesh(writer, format, { view }), /64 MiB/u, format);
  for (const format of ['ply', 'glb']) assert.ok((await serializeSceneMesh(writer, format, { view })).size <= 64 * 1024 * 1024, format);
});

test('Abort while a text format is written cancels the export', async () => {
  const large = meshObject(Array.from({ length: 100000 }, (_, i) => [[i, 0, 0], [i + 1, 0, 0], [i, 1, 0]]));
  let writing = null;
  const run = BuretteSceneExport.task([large], { format: 'x3d', view }).run((update) => {
    const { message, current, max } = update.root.progress;
    if (writing === null && message === 'Writing X3D file' && current > 0 && current < max) { writing = current / max; update.requestAbort('Cancelled by test'); }
  }, 0);
  await assert.rejects(run, (error) => Task.isAbort(error));
  assert.ok(writing > 0 && writing < 1, `aborted ${writing} of the way through the X3D text`);
});
