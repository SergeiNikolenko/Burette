import assert from 'node:assert/strict';
import { readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { captureToolResult } from '../scripts/mcp-app-capture.mjs';
import { runMcpAppOperation as run } from '../scripts/mcp-app-session.mjs';

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a/2sAAAAASUVORK5CYII=';
const image = role => ({ role, dataUri: `data:image/png;base64,${png}` });
const outcome = { ok: true, command: 'capture_scene', result: { depiction: { status: 'ready' }, images: [image('scene'), image('ligand_2d')] } };

test('MCP captures return real image blocks without base64 in structured context', () => {
  const response = captureToolResult({ action: { type: 'capture_scene' }, status: 'completed', result: outcome });
  assert.deepEqual(response.content.slice(1), [1, 2].map(() => ({ type: 'image', mimeType: 'image/png', data: png })));
  assert.deepEqual(response.structuredContent.images, ['scene', 'ligand_2d'].map(role => ({ role, width: 1, height: 1 })));
  assert.ok(!JSON.stringify(response.structuredContent).includes(png));
  assert.ok(!response.content[0].text.includes(png));
  for (const images of [[], [image('ligand_2d')], [image('scene'), image('scene')], [image('scene'), image('ligand_2d'), image('scene')], [{ role: 'scene', dataUri: 'data:image/svg+xml;base64,PHN2Zz4=' }], [{ role: 'scene', dataUri: 'file:///etc/passwd' }], [{ role: 'scene', dataUri: 'data:image/png;base64,YWJj' }]]) {
    assert.throws(() => captureToolResult({ action: { type: 'capture_scene' }, result: { result: { images } } }));
  }
});

test('authenticated capture acknowledgement crosses the session contract; ordinary results stay bounded', async () => {
  const session = await run({ operation: 'open', file: new URL('../samples/mini.pdb', import.meta.url).pathname });
  const locator = { sessionId: session.sessionId, token: session.token };
  const directory = join(tmpdir(), 'burette-mcp-app', session.sessionId);
  try {
    await run({ operation: 'exchange', ...locator, state: { ready: true } });
    const pending = run({ operation: 'act', sessionId: session.sessionId, action: { type: 'capture_scene' }, waitMs: 1000 });
    let action;
    for (let i = 0; i < 50 && !action; i++) {
      const names = (await readdir(join(directory, 'actions'))).filter(name => /^[0-9a-f-]{36}\.json$/u.test(name));
      if (names[0]) action = JSON.parse(await readFile(join(directory, 'actions', names[0]), 'utf8'));
      else await new Promise(resolve => setTimeout(resolve, 5));
    }
    await assert.rejects(run({ operation: 'exchange', ...locator, completed: { actionId: action.actionId, result: { ok: true } } }), /missing images/);
    await run({ operation: 'exchange', ...locator, completed: { actionId: action.actionId, result: outcome } });
    assert.equal(captureToolResult(await pending).content[1].type, 'image');
    const normal = await run({ operation: 'act', sessionId: session.sessionId, action: { type: 'observe_scene' } });
    await assert.rejects(run({ operation: 'exchange', ...locator, completed: { actionId: normal.actionId, result: { data: 'x'.repeat(65536) } } }), /64 KiB/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

const source = await readFile(new URL('../PreviewExtension/Web/viewer.js', import.meta.url), 'utf8');
const start = source.indexOf('  async function captureAgentScene(');
const captureSource = source.slice(start, source.indexOf('\n  }', start) + 4);
test('capture uses the current ligand graph, preserves scene and reports unavailable 2D honestly', async () => {
  let selected = null, graph, fail = false;
  const calls = [], revoked = [];
  const scene = { camera: { target: [1, 2, 3] } };
  const capture = runInNewContext(`${captureSource}\ncaptureAgentScene`, {
    agentActionFailure: (command, code, message) => ({ ok: false, command, error: { code, message } }),
    molstarSelectedMoleculeTargetFromSelection: () => selected,
    describeViewportScene: () => scene,
    window: { BuretteAgent: { run: async action => { calls.push(action); return { ok: true, result: image('scene') }; } } },
    molstarMoleculePreviewEntry: target => { graph = target; return { data: 'selected-graph' }; },
    molstarMoleculePreviewRDKitSVG: async () => { if (fail) throw new Error('RDKit unavailable'); return '<svg></svg>'; },
    withTimeout: value => value, Blob, URL: { createObjectURL: () => 'blob:test', revokeObjectURL: value => revoked.push(value) },
    Image: class { set src(value) { this.onload(); } },
    document: { createElement: () => ({ getContext: () => ({ fillRect() {}, drawImage() {} }), toDataURL: () => `data:image/png;base64,${png}` }) },
  });
  assert.equal((await capture({ scope: 'ligand' })).error.code, 'SELECTION_EMPTY');
  assert.equal(calls.length, 0);
  selected = { scope: 'ligand', label: 'HEM A:501', atom: { auth_comp_id: 'HEM', auth_asym_id: 'A', auth_seq_id: 501, model: { transform() {} } } };
  const result = await capture({});
  assert.equal(graph, selected);
  assert.equal(result.result.scene, scene);
  assert.deepEqual(structuredClone(result.result.depiction.identity), { label_entity_id: null, label_asym_id: null, auth_asym_id: 'A', label_seq_id: null, auth_seq_id: 501, label_comp_id: null, auth_comp_id: 'HEM' });
  assert.doesNotThrow(() => structuredClone(result), 'the real iframe response must be serializable');
  assert.deepEqual(Array.from(result.result.images, image => image.role), ['scene', 'ligand_2d']);
  assert.deepEqual(revoked, ['blob:test']);
  fail = true;
  const partial = await capture({ scope: 'ligand' });
  assert.equal(partial.result.depiction.status, 'unavailable');
  assert.equal(partial.result.images.length, 1);
  assert.equal((await capture({ scope: 'scene' })).result.depiction.status, 'not_requested');
  assert.ok(calls.every(action => action.command === 'screenshot'), 'capturing never focuses, mutates selection or changes the scene');
});
