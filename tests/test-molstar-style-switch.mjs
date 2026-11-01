import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../PreviewExtension/Web/viewer.js', import.meta.url), 'utf8');
const extract = name => source.match(new RegExp(`\n  (?:async )?function ${name}\\([\\s\\S]*?\n  \\}`, 'u'))[0];
const appearance = new Function('configuredMolstarAppearance', `${extract('molstarPresetAppearance')}; return molstarPresetAppearance;`)(config => config.molstarAppearance);
for (const mode of ['default', 'illustrative']) {
  assert.equal(appearance({ defaultAppearance: mode === 'default' ? 'illustrative' : 'default' }, { molstarAppearance: mode }), mode);
}

// Exercise the toolbar apply path: no source reload, and restore the same camera.
for (const preset of ['automatic', 'line', 'ball-and-stick', 'spacefill', 'illustrative-surface', 'blob-surface']) {
  const calls = [];
  const camera = { position: [1, 2, 3], target: [0, 0, 0] };
  const viewer = { plugin: { state: { data: { getSnapshot: () => ({}) } } } };
  const bindings = {
    normalizeMolstarPreset: value => value,
    molstarPresetOption: value => value === 'automatic'
      ? { value, label: value, provider: 'auto' }
      : { value, label: value, legacyStyle: value },
    molstarPresetAppearance: () => 'illustrative',
    activeViewer: viewer, activeConfig: {}, window: {},
    configuredMolstarPreset: () => 'automatic', configuredMolstarStyle: () => 'illustrative',
    configuredMolstarAppearance: () => 'illustrative',
    captureMolstarCameraSnapshot: () => camera, captureMolstarTransitionFrame: () => null,
    molstarStoryState: () => ({ available: false, isPlaying: false }),
    molstarStyleApplySerial: 0, setStatus: () => {},
    applyMolstarProviderPreset: async () => calls.push('base'),
    reloadMolstarStyle: async () => { throw Error('must not reload'); },
    applyMolstarStyle: async (_, value) => calls.push(value),
    applyMolstarWaterLineRepresentation: async () => calls.push('blue water'),
    applyMolstarAppearance: async (_, value) => calls.push(value),
    restoreMolstarCameraSnapshotNow: (_, value) => assert.equal(value, camera),
    waitForMolstarPresetPreviewDraw: async () => {},
    updateMolstarPresentationConfig: (value, mode) => assert.deepEqual([value, mode], [preset, 'illustrative']),
    setTimeout: () => {}, hideStatus: () => {}, isQuickLookHost: () => false,
    fadeMolstarTransitionFrame: () => {}, removeMolstarTransitionFrame: () => {},
    debug: message => { throw Error(message); },
  };
  const apply = new Function(...Object.keys(bindings), `${extract('applyMolstarPresetNow')}; return applyMolstarPresetNow;`)(...Object.values(bindings));
  await apply(preset, { preserveCamera: true });
  assert.deepEqual(calls, preset === 'automatic'
    ? ['base', 'blue water', 'illustrative']
    : [...(preset === 'illustrative-surface' ? ['base'] : []), preset, 'blue water', 'illustrative']);
}

// Translucent water lines must not pull the illustrative outline onto every
// solvent molecule; a faded chain still needs it.
const hasTranslucentNonWater = new Function('isMolstarWaterComponent', `${extract('molstarHasTranslucentNonWater')}; return molstarHasTranslucentNonWater;`)(component => component.key === 'water');
const representation = alpha => ({ cell: { transform: { params: { type: { name: 'cartoon', params: { alpha } } } } } });
const scene = components => ({ managers: { structure: { hierarchy: { current: { structures: [{ components }] } } } } });
assert.equal(hasTranslucentNonWater(scene([
  { key: 'polymer', representations: [representation(1)] },
  { key: 'water', representations: [representation(0.32)] }
])), false);
assert.equal(hasTranslucentNonWater(scene([
  { key: 'polymer', representations: [representation(0.4)] },
  { key: 'water', representations: [representation(0.32)] }
])), true);
console.log('molstar style switch tests passed');

// Envelope is a normal representation: it survives Story step serialization,
// and switching back restores the authored representation without stale params.
const uniformStyles = new Function(`${source.match(/  const MOLSTAR_UNIFORM_STYLE_REPRESENTATION = \{[\s\S]*?\n  \};/u)[0]}; return MOLSTAR_UNIFORM_STYLE_REPRESENTATION;`)();
const authored = { name: 'ball-and-stick', params: { sizeFactor: 0.2, multipleBonds: 'symmetric' } };
const colorTheme = { name: 'element-symbol', params: { carbonColor: 'element-symbol' } };
const transform = { ref: 'ligand', transformer: 'ms-plugin.structure-representation-3d', version: 'original', params: { type: authored, colorTheme } };
const camera = { current: { target: [1, 2, 3] } };
const manager = { state: { entries: [{ snapshot: { camera, data: { tree: { transforms: [transform] } } } }] } };
const styleSnapshots = new Function('MOLSTAR_UNIFORM_STYLE_REPRESENTATION', `
  const MOLSTAR_STYLE_REPRESENTATION_OVERRIDES = {};
  const molstarStoryAuthoredRepresentations = new WeakMap();
  const normalizeMolstarAppearance = value => value;
  const molstarStoryTransformVersion = (transform, style, appearance) => [transform.ref, style, appearance].join(':');
  ${extract('applyMolstarStoryStyleToSnapshots')}; return applyMolstarStoryStyleToSnapshots;
`)(uniformStyles);
styleSnapshots(manager, 'blob-surface', 'illustrative');
const saved = JSON.parse(JSON.stringify(manager.state.entries[0].snapshot));
assert.deepEqual(saved.data.tree.transforms[0].params, {
  type: { name: 'blob-surface', params: { ignoreLight: true } },
  colorTheme: { name: 'chain-id', params: {} },
});
assert.deepEqual(saved.camera, camera);
styleSnapshots(manager, 'default', 'default');
assert.deepEqual(transform.params, { type: { name: authored.name, params: { ...authored.params, ignoreLight: false } }, colorTheme });

const collectionRepresentation = new Function('normalizeMolstarStyle', 'sdfCollectionAlphaHelpers', `${extract('sdfCollectionRepresentationForStyle')}; return sdfCollectionRepresentationForStyle;`)(
  value => value,
  new Function('normalizeSdfCollectionContextColor', `${extract('sdfCollectionAlphaHelpers')}; return sdfCollectionAlphaHelpers;`)(value => value),
);
assert.deepEqual(collectionRepresentation('blob-surface', 0.4, 'colored'), {
  type: 'blob-surface', typeParams: { alpha: 0.4, transparentBackfaces: 'on' }, color: 'element-symbol',
});
console.log('Envelope persists in Story snapshots, restores authored styles and retains background opacity');
