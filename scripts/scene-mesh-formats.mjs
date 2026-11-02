import { MESH_EXPORT_LIMIT } from './ply-mesh.mjs';

// Serializers for one tessellated scene (the chunks a PlyMeshWriter accepted).
// Every format keeps the scene coordinates in angstrom, unrecentred and unscaled,
// with the drawn per-vertex colour; each output is bounded by the same 64 MiB limit.
//   glTF 2.0 binary  https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html
//   Wavefront OBJ    https://paulbourke.net/dataformats/obj/
//   X3D 3.3          https://www.web3d.org/documents/specifications/19775-1/V3.3/
//   VRML 97          https://www.web3d.org/documents/specifications/14772/V2.0/
//   POV-Ray 3.7      https://www.povray.org/documentation/3.7.0/r3_4.html#r3_4_5_2_4

export const SCENE_MESH_FORMATS = {
  ply: { extension: 'ply', mimeType: 'application/octet-stream' },
  glb: { extension: 'glb', mimeType: 'model/gltf-binary' },
  obj: { extension: 'obj', mimeType: 'model/obj' },
  x3d: { extension: 'x3d', mimeType: 'model/x3d+xml' },
  wrl: { extension: 'wrl', mimeType: 'model/vrml' },
  pov: { extension: 'pov', mimeType: 'text/x-povray' },
};

const LIMIT_MESSAGE = 'The 3D model exceeds the 64 MiB export limit.';
const STEP = 0x3fff;
// Five decimals hold every float32 coordinate below 100 Å exactly and stay
// below float32 resolution further out; colours and normals need no more.
const n = value => String(Math.round(value * 1e5) / 1e5);
const triple = (array, i) => `${n(array[i])} ${n(array[i + 1])} ${n(array[i + 2])}`;
const unit = value => String(Math.round(value / 255 * 1e4) / 1e4);

// Text output that refuses to grow past the export limit; every text format is ASCII.
class TextOutput {
  #parts = [];
  #lines = [];
  #bytes = 0;

  line(text) {
    this.#bytes += text.length + 1;
    if (this.#bytes > MESH_EXPORT_LIMIT) throw new Error(LIMIT_MESSAGE);
    this.#lines.push(text);
    if (this.#lines.length >= 4096) this.#flush();
  }

  #flush() {
    if (this.#lines.length) this.#parts.push(`${this.#lines.join('\n')}\n`);
    this.#lines = [];
  }

  blob(type) {
    this.#flush();
    return new Blob(this.#parts, { type });
  }
}

// Calls fn for every vertex (or face) of the scene, reporting progress between
// batches so a large serialization stays abortable.
async function each(chunks, kind, work, fn) {
  for (const chunk of chunks) {
    const count = kind === 'vertex' ? chunk.positions.length / 3 : chunk.indices.length / 3;
    for (let i = 0; i < count; i++) {
      if ((work.done++ & STEP) === 0) await work.progress(work.done, work.total);
      fn(chunk, i);
    }
  }
}

const isOpaque = chunks => chunks.every(({ colors }) => colors.every((value, i) => i % 4 !== 3 || value === 255));

// The camera of the viewport as a rotation from the default X3D/VRML view (looking
// down -Z with +Y up) in axis-angle form, and the vertical and smaller field of view.
function viewpoint(view) {
  const sub = (a, b) => a.map((v, i) => v - b[i]);
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const normalize = a => a.map(v => v / Math.hypot(...a));
  const back = normalize(sub(view.position, view.target));
  const right = normalize(cross(view.up, back));
  const up = cross(back, right);
  // Columns right, up, back; the axis-angle of this rotation matrix.
  const m = [[right[0], up[0], back[0]], [right[1], up[1], back[1]], [right[2], up[2], back[2]]];
  const angle = Math.acos(Math.max(-1, Math.min(1, (m[0][0] + m[1][1] + m[2][2] - 1) / 2)));
  let axis = [m[2][1] - m[1][2], m[0][2] - m[2][0], m[1][0] - m[0][1]];
  if (Math.hypot(...axis) < 1e-9) {
    // 0 or 180 degrees: the axis is the column of R + I with the largest norm.
    const columns = [0, 1, 2].map(c => [0, 1, 2].map(r => m[r][c] + (r === c ? 1 : 0)));
    axis = angle < 1e-6 ? [0, 0, 1] : columns.reduce((best, c) => (Math.hypot(...c) > Math.hypot(...best) ? c : best));
  }
  const height = 2 * Math.tan(view.fov / 2) * Math.hypot(...sub(view.position, view.target)) * view.scale;
  return {
    orientation: `${normalize(axis).map(n).join(' ')} ${n(angle)}`,
    smallerFov: view.aspect >= 1 ? view.fov : 2 * Math.atan(Math.tan(view.fov / 2) * view.aspect),
    height,
  };
}

function glb(chunks, vertexCount, faceCount) {
  const views = [vertexCount * 12, vertexCount * 12, vertexCount * 4, faceCount * 12];
  const binLength = views.reduce((sum, length) => sum + length, 0);
  if (binLength + 4096 > MESH_EXPORT_LIMIT) throw new Error(LIMIT_MESSAGE);
  const bin = new ArrayBuffer(binLength);
  const positions = new Float32Array(bin, 0, vertexCount * 3), normals = new Float32Array(bin, views[0], vertexCount * 3);
  const colors = new Uint8Array(bin, views[0] + views[1], vertexCount * 4), indices = new Uint32Array(bin, views[0] + views[1] + views[2], faceCount * 3);
  let vertex = 0, face = 0;
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const chunk of chunks) {
    positions.set(chunk.positions, vertex * 3);
    normals.set(chunk.normals, vertex * 3);
    // glTF vertex colours are linear; the scene draws sRGB.
    for (let i = 0; i < chunk.colors.length; i++) {
      const c = chunk.colors[i] / 255;
      colors[vertex * 4 + i] = i % 4 === 3 ? chunk.colors[i] : Math.round((c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4) * 255);
    }
    for (let i = 0; i < chunk.positions.length; i++) {
      min[i % 3] = Math.min(min[i % 3], chunk.positions[i]);
      max[i % 3] = Math.max(max[i % 3], chunk.positions[i]);
    }
    indices.set(chunk.indices, face * 3);
    vertex += chunk.positions.length / 3;
    face += chunk.indices.length / 3;
  }
  let offset = 0;
  const bufferViews = views.map((byteLength, i) => {
    const entry = { buffer: 0, byteOffset: offset, byteLength, target: i === 3 ? 34963 : 34962 };
    offset += byteLength;
    return entry;
  });
  const json = {
    asset: { version: '2.0', generator: 'Burette' },
    extras: { lengthUnit: 'angstrom' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: 'Burette scene' }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1, COLOR_0: 2 }, indices: 3, material: 0, mode: 4 }] }],
    materials: [{ pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 1 }, alphaMode: isOpaque(chunks) ? 'OPAQUE' : 'BLEND', doubleSided: false }],
    buffers: [{ byteLength: binLength }],
    bufferViews,
    accessors: [
      { bufferView: 0, componentType: 5126, count: vertexCount, type: 'VEC3', min, max },
      { bufferView: 1, componentType: 5126, count: vertexCount, type: 'VEC3' },
      { bufferView: 2, componentType: 5121, normalized: true, count: vertexCount, type: 'VEC4' },
      { bufferView: 3, componentType: 5125, count: faceCount * 3, type: 'SCALAR' },
    ],
  };
  let text = JSON.stringify(json);
  text += ' '.repeat((4 - (text.length % 4)) % 4);
  const header = new DataView(new ArrayBuffer(20));
  header.setUint32(0, 0x46546c67, true);
  header.setUint32(4, 2, true);
  header.setUint32(8, 12 + 8 + text.length + 8 + binLength, true);
  header.setUint32(12, text.length, true);
  header.setUint32(16, 0x4e4f534a, true);
  const binHeader = new DataView(new ArrayBuffer(8));
  binHeader.setUint32(0, binLength, true);
  binHeader.setUint32(4, 0x004e4942, true);
  return new Blob([header.buffer, text, binHeader.buffer, bin], { type: SCENE_MESH_FORMATS.glb.mimeType });
}

async function obj(chunks, work) {
  if (!isOpaque(chunks)) throw new Error('OBJ files cannot keep translucent colours. Export glTF, PLY or X3D, or make the scene opaque.');
  const out = new TextOutput();
  out.line('# Burette scene; coordinates in angstrom');
  out.line('o burette_scene');
  await each(chunks, 'vertex', work, ({ positions, colors }, i) => {
    out.line(`v ${triple(positions, i * 3)} ${unit(colors[i * 4])} ${unit(colors[i * 4 + 1])} ${unit(colors[i * 4 + 2])}`);
  });
  await each(chunks, 'vertex', work, ({ normals }, i) => out.line(`vn ${triple(normals, i * 3)}`));
  await each(chunks, 'face', work, ({ indices }, i) => {
    const [a, b, c] = [indices[i * 3] + 1, indices[i * 3 + 1] + 1, indices[i * 3 + 2] + 1];
    out.line(`f ${a}//${a} ${b}//${b} ${c}//${c}`);
  });
  return out.blob(SCENE_MESH_FORMATS.obj.mimeType);
}

async function x3d(chunks, work, view) {
  const out = new TextOutput();
  const camera = viewpoint(view);
  const [r, g, b] = view.background.map(n);
  out.line('<?xml version="1.0" encoding="UTF-8"?>');
  out.line('<!DOCTYPE X3D PUBLIC "ISO//Web3D//DTD X3D 3.3//EN" "https://www.web3d.org/specifications/x3d-3.3.dtd">');
  out.line('<X3D profile="Interchange" version="3.3" xmlns:xsd="http://www.w3.org/2001/XMLSchema-instance" xsd:noNamespaceSchemaLocation="https://www.web3d.org/specifications/x3d-3.3.xsd">');
  out.line('<head><unit category="length" name="angstrom" conversionFactor="1e-10"/><meta name="generator" content="Burette"/></head>');
  out.line('<Scene>');
  out.line(`<Background skyColor="${r} ${g} ${b}"/>`);
  out.line(view.mode === 'orthographic'
    ? `<OrthoViewpoint position="${view.position.map(n).join(' ')}" orientation="${camera.orientation}" centerOfRotation="${view.target.map(n).join(' ')}" fieldOfView="${[-camera.height * view.aspect / 2, -camera.height / 2, camera.height * view.aspect / 2, camera.height / 2].map(n).join(' ')}"/>`
    : `<Viewpoint position="${view.position.map(n).join(' ')}" orientation="${camera.orientation}" centerOfRotation="${view.target.map(n).join(' ')}" fieldOfView="${n(camera.smallerFov)}"/>`);
  out.line('<Shape><Appearance><Material diffuseColor="1 1 1"/></Appearance>');
  out.line('<IndexedTriangleSet solid="true" ccw="true" colorPerVertex="true" normalPerVertex="true" index="');
  await each(chunks, 'face', work, ({ indices }, i) => out.line(triple(indices, i * 3)));
  out.line('"><Coordinate point="');
  await each(chunks, 'vertex', work, ({ positions }, i) => out.line(triple(positions, i * 3)));
  out.line('"/><Normal vector="');
  await each(chunks, 'vertex', work, ({ normals }, i) => out.line(triple(normals, i * 3)));
  out.line('"/><ColorRGBA color="');
  await each(chunks, 'vertex', work, ({ colors }, i) => out.line([0, 1, 2, 3].map(k => unit(colors[i * 4 + k])).join(' ')));
  out.line('"/></IndexedTriangleSet></Shape>');
  out.line('</Scene>');
  out.line('</X3D>');
  return out.blob(SCENE_MESH_FORMATS.x3d.mimeType);
}

// VRML colours carry no alpha; translucency belongs to a shape's material. Faces
// are grouped into one shape per opacity over shared coordinates, normals and colours.
async function wrl(chunks, work, view, vertexCount, faceCount) {
  const alpha = new Uint8Array(vertexCount);
  let vertex = 0;
  for (const { colors } of chunks) for (let i = 3; i < colors.length; i += 4) alpha[vertex++] = colors[i];
  // Faces bucketed by opacity: counts, then scene face indices in bucket order.
  const faceAlpha = new Uint8Array(faceCount), counts = new Uint32Array(256);
  let face = 0;
  for (const { indices } of chunks) {
    for (let i = 0; i < indices.length; i += 3, face++) {
      const value = alpha[indices[i]];
      if (alpha[indices[i + 1]] !== value || alpha[indices[i + 2]] !== value) {
        throw new Error('VRML files cannot keep opacity that varies across a surface. Export glTF, PLY or X3D.');
      }
      faceAlpha[face] = value;
      counts[value]++;
    }
  }
  work.total = 2 * vertexCount + faceCount * counts.filter(Boolean).length;
  const out = new TextOutput();
  const camera = viewpoint(view);
  out.line('#VRML V2.0 utf8');
  out.line('# Burette scene; coordinates in angstrom');
  out.line('WorldInfo { title "Burette scene" info [ "length unit: angstrom" ] }');
  out.line(`Background { skyColor [ ${view.background.map(n).join(' ')} ] }`);
  out.line(`Viewpoint { position ${view.position.map(n).join(' ')} orientation ${camera.orientation} fieldOfView ${n(camera.smallerFov)} description "View" }`);
  let first = true;
  for (let value = 255; value > 0; value--) {
    if (!counts[value]) continue;
    out.line(`Shape { appearance Appearance { material Material { diffuseColor 1 1 1 transparency ${unit(255 - value)} } }`);
    out.line('geometry IndexedFaceSet { solid TRUE ccw TRUE colorPerVertex TRUE normalPerVertex TRUE');
    if (first) {
      out.line('coord DEF SceneCoordinates Coordinate { point [');
      await each(chunks, 'vertex', work, ({ positions }, i) => out.line(`${triple(positions, i * 3)},`));
      out.line('] }');
      out.line('normal DEF SceneNormals Normal { vector [');
      await each(chunks, 'vertex', work, ({ normals }, i) => out.line(`${triple(normals, i * 3)},`));
      out.line('] }');
      out.line('color DEF SceneColors Color { color [');
      for (const { colors } of chunks) {
        for (let i = 0; i < colors.length; i += 4) out.line(`${unit(colors[i])} ${unit(colors[i + 1])} ${unit(colors[i + 2])},`);
      }
      out.line('] }');
      first = false;
    } else {
      out.line('coord USE SceneCoordinates normal USE SceneNormals color USE SceneColors');
    }
    out.line('coordIndex [');
    let index = 0;
    await each(chunks, 'face', work, ({ indices }, i) => {
      if (faceAlpha[index++] === value) out.line(`${indices[i * 3]}, ${indices[i * 3 + 1]}, ${indices[i * 3 + 2]}, -1,`);
    });
    out.line('] } }');
  }
  return out.blob(SCENE_MESH_FORMATS.wrl.mimeType);
}

async function pov(chunks, work, view, vertexCount, faceCount) {
  const out = new TextOutput();
  const camera = viewpoint(view);
  const vector = values => `<${values.map(n).join(', ')}>`;
  out.line('// Burette scene; coordinates in angstrom');
  out.line('#version 3.7;');
  out.line('global_settings { assumed_gamma 1.0 ambient_light rgb 1 }');
  out.line(`background { srgb ${vector(view.background)} }`);
  // A right vector along -x keeps the scene's right-handed coordinates as they are.
  out.line(view.mode === 'orthographic'
    ? `camera { orthographic location ${vector(view.position)} sky ${vector(view.up)} right ${n(-camera.height * view.aspect)}*x up ${n(camera.height)}*y look_at ${vector(view.target)} }`
    : `camera { perspective location ${vector(view.position)} sky ${vector(view.up)} right ${n(-view.aspect)}*x up y angle ${n(2 * Math.atan(Math.tan(view.fov / 2) * view.aspect) * 180 / Math.PI)} look_at ${vector(view.target)} }`);
  out.line(`light_source { ${vector(view.position)} color rgb 1 }`);
  out.line('#default { finish { ambient 0.15 diffuse 0.75 specular 0.2 roughness 0.02 } }');
  out.line('mesh2 {');
  out.line(`vertex_vectors { ${vertexCount},`);
  await each(chunks, 'vertex', work, ({ positions }, i) => out.line(`<${n(positions[i * 3])}, ${n(positions[i * 3 + 1])}, ${n(positions[i * 3 + 2])}>,`));
  out.line('}');
  out.line(`normal_vectors { ${vertexCount},`);
  await each(chunks, 'vertex', work, ({ normals }, i) => out.line(`<${n(normals[i * 3])}, ${n(normals[i * 3 + 1])}, ${n(normals[i * 3 + 2])}>,`));
  out.line('}');
  // One texture per distinct drawn colour; faces interpolate their corners' textures.
  const textures = new Map(), vertexTexture = new Uint32Array(vertexCount);
  let vertex = 0;
  for (const { colors } of chunks) {
    for (let i = 0; i < colors.length; i += 4, vertex++) {
      const key = ((colors[i] << 24) | (colors[i + 1] << 16) | (colors[i + 2] << 8) | colors[i + 3]) >>> 0;
      if (!textures.has(key)) textures.set(key, textures.size);
      vertexTexture[vertex] = textures.get(key);
    }
  }
  out.line(`texture_list { ${textures.size},`);
  for (const key of textures.keys()) {
    const channel = shift => unit((key >>> shift) & 255);
    out.line(`texture { pigment { srgbt <${channel(24)}, ${channel(16)}, ${channel(8)}, ${n(1 - ((key & 255) / 255))}> } }`);
  }
  out.line('}');
  out.line(`face_indices { ${faceCount},`);
  await each(chunks, 'face', work, ({ indices }, i) => {
    const [a, b, c] = [indices[i * 3], indices[i * 3 + 1], indices[i * 3 + 2]];
    out.line(`<${a}, ${b}, ${c}>, ${vertexTexture[a]}, ${vertexTexture[b]}, ${vertexTexture[c]},`);
  });
  out.line('}');
  out.line('}');
  return out.blob(SCENE_MESH_FORMATS.pov.mimeType);
}

/**
 * The scene accepted by `writer` as a file of `format`. `view` is the viewport camera
 * ({ mode, position, target, up, fov, aspect, scale, background }) for the formats that
 * carry one; `progress(done, total)` is awaited between batches of elements.
 */
export async function serializeSceneMesh(writer, format, { view, progress = async () => {} } = {}) {
  if (!SCENE_MESH_FORMATS[format]) throw new Error(`Unknown 3D model format: ${format}.`);
  if (!writer.faceCount) throw new Error('The scene contains no exportable triangles.');
  const chunks = writer.chunks, vertexCount = writer.vertexCount, faceCount = writer.faceCount;
  const work = { done: 0, total: 2 * vertexCount + faceCount + (format === 'x3d' ? vertexCount : 0), progress };
  switch (format) {
    case 'ply': return writer.toBlob();
    case 'glb': return glb(chunks, vertexCount, faceCount);
    case 'obj': return obj(chunks, work);
    case 'x3d': return x3d(chunks, work, view);
    case 'wrl': return wrl(chunks, work, view, vertexCount, faceCount);
    case 'pov': return pov(chunks, work, view, vertexCount, faceCount);
  }
}
