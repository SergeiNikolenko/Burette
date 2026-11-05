import { execFileSync } from 'node:child_process';
import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { createMolecularScene } from '../scripts/molecular-scene.mjs';
import { runMolecularRender } from '../scripts/molecular-render.mjs';

const { MVSData } = createRequire(import.meta.url)('molstar/lib/commonjs/extensions/mvs/mvs-data.js');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const text = 'ATOM      1  CA  ALA A   1       0.000   0.000   0.000  1.00 20.00           C\nEND\n';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'burette-render-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'source');
  await writeFile(path, text);
  return { directory, documents: [{ id: 'primary', path, format: 'pdb', sha256: hash(text) }] };
}

test('scene is self-contained, schema-valid and focuses represented chains', async t => {
  const { documents } = await fixture(t);
  const recipe = { background: '#101722', layers: [{ documentId: 'primary', chain: 'A', representation: 'cartoon', color: '#30aaaa' },
    { documentId: 'primary', chain: 'A', residues: [66], componentId: 'CRO', representation: 'ball-and-stick' }],
    labels: [{ documentId: 'primary', chain: 'A', residue: 66, componentId: 'CRO', text: 'Chromophore' }],
    transforms: [{ documentId: 'primary', rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1], translation: [0, 0, 0] }], camera: { direction: 'front', zoom: 1.15 } };
  const result = await createMolecularScene(documents, recipe);
  assert.equal(MVSData.validationIssues(result.scene, { noExtra: true }), undefined);
  const download = result.scene.root.children[0];
  assert.equal(Buffer.from(download.params.url.split(',')[1], 'base64').toString(), text);
  const structure = download.children[0].children[0];
  assert.deepEqual(structure.children[1].params.selector, { auth_asym_id: 'A' });
  assert.equal(structure.children[1].children[1].kind, 'focus');
  assert.equal(structure.children[2].children.some(node => node.kind === 'focus'), false);
  assert.equal(JSON.stringify(result).includes(documents[0].path), false);
});

test('scene rejects unauthorized documents and changed snapshots', async t => {
  const { documents } = await fixture(t);
  await assert.rejects(createMolecularScene(documents, { layers: [{ documentId: 'other', representation: 'cartoon' }] }), /unauthorized/);
  await assert.rejects(createMolecularScene(documents, { transforms: [{ documentId: 'other' }] }), /unauthorized/);
  await assert.rejects(createMolecularScene(documents, { transforms: [{ documentId: 'primary' }, { documentId: 'primary' }] }), /unique/);
  await writeFile(documents[0].path, text + 'changed');
  await assert.rejects(createMolecularScene(documents), /digest changed/);
});

async function browserResources() {
  let timer, active = Promise.resolve(), peakRssBytes = 0, peakCpuPercent = 0, priorCpuTicks = 0, priorTime = Date.now();
  const clockTicksPerSecond = Number(execFileSync('getconf', ['CLK_TCK'], { encoding: 'utf8' }).trim());
  const ticks = new Map();
  async function sample(pid) {
    const [status, children, info] = await Promise.all([
      readFile(`/proc/${pid}/status`, 'utf8').catch(() => ''),
      readFile(`/proc/${pid}/task/${pid}/children`, 'utf8').catch(() => ''),
      readFile(`/proc/${pid}/stat`, 'utf8').catch(() => ''),
    ]);
    const parts = info.slice(info.lastIndexOf(')') + 2).split(' ');
    if (info) ticks.set(pid, Math.max(ticks.get(pid) ?? 0, Number(parts[11]) + Number(parts[12])));
    const own = Number(/VmRSS:\s+(\d+)/u.exec(status)?.[1] ?? 0) * 1024;
    const rest = await Promise.all(children.trim().split(/\s+/u).filter(Boolean).slice(0, 32).map(value => sample(Number(value))));
    return own + rest.reduce((sum, value) => sum + value, 0);
  }
  return {
    started(pid) { timer = setInterval(() => { active = sample(pid).then(rss => {
      peakRssBytes = Math.max(peakRssBytes, rss);
      const total = [...ticks.values()].reduce((sum, value) => sum + value, 0), now = Date.now();
      peakCpuPercent = Math.max(peakCpuPercent, (total - priorCpuTicks) / clockTicksPerSecond / ((now - priorTime) / 1000) * 100);
      priorTime = now; priorCpuTicks = total;
    }); }, 100); },
    async finish() {
      clearInterval(timer);
      await active;
      return { peakRssBytes, peakCpuPercent, clockTicksPerSecond, sampleIntervalMs: 100, cpuTicks: [...ticks.values()].reduce((sum, value) => sum + value, 0), observedProcessIds: [...ticks.keys()] };
    },
  };
}

test('real unattended GFP render produces versioned PNG, sidecar and reopenable scene', { skip: !process.env.BURETTE_RENDER_TEST_SOURCE }, async () => {
  const path = resolve(process.env.BURETTE_RENDER_TEST_SOURCE), bytes = await readFile(path);
  const directory = await mkdtemp(join(tmpdir(), 'burette-gfp-render-'));
  const action = { type: 'render', width: 1600, height: 1200, outputPath: join(directory, 'gfp.png'),
    scene: { layers: [{ documentId: 'primary', representation: 'cartoon', color: '#7cb4b7' },
      { documentId: 'primary', chain: 'A', residues: [66], componentId: 'CRO', representation: 'ball-and-stick' }],
    labels: [{ documentId: 'primary', chain: 'A', residue: 66, componentId: 'CRO', text: 'GFP chromophore' }] } };
  const documents = [{ id: 'primary', path, format: 'pdb', sha256: hash(bytes) }];
  const resources = await browserResources();
  let first, browserUsage;
  try { first = await runMolecularRender({ documents, action, onBrowserStarted: pid => resources.started(pid) }); }
  finally { browserUsage = await resources.finish(); }
  const second = await runMolecularRender({ documents, action });
  assert.notEqual(first.artifacts.png, second.artifacts.png);
  assert.equal(second.version, 2);
  const image = await readFile(first.artifacts.png), sidecar = JSON.parse(await readFile(first.artifacts.sidecar));
  assert.deepEqual([image.readUInt32BE(16), image.readUInt32BE(20)], [1600, 1200]);
  assert.equal(sidecar.image.sha256, hash(image));
  assert.ok(sidecar.method.foregroundPixels > 100);
  assert.equal(sidecar.nativeAttachment.supported, true);
  for (const pid of browserUsage.observedProcessIds) assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
  assert.equal(sidecar.method.atomCount, 1866);
  assert.equal(MVSData.validationIssues(JSON.parse(await readFile(first.scenePath)), { noExtra: true }), undefined);
  assert.ok((await stat(first.scenePath)).size > bytes.length);
  console.log(JSON.stringify({ artifacts: first.artifacts, versionedImage: second.artifacts.png, browserUsage }));
});

test('cancelled headless rendering closes its browser process', { skip: !process.env.BURETTE_RENDER_TEST_SOURCE }, async () => {
  const source = resolve(process.env.BURETTE_RENDER_TEST_SOURCE), bytes = await readFile(source);
  const controller = new AbortController();
  let pid, timer;
  try {
    await assert.rejects(runMolecularRender({ documents: [{ id: 'primary', path: source, format: 'pdb', sha256: hash(bytes) }],
      action: { type: 'render', outputPath: join(tmpdir(), 'burette-cancelled-render.png') }, signal: controller.signal,
      onBrowserStarted: value => { pid = value; timer = setTimeout(() => controller.abort(), 1000); } }), /abort/i);
    assert.ok(pid);
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
  } finally { clearTimeout(timer); }
});

test('abrupt render worker death closes its Chromium subtree', { skip: !process.env.BURETTE_RENDER_TEST_SOURCE }, async () => {
  const { spawn } = await import('node:child_process');
  const { once } = await import('node:events');
  const { setTimeout: delay } = await import('node:timers/promises');
  const moduleUrl = new URL('../scripts/molecular-render.mjs', import.meta.url).href;
  const path = resolve(process.env.BURETTE_RENDER_TEST_SOURCE), bytes = await readFile(path);
  const input = { documents: [{ id: 'primary', path, format: 'pdb', sha256: hash(bytes) }], action: { type: 'render', outputPath: join(tmpdir(), 'burette-killed-render.png') } };
  const child = spawn(process.execPath, ['--input-type=module', '-e',
    `import {runMolecularRender} from ${JSON.stringify(moduleUrl)}; await runMolecularRender({...${JSON.stringify(input)},onBrowserStarted:pid=>process.stdout.write(JSON.stringify({pid})+'\\n')});`], { stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = once(child, 'exit');
  let browserPid, startupTimer;
  const descendants = new Set();
  const running = async pid => {
    if (process.platform !== 'linux') { try { process.kill(pid, 0); return true; } catch { return false; } }
    const text = await readFile(`/proc/${pid}/stat`, 'utf8').catch(() => '');
    return !!text && text.slice(text.lastIndexOf(')') + 2)[0] !== 'Z';
  };
  const collect = async pid => {
    descendants.add(pid);
    const children = await readFile(`/proc/${pid}/task/${pid}/children`, 'utf8').catch(() => '');
    for (const value of children.trim().split(/\s+/u).filter(Boolean)) await collect(Number(value));
  };
  try {
    const ready = new Promise((resolveReady, reject) => {
      let output = '';
      child.stdout.on('data', chunk => { output += chunk; if (output.includes('\n')) { browserPid = JSON.parse(output.split('\n')[0]).pid; resolveReady(); } });
      child.once('error', reject);
      child.once('exit', () => { if (!browserPid) reject(new Error('Render child exited before browser startup.')); });
    });
    await Promise.race([ready, new Promise((_, reject) => { startupTimer = setTimeout(() => reject(new Error('Browser startup timed out.')), 10000); })]);
    clearTimeout(startupTimer);
    await delay(1000);
    await collect(browserPid);
    child.kill('SIGKILL');
    await exited;
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && (await Promise.all([...descendants].map(running))).some(Boolean)) await delay(50);
    const remaining = [];
    for (const pid of descendants) if (await running(pid)) remaining.push(pid);
    assert.deepEqual(remaining, []);
    console.log(JSON.stringify({ abruptWorkerExit: 'SIGKILL', stoppedBrowserProcessIds: [...descendants] }));
  } finally {
    clearTimeout(startupTimer);
    child.kill('SIGKILL');
    for (const pid of descendants) if (await running(pid)) { try { process.kill(pid, 'SIGKILL'); } catch {} }
  }
});
