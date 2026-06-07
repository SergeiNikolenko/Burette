#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer, request } from 'node:http';

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

  const htmlWithToken = await get(ready.url);
  assert.equal(htmlWithToken.statusCode, 200);
  assert.match(htmlWithToken.body, /viewer-runtime\.css/);
  assert.match(htmlWithToken.body, /viewer-shell\.js/);
  const cookie = htmlWithToken.headers['set-cookie']?.find(value => value.startsWith('BurreteAgentPreviewToken='));
  assert.ok(cookie, 'authorized HTML response should set the preview token cookie');

  const cookieHeader = cookie.split(';')[0];
  const dataWithCookie = await get(`${base}/preview-data.js`, { Cookie: cookieHeader });
  assert.equal(dataWithCookie.statusCode, 200);
  assert.match(dataWithCookie.body, /^window\.BurreteDataBase64 = "/);

  const configWithCookie = await get(`${base}/preview-config.js`, { Cookie: cookieHeader });
  assert.equal(configWithCookie.statusCode, 200);
  assert.match(configWithCookie.body, /^window\.BurreteConfig = /);
  assert.match(configWithCookie.body, /window\.BurreteAgentControl = /);

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

  const queuedAction = await postJson(`${base}/__agent/act`, {
    type: 'focus_ligand',
    selector: { label_comp_id: 'HEM' }
  }, { Cookie: cookieHeader });
  assert.equal(queuedAction.statusCode, 200);
  const queued = JSON.parse(queuedAction.body);
  assert.equal(queued.ok, true);
  assert.equal(queued.action.status, 'queued');
  assert.equal(queued.action.type, 'focus_ligand');

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

  const nextLigandAction = await get(`${base}/__agent/next-action`, { Cookie: cookieHeader });
  assert.equal(nextLigandAction.statusCode, 200);
  const nextLigand = JSON.parse(nextLigandAction.body);
  assert.equal(nextLigand.id, queued.action.id);
  assert.equal(nextLigand.action.selector.label_comp_id, 'HEM');

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
  assert.equal(observedAction.actions.dispatched, 2);
  assert.equal(observedAction.actions.completed, 1);
  assert.equal(observedAction.actions.last.id, queuedPanel.action.id);
  assert.equal(observedAction.actions.last.status, 'dispatched');
  assert.equal(observedAction.actions.recent.length, 3);
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
