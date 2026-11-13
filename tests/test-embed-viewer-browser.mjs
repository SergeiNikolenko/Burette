// Run against a served embed artifact and docking fixtures. Renderer internals
// are inspected only here to verify that public commands preserve the scene.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const runtime = process.env.EMBED_BASE_URL;
const receptor = process.env.EMBED_RECEPTOR_URL;
const poses = process.env.EMBED_POSES_URL;
// A topology with a matching coordinate trajectory (XTC) and a multi-frame XYZ.
const topology = process.env.EMBED_TOPOLOGY_URL;
const trajectory = process.env.EMBED_TRAJECTORY_URL;
const xyz = process.env.EMBED_XYZ_URL;
assert.ok(runtime && receptor && poses && topology && trajectory && xyz,
  'Set EMBED_BASE_URL, EMBED_RECEPTOR_URL, EMBED_POSES_URL, EMBED_TOPOLOGY_URL, EMBED_TRAJECTORY_URL and EMBED_XYZ_URL');
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
try {
  const page = await browser.newPage({ viewport: { width: 960, height: 640 } });
  const harness = new URL('/embed-test-harness', runtime).href;
  await page.addInitScript(() => {
    if (window === parent) return;
    window.runtimeResolutions = [];
    window.BuretteResolveRuntimeAsset = async name => {
      if (name === 'native-viewer-menus.js') await new Promise(resolve => setTimeout(resolve, 100));
      window.runtimeResolutions.push(name);
      return new URL(name, location.href).href;
    };
  });
  await page.route(harness, route => route.fulfill({ contentType: 'text/html', body: '<main style="height:600px"></main>' }));
  await page.goto(harness);
  await page.evaluate(async ({ runtime, receptor, poses }) => {
    const { createBuretteViewer } = await import(new URL('burette-embed.js', runtime).href);
    window.createViewer = createBuretteViewer;
    window.source = { structure: { url: receptor }, poses: { url: poses } };
    window.events = [];
    window.frames = [];
    window.viewer = createBuretteViewer(document.querySelector('main'), { base: runtime, theme: 'light' });
    viewer.on('pose', event => events.push(event));
    viewer.on('frame', event => frames.push(event));
    viewer.on('smoothing', event => frames.push(event));
    await viewer.open(source);
  }, { runtime, receptor, poses });
  const frame = () => page.frames().find(candidate => candidate.parentFrame());
  const { resolutions, scripts } = await frame().evaluate(() => ({
    resolutions: window.runtimeResolutions,
    scripts: [...document.scripts].filter(script => script.src).map(script => new URL(script.src).pathname.split('/').at(-1)),
  }));
  assert.ok(resolutions.indexOf('viewer.js') < resolutions.indexOf('native-viewer-menus.js'), 'Resolver completes out of order');
  assert.ok(scripts.indexOf('native-viewer-menus.js') < scripts.indexOf('viewer.js'), 'Viewer dependencies load before the viewer');
  const scene = () => frame().evaluate(() => {
    const plugin = window.BuretteViewer.plugin;
    const camera = plugin.canvas3d.camera.getSnapshot();
    return { position: camera.position, target: camera.target, radius: camera.radius,
      structures: plugin.managers.structure.hierarchy.current.structures.map(s => s.cell.transform.ref) };
  });
  assert.equal((await page.evaluate(() => events)).length, 1, 'One initial pose event');
  await page.evaluate(() => { events.length = 0; });
  await page.evaluate(() => viewer.setPoseRecord(2));
  assert.deepEqual(await page.evaluate(() => events), [{ index: 2, sourceRecordId: 2, count: 4, mode: 'single', file: 0 }]);
  assert.deepEqual(await page.evaluate(() => frames), [], 'Docking pose paging does not report frames');
  await page.evaluate(() => Promise.all([viewer.setPose(1), viewer.setPose(3), viewer.setPose(0)]));
  assert.equal(await page.evaluate(() => events.at(-1).index), 0, 'Rapid selections finish in order');
  const beforeInvalid = await scene();
  await assert.rejects(page.evaluate(() => viewer.setPoseRecord(999)), /index|range/i);
  assert.deepEqual(await scene(), beforeInvalid, 'Invalid record preserves scene');

  await page.evaluate(async () => {
    const sdf = await (await fetch(source.poses.url)).text();
    events.length = 0;
    await viewer.open({ ...source, poses: { name: 'single.sdf', data: sdf.split('$$$$')[0] + '$$$$\n' } });
  });
  assert.deepEqual(await page.evaluate(() => events), [{ index: 0, sourceRecordId: 0, count: 1, mode: 'single', file: 0 }]);
  const singleton = await scene();
  await page.evaluate(() => viewer.setPoseRecord(0));
  assert.deepEqual(await scene(), singleton, 'Singleton selection preserves camera and structure refs');
  await page.evaluate(() => viewer.focusLigand());
  await frame().waitForFunction(previous => {
    return JSON.stringify(window.BuretteViewer.plugin.canvas3d.camera.getSnapshot().target) !== JSON.stringify(previous);
  }, singleton.target);

  await page.evaluate(async runtime => {
    const container = document.createElement('aside');
    container.style.height = '300px';
    document.body.append(container);
    window.otherEvents = [];
    window.other = createViewer(container, { base: runtime, theme: 'dark' });
    other.on('pose', event => otherEvents.push(event));
    await other.open(source);
    await other.setPoseRecord(1);
  }, runtime);
  assert.equal(await page.evaluate(() => events.at(-1).count), 1, 'Other viewer events stay isolated');
  assert.equal(await page.evaluate(() => otherEvents.at(-1).sourceRecordId), 1);
  await page.evaluate(() => other.destroy());

  await page.evaluate(async () => {
    localStorage.removeItem('burette.embed.poseMode');
    events.length = 0;
    await viewer.open({ structure: source.poses });
  });
  const sdfPose = (index, mode = 'single') => ({ index, sourceRecordId: index, count: 4, mode, file: 0 });
  assert.deepEqual(await page.evaluate(() => events), [sdfPose(0)], 'Standalone SDF reports its initial record');
  await page.evaluate(() => viewer.setPose(1));
  await frame().getByRole('button', { name: /Next (molecule|pose)/i }).click();
  await page.waitForFunction(() => events.at(-1)?.index === 2);
  await page.evaluate(() => viewer.setPoseMode('all'));
  assert.deepEqual(await page.evaluate(() => events), [sdfPose(0), sdfPose(1), sdfPose(2), sdfPose(2, 'all')]);

  // Several ligand files: poses are grouped by file and records stay per file.
  await page.evaluate(async () => {
    const sdf = await (await fetch(source.poses.url)).text();
    events.length = 0;
    await viewer.open({ ...source, poses: [{ name: 'first.sdf', data: sdf.split('$$$$')[0] + '$$$$\n' }, source.poses] });
    await viewer.setPoseRecord(1, 1);
  });
  assert.deepEqual(await page.evaluate(() => events.at(-1)), { index: 2, sourceRecordId: 1, count: 5, mode: 'single', file: 1 });
  await assert.rejects(page.evaluate(() => viewer.setPoseRecord(1, 0)), /index|range/i, 'Records are looked up in their own file');

  // Topology + XTC: frames are driven by the host, Smooth needs the desktop smoother.
  await page.evaluate(async ({ topology, trajectory }) => {
    frames.length = 0;
    await viewer.open({ structure: { url: topology }, trajectory: { url: trajectory } });
    await viewer.setFrame(5);
  }, { topology, trajectory });
  await page.waitForFunction(() => frames.at(-1)?.index === 5);
  await page.evaluate(() => viewer.play());
  await page.waitForFunction(() => frames.some(frame => frame.playing && frame.index > 5));
  await page.evaluate(() => viewer.pause());
  const paused = await page.evaluate(() => frames.at(-1).index);
  await page.waitForTimeout(500);
  assert.equal(await page.evaluate(() => frames.at(-1).index), paused, 'Pause stops the loop');
  assert.equal(await frame().locator('.buret-trajectory-smooth-button').count(), 0, 'Binary trajectories hide Smooth');
  await assert.rejects(page.evaluate(() => viewer.setSmoothing(true)), /PDB|XYZ/);
  await assert.rejects(page.evaluate(() => viewer.open({ structure: source.poses, trajectory: { name: 'a.xtc', data: new Uint8Array(4) } })), /topology/);

  // Multi-frame XYZ: Smooth runs in the frame from both the API and its own button.
  await page.evaluate(async xyz => {
    frames.length = 0;
    await viewer.open({ structure: { url: xyz } });
    await viewer.setSmoothing(true);
  }, xyz);
  assert.deepEqual(await page.evaluate(() => frames.filter(event => event.view)), [{ view: 'smoothed' }]);
  await frame().getByRole('button', { name: 'Choose animation' }).click();
  await frame().getByRole('button', { name: 'Turn Smooth motion off' }).click();
  await page.waitForFunction(() => frames.at(-1)?.view === 'original');
  await page.evaluate(() => viewer.setFrame(3));
  await page.waitForFunction(() => frames.at(-1)?.index === 3);

  // Simulate a stalled renderer and shorten only the host's command timer.
  await frame().evaluate(() => { window.BuretteViewerActions.run = () => new Promise(() => {}); });
  const timeout = await page.evaluate(async () => {
    const original = window.setTimeout;
    window.setTimeout = (callback, delay, ...args) => original(callback, delay === 30_000 ? 50 : delay, ...args);
    try {
      return await viewer.focusLigand().then(() => 'resolved', error => error.name);
    } finally { window.setTimeout = original; }
  });
  assert.equal(timeout, 'TimeoutError');
  assert.equal(await page.locator('iframe').count(), 0, 'Timed-out renderer is discarded');
  await page.evaluate(() => viewer.open(source));
  await page.evaluate(() => viewer.destroy());
  assert.equal(await page.locator('iframe').count(), 0);
  console.log('Embed API passed: docking and standalone SDF events, several ligand files, XTC frames and playback, XYZ smoothing, rapid selections, invalid records, singleton focus, instance isolation, timeout recovery.');
} finally {
  await browser.close();
}
