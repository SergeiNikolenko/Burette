import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { access, link, mkdir, rmdir, unlink, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMolecularScene } from './molecular-scene.mjs';

const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const exists = path => access(path).then(() => true, () => false);
const require = createRequire(import.meta.url);
function playwright() {
  try { return require('playwright-core'); }
  catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND') throw error;
    const here = dirname(fileURLToPath(import.meta.url));
    for (const candidate of ['../vendor/playwright-core', '../plugins/burette-agent/vendor/playwright-core']) {
      try { return require(resolve(here, candidate)); }
      catch (missing) { if (missing.code !== 'MODULE_NOT_FOUND') throw missing; }
    }
    fail('RENDERER_UNAVAILABLE', 'The packaged Playwright runtime is missing.');
  }
}

async function chromiumExecutable(explicit) {
  const candidates = [explicit ?? process.env.BURETTE_CHROMIUM_EXECUTABLE,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'];
  for (const path of candidates) if (path && isAbsolute(path) && await exists(path)) return path;
  // playwright-core knows the version-matched cache location without installing anything.
  const { chromium } = playwright();
  const bundled = chromium.executablePath();
  if (await exists(bundled)) return bundled;
  fail('RENDERER_UNAVAILABLE', 'No installed Chromium was found. Configure BURETTE_CHROMIUM_EXECUTABLE; rendering never downloads a browser.');
}

async function runtimeAssets(explicit) {
  const local = dirname(fileURLToPath(import.meta.url));
  const roots = explicit ? [resolve(explicit)] : [resolve(local, '../plugins/burette-agent/preview-web'), resolve(local, '../preview-web'), resolve(local, '../PreviewExtension/Web')];
  for (const root of roots) if (await exists(join(root, 'molstar.js')) && await exists(join(root, 'molstar.css'))) return root;
  fail('RENDERER_UNAVAILABLE', 'The packaged Mol* browser runtime is missing.');
}

async function renderPng(scene, width, height, { executablePath, assetRoot, signal, onBrowserStarted } = {}) {
  const [{ chromium }, executable, assets] = await Promise.all([playwright(), chromiumExecutable(executablePath), runtimeAssets(assetRoot)]);
  signal?.throwIfAborted();
  const browserServer = await chromium.launchServer({ executablePath: executable, headless: true, host: '127.0.0.1', timeout: 20000,
    args: ['--use-gl=angle', `--use-angle=${process.platform === 'darwin' ? 'metal' : 'swiftshader'}`, '--enable-unsafe-swiftshader', '--disable-background-networking', '--disable-component-update', '--no-first-run', '--num-raster-threads=1', '--renderer-process-limit=1', '--js-flags=--max-old-space-size=256'] });
  let browser;
  const abort = () => { void browserServer.close(); };
  signal?.addEventListener('abort', abort, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; void browserServer.close(); }, 45000);
  timer.unref();
  try {
    signal?.throwIfAborted();
    await onBrowserStarted?.(browserServer.process().pid);
    browser = await chromium.connect(browserServer.wsEndpoint(), { timeout: 10000 });
    const scale = Math.min(1, 512 / Math.max(width, height));
    const context = await browser.newContext({ viewport: { width: Math.round(width * scale), height: Math.round(height * scale) }, deviceScaleFactor: 1, serviceWorkers: 'block' });
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin === 'https://burette-render.invalid' && ['/molstar.js', '/molstar.css'].includes(url.pathname)) {
        await route.fulfill({ path: join(assets, url.pathname.slice(1)), contentType: url.pathname.endsWith('.js') ? 'text/javascript' : 'text/css' });
      } else await route.abort('blockedbyclient');
    });
    await page.setContent('<!doctype html><html><head><link rel="stylesheet" href="https://burette-render.invalid/molstar.css"><style>html,body,#viewer{margin:0;width:100%;height:100%;overflow:hidden}.msp-viewport-controls,.msp-state-snapshots,.msp-toast-container,.msp-highlight-toast-wrapper{display:none!important}</style></head><body><div id="viewer"></div></body></html>');
    await page.addScriptTag({ url: 'https://burette-render.invalid/molstar.js' });
    const result = await page.evaluate(async ({ scene, width, height }) => {
      const viewer = await globalThis.molstar.Viewer.create('viewer', { layoutIsExpanded: false, layoutShowControls: false,
        layoutShowSequence: false, layoutShowLog: false, layoutShowLeftPanel: false, viewportShowExpand: false,
        viewportShowControls: false, viewportShowSelectionMode: false, viewportShowAnimation: false, viewportShowSettings: false });
      try {
        const off = { name: 'off', params: {} };
        viewer.plugin.canvas3d.setProps({ multiSample: { mode: 'off' }, postprocessing: {
          ...viewer.plugin.canvas3d.props.postprocessing, occlusion: off, shadow: off, outline: off, bloom: off,
          antialiasing: { name: 'fxaa', params: { edgeThresholdMin: 0.0312, edgeThresholdMax: 0.063, iterations: 12, subpixelQuality: 0.3 } },
        } });
        await viewer.loadMvsData(JSON.stringify(scene), 'mvsj');
        const structures = viewer.plugin.managers.structure.hierarchy.current.structures;
        const atomCount = structures.reduce((sum, entry) => sum + (entry.cell.obj?.data?.elementCount ?? 0), 0);
        if (!atomCount) throw new Error('Mol* created an empty molecular scene.');
        const targets = [];
        const inspect = node => {
          if (node.kind === 'component' && node.ref) {
            const cells = viewer.plugin.state.data.selectQ(q => q.root.subtree().withTag(`mvs-ref:${node.ref}`));
            const count = cells.reduce((sum, cell) => sum + (cell.obj?.data?.elementCount ?? 0), 0);
            if (!count) throw new Error(`Scene selection ${node.ref} matched no atoms.`);
            targets.push({ ref: node.ref, atomCount: count });
          }
          for (const child of node.children ?? []) inspect(child);
        };
        inspect(scene.root);
        const helper = viewer.plugin.helpers.viewportScreenshot;
        if (!helper) throw new Error('Mol* screenshot helper is unavailable.');
        helper.behaviors.values.next({ ...helper.values, resolution: { name: 'custom', params: { width, height } }, transparent: false,
          axes: { name: 'off', params: {} }, format: { name: 'png', params: {} } });
        helper.cropParams.auto = false;
        helper.imagePass.setProps({ multiSample: { ...helper.imagePass.props.multiSample, mode: 'off' } });
        // MVS state can be ready before the WebGL scene and camera commit.
        viewer.plugin.canvas3d.commit(true);
        const camera = viewer.plugin.canvas3d.camera;
        camera.transition.finish(camera.transition.target);
        camera.update();
        const dataUri = await helper.getImageDataUri();
        const pixels = helper.canvas.getContext('2d').getImageData(0, 0, width, height).data;
        let foregroundPixels = 0, labelBrightPixels = 0;
        for (let i = 4; i < pixels.length; i += 4) {
          if (pixels[i] > 220 && pixels[i + 1] > 220 && pixels[i + 2] > 220) labelBrightPixels++;
          if (Math.abs(pixels[i] - pixels[0]) + Math.abs(pixels[i + 1] - pixels[1]) + Math.abs(pixels[i + 2] - pixels[2]) > 24) foregroundPixels++;
        }
        const expectedLabels = targets.filter(target => target.ref.startsWith('burette-label-')).length;
        if (expectedLabels && labelBrightPixels < expectedLabels * 10) throw new Error('Requested white labels are not visible in the rendered image.');
        if (foregroundPixels < 100) throw new Error('Mol* rendered a blank image.');
        return { dataUri, atomCount, structureCount: structures.length, targets, foregroundPixels, expectedLabels, labelBrightPixels };
      } finally { viewer.plugin.dispose(); }
    }, { scene, width, height });
    if (!result.dataUri.startsWith('data:image/png;base64,')) fail('RENDER_FAILED', 'Mol* returned an unsupported image.');
    const png = Buffer.from(result.dataUri.slice('data:image/png;base64,'.length), 'base64');
    if (png.length > 32 * 1024 * 1024 || !png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      || png.readUInt32BE(16) !== width || png.readUInt32BE(20) !== height) fail('RENDER_FAILED', 'Rendered PNG has invalid dimensions or size.');
    signal?.throwIfAborted();
    return { png, atomCount: result.atomCount, structureCount: result.structureCount, targets: result.targets, foregroundPixels: result.foregroundPixels, expectedLabels: result.expectedLabels, labelBrightPixels: result.labelBrightPixels, browserVersion: browser.version() };
  } catch (error) {
    if (timedOut) fail('RENDER_TIMEOUT', 'Molecular rendering exceeded 45 seconds.');
    signal?.throwIfAborted();
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
    await browser?.close();
    await browserServer.close();
  }
}

async function reserveVersion(outputPath) {
  if (typeof outputPath !== 'string' || !isAbsolute(outputPath) || !outputPath.endsWith('.png')) fail('INVALID_OUTPUT', 'Output must be an absolute PNG path.');
  const parent = dirname(outputPath);
  await mkdir(parent, { recursive: true });
  for (let version = 1; version <= 1000; version++) {
    const png = version === 1 ? outputPath : outputPath.slice(0, -4) + `-${version}.png`;
    const paths = { png, sidecar: `${png}.render.json`, scene: `${png}.mvsj` };
    const lock = `${png}.publishing`;
    try { await mkdir(lock, { mode: 0o700 }); }
    catch (error) { if (error.code === 'EEXIST') continue; throw error; }
    if ((await Promise.all(Object.values(paths).map(exists))).some(Boolean)) { await rmdir(lock); continue; }
    return { paths, lock, version };
  }
  fail('OUTPUT_LIMIT', 'No free image version remains after 1000 versions.');
}

/** The sidecar is the publication commit marker; existing artifacts are never replaced. */
export async function runMolecularRender({ documents, action, signal, executablePath, assetRoot, onBrowserStarted }) {
  const width = action.width ?? 1600, height = action.height ?? 1200;
  if (![width, height].every(value => Number.isSafeInteger(value) && value >= 64 && value <= 4096) || width * height > 16 * 1024 * 1024) fail('INPUT_LIMIT', 'Image dimensions must be 64–4096 and at most 16 megapixels.');
  const recipe = await createMolecularScene(documents, action.scene);
  const rendered = await renderPng(recipe.scene, width, height, { executablePath, assetRoot, signal, onBrowserStarted });
  const reservation = await reserveVersion(action.outputPath);
  const published = [], temporary = [];
  try {
    const sceneBytes = Buffer.from(JSON.stringify(recipe.scene));
    const sourceBytes = recipe.sources.reduce((sum, source) => sum + source.byteCount, 0);
    const supported = documents.length < 8 && sourceBytes + sceneBytes.length <= 16 * 1024 * 1024;
    const nativeAttachment = { supported, sourceBytes, sceneBytes: sceneBytes.length, standaloneSupported: sceneBytes.length <= 16 * 1024 * 1024,
      ...(!supported ? { reason: 'Attaching the scene would exceed the native workspace 8-document or 16 MiB limit.' } : {}) };
    const sidecar = { nativeAttachment, schema: 'burette.molecular-render/v1', createdAt: new Date().toISOString(), width, height,
      sources: recipe.sources, scene: { path: reservation.paths.scene, sha256: digest(sceneBytes), recipe: action.scene ?? {} },
      image: { path: reservation.paths.png, sha256: digest(rendered.png), byteCount: rendered.png.length },
      method: { renderer: 'Mol*', antialiasing: 'FXAA', geometrySamples: 1, ambientOcclusion: false, browserVersion: rendered.browserVersion, projection: 'MolViewSpec', atomCount: rendered.atomCount,
        structureCount: rendered.structureCount, targets: rendered.targets, foregroundPixels: rendered.foregroundPixels, expectedLabels: rendered.expectedLabels, labelBrightPixels: rendered.labelBrightPixels }, collisionPolicy: 'versioned', version: reservation.version };
    for (const [key, bytes] of [['png', rendered.png], ['scene', sceneBytes], ['sidecar', Buffer.from(JSON.stringify(sidecar))]]) {
      signal?.throwIfAborted();
      const destination = reservation.paths[key], path = `${destination}.${randomUUID()}.tmp`;
      temporary.push(path);
      await writeFile(path, bytes, { mode: 0o600, flag: 'wx' });
      await link(path, destination);
      published.push(destination);
    }
    return { ...sidecar, scenePath: reservation.paths.scene, artifacts: reservation.paths };
  } catch (error) {
    await Promise.all(published.map(path => unlink(path)));
    throw error;
  } finally {
    await Promise.all(temporary.map(path => unlink(path).catch(error => { if (error.code !== 'ENOENT') throw error; })));
    await rmdir(reservation.lock);
  }
}
