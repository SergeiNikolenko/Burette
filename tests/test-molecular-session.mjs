import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { runMcpAppOperation } from '../scripts/mcp-app-session.mjs';
import { molecularSessionRoot } from '../scripts/molecular-session-actions.mjs';
import { registerMolecularBackground } from '../plugins/burette-agent/mcp/registrations/molecular-background/register.mjs';

test('durable session computes and recovers results without ever mounting a panel', async () => {
  const sessionId = randomUUID();
  const input = { operation: 'open', file: new URL('../samples/mini.pdb', import.meta.url).pathname,
    workspace: true, autonomous: true, openRequestId: sessionId };
  try {
    const opened = await runMcpAppOperation(input);
    assert.equal(opened.ready, false);
    assert.equal((await runMcpAppOperation({ operation: 'observe', sessionId })).lifecycle.status, 'awaiting_mount');
    const requestId = randomUUID();
    const submitted = await runMcpAppOperation({ operation: 'molecular', command: 'run', sessionId, requestId,
      action: { type: 'inspect' }, waitMs: 30000 });
    assert.equal(submitted.status, 'completed', JSON.stringify(submitted.error));
    assert.ok(submitted.result.inventory[0].atomCount > 0);
    assert.ok(submitted.metrics.maxRssKiB > 0);
    const repeated = await runMcpAppOperation(input);
    assert.equal(repeated.sessionId, sessionId);
    const recovered = await runMcpAppOperation({ operation: 'molecular', command: 'status', sessionId, requestId });
    assert.deepEqual(recovered.result, submitted.result);
    const panel = await runMcpAppOperation({ operation: 'observe', sessionId });
    assert.equal(panel.lifecycle.status, 'awaiting_mount');
    assert.equal(panel.molecular.dataReady, true);
    await runMcpAppOperation({ operation: 'exchange', sessionId, token: repeated.token,
      presentationId: repeated.presentationId, close: true });
    assert.equal((await runMcpAppOperation({ operation: 'observe', sessionId })).closed, true);
    assert.deepEqual((await runMcpAppOperation({ operation: 'molecular', command: 'status', sessionId, requestId })).result, submitted.result);
    const added = await runMcpAppOperation({ operation: 'molecular', command: 'add_files', sessionId,
      paths: [new URL('../samples/structures/proteins/1htb.pdb', import.meta.url).pathname] });
    assert.equal(added.documents.length, 2);
    const shown = await runMcpAppOperation({ operation: 'molecular', command: 'present', sessionId });
    assert.equal(shown.sessionId, sessionId);
    assert.equal(shown.ready, false);
    assert.ok(shown.presentationId);
    const exchange = await runMcpAppOperation({ operation: 'exchange', sessionId, token: shown.token, presentationId: shown.presentationId });
    assert.notEqual(exchange.closed, true);
    assert.ok(await readFile(join(molecularSessionRoot, sessionId, 'source')));
  } finally {
    await delay(100);
    await rm(join(molecularSessionRoot, sessionId), { recursive: true, force: true });
  }
});

test('public operation boundary rejects malformed analysis and scene requests', async () => {
  const tools = new Map();
  registerMolecularBackground({ registerTool(name, definition, handler) { tools.set(name, { definition, handler }); } });
  const { z } = await import('zod');
  const action = z.object(tools.get('burette.run_molecular_operation').definition.inputSchema);
  const base = { sessionId: randomUUID(), requestId: randomUUID() };
  const selection = { documentId: randomUUID(), chain: 'A' };
  assert.equal(action.safeParse({ ...base, action: { type: 'contacts', selection, target: selection, cutoff: -1 } }).success, false);
  assert.equal(action.safeParse({ ...base, action: { type: 'buried_area', selection, target: selection, samples: 1e9 } }).success, false);
  assert.equal(action.safeParse({ ...base, action: { type: 'render', outputPath: '/tmp/image.png', width: 100000 } }).success, false);
  assert.equal(action.safeParse({ ...base, action: { type: 'inspect' } }).success, true);
  const response = await tools.get('burette.open_molecular_session').handler({ openRequestId: randomUUID() });
  assert.equal(response.isError, true);
  assert.equal(JSON.stringify(response).includes('token'), false);
});
