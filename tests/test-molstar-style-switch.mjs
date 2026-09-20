import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../PreviewExtension/Web/viewer.js', import.meta.url), 'utf8');
const extract = name => source.match(new RegExp(`\n  (?:async )?function ${name}\\([\\s\\S]*?\n  \\}`, 'u'))[0];
const appearance = new Function('configuredMolstarAppearance', `${extract('molstarPresetAppearance')}; return molstarPresetAppearance;`)(config => config.molstarAppearance);
for (const mode of ['default', 'illustrative']) {
  assert.equal(appearance({ defaultAppearance: mode === 'default' ? 'illustrative' : 'default' }, { molstarAppearance: mode }), mode);
}

// Exercise the toolbar apply path: no source reload, and restore the same camera.
for (const preset of ['line', 'ball-and-stick', 'spacefill', 'illustrative-surface']) {
  const calls = [];
  const camera = { position: [1, 2, 3], target: [0, 0, 0] };
  const viewer = { plugin: { state: { data: { getSnapshot: () => ({}) } } } };
  const bindings = {
    normalizeMolstarPreset: value => value,
    molstarPresetOption: value => ({ value, label: value, legacyStyle: value }),
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
    applyMolstarWaterLineRepresentation: async () => {},
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
  assert.deepEqual(calls, [...(preset === 'illustrative-surface' ? ['base'] : []), preset, 'illustrative']);
}
console.log('molstar style switch tests passed');
