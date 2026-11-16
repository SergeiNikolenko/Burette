#!/usr/bin/env node
// Real HTTPS transport check. Uses only a public PDB fixture, never local files.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const config = JSON.parse(await readFile(new URL('../plugins/burette-cloud/.mcp.json', import.meta.url), 'utf8'));
const endpoint = config.mcpServers.burette_cloud.url;
let id = 0;
let protocol;
async function rpc(method, params) {
  const response = await fetch(endpoint, {
    method: 'POST', signal: AbortSignal.timeout(30000),
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
      ...(protocol ? { 'MCP-Protocol-Version': protocol } : {}) },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
  });
  assert.equal(response.status, 200, `${method}: HTTP ${response.status}`);
  const body = await response.text();
  const messages = response.headers.get('content-type')?.includes('text/event-stream')
    ? body.split(/\r?\n\r?\n/).map((event) => event.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('\n')).filter(Boolean).map((data) => JSON.parse(data))
    : [JSON.parse(body)];
  const message = messages.find((item) => item.id === id);
  assert.ok(message, `${method}: missing JSON-RPC response`);
  assert.equal(message.error, undefined, `${method}: ${JSON.stringify(message.error)}`);
  return message.result;
}
const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'burette-cloud-smoke', version: '1.0.0' } });
protocol = init.protocolVersion;
assert.ok(protocol);
const listed = await rpc('tools/list', {});
const expected = ['preview_pdb_structure', 'preview_molecular_file', 'render_molecular_scene', 'open_ketcher', 'control_ketcher'];
assert.deepEqual(listed.tools.map((tool) => tool.name).sort(), expected.sort());
const call = (name, args) => rpc('tools/call', { name, arguments: args });
const preview = await call('preview_pdb_structure', { pdbId: '1CRN' });
assert.ok(!preview.isError, 'Public PDB preview failed');
assert.equal(preview.structuredContent.pdbId, '1CRN');
assert.ok(preview.structuredContent.byteCount > 0);
assert.ok(preview._meta.structure);
const scene = await call('render_molecular_scene', { source: 'pdb', pdbId: '1CRN', actions: [{ type: 'hide_components', kind: 'water' }] });
assert.ok(!scene.isError, 'Scene preparation failed');
const privateFile = await call('preview_molecular_file', { structureFile: { file_id: 'smoke-denied', download_url: 'https://127.0.0.1/secret.pdb', file_name: 'secret.pdb' } });
assert.equal(privateFile.isError, true, 'Private-network URL must be rejected');
const sketch = await call('open_ketcher', { structure: { format: 'smiles', content: 'CCO' } });
assert.equal(sketch.structuredContent.ok, true, 'Ketcher creation failed');
assert.ok(sketch.structuredContent.surfaceId);
const control = (command, expectedRevision, extra = {}) => call('control_ketcher', { action: {
  apiVersion: 'burette-ketcher-agent/v1', type: 'control_ketcher',
  surfaceId: sketch.structuredContent.surfaceId, command, expectedRevision, ...extra,
} });
const revision = sketch.structuredContent.ketcher.structureRevision;
const read = await control('get_structure', revision, { formats: ['smiles'] });
assert.equal(read.structuredContent.ok, true, 'Ketcher follow-up read failed');
assert.equal(read._meta.ketcherInitialSeed.content, 'CCO');
const edited = await control('set_structure', revision, { format: 'smiles', content: 'CCN' });
assert.equal(edited.structuredContent.ok, true, 'Ketcher follow-up edit failed');
const stale = await control('clear_structure', revision);
assert.equal(stale.isError, true, 'Stale revision must not clear the sketch');
const after = await control('get_structure', revision + 1, { formats: ['smiles'] });
assert.equal(after.structuredContent.ok, true, 'Ketcher edited read failed');
assert.equal(after._meta.ketcherInitialSeed.content, 'CCN');
const resources = await rpc('resources/list', {});
assert.ok(resources.resources.length >= 2);
for (const resource of resources.resources) {
  const result = await rpc('resources/read', { uri: resource.uri });
  assert.ok(result.contents.some((content) => content.text?.includes('<html')), 'Missing widget HTML');
}
console.log(JSON.stringify({ endpoint, protocol, tools: listed.tools.map((t) => t.name), pdb: preview.structuredContent,
  checks: ['initialize', 'tools/list', 'public PDB', 'scene preparation', 'private URL rejected', 'Ketcher creation/read/edit', 'stale revision rejected without losing sketch', 'widget resources'],
  widgetMounted: false, checkedAt: new Date().toISOString() }, null, 2));
