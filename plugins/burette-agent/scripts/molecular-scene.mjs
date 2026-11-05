import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';

const fail = message => { throw Object.assign(new Error(message), { code: 'INVALID_SCENE' }); };
const hex = value => typeof value === 'string' && /^#[a-f\d]{6}$/iu.test(value);
const node = (kind, params, children) => ({ kind, ...(params ? { params } : {}), ...(children ? { children } : {}) });

function selector(value) {
  if (value.chain != null && (typeof value.chain !== 'string' || value.chain.length > 16)) fail('Invalid author chain.');
  if (value.residues != null && (!Array.isArray(value.residues) || value.residues.length > 256 || !value.residues.every(Number.isSafeInteger))) fail('Invalid author residues.');
  if (value.residue != null && !Number.isSafeInteger(value.residue)) fail('Invalid author residue.');
  if (value.componentId != null && (typeof value.componentId !== 'string' || !/^[a-z\d]{1,16}$/iu.test(value.componentId))) fail('Invalid component ID.');
  const base = { ...(value.chain != null ? { auth_asym_id: value.chain } : {}), ...(value.componentId ? { label_comp_id: value.componentId } : {}) };
  const residues = value.residues ?? (value.residue != null ? [value.residue] : null);
  return residues ? residues.map(auth_seq_id => ({ ...base, auth_seq_id })) : Object.keys(base).length ? base : 'polymer';
}

/** A self-contained MolViewSpec is shared by headless export and native reopening. */
export async function createMolecularScene(documents, scene = {}) {
  if (!Array.isArray(documents) || !documents.length || documents.length > 8) fail('A scene needs 1–8 authorized documents.');
  const layers = scene.layers ?? documents.map(document => ({ documentId: document.id, representation: 'cartoon', color: '#6ba6b8' }));
  const labels = scene.labels ?? [];
  if (!Array.isArray(layers) || !layers.length || layers.length > 32 || !Array.isArray(labels) || labels.length > 32) fail('A scene supports 1–32 layers and up to 32 labels.');
  if (scene.background != null && !hex(scene.background)) fail('Background must be a hex color.');
  const transforms = scene.transforms ?? [];
  if (!Array.isArray(transforms) || transforms.length > 8 || new Set(transforms.map(value => value.documentId)).size !== transforms.length) fail('Scene transforms must have unique document IDs, at most 8.');
  const ids = new Set(documents.map(document => document.id));
  if ([...layers, ...labels, ...transforms].some(value => !ids.has(value.documentId))) fail('Scene refers to an unauthorized document.');
  const camera = scene.camera ?? {};
  const directions = { front: [0, 0, -1], left: [1, 0, 0] };
  if (camera.direction != null && !Object.hasOwn(directions, camera.direction)) fail('Camera direction must be front or left.');
  const zoom = camera.zoom ?? 1.15;
  if (!Number.isFinite(zoom) || zoom < 0.5 || zoom > 2) fail('Camera zoom must be 0.5–2.');
  const focus = { direction: directions[camera.direction ?? 'front'], up: [0, 1, 0], radius_factor: 1 / zoom };
  const hasCartoon = layers.some(layer => layer.representation === 'cartoon');
  const children = [], sources = [];
  let totalBytes = 0;
  for (const document of documents) {
    if (!['pdb', 'cif', 'mmcif'].includes(document.format)) fail('Autonomous scenes support PDB and mmCIF.');
    const size = (await stat(document.path)).size;
    if (size < 1 || size > 16 * 1024 * 1024 || (totalBytes += size) > 16 * 1024 * 1024) fail('Scene sources exceed 16 MiB.');
    const bytes = await readFile(document.path);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (document.sha256 && document.sha256 !== sha256) fail('Immutable source digest changed.');
    sources.push({ documentId: document.id, format: document.format, byteCount: bytes.length, sha256 });
    const components = [];
    for (const layer of layers.filter(value => value.documentId === document.id)) {
      if (!['cartoon', 'ball-and-stick'].includes(layer.representation) || (layer.color != null && !hex(layer.color))) fail('Unsupported representation or color.');
      const colors = layer.color ? [node('color', { color: layer.color })] : layer.representation === 'ball-and-stick'
        ? [node('color', { color: '#909090' }), ...Object.entries({ H: '#ffffff', C: '#909090', N: '#3050f8', O: '#ff0d0d', S: '#ffff30', P: '#ff8000' })
          .map(([type_symbol, color]) => node('color', { color, selector: { type_symbol } }))] : undefined;
      components.push({ ...node('component', { selector: selector(layer) }, [node('representation', { type: layer.representation === 'ball-and-stick' ? 'ball_and_stick' : layer.representation }, colors),
        ...(!hasCartoon || layer.representation === 'cartoon' ? [node('focus', focus)] : [])]), ref: `burette-layer-${layers.indexOf(layer)}` });
    }
    for (const label of labels.filter(value => value.documentId === document.id)) {
      if (typeof label.text !== 'string' || !label.text.trim() || label.text.length > 80) fail('Labels need 1–80 characters.');
      const selected = selector(label);
      components.push({ ...node('component', { selector: selected }, []), ref: `burette-label-${labels.indexOf(label)}` });
      const position = Array.isArray(selected) ? { expressions: selected } : typeof selected === 'string' ? { expressions: [{}] } : selected;
      components.push(node('primitives', { label_color: '#ffffff', label_attachment: 'bottom-left', label_show_tether: true },
        [node('primitive', { kind: 'label', position, text: label.text, label_size: 1, label_offset: 12 })]));
    }
    const transform = transforms.find(value => value.documentId === document.id);
    if (transform) {
      if (!Array.isArray(transform.rotation) || transform.rotation.length !== 9 || !Array.isArray(transform.translation) || transform.translation.length !== 3
        || ![...transform.rotation, ...transform.translation].every(Number.isFinite)) fail('Transforms need a finite 3×3 rotation and 3-vector translation.');
      components.unshift(node('transform', { rotation: transform.rotation, translation: transform.translation }));
    }
    children.push(node('download', { url: `data:text/plain;base64,${bytes.toString('base64')}` }, [node('parse', { format: document.format === 'pdb' ? 'pdb' : 'mmcif' },
      [node('structure', { type: 'model', model_index: 0 }, components)])]));
  }
  children.push(node('canvas', { background_color: scene.background ?? '#101722' }));
  return { scene: { kind: 'single', root: node('root', null, children), metadata: { version: '1.0', timestamp: new Date().toISOString() } }, sources };
}
