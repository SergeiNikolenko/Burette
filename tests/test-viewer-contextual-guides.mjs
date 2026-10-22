import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// The viewer frame asks the app shell for one-time contextual guides by posting
// the guide id and the anchor control's rect in the frame's own viewport.
const source = await readFile(new URL('../PreviewExtension/Web/viewer.js', import.meta.url), 'utf8');
const extract = name => source.match(new RegExp(`\n  (?:async )?function ${name}\\([\\s\\S]*?\n  \\}`, 'u'))[0];

function frameRuntime({ topLevel = false, webkitBridge = false, bodyClasses = [] } = {}) {
  const posted = [];
  const parent = { postMessage: (message, origin) => posted.push({ message, origin }) };
  const window = { webkit: webkitBridge ? { messageHandlers: { burette: {} } } : undefined };
  window.parent = topLevel ? window : parent;
  const classes = new Set(bodyClasses);
  const document = { body: { classList: { contains: name => classes.has(name) } } };
  const isQuickLookHost = () => classes.has('burette-quicklook-host');
  const request = new Function('window', 'document', 'isQuickLookHost', `${extract('requestContextualGuide')}; return requestContextualGuide;`)(window, document, isQuickLookHost);
  return { request, posted };
}

const anchor = (left, top, width, height) => ({ getBoundingClientRect: () => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top }) });

{
  const { request, posted } = frameRuntime();
  assert.equal(request('pose-compare', anchor(120, 18, 164, 28)), true);
  assert.deepEqual(posted, [{
    message: { type: 'burette:contextual-guide', id: 'pose-compare', rect: { left: 120, top: 18, width: 164, height: 28 } },
    origin: '*'
  }]);
}

for (const [label, options] of [
  ['a top-level page has no shell to ask', { topLevel: true }],
  ['Quick Look and the iPhone app talk through the WebKit bridge', { webkitBridge: true }],
  ['Quick Look never shows guides', { bodyClasses: ['burette-quicklook-host'] }],
  ['the iPhone host never shows guides', { bodyClasses: ['burette-mobile-host'] }]
]) {
  const { request, posted } = frameRuntime(options);
  assert.equal(request('trajectory', anchor(10, 10, 60, 24)), false, label);
  assert.deepEqual(posted, [], label);
}

{
  // A hidden or collapsed control cannot anchor a popover, so the guide stays unclaimed.
  const { request, posted } = frameRuntime();
  assert.equal(request('scene-compose', null), false);
  assert.equal(request('scene-compose', anchor(0, 0, 0, 0)), false);
  assert.deepEqual(posted, []);
}

// scene-compose: "In one scene" appends a batch one file at a time, so the request
// waits for the appends to settle and anchors to the scene tree toggle.
{
  const start = source.indexOf("    if (type === 'append_scene_files') {");
  assert.ok(start > 0, 'append_scene_files handler exists');
  const handler = source.slice(start, source.indexOf('\n    }\n', start) + 6);
  const requests = [];
  const timers = new Map();
  let nextTimer = 1;
  const toggle = { id: 'buret-scene-tree-toggle' };
  const deps = paths => ({
    window: { BuretteSceneFiles: { append: async () => ({ ok: true, command: 'append_scene_files', result: { added: 1, paths } }) } },
    document: { getElementById: id => (id === toggle.id ? toggle : null) },
    loadScript: async () => {}, runtimeURL: () => '', activeMolstarViewer: () => ({}),
    loadMolstarEntry: null, captureMolstarCameraSnapshot: null, restoreMolstarCameraSnapshotNow: null,
    requestContextualGuide: (id, element) => requests.push({ id, element }),
    setTimeout: (callback, delay) => { const id = nextTimer++; timers.set(id, { callback, delay }); return id; },
    clearTimeout: id => timers.delete(id)
  });
  // The handler reads and writes the module-level timer; thread it across calls.
  const runHandler = new Function('action', 'deps', 'state', `
    const { window, document, loadScript, runtimeURL, activeMolstarViewer, loadMolstarEntry, captureMolstarCameraSnapshot,
      restoreMolstarCameraSnapshotNow, requestContextualGuide, setTimeout, clearTimeout } = deps;
    const type = action.type;
    let sceneComposeGuideTimer = state.timer;
    return (async () => { ${handler} })().then(result => { state.timer = sceneComposeGuideTimer; return result; });
  `);
  const state = { timer: 0 };
  const append = paths => runHandler({ type: 'append_scene_files' }, deps(paths), state);

  const single = await append(['/a.pdb']);
  assert.deepEqual(single.result.paths, ['/a.pdb'], 'the handler still returns the append result');
  assert.equal(timers.size, 0, 'a one-file scene is not a combined scene');

  await append(['/a.pdb', '/b.sdf']);
  await append(['/a.pdb', '/b.sdf', '/c.sdf']);
  assert.equal(timers.size, 1, 'each append restarts the settle timer');
  const [{ callback, delay }] = timers.values();
  assert.ok(delay >= 1000, 'the guide waits for the batch to settle');
  callback();
  assert.deepEqual(requests, [{ id: 'scene-compose', element: toggle }]);
}

// trajectory: requested only after Align has superimposed the XYZ frames, anchored to Align.
assert.match(
  source,
  /if \(result\) \{\n\s+align\.title = `Superimposed onto the first structure by atom order[^\n]*\n[^\n]*\n\s+requestContextualGuide\('trajectory', align\);\n\s+\} else \{/u,
  'turning Align on (not off) in the XYZ trajectory controls requests the trajectory guide'
);

// pose-compare: a committed pose switch in a docking poses view, anchored to the pose switcher.
{
  const expression = source.match(/\n    const poseCompareGuide = ([^;\n]+);/u)?.[1];
  assert.ok(expression, 'pose-compare eligibility is decided once per toolbar');
  const eligible = new Function('prepared', `const hasPoseGroups = false; return ${expression};`);
  assert.deepEqual([
    { kind: 'docking', dockingSceneMode: 'structurePoses' },
    { kind: 'docking', sdfPoseOverlayAvailable: true },
    { kind: 'docking', dockingSceneMode: 'structureAll' },
    { kind: 'docking', nativeTrajectoryControls: true },
    { kind: 'sdf-collection' },
    { kind: 'xyz-frame-overlay' }
  ].map(prepared => eligible(prepared)), [true, true, false, false, false, false]);
  const performSetPose = source.slice(source.indexOf('    const performSetPose = async'), source.indexOf('\n    if (fileList) {\n      label.addEventListener'));
  assert.match(
    performSetPose,
    /notifyDockingPoseChanged\(activePose, prepared\);\n[^\n]*\n\s+if \(options\.userStep === true && poseCompareGuide && !isFileListOpen\(\)\) requestContextualGuide\('pose-compare', label\);/u,
    'only user steps that land outside the hover-preview list request the guide'
  );
}

console.log('Viewer contextual guides post anchored requests for Align, pose switching and combined scenes');
