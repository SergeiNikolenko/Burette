#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function freePort() {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

function requestText(url, { method = 'GET', headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const req = request(url, { method, headers }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({
        statusCode: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks).toString('utf8')
      }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function get(url, headers = {}) {
  return requestText(url, { headers });
}

function postJson(url, value, headers = {}) {
  return requestText(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(value)
  });
}

function previewDataText(body) {
  const match = body.match(/^window\.BurreteDataBase64 = "([^"]+)";/);
  assert.ok(match, 'preview-data.js should contain a base64 payload');
  return Buffer.from(match[1], 'base64').toString('utf8');
}

async function waitForReady(child) {
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk.toString('utf8'); });
  child.stderr.on('data', chunk => { stderr += chunk.toString('utf8'); });

  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const start = stdout.indexOf('{');
    const end = stdout.lastIndexOf('}');
    if (start !== -1 && end > start) {
      return JSON.parse(stdout.slice(start, end + 1));
    }
    if (child.exitCode != null) break;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`agent-preview did not become ready. stdout=${stdout} stderr=${stderr}`);
}

const port = await freePort();
const child = spawn(process.execPath, ['scripts/agent-preview.mjs', 'samples/mini.pdb', '--port', String(port)], {
  stdio: ['ignore', 'pipe', 'pipe']
});

try {
  const ready = await waitForReady(child);
  assert.equal(ready.ok, true);
  assert.match(ready.url, new RegExp(`^http://127\\.0\\.0\\.1:${port}/index\\.html\\?token=`));

  const base = `http://127.0.0.1:${port}`;
  const htmlWithoutToken = await get(`${base}/index.html`);
  assert.equal(htmlWithoutToken.statusCode, 403);

  const dataWithoutToken = await get(`${base}/preview-data.js`);
  assert.equal(dataWithoutToken.statusCode, 403);

  const configWithoutToken = await get(`${base}/preview-config.js`);
  assert.equal(configWithoutToken.statusCode, 403);

  const observeWithoutToken = await get(`${base}/__agent/observe`);
  assert.equal(observeWithoutToken.statusCode, 403);

  const reportWithoutToken = await postJson(`${base}/__agent/report`, {});
  assert.equal(reportWithoutToken.statusCode, 403);

  const actWithoutToken = await postJson(`${base}/__agent/act`, { type: 'reset_camera' });
  assert.equal(actWithoutToken.statusCode, 403);

  const staticAgent = await get(`${base}/burette-agent.js`);
  assert.equal(staticAgent.statusCode, 200);
  assert.match(staticAgent.body, /window\.BurreteAgent/);
  const staticViewerRuntimeCSS = await get(`${base}/viewer-runtime.css`);
  assert.equal(staticViewerRuntimeCSS.statusCode, 200);
  assert.doesNotMatch(staticViewerRuntimeCSS.body, /#buret-toolbar\.collapsed:hover/);
  assert.match(staticViewerRuntimeCSS.body, /#buret-toolbar\.buret-suppressed-by-molstar-panel/);
  const staticViewerShell = await get(`${base}/viewer-shell.js`);
  assert.equal(staticViewerShell.statusCode, 200);
  assert.match(staticViewerShell.body, /buret-renderer-choice/);
  assert.match(staticViewerShell.body, />Seq</);
  assert.doesNotMatch(staticViewerShell.body, /VESTA/);
  const canonicalViewer = await readFile('PreviewExtension/Web/viewer.js', 'utf8');
  const staticViewer = await get(`${base}/viewer.js`);
  assert.equal(staticViewer.statusCode, 200);
  assert.equal(staticViewer.body, canonicalViewer);

  const pluginPort = await freePort();
  const pluginChild = spawn(process.execPath, ['plugins/burette-agent/scripts/agent-preview.mjs', 'samples/mini.pdb', '--port', String(pluginPort)], {
    stdio: ['ignore', 'pipe', 'pipe']
  });
  try {
    await waitForReady(pluginChild);
    const pluginViewer = await get(`http://127.0.0.1:${pluginPort}/viewer.js`);
    assert.equal(pluginViewer.statusCode, 200);
    assert.equal(pluginViewer.body, canonicalViewer);
  } finally {
    pluginChild.kill('SIGTERM');
  }

  const htmlWithToken = await get(ready.url);
  assert.equal(htmlWithToken.statusCode, 200);
  assert.match(htmlWithToken.body, /viewer-runtime\.css\?v=\d+/);
  assert.match(htmlWithToken.body, /viewer-shell\.js\?v=\d+/);
  assert.match(htmlWithToken.body, /burette-agent\.js\?v=\d+/);
  assert.match(htmlWithToken.body, /viewer\.js\?v=\d+/);
  const cookie = htmlWithToken.headers['set-cookie']?.find(value => value.startsWith('BurreteAgentPreviewToken='));
  assert.ok(cookie, 'authorized HTML response should set the preview token cookie');

  const cookieHeader = cookie.split(';')[0];
  const dataWithCookie = await get(`${base}/preview-data.js`, { Cookie: cookieHeader });
  assert.equal(dataWithCookie.statusCode, 200);
  assert.match(dataWithCookie.body, /^window\.BurreteDataBase64 = "/);

  const configWithCookie = await get(`${base}/preview-config.js`, { Cookie: cookieHeader });
  assert.equal(configWithCookie.statusCode, 200);
  assert.match(configWithCookie.body, /^window\.BurreteConfig = /);
  assert.match(configWithCookie.body, /"enablePreviewDocks":true/);
  assert.match(configWithCookie.body, /"defaultPreviewDocks":\[\]/);
  assert.match(configWithCookie.body, /window\.BurreteAgentControl = /);
  assert.match(configWithCookie.body, /"observeUrl":"\/__agent\/observe"/);

  const tempDir = await mkdtemp(join(tmpdir(), 'burrete-agent-preview-'));
  const maePath = join(tempDir, 'ligand.mae');
  await writeFile(maePath, `
f_m_ct {
  s_ffio_ct_type
  :::
  solute
  m_atom[2] {
    i_m_mmod_type
    i_m_atomic_number
    r_m_x_coord
    r_m_y_coord
    r_m_z_coord
    s_m_pdb_residue_name
    s_m_pdb_atom_name
    i_m_residue_number
    s_m_chain_name
    :::
    1 6 1.000000 2.000000 3.000000 "LIG " " C1 " 402 "B"
    1 8 2.000000 2.000000 3.000000 "LIG " " O2 " 402 "B"
    :::
  }
}
`);
  const maePort = await freePort();
  const maeChild = spawn(process.execPath, ['scripts/agent-preview.mjs', maePath, '--port', String(maePort)], {
    stdio: ['ignore', 'pipe', 'pipe']
  });
  try {
    const maeReady = await waitForReady(maeChild);
    const maeHtml = await get(maeReady.url);
    assert.equal(maeHtml.statusCode, 200);
    const maeCookie = maeHtml.headers['set-cookie']?.find(value => value.startsWith('BurreteAgentPreviewToken='));
    assert.ok(maeCookie, 'authorized Maestro HTML response should set the preview token cookie');
    const maeCookieHeader = maeCookie.split(';')[0];
    const maeConfig = await get(`http://127.0.0.1:${maePort}/preview-config.js`, { Cookie: maeCookieHeader });
    assert.equal(maeConfig.statusCode, 200);
    assert.match(maeConfig.body, /"format":"pdb"/);
    assert.match(maeConfig.body, /"binary":false/);
    const maeData = await get(`http://127.0.0.1:${maePort}/preview-data.js`, { Cookie: maeCookieHeader });
    assert.equal(maeData.statusCode, 200);
    const maePdb = previewDataText(maeData.body);
    assert.match(maePdb, /^HETATM\s+1 C1\s+LIG B 402/m);
    assert.match(maePdb, /^CONECT/m);
  } finally {
    maeChild.kill('SIGTERM');
    await rm(tempDir, { recursive: true, force: true });
  }

  const coordinateTempDir = await mkdtemp(join(tmpdir(), 'burrete-coordinate-preview-'));
  const amberPath = join(coordinateTempDir, 'amber.inpcrd');
  const charmmPath = join(coordinateTempDir, 'charmm.crd');
  const statePath = join(coordinateTempDir, 'openmm.state');
  const hoomdPath = join(coordinateTempDir, 'hoomd.xml');
  const lammpsPath = join(coordinateTempDir, 'dump.lammpstrj');
  const posPath = join(coordinateTempDir, 'c60.0.pos');
  const cfgPath = join(coordinateTempDir, 'c60.0.cfg');
  await writeFile(amberPath, `Amber restart
3
  0.0000000  0.0000000  0.0000000  1.5200000  0.0000000  0.0000000
  2.1200000  1.0000000  0.0000000
`);
  await writeFile(charmmPath, `* CHARMM coordinates
*
    2 EXT
    1    1 MOL  C1     0.000000    0.000000    0.000000 MOL  1  0.00000
    2    1 MOL  O1     1.240000    0.000000    0.000000 MOL  1  0.00000
`);
  await writeFile(statePath, `<State>
  <Positions>
    <Position x="0.0" y="0.0" z="0.0"/>
    <Position x="0.8" y="0.0" z="0.0"/>
  </Positions>
</State>
`);
  await writeFile(hoomdPath, `<hoomd_xml version="1.6">
  <configuration time_step="0" dimensions="3" natoms="2">
    <position>
      0.0 0.0 0.0
      1.2 0.0 0.0
    </position>
    <type>C O</type>
  </configuration>
</hoomd_xml>
`);
  await writeFile(lammpsPath, `ITEM: TIMESTEP
0
ITEM: NUMBER OF ATOMS
2
ITEM: BOX BOUNDS pp pp pp
0 10
0 10
0 10
ITEM: ATOMS id element x y z
1 C 0.0 0.0 0.0
2 O 1.2 0.0 0.0
`);
  await writeFile(posPath, `ITEM: TIMESTEP
0
ITEM: NUMBER OF ATOMS
2
ITEM: BOX BOUNDS pp pp pp
0 10
0 10
0 10
ITEM: ATOMS id type x y z
1 1 8.39336 5.60135 4.68858
2 1 8.39378 4.31559 5.23490
`);
  await writeFile(cfgPath, `Number of particles = 2
A = 1 Angstrom (basic length-scale)
H0(1,1) = 10 A
H0(1,2) = 0 A
H0(1,3) = 0 A
H0(2,1) = 0 A
H0(2,2) = 10 A
H0(2,3) = 0 A
H0(3,1) = 0 A
H0(3,2) = 0 A
H0(3,3) = 10 A
.NO_VELOCITY.
entry_count = 3
12.010700
C
0.839336 0.560135 0.468858
12.010700
C
0.839378 0.431559 0.52349
`);
  for (const coordinatePath of [amberPath, charmmPath, statePath, hoomdPath, lammpsPath, posPath, cfgPath]) {
    const coordinatePort = await freePort();
    const coordinateChild = spawn(process.execPath, ['scripts/agent-preview.mjs', coordinatePath, '--port', String(coordinatePort)], {
      stdio: ['ignore', 'pipe', 'pipe']
    });
    try {
      const coordinateReady = await waitForReady(coordinateChild);
      const coordinateHtml = await get(coordinateReady.url);
      assert.equal(coordinateHtml.statusCode, 200);
      const coordinateCookie = coordinateHtml.headers['set-cookie']?.find(value => value.startsWith('BurreteAgentPreviewToken='));
      assert.ok(coordinateCookie, 'authorized coordinate HTML response should set the preview token cookie');
      const coordinateCookieHeader = coordinateCookie.split(';')[0];
      const coordinateConfig = await get(`http://127.0.0.1:${coordinatePort}/preview-config.js`, { Cookie: coordinateCookieHeader });
      assert.equal(coordinateConfig.statusCode, 200);
      assert.match(coordinateConfig.body, /"format":"pdb"/);
      assert.match(coordinateConfig.body, /"binary":false/);
      const coordinateData = await get(`http://127.0.0.1:${coordinatePort}/preview-data.js`, { Cookie: coordinateCookieHeader });
      assert.equal(coordinateData.statusCode, 200);
      const coordinatePdb = previewDataText(coordinateData.body);
      assert.match(coordinatePdb, /^REMARK Converted from /m);
      assert.match(coordinatePdb, /^HETATM\s+1 /m);
      assert.match(coordinatePdb, /^END$/m);
    } finally {
      coordinateChild.kill('SIGTERM');
    }
  }
  await rm(coordinateTempDir, { recursive: true, force: true });

  const observeWithCookie = await get(`${base}/__agent/observe`, { Cookie: cookieHeader });
  assert.equal(observeWithCookie.statusCode, 200);
  const observed = JSON.parse(observeWithCookie.body);
  assert.equal(observed.apiVersion, 'burette-agent-control/v1');
  assert.equal(observed.mode, 'browser-preview');
  assert.equal(observed.transport, 'http-local-token');
  assert.equal(observed.activeDocument.title, 'mini.pdb');
  assert.equal(observed.activeDocument.format, 'pdb');
  assert.equal(observed.activeDocument.viewer, 'molstar');
  assert.equal(observed.activeDocument.ready, false);
  assert.equal(observed.viewerAgent.available, false);
  assert.deepEqual(observed.viewerAgent.commands, []);
  assert.equal(observed.scene.known, false);
  assert.equal(observed.panels.includes('viewer'), true);

  const reportWithCookie = await postJson(`${base}/__agent/report`, {
    capabilities: {
      ok: true,
      result: {
        apiVersion: 'burette-agent/v1',
        commands: ['capabilities', 'summary', 'focusLigand'],
        ready: true
      }
    },
    summary: {
      ok: true,
      result: {
        format: 'pdb',
        label: 'mini.pdb',
        counts: { structures: 1, models: 1, chains: 1, atoms: 42, residues: 3, ligands: 0 },
        structures: [{ chains: [{ auth_asym_id: 'A' }], ligands: [] }]
      }
    }
  }, { Cookie: cookieHeader });
  assert.equal(reportWithCookie.statusCode, 200);
  assert.equal(JSON.parse(reportWithCookie.body).ok, true);

  const liveObserve = await get(`${base}/__agent/observe`, { Cookie: cookieHeader });
  assert.equal(liveObserve.statusCode, 200);
  const live = JSON.parse(liveObserve.body);
  assert.equal(live.activeDocument.ready, true);
  assert.equal(live.viewerAgent.available, true);
  assert.deepEqual(live.viewerAgent.commands, ['capabilities', 'summary', 'focusLigand']);
  assert.equal(live.scene.known, true);
  assert.equal(live.scene.structures, 1);
  assert.equal(live.scene.counts.atoms, 42);

  const invalidAction = await postJson(`${base}/__agent/act`, { type: 'delete_everything' }, { Cookie: cookieHeader });
  assert.equal(invalidAction.statusCode, 400);
  assert.equal(JSON.parse(invalidAction.body).error.code, 'INVALID_ACTION');

  const sceneAction = await postJson(`${base}/__agent/act`, {
    type: 'hide_waters'
  }, { Cookie: cookieHeader });
  assert.equal(sceneAction.statusCode, 200);
  const queuedScene = JSON.parse(sceneAction.body);
  assert.equal(queuedScene.ok, true);
  assert.equal(queuedScene.action.status, 'queued');
  assert.equal(queuedScene.action.type, 'hide_waters');

  const sceneSpecAction = await postJson(`${base}/__agent/act`, {
    type: 'apply_scene',
    components: [
      { selector: 'protein', label: 'Protein', highlight: true, color: '#4f8cff' },
      { selector: { chain: 'A', range: [1, 3] }, label: 'Active loop', select: true, focus: true }
    ]
  }, { Cookie: cookieHeader });
  assert.equal(sceneSpecAction.statusCode, 200);
  const queuedSceneSpec = JSON.parse(sceneSpecAction.body);
  assert.equal(queuedSceneSpec.ok, true);
  assert.equal(queuedSceneSpec.action.status, 'queued');
  assert.equal(queuedSceneSpec.action.type, 'apply_scene');

  const queuedAction = await postJson(`${base}/__agent/act`, {
    type: 'focus_ligand',
    selector: { label_comp_id: 'HEM' }
  }, { Cookie: cookieHeader });
  assert.equal(queuedAction.statusCode, 200);
  const queued = JSON.parse(queuedAction.body);
  assert.equal(queued.ok, true);
  assert.equal(queued.action.status, 'queued');
  assert.equal(queued.action.type, 'focus_ligand');

  const styleAction = await postJson(`${base}/__agent/act`, {
    type: 'set_molstar_style',
    style: 'ball-and-stick'
  }, { Cookie: cookieHeader });
  assert.equal(styleAction.statusCode, 200);
  const queuedStyle = JSON.parse(styleAction.body);
  assert.equal(queuedStyle.ok, true);
  assert.equal(queuedStyle.action.type, 'set_molstar_style');
  assert.equal(queuedStyle.action.status, 'queued');

  const poseAction = await postJson(`${base}/__agent/act`, {
    type: 'set_structure_pose',
    index: 2
  }, { Cookie: cookieHeader });
  assert.equal(poseAction.statusCode, 200);
  const queuedPose = JSON.parse(poseAction.body);
  assert.equal(queuedPose.ok, true);
  assert.equal(queuedPose.action.type, 'set_structure_pose');

  const sdfPoseModeAction = await postJson(`${base}/__agent/act`, {
    type: 'set_sdf_pose_mode',
    mode: 'all'
  }, { Cookie: cookieHeader });
  assert.equal(sdfPoseModeAction.statusCode, 200);
  const queuedSdfPoseMode = JSON.parse(sdfPoseModeAction.body);
  assert.equal(queuedSdfPoseMode.ok, true);
  assert.equal(queuedSdfPoseMode.action.type, 'set_sdf_pose_mode');

  const openFilesAction = await postJson(`${base}/__agent/act`, {
    type: 'open_files',
    paths: ['samples/mini.pdb']
  }, { Cookie: cookieHeader });
  assert.equal(openFilesAction.statusCode, 200);
  const queuedOpenFiles = JSON.parse(openFilesAction.body);
  assert.equal(queuedOpenFiles.ok, true);
  assert.equal(queuedOpenFiles.action.type, 'open_files');

  const panelAction = await postJson(`${base}/__agent/act`, {
    type: 'render_panel',
    kind: 'markdown',
    file: 'README.md'
  }, { Cookie: cookieHeader });
  assert.equal(panelAction.statusCode, 200);
  const queuedPanel = JSON.parse(panelAction.body);
  assert.equal(queuedPanel.ok, true);
  assert.equal(queuedPanel.action.type, 'render_panel');

  const nextAction = await get(`${base}/__agent/next-action`, { Cookie: cookieHeader });
  assert.equal(nextAction.statusCode, 200);
  const next = JSON.parse(nextAction.body);
  assert.equal(next.id, queuedScene.action.id);
  assert.equal(next.action.type, 'hide_waters');

  const completedAction = await postJson(`${base}/__agent/action-result`, {
    id: queuedScene.action.id,
    result: { ok: true, command: 'hide_waters', result: { componentCount: 2 } }
  }, { Cookie: cookieHeader });
  assert.equal(completedAction.statusCode, 200);
  const completed = JSON.parse(completedAction.body);
  assert.equal(completed.action.status, 'completed');
  assert.equal(completed.action.result.command, 'hide_waters');

  const nextSceneSpecAction = await get(`${base}/__agent/next-action`, { Cookie: cookieHeader });
  assert.equal(nextSceneSpecAction.statusCode, 200);
  const nextSceneSpec = JSON.parse(nextSceneSpecAction.body);
  assert.equal(nextSceneSpec.id, queuedSceneSpec.action.id);
  assert.equal(nextSceneSpec.action.type, 'apply_scene');
  assert.equal(nextSceneSpec.action.components[0].selector, 'protein');
  assert.equal(nextSceneSpec.action.components[1].label, 'Active loop');

  const nextLigandAction = await get(`${base}/__agent/next-action`, { Cookie: cookieHeader });
  assert.equal(nextLigandAction.statusCode, 200);
  const nextLigand = JSON.parse(nextLigandAction.body);
  assert.equal(nextLigand.id, queued.action.id);
  assert.equal(nextLigand.action.selector.label_comp_id, 'HEM');

  const nextStyleAction = await get(`${base}/__agent/next-action`, { Cookie: cookieHeader });
  assert.equal(nextStyleAction.statusCode, 200);
  const nextStyle = JSON.parse(nextStyleAction.body);
  assert.equal(nextStyle.id, queuedStyle.action.id);
  assert.equal(nextStyle.action.style, 'ball-and-stick');

  const nextPoseAction = await get(`${base}/__agent/next-action`, { Cookie: cookieHeader });
  assert.equal(nextPoseAction.statusCode, 200);
  const nextPose = JSON.parse(nextPoseAction.body);
  assert.equal(nextPose.id, queuedPose.action.id);
  assert.equal(nextPose.action.index, 2);

  const nextSdfPoseModeAction = await get(`${base}/__agent/next-action`, { Cookie: cookieHeader });
  assert.equal(nextSdfPoseModeAction.statusCode, 200);
  const nextSdfPoseMode = JSON.parse(nextSdfPoseModeAction.body);
  assert.equal(nextSdfPoseMode.id, queuedSdfPoseMode.action.id);
  assert.equal(nextSdfPoseMode.action.mode, 'all');

  const nextOpenFilesAction = await get(`${base}/__agent/next-action`, { Cookie: cookieHeader });
  assert.equal(nextOpenFilesAction.statusCode, 200);
  const nextOpenFiles = JSON.parse(nextOpenFilesAction.body);
  assert.equal(nextOpenFiles.id, queuedOpenFiles.action.id);
  assert.deepEqual(nextOpenFiles.action.paths, ['samples/mini.pdb']);

  const nextPanelAction = await get(`${base}/__agent/next-action`, { Cookie: cookieHeader });
  assert.equal(nextPanelAction.statusCode, 200);
  const nextPanel = JSON.parse(nextPanelAction.body);
  assert.equal(nextPanel.id, queuedPanel.action.id);
  assert.equal(nextPanel.action.panel.kind, 'markdown');
  assert.equal(nextPanel.action.panel.title, 'README.md');
  assert.match(nextPanel.action.panel.content, /Burrete/);

  const actionObserve = await get(`${base}/__agent/observe`, { Cookie: cookieHeader });
  assert.equal(actionObserve.statusCode, 200);
  const observedAction = JSON.parse(actionObserve.body);
  assert.equal(observedAction.actions.dispatched, 7);
  assert.equal(observedAction.actions.completed, 1);
  assert.equal(observedAction.actions.last.id, queuedPanel.action.id);
  assert.equal(observedAction.actions.last.status, 'dispatched');
  assert.equal(observedAction.actions.recent.length, 8);
  assert.equal(observedAction.actions.recent[0].id, queuedScene.action.id);
  assert.equal(observedAction.actions.recent[0].status, 'completed');
  assert.equal(observedAction.panels.includes('agent-panel:right:markdown:README.md'), true);
  assert.equal(observedAction.workspacePanels.length, 1);
  assert.equal(observedAction.workspacePanels[0].id, 'agent-panel:right:markdown:README.md');
  assert.equal(observedAction.workspacePanels[0].kind, 'markdown');
  assert.equal(observedAction.workspacePanels[0].status, 'dispatched');
  assert.equal(observedAction.workspacePanels[0].actionId, queuedPanel.action.id);

  console.log('agent-preview server tests passed');
} finally {
  child.kill('SIGTERM');
}
