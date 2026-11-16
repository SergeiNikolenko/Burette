import { isMergedRenderObject } from '@molstar/graphics/gl/render-object';
import { MeshExporter } from '@molstar/geo-export-extension/mesh-exporter';
import { Mesh } from '@molstar/graphics/geo/geometry/mesh/mesh';
import { MeshBuilder } from '@molstar/graphics/geo/geometry/mesh/mesh-builder';
import { addCylinder } from '@molstar/graphics/geo/geometry/mesh/builder/cylinder';
import { addSphere } from '@molstar/graphics/geo/geometry/mesh/builder/sphere';
import { Mat3, Mat4, Vec3 } from '@molstar/core/math/linear-algebra';
import { Task } from '@molstar/core/task';
import { Color } from '@molstar/core/util/color/color';
import { PlyMeshWriter } from './ply-mesh.mjs';
import { SCENE_MESH_FORMATS, serializeSceneMesh } from './scene-mesh-formats.mjs';

// The visible Mol* scene as one triangle mesh, written as PLY, glTF, OBJ, X3D, VRML
// or POV-Ray. Mol*'s MeshExporter tessellates each render object exactly as it does
// for its own OBJ/GLB export; unlike those exporters this one keeps scene-space
// positions (no recentering or scaling), writes per-vertex colour and opacity, and
// refuses what a triangle mesh cannot hold instead of dropping it.

const MAX_COORDINATE = 1e6;
// GPU readback buffers share the 64 MiB budget of the file.
const READBACK_LIMIT = 64 * 1024 * 1024;
// MeshExporter's framebuffer name for texture readback, shared with Mol*'s own exporters.
const UNSUPPORTED = { text: 'text labels', image: 'images', 'direct-volume': 'direct volume rendering' };

// Vertex and triangle counts of one Mol* primitive, measured with Mol*'s own builders.
const primitiveCounts = new Map();
function primitive(key, build) {
  if (!primitiveCounts.has(key)) {
    const state = MeshBuilder.createState(256, 128);
    build(state);
    // Index elements are triangles: each element is one triple.
    primitiveCounts.set(key, { vertices: state.vertices.elementCount, faces: state.indices.elementCount });
  }
  return primitiveCounts.get(key);
}
const sphereCounts = detail => primitive(`sphere:${detail}`, state => addSphere(state, Vec3(), 1, detail));
const cylinderCounts = (radialSegments, topCap, bottomCap) => primitive(`cylinder:${radialSegments}:${topCap}:${bottomCap}`,
  state => addCylinder(state, Vec3(), Vec3.create(0, 1, 0), 1, { radiusTop: 1, radiusBottom: 1, topCap, bottomCap, radialSegments }));

// MeshExporter's own quality choice for the number of primitives in the object.
function sphereDetail(quality, total) {
  if (quality === 'high') return 3;
  if (quality === 'medium') return 2;
  if (quality === 'low') return 1;
  return total < 2000 ? 3 : total < 20000 ? 2 : 1;
}
function cylinderSegments(quality, total) {
  if (quality === 'high') return 36;
  if (quality === 'medium') return 24;
  if (quality === 'low') return 12;
  return total < 2000 ? 36 : total < 20000 ? 24 : 12;
}

const value = (values, name) => values[name]?.ref.value;

const INVALID_SURFACE = 'This GPU surface is out of sync with its textures. Show it again and export.';
const OUT_OF_RANGE = '3D model coordinates must be finite and within ±1,000,000 Å.';

// Triangles of a GPU isosurface, drawn unindexed from drawCount vertices. Mol*'s histogram
// pyramid reports at least one vertex, so a level without any crossing has
// drawCount = uVertexCount = 1 and draws nothing; every other count holds whole triangles.
function textureMeshTriangles(values) {
  if (value(values, 'drawIndirect') || value(values, 'dIsoChunks'))
    throw new Error('This GPU surface uses indirect geometry and cannot be exported as a 3D model.');
  const drawCount = value(values, 'drawCount');
  if (drawCount === 1 && value(values, 'uVertexCount') === 1) return 0;
  if (!Number.isSafeInteger(drawCount) || drawCount < 0 || drawCount % 3 !== 0) throw new Error(INVALID_SURFACE);
  return drawCount / 3;
}

// Bytes Mol* reads back from the GPU for one object before it uses any of them: the whole
// position, normal and group textures of a texture mesh, and the whole grid texture of
// each volume colouring it interpolates.
function readbackBytes(renderObject) {
  const { type, values } = renderObject;
  let bytes = 0;
  if (type === 'texture-mesh') {
    const [width, height] = value(values, 'uGeoTexDim') ?? [];
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) throw new Error(INVALID_SURFACE);
    bytes += width * height * 4 * (4 + 4 + 4);
  }
  const colorType = value(values, 'colorType');
  const grids = [
    (colorType === 'volume' || colorType === 'volumeInstance') && 'tColorGrid',
    value(values, 'overpaintType') === 'volumeInstance' && 'tOverpaintGrid',
    value(values, 'transparencyType') === 'volumeInstance' && 'tTransparencyGrid',
  ].filter(Boolean);
  for (const name of grids) {
    const texture = value(values, name), width = texture?.getWidth(), height = texture?.getHeight();
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 0 || height < 0) {
      throw new Error('This volume colouring does not match its grid. Show it again and export.');
    }
    bytes += width * height * 4;
  }
  return bytes;
}

// Bounded numbers that identify the object an export refused, attached to the error as
// `sceneObject`; no buffers.
function describeObject({ type, values, state }, index, count) {
  const number = name => (typeof value(values, name) === 'number' ? value(values, name) : undefined);
  const dim = value(values, 'uGeoTexDim');
  return {
    index, count, type, visible: state.visible,
    drawCount: number('drawCount'), vertexCount: number('uVertexCount'), instanceCount: number('instanceCount'),
    ...(type === 'texture-mesh' && dim ? { geoTexDim: [Number(dim[0]), Number(dim[1])] } : {}),
  };
}

// Highlight/selection markers, renderer-wide flags and Mol*'s lazily filled vertex index
// change without changing what is exported.
const UNEXPORTED_CELLS = new Set(['tMarker', 'uMarker', 'uMarkerTexDim', 'markerAverage', 'markerStatus', 'dMarkerType', 'dColorMarker', 'dLightCount', 'aVertex']);
const SCENE_CHANGED = 'The 3D scene changed during the export, for example by a playing trajectory or vibration. Pause the animation and export again.';

// The scene as it was when the export was requested: the render objects, their visibility
// and every exported value. Mol* replaces a cell's box on each ValueCell.update, so an
// unchanged box means the value the exporter reads is the one that was shown.
class SceneSnapshot {
  constructor(renderObjects, liveObjects) {
    this.liveObjects = liveObjects;
    this.objects = renderObjects.map(renderObject => ({
      renderObject,
      visible: renderObject.state.visible,
      alphaFactor: renderObject.state.alphaFactor,
      // A hidden object is left out, so only its visibility matters.
      cells: renderObject.state.visible
        ? Object.entries(renderObject.values).filter(([name, cell]) => !UNEXPORTED_CELLS.has(name) && cell?.ref).map(([, cell]) => [cell, cell.ref])
        : [],
    }));
  }

  assertUnchanged() {
    const live = this.liveObjects?.();
    const changed = (live && (live.length !== this.objects.length || live.some((object, i) => object !== this.objects[i].renderObject)))
      || this.objects.some(({ renderObject: { state }, visible, alphaFactor, cells }) => state.visible !== visible
        || state.alphaFactor !== alphaFactor || cells.some(([cell, box]) => cell.ref !== box));
    if (changed) throw new Error(SCENE_CHANGED);
  }
}

// Long loops yield to Mol*'s task runtime this often; it reports progress and throws once Abort is requested.
const CHECKPOINT = 0x3fff;

class SceneMeshExporter extends MeshExporter {
  constructor(writer, snapshot) {
    super();
    this.writer = writer;
    this.snapshot = snapshot;
    this.options = { ...this.options, linesAsTriangles: true, pointsAsTriangles: true };
  }

  // Every ctx.update yields to the event loop, where playback can change the scene.
  async yield(ctx, progress) {
    await ctx.update(progress);
    this.snapshot.assertUnchanged();
  }

  async checkpoint(ctx, current, max) {
    if (ctx.shouldUpdate) await this.yield(ctx, { isIndeterminate: false, current, max });
  }

  // Counts after tessellation of every instance, known before any of it is built.
  estimate(renderObject) {
    const { type, values } = renderObject;
    const instances = value(values, 'instanceCount');
    const quality = this.options.primitivesQuality;
    switch (type) {
      case 'mesh': {
        const original = Mesh.getOriginalData(values);
        return original
          ? { vertices: original.vertexCount * instances, faces: original.triangleCount * instances }
          : { vertices: value(values, 'uVertexCount') * instances, faces: value(values, 'drawCount') / 3 * instances };
      }
      case 'texture-mesh': {
        // Unindexed: every drawn triangle has three vertices of its own.
        const triangles = textureMeshTriangles(values);
        return { vertices: triangles * 3 * instances, faces: triangles * instances };
      }
      case 'spheres': {
        const count = value(values, 'uVertexCount') / 6;
        const sphere = sphereCounts(sphereDetail(quality, count * instances));
        return { vertices: sphere.vertices * count * instances, faces: sphere.faces * count * instances };
      }
      case 'cylinders': {
        const count = value(values, 'uVertexCount') / 6, caps = value(values, 'aCap');
        const segments = cylinderSegments(quality, count * instances);
        let vertices = 0, faces = 0;
        for (let i = 0; i < count; i++) {
          const cap = caps[i * 6];
          const counts = cylinderCounts(segments, cap === 1 || cap === 3, cap >= 2);
          vertices += counts.vertices;
          faces += counts.faces;
        }
        return { vertices: vertices * instances, faces: faces * instances };
      }
      case 'lines': {
        // Each line becomes a capped six-sided cylinder, or one segment of a tube that is never larger.
        const lines = value(values, 'drawCount') / 6, cylinder = cylinderCounts(6, true, true);
        return { vertices: cylinder.vertices * lines * instances, faces: cylinder.faces * lines * instances };
      }
      case 'points': {
        const sphere = sphereCounts(0), points = value(values, 'uVertexCount');
        return { vertices: sphere.vertices * points * instances, faces: sphere.faces * points * instances };
      }
      default:
        return null;
    }
  }

  add(renderObject, graphics, ctx) {
    const { type, values, state } = renderObject;
    if (!state.visible || value(values, 'drawCount') === 0 || value(values, 'instanceCount') === 0) return undefined;
    // Fully transparent objects are not drawn.
    if (value(values, 'uAlpha') <= 0) return undefined;
    if (UNSUPPORTED[type]) throw new Error(`A 3D model cannot include ${UNSUPPORTED[type]}. Hide them and export again.`);
    if (type === 'texture-mesh' && textureMeshTriangles(values) === 0) return undefined;
    if (value(values, 'dClipObjectCount') > 0 || value(values, 'dClipping')) {
      throw new Error('A 3D model cannot reproduce clipping. Turn clipping off and export again.');
    }
    const estimate = this.estimate(renderObject);
    if (!estimate) throw new Error(`A 3D model cannot include ${type} geometry.`);
    const bounds = value(values, 'boundingSphere');
    if (bounds && [0, 1, 2].some(axis => !(Math.abs(bounds.center[axis]) + bounds.radius <= MAX_COORDINATE))) {
      throw new Error(OUT_OF_RANGE);
    }
    this.writer.checkCapacity(estimate.vertices, estimate.faces);
    if (type === 'texture-mesh' && !graphics) throw new Error('This surface can only be exported from the live viewer.');
    if (graphics && (type === 'mesh' || type === 'texture-mesh') && readbackBytes(renderObject) > READBACK_LIMIT) {
      throw new Error('Reading this GPU surface back would exceed the 64 MiB export limit.');
    }
    return super.add(renderObject, graphics, ctx);
  }

  // MeshExporter.addTextureMesh, once the textures are known to hold every vertex it reads.
  async addTextureMesh(values, graphics, ctx) {
    const [width, height] = value(values, 'uGeoTexDim');
    const textures = [value(values, 'tPosition'), value(values, 'tNormal'), value(values, 'tGroup')];
    const vertexCount = value(values, 'uVertexCount'), drawCount = textureMeshTriangles(values) * 3;
    if (textures.some(texture => texture?.getWidth() !== width || texture.getHeight() !== height)
        || !Number.isSafeInteger(vertexCount) || drawCount > vertexCount || vertexCount > width * height) {
      throw new Error(INVALID_SURFACE);
    }
    const [{ array: vertices }, { array: normals }, { array: groups }] =
      await Promise.all(textures.map(texture => graphics.readTextureData(texture)));
    if (!(vertices instanceof Float32Array) || !(normals instanceof Float32Array)
        || !(groups instanceof Uint8Array || groups instanceof Float32Array)
        || [vertices, normals, groups].some(array => array.length !== width * height * 4)) {
      throw new Error(INVALID_SURFACE);
    }
    await this.addMeshWithColors({ mesh: { vertices, normals, indices: undefined, groups, vertexCount, drawCount }, meshes: undefined, values, isGeoTexture: true, mode: 'triangles', graphics, ctx });
  }

  // MeshExporter.addSpheres reads instanceCount times as many centres as one instance
  // holds; every instance of an object shares the same spheres.
  async addSpheres(values, graphics, ctx) {
    const center = Vec3();
    const centers = value(values, 'centerBuffer'), groups = value(values, 'groupBuffer');
    const instanceCount = value(values, 'instanceCount'), sphereCount = value(values, 'uVertexCount') / 6;
    const detail = sphereDetail(this.options.primitivesQuality, sphereCount * instanceCount);
    const meshes = [], vertexMapping = [];
    for (let instanceIndex = 0; instanceIndex < instanceCount; ++instanceIndex) {
      const state = MeshBuilder.createState(512, 256);
      for (let i = 0; i < sphereCount; ++i) {
        if ((i & CHECKPOINT) === 0) await this.checkpoint(ctx, instanceIndex * sphereCount + i, instanceCount * sphereCount);
        Vec3.fromArray(center, centers, i * 3);
        const vertexOffset = state.vertices.elementCount;
        addSphere(state, center, MeshExporter.getSize(values, instanceIndex, groups[i], i), detail);
        if (instanceIndex === 0) for (let v = vertexOffset; v < state.vertices.elementCount; ++v) vertexMapping.push(i);
      }
      meshes.push(MeshBuilder.getMesh(state));
    }
    await this.addMeshWithColors({ mesh: undefined, meshes, values, isGeoTexture: false, mode: 'triangles', graphics, ctx, vertexMapping });
  }

  async addMeshWithColors(input) {
    const { mesh, values, isGeoTexture, mode, graphics, ctx } = input;
    if (mode !== 'triangles') throw new Error(`A 3D model cannot include ${mode} primitives.`);
    const instanceCount = value(values, 'uInstanceCount');
    const colorType = value(values, 'colorType'), overpaintType = value(values, 'overpaintType');
    const transparencyType = value(values, 'transparencyType');
    const needsGraphics = colorType === 'volume' || colorType === 'volumeInstance'
      || (value(values, 'dOverpaint') && overpaintType === 'volumeInstance')
      || (value(values, 'dTransparency') && transparencyType === 'volumeInstance');
    if (needsGraphics && !(graphics && mesh)) throw new Error('This volume colouring can only be exported from the live viewer.');
    const stride = isGeoTexture ? 4 : 3;
    const interpolatedColors = graphics && mesh && (colorType === 'volume' || colorType === 'volumeInstance')
      ? await MeshExporter.getInterpolatedColors(graphics, { vertices: mesh.vertices, vertexCount: mesh.vertexCount, values, stride, colorType }) : undefined;
    const interpolatedOverpaint = graphics && mesh && overpaintType === 'volumeInstance'
      ? await MeshExporter.getInterpolatedOverpaint(graphics, { vertices: mesh.vertices, vertexCount: mesh.vertexCount, values, stride, colorType: overpaintType }) : undefined;
    const interpolatedTransparency = graphics && mesh && transparencyType === 'volumeInstance'
      ? await MeshExporter.getInterpolatedTransparency(graphics, { vertices: mesh.vertices, vertexCount: mesh.vertexCount, values, stride, colorType: transparencyType }) : undefined;

    // Every instance is expanded into its own chunk: check them together first.
    let vertexTotal = 0, faceTotal = 0;
    for (let i = 0; i < instanceCount; ++i) {
      const instance = MeshExporter.getInstance(input, i);
      vertexTotal += instance.vertexCount;
      faceTotal += instance.drawCount / 3;
    }
    this.writer.checkCapacity(vertexTotal, faceTotal);
    // Progress counts vertices transformed and coloured and triangles read, across all instances.
    const work = 2 * vertexTotal + faceTotal;
    let done = 0;

    // Mol* draws flip-sided geometry with inverted normals and clockwise front faces.
    const flipSided = Boolean(value(values, 'dFlipSided')) && !value(values, 'uDoubleSided');
    const uAlpha = value(values, 'uAlpha'), aTransform = value(values, 'aTransform');
    const t = Mat4(), n = Mat3(), a = Vec3(), b = Vec3(), c = Vec3(), ab = Vec3(), ac = Vec3(), face = Vec3(), normal = Vec3();
    await this.yield(ctx, { isIndeterminate: false, current: 0, max: work });
    for (let instanceIndex = 0; instanceIndex < instanceCount; ++instanceIndex) {
      const { vertices, normals, indices, groups, vertexCount, drawCount, vertexMapping } = MeshExporter.getInstance(input, instanceIndex);
      Mat4.fromArray(t, aTransform, instanceIndex * 16);
      Mat3.directionTransform(n, t);
      // A reflecting instance turns counter-clockwise triangles clockwise; reverse them back.
      const reverse = (Mat4.determinant(t) < 0) !== flipSided;
      const world = new Float64Array(vertexCount * 3), alpha = new Uint8Array(vertexCount);
      const geoData = { values, groups, vertexCount, instanceIndex, isGeoTexture, mode, vertexMapping };
      for (let v = 0; v < vertexCount; ++v) {
        if ((v & CHECKPOINT) === 0) await this.checkpoint(ctx, done + v, work);
        Vec3.transformMat4(a, Vec3.fromArray(a, vertices, v * stride), t);
        Vec3.toArray(a, world, v * 3);
        const transparency = MeshExporter.getTransparency(v, geoData, interpolatedTransparency);
        alpha[v] = Math.round(Math.min(1, Math.max(0, uAlpha * (1 - transparency))) * 255);
      }
      done += vertexCount;
      // Triangles without area, or fully transparent at every corner, draw nothing and are
      // left out; their vertices form the chunk only through a triangle that is drawn.
      // Non-finite geometry is an error, never skipped.
      const local = new Int32Array(vertexCount).fill(-1), used = [], triangles = [], fallback = [];
      for (let i = 0; i < drawCount; i += 3) {
        if (((i / 3) & CHECKPOINT) === 0) await this.checkpoint(ctx, done + i / 3, work);
        const i0 = isGeoTexture ? i : indices[i], i1 = isGeoTexture ? i + 1 : indices[i + 1], i2 = isGeoTexture ? i + 2 : indices[i + 2];
        Vec3.fromArray(a, world, i0 * 3); Vec3.fromArray(b, world, i1 * 3); Vec3.fromArray(c, world, i2 * 3);
        Vec3.cross(face, Vec3.sub(ab, b, a), Vec3.sub(ac, c, a));
        const area = Vec3.magnitude(face);
        if (!Number.isFinite(area)) throw new Error(OUT_OF_RANGE);
        if (area === 0 || (alpha[i0] === 0 && alpha[i1] === 0 && alpha[i2] === 0)) continue;
        if (reverse) Vec3.negate(face, face);
        for (const corner of reverse ? [i0, i2, i1] : [i0, i1, i2]) {
          if (local[corner] < 0) { local[corner] = used.length; used.push(corner); fallback.push(Vec3.clone(face)); }
          triangles.push(local[corner]);
        }
      }
      done += drawCount / 3;
      if (used.length === 0) { done += vertexCount; continue; }
      const positions = new Float64Array(used.length * 3), outNormals = new Float64Array(used.length * 3), colors = new Uint8Array(used.length * 4);
      for (let j = 0; j < used.length; ++j) {
        if ((j & CHECKPOINT) === 0) await this.checkpoint(ctx, done + j, work);
        const v = used[j];
        positions.set(world.subarray(v * 3, v * 3 + 3), j * 3);
        Vec3.transformMat3(normal, Vec3.fromArray(normal, normals, v * stride), n);
        if (flipSided) Vec3.negate(normal, normal);
        // A vertex without a usable normal takes the geometric normal of its first triangle.
        if (!(Vec3.magnitude(normal) > 0)) Vec3.copy(normal, fallback[j]);
        Vec3.toArray(normal, outNormals, j * 3);
        Color.toArray(MeshExporter.getColor(v, geoData, interpolatedColors, interpolatedOverpaint), colors, j * 4);
        colors[j * 4 + 3] = alpha[v];
      }
      done += vertexCount;
      this.writer.append({ positions, normals: outNormals, colors, indices: Int32Array.from(triangles) });
    }
  }
}

/**
 * Writes the visible render objects into one file of `format`, reporting progress on a
 * Mol* task context. The file holds one moment of the scene: any change after the
 * snapshot rejects the export.
 */
async function writeScene(snapshot, graphics, ctx, format, view) {
  const writer = new PlyMeshWriter();
  const exporter = new SceneMeshExporter(writer, snapshot);
  const { objects } = snapshot;
  for (let i = 0; i < objects.length; i++) {
    // Progress per object is throttled so the scene check stays linear in the object count.
    if (i === 0 || ctx.shouldUpdate) {
      await exporter.yield(ctx, { message: `Exporting object ${i + 1} of ${objects.length}`, isIndeterminate: false, current: i, max: objects.length, canAbort: true });
    }
    try {
      await exporter.add(objects[i].renderObject, graphics, ctx);
    } catch (error) {
      if (error && typeof error === 'object' && !Task.isAbort(error)) error.sceneObject = describeObject(objects[i].renderObject, i, objects.length);
      throw error;
    }
  }
  // Mol*'s overlay leaves Abort with the task manager, which hands it to the task only when
  // progress is next reported, and a click waits for the event loop. Two turns of the loop
  // after the last synchronous serialization step let a click queued behind it run; the
  // last report does not wait, so no click can run between the last Abort check and the
  // finished file. Text formats also report between batches while they are written.
  const message = `Writing ${SCENE_MESH_FORMATS[format].extension.toUpperCase()} file`;
  const writing = { message, isIndeterminate: true };
  await exporter.yield(ctx, writing);
  const blob = await serializeSceneMesh(writer, format, {
    view,
    progress: (current, max) => exporter.checkpoint(ctx, current, max),
  });
  await exporter.yield(ctx, writing);
  await exporter.yield(ctx, writing);
  ctx.update(writing);
  snapshot.assertUnchanged();
  return {
    blob, vertexCount: writer.vertexCount, faceCount: writer.faceCount,
    /** Throws if the scene has changed since the export was requested; call right before saving. */
    assertSceneUnchanged: () => snapshot.assertUnchanged(),
  };
}

// The viewport camera and background, for the formats that carry a view.
function viewOf(canvas) {
  const { camera } = canvas;
  const state = camera.getSnapshot();
  const { width, height } = camera.viewport;
  const background = Color.toVec3Normalized(Vec3(), canvas.props.renderer.backgroundColor);
  return {
    mode: state.mode, position: Array.from(state.position), target: Array.from(state.target), up: Array.from(state.up),
    fov: state.fov, aspect: width > 0 && height > 0 ? width / height : 1, scale: camera.scale, background: Array.from(background),
  };
}

export const BuretteSceneExport = {
  formats: SCENE_MESH_FORMATS,
  /**
   * A Mol* task that exports the given render objects as `format`. Their state is captured
   * now; with `liveObjects`, the scene must also still hold exactly these objects. `view`
   * is the camera the X3D, VRML and POV-Ray files open with.
   */
  task(renderObjects, { format = 'ply', graphics, liveObjects, view } = {}) {
    if (!SCENE_MESH_FORMATS[format]) throw new Error(`Unknown 3D model format: ${format}.`);
    const members = objects => objects.flatMap(object => isMergedRenderObject(object) ? object.members : [object]);
    const snapshot = new SceneSnapshot(members(renderObjects), liveObjects && (() => members(liveObjects())));
    return Task.create('Export 3D model', ctx => writeScene(snapshot, graphics, ctx, format, view));
  },
  /**
   * The visible scene of `plugin` as a `format` file in scene coordinates (angstrom), run
   * as a Mol* task with progress and Abort. An aborted export rejects with an AbortError;
   * a scene that changes before the file is complete rejects with an error to retry.
   */
  async exportScene(plugin, format = 'ply') {
    const canvas = plugin.canvas3d;
    if (!canvas) throw new Error('The 3D viewer is not ready.');
    const task = this.task(canvas.getRenderObjects(), {
      format, graphics: canvas.graphics, liveObjects: () => canvas.getRenderObjects(), view: viewOf(canvas),
    });
    try {
      return await plugin.runTask(task, { useOverlay: true });
    } catch (error) {
      if (Task.isAbort(error)) throw new DOMException('3D model export cancelled.', 'AbortError');
      throw error;
    }
  },
};
