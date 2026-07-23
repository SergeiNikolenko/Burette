#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, get as httpGet } from 'node:http';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

function get(url) {
  return new Promise((resolveRequest, rejectRequest) => {
    httpGet(new URL(url), (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => resolveRequest({
        statusCode: response.statusCode,
        headers: response.headers,
        body,
      }));
    }).on('error', rejectRequest);
  });
}

async function freePort() {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
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

function runCli(args) {
  return spawnSync(process.execPath, ['scripts/burrete-agent.mjs', ...args], {
    encoding: 'utf8'
  });
}

function runCliWithEnv(args, env) {
  return spawnSync(process.execPath, ['scripts/burrete-agent.mjs', ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

const port = await freePort();
const child = spawn(process.execPath, ['scripts/agent-preview.mjs', 'samples/mini.pdb', '--port', String(port)], {
  stdio: ['ignore', 'pipe', 'pipe']
});

try {
  const cliSource = await readFile(resolve('scripts/burrete-agent.mjs'), 'utf8');
  assert.match(cliSource, /'browser-agent-shell'/);
  assert.match(cliSource, /'browser-dev-shell'/);
  assert.match(cliSource, /function openAuto\(file, options\)/);
  assert.match(cliSource, /function openBrowserPreview\(file, options/);
  assert.match(cliSource, /function openBrowserAgentShell\(file, options\)/);
  assert.match(cliSource, /function openPrebuiltBrowserAgentShell/);
  assert.match(cliSource, /agent-shell-server\.mjs/);
  assert.match(cliSource, /BURRETE_AGENT_SHELL_DIST_DIR/);
  assert.match(cliSource, /runtime: 'prebuilt-static'/);
  assert.match(cliSource, /spawn\('vp', \['dev', 'apps\/desktop'/);
  assert.match(cliSource, /await allocatePort\(host\)/);
  assert.match(cliSource, /mkdtemp\(resolve\(tmpdir\(\), 'burrete-agent-shell-'\)\)/);
  assert.match(cliSource, /BURRETE_AGENT_SHELL_SESSION_DIR: sessionDir/);
  assert.match(cliSource, /const logPath = resolve\(sessionDir, 'server\.log'\)/);
  assert.match(cliSource, /VITE_BURRETE_AGENT_SHELL: '1'/);
  assert.match(cliSource, /VITE_BURETTE_DEV_INSTANCE: 'agent'/);
  assert.match(cliSource, /url\.searchParams\.set\('devFiles', initialFile\)/);
  assert.match(cliSource, /url\.searchParams\.set\('agentLayout', 'focus'\)/);
  assert.match(cliSource, /sessionDir,/);
  assert.match(cliSource, /async function browserShellSessionDir\(urlText\)/);
  assert.match(cliSource, /async function assertSessionResponsive\(sessionDir\)/);
  assert.match(cliSource, /BROWSER_AGENT_SHELL_UNAVAILABLE/);
  assert.match(cliSource, /BROWSER_AGENT_SHELL_FAILED/);
  assert.match(cliSource, /readLogTail/);
  assert.match(cliSource, /logPath,/);
  assert.match(cliSource, /observe: `node scripts\/burrete-agent\.mjs observe --session-dir/);
  assert.match(cliSource, /act: `node scripts\/burrete-agent\.mjs act --session-dir/);
  assert.match(cliSource, /function desktopOpenArgs\(app, sessionDir, file\)/);
  assert.match(cliSource, /spawn\('open', desktopOpenArgs\(app, sessionDir, resolve\(file\)\)/);
  assert.match(cliSource, /return \['-n', app, \.\.\.agentArgs\];/);
  assert.match(cliSource, /return \['-n', '-a', app, \.\.\.agentArgs\];/);

  const ready = await waitForReady(child);
  const observed = runCli(['observe', '--url', ready.url]);
  assert.equal(observed.status, 0, observed.stderr);
  const payload = JSON.parse(observed.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.apiVersion, 'burette-agent-cli/v1');
  assert.equal(payload.result.apiVersion, 'burette-agent-control/v1');
  assert.equal(payload.result.mode, 'browser-preview');
  assert.equal(payload.result.activeDocument.title, 'mini.pdb');
  assert.equal(payload.result.scene.known, false);

  const action = runCli(['act', '--url', ready.url, '{"type":"reset_camera"}']);
  assert.equal(action.status, 0, action.stderr);
  const actionPayload = JSON.parse(action.stdout);
  assert.equal(actionPayload.ok, true);
  assert.equal(actionPayload.apiVersion, 'burette-agent-cli/v1');
  assert.equal(actionPayload.result.ok, true);
  assert.equal(actionPayload.result.action.status, 'queued');
  assert.equal(actionPayload.result.action.type, 'reset_camera');

  const sceneAction = runCli(['act', '--url', ready.url, '{"type":"hide_waters"}']);
  assert.equal(sceneAction.status, 0, sceneAction.stderr);
  const sceneActionPayload = JSON.parse(sceneAction.stdout);
  assert.equal(sceneActionPayload.ok, true);
  assert.equal(sceneActionPayload.result.action.status, 'queued');
  assert.equal(sceneActionPayload.result.action.type, 'hide_waters');

  const sceneSpec = runCli(['act', '--url', ready.url, '{"type":"apply_scene","components":[{"selector":"protein","label":"Protein","highlight":true},{"selector":{"chain":"A","range":[1,3]},"label":"Active loop","select":true,"focus":true}]}']);
  assert.equal(sceneSpec.status, 0, sceneSpec.stderr);
  const sceneSpecPayload = JSON.parse(sceneSpec.stdout);
  assert.equal(sceneSpecPayload.ok, true);
  assert.equal(sceneSpecPayload.result.action.status, 'queued');
  assert.equal(sceneSpecPayload.result.action.type, 'apply_scene');

  const browserPanel = runCli(['render-panel', '--url', ready.url, '--kind', 'markdown', '--file', 'README.md']);
  assert.equal(browserPanel.status, 0, browserPanel.stderr);
  const browserPanelPayload = JSON.parse(browserPanel.stdout);
  assert.equal(browserPanelPayload.ok, true);
  assert.equal(browserPanelPayload.result.action.status, 'queued');
  assert.equal(browserPanelPayload.result.action.type, 'render_panel');

  const invalidAction = runCli(['act', '--url', ready.url, '{"type":"delete_everything"}']);
  assert.equal(invalidAction.status, 1);
  const invalidActionError = JSON.parse(invalidAction.stderr);
  assert.equal(invalidActionError.ok, false);
  assert.equal(invalidActionError.error.code, 'ACT_FAILED');

  const missingUrl = runCli(['observe']);
  assert.equal(missingUrl.status, 2);
  const missingUrlError = JSON.parse(missingUrl.stderr);
  assert.equal(missingUrlError.ok, false);

  const fakeBin = await mkdtemp(resolve(tmpdir(), 'burrete-fake-vp-'));
  const fakeVp = resolve(fakeBin, 'vp');
  await writeFile(fakeVp, '#!/bin/sh\necho "fake vp native binding failure" >&2\nexit 42\n');
  await chmod(fakeVp, 0o755);
  try {
    const prebuiltDist = await mkdtemp(resolve(tmpdir(), 'burrete-agent-shell-dist-'));
    await mkdir(resolve(prebuiltDist, 'assets'), { recursive: true });
    await writeFile(resolve(prebuiltDist, 'index.html'), '<!doctype html><title>Burrete Agent Shell</title><main>ready</main>');
    try {
      for (const [mode, host] of [
        ['browser-agent-shell', '0.0.0.0'],
        ['browser-preview', '192.0.2.1'],
      ]) {
        const invalidHost = runCliWithEnv(['open', '--mode', mode, '--host', host, 'samples/mini.pdb'], {
          BURRETE_AGENT_SHELL_DIST_DIR: prebuiltDist,
          PATH: `${fakeBin}:${process.env.PATH}`,
        });
        if (invalidHost.status === 0) {
          const unexpectedPayload = JSON.parse(invalidHost.stdout);
          if (unexpectedPayload.result?.processId) {
            try {
              process.kill(unexpectedPayload.result.processId, 'SIGTERM');
            } catch {}
          }
        }
        assert.equal(invalidHost.status, 2, `${mode} accepted ${host}`);
        assert.equal(JSON.parse(invalidHost.stderr).error.code, 'INVALID_HOST');
      }
      const prebuiltShell = runCliWithEnv(['open', '--mode', 'browser-agent-shell', 'samples/mini.pdb'], {
        BURRETE_AGENT_SHELL_DIST_DIR: prebuiltDist,
        PATH: `${fakeBin}:${process.env.PATH}`,
      });
      assert.equal(prebuiltShell.status, 0, prebuiltShell.stderr);
      const prebuiltPayload = JSON.parse(prebuiltShell.stdout);
      assert.equal(prebuiltPayload.ok, true);
      assert.equal(prebuiltPayload.result.mode, 'browser-agent-shell');
      assert.equal(prebuiltPayload.result.runtime, 'prebuilt-static');
      assert.equal(new URL(prebuiltPayload.result.url).searchParams.get('agentLayout'), 'focus');
      const fsUrl = new URL(`/@fs${resolve('samples/mini.pdb')}`, prebuiltPayload.result.url);
      const fsResponse = await fetch(fsUrl);
      assert.equal(fsResponse.status, 200);
      assert.match(await fsResponse.text(), /^HEADER\s+MINI GLY-ALA PEPTIDE/u);
      const viewerRuntimeUrl = new URL(`/@fs${resolve('PreviewExtension/Web/viewer-shell.js')}`, prebuiltPayload.result.url);
      const viewerRuntimeResponse = await fetch(viewerRuntimeUrl);
      assert.equal(viewerRuntimeResponse.status, 200);
      assert.match(await viewerRuntimeResponse.text(), /window\.BurreteViewerShell/);
      const stableViewerRuntimeResponse = await fetch(new URL('/__burette/runtime/viewer.js', prebuiltPayload.result.url));
      assert.equal(stableViewerRuntimeResponse.status, 200);
      assert.match(stableViewerRuntimeResponse.headers.get('content-type') ?? '', /^text\/javascript\b/u);
      assert.match(await stableViewerRuntimeResponse.text(), /BurreteAgent|BurreteDataBase64|molstar/u);
      const nativeComputeStatusResponse = await fetch(new URL('/__burette/native-compute', prebuiltPayload.result.url));
      assert.equal(nativeComputeStatusResponse.status, 200);
      assert.match(nativeComputeStatusResponse.headers.get('content-type') ?? '', /^application\/json\b/u);
      const nativeComputeStatus = await nativeComputeStatusResponse.json();
      assert.equal(typeof nativeComputeStatus.available, 'boolean');
      assert.equal(Array.isArray(nativeComputeStatus.operations), true);
      if (nativeComputeStatus.available) {
        assert.deepEqual(nativeComputeStatus.operations, [
          'generate3d',
          'generateEnsemble',
          'optimizeGeometry',
          'semiempiricalRm1',
          'alignPoses',
        ]);
      }
      const invalidNativeComputeResponse = await fetch(new URL('/__burette/native-compute', prebuiltPayload.result.url), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: '{}',
      });
      assert.equal(invalidNativeComputeResponse.status, 500);
      assert.doesNotMatch(await invalidNativeComputeResponse.text(), /Method not allowed/u);
      for (const [runtimePath, contentType] of [
        ['viewer-bootstrap.js', /^text\/javascript\b/u],
        ['trajectory-smoothing.js', /^text\/javascript\b/u],
        ['grid-viewer.js', /^text\/javascript\b/u],
        ['grid-ui.js', /^text\/javascript\b/u],
        ['grid.css', /^text\/css\b/u],
        ['openchemlib/openchemlib.js', /^text\/javascript\b/u],
        ['rdkit/RDKit_minimal.js', /^text\/javascript\b/u],
        ['rdkit/RDKit_minimal.wasm', /^application\/wasm\b/u],
      ]) {
        const response = await fetch(new URL(`/__burette/runtime/${runtimePath}`, prebuiltPayload.result.url));
        assert.equal(response.status, 200, runtimePath);
        assert.match(response.headers.get('content-type') ?? '', contentType, runtimePath);
        assert.equal((await response.arrayBuffer()).byteLength > 0, true, runtimePath);
      }
      const reusedSession = runCliWithEnv([
        'open',
        '--mode', 'browser-agent-shell',
        '--session-dir', prebuiltPayload.result.sessionDir,
        'samples/mini.pdb',
      ], {
        BURRETE_AGENT_SHELL_DIST_DIR: prebuiltDist,
        PATH: `${fakeBin}:${process.env.PATH}`,
      });
      if (reusedSession.status === 0) {
        const unexpectedPayload = JSON.parse(reusedSession.stdout);
        if (unexpectedPayload.result?.processId) {
          try {
            process.kill(unexpectedPayload.result.processId, 'SIGTERM');
          } catch {}
        }
      }
      assert.equal(reusedSession.status, 1);
      const reusedSessionError = JSON.parse(reusedSession.stderr);
      assert.equal(reusedSessionError.error.code, 'SESSION_IN_USE');
      for (const invalidUrl of [
        'file:///tmp/not-a-browser-session',
        'https://localhost:443/',
        'http://192.0.2.1:9/',
      ]) {
        const invalidSessionDir = await mkdtemp(resolve(tmpdir(), 'burrete-agent-invalid-session-'));
        try {
          await writeFile(resolve(invalidSessionDir, 'session.json'), JSON.stringify({
            mode: 'browser-dev-shell',
            url: invalidUrl,
          }));
          const invalidSession = runCliWithEnv([
            'open',
            '--mode', 'browser-agent-shell',
            '--session-dir', invalidSessionDir,
            'samples/mini.pdb',
          ], {
            BURRETE_AGENT_SHELL_DIST_DIR: prebuiltDist,
            PATH: `${fakeBin}:${process.env.PATH}`,
          });
          if (invalidSession.status === 0) {
            const unexpectedPayload = JSON.parse(invalidSession.stdout);
            if (unexpectedPayload.result?.processId) {
              try {
                process.kill(unexpectedPayload.result.processId, 'SIGTERM');
              } catch {}
            }
          }
          assert.equal(invalidSession.status, 1, invalidUrl);
          assert.equal(JSON.parse(invalidSession.stderr).error.code, 'INVALID_SESSION_URL', invalidUrl);
        } finally {
          await rm(invalidSessionDir, { recursive: true, force: true });
        }
      }
      const wasmUrl = new URL(`/@fs${resolve('PreviewExtension/Web/rdkit/RDKit_minimal.wasm')}`, prebuiltPayload.result.url);
      const wasmResponse = await fetch(wasmUrl);
      assert.equal(wasmResponse.status, 200);
      assert.equal(wasmResponse.headers.get('content-type'), 'application/wasm');
      assert.equal(Buffer.from(await wasmResponse.arrayBuffer()).subarray(0, 4).toString('hex'), '0061736d');
      const rdkitWasmRouteResponse = await fetch(new URL('/__burette/rdkit-wasm', prebuiltPayload.result.url));
      assert.equal(rdkitWasmRouteResponse.status, 200);
      assert.equal(rdkitWasmRouteResponse.headers.get('content-type'), 'application/wasm');
      assert.equal(Buffer.from(await rdkitWasmRouteResponse.arrayBuffer()).subarray(0, 4).toString('hex'), '0061736d');
      const miniFsPath = resolve('samples/mini.pdb').split('/').map(encodeURIComponent).join('/');
      const miniFs = await get(`${prebuiltPayload.result.url.split('?')[0]}@fs/${miniFsPath}`);
      assert.equal(miniFs.statusCode, 200);
      assert.match(miniFs.body, /^HEADER\s+MINI GLY-ALA PEPTIDE/u);
      assert.doesNotMatch(miniFs.body, /Burrete Agent Shell/);
      const finderIcon = await get(`${prebuiltPayload.result.url.split('?')[0]}__burette/app-icon/finder.png`);
      assert.equal(finderIcon.statusCode, 200);
      assert.match(finderIcon.headers['content-type'] ?? '', /^image\/png\b/u);
      assert.doesNotMatch(finderIcon.body, /Burrete Agent Shell/);
      if (prebuiltPayload.result.processId) {
        try {
          process.kill(prebuiltPayload.result.processId, 'SIGTERM');
        } catch {}
      }
      const staleAssetDist = await mkdtemp(resolve(tmpdir(), 'burrete-agent-stale-shell-dist-'));
      try {
        await writeFile(resolve(staleAssetDist, 'index.html'), '<!doctype html><script src="/@fs/tmp/stale/Burette/PreviewExtension/Web/viewer.js"></script>');
        const staleAssetShell = runCliWithEnv(['open', '--mode', 'browser-agent-shell', 'samples/mini.pdb'], {
          BURRETE_AGENT_SHELL_DIST_DIR: staleAssetDist,
          PATH: `${fakeBin}:${process.env.PATH}`,
        });
        assert.equal(staleAssetShell.status, 0, staleAssetShell.stderr);
        const staleAssetPayload = JSON.parse(staleAssetShell.stdout);
        const staleAsset = await get(`${staleAssetPayload.result.url.split('?')[0]}@fs/tmp/stale/Burette/PreviewExtension/Web/viewer.js`);
        assert.equal(staleAsset.statusCode, 200);
        assert.match(staleAsset.body, /BurreteAgent|BurreteDataBase64|molstar/u);
        assert.doesNotMatch(staleAsset.body, /Burrete Agent Shell/);
        if (staleAssetPayload.result.processId) {
          try {
            process.kill(staleAssetPayload.result.processId, 'SIGTERM');
          } catch {}
        }
      } finally {
        await rm(staleAssetDist, { recursive: true, force: true });
      }
    } finally {
      await rm(prebuiltDist, { recursive: true, force: true });
    }

    const failedShell = runCliWithEnv(['open', '--mode', 'browser-agent-shell', 'samples/mini.pdb'], {
      BURRETE_AGENT_SHELL_FORCE_VP: '1',
      PATH: `${fakeBin}:${process.env.PATH}`,
    });
    assert.equal(failedShell.status, 1);
    const failedPayload = JSON.parse(failedShell.stderr);
    assert.equal(failedPayload.ok, false);
    assert.equal(failedPayload.error.code, 'BROWSER_AGENT_SHELL_FAILED');
    assert.match(failedPayload.error.details.logTail, /fake vp native binding failure/);
    const autoFallback = runCliWithEnv(['open', '--mode', 'auto', 'samples/mini.pdb'], {
      BURRETE_AGENT_SHELL_FORCE_VP: '1',
      PATH: `${fakeBin}:${process.env.PATH}`,
    });
    assert.equal(autoFallback.status, 0, autoFallback.stderr);
    const autoFallbackPayload = JSON.parse(autoFallback.stdout);
    assert.equal(autoFallbackPayload.ok, true);
    assert.equal(autoFallbackPayload.result.mode, 'browser-preview');
    assert.equal(autoFallbackPayload.result.fallback.from, 'browser-agent-shell');
    assert.equal(autoFallbackPayload.result.fallback.reason.code, 'BROWSER_AGENT_SHELL_FAILED');
    if (autoFallbackPayload.result.processId) {
      try {
        process.kill(autoFallbackPayload.result.processId, 'SIGTERM');
      } catch {}
    }
  } finally {
    await rm(fakeBin, { recursive: true, force: true });
  }
  assert.equal(missingUrlError.error.code, 'INVALID_ARGS');

  const sessionDir = await mkdtemp(resolve(tmpdir(), 'burrete-agent-cli-test-'));
  try {
    const desktop = runCli(['open', '--mode', 'desktop-app', '--session-dir', sessionDir, '--no-launch', 'samples/mini.pdb']);
    assert.equal(desktop.status, 0, desktop.stderr);
    const desktopPayload = JSON.parse(desktop.stdout);
    assert.equal(desktopPayload.ok, true);
    assert.equal(desktopPayload.result.mode, 'desktop-app');
    assert.equal(desktopPayload.result.sessionDir, sessionDir);
    assert.equal(desktopPayload.result.launched, false);

    const session = JSON.parse(await readFile(resolve(sessionDir, 'session.json'), 'utf8'));
    assert.equal(session.mode, 'desktop-app');
    assert.deepEqual(session.initialPaths, [resolve('samples/mini.pdb')]);

    await writeFile(resolve(sessionDir, 'observe.json'), JSON.stringify({
      apiVersion: 'burette-agent-control/v1',
      mode: 'desktop-app',
      activeDocument: { ready: true, title: 'mini.pdb' }
    }));
    const desktopObserve = runCli(['observe', '--session-dir', sessionDir]);
    assert.equal(desktopObserve.status, 0, desktopObserve.stderr);
    const desktopObservePayload = JSON.parse(desktopObserve.stdout);
    assert.equal(desktopObservePayload.ok, true);
    assert.equal(desktopObservePayload.result.mode, 'desktop-app');
    assert.equal(desktopObservePayload.result.activeDocument.title, 'mini.pdb');

    const desktopAction = runCli(['act', '--session-dir', sessionDir, '{"type":"open_files","paths":["samples/mini.pdb"]}']);
    assert.equal(desktopAction.status, 0, desktopAction.stderr);
    const desktopActionPayload = JSON.parse(desktopAction.stdout);
    assert.equal(desktopActionPayload.ok, true);
    assert.equal(desktopActionPayload.result.action.status, 'queued');
    assert.equal(desktopActionPayload.result.action.type, 'open_files');

    const panel = runCli(['render-panel', '--session-dir', sessionDir, '--kind', 'markdown', '--file', 'README.md']);
    assert.equal(panel.status, 0, panel.stderr);
    const panelPayload = JSON.parse(panel.stdout);
    assert.equal(panelPayload.ok, true);
    assert.equal(panelPayload.result.action.status, 'queued');
    assert.equal(panelPayload.result.action.type, 'render_panel');
    const panelActionsFile = JSON.parse(await readFile(resolve(sessionDir, 'actions.json'), 'utf8'));
    assert.equal(panelActionsFile.actions.at(-1).action.kind, 'markdown');
    assert.equal(panelActionsFile.actions.at(-1).action.file, resolve('README.md'));

    const invalidPanel = runCli(['render-panel', '--session-dir', sessionDir, '--kind', 'image', '--file', 'README.md']);
    assert.equal(invalidPanel.status, 2);
    const invalidPanelError = JSON.parse(invalidPanel.stderr);
    assert.equal(invalidPanelError.error.code, 'INVALID_ARGS');

    const badScene = runCli(['open', '--mode', 'browser-agent-shell', 'README.md', '--scene', 'bogus']);
    assert.equal(badScene.status, 2);
    assert.equal(JSON.parse(badScene.stderr).error.code, 'INVALID_ARGS');

    const tooFewScene = runCli(['open', '--mode', 'browser-agent-shell', 'samples/mini.pdb', '--scene', 'structureAll']);
    assert.equal(tooFewScene.status, 2);
    assert.equal(JSON.parse(tooFewScene.stderr).error.code, 'INVALID_ARGS');

    const actionsFile = JSON.parse(await readFile(resolve(sessionDir, 'actions.json'), 'utf8'));
    const queued = actionsFile.actions[0];
    queued.status = 'completed';
    queued.completedAt = new Date().toISOString();
    queued.result = { ok: true, command: 'open_files', result: { pathCount: 1 } };
    await writeFile(resolve(sessionDir, 'actions.json'), JSON.stringify(actionsFile));

    const waitedAction = runCli(['act', '--session-dir', sessionDir, '{"type":"reset_camera"}', '--wait-ms', '1000']);
    assert.equal(waitedAction.status, 1);
    const waitedActionError = JSON.parse(waitedAction.stderr);
    assert.equal(waitedActionError.error.code, 'ACTION_TIMEOUT');
  } finally {
    await rm(sessionDir, { recursive: true, force: true });
  }

  console.log('burrete-agent CLI tests passed');
} finally {
  child.kill('SIGTERM');
}
