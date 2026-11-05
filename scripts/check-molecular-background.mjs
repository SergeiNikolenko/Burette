#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { runMcpAppOperation as directOperation } from './mcp-app-session.mjs';

const args = process.argv.slice(2), noRender = args.includes('--no-render');
const pluginIndex = args.indexOf('--plugin');
const pluginPath = pluginIndex < 0 ? null : resolve(args[pluginIndex + 1]);
const positional = args.filter((value, index) => value !== '--no-render' && (pluginIndex < 0 || (index !== pluginIndex && index !== pluginIndex + 1)));
if (positional.length !== 2) throw new Error('Usage: node scripts/check-molecular-background.mjs <RCSB fixture directory> <output directory> [--no-render]');
const [fixtures, output] = positional.map(value => resolve(value));
let client;
if (pluginPath) {
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
  client = new Client({ name: 'burette-background-acceptance', version: '1.0.0' });
  await client.connect(new StdioClientTransport({ command: process.execPath,
    args: [join(pluginPath, 'mcp/lib/server-bundle.mjs'), '--stdio'], cwd: pluginPath, stderr: 'inherit' }));
}
async function runMcpAppOperation(input) {
  if (!client) return directOperation(input);
  const { operation, command, autonomous, workspace, ...parameters } = input;
  const name = operation === 'open' ? 'burette.open_molecular_session' : operation === 'observe' ? 'burette.observe_inline_viewer'
    : command === 'run' ? 'burette.run_molecular_operation' : 'burette.molecular_job';
  const response = await client.callTool({ name, arguments: { ...parameters, ...(command === 'cancel' ? { cancel: true } : {}) } });
  if (response.isError) throw new Error(JSON.stringify(response.structuredContent ?? response.content));
  return response.structuredContent;
}
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const execute = promisify(execFile);
async function sampleTree(pid, record) {
  if (!pid) return;
  try {
    const { stdout } = await execute('/bin/ps', ['-axo', 'pid=,ppid=,rss=,pcpu='], { maxBuffer: 1024 * 1024 });
    const rows = stdout.trim().split('\n').map(line => line.trim().split(/\s+/u).map(Number));
    const ids = new Set([pid]);
    for (let size = 0; size !== ids.size;) { size = ids.size; for (const [child, parent] of rows) if (ids.has(parent)) ids.add(child); }
    const tree = rows.filter(row => ids.has(row[0]));
    record.processTree ??= { sampledPeakRssKiB: 0, sampledPeakCpuPercent: 0, observedPids: [], intervalMs: 200 };
    record.processTree.sampledPeakRssKiB = Math.max(record.processTree.sampledPeakRssKiB, tree.reduce((sum, row) => sum + row[2], 0));
    record.processTree.sampledPeakCpuPercent = Math.max(record.processTree.sampledPeakCpuPercent, tree.reduce((sum, row) => sum + row[3], 0));
    record.processTree.observedPids = [...new Set([...record.processTree.observedPids, ...tree.map(row => row[0])])];
  } catch (error) { record.processTreeUnavailable = error.code || String(error.message).slice(0, 160); }
}
const sources = {
  '1YCR': { bytes: 94041, atoms: 818, sha256: 'd8f23749da9ec22da2e17bb31c33803e3db6123233cd0404bdc005111196e7a3' },
  '4AKE': { bytes: 309339, atoms: 3459, sha256: 'ff798ee8791878eb58bac1c6bed32042f51b455512ac93b50bda8fa0ff0e7f78' },
  '1AKE': { bytes: 357777, atoms: 3816, sha256: '651e952f55f1317f50f4e82b7f0e99053397032cd8da5b2896f79d0af9f619a9' },
  '1EMA': { bytes: 190188, atoms: 1866, sha256: 'f1b9fdc2b871cc41f21f645a21b4948ce12d79b29197256330b108c9b503b088' },
};
const terminal = new Set(['completed', 'failed', 'cancelled', 'interrupted']);
const report = { schema: 'burette.background-acceptance/v1', startedAt: new Date().toISOString(),
  status: 'running', platform: process.platform, architecture: process.arch, noRender, sources, transport: client ? 'packaged-mcp-stdio' : 'direct-cli', pluginPath,
  metricsScope: 'Per-job compute worker resourceUsage; browser descendant resources require separate process-tree measurement.',
  sessions: [], jobs: [], exchangeCalls: 0, presentationCalls: 0 };
const close = (actual, expected, tolerance) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected} by more than ${tolerance}`);
let interrupted = false, active;
process.once('SIGINT', () => { interrupted = true; });

async function unmounted(sessionId) {
  const observation = await runMcpAppOperation({ operation: 'observe', sessionId });
  assert.equal(observation.lifecycle.status, 'awaiting_mount', 'Acceptance must never mount or exchange with a viewer.');
  assert.equal(observation.ready, false);
  return observation.lifecycle.status;
}

async function open(ids) {
  const session = await runMcpAppOperation({ operation: 'open', autonomous: true, workspace: true,
    file: join(fixtures, `${ids[0]}.pdb`), additionalFiles: ids.slice(1).map(id => join(fixtures, `${id}.pdb`)), openRequestId: randomUUID() });
  const record = { sessionId: session.sessionId, sources: ids, documents: session.documents.map(({ id, label, sha256 }) => ({ id, label, sha256 })),
    lifecycle: await unmounted(session.sessionId), jobs: [] };
  report.sessions.push(record);
  return record;
}

async function run(session, name, action) {
  const requestId = randomUUID(), sessionId = session.sessionId;
  const started = Date.now();
  const record = { name, sessionId, requestId, type: action.type, before: await unmounted(sessionId) };
  report.jobs.push(record);
  session.jobs.push({ name, requestId });
  active = { sessionId, requestId };
  let job = await runMcpAppOperation({ operation: 'molecular', command: 'run', sessionId, requestId, action, waitMs: 0 });
  const deadline = started + 120000;
  while (!terminal.has(job.status)) {
    if (interrupted || Date.now() >= deadline) {
      await runMcpAppOperation({ operation: 'molecular', command: 'cancel', sessionId, requestId });
      throw new Error(`${name}: ${interrupted ? 'interrupted; cancellation requested' : '120-second acceptance deadline exceeded; cancellation requested'}`);
    }
    await unmounted(sessionId);
    await sampleTree(job.workerPid, record);
    await delay(200);
    job = await runMcpAppOperation({ operation: 'molecular', command: 'status', sessionId, requestId });
  }
  active = null;
  Object.assign(record, { status: job.status, elapsedMs: Date.now() - started, metrics: job.metrics,
    after: await unmounted(sessionId), error: job.error, sources: job.result?.sources });
  assert.equal(job.status, 'completed', `${name}: ${JSON.stringify(job.error ?? job)}`);
  assert.ok(job.metrics && Number.isFinite(job.metrics.maxRssKiB), 'Worker must report actual resource usage.');
  if (record.processTree) {
    await delay(300);
    record.processTree.remainingPids = record.processTree.observedPids.filter(pid => {
      try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; }
    });
    assert.deepEqual(record.processTree.remainingPids, [], 'Owned compute/browser processes must exit after publication.');
  }
  console.log(JSON.stringify({ name, status: job.status, elapsedMs: record.elapsedMs, metrics: job.metrics }));
  return { result: job.result, record, requestId };
}

async function render(session, name, scene, basename, expectedAtoms) {
  const outcome = await run(session, name, { type: 'render', outputPath: join(output, basename), width: 1600, height: 1200, scene });
  const { result, record } = outcome;
  const bytes = await readFile(result.artifacts.png), sidecar = JSON.parse(await readFile(result.artifacts.sidecar, 'utf8'));
  const sceneBytes = await readFile(result.artifacts.scene);
  assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.deepEqual([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], [1600, 1200]);
  assert.equal(sidecar.image.sha256, hash(bytes));
  assert.equal(sidecar.scene.sha256, hash(sceneBytes));
  assert.equal(sidecar.method.atomCount, expectedAtoms);
  assert.equal(sidecar.collisionPolicy, 'versioned');
  assert.equal(sidecar.method.targets.length, (scene.layers?.length ?? session.documents.length) + (scene.labels?.length ?? 0));
  assert.ok(sidecar.method.targets.every(target => target.atomCount > 0));
  assert.deepEqual(sidecar.scene.recipe, scene);
  Object.assign(record, { artifacts: result.artifacts, sceneRequestId: outcome.requestId, imageSha256: sidecar.image.sha256,
    atomCount: sidecar.method.atomCount, selectedTargets: sidecar.method.targets, version: sidecar.version });
  return outcome;
}

await mkdir(output, { recursive: true });
try {
  for (const [id, expected] of Object.entries(sources)) {
    const bytes = await readFile(join(fixtures, `${id}.pdb`));
    assert.equal(bytes.length, expected.bytes, `${id}: source byte length drift`);
    assert.equal(hash(bytes), expected.sha256, `${id}: source digest drift`);
    assert.equal(bytes.toString('utf8').split(/\r?\n/u).filter(line => /^(ATOM  |HETATM)/u.test(line)).length, expected.atoms, `${id}: source atom count drift`);
  }
  const mdm = await open(['1YCR']), primary = mdm.documents[0].id;
  const partners = { selection: { documentId: primary, chain: 'A' }, target: { documentId: primary, chain: 'B' } };
  const contacts = await run(mdm, 'mdm2-p53-contacts', { type: 'contacts', ...partners, cutoff: 4 });
  assert.deepEqual({ count: contacts.result.atomContactCount, partners: contacts.result.partnerAtomCounts, truncated: contacts.result.truncated },
    { count: 105, partners: [705, 113], truncated: false });
  Object.assign(contacts.record, { atomContactCount: contacts.result.atomContactCount, method: contacts.result.method });
  const area = await run(mdm, 'mdm2-p53-buried-area', { type: 'buried_area', ...partners, probeRadius: 1.4, samples: 240 });
  for (const [key, expected] of Object.entries({ interfaceAreaSquareAngstrom: 735.864963, totalSasaLossSquareAngstrom: 1471.729925,
    firstSasaSquareAngstrom: 5287.675647, secondSasaSquareAngstrom: 1613.478497, complexSasaSquareAngstrom: 5429.424218 })) close(area.result[key], expected, 0.01);
  Object.assign(area.record, { result: area.result });
  if (!noRender) await render(mdm, 'mdm2-p53-scene', { background: '#101722', camera: { direction: 'front', zoom: 1.3 },
    layers: [{ documentId: primary, representation: 'cartoon', color: '#6ba6b8' },
      { documentId: primary, chain: 'B', residues: [19, 23, 26], representation: 'ball-and-stick' }],
    labels: [[19, 'Phe19'], [23, 'Trp23'], [26, 'Leu26']].map(([residue, text]) => ({ documentId: primary, chain: 'B', residue, text })) }, 'mdm2-p53.png', 818);

  const ake = await open(['4AKE', '1AKE']), [reference, moving] = ake.documents.map(document => document.id);
  const alignment = await run(ake, 'adenylate-kinase-alignment', { type: 'align', selection: { documentId: reference, chain: 'A' }, target: { documentId: moving, chain: 'A' } });
  assert.equal(alignment.result.alignedCount, 214);
  close(alignment.result.rmsdAngstrom, 8.043719662, 0.00001);
  close(alignment.result.tmScores.referenceNormalized, 0.683847026, 0.000001);
  close(alignment.result.tmScores.movingNormalized, 0.683847026, 0.000001);
  alignment.record.result = alignment.result;
  const matrix = alignment.result.transform.matrix;
  if (!noRender) await render(ake, 'adenylate-kinase-scene', { background: '#101722', camera: { direction: 'left', zoom: 1.15 },
    layers: [{ documentId: reference, chain: 'A', representation: 'cartoon', color: '#0f766e' },
      { documentId: moving, chain: 'A', representation: 'cartoon', color: '#c026d3' },
      { documentId: moving, chain: 'A', componentId: 'AP5', representation: 'ball-and-stick' }],
    transforms: [{ documentId: moving, rotation: [0, 1, 2, 4, 5, 6, 8, 9, 10].map(index => matrix[index]), translation: matrix.slice(12, 15) }] }, 'adenylate-kinase.png', 7275);

  const gfp = await open(['1EMA']), protein = gfp.documents[0].id;
  if (!noRender) {
    const scene = { background: '#101722', camera: { direction: 'front', zoom: 1.15 },
      layers: [{ documentId: protein, representation: 'cartoon', color: '#7cb4b7' },
        { documentId: protein, chain: 'A', residues: [66], componentId: 'CRO', representation: 'ball-and-stick' }],
      labels: [{ documentId: protein, chain: 'A', residue: 66, componentId: 'CRO', text: 'GFP chromophore' }] };
    const first = await render(gfp, 'gfp-publication-image', scene, 'gfp.png', 1866);
    const second = await render(gfp, 'gfp-versioned-image', scene, 'gfp.png', 1866);
    assert.notEqual(first.result.artifacts.png, second.result.artifacts.png);
    assert.ok(second.result.version > first.result.version);
    assert.equal(hash(await readFile(first.result.artifacts.png)), first.record.imageSha256, 'Versioned export changed the earlier image.');
  }
  for (const session of report.sessions) await unmounted(session.sessionId);
  report.status = noRender ? 'science-passed-render-not-run' : 'passed';
} catch (error) {
  report.status = 'failed';
  report.error = { code: error.code, message: String(error.message).slice(0, 2000) };
  if (active) await runMcpAppOperation({ operation: 'molecular', command: 'cancel', ...active }).catch(() => {});
  process.exitCode = 1;
} finally {
  report.completedAt = new Date().toISOString();
  const path = join(output, 'background-acceptance.json');
  await writeFile(path, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ status: report.status, report: path, error: report.error }));
  await client?.close();
}
