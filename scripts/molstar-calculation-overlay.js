import { PluginStateObject as SO, PluginStateTransform } from '@molstar/plugin/state/objects';
import { ShapeRepresentation3D } from '@molstar/plugin/state/transforms/shape/representation';
import { StateSelection } from '@molstar/core/state';
import { ParamDefinition as PD } from '@molstar/core/util/param-definition';
import { Vec3 } from '@molstar/core/math/linear-algebra';
import { Color } from '@molstar/core/util/color/color';
import { Shape } from '@molstar/model/model/shape';
import { Mesh } from '@molstar/graphics/geo/geometry/mesh/mesh';
import { MeshBuilder } from '@molstar/graphics/geo/geometry/mesh/mesh-builder';
import { addCylinder } from '@molstar/graphics/geo/geometry/mesh/builder/cylinder';
import { Text } from '@molstar/graphics/geo/geometry/text/text';
import { TextBuilder } from '@molstar/graphics/geo/geometry/text/text-builder';

// Calculated properties drawn over a scene: the dipole arrow and atomic charge labels.
// Each is one root-level shape, so the scene tree and its components stay untouched.
const TAG = 'burette-calculation-overlay';
const KINDS = ['dipole', 'charges'];
const ARROW = Color(0xE69F00);
const LABEL_TEXT = Color(0x1F1F1F);

const finite = value => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) < 1e6;
const point = value => Array.isArray(value) && value.length === 3 && value.every(finite);

function dipoleShape({ origin, vector, label }) {
  const start = Vec3.create(...origin), direction = Vec3.create(...vector);
  const length = Vec3.magnitude(direction);
  const head = Math.min(0.5, length * 0.35);
  const neck = Vec3.scaleAndAdd(Vec3(), start, direction, (length - head) / length);
  const tip = Vec3.add(Vec3(), start, direction);
  const state = MeshBuilder.createState(512, 256);
  state.currentGroup = 0;
  addCylinder(state, start, neck, 1, { radiusTop: 0.07, radiusBottom: 0.07, topCap: false, bottomCap: true, radialSegments: 24 });
  addCylinder(state, neck, tip, 1, { radiusTop: 0, radiusBottom: 0.2, topCap: false, bottomCap: true, radialSegments: 24 });
  return Shape.create('Dipole', {}, MeshBuilder.getMesh(state), () => ARROW, () => 1, () => label, 1);
}

function chargeShape({ positions, labels }, props, previous) {
  const builder = TextBuilder.create(props, positions.length * 8, 512, previous?.geometry);
  positions.forEach((position, group) => builder.add(labels[group], position[0], position[1], position[2], 0.35, 1, group));
  return Shape.create('Charges', {}, builder.getText(), () => LABEL_TEXT, () => 1, group => labels[group], positions.length);
}

const OverlayShape = PluginStateTransform.BuiltIn({
  name: 'burette-calculation-overlay', display: { name: 'Calculation overlay' },
  from: SO.Root, to: SO.Shape.Provider,
  params: { kind: PD.Text('dipole'), overlay: PD.Value({}, { isHidden: true }) },
})({
  apply({ params: { kind, overlay } }) {
    const provider = kind === 'dipole'
      ? { label: 'Dipole', data: overlay, params: Mesh.Params, geometryUtils: Mesh.Utils, getShape: (_, data) => dipoleShape(data) }
      : { label: 'Charges', data: overlay, params: Text.Params, geometryUtils: Text.Utils, getShape: (_, data, props, shape) => chargeShape(data, props, shape) };
    return new SO.Shape.Provider(provider, { label: provider.label });
  },
});

const REPRESENTATION = {
  dipole: { alpha: 1 },
  charges: { sizeFactor: 0.45, background: true, backgroundColor: Color(0xFFFFFF), backgroundOpacity: 0.8, backgroundMargin: 0.15, offsetZ: 0.6, attachment: 'middle-center' },
};

function checked(kind, overlay) {
  if (!KINDS.includes(kind)) throw new Error('Unknown calculation overlay.');
  if (kind === 'dipole') {
    if (!point(overlay?.origin) || !point(overlay?.vector) || !(Math.hypot(...overlay.vector) > 1e-6) || typeof overlay.label !== 'string') throw new Error('The dipole needs an origin, a nonzero vector and a label.');
    return { origin: [...overlay.origin], vector: [...overlay.vector], label: overlay.label.slice(0, 80) };
  }
  const positions = overlay?.positions, labels = overlay?.labels;
  if (!Array.isArray(positions) || !Array.isArray(labels) || !positions.length || positions.length > 10_000 || labels.length !== positions.length
    || !positions.every(point) || !labels.every(label => typeof label === 'string' && label.length <= 12)) throw new Error('Charge labels need one short label per atom position.');
  return { positions: positions.map(position => [...position]), labels: [...labels] };
}

async function remove(plugin, kind) {
  const state = plugin.state.data;
  const cells = state.select(StateSelection.Generators.root.subtree().withTag(`${TAG}-${kind}`));
  if (!cells.length) return;
  const builder = state.build();
  for (const cell of cells) builder.delete(cell.transform.ref);
  await builder.commit();
}

export const BuretteCalculationOverlay = {
  /** Draws `overlay` as the scene's only `kind` overlay, replacing an earlier one. */
  async show(plugin, kind, overlay) {
    if (!plugin?.state?.data) throw new Error('The 3D viewer is not ready.');
    const data = checked(kind, overlay);
    await remove(plugin, kind);
    await plugin.state.data.build().toRoot()
      .apply(OverlayShape, { kind, overlay: data }, { tags: [TAG, `${TAG}-${kind}`] })
      .apply(ShapeRepresentation3D, REPRESENTATION[kind], { tags: [TAG] })
      .commit({ revertOnError: true });
    return { kind, shown: true };
  },
  async hide(plugin, kind) {
    if (!KINDS.includes(kind)) throw new Error('Unknown calculation overlay.');
    if (plugin?.state?.data) await remove(plugin, kind);
    return { kind, shown: false };
  },
};
