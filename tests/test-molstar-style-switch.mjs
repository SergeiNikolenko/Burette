import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../PreviewExtension/Web/viewer.js', import.meta.url), 'utf8');
const extract = name => source.match(new RegExp(`\n  (?:async )?function ${name}\\([\\s\\S]*?\n  \\}`, 'u'))[0];
const appearance = new Function('configuredMolstarAppearance', `${extract('molstarPresetAppearance')}; return molstarPresetAppearance;`)(config => config.molstarAppearance);
for (const mode of ['default', 'illustrative']) {
  assert.equal(appearance({ defaultAppearance: mode === 'default' ? 'illustrative' : 'default' }, { molstarAppearance: mode }), mode);
}

// Exercise the toolbar apply path: no source reload, and restore the same camera.
for (const preset of ['automatic', 'line', 'ball-and-stick', 'spacefill', 'illustrative-surface']) {
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
