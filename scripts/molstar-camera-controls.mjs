import { molstarPatchPlugin } from './molstar-source.mjs';

// These four values update camera uniforms, not representation geometry. Keep
// expensive rendering/mesh parameters on Mol*'s normal commit-only controls.
export function patchMolstarCameraParams(source) {
  const replacements = [
    ['intensity: PD.Numeric(15, { min: 1, max: 100, step: 1 })', 'intensity: PD.Numeric(15, { min: 1, max: 100, step: 1 }, { immediateUpdate: true })'],
    ['{ label: "Field of View" }', '{ label: "Field of View", immediateUpdate: true }'],
    ['{ label: "Clipping", description: "How much of the scene to show." }', '{ label: "Clipping", description: "How much of the scene to show.", immediateUpdate: true }'],
    ['minNear: PD.Numeric(1, { min: 0.1, max: 100, step: 0.1 }, {', 'minNear: PD.Numeric(1, { min: 0.1, max: 100, step: 0.1 }, { immediateUpdate: true,'],
  ];
  for (const [before, after] of replacements) {
    if (source.split(before).length !== 2) throw new Error('Mol* camera parameters changed; review live controls before vendoring.');
    source = source.replace(before, after);
  }
  return source;
}

export function patchMolstarCameraSettings(source) {
  const update = '  update(s, props) {\n';
  const apply = '  async apply(props, ctx) {\n';
  if (source.split(update).length !== 2 || source.split(apply).length !== 2) {
    throw new Error('Mol* viewport settings changed; review live camera updates before vendoring.');
  }
  // SimpleSettings normally re-applies every canvas setting, panel layout and
  // graphics-context option. A camera drag must not repeat those unrelated jobs.
  return source.replace(update, `  update(s, props, ctx) {
    const old = SimpleSettingsMapping.getValues(props, ctx);
    const cameraValues = {
      ...old,
      camera: { ...old.camera, fov: s.camera.fov },
      lighting: { ...old.lighting, fog: old.lighting.fog.name === 'on'
        ? { ...old.lighting.fog, params: { ...old.lighting.fog.params, intensity: s.lighting.fog.params.intensity } }
        : old.lighting.fog },
      clipping: { ...old.clipping, radius: s.clipping.radius, minNear: s.clipping.minNear }
    };
    if (PD.areEqual(SimpleSettingsParams, s, cameraValues)) {
      const settings = {};
      if (s.camera.fov !== old.camera.fov) settings.camera = { fov: s.camera.fov };
      if (s.lighting.fog.name === 'on' && s.lighting.fog.params.intensity !== old.lighting.fog.params.intensity) {
        settings.cameraFog = s.lighting.fog;
      }
      const clipping = {};
      if (s.clipping.radius !== old.clipping.radius) clipping.radius = s.clipping.radius;
      if (s.clipping.minNear !== old.clipping.minNear) clipping.minNear = s.clipping.minNear;
      if (Object.keys(clipping).length) settings.cameraClipping = clipping;
      props.liveCameraSettings = settings;
      return;
    }
`).replace(apply, `${apply}    if (props.liveCameraSettings) {
      if (Object.keys(props.liveCameraSettings).length) {
        await PluginCommands.Canvas3D.SetSettings(ctx, { settings: props.liveCameraSettings });
      }
      return;
    }
`);
}

export const molstarCameraSettingsPlugin = molstarPatchPlugin(
  'molstar-live-camera-settings',
  '@molstar/plugin-ui/viewport/simple-settings',
  patchMolstarCameraSettings,
);
